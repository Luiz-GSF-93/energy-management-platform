import type {CpflOperation} from './cpfl-paulista-layout';
/** Display-only evidence. Missing amounts never become zero or a tax exemption. */
export function demandTaxReview(row:CpflOperation){
 return (row.fields.pisCofinsAmount?[['icmsAmount','ICMS'],['pisCofinsAmount','PIS/Cofins conjunto']]:[['icmsAmount','ICMS'],['pisAmount','PIS'],['cofinsAmount','Cofins']]).map(([key,label])=>{
  const f=row.fields[key];
  const missing=!f?.text?.trim();
  const numeric=typeof f?.decimal==='string'&&/^[0-9]+(?:[.][0-9]+)?$/.test(f.decimal);
  const ambiguous=row.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i))||Boolean(f?.issues.some(i=>i!=='MISSING_CONFIDENCE'));
  const state=missing?'MISSING':!numeric||ambiguous?'REVIEW':/^0+(?:[.]0+)?$/.test(f.decimal!)?'ZERO':'POSITIVE';
  const confidence=typeof f?.confidence==='number'&&Number.isFinite(f.confidence)&&f.confidence>=0&&f.confidence<=1?f.confidence:null;
  return {key,label,text:f?.text??'',decimal:numeric?f.decimal:null,state,confidence,pages:f?.pages??[],source:row.source+'.'+key,
   message:state==='MISSING'?'Valor não identificado. Conferir esta coluna no PDF; ausência não significa zero.':state==='REVIEW'?'Valor extraído com origem ou formato a conferir no PDF.':state==='ZERO'?'Zero explícito na extração; confirmar o tratamento na fatura.':'Valor positivo extraído da fatura.',
   confidenceMessage:confidence===null?'Confiança do campo não informada; exige conferência.':'Confiança da extração; não representa aprovação tributária.'};
 });
}
