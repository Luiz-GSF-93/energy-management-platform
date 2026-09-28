import {createHash} from 'node:crypto';
/** Deterministic identity of the validated sources; never an adjustment to a measurement. */
export function spotReconciliationContext(r:any,unit:any){
 const payload={format:'spot-reconciliation-1',organizationId:unit.organization_id,customerId:unit.customer_id,unitId:unit.id,month:r.month,contract:r.contract,rule:r.rule,measurements:r.measurements,costVersion:r.costVersion,invoiceSources:r.invoiceSources,consumedMwh:r.consumedMwh,purchasedMwh:r.billedMwh,pricePerMwh:r.pricePerMwh,taxTreatment:r.taxTreatment,invoiceAmount:r.invoiceAmount,volumeDifferenceMwh:r.volumeDifferenceMwh};
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 return {hash:createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex'),payload};
}
export function applySpotReconciliation(r:any,unit:any,rows:any[],documents:any[]){
 if(r.formulaVersion!=='spot-supplier-1.0'||r.invoiceDifference!=='0.00'||!r.costVersion||!r.measurements||!r.volumeDifferenceMwh||/^0[.]0+$/.test(r.volumeDifferenceMwh))return r;
 const context=spotReconciliationContext(r,unit);r.reconciliationContext=context;
 const matches=rows.filter(x=>x.organization_id===unit.organization_id&&x.customer_id===unit.customer_id&&x.consumer_unit_id===unit.id&&x.contract_id===r.contract.id&&x.month===r.month).sort((a,b)=>b.version-a.version),latest=matches[0];
 if(!latest)return r;
 r.reconciliation={id:latest.id,version:latest.version,status:latest.status,reason:latest.reason,documentId:latest.document_id,createdBy:latest.created_by,createdAt:latest.created_at,current:latest.source_hash===context.hash};
 const doc=documents.find(d=>d.id===latest.document_id&&d.organization_id===unit.organization_id&&d.customer_id===unit.customer_id&&d.consumer_unit_id===unit.id&&d.file_verified===true&&String(d.reference_month).slice(0,7)===r.month&&(!d.energy_contract_id||d.energy_contract_id===r.contract.id));
 if(matches.filter(x=>x.version===latest.version).length!==1||latest.status!=='APPROVED_NO_COST'||!r.reconciliation.current||!doc||doc.file_hash!==latest.document_sha256||!latest.reason?.trim()||!latest.created_by||!latest.created_at)return r;
 // Release only the documented volume discrepancy. All other blockers remain effective.
 r.requirements=r.requirements.filter((q:any)=>q.code!=='SPOT_VOLUME_DIFFERENCE');
 if(r.requirements.length)return r;
 const scaled=(v:string)=>{const [a,b='']=v.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));},m=r.measurements.measurements,peak=scaled(m.consumptionPeak),total=scaled(m.consumptionTotal),money=BigInt(r.invoiceAmount.replace('.',''));
 if(total<=0n)return r;
 const cents=(v:bigint)=>{const s=v.toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2);},mwh=(v:string)=>(scaled(v)*1000n).toString().padStart(13,'0').replace(/(.{12})$/,'.$1');
 const peakMoney=(money*peak+total/2n)/total;
 r.bands=[{timeBand:'PEAK',volumeMwh:mwh(m.consumptionPeak),amount:cents(peakMoney)},{timeBand:'OFF_PEAK',volumeMwh:mwh(m.consumptionOffPeak),amount:cents(money-peakMoney)}];
 r.totalAmount=r.invoiceAmount;r.status='READY';r.warnings.push('Diferença de volume conciliada documentalmente sem custo adicional, revisão '+latest.version+'. Consumo e compra preservados; custo rateado pelo consumo medido.');return r;
}
