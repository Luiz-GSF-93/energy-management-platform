'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import BotEnergyAvatar from './BotEnergyAvatar';
import {Button} from './ui/Button';
type Topic={key:string;question:string};
export type BotEnergyTarget='review'|'monthly'|'costs'|'parameters'|'reconciliation';
type Answer={actions?:{label:string;target:BotEnergyTarget;description:string}[];status:string;answer:string;checkedAt:string;items:{label:string;value:string;source:string}[];sources:{label:string;reference:string;url:string}[]};
export default function BotEnergyHelp({documentId,compact=false,onAction}:{documentId?:string;compact?:boolean;onAction?:(target:BotEnergyTarget)=>void}){
 const [open,setOpen]=useState(false),[topics,setTopics]=useState<Topic[]>([]),[answer,setAnswer]=useState<Answer|null>(null),[question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),controller=useRef<AbortController|null>(null);
 const [canAsk,setCanAsk]=useState(false);
 useEffect(()=>()=>{generation.current++;controller.current?.abort();},[]);
 async function show(){
  if(open){setOpen(false);generation.current++;controller.current?.abort();setBusy(false);return;}
  setOpen(true);setBusy(true);setError('');setAnswer(null);const g=++generation.current;
  controller.current?.abort();const abort=new AbortController();controller.current=abort;
  try{const data=await apiRequest<{topics:Topic[];canAsk:boolean}>('/api/v1/documents/bot-energy/topics',{signal:abort.signal});if(g===generation.current){setTopics(data.topics);setCanAsk(data.canAsk);}}
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
  <Button variant="secondary" aria-label={open?'Fechar dúvidas do bot-energy':'Perguntar ao bot-energy'} aria-expanded={open} title={open?'Fechar bot-energy':'Conversar com bot-energy'} onClick={()=>void show()} style={compact&&!open?{width:48,height:48,padding:4,borderRadius:'50%',border:'1px solid #54c5df',background:'#101b2c',boxShadow:'0 3px 14px #0006',cursor:'pointer'}:undefined}>{compact&&!open?<BotEnergyAvatar size={38}/>:open?'Fechar dúvidas do bot-energy':'Perguntar ao bot-energy'}</Button>
  {compact&&!open&&<span style={{display:'block',textAlign:'center',fontSize:10,lineHeight:'16px',color:'#bfeef7'}}>bot-energy</span>}
  {open&&<><h3 style={{display:'flex',gap:8,alignItems:'center'}}><BotEnergyAvatar size={28}/>bot-energy · dúvidas com fontes</h3><p>Pergunte sobre divergências, tributos, leituras, contratos e vigências. O bot consulta a base controlada e a fatura selecionada, mostrando suas fontes. Sem evidência, informa a dúvida. Esta consulta não valida, altera ou aprova lançamentos.</p>
   {busy&&<p role="status">Consultando regras e fontes autorizadas…</p>}{error&&<p role="alert">{error}</p>}
   <div style={{display:'grid',gap:8}}>{topics.filter(t=>documentId||!['pending','fields','records'].includes(t.key)).map(t=><Button variant="secondary" key={t.key} disabled={busy} style={{textAlign:'left',justifyContent:'flex-start'}} onClick={()=>void ask({topic:t.key})}>{t.question}</Button>)}</div>
   {!documentId&&<p>Para dúvidas sobre registros de um cliente, abra sua fatura em <a href="/backoffice/documents">Documentos</a> e chame o bot-energy.</p>}
   {!canAsk&&<p>Perguntas livres exigem a permissão de uso da IA no seu perfil. As consultas disponíveis acima continuam acessíveis.</p>}
   <form style={{display:'grid',gap:8,marginTop:12}} onSubmit={e=>{e.preventDefault();if(canAsk&&question.trim())void ask({question:question.trim()});}}><label style={{display:'grid',gap:6}}>Sua pergunta<input className="ds-input" aria-label="Pergunta para bot-energy" value={question} disabled={!canAsk} maxLength={500} onChange={e=>setQuestion(e.target.value)}/></label><Button type="submit" disabled={busy||!canAsk||!question.trim()}>Consultar resposta comprovada</Button></form>
   {answer&&<section aria-label="Resposta do bot-energy" aria-live="polite"><p style={{whiteSpace:'pre-line'}}>{answer.answer}</p>{answer.status==='NO_EVIDENCE'&&<strong>Sem resposta comprovada para esta pergunta.</strong>}<div style={{display:'grid',gap:8}}>{documentId&&onAction&&answer.actions?.filter(a=>['review','monthly','costs','parameters','reconciliation'].includes(a.target)).map(a=><div key={a.target}><Button variant="secondary" onClick={()=>onAction(a.target)}>{a.label}</Button><small style={{display:'block'}}>{a.description}</small></div>)}</div><ul>{answer.items.map((item,i)=><li key={i}><strong>{item.label}</strong>: {item.value}<details><summary>Ver fonte</summary><p style={{overflowWrap:'anywhere',whiteSpace:'pre-line'}}>{item.source}</p></details></li>)}</ul>{answer.sources.map((s,i)=><p key={i}>Fonte: <a href={s.url} {...(s.url.startsWith('https://')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{s.label}</a> · {s.reference}</p>)}<small>Consulta em {new Date(answer.checkedAt).toLocaleString('pt-BR')}</small></section>}
  </>}
 </section>;
}
