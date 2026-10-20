'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {useAuth} from '@/app/providers';
import {Card,Button,Alert} from '@/app/components/ui';
import SourcePreparationEvidence from './SourcePreparationEvidence';
import WorkflowModal from './WorkflowModal';
import OperationalProposalView,{type OperationalProposal} from './OperationalProposalView';
type Field={key:string;label:string;value:unknown;unit:string;scenario:string;source:string;state:string;observation:string|null};
type Simple={state:string;coverage:{filled:number;total:number;percent:number};manualGroups:{key:string;label:string;pending:string[];fields:Field[]}[];summary:string[];recommendations:string[];missing:string[]};
type Plan={sourcePreparation?:Parameters<typeof SourcePreparationEvidence>[0]['data'];operational?:OperationalProposal;manualOverrides?:Record<string,string>;simplified?:Simple;referenceUsed?:boolean;humanReviewPending?:boolean;financialApproval?:false;reference?:{id:string;month:string;version:number;hash:string}|null;enabled:boolean;available?:boolean;unitId?:string;month?:string;basis?:string;sourceHash?:string;token?:string;percent?:number;filled?:number;total?:number;pending?:number;canPrepare?:boolean;readyForValidation?:boolean;fields?:Field[];observations?:string[]};
type Run={id:string;state:string;created_at:string;actor_id:string;consumer_unit_id:string;month:string;source_basis:string;source_hash:string;plan:Plan;events?:{sequence:number;state:string;created_at:string;receipts:{label:string;state:string}[]}[]};
const value=(v:unknown):string=>v===null||v===undefined?'Aguardando fonte':typeof v==='object'?JSON.stringify(v):String(v);
async function boundedRequest<T>(path:string,options:Parameters<typeof apiRequest>[1]={}):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<T>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Tempo de conferência excedido. Consulte o histórico; nenhuma gravação será repetida automaticamente.'));},45000)});
 try{return await Promise.race([apiRequest<T>(path,{...options,signal:controller.signal}),timeout]);}finally{if(timer)clearTimeout(timer);}
}
export default function AutomaticPreparation(props:{unitId:string;month:string;onEnabled:(v:boolean)=>void;onPrepared:()=>void;onValidate:()=>void;onManual?:(tab:string)=>void}){
 const {context}=useAuth();const identity=JSON.stringify(context&&'currentOrganization' in context?{user:context.user.id,org:context.currentOrganization.id,role:context.currentOrganization.role,permissions:context.currentOrganization.permissions,accessMode:context.accessMode}:{user:context?.user.id,scope:context?.scope,role:context?.role,permissions:context?.permissions});
 return <PreparationScope key={identity+props.unitId+props.month} {...props}/>;
}
function PreparationScope({unitId,month,onEnabled,onPrepared,onValidate,onManual}:{unitId:string;month:string;onEnabled:(v:boolean)=>void;onPrepared:()=>void;onValidate:()=>void;onManual?:(tab:string)=>void}){
 const [plan,setPlan]=useState<Plan|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[open,setOpen]=useState(false),[page,setPage]=useState(0),[history,setHistory]=useState<{rows:Run[];total:number}|null>(null),[selected,setSelected]=useState<Run|null>(null),[run,setRun]=useState<Run|null>(null);
 const [manual,setManual]=useState<Record<string,string>>({}),[sourcesOpen,setSourcesOpen]=useState(false);const proposalRef=useRef<HTMLDivElement>(null);
 function reviewProposal(){setSourcesOpen(true);proposalRef.current?.scrollIntoView({behavior:'smooth',block:'start'});proposalRef.current?.focus();}
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
 useEffect(()=>{if(!open)return;let live=true;setHistory(null);void boundedRequest<{rows:Run[];total:number}>('/api/v1/calculation-autofill/history?'+query+'&page='+page).then(h=>{if(!live)return;if(h.rows.some(r=>r.consumer_unit_id!==unitId||r.month!==month))throw Error('Histórico fora do escopo');setHistory(h);const completed=h.rows.find(r=>r.source_basis===plan?.basis&&r.source_hash===plan?.sourceHash&&['PREPARED','PARTIAL'].includes(r.state));if(completed){uncertain.current=false;attempted.current.add(completed.source_basis);setRun(completed);setError('');}}).catch(()=>{if(live)setError('Histórico indisponível. Nenhuma tentativa será reenviada.');});return()=>{live=false};},[open,page,query,unitId,month,refresh,plan?.basis,plan?.sourceHash]);
 async function saveCommercial(){
  if(busy||working.current||uncertain.current||!plan?.canPrepare)return;
  const values=Object.fromEntries(Object.entries({...plan.manualOverrides,...manual}).filter(([,v])=>v!==''));if(!Object.keys(values).length){setError('Informe ao menos um valor comercial para ajustar a proposta.');return;}
  working.current=true;setBusy(true);setError('');let started=false;const g=generation.current;
  try{const candidate=await boundedRequest<Plan>('/api/v1/calculation-autofill/preview',{method:'POST',body:{consumerUnitId:unitId,month,manual:values}});
   if(g!==generation.current)return;if(candidate.unitId!==unitId||candidate.month!==month||!candidate.token||!candidate.canPrepare)throw Error('Proposta fora da seleção ou sem permissão.');
   started=true;const result=await boundedRequest<{run:Run;current:Plan}>('/api/v1/calculation-autofill',{method:'POST',body:{consumerUnitId:unitId,month,manual:values,requestId:crypto.randomUUID(),token:candidate.token}});
   if(g!==generation.current)return;if(result.current.unitId!==unitId||result.current.month!==month)throw Error('Resultado fora da seleção.');
   setRun(result.run);setPlan(result.current);setManual({});if(['UNKNOWN','RUNNING'].includes(result.run.state)){uncertain.current=true;setError('Resultado ainda não confirmado. Consulte o histórico antes de repetir.');}onChange.current();
  }catch(e){if(g===generation.current){if(started)uncertain.current=true;setError(e instanceof Error?e.message:'Confira o histórico.');}}
  finally{working.current=false;if(g===generation.current)setBusy(false);}
 }
 if(!plan?.enabled)return error?<Alert>{error}</Alert>:null;
 const needsRecheck=!!error||uncertain.current||!!run&&['UNKNOWN','RUNNING'].includes(run.state);
 const complete=plan.percent===100&&plan.readyForValidation&&!busy&&!needsRecheck;
 const progress=Math.min(plan.percent??0,needsRecheck||busy?99:100);
 const observations=Array.from(new Set([...(plan.observations??[]),...(plan.fields??[]).filter(f=>f.observation).map(f=>f.label+': '+f.observation)]));
 return <Card title='Preparação automática pela EVA'>
  <SourcePreparationEvidence data={plan.sourcePreparation}/>
  {plan.operational&&!busy&&!needsRecheck?<div ref={proposalRef} tabIndex={-1}><OperationalProposalView data={plan.operational}/></div>:null}
  {plan.simplified?<><p role='status'>{busy?'A EVA está preparando os dados disponíveis…':needsRecheck?'Resultado ainda não confirmado — consulte o histórico.':'Dados preparados pela EVA — conferir resumo e condições comerciais'}</p><p>{plan.simplified.coverage.filled}/{plan.simplified.coverage.total} dados da fatura e cadastro disponíveis. A cobertura da extração não representa aprovação financeira.</p></>:null}
  <p role='status' hidden={!!plan.simplified}>{busy?'A EVA está conferindo fontes e preparando os preenchimentos…':needsRecheck?'Preparação exige reconferência — consulte a observação e o histórico.':complete?(plan.referenceUsed?'100% preenchido com referência — aguardando conferência':'100% preenchido — aguardando validação'):plan.pending?`${progress}% preenchido · ${plan.pending} informação(ões) aguardando fonte ou conferência`:`${progress}% preparado · confira a observação da EVA antes de validar`}</p>
  <progress hidden={!!plan.simplified} max={100} value={progress} aria-label='Preenchimento da apuração'/>
  <p>A EVA reúne a fatura, a biblioteca ACR e os contratos vigentes na competência. Os valores são propostas; aprovação e publicação seguem as permissões atuais. O percentual de preenchimento é separado das aprovações e da vigência contratual.</p>
  {plan.referenceUsed&&plan.reference?<p>Referência preservada: {plan.reference.month} · versão {plan.reference.version}. O preço histórico é aplicado ao consumo atual; contrato e honorários continuam sujeitos à conferência.</p>:null}
  {plan.humanReviewPending?<p>Extração preenchida como proposta. A conferência humana da fatura ainda não foi registrada.</p>:null}
  {error?<Alert>{error}</Alert>:null}
  {run?<p>Preparação registrada · {{PREPARED:'preenchimentos preservados',PARTIAL:'preenchimentos com observações',RUNNING:'conferir execução pendente',UNKNOWN:'conferir resultado não confirmado'}[run.state]??run.state}</p>:null}
  {plan.simplified?<><section aria-label='Condições comerciais para conferir'><h3>Conferir somente honorários e fornecedor</h3>{plan.simplified.manualGroups.map(group=><article key={group.key}><h4>{group.label}</h4><dl>{group.fields.filter(f=>f.value!==null&&!['fee:fixed','fee:percentage','supplier:price','fee:allocation','supplier:tax','supplier:contract'].includes(f.key)).map(f=><div key={f.key}><dt>{f.label}</dt><dd>{value(f.value)} {f.unit}</dd></div>)}</dl>{group.pending.length?<p>Observação: {group.pending.join(', ')}.</p>:null}{plan.canPrepare?<div aria-label={'Valores comerciais · '+group.label}>{(group.key==='fees'?[['fixedFee','Honorário fixo (R$)','fee:fixed'],['feePercentage','Honorário variável (%)','fee:percentage']]:[['supplierPricePerMwh','Preço do fornecedor (R$/MWh)','supplier:price']]).map(([key,label,field])=><label key={key} style={{display:'block',margin:'8px 0'}}>{label}<input inputMode='decimal' disabled={busy||uncertain.current} value={manual[key]??String(group.fields.find(f=>f.key===field)?.value??'')} onChange={e=>setManual(v=>({...v,[key]:e.target.value.replace(',','.')}))}/></label>)}<p>Valores salvos nesta proposta auditada; não alteram vigência ou contratos.</p></div>:null}</article>)}{plan.canPrepare?<Button disabled={busy||uncertain.current} onClick={()=>void saveCommercial()}>Salvar valores comerciais da proposta</Button>:null}</section><aside aria-label='Resumo e recomendações da EVA'><h3>Resumo da EVA</h3><ul>{plan.simplified.summary.slice(0,3).map((note,i)=><li key={i}>{note}</li>)}</ul>{plan.simplified.summary.length>3?<details><summary>Considerações e referências da EVA</summary><ul>{plan.simplified.summary.slice(3).map((note,i)=><li key={i}>{note}</li>)}</ul></details>:null}<h4>Recomendações ao operador</h4>{plan.simplified.recommendations.length?<ul>{plan.simplified.recommendations.map((note,i)=><li key={i}>{note}</li>)}</ul>:<p>Confira as fontes e prossiga para a validação pelos controles existentes.</p>}{plan.simplified.missing.length?<details><summary>Dados não identificados nas fontes</summary><p>{plan.simplified.missing.join('; ')}. Não foram convertidos em zero.</p></details>:null}<p>Preparação proposta; nenhuma aprovação ou publicação financeira automática.</p></aside></>:null}
  {!plan.simplified&&!!observations.length&&<aside aria-label='Observação da EVA'><p><strong>Observação da EVA:</strong> {observations[0]} {observations.length>1?'Os demais pontos estão reunidos nos detalhes abaixo.':''}</p>{observations.length>1?<details><summary>Detalhes da observação</summary><ul>{observations.slice(1).map((note,i)=><li key={i}>{note}</li>)}</ul></details>:null}</aside>}
  <details open={sourcesOpen} onToggle={e=>setSourcesOpen(e.currentTarget.open)}><summary>Preenchimentos e resumo das fontes</summary><table><thead><tr><th>Campo</th><th>Valor</th><th>Origem</th></tr></thead><tbody>{plan.fields?.map(f=><tr key={f.key}><td>{f.label} · {f.scenario}</td><td>{value(f.value)} {f.unit}</td><td>{f.source||'Pendente'}</td></tr>)}</tbody></table></details>
  <div style={{display:'flex',gap:12,marginTop:16}}><Button disabled={busy||needsRecheck||(!plan.simplified&&!complete)} onClick={plan.operational?reviewProposal:onValidate}>{plan.operational?'Ver dados e fontes':plan.simplified?'Conferir resultado':'Abrir validação'}</Button>{plan.operational?<Button variant='secondary' disabled={busy||needsRecheck} onClick={onValidate}>Fechamento e validação financeira</Button>:null}<Button variant='secondary' disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Atualizar conferência</Button><Button variant='secondary' disabled={busy} onClick={()=>{setOpen(true);setSelected(null)}}>Histórico da preparação</Button></div>
  {open?<WorkflowModal title='Histórico da preparação automática' onClose={()=>setOpen(false)}>
   {!history?<p>Consultando histórico…</p>:<><ul>{history.rows.map(r=><li key={r.id}><button type='button' onClick={()=>setSelected(r)}>{new Date(r.created_at).toLocaleString('pt-BR')} · {r.state}</button></li>)}</ul><Button disabled={!page} onClick={()=>setPage(n=>n-1)}>Anterior</Button><span> Página {page+1} </span><Button disabled={(page+1)*10>=history.total} onClick={()=>setPage(n=>n+1)}>Próxima</Button></>}
   {selected?<><h3>Registro {selected.id}</h3><p>Autor: {selected.actor_id}</p><p>{selected.plan.percent}% dos campos preenchidos nesta proposta histórica.</p>{selected.events?.map(e=><div key={e.sequence}><p>{new Date(e.created_at).toLocaleString('pt-BR')} · {e.state}</p><ul>{e.receipts.map((r,i)=><li key={i}>{r.label} · {r.state}</li>)}</ul></div>)}</>:null}
  </WorkflowModal>:null}
 </Card>;
}
