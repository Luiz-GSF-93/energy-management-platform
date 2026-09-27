'use client';
import {useOriginalInvoice} from './OcrOriginalInvoice';
import {useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import OcrReviewField,{type ReviewField} from './OcrReviewField';
type Data={canReview?:boolean;canImport:false;message:string;fields:ReviewField[]};
export default function OcrDemandReviews({id,canReview}:{id:string;canReview:boolean}){
 const original=useOriginalInvoice(id);const [session,setSession]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),request=useRef(0);const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){const version=++request.current;setBusy(true);setError('');try{const next=await apiRequest<Data>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/demand-reviews');if(version===request.current)setData(next);}catch{if(version===request.current)setError('Não foi possível atualizar o histórico. Se o comprovante de salvamento aparece abaixo, o registro já foi salvo; tente atualizar novamente.');}finally{if(version===request.current)setBusy(false);}}
 return <section><button type="button" onClick={()=>{setSession(s=>s+1);dialog.current?.showModal();void load();}}>Classificar parcelas de demanda</button><dialog ref={dialog} aria-label="Classificação das parcelas de demanda" style={{width:'min(1000px,94vw)',maxHeight:'90vh',overflow:'auto',background:'#101b2c',color:'#f0f5ff',border:'1px solid #536984',borderRadius:16,padding:24}}><button type="button" onClick={()=>dialog.current?.close()}>Fechar conferência</button><h2>Classificação das parcelas de demanda</h2><p>Confira cada valor no arquivo original antes de registrar. Isso não altera o cadastro nem aprova a apuração.</p><button type="button" onClick={()=>void original.open?.()}>Abrir fatura original para conferir</button><button type="button" disabled={busy} onClick={()=>void load()}>Atualizar histórico</button>{busy&&<p role="status">Carregando…</p>}{error&&<p role="alert">{error}</p>}{data&&<><p>{data.message}</p>{!data.fields.length&&<p>Este layout ainda não possui parcelas de demanda disponíveis para conferência.</p>}{data.fields.map(f=><OcrReviewField session={session} demand key={id+f.key+f.sourceHash} field={f} id={id} canReview={canReview&&data.canReview===true&&!busy&&!error} onSaved={load}/>)}</>}</dialog>{original.viewer}</section>;
}
