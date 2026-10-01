const exact=(v:string)=>{const [whole,fraction='']=v.split('.');return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));};
const keys:Record<string,string>={consumptionPeakKwh:'consumptionPeak',consumptionOffPeakKwh:'consumptionOffPeak',consumptionTotalKwh:'consumptionTotal'};
export function compatibleMonthlyDraft(current:any,doc:any,fields:any[]):boolean {
 if(!current||current.status!=='DRAFT'||!Number.isInteger(current.revision)||current.customer_id!==doc.customer_id||current.consumer_unit_id!==doc.consumer_unit_id||current.month!==String(doc.reference_month).slice(0,7)||!current.measurements||(current.source_ocr_document_id&&current.source_ocr_document_id!==doc.id))return false;
 if(fields.length!==3||new Set(fields.map(f=>f.key)).size!==3)return false;
 return fields.every(f=>{const key=keys[f.key],old=current.measurements[key];return !!key&&typeof f.decimal==='string'&&/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/.test(f.decimal)&&(old==null||(typeof old==='string'&&/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/.test(old)&&exact(old)===exact(f.decimal)));});
}
