'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
/** A short-lived authenticated preview; never persists the signed URL. */
export function useOriginalInvoice(documentId?:string){
 const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0);
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(1);
 useEffect(()=>()=>{generation.current++;},[documentId]);
 function close(){generation.current++;setUrl('');setError('');setBusy(false);dialog.current?.close();}
 async function open(requestedPage=1){
  if(!documentId)return;
  const target=Number.isInteger(requestedPage)&&requestedPage>=1&&requestedPage<=2000?requestedPage:1;
  const token=++generation.current;setPage(target);setUrl('');setError('');setBusy(true);dialog.current?.showModal();
  try{
   const result=await apiRequest<{url:string}>('/api/v1/documents/'+encodeURIComponent(documentId)+'/preview');
   const parsed=new URL(result.url);
   if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('Invalid preview');
   parsed.hash='page='+target;
   if(token===generation.current)setUrl(parsed.toString());
  }catch{if(token===generation.current)setError('Não foi possível abrir a fatura. Tente novamente; a conferência permanece preservada.');}
  finally{if(token===generation.current)setBusy(false);}
 }
 const viewer=<dialog ref={dialog} aria-label="Fatura original para conferência" onCancel={e=>{e.preventDefault();close();}} style={{width:'min(1300px,96vw)',height:'90vh',background:'#101b2c',color:'#f0f5ff',border:'1px solid #536984',borderRadius:16,padding:20}}>
  <div style={{display:'flex',justifyContent:'space-between',gap:16}}><h2>Fatura original</h2><button type="button" onClick={close}>Voltar à conferência</button></div>
  <p>Página solicitada: {page}. Confira a linha e a coluna no documento antes de registrar uma decisão.</p>
  {busy&&<p role="status">Carregando fatura…</p>}{error&&<p role="alert">{error}</p>}
  <button type="button" disabled={busy} onClick={()=>void open(page)}>Atualizar acesso ao PDF</button>
  {url&&<><p><a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Abrir arquivo em nova aba</a> · Acesso temporário. Se a visualização expirar, atualize o acesso.</p><iframe title="PDF original da fatura" src={url} referrerPolicy="no-referrer" style={{width:'100%',height:'calc(100% - 190px)',minHeight:300,border:0,background:'#fff'}}/></>}
 </dialog>;
 return {open:documentId?open:undefined,viewer};
}
