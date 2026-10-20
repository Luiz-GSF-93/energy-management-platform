'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
type Preview={enabled:boolean;eligible:boolean;token?:string;message?:string};
export default function OcrIdentityResume({id,onDone}:{id:string;onDone:()=>void}){
 const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[reason,setReason]=useState(''),[ack,setAck]=useState(false),[message,setMessage]=useState('');
 const generation=useRef(0),request=useRef<string|null>(null);
 useEffect(()=>{generation.current++;return()=>{generation.current++;};},[id]);
 async function inspect(){const g=generation.current;setBusy(true);setMessage('');setPreview(null);setAck(false);request.current=null;try{const p=await apiRequest<Preview>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/identity-resume');if(g===generation.current)setPreview(p);}catch{if(g===generation.current)setMessage('Não foi possível conferir a retomada. Atualize o status; nenhuma leitura foi iniciada.');}finally{if(g===generation.current)setBusy(false);}}
 async function resume(){if(busy||!preview?.eligible||!preview.token||!ack||reason.trim().length<20)return;const g=generation.current;setBusy(true);setMessage('');request.current??=crypto.randomUUID();try{await apiRequest('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/identity-resume',{method:'POST',body:{token:preview.token,requestId:request.current,reason:reason.trim(),acknowledge:true}});if(g===generation.current){setPreview(null);setAck(false);setMessage('Retomada registrada. Acompanhe a mesma fatura no status da leitura.');onDone();}}catch{if(g===generation.current){setPreview(null);setAck(false);setMessage('Retomada não confirmada. Atualize o status antes de tentar novamente; não reenvie a fatura.');}}finally{if(g===generation.current)setBusy(false);}}
 return <section aria-label="Retomada auditada da leitura" style={{marginTop:12,padding:12,border:'1px solid #5c7891',borderRadius:8}}>
  <p>Eu, EVA, posso reconferir a identidade após a correção auditada do cadastro. A retomada só é permitida quando não houve envio ao OCR.</p>
  <button type="button" disabled={busy} onClick={()=>void inspect()}>{busy?'Conferindo…':'Conferir identidade para retomar'}</button>
  {preview?.message&&<p role="status">{preview.message}</p>}
  {preview?.enabled&&preview.eligible&&<div>
   <label>Justificativa da retomada<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={20} maxLength={500} disabled={busy} style={{display:'block',width:'100%',background:'#071b2d',color:'#fff',border:'1px solid #5c7891',borderRadius:8,padding:8}}/></label>
   <label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} disabled={busy}/>Confirmei a correção e autorizo retomar a leitura original conforme as cotas do pacote. O arquivo e as evidências anteriores serão preservados; esta ação não cria outro documento.</label>
   <button type="button" disabled={busy||!ack||reason.trim().length<20} onClick={()=>void resume()}>Confirmar retomada auditada</button>
  </div>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
