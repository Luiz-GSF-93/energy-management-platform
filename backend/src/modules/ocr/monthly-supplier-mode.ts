import {monthPeriod} from '../contracts/services/preparation';

/** Only the existing, scoped monthly supplier engine can select spot purchasing.
 * A filename, user note, old annex or an incomplete/overlapping rule cannot do it. */
export function structuredSpotMonth(c:any):boolean {
 const u=c?.unit,s=c?.diagnosis?.contractSupplierCost;
 if(!u||u.free_market!==true||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(c.month??'')||s?.formulaVersion!=='spot-supplier-1.0'||s.month!==c.month)return false;
 const p=monthPeriod(c.month),day=(v:unknown)=>String(v??'').slice(0,10);
 const scoped=(r:any)=>r.organization_id===u.organization_id&&r.customer_id===u.customer_id&&r.consumer_unit_id===u.id;
 const contracts=(c.captured?.contracts??[]).filter((r:any)=>scoped(r)&&r.contract_type==='ENERGY_PURCHASE'&&['ACTIVE','APPROVED'].includes(r.status)&&day(r.start_date)<=p.end&&day(r.end_date)>=p.start);
 if(contracts.length!==1)return false;
 const contract=contracts[0];
 if(contract.id!==s.contract?.id||day(contract.start_date)>p.start||day(contract.end_date)<p.end)return false;
 const rows=(c.captured?.billingRules??[]).filter((r:any)=>scoped(r)&&r.contract_id===contract.id&&day(r.start_date)<=p.end&&day(r.end_date)>=p.start).sort((a:any,b:any)=>b.version-a.version);
 const r=rows[0];
 return !!r&&Number.isInteger(r.version)&&r.version>0&&rows.filter((x:any)=>x.version===r.version).length===1&&r.id===s.rule?.id&&r.version===s.rule?.version&&r.source?.trim().length>0&&r.volume_basis==='SPOT'&&r.price_mode==='FINAL'&&r.min_percent==null&&r.max_tolerance_percent==null&&day(r.start_date)===p.start&&day(r.end_date)===p.end;
}
