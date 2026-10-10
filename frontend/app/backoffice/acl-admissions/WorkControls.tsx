'use client';
import AuditIdentity,{type Identity} from '../../components/AuditIdentity';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '@/app/lib/api/client';
import { Alert, Button } from '@/app/components/ui';
export type WorkDetail={id:string;status:string;revision:number;generation?:number;previousId?:string;stages:{key:string;status:string;elapsedMs:number;evidenceRef?:string;active?:{authorIdentity?:Identity|null;actorId:string;actorName:string;startedAt:number}}[]};
type WorkBody={requestId:string;expectedRevision:number;stageKey:string;action:'START'|'PAUSE'|'RESUME';pauseReason?:string;reason?:string};
const names:Record<string,string>={registration:'Cadastro',invoices:'Faturas',feasibility:'Viabilidade',modality:'Modalidade',contracts:'Contratação',termination:'Denúncia',metering:'Medição',custody:'Conta e adesão',technical:'Habilitação técnica','contract-registration':'Registro de contratos',validation:'Validação',supply:'Início do suprimento'};
const states:Record<string,string>={NOT_STARTED:'Não iniciada',RUNNING:'Em atividade',PAUSED:'Pausada',COMPLETED:'Concluída',SKIPPED:'Dispensada'};
export default function WorkControls({detail,actorId,canWork,onUpdated,fixedStageKey,onTimeConfirmed}:{detail:WorkDetail;actorId:string;canWork:boolean;onUpdated:(v:WorkDetail)=>void;fixedStageKey?:string;onTimeConfirmed?:(key:string,ms:number)=>void}){
 const [stageKey,setStageKey]=useState(fixedStageKey||detail.stages[0]?.key||''),[pauseReason,setPauseReason]=useState('AWAITING_CUSTOMER'),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmedAt,setConfirmedAt]=useState<string|null>(null),[stopped,setStopped]=useState(false),[retry,setRetry]=useState(false);
 const pending=useRef<WorkBody|null>(null),alive=useRef(true),sending=useRef(false);
 const [confirmationCycle,setConfirmationCycle]=useState(0);
 const clockCallback=useRef(onTimeConfirmed);clockCallback.current=onTimeConfirmed;
 useEffect(()=>{if(fixedStageKey)setStageKey(fixedStageKey);},[fixedStageKey]);
 const own=detail.stages.find(s=>s.status==='RUNNING'&&s.active?.actorId===actorId),selected=detail.stages.find(s=>s.key===stageKey);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  setConfirmedAt(null);setStopped(false);if(!canWork||!own)return;
  const abort=new AbortController();let flight=false;
  async function ping(){if(abort.signal.aborted||flight||sending.current||document.visibilityState!=='visible')return;flight=true;
   try{const v=await apiRequest<{confirmedAt:string;revision:number}>('/api/v1/acl-admissions/'+encodeURIComponent(detail.id)+'/heartbeat',{method:'POST',body:{stageKey:own!.key},signal:abort.signal});
    if(!abort.signal.aborted){setConfirmedAt(v.confirmedAt);clockCallback.current?.(own!.key,own!.elapsedMs+Math.max(0,Date.parse(v.confirmedAt)-(own!.active?.startedAt||0)));}
   }catch(e){if(!abort.signal.aborted){abort.abort();setStopped(true);setError(e instanceof Error?e.message:'Não foi possível confirmar a atividade. Atualize o processo.');}}
   finally{flight=false;}}
  void ping();const interval=setInterval(()=>void ping(),20000);const visible=()=>void ping();document.addEventListener('visibilitychange',visible);
  return()=>{abort.abort();clearInterval(interval);document.removeEventListener('visibilitychange',visible);};
 },[detail.id,own?.key,own?.active?.startedAt,actorId,canWork,confirmationCycle]);
 async function refresh(){if(sending.current)return;sending.current=true;setBusy(true);setError('');
  try{const row=await apiRequest<WorkDetail>('/api/v1/acl-admissions/'+encodeURIComponent(detail.id));if(alive.current){pending.current=null;setRetry(false);setStopped(false);setConfirmationCycle(v=>v+1);onUpdated(row);}}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'Não foi possível atualizar a atividade.');}
  finally{sending.current=false;if(alive.current)setBusy(false);}}
 async function command(action:WorkBody['action'],reuse=false){if(sending.current||!canWork||!selected)return;
  const body=reuse?pending.current:{requestId:crypto.randomUUID(),expectedRevision:detail.revision,stageKey,action,
   ...(action==='PAUSE'?{pauseReason,...(pauseReason==='OTHER'?{reason:reason.trim()}: {})}:{})};if(!body)return;
  pending.current=body;sending.current=true;setBusy(true);setError('');setRetry(false);
  try{const row=await apiRequest<WorkDetail>('/api/v1/acl-admissions/'+encodeURIComponent(detail.id)+'/work',{method:'POST',body});
   if(alive.current){pending.current=null;setRetry(false);setReason('');onUpdated(row);}}
  catch(e){if(alive.current){setError(e instanceof Error?e.message:'Não foi possível confirmar o comando.');
   if(e instanceof ApiError&&e.status<500){pending.current=null;setStopped(e.status===409);}else setRetry(true);}}
  finally{sending.current=false;if(alive.current)setBusy(false);}}
 const ms=own?own.elapsedMs+(confirmedAt?Math.max(0,Date.parse(confirmedAt)-(own.active?.startedAt||0)):0):0;
 return <section aria-label="Atividade operacional"><h3>Atividade operacional</h3>
 {error?<Alert>{error}</Alert>:null}
 {own?<p role="status">Sua atividade: {names[own.key]||own.key} · Tempo confirmado: {Math.floor(ms/60000)} min{confirmedAt?' · Última confirmação: '+new Date(confirmedAt).toLocaleTimeString('pt-BR'):''}</p>:null}
 <p>O tempo é confirmado pelo servidor. Uma interrupção exige atualizar e retomar a atividade. Etapas pausadas permanecem bloqueadas para edição.</p>
 <div hidden={!!fixedStageKey}><label htmlFor="acl-work-stage">Etapa</label><select id="acl-work-stage" value={stageKey} disabled={busy||retry} onChange={e=>setStageKey(e.target.value)}>{detail.stages.map(s=><option key={s.key} value={s.key}>{names[s.key]||s.key} — {states[s.status]||s.status}</option>)}</select></div>
 {canWork&&detail.status!=='COMPLETED'?<>
 {selected?.status==='NOT_STARTED'?<Button disabled={busy||retry||stopped||!!own} onClick={()=>void command('START')}>Iniciar atividade</Button>:null}
 {selected?.status==='PAUSED'?<Button disabled={busy||retry||stopped||!!own} onClick={()=>void command('RESUME')}>Retomar atividade</Button>:null}
 {selected?.status==='RUNNING'&&selected.active?.actorId===actorId?<><label htmlFor="acl-pause-reason">Motivo da pausa</label><select id="acl-pause-reason" value={pauseReason} disabled={busy||retry} onChange={e=>setPauseReason(e.target.value)}><option value="AWAITING_CUSTOMER">Aguardando cliente</option><option value="ENDING_ACTIVITY">Encerrando atividade</option><option value="OTHER">Outro</option></select>
 {pauseReason==='OTHER'?<><label htmlFor="acl-pause-note">Justificativa</label><textarea id="acl-pause-note" value={reason} maxLength={500} disabled={busy||retry} onChange={e=>setReason(e.target.value)}/></>:null}
 <Button disabled={busy||retry||stopped||pauseReason==='OTHER'&&reason.trim().length<10} onClick={()=>void command('PAUSE')}>Pausar atividade</Button></>:null}
 {selected?.status==='RUNNING'&&selected.active?.actorId!==actorId?<AuditIdentity title="Responsável pela atividade" identity={selected.active?.authorIdentity} id={selected.active?.actorId}/>:null}
 </>:null}
 {retry?<Button disabled={busy} onClick={()=>void command(pending.current!.action,true)}>Repetir o mesmo comando</Button>:null}
 <Button variant="secondary" disabled={busy} onClick={()=>void refresh()}>Atualizar processo</Button>
 </section>;
}
