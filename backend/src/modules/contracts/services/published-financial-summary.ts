import {InternalServerErrorException} from '@nestjs/common';
import {feeMoney} from './management-fee';
import {PublishedFinancialQueryDto} from '../dto/financial-settlements.dto';

const fields=['acr','aclBeforeFees','totalFees','aclAfterFees','savingsBeforeFees','savingsAfterFees'] as const;
type Field=typeof fields[number];
type Amounts=Record<Field,string> & {savingsPercent:string|null};
function cents(value:unknown,signed=false):bigint {
 if(typeof value!=='string'||!(signed?/^-?(0|[1-9]\d{0,14})\.\d{2}$/:/^(0|[1-9]\d{0,14})\.\d{2}$/).test(value))throw new InternalServerErrorException('Valor publicado indisponível. Nenhum valor ausente foi convertido em zero.');
 const negative=value.startsWith('-'),[whole,decimal]=value.replace(/^-/,'').split('.');
 return (BigInt(whole)*100n+BigInt(decimal))*(negative?-1n:1n);
}
function aggregate(rows:Amounts[]):Amounts|null {
 if(!rows.length)return null;
 const sums=Object.fromEntries(fields.map(f=>[f,rows.reduce((total,r)=>total+cents(r[f],f.startsWith('savings')),0n)])) as Record<Field,bigint>;
 const magnitude=sums.savingsAfterFees<0n?-sums.savingsAfterFees:sums.savingsAfterFees;
 const percent=sums.acr>0n?((magnitude*10000n+sums.acr/2n)/sums.acr):null;
 return {...Object.fromEntries(fields.map(f=>[f,feeMoney(sums[f])])),savingsPercent:percent===null?null:(sums.savingsAfterFees<0n?'-':'')+feeMoney(percent)} as Amounts;
}
// Read only the immutable published totals. This does not prepare or recalculate settlements.
export function publishedFinancialSummary(organizationId:string,period:PublishedFinancialQueryDto,publications:any[]){
 const rows=publications.map(p=>{
  const f=p.financial;
  const amounts=Object.fromEntries(fields.map(key=>{cents(f[key],key.startsWith('savings'));return [key,f[key]];})) as Record<Field,string>;
  if(!Array.isArray(p.reservations)||p.reservations.some((v:unknown)=>typeof v!=='string')||!Array.isArray(f.units)||!f.units.length)throw new InternalServerErrorException('Fontes publicadas incompletas.');
  if(cents(amounts.acr)-cents(amounts.aclBeforeFees)!==cents(amounts.savingsBeforeFees,true)||cents(amounts.aclBeforeFees)+cents(amounts.totalFees)!==cents(amounts.aclAfterFees)||cents(amounts.acr)-cents(amounts.aclAfterFees)!==cents(amounts.savingsAfterFees,true))throw new InternalServerErrorException('Totais publicados inconsistentes.');
  const totals=aggregate([{...amounts,savingsPercent:null}])!;
  return {id:p.meta.id,customerId:p.meta.customerId,customerName:p.customerName,month:p.meta.month,version:p.meta.version,payloadHash:p.meta.payloadHash,publishedAt:p.meta.publishedAt,publicationNote:p.meta.publicationNote,units:f.units.map((u:any)=>({id:u.id,name:u.name})),reservations:p.reservations,amounts:totals};
 }).sort((a,b)=>b.month.localeCompare(a.month)||String(a.customerName).localeCompare(String(b.customerName)));
 const months=[];let year=Number(period.from.slice(0,4)),month=Number(period.from.slice(5,7));
 while(`${year}-${String(month).padStart(2,'0')}`<=period.to){const key=`${year}-${String(month).padStart(2,'0')}`,matched=rows.filter(r=>r.month===key);months.push({month:key,publicationCount:matched.length,totals:aggregate(matched.map(r=>r.amounts))});if(++month===13){month=1;year++;}}
 return {organizationId,period:{from:period.from,to:period.to,customerId:period.customerId??null},updatedAt:new Date().toISOString(),publicationCount:rows.length,customerCount:new Set(rows.map(r=>r.customerId)).size,unitMonthCount:rows.reduce((n,r)=>n+r.units.length,0),totals:aggregate(rows.map(r=>r.amounts)),months,rows,coverage:'LATEST_PUBLISHED_CUSTOMER_MONTH',disclosure:'Somente a última versão publicada de cada cliente e mês. Meses sem publicação não representam custo zero. Valores de rascunhos, revisões e prévias não entram nos totais. Ressalvas da publicação permanecem válidas.'};
}
