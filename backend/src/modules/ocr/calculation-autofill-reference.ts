import {reviewDigest} from '../contracts/services/review-snapshots.service';
/** Only a preserved, approved financial memory of this exact unit is a reference. */
export function previousCalculationReference(rows:any[],unit:any,month:string){
 const eligible=rows.filter(r=>r.organization_id===unit.organization_id&&r.customer_id===unit.customer_id&&r.consumer_unit_id===unit.id&&String(r.month).slice(0,7)<month&&Number.isInteger(r.version_number)&&r.version_number>0&&r.financial_format==='financial-settlement-1.0'&&r.validation_status==='VALIDATED'&&['APPROVED','PUBLISHED'].includes(r.status)&&r.approved_at&&(r.status!=='PUBLISHED'||r.published_at)).sort((a,b)=>String(b.month).localeCompare(String(a.month))||b.version_number-a.version_number);
 if(!eligible.length)return null;
 const r=eligible[0];if(eligible.some(x=>x.id!==r.id&&x.month===r.month&&x.version_number===r.version_number))return null;
 const p=r.financial_payload,m=String(r.month).slice(0,7),s=p?.sources,prep=p?.preparations?.[unit.id];
 if(!p||reviewDigest(p)!==r.financial_hash||p.formatVersion!==r.financial_format||s?.organizationId!==unit.organization_id||s.customerId!==unit.customer_id||s.month!==m||prep?.unit?.id!==unit.id||prep.month!==m||p.financial?.status!=='AVAILABLE'||!p.financial.units?.some((u:any)=>u.id===unit.id))return null;
 const supplier=prep.contractSupplierCost,fee=prep.managementFeeMemory;
 return {id:r.id,month:m,version:r.version_number,hash:r.financial_hash,source:`Referência do fechamento ${m} · versão ${r.version_number} · ${r.id} · SHA-256 ${r.financial_hash}`,supplier:supplier?.status==='READY'?supplier:null,fee:['FIXED_AVAILABLE','VARIABLE_PENDING'].includes(fee?.status)?fee:null};
}
/** Historical price applied to current consumption; never repeats a prior invoice total/volume. */
export function referenceEnergyAmount(price:unknown,consumption:unknown):string|null{
 const scale=(v:unknown)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})(\.\d{1,12})?$/.test(v))throw Error();const [w,f='']=v.split('.');return BigInt(w)*10n**12n+BigInt(f.padEnd(12,'0'));};
 try{const divisor=10n**27n,cents=(scale(price)*scale(consumption)*100n+divisor/2n)/divisor;return `${cents/100n}.${String(cents%100n).padStart(2,'0')}`;}catch{return null;}
}

export function referenceMwh(consumption:unknown):string|null{
 if(typeof consumption!=='string'||!/^(0|[1-9][0-9]{0,11})(\.\d{1,9})?$/.test(consumption))return null;
 const [w,f='']=consumption.split('.'),n=(w.padStart(4,'0')+f).padEnd(w.padStart(4,'0').length+9,'0'),cut=w.padStart(4,'0').length-3;
 return (n.slice(0,cut).replace(/^0+(?=\d)/,'')+'.'+n.slice(cut).replace(/0+$/,'')).replace(/[.]$/,'');
}
export function proposalFieldsSafe(identity:any[],consumption:any[]){
 const safe=(rows:any[],keys:string[])=>rows.length===keys.length&&keys.every(key=>{const a=rows.filter(f=>f.key===key),f=a[0],h=f?.history??[];const matched=f?.state==='EXTRACTED_REVIEW'||key==='address'&&f?.state==='BLOCKED'&&f.check?.comparison==='DIFFERENT';return a.length===1&&matched&&f.decimal!==null&&f.sourceHash&&(!h.length||h[0].sourceHash===f.sourceHash&&h[0].decision!=='NEEDS_CORRECTION'&&h.filter((r:any)=>r.version===h[0].version).length===1);});
 return safe(identity,['customer','taxId','unit','address','period','market'])&&safe(consumption,['consumptionPeakKwh','consumptionOffPeakKwh','consumptionTotalKwh']);
}
