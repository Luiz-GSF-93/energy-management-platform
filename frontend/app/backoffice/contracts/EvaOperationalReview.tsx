'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Button} from '@/app/components/ui';

/** Same unit/competence context as the displayed report. No financial approval here. */
export default function EvaOperationalReview({unitId,month,row,onChanged}:{unitId:string;month:string;row:any;onChanged:()=>Promise<unknown>}){
 const [status,setStatus]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const query=new URLSearchParams({consumerUnitId:unitId,month}).toString();
 useEffect(()=>{let active=true;setError('');setStatus(null);setConfirmed(false);setReason('');void apiRequest<any>('/api/v1/eva-assisted-closing/flow/status?'+query).then(r=>{if(active)setStatus(r)}).catch(()=>{if(active)setError('Acompanhamento operacional indisponível. O relatório e as confirmações estão preservados.');});return()=>{active=false}},[query,row?.id,row?.payload_hash,row?.state]);
 if(status?.enabled!==true)return error?<p role='status'>{error}</p>:null;
 const review=status.review,matched=review?.closing_id===row?.id&&review?.closing_hash===row?.payload_hash;
 const submit=matched&&status.canPrepare&&['READY_OPERATOR','RETURNED'].includes(review.state)&&row?.report?.approvalEligible;
 const back=matched&&status.canManage&&review.state==='SUBMITTED';
 async function act(action:'submit'|'return'){
  if(busy||!confirmed||reason.trim().length<20)return;setBusy(true);setError('');
  try{await apiRequest('/api/v1/eva-assisted-closing/flow/'+action,{method:'POST',body:{consumerUnitId:unitId,month,closingId:row.id,hash:row.payload_hash,requestId:crypto.randomUUID(),reason:reason.trim(),confirmed:true}});await onChanged();const current=await apiRequest('/api/v1/eva-assisted-closing/flow/status?'+query);setStatus(current);setConfirmed(false);setReason('');}catch(e){setError(e instanceof Error?e.message:'Confirmação pendente. Consulte o protocolo antes de repetir.');}finally{setBusy(false)}
 }
 const label:Record<string,string>={REQUIRES_INPUT:'Conferir informações complementares',READY_OPERATOR:'Pronto para conferência do operador',SUBMITTED:'Enviado para aprovação do gestor',RETURNED:'Devolvido para ajuste',APPROVED:'Aprovado; consulte a divulgação no histórico'};
 return <section aria-label='Acompanhamento da proposta EVA' style={{border:'1px solid var(--color-border, #507594)',borderRadius:12,padding:16,marginBlock:16}}>
  <h3>Da conferência à aprovação</h3>
  <p role='status'>{matched?label[review.state]:'Acompanhamento será atualizado para esta versão da proposta.'}</p>
  {review?.id?<p>Protocolo: {review.id} · revisão {review.revision}</p>:null}
  {matched&&review.state==='RETURNED'?<p>Orientação do gestor: {review.return_reason}</p>:null}
  {submit||back?<><label>Justificativa da conferência<textarea value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} disabled={busy}/></label><p>Mínimo de 20 caracteres. A resposta fica registrada para esta versão.</p><label><input type='checkbox' checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>Conferi os valores, fontes e justificativas desta proposta.</label><div>{submit?<Button disabled={busy||!confirmed||reason.trim().length<20} onClick={()=>void act('submit')}>Conferi · enviar ao gestor</Button>:null}{back?<Button variant='secondary' disabled={busy||!confirmed||reason.trim().length<20} onClick={()=>void act('return')}>Devolver ao operador com orientação</Button>:null}</div></>:null}
  {matched&&review.state==='SUBMITTED'?<p>O gestor deve conferir esta versão e usar a decisão de aprovação abaixo. Enviar ao gestor não publica valores.</p>:null}
  {busy?<p role='status'>EVA · validando, aguarde…</p>:null}{error?<p role='alert'>{error}</p>:null}
 </section>;
}
