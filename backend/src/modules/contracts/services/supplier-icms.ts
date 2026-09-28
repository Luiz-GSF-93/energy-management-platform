import {monthPeriod} from './preparation';
export type SupplierIcms={parameterId:string;revision:number;rate:string;reason:string};
const rateUnits=(s:string)=>{if(typeof s!=='string'||! /^(0|[1-9][0-9]?)([.][0-9]{1,6})?$/.test(s))throw Error('Alíquota ICMS inválida.');const [a,b='']=s.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
const money=(n:bigint)=>{const s=n.toString().padStart(3,'0');return s.slice(0,-2)+'.'+s.slice(-2);};
export function supplierIcmsReference(unit:any,month:string,parameters:any[]){
 const period=monthPeriod(month),rows=parameters.filter(p=>p.organization_id===unit.organization_id&&p.customer_id===unit.customer_id&&p.consumer_unit_id===unit.id&&p.scenario==='ACL'&&p.kind==='TAX'&&p.component_code==='ICMS'&&['DRAFT','APPROVED'].includes(p.status)&&p.start_date<=period.end&&p.end_date>=period.start);
 const p=rows[0];
 if(rows.length!==1||p.status!=='APPROVED'||p.start_date>period.start||p.end_date<period.end||!['INCLUDED','INSIDE','OUTSIDE'].includes(p.treatment)||p.measure!=='PERCENT'||p.direction!=='DEBIT'||!p.source?.trim()||!Number.isInteger(p.revision)||p.revision<1||!p.unit_context||['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market'].some(k=>(p.unit_context[k]??null)!==(unit[k]??null)))throw Error('Confirme um único ICMS ACL aprovado, com alíquota e vigência cobrindo a competência.');
 const rate=rateUnits(p.amount_text);if(rate<=0n||rate>=100000000n)throw Error('ICMS por dentro exige alíquota maior que zero e menor que 100%.');
 return {parameterId:p.id,revision:p.revision,rate:p.amount_text,source:p.source};
}
export function supplierIcmsAmount(amount:string,confirmation:SupplierIcms){
 if(!confirmation||typeof confirmation.reason!=='string'||confirmation.reason.trim().length<20||confirmation.reason.length>1000||!confirmation.parameterId||!Number.isInteger(confirmation.revision)||confirmation.revision<1)throw Error('Confirme a incidência do ICMS não embutido, com fonte e justificativa.');
 if(typeof amount!=='string'||! /^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$/.test(amount))throw Error('Base do fornecedor inválida.');
 const [a,b='']=amount.split('.'),base=BigInt(a)*100n+BigInt(b.padEnd(2,'0')),rate=rateUnits(confirmation.rate),divisor=100000000n-rate;
 if(rate<=0n||divisor<=0n)throw Error('Alíquota de gross-up inválida.');
 const tax=(base*rate+divisor/2n)/divisor;
 return {base:money(base),tax:money(tax),total:money(base+tax),rate:confirmation.rate};
}
export function verifySupplierIcms(unit:any,month:string,parameters:any[],confirmation:SupplierIcms){
 const ref=supplierIcmsReference(unit,month,parameters);
 if(ref.parameterId!==confirmation.parameterId||ref.revision!==confirmation.revision||ref.rate!==confirmation.rate)throw Error('A referência do ICMS ACL mudou. Revise o acréscimo do fornecedor em nova versão auditada.');
 return ref;
}
