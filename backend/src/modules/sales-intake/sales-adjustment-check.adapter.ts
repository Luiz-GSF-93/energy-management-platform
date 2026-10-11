import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SANDBOX_URL} from './sales-asaas.adapter';

export type CheckSource={kind:string;remoteId:string;binding?:{customer:string;reference:string;grossCents:number;subscription?:string;dueDate?:string};parameters?:any};
export type CheckEvidence={complete:boolean;blockers:string[];payment?:any;refunds?:any[];subscription?:any;payments?:any[];refundedCents?:number;remainingCents?:number};
const cents=(v:unknown)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000000||Math.abs(v*100-Math.round(v*100))>0.00001)throw new Error();return Math.round(v*100);};
const date=(v:unknown)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new Error();return v;};
const identifier=(v:unknown,prefix='')=>{if(typeof v!=='string'||!new RegExp('^'+prefix+'[a-zA-Z0-9_-]{1,120}$').test(v))throw new Error();return v;};
const states=['PENDING','RECEIVED','CONFIRMED','OVERDUE','REFUNDED','RECEIVED_IN_CASH','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL','DUNNING_REQUESTED','DUNNING_RECEIVED','AWAITING_RISK_ANALYSIS'];
export function checkedPayment(raw:any,source:CheckSource){
 const b=source.binding;if(!b||!raw||raw.id!==source.remoteId||raw.customer!==b.customer||raw.externalReference!==b.reference||cents(raw.value)!==Number(b.grossCents)||b.subscription&&raw.subscription!==b.subscription||b.dueDate&&raw.dueDate!==b.dueDate||!states.includes(raw.status)||typeof raw.deleted!=='boolean'||!['BOLETO','PIX','CREDIT_CARD','UNDEFINED'].includes(raw.billingType))throw new Error();
 return {id:raw.id,customer:raw.customer,reference:raw.externalReference,grossCents:cents(raw.value),status:raw.status,deleted:raw.deleted,billingType:raw.billingType,splitPresent:Array.isArray(raw.split)?raw.split.length>0:raw.split!==undefined&&raw.split!==null};
}
export function checkedRefund(raw:any,payment:string){
 if(!raw||!['DONE','PENDING','CANCELLED'].includes(raw.status)||raw.payment!==undefined&&raw.payment!==payment)throw new Error();
 return {id:identifier(raw.id),status:raw.status,valueCents:cents(raw.value),date:date(raw.dateCreated?.slice(0,10))};
}
export function checkedSubscription(raw:any,source:CheckSource){
 const p=source.parameters;if(!p||!raw||raw.id!==source.remoteId||raw.customer!==p.customer||raw.externalReference!==p.externalReference||cents(raw.value)!==cents(p.value)||raw.cycle!==p.cycle||raw.billingType!==p.billingType||raw.endDate!==p.endDate||!['ACTIVE','INACTIVE','EXPIRED'].includes(raw.status)||typeof raw.deleted!=='boolean')throw new Error();
 return {id:raw.id,customer:raw.customer,reference:raw.externalReference,grossCents:cents(raw.value),status:raw.status,deleted:raw.deleted,nextDueDate:date(raw.nextDueDate),endDate:date(raw.endDate)};
}
export function checkedAffectedPayment(raw:any,s:{id:string;customer:string}){
 if(!raw||raw.subscription!==s.id||raw.customer!==s.customer||!states.includes(raw.status)||typeof raw.deleted!=='boolean')throw new Error();
 return {id:identifier(raw.id,'pay_'),customer:raw.customer,subscription:raw.subscription,status:raw.status,deleted:raw.deleted,grossCents:cents(raw.value),dueDate:date(raw.dueDate),affectedByRemoval:!raw.deleted&&['PENDING','OVERDUE'].includes(raw.status)};
}
@Injectable()
export class SalesAdjustmentCheckAdapter {
 constructor(private readonly config:ConfigService){}
 private async get(path:string){
  const key=this.config.get<string>('SALES_ASAAS_SANDBOX_API_KEY');
  if(this.config.get('SALES_ADJUSTMENT_CHECKS_ENABLED')!=='true'||this.config.get('SALES_ADJUSTMENT_CHECK_CALLS_ENABLED')!=='true'||this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true'||this.config.get('SALES_ASAAS_BASE_URL')!==SANDBOX_URL||!key||key.length<20)throw new ServiceUnavailableException('Pré-validação externa desligada.');
  const r=await fetch(SANDBOX_URL+path,{method:'GET',headers:{access_token:key,'User-Agent':'EnergyOS-Sandbox-4J'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok||!r.body)throw new Error();const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>131072)throw new Error();parts.push(x.value);}}finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
 }
 // Only documented list envelopes or a complete bounded refunds array are accepted.
 // Unsupported schemas, duplicates and truncated enumeration never prove completeness.
 private async enumerate(path:string,convert:(x:any)=>any,allowArray=false){
  const rows:any[]=[];let total:number|undefined;
  for(let offset=0;offset<100;offset+=25){
   const raw=await this.get(path+(path.includes('?')?'&':'?')+new URLSearchParams({offset:String(offset),limit:'25'}));
   if(Array.isArray(raw)){if(!allowArray||offset!==0||raw.length>100)throw new Error();for(const r of raw){const v=convert(r);if(rows.some(x=>x.id===v.id))throw new Error();rows.push(v);}return rows;}
   if(!raw||!Array.isArray(raw.data)||raw.data.length>25||typeof raw.hasMore!=='boolean'||!Number.isSafeInteger(raw.totalCount)||raw.totalCount<0||raw.hasMore&&raw.data.length!==25||total!==undefined&&total!==raw.totalCount)throw new Error();
   total=raw.totalCount;for(const r of raw.data){const v=convert(r);if(rows.some(x=>x.id===v.id))throw new Error();rows.push(v);}
   if(!raw.hasMore){if(rows.length!==total)throw new Error();return rows;}
  }
  throw new Error();
 }
 async check(source:CheckSource,params:any):Promise<CheckEvidence>{
  if(source.kind==='REFUND_PAYMENT'){
   identifier(source.remoteId,'pay_');const payment=checkedPayment(await this.get('/payments/'+source.remoteId),source);
   let refunds:any[];try{refunds=await this.enumerate('/payments/'+source.remoteId+'/refunds',x=>checkedRefund(x,source.remoteId),true);}catch{return {complete:false,blockers:['REFUNDS_INCOMPLETE'],payment};}
   const blockers:string[]=[];const refundedCents=refunds.filter(x=>x.status==='DONE').reduce((n,x)=>n+x.valueCents,0);
   if(JSON.stringify(checkedPayment(await this.get('/payments/'+source.remoteId),source))!==JSON.stringify(payment))blockers.push('REMOTE_SOURCE_CHANGED');
   if(payment.deleted||payment.status!=='RECEIVED')blockers.push('PAYMENT_NOT_RECEIVED');
   if(!['PIX','CREDIT_CARD'].includes(payment.billingType))blockers.push('METHOD_UNSUPPORTED');
   if(payment.splitPresent)blockers.push('SPLIT_REVIEW_REQUIRED');
   if(refunds.some(x=>x.status==='PENDING'))blockers.push('REFUND_PENDING');
   if(refundedCents>payment.grossCents||params.amountCents+refundedCents>payment.grossCents)blockers.push('REFUND_EXCEEDS_EVIDENCE');
   return {complete:true,blockers,payment,refunds,refundedCents,remainingCents:Math.max(0,payment.grossCents-refundedCents)};
  }
  if(source.kind!=='CANCEL_SUBSCRIPTION')throw new Error();identifier(source.remoteId,'sub_');
  const subscription=checkedSubscription(await this.get('/subscriptions/'+source.remoteId),source);
  let payments:any[];try{payments=await this.enumerate('/subscriptions/'+source.remoteId+'/payments',x=>checkedAffectedPayment(x,subscription));}catch{return {complete:false,blockers:['PAYMENTS_INCOMPLETE'],subscription};}
  const blockers:string[]=[];if(subscription.deleted||subscription.status!=='ACTIVE')blockers.push('SUBSCRIPTION_NOT_ACTIVE');
  // API state is read twice; concurrent changes invalidate the snapshot.
  if(JSON.stringify(checkedSubscription(await this.get('/subscriptions/'+source.remoteId),source))!==JSON.stringify(subscription))blockers.push('REMOTE_SOURCE_CHANGED');
  return {complete:true,blockers,subscription,payments};
 }
}
