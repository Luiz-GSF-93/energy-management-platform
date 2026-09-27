import type {LayoutEvidence} from './OcrLayoutEvidence';
type Row=LayoutEvidence['operations'][number];
export const taxColumns=[['icmsAmount','ICMS'],['pisAmount','PIS'],['cofinsAmount','Cofins']] as const;
function cents(value:string|null|undefined):bigint|null{
 if(typeof value!=='string'||!/^[-]?[0-9]{1,24}(?:[.][0-9]{1,9})?$/.test(value))return null;
 const negative=value.startsWith('-'),[a,b='']=value.replace('-','').split('.');
 if(/[1-9]/.test(b.slice(2)))return null;
 return (BigInt(a)*BigInt(100)+BigInt((b+'00').slice(0,2)))*(negative?-BigInt(1):BigInt(1));
}
export function moneyFromCents(n:bigint){const abs=n<BigInt(0)?-n:n;return (n<BigInt(0)?'-':'')+(abs/BigInt(100)).toString()+','+(abs%BigInt(100)).toString().padStart(2,'0');}
/** Separate charges and credits; never adds taxes onto tax-inclusive line amounts. */
export const isSupplierTaxReference=(r:Row)=>r.component==='ACL_DISTRIBUTOR_INFORMATION'&&taxColumns.every(([key])=>!r.fields[key]?.text.trim());
export function operationTaxSummary(rows:Row[]){
 const occurrences=new Map<string,number>();rows.forEach(r=>occurrences.set(r.source,(occurrences.get(r.source)??0)+1));
 return (['CHARGE','CREDIT'] as const).map(role=>{
  const selected=rows.filter(r=>r.role===role);
  const taxable=selected.filter(r=>!isSupplierTaxReference(r));
  return {role,rows:selected,referenceCount:selected.length-taxable.length,totals:taxColumns.map(([key,label])=>{
   let total=BigInt(0),count=0;
   for(const r of taxable){const f=r.fields[key];const n=cents(f?.decimal);
    if(!r.source||occurrences.get(r.source)!==1||r.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i))||!f?.text.trim()||f.issues.some(i=>i!=='MISSING_CONFIDENCE')||n===null)continue;
    total+=n;count++;
   }
   return {key,label,value:count?moneyFromCents(total):null,count,expected:taxable.length,partial:count!==taxable.length};
  })};
 });
}
