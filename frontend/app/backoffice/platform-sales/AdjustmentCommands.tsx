'use client';
import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Card,Input} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
type Event={version:number;state:string;phase:string;actor_id:string;actor_name:string|null;current_actor_name?:string|null;created_at:string;diagnostic?:string;justification:string};
type Command={id:string;kind:string;remote_id:string;parameters:{amountCents?:number};evidence:{payments?:{id:string;dueDate:string;grossCents:number;affectedByRemoval:boolean}[]};latest:Event;events:Event[]};
type Data={canWrite:boolean;externalCallsEnabled:boolean;commands:Command[];total:number};
type Check={id:string;request_version:number;latest:{state:string;created_at:string}};
const base='/api/v1/admin/sales/adjustment-commands-sandbox';
const labels:Record<string,string>={PREPARED:'Comando preparado',AUTHORIZED:'Autorizado internamente',PRECHECK:'Pré-conferência em andamento',DISPATCHED:'Envio iniciado; conferir resultado',PENDING_VERIFICATION:'Aguardando conferência externa',INDETERMINATE:'Resultado indeterminado; não reenviar',BLOCKED:'Comando bloqueado antes do envio',CONFIRMED_EXTERNAL:'Resultado confirmado externamente',WITHDRAWN:'Preparação retirada internamente'};
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
export default function AdjustmentCommands({requestId,version,eligible}:{requestId:string;version:number;eligible:boolean}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Data|null>(null),[checks,setChecks]=useState<Check[]>([]),[checkId,setCheckId]=useState(''),[page,setPage]=useState(0),[note,setNote]=useState(''),[accepted,setAccepted]=useState<Record<string,boolean>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const generation=useRef(0),pending=useRef<{key:string;id:string;operationId:string}|null>(null);
 useEffect(()=>{if(!open)return;const token=++generation.current;setData(null);setError('');setCheckId('');setChecks([]);setAccepted({});
  apiRequest<Data>(base+'/'+requestId+'?page='+page).then(r=>{if(token!==generation.current)return;setData(r);if(r.canWrite&&eligible)void apiRequest<{checks:Check[]}>('/api/v1/admin/sales/adjustment-checks-sandbox/'+requestId+'?page=0').then(x=>{if(token===generation.current)setChecks(x.checks.filter(c=>c.request_version===version&&c.latest.state==='COMPATIBLE'&&Date.now()-new Date(c.latest.created_at).getTime()<300000));}).catch(()=>{if(token===generation.current)setError('Não foi possível conferir as pré-validações.');});}).catch(()=>{if(token===generation.current)setError('Comandos desligados ou indisponíveis.');});
  return()=>{generation.current++;};
 },[open,requestId,version,eligible,page,reload]);
 const act=async(action:string,c?:Command)=>{
  if(busy||!data?.canWrite||note.trim().length<20)return;
  if(action==='execute'&&!window.confirm('Executar este comando uma única vez no Asaas sandbox? Confira o alvo e todos os impactos preservados.'))return;
  const key=JSON.stringify({action,id:c?.id,version:c?.latest.version,requestId,requestVersion:version,checkId,note});
  if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID(),operationId:crypto.randomUUID()};
  const token=generation.current;setBusy(true);setError('');
  try{const body=action==='prepare'?{id:pending.current.id,operationId:pending.current.operationId,expectedVersion:version,checkId,justification:note}:{operationId:pending.current.operationId,expectedVersion:c!.latest.version,justification:note,...(action==='authorize'?{impactsAccepted:accepted[c!.id]===true}:{})};
   await apiRequest(base+'/'+(c?.id??requestId)+'/'+action,{method:'POST',body});pending.current=null;
   if(token===generation.current)setNote('');
  }catch{if(token===generation.current)setError('Comando bloqueado ou resultado pendente. Atualize e confira o histórico; não repita o envio externo.');}
  finally{if(token===generation.current){setBusy(false);setReload(x=>x+1);}}
 };
 return <details style={{marginTop:20}} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Comandos controlados · sandbox</summary>
  <p>Cancelamento de recorrência e estorno têm fluxos separados. Não encerram contratos nem alteram licenças. Resultado indeterminado exige conferência; nunca reenvio automático.</p>
  {error?<Alert>{error}</Alert>:null}{data?<><p>Chamadas externas: {data.externalCallsEnabled?'habilitadas somente em sandbox':'desligadas'}.</p>
  {data.canWrite?<><Input label="Justificativa do comando" value={note} minLength={20} maxLength={500} onChange={e=>setNote(e.target.value)}/>
   {eligible?<><label>Pré-validação compatível e recente<select value={checkId} onChange={e=>setCheckId(e.target.value)} style={{width:'100%',padding:12,marginBottom:12}}><option value="">Selecione a consulta</option>{checks.map(c=><option key={c.id} value={c.id}>{new Date(c.latest.created_at).toLocaleString('pt-BR')} · {c.id}</option>)}</select></label><Button variant="secondary" disabled={busy||!checkId||note.trim().length<20} onClick={()=>void act('prepare')}>Preparar comando privado</Button></>:<p>Preparação bloqueada até a conferência interna do pedido e uma pré-validação compatível.</p>}</>:<p>Acesso somente de consulta.</p>}
  {data.commands.map(c=><Card key={c.id} title={labels[c.latest.state]??c.latest.state}><p>{c.kind==='REFUND_PAYMENT'?'Estorno da cobrança':'Remoção da assinatura'} · {c.remote_id}<br/>Comando {c.id}</p>
   {c.parameters.amountCents!==undefined?<Alert>Valor solicitado: {money(c.parameters.amountCents)}. Aceite do pedido não comprova devolução.</Alert>:<Alert>Remover a assinatura encerra novas cobranças e exclui as cobranças pendentes ou vencidas vinculadas. Isso não devolve valores pagos.</Alert>}
   <details><summary>Memória dos impactos</summary>{c.evidence.payments?.filter(p=>p.affectedByRemoval).map(p=><p key={p.id}>{p.id} · {p.dueDate} · {money(p.grossCents)} · poderia ser excluída</p>)}{c.evidence.payments&&!c.evidence.payments.some(p=>p.affectedByRemoval)?<p>Nenhuma cobrança afetada na enumeração preservada.</p>:null}</details>
   {data.canWrite?<>{c.latest.state==='PREPARED'?<><label style={{display:'block',marginTop:12}}><input type="checkbox" checked={accepted[c.id]??false} onChange={e=>setAccepted(x=>({...x,[c.id]:e.target.checked}))}/> Conferi alvo, valor e todos os impactos preservados deste comando.</label><Button variant="secondary" disabled={busy||!accepted[c.id]||note.trim().length<20} onClick={()=>void act('authorize',c)}>Autorizar internamente</Button></>:null}
   <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:12}}>{c.latest.state==='AUTHORIZED'?<Button disabled={busy||!data.externalCallsEnabled||note.trim().length<20} onClick={()=>void act('execute',c)}>Executar uma vez no sandbox</Button>:null}
   {['DISPATCHED','PENDING_VERIFICATION','INDETERMINATE'].includes(c.latest.state)?<Button variant="secondary" disabled={busy||!data.externalCallsEnabled||note.trim().length<20} onClick={()=>void act('recover',c)}>Conferir resultado por leitura</Button>:null}
   {['PREPARED','AUTHORIZED','PRECHECK','BLOCKED'].includes(c.latest.state)?<Button variant="secondary" disabled={busy||note.trim().length<20} onClick={()=>void act('withdraw',c)}>Retirar preparação</Button>:null}</div></>:null}
   <details><summary>Histórico preservado</summary>{c.events.map(e=><p key={e.version}>{labels[e.state]??e.state} · {new Date(e.created_at).toLocaleString('pt-BR')}<br/>{e.justification}{e.diagnostic?<><br/>Diagnóstico: {e.diagnostic}</>:null}<br/>Nome registrado: {e.actor_name||'Nome não disponível'}<br/>Nome atual: {e.current_actor_name||'Nome não disponível'}<br/>ID original: {e.actor_id}</p>)}</details>
  </Card>)}{!data.commands.length?<p>Nenhum comando registrado nesta solicitação.</p>:null}
  <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:16}}><Button variant="secondary" disabled={busy||page===0} onClick={()=>setPage(x=>x-1)}>Anterior</Button><span>Página {page+1} · {data.total} comandos</span><Button variant="secondary" disabled={busy||(page+1)*25>=data.total||page>=1000} onClick={()=>setPage(x=>x+1)}>Próxima</Button></div></>:null}
  <Button variant="secondary" disabled={busy} onClick={()=>setReload(x=>x+1)}>Atualizar comandos</Button>
 </details>;
}
