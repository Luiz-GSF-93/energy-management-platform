'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button,Input} from '@/app/components/ui';
import {MapUnit,precisionLabels} from './map-data';
type Candidate={latitude:number;longitude:number;precision:keyof typeof precisionLabels;label:string};
type Job={id:string;status:string;candidates:Candidate[];errorCode:string|null;addressHash:string;revision:number};
type Result={organizationId:string;unitId:string;enabled:boolean;job:Job|null};
export default function GeocodingReview({unit,onConfirmed}:{unit:MapUnit;onConfirmed:()=>void}){
 const [result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[index,setIndex]=useState(0),[checked,setChecked]=useState(false),[reason,setReason]=useState(''),[requestId]=useState(()=>crypto.randomUUID());
 const alive=useRef(true),pending=useRef<AbortController|null>(null),path='/api/v1/energy-map/units/'+encodeURIComponent(unit.id)+'/geocoding';
 function validate(r:Result){if(r.organizationId!==unit.organizationId||r.unitId!==unit.id)throw Error('Atualize a organização selecionada.');return r;}
 useEffect(()=>{alive.current=true;const a=new AbortController();pending.current=a;apiRequest<Result>(path,{signal:a.signal,cache:'no-store'}).then(r=>{if(!a.signal.aborted)setResult(validate(r));}).catch(e=>{if(!a.signal.aborted)setError(e instanceof Error?e.message:'Consulta indisponível.');});return()=>{alive.current=false;pending.current?.abort();};},[path]);
 async function run(confirm=false){if(busy)return;setBusy(true);setError('');const a=new AbortController();pending.current=a;
  try{if(confirm){await apiRequest(path+'/confirmation',{method:'PUT',signal:a.signal,cache:'no-store',body:{jobId:result?.job?.id,index,reason,revision:result?.job?.revision,requestId,checkedAddress:checked,addressHash:result?.job?.addressHash}});if(alive.current&&!a.signal.aborted)onConfirmed();}
   else{const r=await apiRequest<Result>(path,{method:'POST',signal:a.signal,cache:'no-store',body:{addressHash:unit.addressHash}});if(alive.current&&!a.signal.aborted)setResult(validate(r));}
  }catch(e){if(alive.current&&!a.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível localizar a unidade.');}finally{if(alive.current&&!a.signal.aborted)setBusy(false);}
 }
 const job=result?.job;
 return <section aria-label="Localização pelo endereço"><h3>Localizar pelo endereço</h3><p>A consulta usa o endereço cadastrado. Confira a sugestão antes de publicá-la no mapa.</p>{error?<Alert variant="error">{error}</Alert>:null}
  {result&&!result.enabled?<p>Consulta automática ainda não habilitada nesta organização.</p>:null}
  {result?.enabled&&!job?<Button disabled={busy} onClick={()=>run()}>{busy?'Consultando endereço…':'Buscar localização'}</Button>:null}
  {job?.status==='PROCESSING'?<p role="status">Consulta em processamento. Atualize a unidade para conferir o resultado.</p>:null}
  {job&&['FAILED','STALE'].includes(job.status)?<Alert>{job.status==='STALE'?'O endereço ou a localização mudou. Atualize o cadastro e confira a unidade.':'Não foi possível obter uma localização segura. Use a conferência manual ou solicite suporte.'}</Alert>:null}
  {job?.status==='CONFIRMED'?<p>Localização já conferida. O histórico da unidade registra a alteração.</p>:null}
  {job?.status==='REVIEW'?<><fieldset disabled={busy}><legend>Sugestões para conferência</legend>{job.candidates.map((c,i)=><label key={i} style={{display:'block',margin:'12px 0'}}><input type="radio" name={'geocode-'+unit.id} checked={index===i} onChange={()=>{setIndex(i);setChecked(false);}}/> {c.label}<br/><small>{precisionLabels[c.precision]} · {c.latitude.toFixed(6)}, {c.longitude.toFixed(6)}</small></label>)}<Input label="Justificativa da conferência" value={reason} minLength={3} maxLength={490} onChange={e=>setReason(e.target.value)}/><label><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/> Conferi o endereço e a precisão da sugestão selecionada.</label></fieldset><Button disabled={busy||!checked||reason.trim().length<3||!job.candidates[index]} onClick={()=>run(true)}>{busy?'Salvando…':'Confirmar localização no mapa'}</Button></>:null}
 </section>;
}
