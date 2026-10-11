import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {paymentId,paymentSummary,SANDBOX_URL} from './sales-asaas.adapter';
import {EvidenceDiagnostic,EvidenceDiagnosticScope,EvidenceQueryError,evidenceDiagnostic} from './sales-evidence-diagnostics';
export type EvidenceSource={paymentId:string;customer:string;reference:string;grossCents:number;subscription?:string;dueDate?:string};
const cents=(v:unknown)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000000||Math.abs(v*100-Math.round(v*100))>0.00001)throw new Error();return Math.round(v*100);};
const date=(v:unknown)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new Error();return v;};
const refundSummary=(r:any)=>{if(!r||!['DONE','PENDING','CANCELLED'].includes(r.status)||typeof r.dateCreated!=='string'||!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(r.dateCreated))throw new Error();date(r.dateCreated.slice(0,10));return {status:r.status,valueCents:cents(r.value),date:r.dateCreated};};
export function evidencePayment(raw:any,source:EvidenceSource){
 const p=paymentSummary(raw);if(p.id!==source.paymentId||p.customer!==source.customer||p.reference!==source.reference||p.grossCents!==Number(source.grossCents)||source.subscription&&raw.subscription!==source.subscription||source.dueDate&&raw.dueDate!==source.dueDate)throw new EvidenceQueryError('BINDING_MISMATCH');
 const refundsComplete=Array.isArray(raw.refunds);if(raw.refunds!==undefined&&raw.refunds!==null&&!refundsComplete)throw new Error();
 if(refundsComplete&&raw.refunds.length>100)throw new Error();
 const refunds=refundsComplete?raw.refunds.map(refundSummary):[];
 if(refunds.reduce((n:number,r:any)=>n+(r.status==='DONE'?r.valueCents:0),0)>p.grossCents)throw new Error();
 return {payment:{...p,status:raw.deleted===true?'DELETED':p.status,...(source.subscription?{subscription:source.subscription,dueDate:source.dueDate}:{})},refunds,refundsComplete};
}
export function evidenceInvoice(raw:any,source:EvidenceSource){
 if(!raw||typeof raw.id!=='string'||!/^inv_[a-zA-Z0-9]{1,100}$/.test(raw.id)||!['SCHEDULED','AUTHORIZED','PROCESSING_CANCELLATION','CANCELED','CANCELLATION_DENIED','ERROR'].includes(raw.status))throw new Error();
 if(raw.payment!==source.paymentId||raw.customer!==source.customer)throw new EvidenceQueryError('BINDING_MISMATCH');
 return {id:raw.id,payment:raw.payment,customer:raw.customer,status:raw.status,valueCents:cents(raw.value),effectiveDate:date(raw.effectiveDate)};
}
export function evidenceRefund(raw:any,source:EvidenceSource){
 if(!raw||typeof raw.id!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(raw.id))throw new Error();
 if(raw.payment!==undefined&&raw.payment!==source.paymentId)throw new EvidenceQueryError('BINDING_MISMATCH');
 return {id:raw.id,...refundSummary(raw)};
}
@Injectable()
export class SalesEvidenceAdapter {
 constructor(private readonly config:ConfigService){}
 private async get(path:string,deadline:number,scope:EvidenceDiagnosticScope){
  const key=this.config.get<string>('SALES_ASAAS_SANDBOX_API_KEY');
  if(this.config.get('SALES_EVIDENCE_ENABLED')!=='true'||this.config.get('SALES_EVIDENCE_CALLS_ENABLED')!=='true'||this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true'||this.config.get('SALES_ASAAS_BASE_URL')!==SANDBOX_URL||!key||key.length<20)throw new EvidenceQueryError('CONFIG_INVALID',undefined,scope);
  const remaining=deadline-Date.now();if(remaining<=0)throw new EvidenceQueryError('COLLECTION_DEADLINE',undefined,scope);
  let response:Response;try{response=await fetch(SANDBOX_URL+path,{method:'GET',headers:{access_token:key,'User-Agent':'EnergyOS-Sandbox-4H'},redirect:'error',signal:AbortSignal.timeout(Math.min(10000,remaining))});}catch(error){throw new EvidenceQueryError(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT':'NETWORK_ERROR',undefined,scope);}
  if(!response.ok)throw new EvidenceQueryError('HTTP_ERROR',response.status,scope);if(!response.body)throw new EvidenceQueryError('JSON_INVALID',undefined,scope);const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>65536)throw new EvidenceQueryError('RESPONSE_LIMIT',undefined,scope);parts.push(r.value);}}catch(error){if(error instanceof EvidenceQueryError)throw error;throw new EvidenceQueryError(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT':'NETWORK_ERROR',undefined,scope);}finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new EvidenceQueryError('JSON_INVALID',undefined,scope);}
 }
 async evidence(source:EvidenceSource){
  if(!paymentId.test(source.paymentId))throw new ServiceUnavailableException('Origem inválida.');
  // Ten bounded GETs share 70 seconds, leaving room to finish the existing 90-second lease.
  const deadline=Date.now()+70000;
  const diagnostics:EvidenceDiagnostic[]=[];
  let p;try{p=evidencePayment(await this.get('/payments/'+source.paymentId,deadline,'PAYMENT'),source);}catch(error){const d=evidenceDiagnostic(error,'PAYMENT','PAYMENT_SCHEMA_INVALID');throw new EvidenceQueryError(d.code,d.httpStatus,d.scope);}
  let refunds:any[]=[];let refundsComplete=false;let total:number|undefined;
  try{for(let offset=0;offset<100;offset+=25){
   const raw=await this.get('/payments/'+source.paymentId+'/refunds?'+new URLSearchParams({offset:String(offset),limit:'25'}),deadline,'REFUNDS');
   if(Array.isArray(raw)){
    if(offset!==0||raw.length>100)throw new EvidenceQueryError('HISTORY_TRUNCATED');
    for(const row of raw){const r=evidenceRefund(row,source);if(refunds.some(x=>x.id===r.id))throw new EvidenceQueryError('DUPLICATE_ITEMS');refunds.push(r);}refundsComplete=true;break;
   }
   if(!raw||typeof raw!=='object')throw new EvidenceQueryError('REFUNDS_NOT_OBJECT');
   if(!Object.prototype.hasOwnProperty.call(raw,'data'))throw new EvidenceQueryError('REFUNDS_DATA_MISSING');
   if(!Array.isArray(raw.data))throw new EvidenceQueryError('REFUNDS_DATA_INVALID');
   if(raw.data.length>25)throw new EvidenceQueryError('REFUNDS_PAGE_OVERSIZED');
   if(!Object.prototype.hasOwnProperty.call(raw,'hasMore'))throw new EvidenceQueryError('REFUNDS_HAS_MORE_MISSING');
   if(typeof raw.hasMore!=='boolean')throw new EvidenceQueryError('REFUNDS_HAS_MORE_INVALID');
   if(!Object.prototype.hasOwnProperty.call(raw,'totalCount'))throw new EvidenceQueryError('REFUNDS_TOTAL_MISSING');
   if(!Number.isSafeInteger(raw.totalCount)||raw.totalCount<0)throw new EvidenceQueryError('REFUNDS_TOTAL_INVALID');
   if(raw.hasMore&&raw.data.length!==25)throw new EvidenceQueryError('REFUNDS_INTERMEDIATE_INCOMPLETE');
   if(total!==undefined&&total!==raw.totalCount)throw new EvidenceQueryError('PAGINATION_CHANGED');
   total=raw.totalCount;for(const row of raw.data){const r=evidenceRefund(row,source);if(refunds.some(x=>x.id===r.id))throw new EvidenceQueryError('DUPLICATE_ITEMS');refunds.push(r);}
   if(!raw.hasMore){if(refunds.length!==total)throw new EvidenceQueryError('REFUNDS_FINAL_TOTAL_MISMATCH');refundsComplete=true;break;}
  }
  if(refunds.filter(x=>x.status==='DONE').reduce((n,x)=>n+x.valueCents,0)>p.payment.grossCents)throw new EvidenceQueryError('REFUND_ROW_INVALID');
  if(!refundsComplete)diagnostics.push({scope:'REFUNDS',code:'HISTORY_TRUNCATED'});
  }catch(error){refunds=[];refundsComplete=false;diagnostics.push(evidenceDiagnostic(error,'REFUNDS','REFUND_ROW_INVALID'));}
  const invoices:any[]=[];let invoicesComplete=false;
  try{for(let offset=0;offset<100;offset+=25){const raw=await this.get('/invoices?'+new URLSearchParams({payment:source.paymentId,offset:String(offset),limit:'25'}),deadline,'INVOICES');if(!raw||!Array.isArray(raw.data)||raw.data.length>25||typeof raw.hasMore!=='boolean'||raw.hasMore&&raw.data.length!==25)throw new EvidenceQueryError('INVOICES_ENVELOPE_INVALID');
   for(const row of raw.data){const inv=evidenceInvoice(row,source);if(invoices.some(x=>x.id===inv.id))throw new EvidenceQueryError('DUPLICATE_ITEMS');invoices.push(inv);}if(!raw.hasMore){invoicesComplete=true;break;}}
   if(!invoicesComplete)diagnostics.push({scope:'INVOICES',code:'HISTORY_TRUNCATED'});
  }catch(error){invoicesComplete=false;diagnostics.push(evidenceDiagnostic(error,'INVOICES','INVOICE_ROW_INVALID'));}
  try{const after=evidencePayment(await this.get('/payments/'+source.paymentId,deadline,'RECHECK'),source);if(JSON.stringify(after.payment)!==JSON.stringify(p.payment))throw new EvidenceQueryError('SOURCE_CHANGED');}catch(error){const d=evidenceDiagnostic(error,'RECHECK','PAYMENT_SCHEMA_INVALID');throw new EvidenceQueryError(d.code,d.httpStatus,d.scope);}
  return {payment:p.payment,refunds:refunds.map(({id,...r})=>r),refundsComplete,invoices,invoicesComplete,diagnostics};
 }
}
