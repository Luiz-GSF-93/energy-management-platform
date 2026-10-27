import {createHash} from 'node:crypto';
import {extractCpflPaulistaLayout} from '../ocr/cpfl-paulista-layout';
import {assessmentMatchesDocument} from '../ocr/invoice-assessment';
import {quantityMicro,CCEE_HOURLY_TIME_SEMANTICS} from './ccee-private.connector';
export const CCEE_RECONCILIATION_VERSION='ccee-invoice-v1';
const decimal=(n:bigint,scale=6)=>{const sign=n<0n?'-':'';n=n<0n?-n:n;const s=n.toString().padStart(scale+1,'0');return sign+s.slice(0,-scale)+'.'+s.slice(-scale);};
export type InvoiceConsumption={documentId:string;fileHash:string;ocrJobId:string;layoutVersion:string|null;quantityKwh:string|null;start:string|null;end:string|null;includesLosses:boolean|null;identityChecked:boolean;sources:string[];issues:string[];basisEvidence?:{reference:string;actorId:string;kind:'OPERATOR_VERIFIED_SOURCE'}};
/** Uses preserved evidence only. Missing hours or loss treatment are never inferred from the reference month. */
export function invoiceConsumption(doc:any,ocr:any):InvoiceConsumption{
 const out:InvoiceConsumption={documentId:doc.id,fileHash:doc.file_hash,ocrJobId:ocr?.job_id??'',layoutVersion:null,quantityKwh:null,start:null,end:null,includesLosses:null,identityChecked:false,sources:[],issues:[]};
 if(!doc.file_verified||doc.document_type!=='INVOICE_DISTRIBUTOR'||ocr?.file_hash!==doc.file_hash||!assessmentMatchesDocument(ocr?.evidence?.assessment,doc)){out.issues.push('INVOICE_SOURCE_NOT_VERIFIED');return out;}
 const a=ocr.evidence.assessment,checks=a.intake?.checks??[];
 out.identityChecked=['taxId','unit','period'].every(field=>checks.some((c:any)=>c.field===field&&c.state==='MATCH'));
 if(!out.identityChecked)out.issues.push('INVOICE_IDENTITY_REVIEW_REQUIRED');
 const layout=extractCpflPaulistaLayout(ocr.raw_result);out.layoutVersion=layout.version;
 const values=layout.preparation?.values??[],total=values.find(v=>v.key==='consumptionTotalKwh');
 if(total?.decimal&&total.state==='EXTRACTED_REVIEW'){out.quantityKwh=total.decimal;out.sources=total.sources;}
 else out.issues.push('INVOICE_ACTIVE_QUANTITY_UNAVAILABLE');
 // Date-only readings remain visible as evidence, without inventing midnight or a loss basis.
 for(const name of ['previousReading','currentReading']){
  const f=layout.fields.filter(f=>f.name===name);if(f.length===1)out.sources.push(name+': '+f[0].value.text);
 }
 out.issues.push('INVOICE_EXACT_INTERVAL_NOT_PROVEN','INVOICE_LOSS_BASIS_NOT_PROVEN');
 return out;
}
/** An explicit source check is preserved as an operator statement, never presented as OCR inference. */
export function verifiedInvoiceBasis(invoice:InvoiceConsumption,basis:any,actorId:string):InvoiceConsumption{
 if(!basis||Object.keys(basis).sort().join(',')!=='end,identityConfirmed,includesLosses,reference,start'||typeof basis.reference!=='string'||basis.reference.trim().length<10||basis.reference.length>1000||typeof basis.includesLosses!=='boolean'||basis.identityConfirmed!==true||[basis.start,basis.end].some(v=>typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:00:00-03:00$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(Date.parse(v)-10800000).toISOString().slice(0,19)+'-03:00'!==v)||Date.parse(basis.end)<=Date.parse(basis.start))throw Error('INVOICE_BASIS_SOURCE_REQUIRED');
 if(invoice.issues.includes('INVOICE_SOURCE_NOT_VERIFIED'))throw Error('INVOICE_SOURCE_NOT_VERIFIED');
 return {...invoice,start:basis.start,end:basis.end,includesLosses:basis.includesLosses,identityChecked:true,basisEvidence:{reference:basis.reference.trim(),actorId,kind:'OPERATOR_VERIFIED_SOURCE'},issues:invoice.issues.filter(i=>!['INVOICE_EXACT_INTERVAL_NOT_PROVEN','INVOICE_LOSS_BASIS_NOT_PROVEN','INVOICE_IDENTITY_REVIEW_REQUIRED'].includes(i))};
}
export function measurementCsv(job:any,binding:any){
 if(job.kind!=='MEASUREMENTS'||job.state!=='SUCCEEDED'||!job.result?.complete||!Array.isArray(job.result.data?.rows)||job.result.data.rows.length>744)throw Error('CCEE_EXPORT_COMPLETE_MEASUREMENTS_REQUIRED');
 const month=job.month.slice(0,7),start=Date.parse(month+'-01T00:00:00-03:00'),hours=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()*24;
 const labelled=job.result.data.timeSemantics===CCEE_HOURLY_TIME_SEMANTICS;
 const sourceRows=[...job.result.data.rows].sort((a:any,b:any)=>Date.parse(a.end)-Date.parse(b.end));
 if(sourceRows.length!==hours||sourceRows.some((r:any,i:number)=>Date.parse(r.end)!==start+(i+(labelled?0:1))*3600000)||! /^[a-f0-9]{64}$/.test(job.result.record?.evidence?.sourceHash??''))throw Error('CCEE_EXPORT_SOURCE_INVALID');
 if(sourceRows.reduce((sum:bigint,r:any)=>sum+quantityMicro(r.quantityKwh,'kWh'),0n)!==quantityMicro(job.result.data.totalKwh,'kWh'))throw Error('CCEE_EXPORT_SOURCE_INVALID');
 const cell=(v:unknown)=>{let s=String(v??'');if(/^[\s]*[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const rows=[['competencia','ponto',labelled?'hora_referencia':'fim_intervalo','consumo_ativo_kWh','qualidade','reativo_fonte','base_perdas','tipo_medida','finalidade','job','hash_fonte']];
 for(const r of sourceRows){quantityMicro(r.quantityKwh,'kWh');if(r.status!=='HCC'||!Number.isFinite(Date.parse(r.end)))throw Error('CCEE_EXPORT_SOURCE_INVALID');rows.push([job.month.slice(0,7),binding.measurement_point,r.end,r.quantityKwh,r.status,r.reactiveSource??'',binding.measurement_basis,job.measurement_kind,job.result.record?.evidence?.finality??'PROVISIONAL',job.id,job.result.record?.evidence?.sourceHash??'']);}
 return '\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n')+'\r\n';
}
/** Exact decimal arithmetic lives in the backend; the UI and EVA never calculate these deltas. */
export function reconcileConsumption(job:any,binding:any,invoice:InvoiceConsumption){
 const labelled=job.result?.data?.timeSemantics===CCEE_HOURLY_TIME_SEMANTICS;
 const issues=[...invoice.issues],r=job.result,month=job.month.slice(0,7),start=month+'-01T00:00:00-03:00',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10)+'T00:00:00-03:00';
 if(job.kind!=='MEASUREMENTS'||job.measurement_kind!=='FINAL'||job.state!=='SUCCEEDED'||!r?.complete||r?.record?.evidence?.finality!=='FINAL')issues.push('CCEE_FINAL_COVERAGE_REQUIRED');
 if(binding.measurement_basis!=='NO_LOSSES'||invoice.includesLosses!==false)issues.push('LOSS_BASES_NOT_COMPARABLE');
 if(Date.parse(invoice.start??'')!==Date.parse(start)||Date.parse(invoice.end??'')!==Date.parse(end))issues.push('INTERVALS_NOT_COMPARABLE');
 if(!invoice.identityChecked)issues.push('IDENTITY_NOT_CONFIRMED');
 let ccee:bigint|null=null,billed:bigint|null=null;
 try{ccee=quantityMicro(r?.data?.totalKwh,'kWh');}catch{issues.push('CCEE_QUANTITY_UNAVAILABLE');}
 try{billed=quantityMicro(invoice.quantityKwh,'kWh');}catch{issues.push('INVOICE_QUANTITY_UNAVAILABLE');}
 const daily=new Map<string,bigint>(),dailyHours=new Map<string,number>();
 for(const row of (r?.data?.rows??[])){
  if(!Number.isFinite(Date.parse(row.end))||row.status!=='HCC'){issues.push('CCEE_HOURLY_COVERAGE_REVIEW');continue;}
  const day=new Date(Date.parse(row.end)-(labelled?0:3600000)-10800000).toISOString().slice(0,10);
  try{daily.set(day,(daily.get(day)??0n)+quantityMicro(row.quantityKwh,'kWh'));dailyHours.set(day,(dailyHours.get(day)??0)+1);}catch{issues.push('CCEE_HOURLY_QUANTITY_REVIEW');}
 }
 const hours=(Date.parse(end)-Date.parse(start))/3600000,rows=r?.data?.rows??[];
 const sorted=[...rows].sort((a:any,b:any)=>Date.parse(a.end)-Date.parse(b.end));
 if(sorted.length!==hours||sorted.some((row:any,i:number)=>Date.parse(row.end)!==Date.parse(start)+(i+(labelled?0:1))*3600000)||ccee===null||[...daily.values()].reduce((a,b)=>a+b,0n)!==ccee)issues.push('CCEE_HOURLY_COVERAGE_REVIEW');
 const comparable=issues.length===0&&ccee!==null&&billed!==null;
 const delta=comparable?ccee!-billed!:null;
 const percent=delta===null||billed===0n?null:decimal((delta*100000000n+(delta<0n?-billed!/2n:billed!/2n))/billed!);
 const recommendations=['Conferir perÃ­odo efetivo de leitura, ponto, grandeza, qualidade e tratamento de perdas antes de atribuir causa Ã  diferenÃ§a.','Preservar a fatura e os registros mensais existentes; eventual ajuste deve gerar novo rascunho para revisÃ£o.','Consultar fontes oficiais CCEE, ANEEL e da distribuidora publicadas e aplicÃ¡veis; este resultado nÃ£o comprova uma infraÃ§Ã£o normativa.'];
 if(comparable&&billed===0n)recommendations.unshift('Base da fatura igual a zero: percentual indisponÃ­vel.');
 const payload={formulaVersion:labelled?'ccee-invoice-v2-hour-label':CCEE_RECONCILIATION_VERSION,organizationId:job.organization_id,customerId:binding.customer_id,unitId:binding.consumer_unit_id,month,jobId:job.id,documentId:invoice.documentId,state:comparable?'COMPARABLE':'REVIEW_REQUIRED',cceeKwh:ccee===null?null:decimal(ccee),invoiceKwh:billed===null?null:decimal(billed),deltaKwh:delta===null?null:decimal(delta),deltaPercent:percent,daily:[...daily].sort(([a],[b])=>a.localeCompare(b)).map(([day,n])=>({day,quantityKwh:decimal(n),hours:dailyHours.get(day)??0,expectedHours:24})),issues:[...new Set(issues)],recommendations,invoice,source:{hash:r?.record?.evidence?.sourceHash??null,authorizationId:binding.id,revision:binding.revision,measurementBasis:binding.measurement_basis,intervalStart:start,intervalEnd:end}};
 return {...payload,payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
}
export function reconciliationSummary(payload:any){
 return 'ConciliaÃ§Ã£o CCEE Ã— fatura Â· '+payload.month+'. CCEE: '+(payload.cceeKwh??'indisponÃ­vel')+' kWh; fatura: '+(payload.invoiceKwh??'indisponÃ­vel')+' kWh. '+(payload.state==='COMPARABLE'?'DiferenÃ§a CCEE menos fatura: '+payload.deltaKwh+' kWh; percentual sobre a fatura: '+(payload.deltaPercent===null?'indisponÃ­vel':payload.deltaPercent+'%')+'.':'Bases ainda nÃ£o comparÃ¡veis; nÃ£o hÃ¡ percentual conclusivo.')+' '+payload.recommendations.join(' ');
}
