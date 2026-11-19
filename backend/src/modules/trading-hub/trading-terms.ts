import {BadRequestException} from '@nestjs/common';
import {calendarSupplyPeriods,supplyReferences} from './trading-supply';

export type AnnualPrice={year:number;priceBrlMwh:number};
export function supplyYears(start:string,months:number){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)||!Number.isInteger(months)||months<1||months>600)throw new BadRequestException('Informe o início e o prazo do fornecimento.');
 const first=Number(start.slice(0,4));if(first<2000||first+Math.ceil(months/12)>10000)throw new BadRequestException('Ano de fornecimento inválido.');
 return Array.from({length:Math.ceil(months/12)},(_,index)=>first+index);
}
export function annualPrices(value:unknown,start:string,months:number,required=false):AnnualPrice[]{
 const years=supplyYears(start,months);
 if(!Array.isArray(value)||value.length>50)throw new BadRequestException('Confira os preços de referência por ano de fornecimento.');
 const seen=new Set<number>();const rows=value.map((row:any)=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='priceBrlMwh,year'||!years.includes(row.year)||seen.has(row.year)||typeof row.priceBrlMwh!=='number'||!Number.isFinite(row.priceBrlMwh)||row.priceBrlMwh<=0||row.priceBrlMwh>1e7)throw new BadRequestException('Informe um preço positivo em R$/MWh para cada ano, sem repetição.');
  seen.add(row.year);return {year:row.year,priceBrlMwh:row.priceBrlMwh};
 }).sort((a,b)=>a.year-b.year);
 if(required&&rows.length!==years.length)throw new BadRequestException('Cadastre a referência de preço desejado ACL de todos os anos antes de enviar a cotação.');return rows;
}
export function validateCommercialTerms(d:Record<string,any>,required=false){
 for(const [key,min,max]of [['flexibilityUpperPercent',0,1000],['flexibilityLowerPercent',-100,0]]as const){
  const value=d[key];if(value==null&&!required)continue;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new BadRequestException('Confira a flexibilidade maior (+) e a menor (−), em percentual.');
 }
 for(const key of ['seasonality','correctionIndex','billingTerms']){
  if(d[key]==null&&!required)continue;
  if(typeof d[key]!=='string'||d[key].trim().length<1||d[key].trim().length>1000)throw new BadRequestException('Informe sazonalidade, índice de correção e condição de faturamento.');d[key]=d[key].trim();
 }
 if(d.commercialTermsVersion!=null&&d.commercialTermsVersion!==2)throw new BadRequestException('Versão das condições comerciais inválida.');
 if(d.flexibilityUpperPercent!=null&&d.flexibilityLowerPercent!=null)d.flexibility=`+${d.flexibilityUpperPercent}% / ${d.flexibilityLowerPercent}%`;
}
export function assertQuotationReady(d:Record<string,any>){
 if(d.supplyVersion===3)supplyReferences(d.annualReferencePrices,calendarSupplyPeriods(d.supplyStartDate,d.supplyEndDate),true);else annualPrices(d.annualReferencePrices,d.startMonth,d.months,true);validateCommercialTerms({...d},true);
}
export function quotationExpired(d:Record<string,any>,now=Date.now()){
 return !Number.isFinite(Date.parse(d.expiresAt))||Date.parse(d.expiresAt)<=now;
}
