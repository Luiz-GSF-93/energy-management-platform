import type {PublishedConsumption} from './ConsumptionViews';

type Invoice=PublishedConsumption&{groupId:string};
export type ConsumptionReport={id:string;body:{header:{organizationId:string;customerId:string;unitId:string};period:{from:string;to:string};invoices:Invoice[]}};
export type ConsumptionResponse={organizationId:string;primary:{invoices:{groupId:string;month:string;unitId:string;version:number;payloadHash:string;measurements:{version:number;revision:number;validatedAt:string;source:string;measurements:{consumptionTotal:string|null;consumptionPeak:string|null;consumptionOffPeak:string|null}}|null}[]}};
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(v);

export function publishedConsumptionRows(report:ConsumptionReport,response:ConsumptionResponse):PublishedConsumption[]{
 if(response.organizationId!==report.body.header.organizationId)throw new Error('Resposta de medições fora da organização do relatório.');
 return report.body.invoices.map(invoice=>{
  const matching=response.primary.invoices.filter(row=>row.unitId===report.body.header.unitId&&row.month===invoice.month&&row.groupId===invoice.groupId&&row.version===invoice.version&&row.payloadHash===invoice.payloadHash&&Boolean(invoice.payloadHash));
  if(matching.length!==1)return {...invoice,peakKwh:null,offPeakKwh:null,bandMessage:'Publicação correspondente indisponível. A leitura atual não substitui a versão deste relatório.'};
  const m=matching[0].measurements;
  if(!m||!m.validatedAt||!m.source||!Number.isInteger(m.version)||!Number.isInteger(m.revision)||m.measurements.consumptionTotal!==invoice.consumptionKwh)return {...invoice,peakKwh:null,offPeakKwh:null,bandMessage:'Leitura ou rastreabilidade incompatível com a versão preservada.'};
  return {...invoice,peakKwh:decimal(m.measurements.consumptionPeak)?m.measurements.consumptionPeak:null,offPeakKwh:decimal(m.measurements.consumptionOffPeak)?m.measurements.consumptionOffPeak:null,measurementSource:m.source,measurementVersion:m.version,measurementRevision:m.revision,bandMessage:'Medição validada da mesma publicação, competência e unidade.'};
 });
}
