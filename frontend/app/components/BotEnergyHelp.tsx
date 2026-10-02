'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
type Topic={key:string;question:string};
type Answer={status:string;answer:string;checkedAt:string;items:{label:string;value:string;source:string}[];sources:{label:string;reference:string;url:string}[]};
export default function BotEnergyHelp({documentId}:{documentId?:string}){
 const [open,setOpen]=useState(false),[topics,setTopics]=useState<Topic[]>([]),[answer,setAnswer]=useState<Answer|null>(null),[question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>{generation.current++;controller.current?.abort();},[]);
 async function show(){
  if(open){setOpen(false);generation.current++;controller.current?.abort();setBusy(false);return;}
  setOpen(true);setBusy(true);setError('');setAnswer(null);const g=++generation.current;
  controller.current?.abort();const abort=new AbortController();controller.current=abort;
  try{const data=await apiRequest<{topics:Topic[]}>('/api/v1/documents/bot-energy/topics',{signal:abort.signal});if(g===generation.current)setTopics(data.topics);}
  catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Assistência indisponível.');}
  finally{if(g===generation.current)setBusy(false);}
 }
 async function ask(body:{topic:string}|{question:string}){
  controller.current?.abort();const abort=new AbortController();controller.current=abort;
  const g=++generation.current;setBusy(true);setError('');setAnswer(null);
  const path=documentId?'/api/v1/documents/'+encodeURIComponent(documentId)+'/ocr/assistant/help':'/api/v1/documents/bot-energy/help';
  try{const data=await apiRequest<Answer>(path,{method:'POST',body,signal:abort.signal});if(g===generation.current)setAnswer(data);}
  catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Não foi possível consultar as fontes.');}
  finally{if(g===generation.current)setBusy(false);}
 }
 return <section aria-label="Assistência bot-energy" style={{border:'1px solid #405873',borderRadius:12,padding:12,background:'#101b2c',color:'#f0f5ff'}}>
  <button type="button" onClick={()=>void show()}>{open?'Fechar dúvidas do bot-energy':'Perguntar ao bot-energy'}</button>
  {open&&<><h3>bot-energy · dúvidas com fontes</h3><p>Perguntas controladas sobre regras e registros. Atendimento livre com RAG ainda não habilitado. Esta consulta não valida, altera ou aprova lançamentos.</p>
   {busy&&<p role="status">Consultando regras e fontes autorizadas…</p>}{error&&<p role="alert">{error}</p>}
   <div>{topics.filter(t=>documentId||!['pending','fields','records'].includes(t.key)).map(t=><button key={t.key} type="button" disabled={busy} onClick={()=>void ask({topic:t.key})}>{t.question}</button>)}</div>
   {!documentId&&<p>Para dúvidas sobre registros de um cliente, abra sua fatura em <a href="/backoffice/documents">Documentos</a> e chame o bot-energy.</p>}
   <form onSubmit={e=>{e.preventDefault();if(question.trim())void ask({question:question.trim()});}}><label>Sua pergunta<input aria-label="Pergunta para bot-energy" value={question} maxLength={500} onChange={e=>setQuestion(e.target.value)}/></label><button type="submit" disabled={busy||!question.trim()}>Consultar resposta comprovada</button></form>
   {answer&&<section aria-label="Resposta do bot-energy" aria-live="polite"><p>{answer.answer}</p>{answer.status==='NO_EVIDENCE'&&<strong>Sem resposta comprovada para esta pergunta.</strong>}<ul>{answer.items.map((item,i)=><li key={i}><strong>{item.label}</strong>: {item.value}<p>Fonte: {item.source}</p></li>)}</ul>{answer.sources.map((s,i)=><p key={i}>Fonte: {s.url.startsWith('/backoffice/')?<a href={s.url}>{s.label}</a>:s.label} · {s.reference}</p>)}<small>Consulta em {new Date(answer.checkedAt).toLocaleString('pt-BR')}</small></section>}
  </>}
 </section>;
}
