import type {CpflOperation} from './cpfl-paulista-layout';
export const reviewedLayoutSupported=(id:string|null)=>['cpfl-paulista-a','neoenergia-elektro-verde'].includes(id??'');
export const combinedTaxLayout=(layout:any)=>layout.layoutId==='neoenergia-elektro-verde'&&layout.taxReconciliation?.checks?.length===2&&layout.taxReconciliation.checks.every((c:any)=>c.state==='MATCH_EXTRACTED'&&!c.partial);
export function operationTaxCodes(row:CpflOperation|undefined,combined=false){
 if(!row)return [];const positive=(key:string)=>{const f=row.fields[key];return !!f?.decimal&&/^\d+(?:[.]\d{1,2})?$/.test(f.decimal)&&Number(f.decimal)>0&&Array.isArray(f.issues)&&!f.issues.some(i=>i!=='MISSING_CONFIDENCE');};
 const codes=positive('icmsAmount')?['ICMS']:[];
 if(combined&&positive('pisCofinsAmount'))return [...codes,'PIS','COFINS'];
 return [...codes,...(positive('pisAmount')?['PIS']:[]),...(positive('cofinsAmount')?['COFINS']:[])];
}
