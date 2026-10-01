'use client';
import OcrElektroAudit,{type ElektroAudit} from './OcrElektroAudit';
import OcrHomologation from './OcrHomologation';
import OcrDemandReviews from './OcrDemandReviews';
import OcrIdentityPreview from './OcrIdentityPreview';
import OcrFieldReviews from './OcrFieldReviews';
import OcrLayoutEvidence,{type LayoutEvidence} from './OcrLayoutEvidence';
import OcrReadout,{type ReadoutSummary} from './OcrReadout';
import OcrGdEvidence,{type GdEvidence} from './OcrGdEvidence';
import {useEffect,useRef,useState} from 'react';
import OcrElectricalEvidence, {type ElectricalEvidence} from './OcrElectricalEvidence';
import {apiRequest} from '@/app/lib/api/client';
type Job={id:string;state:string;errorCode:string|null};
type Intake={elektroAudit?:ElektroAudit|null;layout?:LayoutEvidence;readoutSummary?:ReadoutSummary;gd?:GdEvidence;electrical?:ElectricalEvidence;decision:string;canImport:false;checkedAt:string;checks:{field:string;label:string;state:string;message:string;confidence:number|null;pages:number[]}[]};
type Status={enabled:boolean;job:Job|null;intake?:Intake|null};
const labels:Record<string,string>={QUEUED:'Na fila',SUBMITTING:'Enviando para leitura',POLLING:'Leitura em andamento',SUCCEEDED:'Extração recebida — aguarda conferência',FAILED:'Leitura interrompida',SUBMISSION_UNKNOWN:'Envio indeterminado — requer verificação administrativa'};
export default function OcrDocumentStatus({id,canProcess}:{id:string;canProcess:boolean}){
 const [status,setStatus]=useState<Status|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const active=useRef(true);const loading=useRef(false);
 useEffect(()=>{active.current=true;void load();return()=>{active.current=false;};},[id]);
 useEffect(()=>{if(!status?.job||!['QUEUED','SUBMITTING','POLLING'].includes(status.job.state))return;const timer=setInterval(()=>void load(),5000);return()=>clearInterval(timer);},[id,status?.job?.state]);
 async function load(){if(loading.current)return;loading.current=true;setBusy(true);setError('');try{const next=await apiRequest<Status>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr');if(active.current)setStatus(next);}catch{if(active.current)setError('Não foi possível consultar a leitura.');}finally{loading.current=false;if(active.current)setBusy(false);}}
 async function start(){if(busy)return;setBusy(true);setError('');try{const job=await apiRequest<Job>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr',{method:'POST'});if(active.current)setStatus({enabled:true,job});}catch{if(active.current)setError('Não foi possível iniciar a leitura. Consulte o status antes de tentar novamente. O arquivo permanece salvo.');}finally{if(active.current)setBusy(false);}}
 return <div style={{marginTop:8,maxWidth:320}}>
  {status&&<p role="status">{status.intake?.decision==='REJECT_AUTOMATION'?'Leitura bloqueada para automação':status.intake?'Conferência humana necessária':status.job?(labels[status.job.state]??'Situação indisponível'):status.enabled?'Disponível para leitura':'OCR em preparação — processamento desativado'}</p>}
  {status&&!status.enabled&&status.job&&<p>Novas leituras estão desativadas; o resultado permanece disponível.</p>}
  {error&&<p role="alert">{error}</p>}
  <button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Aguarde…':status?'Atualizar leitura':'Consultar leitura OCR'}</button>
  {canProcess&&status?.enabled&&!status.job&&<button type="button" disabled={busy} onClick={()=>void start()}>Iniciar leitura</button>}
  {status?.job?.state==='SUCCEEDED'&&<p>A leitura exige conferência. Consulte Acompanhar homologação para verificar a integração dos consumos e as demais pendências.</p>}
  {status?.intake&&<details><summary>Conferência da fatura — importação bloqueada</summary>
   <p>Comparação preservada com o cadastro da data da conferência. Não representa aprovação da fatura.</p>
   <p>Conferência registrada em {new Date(status.intake.checkedAt).toLocaleString('pt-BR')}.</p>
   <ul>{status.intake.checks.map(check=><li key={check.field}><strong>{check.label}: {check.state==='MATCH'?'Compatível':check.state==='MISMATCH'?'Divergente':'Conferir'}</strong><p>{check.message}</p>{check.confidence!==null&&<small>Confiança: {(check.confidence*100).toFixed(0)}%{check.pages.length?' · Página(s): '+check.pages.join(', '):''}</small>}</li>)}</ul>
  </details>}
  {status?.intake&&<OcrHomologation key={id} id={id}/>}
  {status?.intake&&<OcrIdentityPreview key={id} id={id}/>}
  {status?.intake?.readoutSummary&&<OcrReadout key={id} id={id} summary={status.intake.readoutSummary}/>}
  {status?.intake?.layout?.preparation&&<OcrFieldReviews key={id} id={id} canReview={canProcess}/>}
  {status?.intake?.layout?.preparation?.demand&&<OcrDemandReviews key={id} id={id} canReview={canProcess}/>}
  {status?.intake?.layout&&<OcrLayoutEvidence evidence={status.intake.layout} documentId={id}/>}
  {status?.intake?.elektroAudit&&<OcrElektroAudit evidence={status.intake.elektroAudit}/>}
  {status?.intake?.electrical&&<OcrElectricalEvidence evidence={status.intake.electrical}/>}
  {status?.intake?.gd&&<OcrGdEvidence evidence={status.intake.gd}/>}
 </div>;
}
