'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {createOperationalRefresh} from '../../lib/read-only-refresh';
export type ManualJob={id:string;state:'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'UNKNOWN';consumerUnitId:string;customerId:string;month:string;scopeKind:'UNIT'|'CUSTOMER';closingId:string|null;errorCode?:string|null;heartbeatAt?:string|null;updatedAt:string};
export type ManualQueue={enabled:boolean;available:boolean;accepting?:boolean;job:ManualJob|null};
export const manualPreparationBlocks=(q?:ManualQueue)=>!!q?.enabled&&(!q.available||!!q.job&&['QUEUED','RUNNING','UNKNOWN'].includes(q.job.state));
export function validManualJob(job:ManualJob,scope:{consumerUnitId:string;customerId:string;month:string;scopeKind:string}){
 return !!job&&typeof job.id==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(job.id)&&job.customerId===scope.customerId&&job.month===scope.month&&job.scopeKind===scope.scopeKind&&(scope.scopeKind==='CUSTOMER'||job.consumerUnitId===scope.consumerUnitId)&&['QUEUED','RUNNING','SUCCEEDED','FAILED','UNKNOWN'].includes(job.state);
}
export default function ManualPreparationStatus({queue,scope,canReconcile,onUpdate,onComplete,onDenied}:{queue:ManualQueue;scope:{consumerUnitId:string;customerId:string;month:string;scopeKind:'UNIT'|'CUSTOMER'};canReconcile:boolean;onUpdate:(q:ManualQueue)=>void;onComplete:()=>Promise<unknown>;onDenied:()=>void}){
 const [error,setError]=useState(''),[checking,setChecking]=useState(false),[reason,setReason]=useState(''),[ack,setAck]=useState(false),[saving,setSaving]=useState(false);
 const callbacks=useRef({onUpdate,onComplete,onDenied});callbacks.current={onUpdate,onComplete,onDenied};
 const refresh=useRef<(()=>void)|null>(null),completed=useRef('');
 const job=queue.job,query=new URLSearchParams({consumerUnitId:scope.consumerUnitId,month:scope.month,scopeKind:scope.scopeKind,...(job?{jobId:job.id}:{})}).toString();
 useEffect(()=>{
  if(!queue.enabled||!job||!['QUEUED','RUNNING','UNKNOWN'].includes(job.state))return;
  let live=true;
  const loop=createOperationalRefresh<ManualQueue>({intervalMs:5000,canRead:()=>document.visibilityState==='visible'&&navigator.onLine!==false,
   read:signal=>apiRequest<ManualQueue>('/api/v1/eva-assisted-closing/preparation-requests?'+query,{cache:'no-store',signal}),
   result:r=>{if(!live)return;if(!r.enabled||!r.available||!r.job||!validManualJob(r.job,scope)||r.job.id!==job.id)throw Error('Preparation status outside scope');setError('');callbacks.current.onUpdate(r);if(r.job.state==='SUCCEEDED'&&completed.current!==r.job.id){completed.current=r.job.id;void callbacks.current.onComplete().catch(()=>{if(live)setError('A preparação foi registrada. Atualize o histórico para conferir a proposta.');});}},
   error:e=>{if(!live)return;if([401,403].includes((e as {status?:number})?.status??0))callbacks.current.onDenied();setError('Não foi possível consultar o protocolo. Ele permanece preservado; não inicie outra preparação para repetir esta solicitação.');},
   state:s=>{if(live)setChecking(s.mode==='updating');},
  });refresh.current=loop.refresh;
  document.addEventListener('visibilitychange',loop.refresh);window.addEventListener('online',loop.refresh);
  return()=>{live=false;refresh.current=null;loop.stop();document.removeEventListener('visibilitychange',loop.refresh);window.removeEventListener('online',loop.refresh);};
 },[queue.enabled,job?.id,job?.state,query]);
 async function reconcile(){
  if(saving||!job||!canReconcile||!ack||reason.trim().length<20)return;setSaving(true);setError('');
  try{const r=await apiRequest<ManualQueue>('/api/v1/eva-assisted-closing/preparation-requests/reconcile',{method:'POST',body:{consumerUnitId:scope.consumerUnitId,month:scope.month,scopeKind:scope.scopeKind,jobId:job.id,reason:reason.trim(),confirmed:true}});if(!r.job||!validManualJob(r.job,scope)||r.job.id!==job.id)throw Error('invalid result');callbacks.current.onUpdate(r);setAck(false);setReason('');}
  catch{setError('A reconferência não foi confirmada. Se houver gravações financeiras incertas, confira o histórico antes de retomar. O protocolo foi preservado.');}
  finally{setSaving(false);}
 }
 async function consult(){if(refresh.current){refresh.current();return;}if(checking)return;setChecking(true);setError('');try{await callbacks.current.onComplete();}catch{setError('Não foi possível atualizar o histórico. Preserve o protocolo e consulte novamente.');}finally{setChecking(false);}}
 if(!queue.enabled)return null;
 const messages={QUEUED:job?.errorCode==='PREPARATION_SLOT_BUSY'?'Outra preparação desta competência está em andamento. Sua solicitação aguarda na fila.':'Solicitação recebida e preservada na fila.',RUNNING:'A EVA está preparando as fontes e os cálculos em segundo plano.',SUCCEEDED:'Preparação registrada. Confira a proposta e as informações complementares no relatório.',FAILED:'A preparação não foi iniciada. Confira o acesso e as fontes antes de solicitar novamente.',UNKNOWN:'O resultado precisa de reconferência técnica. Nenhuma preparação será repetida automaticamente.'};
 return <section aria-label="Preparação em segundo plano" style={{border:'1px solid #3bbfc6',borderRadius:12,padding:16,margin:'16px 0'}}>
  <h3>Preparação em segundo plano</h3>
  {!queue.available?<p role="status">O andamento da fila não foi confirmado. As propostas e solicitações anteriores foram preservadas; atualize antes de iniciar outra preparação.</p>:job?<><p role="status">{messages[job.state]}</p><p>Protocolo: {job.id}</p>{['QUEUED','RUNNING'].includes(job.state)&&<p>Você pode fechar esta conferência e continuar trabalhando. Ao voltar, o andamento será recuperado pelo mesmo protocolo. Isso não aprova nem publica valores.</p>}<small>Atualização do protocolo: {new Date(job.updatedAt).toLocaleString('pt-BR')}</small></>:<p>Ao preparar, a solicitação ficará registrada e a EVA continuará o trabalho sem prender esta tela.</p>}
  {queue.accepting===false&&<p>Novas solicitações estão pausadas. As preparações já recebidas continuam disponíveis para acompanhamento.</p>}
  {job?.state==='RUNNING'&&job.heartbeatAt&&Number.isFinite(Date.parse(job.heartbeatAt))&&<p>Último contato do processador: {new Date(job.heartbeatAt).toLocaleString('pt-BR')}. Isso confirma o acompanhamento, não a conclusão dos cálculos.</p>}
  <p><button type="button" disabled={checking||saving} onClick={()=>void consult()}>{checking?'Consultando protocolo…':'Consultar andamento da preparação'}</button></p>
  {error&&<p role="alert">{error}</p>}
  {job?.state==='UNKNOWN'&&canReconcile&&<details><summary>Reconferir protocolo com histórico preservado</summary><p>Somente gravações com resultado comprovado podem ser retomadas. A reconferência não aprova valores financeiros.</p><label>Justificativa da reconferência<textarea className="ds-input" value={reason} disabled={saving} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label><label><input type="checkbox" checked={ack} disabled={saving} onChange={e=>setAck(e.target.checked)}/>Conferi o histórico deste protocolo e solicito a retomada das fontes existentes.</label><p><button type="button" disabled={saving||!ack||reason.trim().length<20} onClick={()=>void reconcile()}>Reconferir e retomar o protocolo</button></p></details>}
 </section>;
}
