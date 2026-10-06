/** Month-start date or timestamp serialized by the document registry. */
export function aclInvoiceReferenceMonth(value:unknown):string|null {
 return typeof value==='string' && /^20[0-9]{2}-(0[1-9]|1[0-2])-01(?:T00:00:00(?:\.0+)?(?:Z|\+00:00)?)?$/.test(value) ? value.slice(0,7) : null;
}
import type { HistoryReading } from '../ocr/cpfl-measurements';
export type AclHistoryRow={month:string;peakKwh:string;offPeakKwh:string;demandKw:string;days:number;page:number;source:string};
const decimal=/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/;
export function validAclHistory(value:unknown,documentIds:string[]):boolean {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const h=value as any;
 if(Object.keys(h).sort().join(',')!=='rows,sourceDocumentId'||documentIds.length!==1||h.sourceDocumentId!==documentIds[0]||!Array.isArray(h.rows)||h.rows.length!==12)return false;
 let previous='';
 for(const r of h.rows){
  if(!r||Object.keys(r).sort().join(',')!=='days,demandKw,month,offPeakKwh,page,peakKwh,source'||!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(r.month)||!['peakKwh','offPeakKwh','demandKw'].every(k=>typeof r[k]==='string'&&decimal.test(r[k]))||!Number.isInteger(r.days)||r.days<1||r.days>62||!Number.isInteger(r.page)||r.page<1||r.page>100||typeof r.source!=='string'||!r.source.trim()||r.source.length>180)return false;
  if(previous){const date=new Date(previous+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+1);if(date.toISOString().slice(0,7)!==r.month)return false;}
  previous=r.month;
 }return true;
}
/** Draft from preserved OCR. Ambiguous/missing values remain empty for review. */
export function aclHistoryDraft(history:HistoryReading[],anchor:string){
 const rows:AclHistoryRow[]=[],issues:string[]=[];
 for(let i=11;i>=0;i--){const date=new Date(anchor+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-i);const month=date.toISOString().slice(0,7);
  const pick=(metric:string,period:string)=>{const values=history.filter(h=>h.reference===month&&h.metric===metric&&h.period===period);return values.length===1?values[0]:null;};
  const p=pick('CONSUMPTION','PEAK'),o=pick('CONSUMPTION','OFF_PEAK'),d=pick('DEMAND','TOTAL');
  const values=[p,o,d],days=values.map(v=>v?.days),pages=values.flatMap(v=>v?.evidence.flatMap(e=>e.pages)??[]).filter(Number.isInteger);
  if(values.some(v=>!v?.decimal||v.issues.length)||new Set(days).size!==1)issues.push(month+': conferir valores, dias e fontes');
  rows.push({month,peakKwh:p?.decimal??'',offPeakKwh:o?.decimal??'',demandKw:d?.decimal??'',days:days[0]??0,page:pages.length?Math.min(...pages):0,source:values.map(v=>v?.source).filter(Boolean).join('; ').slice(0,180)});
 }return {rows,issues,reviewRequired:true,costHistoryAvailable:false};
}
