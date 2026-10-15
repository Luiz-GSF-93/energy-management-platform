'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {useAuth} from '@/app/providers';
import BotEnergyAvatar from './BotEnergyAvatar';
import {Button} from './ui/Button';
import EvaProductGuides,{EvaGuideTopic,safeEvaGuideTopics} from './EvaProductGuides';
export type BotEnergyTarget='review'|'monthly'|'costs'|'parameters'|'reconciliation'|'saved-monthly'|'saved-costs'|'approval'|'parameter-records';
type Context={customers:{id:string;company_name:string}[];units:{id:string;customer_id:string;name:string}[];documents:{id:string;customer_id:string;consumer_unit_id:string;original_filename:string;reference_month:string}[]};
type Answer={conversationQuestion?:string;contextDocumentId?:string;mode?:string;interpretationState?:string;actions?:{label:string;target:BotEnergyTarget;description:string}[];status:string;answer:string;checkedAt:string;items:{label:string;value:string;source:string}[];sources:{label:string;reference:string;url:string}[]};
type Props={documentId?:string;compact?:boolean;onAction?:(target:BotEnergyTarget)=>void};
export default function BotEnergyHelp(props:Props){
 const auth=useAuth(),context=auth?.context,organization=context?.scope==='organization'?context.currentOrganization:undefined;
 const key=[auth?.status,context?.user.id,context?.scope,organization?.id,organization?.role,context?.scope==='organization'?context.accessMode:'',organization?.permissions?.join(','),props.documentId].join('|');
 return <BotEnergyHelpInner key={key} {...props}/>;
}
function BotEnergyHelpInner({documentId,compact=false,onAction}:Props){
 const [open,setOpen]=useState(false),[answer,setAnswer]=useState<Answer|null>(null),[question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [contexts,setContexts]=useState<Context|null>(null),[customer,setCustomer]=useState(''),[unit,setUnit]=useState(''),[selectedDocument,setSelectedDocument]=useState('');
 const activeDocument=documentId||selectedDocument;
 const generation=useRef(0),controller=useRef<AbortController|null>(null),previousQuestion=useRef(''),input=useRef<HTMLTextAreaElement|null>(null);
 const [canAsk,setCanAsk]=useState(false),[canGenerate,setCanGenerate]=useState(false);
 const [canConverse,setCanConverse]=useState(false);
 const [sentQuestion,setSentQuestion]=useState('');
 function resetConversation(){previousQuestion.current='';setSentQuestion('');setQuestion('');setAnswer(null);}
 useEffect(()=>{if(open&&!busy&&canAsk)input.current?.focus();},[open,busy,canAsk]);
 const [guides,setGuides]=useState<EvaGuideTopic[]>([]);
 useEffect(()=>()=>{generation.current++;controller.current?.abort();},[]);
 async function show(){
  if(open){resetConversation();setOpen(false);generation.current++;controller.current?.abort();setBusy(false);return;}
  setOpen(true);setBusy(true);setError('');setAnswer(null);setGuides([]);const g=++generation.current;
  controller.current?.abort();const abort=new AbortController();controller.current=abort;
  try{const data=await apiRequest<{canAsk:boolean;canGenerate?:boolean;conversationContext?:boolean;productGuides?:unknown}>('/api/v1/documents/bot-energy/topics',{signal:abort.signal});if(g===generation.current){setCanAsk(data.canAsk);setCanGenerate(data.canGenerate===true);setCanConverse(data.conversationContext===true);setGuides(safeEvaGuideTopics(data.productGuides));if(!documentId){try{const c=await apiRequest<Context>('/api/v1/documents/bot-energy/context',{signal:abort.signal});if(g===generation.current)setContexts(c);}catch{if(g===generation.current)setContexts(null);}}}}
  catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Assistência indisponível.');}
  finally{if(g===generation.current)setBusy(false);}
 }
 async function ask(body:{topic:string}|{question:string}){
  controller.current?.abort();const abort=new AbortController();controller.current=abort;
  const g=++generation.current;setBusy(true);setError('');setAnswer(null);
  const submitted='question' in body?body.question:undefined;
  const subject=submitted??('topic' in body?guides.find(guide=>guide.key===body.topic)?.question:undefined);
  const payload=submitted&&canConverse&&previousQuestion.current?{...body,previousQuestion:previousQuestion.current}:body;
  if(submitted){setQuestion('');setSentQuestion(submitted);}else{previousQuestion.current='';setSentQuestion('');}
  const guideRequest='topic' in body&&body.topic.startsWith('guide-');
  const path=activeDocument&&!guideRequest?'/api/v1/documents/'+encodeURIComponent(activeDocument)+'/ocr/assistant/help':'/api/v1/documents/bot-energy/help';
  try{const data=await apiRequest<Answer>(path,{method:'POST',body:payload,signal:abort.signal});if(g===generation.current){setAnswer(data);if(subject)previousQuestion.current=data.conversationQuestion??subject;if(data.contextDocumentId&&!activeDocument)setSelectedDocument(data.contextDocumentId);}}
  catch(e){if(g===generation.current){if(submitted)setQuestion(draft=>draft||submitted);setError(e instanceof Error?e.message:'Não foi possível consultar as fontes.');}}
  finally{if(g===generation.current)setBusy(false);}
 }
 return <section aria-label="Assistência EVA" style={{border:compact&&!open?'none':'1px solid #405873',borderRadius:12,padding:compact&&!open?0:12,background:compact&&!open?'transparent':'#101b2c',color:'#f0f5ff',width:compact&&open?'min(360px,calc(100vw - 32px))':undefined,boxSizing:'border-box'}}>
  <Button variant="secondary" aria-label={open?'Fechar dúvidas da EVA':'Perguntar à EVA'} aria-expanded={open} title={open?'Fechar EVA':'Conversar com EVA'} onClick={()=>void show()} style={compact&&!open?{width:48,height:48,padding:4,borderRadius:'50%',border:'1px solid #54c5df',background:'#101b2c',boxShadow:'0 3px 14px #0006',cursor:'pointer'}:undefined}>{compact&&!open?<BotEnergyAvatar size={38}/>:open?'Fechar dúvidas da EVA':'Perguntar à EVA'}</Button>
  {compact&&!open&&<span style={{display:'block',textAlign:'center',fontSize:10,lineHeight:'16px',color:'#bfeef7'}}>EVA</span>}
  {open&&<><h3 style={{display:'flex',gap:8,alignItems:'center'}}><BotEnergyAvatar size={28}/>EVA · Analista Virtual do EnergyOS</h3><p>Respostas objetivas com fontes do contexto autorizado. A conversa não altera nem aprova lançamentos.</p>
   <p role="status">{canGenerate?'IA disponível.':'IA indisponível neste momento; as regras do sistema continuam acessíveis.'}</p>{busy&&<p role="status">Consultando regras e fontes autorizadas…</p>}{error&&<p role="alert">{error}</p>}
   {!canAsk&&!busy&&<p>Perguntas livres exigem a permissão de uso da IA no seu perfil.</p>}
   <EvaProductGuides topics={guides} busy={busy} canAsk={canAsk} onSelect={key=>void ask({topic:key})}/>
   {!documentId&&contexts&&<fieldset disabled={busy} style={{display:'grid',gap:6}}><legend>Contexto da consulta (organização ativa)</legend><label>Cliente<select className="ds-input" value={customer} onChange={e=>{setCustomer(e.target.value);setUnit('');setSelectedDocument('');resetConversation();}}><option value="">Pergunta geral ou cliente mencionado</option>{contexts.customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label><label>Unidade<select className="ds-input" value={unit} onChange={e=>{setUnit(e.target.value);setSelectedDocument('');resetConversation();}}><option value="">Selecione a unidade</option>{contexts.units.filter(u=>!customer||u.customer_id===customer).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>Fatura e competência<select className="ds-input" value={selectedDocument} onChange={e=>{setSelectedDocument(e.target.value);resetConversation();}}><option value="">Selecione a fatura para analisar valores</option>{contexts.documents.filter(d=>(!customer||d.customer_id===customer)&&(!unit||d.consumer_unit_id===unit)).map(d=><option key={d.id} value={d.id}>{d.reference_month.slice(0,7)} · {d.original_filename}</option>)}</select></label></fieldset>}
   <form style={{display:'grid',gap:8,marginTop:12}} onSubmit={e=>{e.preventDefault();if(canAsk&&!busy&&question.trim())void ask({question:question.trim()});}}><label style={{display:'grid',gap:6}}>Sua pergunta<textarea ref={input} className="ds-input" aria-label="Pergunta para EVA" placeholder={activeDocument?'Pergunte sobre esta fatura, os resultados ou as pendências…':'Conte sua dúvida com suas palavras. Se faltar contexto, eu pergunto…'} autoFocus rows={3} value={question} disabled={!canAsk} maxLength={500} onChange={e=>setQuestion(e.target.value)}/></label><Button type="submit" disabled={busy||!canAsk||!question.trim()}>{busy?'Consultando…':'Enviar pergunta'}</Button></form>
   {sentQuestion&&<p aria-label="Sua última mensagem"><strong>Você:</strong> {sentQuestion}</p>}
   {!activeDocument&&<small>Selecione a fatura para consultar preços, resultados e pendências com fontes. Perguntas sobre normas consultam a biblioteca oficial revisada.</small>}
   {answer&&<section aria-label="Resposta da EVA" aria-live="polite">{answer.mode==='PRODUCT_GUIDE'&&<strong>Guia de uso do EnergyOS · confira a versão e as orientações.</strong>}{answer.mode==='AZURE_GENERATIVE'&&<strong>Interpretação por IA · confira as fontes antes de validar.</strong>}<p style={{whiteSpace:'pre-line'}}>{answer.answer}</p>{answer.status==='NO_EVIDENCE'&&<strong>Sem resposta comprovada para esta pergunta.</strong>}<div style={{display:'grid',gap:8}}>{answer.mode!=='PRODUCT_GUIDE'&&activeDocument&&!onAction&&<a className="ds-button ds-button--secondary" href={'/backoffice/contracts?ocrDocument='+encodeURIComponent(activeDocument)+'&area=preparation'}>Abrir preenchimentos, conferir propostas e validar conforme perfil</a>}{answer.mode!=='PRODUCT_GUIDE'&&activeDocument&&!onAction&&answer.actions?.map(a=>{const area:Record<string,string>={monthly:'monthly','saved-monthly':'monthly',costs:'costs','saved-costs':'costs',parameters:'parameters','parameter-records':'parameters',approval:'parameters',reconciliation:'supply',review:'preparation'};return area[a.target]?<div key={a.target}><a className="ds-button ds-button--secondary" href={'/backoffice/contracts?ocrDocument='+encodeURIComponent(activeDocument)+'&area='+area[a.target]}>{a.label}</a><small style={{display:'block'}}>{a.description}</small></div>:null;})}{answer.mode!=='PRODUCT_GUIDE'&&documentId&&onAction&&answer.actions?.filter(a=>['review','monthly','costs','parameters','reconciliation','saved-monthly','saved-costs','approval','parameter-records'].includes(a.target)).map(a=><div key={a.target}><Button variant="secondary" onClick={()=>onAction(a.target)}>{a.label}</Button><small style={{display:'block'}}>{a.description}</small></div>)}</div><details><summary>Ver evidências e fontes</summary><ul>{answer.items.map((item,i)=><li key={i}><strong>{item.label}</strong>: {item.value}<details><summary>Ver fonte</summary><p style={{overflowWrap:'anywhere',whiteSpace:'pre-line'}}>{item.source}</p></details></li>)}</ul>{answer.sources.map((s,i)=><p key={i}>Fonte: <a href={s.url} {...(s.url.startsWith('https://')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{s.label}</a> · {s.reference}</p>)}</details><small>Consulta em {new Date(answer.checkedAt).toLocaleString('pt-BR')}</small></section>}
  </>}
 </section>;
}
