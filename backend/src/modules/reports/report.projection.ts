import {InternalServerErrorException} from '@nestjs/common';
import {createHash} from 'crypto';
export const REPORT_FORMAT='energy-report-1.0';
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const reportHash=(body:unknown)=>createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
const text=(v:unknown,max=255)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max):'';
// Explicit recipient-safe projection: never export calculation sources, internal notes or a contact directory.
export function projectReport(input:any,header:any,kind:string,events:any[],generatedAt:string){
 const a=input?.primary;
 if(!a?.totals||!a.publicationCount||!Array.isArray(a.invoices)||!Array.isArray(a.publications))throw new InternalServerErrorException('Não há resultados publicados completos para este recorte.');
 const publications=a.publications.filter((p:any)=>p.customerId===header.customerId&&p.units.some((u:any)=>u.id===header.unitId)).map((p:any)=>({id:p.id,customerId:p.customerId,month:p.month,version:p.version,payloadHash:p.payloadHash,publishedAt:p.publishedAt}));
 if(!publications.length||publications.some((p:any)=>!p.payloadHash||!p.publishedAt))throw new InternalServerErrorException('Publicação sem rastreabilidade.');
 const invoices=a.invoices.map((i:any)=>{
  if(i.unitId!==header.unitId||!publications.some((p:any)=>p.id===i.groupId&&p.payloadHash===i.payloadHash))throw new InternalServerErrorException('Fonte fora do recorte do relatório.');
  const consumption=i.measurements?.measurements?.consumptionTotal;
  return {month:i.month,groupId:i.groupId,version:i.version,payloadHash:i.payloadHash,consumptionKwh:typeof consumption==='string'&&/^\d+(\.\d+)?$/.test(consumption)?consumption:null,scenarios:i.scenarios?.map((s:any)=>({scenario:s.scenario,distributor:s.distributor,supplier:s.supplier,additional:s.additional,taxes:s.taxes,subtotal:s.subtotal}))??null,reservationCount:(i.reservations?.length??0)+(i.warnings?.length??0),findings:(i.findings??[]).map((f:any)=>({code:text(f.code,80),message:text(f.message,500),severity:'REVIEW'}))};
 });
 return {formatVersion:REPORT_FORMAT,kind,generatedAt,header:{organizationId:header.organizationId,organizationName:text(header.organizationName),customerId:header.customerId,customerName:text(header.customerName),unitId:header.unitId,unitName:text(header.unitName),unitCode:text(header.unitCode,80),address:text(header.address,1000),city:text(header.city),state:text(header.state,20),distributor:text(header.distributor),contactName:text(header.contactName,150),contactEmail:text(header.contactEmail,254)},period:a.period,totals:a.totals,coverage:a.coverage,months:a.months.map((m:any)=>({month:m.month,totals:m.totals,cumulative:m.cumulative,widths:m.widths})),composition:a.composition,invoices,publications,events:events.map(e=>({id:e.id,revision:e.revision,title:text(e.title,160),priority:e.priority,effectiveDate:e.effective_date})),roi:null,annualProjection:null,unavailable:[...a.unavailable,'Desperdícios: quantificação depende de diagnóstico e evidência publicados.'],disclosure:a.disclosure,context:'Relatório da unidade com resultados conferidos e publicados. Cobertura mensal informada; frequência de envio não divide medições mensais em quinzenas. Ressalvas das fontes continuam válidas. Novas evidências exigem nova apuração e um novo relatório.'};
}
