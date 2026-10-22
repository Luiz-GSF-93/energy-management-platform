'use client';
import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button} from './ui';
import styles from './PortalClientWorkspace.module.css';

/** Private bytes are rendered locally, without an iframe or an external viewer. */
export default function PortalInvoiceViewer({id,filename}:{id:string;filename:string}){
 const canvas=useRef<HTMLCanvasElement>(null),frame=useRef<HTMLDivElement>(null);
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[image,setImage]=useState(''),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[width,setWidth]=useState(800),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
 useEffect(()=>{if(!frame.current)return;const observer=new ResizeObserver(([e])=>setWidth(Math.max(240,e.contentRect.width)));observer.observe(frame.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{const abort=new AbortController();let objectUrl='',task:{destroy:()=>Promise<void>}|null=null;setPdf(null);setImage('');setPage(1);setError('');setLoading(true);
  void (async()=>{try{const blob=await apiRequest<Blob>('/api/v1/portal/workspace/invoices/'+id+'/content',{responseType:'blob',signal:abort.signal,cache:'no-store'});if(abort.signal.aborted)return;
   if(blob.size>15*1024*1024)throw Error('O arquivo excede o limite de visualização.');
   if(blob.type==='application/pdf'){const bytes=new Uint8Array(await blob.arrayBuffer()),engine=await import('pdfjs-dist');if(abort.signal.aborted)return;engine.GlobalWorkerOptions.workerSrc='/_pdf/pdf.worker.min.mjs';const loadingTask=engine.getDocument({data:bytes,enableXfa:false,useSystemFonts:true});task=loadingTask;const document=await loadingTask.promise;if(!abort.signal.aborted)setPdf(document);}
   else if(['image/png','image/jpeg'].includes(blob.type)){objectUrl=URL.createObjectURL(blob);setImage(objectUrl);}else throw Error('Formato de visualização não disponível.');
  }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível abrir a fatura.');}finally{if(!abort.signal.aborted)setLoading(false);}})();
  return()=>{abort.abort();void task?.destroy();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[id,attempt]);
 useEffect(()=>{if(!pdf||!canvas.current)return;let cancelled=false,render:{cancel:()=>void}|null=null;setError('');void (async()=>{try{const p=await pdf.getPage(page);if(cancelled||!canvas.current)return;const original=p.getViewport({scale:1}),scale=Math.min((width-8)/original.width,2)*zoom,ratio=Math.min(window.devicePixelRatio||1,2),viewport=p.getViewport({scale:scale*ratio}),target=canvas.current;target.width=Math.floor(viewport.width);target.height=Math.floor(viewport.height);target.style.width=(viewport.width/ratio)+'px';target.style.height=(viewport.height/ratio)+'px';const task=p.render({canvas:target,viewport});render=task;await task.promise;}catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Página indisponível.');}})();return()=>{cancelled=true;render?.cancel();};},[pdf,page,zoom,width]);
 return <div ref={frame} className={styles.inlineViewer}><h3>{filename}</h3>{loading?<p role="status">Abrindo arquivo privado…</p>:null}{error?<Alert variant="error">{error} <Button variant="secondary" onClick={()=>setAttempt(v=>v+1)}>Tentar abrir novamente</Button></Alert>:null}{pdf?<><div className={styles.actions}><Button variant="secondary" disabled={page<=1} onClick={()=>setPage(v=>v-1)}>Página anterior</Button><span aria-live="polite">Página {page} de {pdf.numPages}</span><Button variant="secondary" disabled={page>=pdf.numPages} onClick={()=>setPage(v=>v+1)}>Próxima página</Button><Button variant="secondary" disabled={zoom<=.75} onClick={()=>setZoom(v=>v-.25)}>Diminuir</Button><Button variant="secondary" disabled={zoom>=2} onClick={()=>setZoom(v=>v+.25)}>Ampliar</Button></div><div className={styles.pdfPage}><canvas ref={canvas} aria-label={'Fatura '+filename+', página '+page}/></div></>:null}{image?<img src={image} alt={'Fatura '+filename} className={styles.invoiceImage}/>:null}</div>;
}
