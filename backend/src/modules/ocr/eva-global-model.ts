import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {transcriptionEvidence} from './transcription-evidence';
import {AiEvidence} from './azure-backoffice-ai.connector';

const list=(v:any):any[]=>Array.isArray(v)?v:[];
const valid=(v:any):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
const normalize=(v:any)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const useful=(v:string)=>v.replace(/\s/g,'').length;
/** A separate derived transcription metric; never overwrites native OCR confidence. */
export function globalFieldEvidence(raw:any,f:any){
 const text=String(f?.text??'');
 const content=String(raw?.content??'');const spans=list(f?.spans);
 const verified=!!text.trim()&&spans.length>0&&list(f?.pages).length>0&&spans.every(s=>Number.isSafeInteger(s.offset)&&s.offset>=0&&Number.isSafeInteger(s.length)&&s.length>0&&s.offset+s.length<=content.length)&&spans.map(s=>content.slice(s.offset,s.offset+s.length)).join(' ').replace(/\s/g,'')===text.replace(/\s/g,'')&&list(f?.pages).every(n=>list(raw?.pages).some(p=>p.pageNumber===n))&&!list(f?.issues).some(x=>['UNVERIFIED_SOURCE','INVALID_DECIMAL','MISSING_VALUE','NON_BRL_CURRENCY'].includes(x));
 if(!verified)return {confidence:null,method:'UNAVAILABLE',filled:false,weight:Math.max(1,useful(text))};
 if(valid(f.confidence))return {confidence:f.confidence,method:'PROVIDER_FIELD',filled:true,weight:Math.max(1,useful(text))};
 const input={content:text,spans:f.spans,boundingRegions:f.pages.map((pageNumber:number)=>({pageNumber}))};
 if(transcriptionEvidence(raw,input).state!=='VERIFIED_WORDS')return {confidence:null,method:'UNAVAILABLE',filled:true,weight:Math.max(1,useful(text))};
 const words=list(raw.pages).filter(p=>f.pages.includes(p.pageNumber)).flatMap(p=>list(p.words)).filter(w=>list(f.spans).some(s=>w.span.offset>=s.offset&&w.span.offset+w.span.length<=s.offset+s.length));
 const total=words.reduce((n,w)=>n+useful(w.content),0);
 return {confidence:total?words.reduce((n,w)=>n+w.confidence*useful(w.content),0)/total:null,method:'VERIFIED_WORDS_WEIGHTED',filled:true,weight:Math.max(1,useful(text))};
}
const labels=['Identificação e período','Enquadramento','Consumo e demanda','Tarifas e rubricas','Totais e tributos'];
const fieldLabels:Record<string,string>={customerTaxId:'CNPJ do cliente',unit:'Unidade/instalação',reference:'Competência',classification:'Classificação tarifária',description:'Descrição da rubrica',quantity:'Quantidade faturada',rate:'Tarifa',amount:'Valor da rubrica',invoiceTotal:'Total da fatura',total:'Total',icmsAmount:'ICMS',pisAmount:'PIS',cofinsAmount:'Cofins'};
/** Scoped V2 projection: never mutates the shared OCR parser or its historical result. */
export function globalModelLayout(raw:any){
 const layout=extractCpflPaulistaLayout(raw);
 return {...layout,operations:layout.operations.map(row=>{
  const label=String(row.fields.description?.text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
  const amount=row.fields.amount?.decimal;
  if(row.role!=='UNKNOWN'||row.component!=='OTHER'||!/^ATUALIZACAO MONETARIA(?:\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/\d{2}(?:\d{2})?)?$/.test(label)||typeof amount!=='string'||! /^-?\d+(?:\.\d{1,2})?$/.test(amount)||!globalFieldEvidence(raw,row.fields.description).filled||!globalFieldEvidence(raw,row.fields.amount).filled)return row;
  return {...row,component:'MONETARY_CORRECTION',role:(amount.startsWith('-')?'CREDIT':'CHARGE') as typeof row.role,issues:row.issues.filter(i=>i!=='UNMAPPED_COMPONENT')};
 })};
}
/** V2 aggregates five equally weighted sections. Coverage is never hidden by a high average. */
export function globalModelConfidence(raw:any,threshold=0.9,profile?:any){
 const layout=globalModelLayout(raw),sections=labels.map((label,index)=>({key:index,label,fields:[] as any[]}));let count=0,truncated=false;
 const add=(section:number,key:string,f:any,source:string,numeric=false)=>{
  if(count++>=200){truncated=true;return;}
  const suffix=key.split('.').pop()!;
  const row=layout.operations.find(r=>r.source===source);
  const item={key,label:(fieldLabels[suffix]??suffix)+(row?.fields.description?.text?' — '+row.fields.description.text:''),value:numeric?f?.decimal??null:f?.text??null,source,pages:list(f?.pages),spans:list(f?.spans),issues:list(f?.issues),...globalFieldEvidence(raw,f)};
  if(numeric&&typeof f?.decimal!=='string'){item.filled=false;item.confidence=null;}
  sections[section].fields.push(item);
 };
 for(const [key,section] of [['customerTaxId',0],['unit',0],['reference',0],['classification',1]] as const){
  const candidates=layout.fields.filter(f=>f.name===key),unique=[...new Set(candidates.map(f=>normalize(f.value.text)))];
  const found=unique.length===1?candidates.find(f=>globalFieldEvidence(raw,f.value).confidence!==null)??candidates[0]:null;
  add(section,key,found?.value,found?.source??'Não localizada');
 }
 const rows=layout.operations.filter(r=>r.role==='CHARGE'||r.role==='CREDIT');
 for(const row of rows){
  add(3,row.source+'.description',row.fields.description,row.source);
  add(4,row.source+'.amount',row.fields.amount,row.source,true);
  if(['TE','TUSD_ENERGY','DEMAND_BILLED','DEMAND_UNUSED','REACTIVE_ENERGY'].includes(row.component)){
   add(2,row.source+'.quantity',row.fields.quantity,row.source,true);
   add(3,row.source+'.rate',row.fields.aneelRate?.decimal?row.fields.aneelRate:row.fields.grossRate,row.source,true);
   add(2,row.source+'.unit',row.fields.unit,row.source);
  }
  for(const key of ['icmsAmount','pisAmount','cofinsAmount'])if(row.fields[key]?.text?.trim())add(4,row.source+'.'+key,row.fields[key],row.source,true);
 }
 const totals=layout.operations.filter(r=>r.role==='TOTAL'&&r.fields.amount?.decimal);
 if(totals.length)for(const row of totals)add(4,row.source+'.total',row.fields.amount,row.source,true);
 else add(4,'invoiceTotal',null,'Não localizada',true);
 for(const section of sections)if(!section.fields.length)add(section.key,'section-'+section.key,null,'Não localizada');
 const summaries=sections.map(section=>{
  // Repeated projection of the same source must not increase its influence.
  const seen=new Set<string>();const fields=section.fields.filter(f=>{const id=JSON.stringify([f.spans.length?f.spans:f.source,f.value]);if(seen.has(id))return false;seen.add(id);return true});
  const weight=fields.reduce((n,f)=>n+f.weight,0),known=fields.filter(f=>f.confidence!==null);
  const filled=fields.filter(f=>f.filled).length;
  return {...section,fields,score:known.length?fields.reduce((n,f)=>n+(f.confidence??0)*f.weight,0)/weight:null,confidenceCoverage:known.length/fields.length,filled,total:fields.length,complete:filled===fields.length};
 });
 const fields=summaries.flatMap(s=>s.fields),known=fields.filter(f=>f.confidence!==null).length;
 const score=known?summaries.reduce((n,s)=>n+(s.score??0),0)/summaries.length:null;
 const classification=layout.fields.filter(f=>f.name==='classification').map(f=>normalize(f.value.text));
 const modality=({GREEN:'VERDE',BLUE:'AZUL',WHITE:'BRANCA',CONVENTIONAL:'CONVENCIONAL'} as any)[profile?.tariff_modality];
 const profileMatches=!profile||layout.fields.filter(f=>f.name==='classification').some(f=>{const tokens=String(f.value.text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().split(/[^A-Z0-9]+/);return !!profile.tariff_subgroup&&tokens.includes(normalize(profile.tariff_subgroup))&&!!modality&&tokens.includes(modality)});
 const consistent=profileMatches&&!!layout.layoutId&&layout.reconciliation.state==='MATCH'&&rows.length>0&&!rows.some(r=>r.role==='UNKNOWN'||r.arithmetic?.state==='DIFFERENCE'||r.arithmetic?.state==='DIVERGENT'||r.issues.some(x=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN','UNMAPPED_COMPONENT','UNVERIFIED_SOURCE'].includes(x)))&&!layout.operations.some(r=>r.role==='UNKNOWN');
 const complete=!truncated&&summaries.every(s=>s.complete);
 const reviewReasons=[...(!profileMatches?['Enquadramento diferente do cadastro.']:[]),...(layout.reconciliation.state!=='MATCH'?['Totais da fatura não conciliados.']:[]),...layout.operations.filter(r=>r.role==='UNKNOWN'||r.arithmetic?.state==='DIFFERENCE'||r.arithmetic?.state==='DIVERGENT'||r.issues.some(x=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN','UNMAPPED_COMPONENT','UNVERIFIED_SOURCE'].includes(x))).map(r=>({source:r.source,label:r.fields.description?.text??'Rubrica não identificada',reason:r.role==='UNKNOWN'?'Rubrica não classificada':'Fonte ou cálculo da rubrica requer conferência'}))];
 const monetaryCorrections=layout.operations.filter(r=>r.component==='MONETARY_CORRECTION').map(r=>({source:r.source,label:r.fields.description.text,amount:r.fields.amount.decimal,role:r.role}));
 return {version:2,method:'EQUAL_SECTION_WEIGHTED_EVIDENCE_V2',threshold,score,profileMatches,consistent,complete,truncated,completion:truncated?null:fields.filter(f=>f.filled).length/fields.length,confidenceCoverage:known/fields.length,sections:summaries,fields,reviewReasons,monetaryCorrections,layout:layout.layoutId,aiScore:null,state:score!==null&&score>=threshold&&consistent&&complete?'READY_FOR_REVIEW':'NEEDS_REVISION',message:truncated?'Documento excede o limite de evidências desta preparação. Nenhuma homologação integral; revisar cobertura.':'Confiança global da leitura, com cinco seções de mesmo peso. Seções não exigem 90% individual. Preenchimento e consistência são conferidos separadamente; referências não elevam a confiança OCR.'};
}
/** The values are already prepared. Ask for a short interpretation, not a copy of every field. */
export function globalAdviceEvidence(e:ReturnType<typeof globalModelConfidence>):AiEvidence[]{
 const pct=(n:number|null)=>n===null?'Não disponível':(n*100).toFixed(1)+'%';
 return [{id:'model-quality',label:'Resultado calculado da preparação',source:'Motor V2 do backend; não é aprovação financeira',value:JSON.stringify({confidence:pct(e.score),criterion:pct(e.threshold),completion:pct(e.completion),coverage:pct(e.confidenceCoverage),preparedFields:e.fields.filter(f=>f.filled).length,state:e.state,consistent:e.consistent,sections:e.sections.map(s=>({label:s.label,score:pct(s.score),filled:s.filled,total:s.total})),reviewReasons:e.reviewReasons.slice(0,8),monetaryCorrections:e.monetaryCorrections.slice(0,8)})}];
}
/** Only individually scoped facts are sent, never the PDF or arbitrary source URLs. */
export function globalPreparationEvidence(evaluation:ReturnType<typeof globalModelConfidence>,limit=140):AiEvidence[]{
 return evaluation.fields.filter(f=>f.filled&&typeof f.value==='string').slice(0,Math.min(200,limit)).map((f,i)=>({id:'value-'+i,fieldKey:f.key,label:f.label,value:f.value,source:f.source}));
}
/** Every generated field is checked again against its exact source and key. No arithmetic by LLM. */
export function verifiedGlobalPreparation(evidence:AiEvidence[],advice:any){
 const seen=new Set<string>();const proposed=list(advice?.state==='READY'?advice.fields:[]);
 const fields=proposed.filter(f=>{const source=evidence.find(e=>e.id===f.evidenceId&&e.fieldKey===f.key&&e.value===f.value);if(!source||seen.has(f.key))return false;seen.add(f.key);return true}).map(f=>({...f,label:evidence.find(e=>e.id===f.evidenceId)!.label,origin:'OCR_AI_VERIFIED',source:evidence.find(e=>e.id===f.evidenceId)!.source}));
 // Already mapped values do not depend on a generative response to remain available.
 for(const e of evidence)if(e.fieldKey&&!seen.has(e.fieldKey)){seen.add(e.fieldKey);fields.push({key:e.fieldKey,label:e.label,value:e.value,evidenceId:e.id,origin:'OCR_MAPPED',source:e.source});}
 return {version:2,state:fields.length?'PREPARED':'NO_EVIDENCE',fields,rejected:proposed.length-fields.filter(f=>f.origin==='OCR_AI_VERIFIED').length,automaticFinancialApproval:false};
}
