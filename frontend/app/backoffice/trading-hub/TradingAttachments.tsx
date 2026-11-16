'use client';
import {useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button} from '@/app/components/ui';
export default function TradingAttachments({proposal}:{proposal:{id:string;data:Record<string,any>}}){
 const [files,setFiles]=useState<{id:string;name:string}[]>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){if(files||busy)return;setBusy(true);try{setFiles(await apiRequest('/api/v1/trading-hub/records/'+proposal.id+'/attachments'));}catch{setError('Não foi possível consultar os anexos. Atualize para conferir.');}finally{setBusy(false);}}
 async function download(id:string){setError('');try{const result=await apiRequest<{url:string}>('/api/v1/trading-hub/files/'+encodeURIComponent(id));const a=document.createElement('a');a.href=result.url;a.rel='noopener noreferrer';a.click();}catch{setError('Anexo indisponível neste acesso.');}}
 const count=proposal.data.documents?.length??0;
 return <details onToggle={e=>{if(e.currentTarget.open&&count)void load();}}><summary>Anexos recebidos ({count})</summary>{error?<Alert variant="error">{error}<Button variant="secondary" disabled={busy} onClick={()=>{setError('');void load();}}>Atualizar anexos</Button></Alert>:null}{busy?<p>Consultando arquivos…</p>:null}{!count?<p>Nenhum anexo recebido nesta proposta.</p>:files?.map(f=><p key={f.id}>{f.name} <Button variant="secondary" onClick={()=>void download(f.id)}>Baixar anexo</Button></p>)}</details>;
}
