import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {paymentId,paymentSummary,SANDBOX_URL} from './sales-asaas.adapter';
export type EvidenceSource={paymentId:string;customer:string;reference:string;grossCents:number;subscription?:string;dueDate?:string};
const cents=(v:unknown)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000000||Math.abs(v*100-Math.round(v*100))>0.00001)throw new Error();return Math.round(v*100);};
const date=(v:unknown)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new Error();return v;};
export function evidencePayment(raw:any,source:EvidenceSource){
 const p=paymentSummary(raw);if(p.id!==source.paymentId||p.customer!==source.customer||p.reference!==source.reference||p.grossCents!==Number(source.grossCents)||source.subscription&&raw.subscription!==source.subscription||source.dueDate&&raw.dueDate!==source.dueDate)throw new Error();
 const refundsComplete=Array.isArray(raw.refunds);if(raw.refunds!==undefined&&raw.refunds!==null&&!refundsComplete)throw new Error();
 if(refundsComplete&&raw.refunds.length>100)throw new Error();
 const refunds=refundsComplete?raw.refunds.map((r:any)=>{if(!r||!['DONE','PENDING','CANCELLED'].includes(r.status)||typeof r.dateCreated!=='string'||!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(r.dateCreated))throw new Error();date(r.dateCreated.slice(0,10));return {status:r.status,valueCents:cents(r.value),date:r.dateCreated};}):[];
 if(refunds.reduce((n:number,r:any)=>n+(r.status==='DONE'?r.valueCents:0),0)>p.grossCents)throw new Error();
 return {payment:{...p,status:raw.deleted===true?'DELETED':p.status,...(source.subscription?{subscription:source.subscription,dueDate:source.dueDate}:{})},refunds,refundsComplete};
}
export function evidenceInvoice(raw:any,source:EvidenceSource){
 if(!raw||typeof raw.id!=='string'||!/^inv_[a-zA-Z0-9]{1,100}$/.test(raw.id)||raw.payment!==source.paymentId||raw.customer!==source.customer||!['SCHEDULED','AUTHORIZED','PROCESSING_CANCELLATION','CANCELED','CANCELLATION_DENIED','ERROR'].includes(raw.status))throw new Error();
 return {id:raw.id,payment:raw.payment,customer:raw.customer,status:raw.status,valueCents:cents(raw.value),effectiveDate:date(raw.effectiveDate)};
}
@Injectable()
export class SalesEvidenceAdapter {
 constructor(private readonly config:ConfigService){}
 private async get(path:string){
  const key=this.config.get<string>('SALES_ASAAS_SANDBOX_API_KEY');
  if(this.config.get('SALES_EVIDENCE_ENABLED')!=='true'||this.config.get('SALES_EVIDENCE_CALLS_ENABLED')!=='true'||this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true'||this.config.get('SALES_ASAAS_BASE_URL')!==SANDBOX_URL||!key||key.length<20)throw new ServiceUnavailableException('Consulta de evidências desligada.');
  const response=await fetch(SANDBOX_URL+path,{method:'GET',headers:{access_token:key,'User-Agent':'EnergyOS-Sandbox-4H'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.body)throw new Error();const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>65536)throw new Error();parts.push(r.value);}}finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
 }
 async evidence(source:EvidenceSource){
  if(!paymentId.test(source.paymentId))throw new ServiceUnavailableException('Origem inválida.');
  let p;try{p=evidencePayment(await this.get('/payments/'+source.paymentId),source);}catch{throw new ServiceUnavailableException('Cobrança não conferida; tentativa preservada.');}
  const invoices:any[]=[];let invoicesComplete=false;
  try{for(let offset=0;offset<100;offset+=25){const raw=await this.get('/invoices?'+new URLSearchParams({payment:source.paymentId,offset:String(offset),limit:'25'}));if(!raw||!Array.isArray(raw.data)||raw.data.length>25||typeof raw.hasMore!=='boolean'||raw.hasMore&&raw.data.length!==25)throw new Error();
   for(const row of raw.data){const inv=evidenceInvoice(row,source);if(invoices.some(x=>x.id===inv.id))throw new Error();invoices.push(inv);}if(!raw.hasMore){invoicesComplete=true;break;}}
  }catch{invoicesComplete=false;}
  return {...p,invoices,invoicesComplete};
 }
}
