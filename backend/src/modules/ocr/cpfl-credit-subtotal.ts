import type {CpflOperation} from './cpfl-paulista-layout';

const cents=(r:CpflOperation)=>{const v=r.fields.amount?.decimal;if(typeof v!=='string'||! /^-?\d+(?:\.\d{1,2})?$/.test(v))return null;const [w,d='']=v.split('.');return BigInt(w+d.padEnd(2,'0'));};
/** A blank printed subtotal is evidence of repetition only after both exact sums.
 * Never edits original field text/spans/confidence or removes a detailed credit. */
export function cpflCreditSubtotal(rows:CpflOperation[],verified:(row:CpflOperation,amountOnly?:boolean)=>boolean){
 const unchanged={operations:rows,proof:null as null|{method:string;source:string;detailSources:string[];totalSources:string[];printedAmount:string;subtotalCents:string;finalCents:string;billingAdjustmentSources?:string[]}};
 const one=(component:string)=>{const hits=rows.map((r,index)=>({r,index})).filter(x=>x.r.component===component);return hits.length===1?hits[0]:null;};
 const subtotal=one('SUBTOTAL'),distributor=one('TOTAL_DISTRIBUIDORA'),total=one('TOTAL_A_PAGAR');
 if(!subtotal||!distributor||!total||subtotal.index>=distributor.index||distributor.index>=total.index||rows.some(r=>r.component==='ADJUSTMENTS_SUBTOTAL'))return unchanged;
 const candidates=rows.map((r,index)=>({r,index})).filter(({r,index})=>index>distributor.index&&index<total.index&&r.role==='UNKNOWN'&&r.component==='OTHER'&&!r.fields.description?.text.trim()&&Object.entries(r.fields).every(([key,f])=>key==='amount'||!f.text.trim()));
 if(candidates.length!==1)return unchanged;
 const candidate=candidates[0],value=cents(candidate.r);
 if(value===null||value>=0n||!verified(candidate.r,true))return unchanged;
 const prefix=rows.slice(0,subtotal.index),detail=rows.slice(distributor.index+1,candidate.index),after=rows.slice(candidate.index+1,total.index);
 const credit=(r:CpflOperation)=>r.role==='CREDIT'&&['ACL_ENERGY_DISCOUNT','REFUND','SUBSIDY_CREDIT'].includes(r.component)&&cents(r)!==null&&cents(r)!<=0n;
 // Only the upstream verified earlier-period TUSD classification may join credits.
 // A general charge/unknown line never proves an unlabelled subtotal.
 const billingAdjustment=(r:CpflOperation)=>r.role==='CHARGE'&&r.component==='TUSD_BILLING_ADJUSTMENT'&&cents(r)!==null&&cents(r)!>=0n;
 if(!prefix.length||!detail.some(credit)||!prefix.every(r=>r.role==='CHARGE')||!detail.every(r=>credit(r)||billingAdjustment(r))||!after.every(r=>credit(r)||r.role==='CHARGE'))return unchanged;
 const evidence=[...prefix,subtotal.r,distributor.r,...detail,candidate.r,...after,total.r];
 const table=(r:CpflOperation)=>/^tables\[\d+\]/.exec(r.source??'')?.[0];
 const origin=table(candidate.r);
 if(!origin||new Set(evidence.map(r=>r.source)).size!==evidence.length||evidence.some(r=>table(r)!==origin||cents(r)===null||r.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN','UNVERIFIED_SOURCE'].includes(i))||!verified(r,r===candidate.r)))return unchanged;
 const sum=(items:CpflOperation[])=>items.reduce((n,r)=>n+cents(r)!,0n);
 if(sum(prefix)!==cents(subtotal.r)||cents(subtotal.r)!==cents(distributor.r)||sum(detail)!==value||cents(distributor.r)!+value+sum(after)!==cents(total.r))return unchanged;
 const operations=rows.map(r=>r===candidate.r?{...r,component:'ADJUSTMENTS_SUBTOTAL',role:'TOTAL' as const,issues:[...r.issues.filter(i=>i!=='UNMAPPED_COMPONENT'),'EXACT_CREDIT_SUBTOTAL']}:r);
 const billingAdjustmentSources=detail.filter(billingAdjustment).map(r=>r.source);
 return {operations,proof:{method:billingAdjustmentSources.length?'CPFL_UNLABELLED_CREDIT_SUBTOTAL_WITH_TUSD_ADJUSTMENTS_EXACT_SUMS':'CPFL_UNLABELLED_CREDIT_SUBTOTAL_EXACT_SUMS',source:candidate.r.source,detailSources:detail.map(r=>r.source),totalSources:[subtotal.r.source,distributor.r.source,...after.map(r=>r.source),total.r.source],printedAmount:candidate.r.fields.amount.text,subtotalCents:value.toString(),finalCents:cents(total.r)!.toString(),...(billingAdjustmentSources.length?{billingAdjustmentSources}:{})}};
}
