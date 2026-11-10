import {createHash} from 'node:crypto';
import {InvoiceConsumption,reconcileConsumption} from './ccee-reconciliation';
import {quantityMicro,CCEE_HOURLY_TIME_SEMANTICS} from './ccee-private.connector';
const hour=3600000;
const decimal=(n:bigint)=>{const sign=n<0n?'-':'';n=n<0n?-n:n;return sign+(n/1000000n)+'.'+(n%1000000n).toString().padStart(6,'0');};
export function invoiceReadingPeriod(invoice:InvoiceConsumption){
 const valid=(v:unknown):v is string=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}T\d{2}:00:00-03:00$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)-10800000).toISOString().slice(0,19)+'-03:00'===v;
 if(!valid(invoice.start)||!valid(invoice.end))return null;
 const start=Date.parse(invoice.start),end=Date.parse(invoice.end);
 if(end<=start||end-start>90*24*hour)return null;
 return {periodStart:invoice.start,periodEnd:invoice.end};
}
/** Each monthly source is validated as FINAL before its hours enter the reading period.
 * No prorating, duplicate months, reactive energy or inferred midnight boundaries. */
export function reconcileReadingPeriod(anchor:any,binding:any,invoice:InvoiceConsumption,jobs:any[]){
 const period=invoiceReadingPeriod(invoice);if(!period)return {...reconcileConsumption(anchor,binding,invoice),missingMonths:[] as string[]};
 const start=Date.parse(period.periodStart),end=Date.parse(period.periodEnd),issues=[...invoice.issues];
 const months:string[]=[];for(let at=start;at<end;at+=hour){const m=new Date(at-10800000).toISOString().slice(0,7);if(!months.includes(m))months.push(m);}
 const selected=new Map<number,bigint>(),sources:any[]=[],missingMonths:string[]=[];
 for(const month of months){
  const matches=jobs.filter(j=>j.month?.slice(0,7)===month);
  if(matches.length!==1){missingMonths.push(month);issues.push('CCEE_READING_PERIOD_SOURCE_MISSING');continue;}
  const job=matches[0];
  if(job.organization_id!==anchor.organization_id||job.authorization_id!==anchor.authorization_id||job.authorization_id!==binding.id){issues.push('CCEE_READING_PERIOD_IDENTITY_MISMATCH');continue;}
  const monthStart=month+'-01T00:00:00-03:00',monthEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10)+'T00:00:00-03:00';
  // Reuse the complete monthly source/quality checks, with a neutral invoice basis.
  const checked=reconcileConsumption(job,binding,{...invoice,start:monthStart,end:monthEnd,quantityKwh:'0',includesLosses:false,identityChecked:true,issues:[]});
  if(checked.issues.some(i=>i.startsWith('CCEE_'))){issues.push(...checked.issues.filter(i=>i.startsWith('CCEE_')));continue;}
  if(!/^[a-f0-9]{64}$/.test(job.result.record.evidence.sourceHash??'')){issues.push('CCEE_HOURLY_COVERAGE_REVIEW');continue;}
  const labelled=job.result.data.timeSemantics===CCEE_HOURLY_TIME_SEMANTICS;
  for(const row of job.result.data.rows){const at=Date.parse(row.end)-(labelled?0:hour);if(at>=start&&at<end){if(selected.has(at))issues.push('CCEE_HOURLY_COVERAGE_REVIEW');else selected.set(at,quantityMicro(row.quantityKwh,'kWh'));}}
  sources.push({jobId:job.id,month,sourceHash:job.result.record.evidence.sourceHash,authorizationId:job.authorization_id});
 }
 if(binding.measurement_basis!=='NO_LOSSES'||invoice.includesLosses!==false)issues.push('LOSS_BASES_NOT_COMPARABLE');
 if(!invoice.identityChecked)issues.push('IDENTITY_NOT_CONFIRMED');
 let billed:bigint|null=null;try{billed=quantityMicro(invoice.quantityKwh,'kWh');}catch{issues.push('INVOICE_QUANTITY_UNAVAILABLE');}
 const expectedHours=(end-start)/hour;
 if(selected.size!==expectedHours)issues.push('CCEE_HOURLY_COVERAGE_REVIEW');
 let total=0n;const daily=new Map<string,{sum:bigint;hours:number;expectedHours:number}>();
 for(let at=start;at<end;at+=hour){const day=new Date(at-10800000).toISOString().slice(0,10),d=daily.get(day)??{sum:0n,hours:0,expectedHours:0};d.expectedHours++;if(selected.has(at)){d.sum+=selected.get(at)!;total+=selected.get(at)!;d.hours++;}daily.set(day,d);}
 const comparable=issues.length===0&&billed!==null,delta=comparable?total-billed!:null;
 const percent=delta===null||billed===0n?null:decimal((delta*100000000n+(delta<0n?-billed!/2n:billed!/2n))/billed!);
 const payload={formulaVersion:'ccee-invoice-v3-reading-period',organizationId:anchor.organization_id,customerId:binding.customer_id,unitId:binding.consumer_unit_id,month:anchor.month.slice(0,7),jobId:anchor.id,documentId:invoice.documentId,state:comparable?'COMPARABLE':'REVIEW_REQUIRED',cceeKwh:selected.size===expectedHours?decimal(total):null,observedKwh:selected.size?decimal(total):null,invoiceKwh:billed===null?null:decimal(billed),deltaKwh:delta===null?null:decimal(delta),deltaPercent:percent,daily:[...daily].map(([day,d])=>({day,quantityKwh:d.hours===d.expectedHours?decimal(d.sum):null,observedKwh:d.hours?decimal(d.sum):null,hours:d.hours,expectedHours:d.expectedHours})),issues:[...new Set(issues)],missingMonths,recommendations:['Comparação pelo período efetivo comprovado da fatura, sem rateio de totais mensais.','Fontes e relatórios publicados são preservados.'],invoice,source:{authorizationId:binding.id,revision:binding.revision,measurementBasis:binding.measurement_basis,intervalStart:period.periodStart,intervalEnd:period.periodEnd,jobs:sources,expectedHours,observedHours:selected.size}};
 return {...payload,payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}
