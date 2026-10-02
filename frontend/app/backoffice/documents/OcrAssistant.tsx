'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {ocrContractLink,type OcrDestination} from '../contracts/ocr-navigation';
import OcrIdentityPreview from './OcrIdentityPreview';
import OcrFieldReviews from './OcrFieldReviews';
import OcrDemandReviews from './OcrDemandReviews';
import OcrHomologation from './OcrHomologation';
import OcrReadout,{type ReadoutSummary} from './OcrReadout';
type Finding={code:string;section:string;severity:string;message:string};
type Operation={key:string;label:string;area:OcrDestination;state:string;canCreate:boolean;message:string;values?:unknown;candidates?:unknown};
type History={inputId:string;month:string;version:number;previous:string|null;current:string|null;state:string;message:string};
type Plan={token:string;documentId:string;unitName:string;month:string;checkedAt:string;message:string;canPrepare:boolean;
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
export default function OcrAssistant({id,canProcess,autoStart=false}:{id:string;canProcess:boolean;autoStart?:boolean}) {
 const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0),writing=useRef(false);
 const [plan,setPlan]=useState<Plan|null>(null),[busy,setBusy]=useState(autoStart),[stale,setStale]=useState(true),[error,setError]=useState('');
 const [selected,setSelected]=useState<string[]>([]),[ack,setAck]=useState(false),[receipts,setReceipts]=useState<Receipt[]>([]),[notice,setNotice]=useState(''),[review,setReview]=useState(false);
 const install=useCallback((next:Plan)=>{setPlan(next);setSelected(next.operations.filter(o=>o.canCreate).map(o=>o.key));setAck(false);setStale(false);},[]);
 const load=useCallback(async()=>{
  if(writing.current)return;
  const g=++generation.current;setBusy(true);setStale(true);setError('');
  try{const next=await apiRequest<Plan>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/assistant');if(g===generation.current)install(next);}
  catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Não foi possível conferir a fatura. Atualize antes de lançar.');}
  finally{if(g===generation.current)setBusy(false);}
 },[id,install]);
 useEffect(()=>{
  const request=generation;
  if(autoStart){
   const g=++request.current;
   apiRequest<Plan>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/assistant')
    .then(next=>{if(g===request.current)install(next);})
    .catch(e=>{if(g===request.current)setError(e instanceof Error?e.message:'Não foi possível conferir a fatura. Atualize antes de lançar.');})
    .finally(()=>{if(g===request.current)setBusy(false);});
  }
  return()=>{request.current++;};
 },[id,autoStart,install]);
 useEffect(()=>{
  const refresh=()=>{if(dialog.current?.open)void load();};
  window.addEventListener('focus',refresh);
  return()=>window.removeEventListener('focus',refresh);
 },[load]);
 async function apply(){
  if(!plan||busy||stale||!ack||!selected.length||writing.current)return;
  writing.current=true;const g=++generation.current;setBusy(true);setError('');setNotice('');setReceipts([]);
  try{const saved=await apiRequest<Applied>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/assistant',{method:'POST',body:{token:plan.token,operations:selected,acknowledged:true}});
   if(g!==generation.current)return;
   setReceipts(saved.receipts);setNotice(saved.message);setAck(false);
   if(saved.current)install(saved.current);else setStale(true);
  }catch(e){if(g===generation.current){setError((e instanceof Error?e.message:'Não foi possível confirmar os lançamentos.')+' Consulte o histórico antes de tentar novamente.');setStale(true);setAck(false);}}
  finally{writing.current=false;if(g===generation.current)setBusy(false);}
 }
 return <section aria-label="Assistente de conferência OCR" style={{marginTop:12}}>
  <button type="button" onClick={()=>{dialog.current?.showModal();void load();}}>Assistente IA da fatura</button>
  <p>{busy?'Conferindo extração e cadastros…':plan?plan.counts.blockers+' pendência(s) para preparar apuração':'Assistente de conferência disponível após a extração.'}</p>
  <dialog ref={dialog} aria-label="Assistente IA da fatura" style={{width:'min(1100px,94vw)',maxHeight:'90vh',overflow:'auto',background:'#101b2c',color:'#f0f5ff',border:'1px solid #536984',borderRadius:16,padding:24}}>
   <button type="button" onClick={()=>dialog.current?.close()} disabled={busy}>Fechar assistente</button>
   <h2>Assistente IA da fatura</h2><p>Leitura Azure, conferência pelas regras existentes e preparação assistida dos lançamentos.</p>
   <button type="button" disabled={busy} onClick={()=>void load()}>Atualizar conferência</button>
   {busy&&<p role="status">Conferindo dados, histórico e vigências…</p>}{error&&<p role="alert">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   {receipts.length>0&&<section style={panel}><h3>Resultado dos lançamentos</h3><ul>{receipts.map(r=><li key={r.key}><strong>{r.label}: {r.state==='SAVED_DRAFT'?'rascunho registrado':r.state==='VERIFY_REQUIRED'?'verificar histórico antes de repetir':'revisão necessária'}</strong>{r.message&&<p>{r.message}</p>}<Evidence value={r.result}/></li>)}</ul></section>}
   {plan&&<>
    <h3>{plan.unitName} · {plan.month}</h3><p>{plan.message}</p><small>Consulta em {new Date(plan.checkedAt).toLocaleString('pt-BR')}{stale?' · Atualização obrigatória antes de lançar':''}</small>
    <section style={panel}><h3>1. Dados extraídos e dúvidas</h3>
     <p>Confiança mínima dos campos essenciais: {plan.confidence.criticalConfidence.complete&&plan.confidence.criticalConfidence.minimumAll!==null?(plan.confidence.criticalConfidence.minimumAll*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%':'indeterminada — informação incompleta'}.</p>
     <p>Abaixo de 45%: automação bloqueada. Entre 45% e 85%: conferência humana. Acima de 85%: elegível somente após as demais verificações. A confirmação humana não altera a confiança OCR.</p>
     <OcrReadout id={id} summary={plan.confidence}/>
     <ul>{plan.values.map(v=><li key={v.key}><strong>{v.label}: {v.value??'Não identificado'} {v.unit}</strong><p>{v.review?.decision==='CONFIRMED'?'Conferência salva · versão '+v.review.version+' · '+v.review.author:v.review?.decision==='NEEDS_CORRECTION'?'Correção solicitada':'Conferência pendente'} · Fonte: {v.sources.join(', ')||'não identificada'}</p></li>)}</ul>
     <button type="button" onClick={()=>setReview(v=>!v)}>{review?'Ocultar campos de revisão':'Conferir dados ou solicitar revisão'}</button>
     {review&&<><p>Abra o campo correspondente, escolha confirmar ou solicitar correção e registre a evidência ou o requisito de revisão. Depois atualize o assistente.</p><OcrIdentityPreview id={id}/><OcrFieldReviews id={id} canReview={canProcess}/><OcrDemandReviews id={id} canReview={canProcess}/></>}
    </section>
    <section style={panel}><h3>2. Comparação com o histórico da unidade</h3>{!plan.comparisons.length?<p>Não há competência anterior validada disponível para comparar. Nenhum histórico foi presumido.</p>:<ul>{plan.comparisons.map(h=><li key={h.inputId}><strong>{h.month} · versão {h.version}: {h.previous??'não informado'} kWh</strong><p>{h.message}</p></li>)}</ul>}</section>
    <section style={panel}><h3>3. Cadastros e vigências</h3><p>Configurações que cobrem a competência são reutilizadas. O assistente solicita complementação quando há ausência, conflito ou bloqueio; a fatura não determina preço do fornecedor nem honorários.</p><p>Os formulários abrem nesta aba para manter a organização ativa. Depois da revisão, volte a Documentos e consulte novamente o assistente.</p>
     <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',gap:12}}>{plan.configurations.map(c=><article key={c.area} style={panel}><h4>{c.label}</h4><p>{c.state==='AVAILABLE'?'Disponível na competência':'Requer informação ou revisão'}</p>{c.findings.map(f=><p key={f.code}>{f.message}</p>)}<a href={ocrContractLink(id,c.area)}>{c.state==='AVAILABLE'?'Consultar registros':'Completar / revisar em tela'}</a></article>)}</div>
     <details><summary>Ver vigências e fontes dos parâmetros</summary>{plan.records.catalog.map(c=><article key={c.key}><strong>{c.label}</strong><ul>{c.versions.map(v=><li key={v.id}>{v.start} a {v.end} · revisão {v.revision} · {v.source}</li>)}</ul></article>)}<p>Dados mensais: {plan.records.measurements.status} · Custos mensais: {plan.records.costs.status}</p>{plan.records.suppliers.map(s=><p key={s.id}>Contrato {s.number} · {s.start} a {s.end}</p>)}</details>
    </section>
    <section style={panel}><h3>4. Lançamentos propostos</h3><p>Selecione os lançamentos disponíveis. Registros existentes e versões validadas são preservados. Cada etapa tem sua própria gravação auditada; o lote interrompe ao encontrar mudança ou falha.</p>
     {plan.operations.map(o=><article key={o.key} style={panel}><label><input type="checkbox" disabled={!o.canCreate||busy||stale} checked={selected.includes(o.key)} onChange={e=>{setSelected(old=>e.target.checked?[...old,o.key]:old.filter(k=>k!==o.key));setAck(false);}}/> <strong>{o.label}</strong></label><p>{states[o.state]??'Revisão necessária'} · {o.message}</p><Evidence value={o.values??o.candidates}/><a href={ocrContractLink(id,o.area)}>Consultar / revisar lançamento</a></article>)}
     <label><input type="checkbox" checked={ack} disabled={busy||stale||!selected.length} onChange={e=>setAck(e.target.checked)}/> Conferi os valores e as fontes dos lançamentos selecionados. Confirmo a criação em rascunho para revisão.</label>
     <p><button type="button" disabled={busy||stale||!ack||!selected.length} onClick={()=>void apply()}>Confirmar e lançar {selected.length} etapa(s)</button></p>
    </section>
    <section style={panel}><h3>5. Revisão final para apuração</h3><p>{plan.counts.blockers} bloqueio(s) e {plan.counts.reviews} ponto(s) de revisão. {plan.canPrepare?'Diagnóstico sem bloqueios para preparar.':'Resolva os bloqueios e atualize a conferência.'}</p><ul>{plan.findings.map((f,i)=><li key={f.code+':'+i}><strong>{f.severity==='BLOCKER'?'Pendência':'Revisão'} · {f.section}</strong>: {f.message}</li>)}</ul>
     <OcrHomologation id={id}/><p><a href={ocrContractLink(id,'preparation')}>Conferir e preparar apuração</a></p><p>A preparação não publica. Aprovação do gestor e publicação seguem o fluxo financeiro existente.</p>
    </section>
   </>}
  </dialog>
 </section>;
}
