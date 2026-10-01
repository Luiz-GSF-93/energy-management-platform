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
 const [status,setStatus]=useState<Status|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [checkedAt,setCheckedAt]=useState<string|null>(null);const active=useRef(true);const loading=useRef(false);
 useEffect(()=>{active.current=true;void load();return()=>{active.current=false;};},[id]);
 useEffect(()=>{if(!status?.job||!['QUEUED','SUBMITTING','POLLING'].includes(status.job.state))return;const timer=setInterval(()=>void load(),5000);return()=>clearInterval(timer);},[id,status?.job?.state]);
 async function load(manual=false){if(loading.current)return;loading.current=true;setBusy(true);setError('');setNotice('');try{const next=await apiRequest<Status>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr');if(active.current){setStatus(next);setCheckedAt(new Date().toLocaleString('pt-BR'));if(manual)setNotice('Status atualizado com sucesso. A situação da leitura está indicada abaixo.');}}catch{if(active.current)setError('Não foi possível atualizar a leitura. Tente novamente. O status exibido é o da última consulta bem-sucedida.');}finally{loading.current=false;if(active.current)setBusy(false);}}
 async function start(){if(busy)return;setBusy(true);setError('');setNotice('');try{const job=await apiRequest<Job>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr',{method:'POST'});if(active.current){setStatus({enabled:true,job});setNotice('Solicitação de leitura recebida. Acompanhe o status abaixo.');setCheckedAt(new Date().toLocaleString('pt-BR'));}}catch{if(active.current)setError('Não foi possível iniciar a leitura. Consulte o status antes de tentar novamente. O arquivo permanece salvo.');}finally{if(active.current)setBusy(false);}}
 const needsAttention=status?.intake?.decision==='REJECT_AUTOMATION'||['FAILED','SUBMISSION_UNKNOWN'].includes(status?.job?.state??'');
 const statusColor=needsAttention?'#fca5a5':status?.intake?'#fcd34d':'#67e8f9';
 return <div style={{marginTop:8,maxWidth:320}}>
  <div role="status" aria-live="polite" aria-atomic="true">{notice&&<p style={{padding:10,border:'1px solid #4ade80',borderRadius:8,color:'#bbf7d0'}}><strong>✓ {notice}</strong></p>}</div>
  {status&&<div style={{border:'1px solid '+statusColor,borderRadius:8,padding:10,margin:'8px 0'}}>
   <strong style={{color:statusColor}}>Status da leitura: {status.job?(labels[status.job.state]??'Situação indisponível'):status.enabled?'Disponível para leitura':'Processamento desativado'}</strong>
   {status.intake&&<p style={{margin:'6px 0',color:statusColor}}><strong>{status.intake.decision==='REJECT_AUTOMATION'?'Atenção: integração automática bloqueada':'Validação pendente: conferência necessária'}</strong></p>}
   {checkedAt&&<small>Última consulta bem-sucedida: {checkedAt}</small>}
  </div>}
  {status&&!status.enabled&&status.job&&<p>Novas leituras estão desativadas; o resultado permanece disponível.</p>}
  {error&&<p role="alert">{error}</p>}
  <button type="button" disabled={busy} onClick={()=>void load(true)}>{busy?'Consultando status…':status?'Atualizar leitura':'Consultar leitura OCR'}</button>
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
