'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Button} from '@/app/components/ui';

/** Monthly premise, separate from costs evidenced by a CCEE statement. */
export default function CceeEstimateProposal({unitId,month,onSaved,onDirty}:{unitId:string;month:string;onSaved:()=>Promise<void>;onDirty:(v:boolean)=>void}){
 const [open,setOpen]=useState(false),[plan,setPlan]=useState<any>(null),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const active=useRef(true),working=useRef(false);useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
 useEffect(()=>{if(!open)return;let live=true;setBusy(true);void apiRequest<any>('/api/v1/calculation-autofill?'+new URLSearchParams({consumerUnitId:unitId,month})).then(p=>{if(!live)return;setPlan(p);setAmount(p.manualOverrides?.cceeEstimate?.amount??p.cceeEstimate?.total??'');setReason(p.manualOverrides?.cceeEstimate?.reason??'');}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setBusy(false)});return()=>{live=false}},[open,unitId,month]);
 async function save(){
  if(working.current||busy||uncertain||!plan?.canPrepare||!ack||reason.trim().length<20)return;
  working.current=true;setBusy(true);setError('');let sent=false;
  try{
   const manual={...plan.manualOverrides,cceeEstimate:{amount:amount.replace(',','.'),reason:reason.trim(),confirmed:true}},body={consumerUnitId:unitId,month,manual};
   const preview=await apiRequest<any>('/api/v1/calculation-autofill/preview',{method:'POST',body});
   if(!active.current)return;
   if(!preview.canPrepare||!preview.token||preview.unitId!==unitId||preview.month!==month||preview.cceeEstimate?.state!=='ESTIMATED'||preview.cceeEstimate?.method!=='OPERATOR_DEFINED')throw Error('Há uma fonte atual ou alteração na competência. Confira os registros antes de estimar.');
   sent=true;
   const result=await apiRequest<any>('/api/v1/calculation-autofill',{method:'POST',body:{...body,token:preview.token,requestId:crypto.randomUUID()}});
   if(!active.current)return;
   if(!['PREPARED','PARTIAL'].includes(result.run?.state)||result.current?.unitId!==unitId||result.current?.month!==month)throw Error('Resultado ainda não confirmado; confira o histórico antes de repetir.');
   onDirty(false);await onSaved();
  }catch(e){if(active.current){if(sent)setUncertain(true);setError(e instanceof Error?e.message:'Estimativa não confirmada.');}}
  finally{working.current=false;if(active.current)setBusy(false)}
 }
 return <section aria-label='Estimativa CCEE informada pelo operador'><h4>CCEE · fechar a proposta com estimativa</h4><p>Use um valor e uma justificativa para esta unidade e competência. A estimativa permanece identificada no relatório e no portal após aprovação; não é extrato nem custo liquidado.</p>{!open?<Button onClick={()=>setOpen(true)}>Preparar estimativa CCEE</Button>:<>{error?<p role='alert'>{error}</p>:null}{busy?<p role='status'>Conferindo a estimativa e as fontes…</p>:null}{plan?.cceeEstimate?.state==='CURRENT_RECORD'?<p>Há registro ou declaração atual de custos. Confira essa fonte; ela será preservada.</p>:<fieldset disabled={busy||uncertain} style={{border:0,padding:0}}><label>Valor mensal estimado CCEE (R$)<input className='ds-input' value={amount} onChange={e=>{setAmount(e.target.value);setAck(false);onDirty(true)}} inputMode='decimal'/></label><label>Justificativa da estimativa CCEE<textarea className='ds-input' value={reason} minLength={20} maxLength={1000} onChange={e=>{setReason(e.target.value);setAck(false);onDirty(true)}}/></label><label><input type='checkbox' checked={ack} onChange={e=>setAck(e.target.checked)}/> Conferi o valor provisório e sua justificativa. A aprovação financeira continua separada.</label><Button disabled={!plan?.canPrepare||!ack||reason.trim().length<20||!/^(0|[1-9][0-9]{0,8})([.,][0-9]{1,2})?$/.test(amount)} onClick={()=>void save()}>Salvar estimativa e atualizar proposta</Button></fieldset>}{uncertain?<p>Confira o histórico comercial antes de repetir; a solicitação pode ter sido registrada.</p>:null}</>}</section>;
}
