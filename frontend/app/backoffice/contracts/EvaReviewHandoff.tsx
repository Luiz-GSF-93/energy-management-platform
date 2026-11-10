'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Button} from '@/app/components/ui';
export default function EvaReviewHandoff({row,onChanged,onStage}:{row:any;onChanged:()=>Promise<unknown>;onStage:(stage:string)=>void}){
 const [status,setStatus]=useState<any>(null),[error,setError]=useState(''),[reason,setReason]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const query='/api/v1/eva-assisted-closing/review-queue/status?closingId='+row.id;
 async function load(){const r=await apiRequest<any>(query);setStatus(r);onStage(r.row?.stage??'');return r;}
 useEffect(()=>{let live=true;apiRequest<any>(query).then(r=>{if(live){setStatus(r);onStage(r.row?.stage??'')}}).catch(()=>{if(live)setError('Não foi possível consultar o encaminhamento desta proposta.');});return()=>{live=false}},[query,row.payload_hash]);
 async function act(action:'submit'|'return'){
  if(busy||uncertain||!ack||reason.trim().length<20)return;setBusy(true);setError('');
  try{await apiRequest('/api/v1/eva-assisted-closing/review-queue/'+action,{method:'POST',body:{closingId:row.id,hash:row.payload_hash,requestId:crypto.randomUUID(),reason:reason.trim(),confirmed:true}});await load();setAck(false);setReason('');window.dispatchEvent(new Event('operations-updated'));window.dispatchEvent(new Event('portal-updated'));await onChanged();}
  catch(e){setUncertain(true);setError(e instanceof Error?e.message:'Resultado não confirmado. A proposta foi preservada.');try{await onChanged();}catch{/* Keep the uncertain handoff visible without another write. */}}
  finally{setBusy(false)}
 }
 const current=status?.row,matched=current?.id===row.id&&current.hash===row.payload_hash,submit=matched&&status.canSubmit&&current.approvalEligible&&['OPERATOR','RETURNED'].includes(current.stage),back=matched&&status.canManage&&current.stage==='APPROVAL';
 if(status&&!status.enabled)return null;
 return <section className='ds-card' aria-label='Conferência do operador e envio ao gestor'><h3>Conferência do operador → aprovação do gestor</h3>{matched&&current.stage==='APPROVAL'?<p role='status'>Enviado para aprovação. O gestor ou administrador recebe aviso na tela e notificação. Enviar não publica valores.</p>:<p>Confira os campos preenchidos pela EVA. Conclua as informações necessárias e envie esta versão para aprovação.</p>}{current?.returnReason&&<p>Orientação do gestor: {current.returnReason}</p>}
 {submit||back?<><label>Justificativa da conferência<textarea className='ds-input' value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} disabled={busy||uncertain}/></label><label><input type='checkbox' checked={ack} onChange={e=>setAck(e.target.checked)} disabled={busy||uncertain}/>Conferi os valores, fontes e justificativas desta versão.</label><Button disabled={busy||uncertain||!ack||reason.trim().length<20} onClick={()=>void act(submit?'submit':'return')}>{submit?'Validar conferência e enviar para aprovação':'Devolver ao operador com orientação'}</Button></>:null}
 {error&&<p role='alert'>{error}</p>}{uncertain&&<Button variant='secondary' onClick={()=>void load().then(()=>{setUncertain(false);setAck(false);setError('');}).catch(()=>setError('Ainda não foi possível confirmar o encaminhamento. Nenhum envio foi repetido.'))}>Conferir protocolo preservado</Button>}{busy&&<p role='status'>EVA · conferindo e encaminhando…</p>}</section>;
}
