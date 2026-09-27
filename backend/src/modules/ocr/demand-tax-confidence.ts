import type {CpflOperation} from './cpfl-paulista-layout';
const columns=[['icmsAmount','ICMS'],['pisAmount','PIS'],['cofinsAmount','Cofins']] as const;
/** Display-only. Keep this projection outside signed review snapshots and approval gates. */
export function demandTaxConfidence(row:CpflOperation){
 return columns.map(([key,label])=>{
  const f=row.fields[key],direct=f?.confidence,words=f?.transcription;
  const sourced=!!f?.text.trim()&&!!f.pages?.length&&!!f.spans?.length&&!row.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i))&&!f.issues.some(i=>!['MISSING_CONFIDENCE','CONFIDENCE_BELOW_45','CONFIDENCE_REQUIRES_REVIEW'].includes(i));
  const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
  const fieldConfidence=sourced&&valid(direct)?direct:null;
  const wordConfidence=sourced&&direct===null&&words?.state==='VERIFIED_WORDS'&&words.wordCount>0&&valid(words.confidence)?words.confidence:null;
  const confidence=fieldConfidence??wordConfidence;
  return {key,label,source:row.source+'.'+key,pages:f?.pages??[],confidence,method:fieldConfidence!==null?'FIELD_CONFIDENCE':wordConfidence!==null?'MINIMUM_WORD_CONFIDENCE':'UNAVAILABLE',state:confidence===null?'UNAVAILABLE':confidence>0.85?'HIGH_CONFIDENCE':'REVIEW_REQUIRED'};
 });
}
