'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Button} from '@/app/components/ui';
import WorkflowModal from '@/app/backoffice/contracts/WorkflowModal';
import type {AttentionInvoice} from './EvaInvoiceSchedule';

export default function EvaDismissedInvoices({organizationId,onRestored}:{organizationId:string;onRestored?:()=>void}){
 const [open,setOpen]=useState(false),[page,setPage]=useState(0),[rows,setRows]=useState<AttentionInvoice[]>([]),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[uncertain,setUncertain]=useState(false);
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!open)return;let live=true;const abort=new AbortController();setLoading(true);setError('');setRows([]);setMore(false);
  apiRequest<{organizationId:string;rows:AttentionInvoice[];hasMore:boolean;page:number}>(`/api/v1/operations/eva-invoices?view=dismissed&page=${page}`,{signal:abort.signal,cache:'no-store'}).then(r=>{if(r.organizationId!==organizationId||r.page!==page||!Array.isArray(r.rows)||r.rows.some(v=>v.state!=='DISMISSED')||typeof r.hasMore!=='boolean')throw Error('Histórico indisponível.');if(live){setRows(r.rows);setMore(r.hasMore);setUncertain(false);}}).catch(()=>{if(live)setError('Não foi possível consultar seus avisos dispensados. Tente atualizar.');}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;abort.abort();};
 },[open,page,refresh,organizationId]);
 async function restore(r:AttentionInvoice){if(lock.current||loading||uncertain)return;lock.current=true;setBusy(true);setError('');setNotice('');try{
  const saved=await apiRequest<AttentionInvoice&{recorded:boolean}>('/api/v1/operations/eva-invoices/'+encodeURIComponent(r.documentId),{method:'POST',body:{requestId:crypto.randomUUID(),sourceHash:r.sourceHash,state:'RESTORED',note:'Usuário restaurou seu lembrete da fatura; sem executar leitura ou alterar fechamento.'}});
  if(!saved.recorded||saved.documentId!==r.documentId||saved.sourceHash!==r.sourceHash||saved.state!=='RESTORED')throw Error('Resultado não confirmado.');
  if(alive.current){setNotice('Aviso restaurado. A fatura voltou aos seus lembretes da EVA.');setRefresh(v=>v+1);window.dispatchEvent(new Event('eva-invoice-attention-updated'));onRestored?.();}
 }catch{if(alive.current){setUncertain(true);setError('Restauração não confirmada. Atualize os avisos antes de tentar novamente.');}}finally{lock.current=false;if(alive.current)setBusy(false);}}
 return <><Button variant='secondary' onClick={()=>{setPage(0);setNotice('');setOpen(true);}}>Avisos dispensados da EVA</Button>{open?<WorkflowModal title='EVA · meus avisos dispensados' onClose={()=>{if(!lock.current)setOpen(false);}}>
  <p>Somente os lembretes dispensados por você nesta organização. Dispensar ou restaurar não altera documentos, pendências, aprovações ou publicações.</p>
  {error?<p role='alert'>{error}</p>:null}{notice?<p role='status'>{notice}</p>:null}
  <Button disabled={busy||loading} onClick={()=>setRefresh(v=>v+1)}>Atualizar avisos dispensados</Button>
  {loading?<p role='status'>Consultando avisos…</p>:!rows.length&&!error?<p>Nenhum aviso dispensado nesta página.</p>:null}
  {rows.map(r=><article className='ds-card' key={r.documentId}><h3>{r.customerName} · {r.unitName} · {r.month}</h3><p>{r.filename}</p><Button disabled={busy||loading||uncertain} onClick={()=>void restore(r)}>Restaurar aviso</Button></article>)}
  <div style={{display:'flex',gap:12,alignItems:'center',marginTop:16}}><Button variant='secondary' disabled={busy||loading||page===0} onClick={()=>setPage(v=>v-1)}>Anteriores</Button><span>Página {page+1}</span><Button variant='secondary' disabled={busy||loading||!more} onClick={()=>setPage(v=>v+1)}>Próximos</Button></div>
 </WorkflowModal>:null}</>;
}
