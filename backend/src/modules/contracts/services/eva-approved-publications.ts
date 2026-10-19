import {InternalServerErrorException} from '@nestjs/common';
import {cents,aggregate,publishedFinancialSummary} from './published-financial-summary';
import {feeMoney} from './management-fee';
const hash=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const fail=()=>{throw new InternalServerErrorException('Publicação EVA inconsistente. Nenhum resultado parcial foi emitido.');};
export function evaPublication(row:any,org:string,period:{from:string;to:string;customerId?:string}){
 const p=row?.projection,f=p?.financial;
 if(!uuid(row?.id)||!uuid(row?.closingId)||!hash(row?.sourceHash)||p?.sourceHash!==row.sourceHash||p?.formatVersion!=='eva-approved-publication-1.0'||p.organizationId!==org||typeof p.customerId!=='string'||period.customerId&&p.customerId!==period.customerId||typeof p.month!=='string'||p.month<period.from||p.month>period.to||!Number.isInteger(p.version)||p.version<1||typeof p.estimated!=='boolean'||!Number.isFinite(Date.parse(row.publishedAt))||typeof p.customerName!=='string'||f?.status!=='AVAILABLE'||!Array.isArray(f.units)||!f.units.length||f.units.length>100||new Set(f.units.map((u:any)=>u.id)).size!==f.units.length)fail();
 const pick=(x:any)=>Object.fromEntries(['acr','aclBeforeFees','fixedFee','variableFee','totalFees','aclAfterFees','savingsAfterFees'].map(k=>{cents(x[k],k==='savingsAfterFees');return [k,x[k]];}));
 const units=f.units.map((u:any)=>{
  if(typeof u.id!=='string'||typeof u.name!=='string')fail();const values=pick(u);
  if(cents(values.fixedFee)+cents(values.variableFee)!==cents(values.totalFees)||cents(values.aclBeforeFees)+cents(values.totalFees)!==cents(values.aclAfterFees)||cents(values.acr)-cents(values.aclAfterFees)!==cents(values.savingsAfterFees,true))fail();
  return {id:u.id,name:u.name,...values};
 });
 const values=pick(f);
 for(const k of Object.keys(values))if(units.reduce((s:bigint,u:any)=>s+cents(u[k],k==='savingsAfterFees'),0n)!==cents(values[k],k==='savingsAfterFees'))fail();
 const financial={status:'AVAILABLE',...values,savingsBeforeFees:feeMoney(cents(values.acr)-cents(values.aclBeforeFees)),units};
 const reservations=p.estimated?['Comparação estimada aprovada pela equipe de gestão. Utiliza as hipóteses e referências consideradas no fechamento. Consulte a equipe para esclarecimentos.']:[];
 const publication={meta:{id:row.id,customerId:p.customerId,month:p.month,version:p.version,payloadHash:row.sourceHash,publishedAt:new Date(row.publishedAt).toISOString(),publicationNote:'Resultado aprovado e disponibilizado pela equipe de gestão.',status:row.state==='WITHDRAWN'?'WITHDRAWN':'PUBLISHED',origin:'EVA_APPROVED',closingId:row.closingId},financial,customerName:p.customerName,reservations,preparations:{}};
 publishedFinancialSummary(org,period,[publication]);return publication;
}
export function latestPublications(publications:any[]){
 const selected=new Map<string,any>();
 for(const p of publications){
  const key=p.meta.customerId+'|'+p.meta.month,old=selected.get(key),time=Date.parse(p.meta.publishedAt),oldTime=old&&Date.parse(old.meta.publishedAt);
  if(!Number.isFinite(time))fail();
  if(old&&time===oldTime&&p.meta.id!==old.meta.id)fail();
  if(!old||time>oldTime)selected.set(key,p);
 }
 return [...selected.values()].filter(p=>p.meta.status!=='WITHDRAWN');
}
export function publicFinancialCharts(data:any){
 let cumulative:any[]=[];
 const months=data.months.map((m:any)=>{
  if(!m.totals)return {month:m.month,acr:null,acl:null,savings:null,cumulative:null};
  cumulative.push(m.totals);return {month:m.month,acr:m.totals.acr,acl:m.totals.aclAfterFees,savings:m.totals.savingsAfterFees,cumulative:aggregate(cumulative)!.savingsAfterFees};
 });
 const abs=(s:string)=>{const n=cents(s,true);return n<0n?-n:n;};
 const max=months.reduce((a:bigint,m:any)=>[m.acr,m.acl,m.savings,m.cumulative].filter(v=>v!==null).reduce((b:bigint,v:string)=>abs(v)>b?abs(v):b,a),0n);
 const width=(v:string|null)=>v===null?null:max?feeMoney((abs(v)*10000n+max/2n)/max):'0.00';
 return months.map((m:any)=>({...m,widths:{acr:width(m.acr),acl:width(m.acl),savings:width(m.savings),cumulative:width(m.cumulative)}}));
}
