'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import BotEnergyAvatar from './BotEnergyAvatar';
type Topic={key:string;question:string};
type Answer={status:string;answer:string;checkedAt:string;items:{label:string;value:string;source:string}[];sources:{label:string;reference:string;url:string}[]};
export default function BotEnergyHelp({documentId,compact=false}:{documentId?:string;compact?:boolean}){
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
 return <section aria-label="Assistência bot-energy" style={{border:compact&&!open?'none':'1px solid #405873',borderRadius:12,padding:compact&&!open?0:12,background:compact&&!open?'transparent':'#101b2c',color:'#f0f5ff',width:compact&&open?'min(360px,calc(100vw - 32px))':undefined,boxSizing:'border-box'}}>
  <button type="button" aria-label={open?'Fechar dúvidas do bot-energy':'Perguntar ao bot-energy'} aria-expanded={open} title={open?'Fechar bot-energy':'Conversar com bot-energy'} onClick={()=>void show()} style={compact&&!open?{width:48,height:48,padding:4,borderRadius:'50%',border:'1px solid #54c5df',background:'#101b2c',boxShadow:'0 3px 14px #0006',cursor:'pointer'}:undefined}>{compact&&!open?<BotEnergyAvatar size={38}/>:open?'Fechar dúvidas do bot-energy':'Perguntar ao bot-energy'}</button>
  {compact&&!open&&<span style={{display:'block',textAlign:'center',fontSize:10,lineHeight:'16px',color:'#bfeef7'}}>bot-energy</span>}
  {open&&<><h3 style={{display:'flex',gap:8,alignItems:'center'}}><BotEnergyAvatar size={28}/>bot-energy · dúvidas com fontes</h3><p>Perguntas controladas sobre regras e registros. Atendimento livre com RAG ainda não habilitado. Esta consulta não valida, altera ou aprova lançamentos.</p>
   {busy&&<p role="status">Consultando regras e fontes autorizadas…</p>}{error&&<p role="alert">{error}</p>}
   <div>{topics.filter(t=>documentId||!['pending','fields','records'].includes(t.key)).map(t=><button key={t.key} type="button" disabled={busy} onClick={()=>void ask({topic:t.key})}>{t.question}</button>)}</div>
   {!documentId&&<p>Para dúvidas sobre registros de um cliente, abra sua fatura em <a href="/backoffice/documents">Documentos</a> e chame o bot-energy.</p>}
   <form onSubmit={e=>{e.preventDefault();if(question.trim())void ask({question:question.trim()});}}><label>Sua pergunta<input aria-label="Pergunta para bot-energy" value={question} maxLength={500} onChange={e=>setQuestion(e.target.value)}/></label><button type="submit" disabled={busy||!question.trim()}>Consultar resposta comprovada</button></form>
   {answer&&<section aria-label="Resposta do bot-energy" aria-live="polite"><p>{answer.answer}</p>{answer.status==='NO_EVIDENCE'&&<strong>Sem resposta comprovada para esta pergunta.</strong>}<ul>{answer.items.map((item,i)=><li key={i}><strong>{item.label}</strong>: {item.value}<p>Fonte: {item.source}</p></li>)}</ul>{answer.sources.map((s,i)=><p key={i}>Fonte: {s.url.startsWith('/backoffice/')?<a href={s.url}>{s.label}</a>:s.label} · {s.reference}</p>)}<small>Consulta em {new Date(answer.checkedAt).toLocaleString('pt-BR')}</small></section>}
  </>}
 </section>;
}
