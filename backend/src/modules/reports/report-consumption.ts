import {ConflictException,InternalServerErrorException} from '@nestjs/common';
import {decimal} from '../energy-prices/energy-price-score';

/** Read only the exact already-published version; never borrow a later OCR or contract. */
export function withPublishedReportConsumption<T extends {header:any;invoices:any[]}>(body:T,rows:unknown):T{
 if(!Array.isArray(rows)||rows.length>12000)throw new InternalServerErrorException('Leituras publicadas indisponíveis.');
 const invoices=body.invoices.map(invoice=>{
  const candidates=rows.filter(r=>r?.publicationId===invoice.groupId&&r?.unitId===body.header.unitId&&r?.month===invoice.month);
  if(!candidates.length)return invoice;
  if(candidates.length!==1)throw new ConflictException('Leitura publicada ambígua. Atualize o relatório.');
  const row=candidates[0];
  if(row.customerId!==body.header.customerId||row.sourceHash!==invoice.payloadHash||!Array.isArray(row.fields))throw new ConflictException('A publicação mudou durante a consulta. Atualize o relatório.');
  const fields=row.fields.filter((f:any)=>['consumptionTotal','consumptionPeak','consumptionOffPeak'].includes(f?.key));
  if(new Set(fields.map((f:any)=>f.key)).size!==fields.length)throw new ConflictException('Leituras duplicadas na publicação.');
  const values=new Map(fields.map((f:any)=>[f.key,f.value]));
  let total:string,peak:string|null=null,off:string|null=null;
  try{total=values.get('consumptionTotal') as string;if(decimal(total)<=0n)return invoice;}catch{return invoice;}
  if(invoice.consumptionKwh!==null&&invoice.consumptionKwh!==undefined&&decimal(invoice.consumptionKwh)!==decimal(total))throw new ConflictException('Consumo da publicação divergente. Atualize o relatório.');
  try{const p=values.get('consumptionPeak') as string,o=values.get('consumptionOffPeak') as string;if(decimal(p)+decimal(o)===decimal(total)){peak=p;off=o;}}catch{/* Missing bands never split or replace the published total. */}
  return {...invoice,consumptionKwh:total,peakKwh:peak,offPeakKwh:off,bandMessage:peak===null?'Postos não conciliados na versão publicada; total preservado.':'Ponta e fora ponta conciliadas ao total da mesma publicação.'};
 });
 return {...body,invoices};
}
