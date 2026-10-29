import {annualPlanning} from './annual-planning';
import {globalFieldEvidence} from '../ocr/eva-global-model';
import {decimalFromInvoice} from '../ocr/electrical-evidence';
import {cpflReference} from '../ocr/cpfl-measurements';
import {extractCpflPaulistaLayout} from '../ocr/cpfl-paulista-layout';
import {ElectricalField} from '../ocr/electrical-evidence';
import {Observation,Scope,decimal,quantity,monthIndex} from './consumption-forecast';
import {publicationPlanning} from './publication-planning';
import {reportHash} from '../reports/report.projection';

// Planning-only technical evidence. Never changes OCR confidence or financial approval.
function verified(f:ElectricalField){
 return f.pages.length>0&&f.spans.length>0&&f.issues.every(i=>i==='MISSING_CONFIDENCE')&&
  (f.confidence!==null&&f.confidence>0.85||f.confidence===null&&f.transcription?.state==='VERIFIED_WORDS'&&
   typeof f.transcription.confidence==='number'&&f.transcription.confidence>0.85);
}
// Planning-only recovery: one explicit month, one numeric consumption and documented days.
// Only punctuation/axis text may be ignored, with intact original OCR spans.
function planningHistoryReading(h:any,raw:any){
 if(h.decimal!==null||!h.reference||!h.days||h.issues.some((i:string)=>!['HISTORY_VALUE_AMBIGUOUS','HISTORY_FIELD_REVIEW_REQUIRED'].includes(i)))return h;
 const fields=h.evidence as ElectricalField[];if(fields.length<2)return h;
 const day=fields.at(-1)!;if(day.text.trim()!==String(h.days)||!verified(day)||!globalFieldEvidence(raw,day).filled)return h;
 const parts=fields.slice(0,-1),re=/\b(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*[/ -]?\s*(?:[0-9]{4}|[0-9]{2})\b/g;
 const tokens=parts.flatMap(f=>f.text.toUpperCase().match(re)??[]);if(tokens.length!==1)return h;
 const token=/^([A-Z]{3})\s*[/ -]?\s*(\d{4}|\d{2})$/.exec(tokens[0]);if(!token)return h;
 const year=token[2].length===2?h.reference.slice(0,4):token[2];
 if(token[2].length===2&&year.slice(-2)!==token[2]||cpflReference(token[1]+' '+year)!==h.reference)return h;
 const values:string[]=[];let punctuation=false;
 for(const f of parts){
  if(!globalFieldEvidence(raw,f).filled)return h;
  const hasMonth=(f.text.toUpperCase().match(re)??[]).length>0,rest=f.text.toUpperCase().replace(re,'').trim();
  if(hasMonth&&!verified(f))return h;
  if(!rest)continue;
  if(/^[./]$/.test(rest)){punctuation=true;continue;}
  if(['CONSUMO','KWH'].includes(rest))continue;
  const value=decimalFromInvoice(rest);if(value===null||value.startsWith('-')||!verified(f))return h;values.push(value);
 }
 if(!punctuation||values.length!==1)return h;
 return {...h,decimal:values[0],issues:h.issues.filter((i:string)=>i!=='HISTORY_VALUE_AMBIGUOUS'),planningRecovered:true};
}
export function invoicePlanningHistory(scope:Scope,invoice:any){
 const rows:Observation[]=[],pending:string[]=[],recovered:string[]=[];
 if(!invoice)return {rows,pending,recovered};
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(invoice.month)||!/^([a-f0-9]{64})$/.test(invoice.fileHash??'')||!invoice.documentId||!invoice.publicationId||!Number.isFinite(Date.parse(invoice.publishedAt)))throw Error('INVOICE_SOURCE_INVALID');
 const history=(extractCpflPaulistaLayout(invoice.raw).measurements?.history??[]).map(h=>planningHistoryReading(h,invoice.raw));
 const months=[...new Set(history.filter(h=>h.metric==='CONSUMPTION'&&h.reference&&h.reference<=invoice.month).map(h=>h.reference!))].sort().slice(-36);
 for(const month of months){
  const pick=(period:string)=>history.filter(h=>h.reference===month&&h.metric==='CONSUMPTION'&&h.period===period);
  const p=pick('PEAK'),o=pick('OFF_PEAK'),both=[...p,...o];
  if(p.length!==1||o.length!==1||both.some(h=>h.unit!=='kWh'||!h.decimal||h.issues.some((i:string)=>i!=='HISTORY_FIELD_REVIEW_REQUIRED')||!h.evidence.length||!h.evidence.every((f:ElectricalField)=>verified(f)||/^(?:[./]|Consumo|kWh)$/i.test(f.text.trim())&&globalFieldEvidence(invoice.raw,f).filled))||!p[0].days||p[0].days!==o[0].days){pending.push(month+': conferir consumo histórico e dias na fatura publicada.');continue;}
  try{if(both.some(h=>h.planningRecovered))recovered.push(month);rows.push({month,consumptionKwh:decimal(quantity(p[0].decimal!)+quantity(o[0].decimal!)),billedDays:p[0].days!,evidence:{...scope,id:'invoice-history:'+invoice.documentId,revision:1,hash:invoice.fileHash,validatedBy:'planning-source-validation/1',validatedAt:invoice.publishedAt}});}catch{pending.push(month+': valor histórico inválido.');}
 }
 return {rows,pending,recovered};
}
export function cceePlanningObservation(scope:Scope,source:any):Observation|null{
 try{
  const r=source.record,d=source.data,m=source.month;
  if(['organizationId','customerId','unitId'].some(k=>r?.binding?.[k]!==scope[k as keyof Scope])||r?.kind!=='CONSUMPTION'||r?.schemaVersion!=='ccee-record/1'||r.evidence?.finality!=='FINAL'||r.evidence.month!==m||!/^([a-f0-9]{64})$/.test(r.evidence.sourceHash)||d?.timeSemantics!=='CCEE_HOUR_LABEL_V2')return null;
  monthIndex(m);const days=new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5)),0)).getUTCDate(),expected=days*24;
  if(d.expectedHours!==expected||!Array.isArray(d.rows)||d.rows.length!==expected||!Array.isArray(r.lines)||r.lines.length!==1||r.lines[0].includesLosses!==false||r.lines[0].code!=='CONSUMPTION_TOTAL')return null;
  const seen=new Set<string>();let total=0n;
  for(const h of d.rows){
   const stamp=h.hourLabel;
   if(typeof stamp!=='string'||!stamp.startsWith(m+'-')||!/^20\d{2}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):00:00-03:00$/.test(stamp)||Number(stamp.slice(8,10))<1||Number(stamp.slice(8,10))>days||seen.has(stamp)||h.status!=='HCC'||!['kWh','MWh'].includes(h.unit)||!h.unitEvidence)return null;
   seen.add(stamp);total+=quantity(h.quantityKwh);
  }
  if(total!==quantity(d.totalKwh)||total!==quantity(r.lines[0].quantityKwh)||!Number.isFinite(Date.parse(source.finishedAt)))return null;
  return {month:m,consumptionKwh:decimal(total),billedDays:days,evidence:{...scope,id:'ccee:'+source.id,revision:1,hash:r.evidence.sourceHash,validatedBy:'planning-source-validation/1',validatedAt:source.finishedAt}};
 }catch{return null;}
}
/** Input is service-authorized; only aggregate forecast values leave the backend. */
export function automaticPlanning(scope:Scope,sources:any,publications:any[],at:string,seed?:any,weather?:any){
 if(['organizationId','customerId','unitId'].some(k=>sources[k]!==scope[k as keyof Scope]))throw Error('SOURCE_SCOPE_INVALID');
 const invoice=invoicePlanningHistory(scope,sources.invoice),actual=new Map<string,Observation>();
 for(const a of invoice.rows)actual.set(a.month,a);
 // Previously reviewed precise history takes precedence over rounded invoice history.
 for(const a of seed?.actual??[])actual.set(a.month,a);
 const cutoff=publications.map(p=>p.month).sort().at(-1)??seed?.asOfMonth;
 const ccee=new Map<string,Observation>();
 for(const candidate of sources.ccee??[]){const o=cceePlanningObservation(scope,candidate);if(o&&o.month<=cutoff){if(ccee.has(o.month))throw Error('CCEE_MONTH_AMBIGUOUS');ccee.set(o.month,o);actual.set(o.month,o);}}
 const usable=publications.filter(p=>!ccee.has(p.month));
 const body={...seed,...scope,actual:[...actual.values()].filter(a=>a.month<=cutoff&&monthIndex(a.month)>=monthIndex(cutoff)-35),expansions:seed?.expansions??[]};
 const sourceOrigins=new Map<string,string>([...actual.values()].map(a=>[a.month,ccee.has(a.month)?'CCEE_FINAL':seed?.actual?.some((s:any)=>s.month===a.month)?'REVIEWED_HISTORY':'PUBLISHED_INVOICE_HISTORY']));
 const annualComparison=annualPlanning(scope,body.actual,usable,cutoff,sourceOrigins,body.expansions,at);
 annualComparison.pending.push(...invoice.pending);
 let plan:ReturnType<typeof publicationPlanning>;
 try{plan=publicationPlanning(body,usable,at,weather);}catch(e){
  const message=e instanceof Error?e.message:'';
  if(!/^HISTORY_(12_TO_36_REQUIRED|GAP_DUPLICATE_OR_FUTURE)$/.test(message))throw e;
  return {annualComparison,state:'SOURCE_PENDING' as const,pending:invoice.pending.length?invoice.pending:['São necessários pelo menos 12 meses consecutivos de consumo e dias documentados para calcular a projeção.'],sources:[]};
 }
 if(plan.state!=='AVAILABLE')return {...plan,annualComparison,pending:[...plan.pending,...invoice.pending]};
 const origin=plan.current.actual.map((a:any)=>({month:a.month,kind:ccee.has(a.month)?'CCEE_FINAL':usable.some(p=>p.month===a.month)?'PUBLISHED_CONSUMPTION':seed?.actual?.some((s:any)=>s.month===a.month)?'REVIEWED_HISTORY':'PUBLISHED_INVOICE_HISTORY'}));
 return {...plan,annualComparison,sourceFingerprint:reportHash({planning:plan.sourceFingerprint,origin,ccee:[...ccee.values()].map(a=>a.evidence.hash)}),origins:origin};
}
