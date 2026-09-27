import type {CpflOperation} from './cpfl-paulista-layout';
import type {ElectricalField} from './electrical-evidence';
import {transcriptionEvidence} from './transcription-evidence';
const fields=[['description','Descrição'],['unit','Unidade'],['quantity','Quantidade'],['grossRate','Tarifa com tributos'],['amount','Valor da operação'],['icmsAmount','ICMS'],['pisAmount','PIS'],['cofinsAmount','Cofins']] as const;
/** Read-only diagnostics. Never change provider confidence, source, values or approval gates. */
export function cdeConfidenceDiagnostics(raw:any,row:CpflOperation|undefined){
 const values=fields.map(([key,label])=>{
  const f=row?.fields[key];const sourced=!!f?.text.trim()&&!!f.pages.length&&!f.issues.some(i=>i!=='MISSING_CONFIDENCE'&&i!=='CONFIDENCE_BELOW_45'&&i!=='CONFIDENCE_REQUIRES_REVIEW');
  const direct=f?.confidence;const words=f?.transcription;
  const confidence=!sourced?null:typeof direct==='number'&&Number.isFinite(direct)&&direct>=0&&direct<=1?direct:direct===null&&words?.state==='VERIFIED_WORDS'&&typeof words.confidence==='number'&&Number.isFinite(words.confidence)&&words.confidence>=0&&words.confidence<=1?words.confidence:null;
  const method=confidence===null?'UNAVAILABLE':direct!==null?'FIELD_CONFIDENCE':'MINIMUM_WORD_CONFIDENCE';
  return {key,label,confidence,method,state:confidence===null?'UNAVAILABLE':confidence>0.85?'HIGH_CONFIDENCE':'REVIEW_REQUIRED'};
 });
 const numeric=values.filter(v=>!['description','unit'].includes(v.key));
 const numericConfidence=numeric.every(v=>v.confidence!==null)?Math.min(...numeric.map(v=>v.confidence!)):null;
 const words=descriptionWords(raw,row?.fields.description);
 return {fields:values,numericConfidence,descriptionWords:words,reviewFields:values.filter(v=>v.state!=='HIGH_CONFIDENCE').map(v=>v.label),message:'Confiança OCR mede a leitura, não comprova a correção do valor. Conferência humana e aprovação são registros separados.'};
}
function descriptionWords(raw:any,f:ElectricalField|undefined):{text:string;confidence:number;page:number;offset:number}[]{
 if(!f||f.issues.some(i=>!['MISSING_CONFIDENCE','CONFIDENCE_BELOW_45','CONFIDENCE_REQUIRES_REVIEW'].includes(i)))return [];
 const input={content:f.text,spans:f.spans,boundingRegions:f.pages.map(pageNumber=>({pageNumber}))};
 const verified=transcriptionEvidence(raw,input);
 if(verified.state!=='VERIFIED_WORDS'||verified.wordCount>50)return [];
 return raw.pages.filter((p:any)=>f.pages.includes(p.pageNumber)).flatMap((p:any)=>p.words.filter((w:any)=>f.spans.some(s=>w.span?.offset>=s.offset&&w.span.offset+w.span.length<=s.offset+s.length)).map((w:any)=>({text:w.content,confidence:w.confidence,page:p.pageNumber,offset:w.span.offset}))).sort((a:any,b:any)=>a.offset-b.offset);
}
