import {BadRequestException} from '@nestjs/common';

export type TradingKind='supplier'|'opportunity'|'proposal';

export const fields={supplier:['legalName','tradeName','cnpj','phone','administrativeEmail','administrativeContact','quotationContacts','address','city','state'],opportunity:['title','customerId','unitId','distributor','submarket','averageMwhMonth','energyType','startMonth','months','expiresAt','acrMonthlyBrl','aclOtherMonthlyBrl','comparisonBasis','investmentBrl','discountAnnualPercent','documents'],proposal:['supplierId','priceBrlMwh','energyType','flexibility','modulation','guarantees','validUntil','conditions','documents']} as const;
export function object(value:unknown):Record<string,any>{if(!value||Array.isArray(value)||typeof value!=='object')throw new BadRequestException('Objeto inválido.');return value as Record<string,any>;}

export function text(value:any,min=1,max=500){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new BadRequestException('Preencha os textos obrigatórios dentro dos limites.');return value.trim();}

export function number(value:any,min:number,max:number){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new BadRequestException('Valor numérico inválido.');return value;}

export function id(value:any){return text(value,1,200);}

export function uuid(value:any){if(typeof value!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw new BadRequestException('Identificador inválido.');return value;}

export function cnpj(value:string){const n=value.replace(/\D/g,'');if(n.length!==14||/^(\d)\1+$/.test(n))return false;for(let len=12;len<=13;len++){let sum=0,weight=len-7;for(let i=0;i<len;i++){sum+=Number(n[i])*weight--;if(weight<2)weight=9;}const d=sum%11<2?0:11-sum%11;if(d!==Number(n[len]))return false;}return true;}

export function validateTrading(kind:string,input:unknown){

 if(!Object.prototype.hasOwnProperty.call(fields,kind))throw new BadRequestException('Área Trading inválida.');

 const d={...object(input)},allowed:readonly string[]=fields[kind as TradingKind];if(Object.keys(d).some(k=>!allowed.includes(k)))throw new BadRequestException('Campo não autorizado.');

 for(const k of Object.keys(d))if(typeof d[k]==='string')d[k]=text(d[k],0,4000);

 if(kind==='supplier'){

  d.legalName=text(d.legalName,3,200);d.tradeName=text(d.tradeName,1,200);d.cnpj=text(d.cnpj,14,18).replace(/\D/g,'');if(!cnpj(d.cnpj))throw new BadRequestException('CNPJ inválido.');

  for(const k of ['phone','administrativeContact','address','city','state'])d[k]=text(d[k],1,k==='address'?1000:200);

  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.administrativeEmail))throw new BadRequestException('E-mail administrativo inválido.');

  if(!Array.isArray(d.quotationContacts)||d.quotationContacts.length<1||d.quotationContacts.length>20)throw new BadRequestException('Cadastre de 1 a 20 contatos de cotação.');

  d.quotationContacts=d.quotationContacts.map((v:any)=>{const c=object(v);if(Object.keys(c).some(k=>!['name','email'].includes(k))||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))throw new BadRequestException('Contato de cotação inválido.');return {name:text(c.name,1,200),email:text(c.email,3,254).toLowerCase()};});

 }else{

  d.documents=d.documents??[];if(!Array.isArray(d.documents)||d.documents.length>10)throw new BadRequestException('Até 10 documentos por registro.');d.documents=d.documents.map(id);

  if(!['CONVENTIONAL','INCENTIVIZED_50','INCENTIVIZED_100'].includes(d.energyType))throw new BadRequestException('Modalidade de energia inválida.');

  if(kind==='opportunity'){

   for(const k of ['title','customerId','unitId','distributor'])d[k]=text(d[k],1,200);

   if(!['SE_CO','S','NE','N'].includes(d.submarket))throw new BadRequestException('Submercado inválido.');number(d.averageMwhMonth,0.000001,1e9);number(d.months,1,600);if(!Number.isInteger(d.months)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.startMonth))throw new BadRequestException('Prazo inválido.');

   if(!Number.isFinite(Date.parse(d.expiresAt))||Date.parse(d.expiresAt)<=Date.now()||Date.parse(d.expiresAt)>Date.now()+366*86400000)throw new BadRequestException('Expiração deve ocorrer em até um ano.');

   for(const k of ['acrMonthlyBrl','aclOtherMonthlyBrl','investmentBrl','discountAnnualPercent'])if(d[k]!=null)number(d[k],0,k==='discountAnnualPercent'?1000:1e12);
   if(d.acrMonthlyBrl!=null||d.aclOtherMonthlyBrl!=null)d.comparisonBasis=text(d.comparisonBasis,10,1000);
  }else{uuid(d.supplierId);number(d.priceBrlMwh,0.0001,1e7);for(const k of ['flexibility','modulation','guarantees','conditions'])d[k]=text(d[k],1,4000);if(!/^\d{4}-\d{2}-\d{2}$/.test(d.validUntil)||!Number.isFinite(Date.parse(d.validUntil))||d.validUntil<new Date().toISOString().slice(0,10))throw new BadRequestException('Validade da proposta inválida.');}

 }

 return d;

}

