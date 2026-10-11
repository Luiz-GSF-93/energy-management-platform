import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SANDBOX_URL} from './sales-asaas.adapter';

export type CheckSource={kind:string;remoteId:string;binding?:{customer:string;reference:string;grossCents:number;subscription?:string;dueDate?:string};parameters?:any;verified?:boolean;subscriptionEvidence?:any};
export type CheckEvidence={complete:boolean;blockers:string[];payment?:any;refunds?:any[];subscription?:any;payments?:any[];refundedCents?:number;remainingCents?:number};
export const CHECK_DIAGNOSTICS=['QUERY_FAILED','QUERY_CONFIG_INVALID','QUERY_TIMEOUT','QUERY_NETWORK_ERROR','QUERY_HTTP_ERROR','QUERY_RESPONSE_LIMIT','QUERY_SCHEMA_INVALID','QUERY_BINDING_MISMATCH','EXECUTED_EVIDENCE_MISSING'] as const;
export class AdjustmentQueryError extends Error{constructor(readonly code:typeof CHECK_DIAGNOSTICS[number]){super(code);}}
export const queryDiagnostic=(error:unknown)=>error instanceof AdjustmentQueryError?error.code:'QUERY_FAILED';
const cents=(v:unknown)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000000||Math.abs(v*100-Math.round(v*100))>0.00001)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');return Math.round(v*100);};
const date=(v:unknown)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');return v;};
const identifier=(v:unknown,prefix='')=>{if(typeof v!=='string'||!new RegExp('^'+prefix+'[a-zA-Z0-9_-]{1,120}$').test(v))throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');return v;};
const states=['PENDING','RECEIVED','CONFIRMED','OVERDUE','REFUNDED','RECEIVED_IN_CASH','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL','DUNNING_REQUESTED','DUNNING_RECEIVED','AWAITING_RISK_ANALYSIS'];
export function checkedPayment(raw:any,source:CheckSource){
 const b=source.binding;if(!b||!raw||raw.id!==source.remoteId||raw.customer!==b.customer||raw.externalReference!==b.reference||cents(raw.value)!==Number(b.grossCents)||b.subscription&&raw.subscription!==b.subscription||b.dueDate&&raw.dueDate!==b.dueDate||!states.includes(raw.status)||typeof raw.deleted!=='boolean'||!['BOLETO','PIX','CREDIT_CARD','UNDEFINED'].includes(raw.billingType))throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
 return {id:raw.id,customer:raw.customer,reference:raw.externalReference,grossCents:cents(raw.value),status:raw.status,deleted:raw.deleted,billingType:raw.billingType,splitPresent:Array.isArray(raw.split)?raw.split.length>0:raw.split!==undefined&&raw.split!==null};
}
export function checkedRefund(raw:any,payment:string){
 if(!raw||!['DONE','PENDING','CANCELLED'].includes(raw.status)||raw.payment!==undefined&&raw.payment!==payment)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
 return {id:identifier(raw.id),status:raw.status,valueCents:cents(raw.value),date:date(raw.dateCreated?.slice(0,10))};
}
function executedSubscriptionEvidence(source:CheckSource){
 const p=source.parameters,e=source.subscriptionEvidence;
 // Bind to the verified executed command, preserving planned parameters separately.
 // A planned end date may differ from the limit explicitly used at execution.
 if(source.verified!==true||!p||!e)throw new AdjustmentQueryError('EXECUTED_EVIDENCE_MISSING');
 if(e.id!==source.remoteId||e.customer!==p.customer||e.reference!==p.externalReference||e.grossCents!==cents(p.value)||e.cycle!==p.cycle||e.billingType!==p.billingType)throw new AdjustmentQueryError('QUERY_BINDING_MISMATCH');
 date(e.endDate);return e;
}
export function checkedSubscription(raw:any,source:CheckSource){
 const e=executedSubscriptionEvidence(source);
 if(!raw||raw.id!==e.id||raw.customer!==e.customer||raw.externalReference!==e.reference||cents(raw.value)!==e.grossCents||raw.cycle!==e.cycle||raw.billingType!==e.billingType||raw.endDate!==e.endDate)throw new AdjustmentQueryError('QUERY_BINDING_MISMATCH');
 if(!['ACTIVE','INACTIVE','EXPIRED'].includes(raw.status)||typeof raw.deleted!=='boolean')throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
 return {id:raw.id,customer:raw.customer,reference:raw.externalReference,grossCents:cents(raw.value),status:raw.status,deleted:raw.deleted,nextDueDate:date(raw.nextDueDate),endDate:date(raw.endDate)};
}
export function checkedAffectedPayment(raw:any,s:{id:string;customer:string}){
 if(!raw||raw.subscription!==s.id||raw.customer!==s.customer||!states.includes(raw.status)||typeof raw.deleted!=='boolean')throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
 return {id:identifier(raw.id,'pay_'),customer:raw.customer,subscription:raw.subscription,status:raw.status,deleted:raw.deleted,grossCents:cents(raw.value),dueDate:date(raw.dueDate),affectedByRemoval:!raw.deleted&&['PENDING','OVERDUE'].includes(raw.status)};
}
@Injectable()
export class SalesAdjustmentCheckAdapter {
 constructor(private readonly config:ConfigService){}
 private async get(path:string,scope:'CHECK'|'COMMAND'='CHECK'){
  const key=this.config.get<string>('SALES_ASAAS_SANDBOX_API_KEY');
  if(this.config.get(scope==='COMMAND'?'SALES_ADJUSTMENT_COMMANDS_ENABLED':'SALES_ADJUSTMENT_CHECKS_ENABLED')!=='true'||this.config.get(scope==='COMMAND'?'SALES_ADJUSTMENT_COMMAND_CALLS_ENABLED':'SALES_ADJUSTMENT_CHECK_CALLS_ENABLED')!=='true'||this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true'||this.config.get('SALES_ASAAS_BASE_URL')!==SANDBOX_URL||!key||key.length<20)throw new AdjustmentQueryError('QUERY_CONFIG_INVALID');
  let r:Response;try{r=await fetch(SANDBOX_URL+path,{method:'GET',headers:{access_token:key,'User-Agent':'EnergyOS-Sandbox-4J'},redirect:'error',signal:AbortSignal.timeout(10000)});}catch(error){throw new AdjustmentQueryError(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'QUERY_TIMEOUT':'QUERY_NETWORK_ERROR');}
  if(!r.ok)throw new AdjustmentQueryError('QUERY_HTTP_ERROR');if(!r.body)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>131072)throw new AdjustmentQueryError('QUERY_RESPONSE_LIMIT');parts.push(x.value);}}catch(error){if(error instanceof AdjustmentQueryError)throw error;throw new AdjustmentQueryError(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'QUERY_TIMEOUT':'QUERY_NETWORK_ERROR');}finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');}
 }
 // Only documented list envelopes or a complete bounded refunds array are accepted.
 // Unsupported schemas, duplicates and truncated enumeration never prove completeness.
 private async enumerate(path:string,convert:(x:any)=>any,allowArray=false,scope:'CHECK'|'COMMAND'='CHECK'){
  const rows:any[]=[];let total:number|undefined;
  for(let offset=0;offset<100;offset+=25){
   const raw=await this.get(path+(path.includes('?')?'&':'?')+new URLSearchParams({offset:String(offset),limit:'25'}),scope);
   if(Array.isArray(raw)){if(!allowArray||offset!==0||raw.length>100)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');for(const r of raw){const v=convert(r);if(rows.some(x=>x.id===v.id))throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');rows.push(v);}return rows;}
   if(!raw||!Array.isArray(raw.data)||raw.data.length>25||typeof raw.hasMore!=='boolean'||!Number.isSafeInteger(raw.totalCount)||raw.totalCount<0||raw.hasMore&&raw.data.length!==25||total!==undefined&&total!==raw.totalCount)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
   total=raw.totalCount;for(const r of raw.data){const v=convert(r);if(rows.some(x=>x.id===v.id))throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');rows.push(v);}
   if(!raw.hasMore){if(rows.length!==total)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');return rows;}
  }
  throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
 }
 async check(source:CheckSource,params:any,scope:'CHECK'|'COMMAND'='CHECK'):Promise<CheckEvidence>{
  if(source.kind==='REFUND_PAYMENT'){
   identifier(source.remoteId,'pay_');const payment=checkedPayment(await this.get('/payments/'+source.remoteId,scope),source);
   let refunds:any[];try{refunds=await this.enumerate('/payments/'+source.remoteId+'/refunds',x=>checkedRefund(x,source.remoteId),true,scope);}catch(error){return {complete:false,blockers:['REFUNDS_INCOMPLETE',queryDiagnostic(error)],payment};}
   const blockers:string[]=[];const refundedCents=refunds.filter(x=>x.status==='DONE').reduce((n,x)=>n+x.valueCents,0);
   if(JSON.stringify(checkedPayment(await this.get('/payments/'+source.remoteId,scope),source))!==JSON.stringify(payment))blockers.push('REMOTE_SOURCE_CHANGED');
   if(payment.deleted||payment.status!=='RECEIVED')blockers.push('PAYMENT_NOT_RECEIVED');
   if(!['PIX','CREDIT_CARD'].includes(payment.billingType))blockers.push('METHOD_UNSUPPORTED');
   if(payment.splitPresent)blockers.push('SPLIT_REVIEW_REQUIRED');
   if(refunds.some(x=>x.status==='PENDING'))blockers.push('REFUND_PENDING');
   if(refundedCents>payment.grossCents||params.amountCents+refundedCents>payment.grossCents)blockers.push('REFUND_EXCEEDS_EVIDENCE');
   return {complete:true,blockers,payment,refunds,refundedCents,remainingCents:Math.max(0,payment.grossCents-refundedCents)};
  }
  if(source.kind!=='CANCEL_SUBSCRIPTION')throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');identifier(source.remoteId,'sub_');executedSubscriptionEvidence(source);
  const subscription=checkedSubscription(await this.get('/subscriptions/'+source.remoteId,scope),source);
  let payments:any[];try{payments=await this.enumerate('/subscriptions/'+source.remoteId+'/payments',x=>checkedAffectedPayment(x,subscription),false,scope);}catch(error){return {complete:false,blockers:['PAYMENTS_INCOMPLETE',queryDiagnostic(error)],subscription};}
  const blockers:string[]=[];if(subscription.deleted||subscription.status!=='ACTIVE')blockers.push('SUBSCRIPTION_NOT_ACTIVE');
  // API state is read twice; concurrent changes invalidate the snapshot.
  if(JSON.stringify(checkedSubscription(await this.get('/subscriptions/'+source.remoteId,scope),source))!==JSON.stringify(subscription))blockers.push('REMOTE_SOURCE_CHANGED');
  return {complete:true,blockers,subscription,payments};
 }
}
