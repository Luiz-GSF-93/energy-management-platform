'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
type Job={id:string;state:string;errorCode:string|null};
type Intake={decision:string;canImport:false;checkedAt:string;checks:{field:string;label:string;state:string;message:string;confidence:number|null;pages:number[]}[]};
type Status={enabled:boolean;job:Job|null;intake?:Intake|null};
const labels:Record<string,string>={QUEUED:'Na fila',SUBMITTING:'Enviando para leitura',POLLING:'Leitura em andamento',SUCCEEDED:'Extração recebida — aguarda conferência',FAILED:'Leitura interrompida',SUBMISSION_UNKNOWN:'Envio indeterminado — requer verificação administrativa'};
export default function OcrDocumentStatus({id,canProcess}:{id:string;canProcess:boolean}){
 const [status,setStatus]=useState<Status|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 async function load(){setBusy(true);setError('');try{const next=await apiRequest<Status>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr');if(active.current)setStatus(next);}catch{if(active.current)setError('Não foi possível consultar a leitura.');}finally{if(active.current)setBusy(false);}}
 async function start(){if(busy)return;setBusy(true);setError('');try{const job=await apiRequest<Job>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr',{method:'POST'});if(active.current)setStatus({enabled:true,job});}catch{if(active.current)setError('Não foi possível iniciar a leitura. Consulte o status antes de tentar novamente. O arquivo permanece salvo.');}finally{if(active.current)setBusy(false);}}
 return <div style={{marginTop:8,maxWidth:320}}>
  {status&&<p role="status">{status.job?(labels[status.job.state]??'Situação indisponível'):status.enabled?'Disponível para leitura':'OCR em preparação — processamento desativado'}</p>}
  {error&&<p role="alert">{error}</p>}
  <button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Aguarde…':status?'Atualizar leitura':'Consultar leitura OCR'}</button>
  {canProcess&&status?.enabled&&!status.job&&<button type="button" disabled={busy} onClick={()=>void start()}>Iniciar leitura</button>}
  {status?.job?.state==='SUCCEEDED'&&<p>A extração ainda não altera medições, tarifas ou resultados financeiros.</p>}
  {status?.intake&&<details><summary>Conferência da fatura — importação bloqueada</summary>
   <p>Comparação com o cadastro atual. Não representa aprovação da fatura.</p>
   <ul>{status.intake.checks.map(check=><li key={check.field}><strong>{check.label}: {check.state==='MATCH'?'Compatível':check.state==='MISMATCH'?'Divergente':'Conferir'}</strong><p>{check.message}</p>{check.confidence!==null&&<small>Confiança: {(check.confidence*100).toFixed(0)}%{check.pages.length?' · Página(s): '+check.pages.join(', '):''}</small>}</li>)}</ul>
  </details>}
 </div>;
}
