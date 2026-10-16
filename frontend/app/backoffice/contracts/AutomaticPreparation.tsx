'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {useAuth} from '@/app/providers';
import {Card,Button,Alert} from '@/app/components/ui';
import WorkflowModal from './WorkflowModal';
type Field={key:string;label:string;value:unknown;unit:string;scenario:string;source:string;state:string;observation:string|null};
type Plan={enabled:boolean;available?:boolean;unitId?:string;month?:string;basis?:string;token?:string;percent?:number;filled?:number;total?:number;pending?:number;canPrepare?:boolean;readyForValidation?:boolean;fields?:Field[];observations?:string[]};
type Run={id:string;state:string;created_at:string;actor_id:string;plan:Plan;events?:{sequence:number;state:string;created_at:string;receipts:{label:string;state:string}[]}[]};
const value=(v:unknown):string=>v===null||v===undefined?'Aguardando fonte':typeof v==='object'?JSON.stringify(v):String(v);
async function boundedRequest<T>(path:string,options:Parameters<typeof apiRequest>[1]={}):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<T>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Tempo de conferência excedido. Consulte o histórico; nenhuma gravação será repetida automaticamente.'));},45000)});
 try{return await Promise.race([apiRequest<T>(path,{...options,signal:controller.signal}),timeout]);}finally{if(timer)clearTimeout(timer);}
}
export default function AutomaticPreparation(props:{unitId:string;month:string;onEnabled:(v:boolean)=>void;onPrepared:()=>void;onValidate:()=>void}){
 const {context}=useAuth();const identity=JSON.stringify(context&&'currentOrganization' in context?{user:context.user.id,org:context.currentOrganization.id,role:context.currentOrganization.role,permissions:context.currentOrganization.permissions,accessMode:context.accessMode}:{user:context?.user.id,scope:context?.scope,role:context?.role,permissions:context?.permissions});
 return <PreparationScope key={identity+props.unitId+props.month} {...props}/>;
}
function PreparationScope({unitId,month,onEnabled,onPrepared,onValidate}:{unitId:string;month:string;onEnabled:(v:boolean)=>void;onPrepared:()=>void;onValidate:()=>void}){
 const [plan,setPlan]=useState<Plan|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[open,setOpen]=useState(false),[page,setPage]=useState(0),[history,setHistory]=useState<{rows:Run[];total:number}|null>(null),[selected,setSelected]=useState<Run|null>(null),[run,setRun]=useState<Run|null>(null);
 const generation=useRef(0),attempted=useRef(new Set<string>()),uncertain=useRef(false),working=useRef(false),onChange=useRef(onPrepared),enabled=useRef(onEnabled);onChange.current=onPrepared;enabled.current=onEnabled;
 const query=new URLSearchParams({consumerUnitId:unitId,month}).toString();
 useEffect(()=>{let live=true;const g=++generation.current;void(async()=>{
  if(working.current)return;setBusy(true);setError('');
  try{let p=await boundedRequest<Plan>('/api/v1/calculation-autofill?'+query);if(!live||g!==generation.current)return;
   if(p.enabled&&p.available&&(p.unitId!==unitId||p.month!==month))throw Error('Resposta fora da unidade e competência.');
   enabled.current(p.enabled);setPlan(p);
   if(p.enabled&&p.canPrepare&&p.available&&p.basis&&p.token&&!uncertain.current&&!attempted.current.has(p.basis)){
    attempted.current.add(p.basis);working.current=true;
    const r=await boundedRequest<{run:Run;current:Plan;canPublish:false}>('/api/v1/calculation-autofill',{method:'POST',body:{consumerUnitId:unitId,month,requestId:crypto.randomUUID(),token:p.token}});
    if(!live||g!==generation.current)return;
    if(r.current.unitId!==unitId||r.current.month!==month)throw Error('Resultado fora da seleção.');
    setRun(r.run);setPlan(r.current);
    if(['UNKNOWN','RUNNING'].includes(r.run.state)){uncertain.current=true;setError('Resultado ainda não confirmado. Consulte o histórico; não haverá reenvio automático.');}
    onChange.current();
   }
  }catch(e){if(live&&g===generation.current){uncertain.current=true;setError(e instanceof Error?e.message:'Consulte o histórico antes de repetir.');}}
  finally{working.current=false;if(live&&g===generation.current)setBusy(false);}
 })();return()=>{live=false;generation.current++;};},[query,unitId,month,refresh]);
 useEffect(()=>{if(!open)return;let live=true;setHistory(null);void boundedRequest<{rows:Run[];total:number}>('/api/v1/calculation-autofill/history?'+query+'&page='+page).then(h=>{if(live)setHistory(h)}).catch(()=>{if(live)setError('Histórico indisponível. Nenhuma tentativa será reenviada.');});return()=>{live=false};},[open,page,query,refresh]);
 if(!plan?.enabled)return error?<Alert>{error}</Alert>:null;
 const needsRecheck=!!error||uncertain.current||!!run&&run.state!=='PREPARED';
 const complete=plan.percent===100&&plan.readyForValidation&&!busy&&!needsRecheck;
 const progress=Math.min(plan.percent??0,needsRecheck||busy?99:100);
 const observations=Array.from(new Set([...(plan.observations??[]),...(plan.fields??[]).filter(f=>f.observation).map(f=>f.label+': '+f.observation)]));
 return <Card title='Preparação automática pela EVA'>
  <p role='status'>{busy?'A EVA está conferindo fontes e preparando os preenchimentos…':needsRecheck?'Preparação exige reconferência — consulte a observação e o histórico.':complete?'100% preenchido — aguardando validação':`${progress}% preenchido · ${plan.pending??0} informação(ões) aguardando fonte ou conferência`}</p>
  <progress max={100} value={progress} aria-label='Preenchimento da apuração'/>
  <p>A EVA reúne a fatura, a biblioteca ACR e os contratos vigentes na competência. Os valores são propostas; aprovação e publicação seguem as permissões atuais.</p>
  {error?<Alert>{error}</Alert>:null}
  {run?<p>Preparação registrada · {{PREPARED:'preenchimentos preservados',PARTIAL:'preenchimentos com observações',RUNNING:'conferir execução pendente',UNKNOWN:'conferir resultado não confirmado'}[run.state]??run.state}</p>:null}
  {!!observations.length&&<aside aria-label='Observação da EVA'><p><strong>Observação da EVA:</strong> {observations[0]} {observations.length>1?'Os demais pontos estão reunidos nos detalhes abaixo.':''}</p>{observations.length>1?<details><summary>Detalhes da observação</summary><ul>{observations.slice(1).map((note,i)=><li key={i}>{note}</li>)}</ul></details>:null}</aside>}
  <details><summary>Valores preenchidos e suas fontes</summary><table><thead><tr><th>Campo</th><th>Valor</th><th>Origem</th></tr></thead><tbody>{plan.fields?.map(f=><tr key={f.key}><td>{f.label} · {f.scenario}</td><td>{value(f.value)} {f.unit}</td><td>{f.source||'Pendente'}</td></tr>)}</tbody></table></details>
  <div style={{display:'flex',gap:12,marginTop:16}}><Button disabled={busy||!complete} onClick={onValidate}>Abrir validação</Button><Button variant='secondary' disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Atualizar conferência</Button><Button variant='secondary' disabled={busy} onClick={()=>{setOpen(true);setSelected(null)}}>Histórico da preparação</Button></div>
  {open?<WorkflowModal title='Histórico da preparação automática' onClose={()=>setOpen(false)}>
   {!history?<p>Consultando histórico…</p>:<><ul>{history.rows.map(r=><li key={r.id}><button type='button' onClick={()=>setSelected(r)}>{new Date(r.created_at).toLocaleString('pt-BR')} · {r.state}</button></li>)}</ul><Button disabled={!page} onClick={()=>setPage(n=>n-1)}>Anterior</Button><span> Página {page+1} </span><Button disabled={(page+1)*10>=history.total} onClick={()=>setPage(n=>n+1)}>Próxima</Button></>}
   {selected?<><h3>Registro {selected.id}</h3><p>Autor: {selected.actor_id}</p><p>{selected.plan.percent}% dos campos preenchidos nesta proposta histórica.</p>{selected.events?.map(e=><div key={e.sequence}><p>{new Date(e.created_at).toLocaleString('pt-BR')} · {e.state}</p><ul>{e.receipts.map((r,i)=><li key={i}>{r.label} · {r.state}</li>)}</ul></div>)}</>:null}
  </WorkflowModal>:null}
 </Card>;
}
