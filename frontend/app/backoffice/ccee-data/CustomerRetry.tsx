'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button} from '@/app/components/ui';
export default function CustomerRetry({organizationId,discoveryId,taxId,onReload}:{organizationId:string;discoveryId:string;taxId:string;onReload:()=>void}){
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),inFlight=useRef(false),intent=useRef<string|null>(null);
 useEffect(()=>{generation.current++;setReason('');setConfirmed(false);setBusy(false);setError('');intent.current=null;inFlight.current=false;return()=>{generation.current++;};},[organizationId,discoveryId]);
 async function submit(){if(inFlight.current||reason.trim().length<30||!confirmed)return;const n=generation.current;inFlight.current=true;setBusy(true);setError('');
  try{intent.current??=crypto.randomUUID();const v=await apiRequest<any>('/api/v1/ccee-data/customers/'+encodeURIComponent(discoveryId)+'/retry',{method:'POST',body:{reason,confirmed:true,requestId:intent.current}});
   if(n!==generation.current)return;if(v?.organizationId!==organizationId||v?.previousId!==discoveryId)throw Error('Resposta fora do cadastro autorizado.');onReload();
  }catch(e){if(n===generation.current)setError((e as Error).message);}finally{if(n===generation.current){inFlight.current=false;setBusy(false);}}
 }
 return <details><summary>Reconsultar CNPJ após revisão</summary><p>A tentativa anterior será preservada. Somente o CNPJ {taxId} será consultado novamente, dentro do orçamento existente. Não libera representação ou serviços privados. Se a coleta estiver pausada, o agendamento aguardará sua retomada.</p>{error&&<Alert variant="error">{error}</Alert>}<form onSubmit={e=>{e.preventDefault();void submit();}} style={{display:'grid',gap:8}}><label>Justificativa da reconsulta<textarea required minLength={30} maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);intent.current=null;}} disabled={busy}/></label><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/> Conferi o diagnóstico e autorizo uma nova consulta deste mesmo CNPJ, sem liberação de serviços privados.</label><Button type="submit" disabled={busy||reason.trim().length<30||!confirmed}>{busy?'Registrando revisão…':'Agendar reconsulta auditada'}</Button></form></details>;
}
