'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {useOriginalInvoice} from './OcrOriginalInvoice';
import OcrReviewField,{type ReviewField} from './OcrReviewField';
type Field=Omit<ReviewField,'description'|'decimal'|'unit'>&{description:{text:string;transcription?:{confidence:number|null}}};
type Data={canReview:boolean;message:string;fields:Field[]};
export default function OcrCdeReviews({id,onSaved}:{id:string;onSaved:()=>void}){
 const original=useOriginalInvoice(id),dialog=useRef<HTMLDialogElement>(null),request=useRef(0);
 const [session,setSession]=useState(0),[data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setData(null);return()=>{request.current++;};},[id]);
 async function load(){const n=++request.current;setBusy(true);setError('');try{const d=await apiRequest<Data>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/cde-reviews');if(n===request.current)setData(d);}catch{if(n===request.current)setError('Não foi possível atualizar o histórico CDE. Se há comprovante de salvamento, o registro foi salvo; atualize para conferir.');}finally{if(n===request.current)setBusy(false);}}
 return <section><button type="button" onClick={()=>{setSession(s=>s+1);dialog.current?.showModal();void load();}}>Conferir descrição CDE no PDF</button><dialog ref={dialog} aria-label="Conferência da descrição CDE" style={{width:'min(1000px,94vw)',maxHeight:'90vh',overflow:'auto',background:'#101b2c',color:'#f0f5ff',border:'1px solid #536984',borderRadius:16,padding:24}}><button type="button" onClick={()=>dialog.current?.close()}>Fechar conferência CDE</button><h2>Conferência da descrição CDE</h2><p>Confira a descrição e o posto de cada linha no PDF. O registro terá autor, justificativa e histórico. Os valores e a confiança original do OCR serão preservados.</p><button type="button" onClick={()=>void original.open?.()}>Abrir fatura original para conferir</button><button type="button" disabled={busy} onClick={()=>void load()}>Atualizar histórico CDE</button>{busy&&<p role="status">Consultando histórico…</p>}{error&&<p role="alert">{error}</p>}{data&&<><p>{data.message}</p>{!data.fields.length&&<p>Nenhuma descrição CDE disponível neste layout.</p>}{data.fields.map(f=><OcrReviewField key={id+f.key+f.sourceHash} session={session} cde id={id} field={{...f,description:undefined,decimal:f.description?.text??null,unit:'',state:f.state==='EXTRACTED_DESCRIPTION'?'EXTRACTED_REVIEW':f.state}} canReview={data.canReview&&!busy&&!error} onSaved={async()=>{await load();onSaved();}}/>)}</>}</dialog>{original.viewer}</section>;
}
