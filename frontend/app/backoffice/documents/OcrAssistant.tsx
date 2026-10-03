'use client';
import type {OcrAutofill} from '../contracts/ocr-autofill';
import OcrCdeReviews from './OcrCdeReviews';
import {useCallback,useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {ocrContractLink,type OcrDestination} from '../contracts/ocr-navigation';
import OcrAssistantForm from './OcrAssistantForm';
import BotEnergyHelp from '@/app/components/BotEnergyHelp';
import {prepareAssistant,activityLabels,type AssistantActivity} from './assistant-preparation';
import OcrIdentityPreview from './OcrIdentityPreview';
import OcrFieldReviews from './OcrFieldReviews';
import OcrDemandReviews from './OcrDemandReviews';
import OcrHomologation from './OcrHomologation';
import OcrReadout,{type ReadoutSummary} from './OcrReadout';
import {pendingFields,type InboxUpdate} from './assistant-inbox';
type Finding={code:string;section:string;severity:string;message:string};
type FieldTask={kind:string;key:string;label:string;value:string|null;unit:string;description:string;source:string;canConfirm:boolean;confirmed:boolean};
type Operation={canPropose?:boolean;key:string;label:string;area:OcrDestination;state:string;canCreate:boolean;message:string;values?:unknown;candidates?:unknown};
type History={inputId:string;month:string;version:number;previous:string|null;current:string|null;state:string;message:string};
type Plan={prefilled?:OcrAutofill;canValidate?:boolean;fieldTasks?:FieldTask[];token:string;documentId:string;unitName:string;month:string;checkedAt:string;message:string;canPrepare:boolean;
 counts:{blockers:number;reviews:number};confidence:ReadoutSummary;
 values:{key:string;label:string;value:string|null;unit:string;state:string;sources:string[];review:null|{decision:string;version:number;author:string}}[];
 comparisons:History[];operations:Operation[];findings:Finding[];
 configurations:{area:OcrDestination;label:string;state:string;findings:Finding[]}[];
 records:{measurements:{status:string};costs:{status:string};catalog:{key:string;label:string;versions:{id:string;revision:number;start:string;end:string;source:string}[]}[];suppliers:{id:string;number:string;start:string;end:string}[];feeCoverage:{gaps:{start:string;end:string}[];overlap:boolean}}};
type Receipt={key:string;label:string;state:string;message?:string;result?:unknown};
type Applied={receipts:Receipt[];complete:boolean;current:Plan|null;message:string};
const panel={border:'1px solid #405873',borderRadius:12,padding:16,margin:'14px 0'};
const states:Record<string,string>={READY:'Disponível para lançar',READY_MERGE:'Disponível para vincular ao rascunho',CREATED:'Já registrado',INTEGRATED:'Já integrado',EXISTING_RECORD:'Registro existente preservado',RECORD_PRESERVED:'Revisão do registro existente',UNSUPPORTED:'Verificação manual necessária',REVIEWS_PENDING:'Conferências pendentes',REVIEW_REQUIRED:'Conferência necessária',BASE_APPROVAL_REQUIRED:'Aprovar base antes de prosseguir',BASE_REVIEW_REQUIRED:'Revisar base antes de prosseguir',DECLARATION_REQUIRED:'Conferir declaração tributária',REVISION_READY:'Nova versão disponível',REVISION_CREATED:'Nova versão já registrada',LINKED:'Bases já vinculadas',CONFLICT:'Conflito a revisar',SUPERSEDED:'Versão substituída no histórico',MISSING:'Informação ausente'};
const evidenceNames:Record<string,string>={label:'Campo',decimal:'Valor',unit:'Unidade',quantity:'Quantidade',rate:'Tarifa',rateMwh:'Tarifa (R$/MWh)',amount:'Valor faturado',classification:'Classificação',band:'Posto',source:'Fonte',inputId:'Registro mensal',parameterId:'Parâmetro',revision:'Revisão',version:'Versão',id:'Registro',status:'Situação',month:'Competência',targetVersion:'Versão proposta'};
const evidenceValues:Record<string,string>={USED:'Utilizada',UNUSED:'Não utilizada',PEAK:'Ponta',OFF_PEAK:'Fora ponta',ALL:'Todos os postos',DRAFT:'Rascunho',VALIDATED:'Validado',APPROVED:'Aprovado',MISSING:'Não informado',INVALID:'Requer correção'};
function Evidence({value}:{value:unknown}) {
 if(!value)return null;
 const rows=Array.isArray(value)?value:[value];
 return <ul>{rows.map((row,i)=><li key={i}>{row&&typeof row==='object'?Object.entries(row).filter(([k,v])=>!['token','sourceHash'].includes(k)&&['string','number'].includes(typeof v)).map(([k,v])=>(evidenceNames[k]??k)+': '+(evidenceValues[String(v)]??String(v))).join(' · '):String(row)}</li>)}</ul>;
}
export default function OcrAssistant({id,canProcess,autoStart=false,autoOpen=true,openRequest=0,onUpdate}:{id:string;canProcess:boolean;autoStart?:boolean;autoOpen?:boolean;openRequest?:number;onUpdate?:(id:string,update:InboxUpdate)=>void}) {
 const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0),writing=useRef(false),controller=useRef<AbortController|null>(null);
 const [writeBusy,setWriteBusy]=useState(false);
 const [activity,setActivity]=useState<AssistantActivity|null>(null),[form,setForm]=useState<OcrDestination|null>(null),[choices,setChoices]=useState<Record<string,string>>({}),[note,setNote]=useState(''),[checkedPdf,setCheckedPdf]=useState(false);
 const [plan,setPlan]=useState<Plan|null>(null),[busy,setBusy]=useState(autoStart),[stale,setStale]=useState(true),[error,setError]=useState('');
 const [selected,setSelected]=useState<string[]>([]),[ack,setAck]=useState(false),[receipts,setReceipts]=useState<Receipt[]>([]),[notice,setNotice]=useState(''),[review,setReview]=useState(false);
 const updates=useRef(onUpdate);
 useEffect(()=>{updates.current=onUpdate;},[onUpdate]);
 useEffect(()=>{
  if(!autoStart&&!plan&&!error&&!busy)return;
  const summary:InboxUpdate={state:busy?'PREPARING':error||stale?'FAILED':receipts.length?'RECORDED':'READY',message:busy?'bot-energy conferindo fontes, histórico e vigências…':error||stale?'Conferência interrompida. Abra e atualize antes de validar.':receipts.length?'Confira os recibos e as revisões restantes. Aprovação financeira ainda não realizada.':'Propostas prontas para a validação do operador.',...(plan?{blockers:plan.counts.blockers,reviews:plan.counts.reviews,fields:pendingFields(plan.fieldTasks??[]),proposals:plan.operations.filter(o=>o.canPropose??o.canCreate).length}:{})};
  updates.current?.(id,summary);
 },[id,autoStart,plan,error,busy,stale,receipts]);
 const install=useCallback((next:Plan)=>{setPlan(next);setSelected(next.operations.filter(o=>o.canPropose??o.canCreate).map(o=>o.key));setChoices(Object.fromEntries((next.fieldTasks??[]).filter(f=>f.canConfirm&&!f.confirmed&&f.kind!=='demand').map(f=>[f.kind+':'+f.key,'CONFIRMED'])));setCheckedPdf(false);setAck(false);setStale(false);},[]);
 const load=useCallback(async()=>{
  if(writing.current)return;
  controller.current?.abort();const abort=new AbortController();controller.current=abort;
  const g=++generation.current;setBusy(true);setStale(true);setError('');setActivity(null);
  try{const next=await prepareAssistant<Plan>(id,job=>{if(g===generation.current)setActivity(job);},abort.signal);if(g===generation.current)install(next);}
  catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Não foi possível conferir a fatura. Atualize antes de lançar.');}
  finally{if(g===generation.current)setBusy(false);}
 },[id,install]);
 useEffect(()=>{
  let active=true;const request=generation;
  if(autoStart)queueMicrotask(()=>{if(active){if(autoOpen)dialog.current?.showModal();void load();}});
  return()=>{active=false;request.current++;controller.current?.abort();};
 },[autoStart,autoOpen,load]);
 useEffect(()=>{
  if(!openRequest)return;
  dialog.current?.showModal();void load();
 },[openRequest,load]);
 useEffect(()=>{
  const refresh=()=>{if(dialog.current?.open&&!writing.current&&!form)void load();};
  window.addEventListener('focus',refresh);
  return()=>window.removeEventListener('focus',refresh);
 },[load,form]);
 async function validate(){
  if(!plan||!plan.canValidate||busy||stale||!ack||!checkedPdf||note.trim().length<3||(!selected.length&&!Object.keys(choices).length)||writing.current)return;
  writing.current=true;setWriteBusy(true);const g=++generation.current;setBusy(true);setError('');setNotice('Registrando as validações e preparando os rascunhos permitidos…');setReceipts([]);
  try{
   const saved=await apiRequest<Applied>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/assistant/validate',{method:'POST',body:{token:plan.token,requestId:crypto.randomUUID(),fields:Object.entries(choices).map(([key,decision])=>({key,decision})),operations:selected,acknowledged:true,checkedPdf:true,note:note.trim()}});
   if(g!==generation.current)return;
   setReceipts(saved.receipts);setNotice(saved.message);setAck(false);setCheckedPdf(false);
   if(saved.current)install(saved.current);else setStale(true);
  }catch(e){if(g===generation.current){setError((e instanceof Error?e.message:'Não foi possível confirmar as validações.')+' Confira o histórico antes de repetir.');setStale(true);setAck(false);}}
  finally{writing.current=false;if(g===generation.current){setBusy(false);setWriteBusy(false);}}
 }
 const activityView=<section aria-label="Atividades do assistente" aria-live="polite" style={panel}>
  <strong>{writeBusy?'bot-energy registrando validações e rascunhos':busy?'bot-energy trabalhando':error?'Conferência interrompida':plan?'Aguardando validação do operador':'Aguardando leitura OCR'}</strong>
  {activity&&<><progress aria-label="Etapas de preparação concluídas" value={activity.completed.length} max={activity.stages.length}/><p>{activity.completed.length} de {activity.stages.length} etapas · {(activity.elapsedMs/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} s de processamento. Preparação não significa aprovação financeira.</p><ol>{activity.stages.map(stage=><li key={stage}>{activity.completed.includes(stage)?'✓ Concluído':'○ Aguardando conclusão'} · {activityLabels[stage]??stage}</li>)}</ol></>}
 </section>;
 async function apply(){
  if(!plan||busy||stale||!ack||!selected.length||writing.current)return;
  writing.current=true;setWriteBusy(true);const g=++generation.current;setBusy(true);setError('');setNotice('');setReceipts([]);
  try{const saved=await apiRequest<Applied>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/assistant',{method:'POST',body:{token:plan.token,operations:selected,acknowledged:true}});
   if(g!==generation.current)return;
   setReceipts(saved.receipts);setNotice(saved.message);setAck(false);
   if(saved.current)install(saved.current);else setStale(true);
  }catch(e){if(g===generation.current){setError((e instanceof Error?e.message:'Não foi possível confirmar os lançamentos.')+' Consulte o histórico antes de tentar novamente.');setStale(true);setAck(false);}}
  finally{writing.current=false;if(g===generation.current){setBusy(false);setWriteBusy(false);}}
 }
 return <section aria-label="Assistente de conferência OCR" style={{marginTop:12}}>
  <button type="button" onClick={()=>{dialog.current?.showModal();void load();}}>bot-energy · conferir fatura</button>
  {activityView}
  <p>{busy?'Conferindo extração e cadastros…':plan?plan.counts.blockers+' pendência(s) para preparar apuração':'Assistente de conferência disponível após a extração.'}</p>
  <dialog ref={dialog} aria-label="bot-energy · conferir fatura" style={{width:'min(1100px,94vw)',maxHeight:'90vh',overflow:'auto',background:'#101b2c',color:'#f0f5ff',border:'1px solid #536984',borderRadius:16,padding:24}}>
   <button type="button" onClick={()=>dialog.current?.close()} disabled={writeBusy}>Fechar assistente</button>
   <h2>bot-energy · conferir fatura</h2><p>Leitura Azure, conferência pelas regras existentes e preparação assistida dos lançamentos.</p>
   <button type="button" disabled={busy} onClick={()=>void load()}>Atualizar conferência</button>
   {activityView}{busy&&<p role="status">{writeBusy?'Registrando validações e rascunhos…':'Conferindo dados, histórico e vigências…'}</p>}{error&&<p role="alert">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   {receipts.length>0&&<section style={panel}><h3>Resultado dos lançamentos</h3><ul>{receipts.map(r=><li key={r.key}><strong>{r.label}: {r.state==='REVIEW_SAVED'?'campo validado pelo operador':r.state==='SAVED_DRAFT'?'rascunho registrado':r.state==='VERIFY_REQUIRED'?'verificar histórico antes de repetir':'revisão necessária'}</strong>{r.message&&<p>{r.message}</p>}<Evidence value={r.result}/></li>)}</ul></section>}
   {form?<OcrAssistantForm key={form} id={id} area={form} onClose={()=>{setForm(null);void load();}}/>:plan&&<>
    <h3>{plan.unitName} · {plan.month}</h3><p>{plan.message}</p><small>Consulta em {new Date(plan.checkedAt).toLocaleString('pt-BR')}{stale?' · Atualização obrigatória antes de lançar':''}</small>
    <BotEnergyHelp key={id} documentId={id}/>
    {plan.prefilled&&<section style={panel} aria-label="Preenchimentos automáticos"><h3>Preenchidos pelo bot-energy para sua conferência</h3><p>{plan.prefilled.message}</p><p>Consumos: {Object.keys(plan.prefilled.measurements).length} campos · Alíquotas: {plan.prefilled.taxes.length} · Custos identificados: {plan.prefilled.costs.length}. A gravação auditada ocorre após sua validação; aprovação financeira exclusiva do gestor/administrador.</p><ul>{plan.prefilled.taxes.map(t=><li key={t.code}>{t.code}: {t.rate}% · {t.source}<p>{t.message}</p></li>)}</ul>{plan.prefilled.library?<p>Biblioteca compatível: versão {plan.prefilled.library.version} · {plan.prefilled.library.start} a {plan.prefilled.library.end} · {plan.prefilled.library.items.length} tarifas {plan.prefilled.library.scenario}. Abra “Tarifas e parâmetros” para conferir as bases tributárias já acompanhadas das alíquotas da fatura.</p>:<p>{plan.prefilled.libraryState==='AMBIGUOUS'?'Mais de uma tabela compatível: selecionar a vigência correta.':'Biblioteca sem correspondência única para todo o mês.'}</p>}</section>}
    <section style={panel} aria-label="O que precisa da sua validação"><h3>O que precisa da sua validação</h3><p>{pendingFields(plan.fieldTasks??[])} campo(s) ainda precisam de conferência. Configurações vigentes e conferências já salvas são preservadas.</p><ul>{(plan.fieldTasks??[]).filter(f=>!f.confirmed).map(f=><li key={f.kind+':'+f.key}><strong>{f.label}: {f.value??'Não identificado'} {f.unit}</strong><p>{f.canConfirm?'Conferir com o PDF e validar abaixo.':'Revisão específica necessária; não pode ser confirmado em lote.'} · Fonte: {f.source||'não identificada'}</p></li>)}</ul><p>Use “Conferir dados ou solicitar revisão” para registrar dúvidas e correções com justificativa. Nenhum dado ausente será tratado como zero.</p></section>
    <section style={panel}><h3>1. Dados extraídos e dúvidas</h3>
     <p>Confiança mínima dos campos essenciais: {plan.confidence.criticalConfidence.complete&&plan.confidence.criticalConfidence.minimumAll!==null?(plan.confidence.criticalConfidence.minimumAll*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%':'indeterminada — informação incompleta'}.</p>
     <p>Abaixo de 45%: automação bloqueada. Entre 45% e 85%: conferência humana. Acima de 85%: elegível somente após as demais verificações. A confirmação humana não altera a confiança OCR.</p>
     <OcrReadout id={id} summary={plan.confidence}/>
     <ul>{plan.values.map(v=><li key={v.key}><strong>{v.label}: {v.value??'Não identificado'} {v.unit}</strong><p>{v.review?.decision==='CONFIRMED'?'Conferência salva · versão '+v.review.version+' · '+v.review.author:v.review?.decision==='NEEDS_CORRECTION'?'Correção solicitada':'Conferência pendente'} · Fonte: {v.sources.join(', ')||'não identificada'}</p></li>)}</ul>
     <button type="button" onClick={()=>setReview(v=>!v)}>{review?'Ocultar campos de revisão':'Conferir dados ou solicitar revisão'}</button>
     {review&&<><p>Abra o campo correspondente, escolha confirmar ou solicitar correção e registre a evidência ou o requisito de revisão. Depois atualize o assistente.</p><OcrIdentityPreview id={id}/><OcrFieldReviews id={id} canReview={canProcess}/><OcrDemandReviews id={id} canReview={canProcess}/><OcrCdeReviews id={id} onSaved={()=>void load()}/></>}
    </section>
    <section style={panel}><h3>2. Comparação com o histórico da unidade</h3>{!plan.comparisons.length?<p>Não há competência anterior validada disponível para comparar. Nenhum histórico foi presumido.</p>:<ul>{plan.comparisons.map(h=><li key={h.inputId}><strong>{h.month} · versão {h.version}: {h.previous??'não informado'} kWh</strong><p>{h.message}</p></li>)}</ul>}</section>
    <section style={panel}><h3>3. Cadastros e vigências</h3><p>Configurações que cobrem a competência são reutilizadas. O assistente solicita complementação quando há ausência, conflito ou bloqueio; a fatura não determina preço do fornecedor nem honorários.</p><p>Complete as informações aqui no assistente. Ao voltar à conferência, os dados serão consultados novamente.</p>
     <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:12}}>{plan.configurations.map(c=><article key={c.area} style={panel}><h4>{c.label}</h4><p>{c.state==='AVAILABLE'?'Disponível na competência':'Requer informação ou revisão'}</p>{c.findings.map(f=><p key={f.code}>{f.message}</p>)}<button type="button" disabled={busy} onClick={()=>setForm(c.area)}>{c.state==='AVAILABLE'?'Consultar registros':'Completar / revisar em tela'}</button></article>)}</div>
     <details><summary>Ver vigências e fontes dos parâmetros</summary>{plan.records.catalog.map(c=><article key={c.key}><strong>{c.label}</strong><ul>{c.versions.map(v=><li key={v.id}>{v.start} a {v.end} · revisão {v.revision} · {v.source}</li>)}</ul></article>)}<p>Dados mensais: {plan.records.measurements.status} · Custos mensais: {plan.records.costs.status}</p>{plan.records.suppliers.map(s=><p key={s.id}>Contrato {s.number} · {s.start} a {s.end}</p>)}</details>
    </section>
    <section style={panel}><h3>4. Lançamentos propostos</h3><p>Selecione os lançamentos disponíveis. Registros existentes e versões validadas são preservados. Cada etapa tem sua própria gravação auditada; o lote interrompe ao encontrar mudança ou falha.</p>
     {plan.operations.map(o=><article key={o.key} style={panel}><label><input type="checkbox" disabled={!(o.canPropose??o.canCreate)||busy||stale} checked={selected.includes(o.key)} onChange={e=>{setSelected(old=>e.target.checked?[...old,o.key]:old.filter(k=>k!==o.key));setAck(false);}}/> <strong>{o.label}</strong></label><p>{states[o.state]??'Revisão necessária'} · {o.message}</p><Evidence value={o.values??o.candidates}/><button type="button" disabled={busy} onClick={()=>setForm(o.area)}>Consultar / revisar lançamento</button></article>)}
     {plan.canValidate&&<section aria-label="Validação dos preenchimentos"><h4>Conferir e validar os campos preenchidos</h4><p>Revise valores, fontes e vínculos com o PDF. Campos ausentes ou com correção solicitada ficam bloqueados. Classifique explicitamente cada parcela de demanda; ela não é a demanda medida.</p>{(plan.fieldTasks??[]).map(f=><article key={f.kind+':'+f.key}><strong>{f.label}: {f.value??'Não identificado'} {f.unit}</strong><p>{f.description} · Fonte: {f.source||'não identificada'}</p>{f.confirmed?<p>Conferência já salva — preservada.</p>:!f.canConfirm?<p>Requer revisão específica; não pode ser validado em lote.</p>:f.kind==='demand'?<label>Classificação da parcela <select aria-label={'Classificação '+f.label} disabled={busy||stale} value={choices[f.kind+':'+f.key]??''} onChange={e=>{setChoices(old=>{const next={...old};if(e.target.value)next[f.kind+':'+f.key]=e.target.value;else delete next[f.kind+':'+f.key];return next;});setAck(false);}}><option value="">Revisar depois</option><option value="USED">Demanda utilizada</option><option value="UNUSED">Demanda não utilizada</option></select></label>:<label><input type="checkbox" disabled={busy||stale} checked={!!choices[f.kind+':'+f.key]} onChange={e=>{setChoices(old=>{const next={...old};if(e.target.checked)next[f.kind+':'+f.key]='CONFIRMED';else delete next[f.kind+':'+f.key];return next;});setAck(false);}}/> Validar este preenchimento</label>}</article>)}<label>Justificativa e referência no documento<textarea aria-label="Justificativa da validação" value={note} maxLength={500} disabled={busy} onChange={e=>setNote(e.target.value)}/></label><label><input type="checkbox" checked={checkedPdf} disabled={busy||stale} onChange={e=>setCheckedPdf(e.target.checked)}/> Conferi no PDF original os campos e os lançamentos selecionados.</label></section>}
     <label><input type="checkbox" checked={ack} disabled={busy||stale||(!selected.length&&!Object.keys(choices).length)} onChange={e=>setAck(e.target.checked)}/> Conferi os valores e as fontes dos lançamentos selecionados. Confirmo a validação dos preenchimentos e a preparação em rascunho; a aprovação financeira pertence ao gestor/administrador.</label>
     {plan.canValidate?<p><button type="button" disabled={busy||stale||!ack||!checkedPdf||note.trim().length<3||(!selected.length&&!Object.keys(choices).length)} onClick={()=>void validate()}>Validar preenchimentos e preparar lançamentos</button></p>:<p><button type="button" disabled={busy||stale||!ack||!selected.length} onClick={()=>void apply()}>Confirmar e lançar {selected.length} etapa(s)</button></p>}
    </section>
    <section style={panel}><h3>5. Revisão final para apuração</h3><p>{plan.counts.blockers} bloqueio(s) e {plan.counts.reviews} ponto(s) de revisão. {plan.canPrepare?'Diagnóstico sem bloqueios para preparar.':'Resolva os bloqueios e atualize a conferência.'}</p><ul>{plan.findings.map((f,i)=><li key={f.code+':'+i}><strong>{f.severity==='BLOCKER'?'Pendência':'Revisão'} · {f.section}</strong>: {f.message}</li>)}</ul>
     <OcrHomologation id={id}/><p><a href={ocrContractLink(id,'preparation')}>Conferir e preparar apuração</a></p><p>A preparação não publica. Aprovação do gestor e publicação seguem o fluxo financeiro existente.</p>
    </section>
   </>}
  </dialog>
 </section>;
}
