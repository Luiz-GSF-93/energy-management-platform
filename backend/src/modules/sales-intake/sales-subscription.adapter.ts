import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SANDBOX_URL} from './sales-asaas.adapter';

export type SubscriptionParameters={customer:string;billingType:'BOLETO';cycle:'MONTHLY'|'YEARLY';value:number;nextDueDate:string;endDate:string;externalReference:string;description:string};
export type SubscriptionSummary={id:string;customer:string;reference:string;grossCents:number;cycle:string;billingType:string;nextDueDate:string;endDate:string;status:string;deleted:boolean};
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const date=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const fail=()=>new ServiceUnavailableException('Recorrência sandbox não confirmada; concilie sem repetir envio.');

@Injectable()
export class SalesSubscriptionAdapter {
 constructor(private readonly config:ConfigService){}
 private key(){
  const key=this.config.get<string>('SALES_ASAAS_SANDBOX_API_KEY');
  if(this.config.get('SALES_RECURRENCE_PREPARATION_ENABLED')!=='true'||this.config.get('SALES_SUBSCRIPTION_CALLS_ENABLED')!=='true'||this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true'||this.config.get('SALES_ASAAS_BASE_URL')!==SANDBOX_URL||!key||key.length<20)throw new ServiceUnavailableException('Chamadas de recorrência sandbox desligadas.');
  return key;
 }
 private valid(p:SubscriptionParameters){
  const keys=['customer','billingType','cycle','value','nextDueDate','endDate','externalReference','description'];
  if(!p||Object.keys(p).length!==keys.length||keys.some(k=>!Object.prototype.hasOwnProperty.call(p,k))||!/^cus_[a-zA-Z0-9]{1,100}$/.test(p.customer)||p.billingType!=='BOLETO'||!['MONTHLY','YEARLY'].includes(p.cycle)||!Number.isFinite(p.value)||p.value<=0||p.value>10000000||Math.abs(p.value*100-Math.round(p.value*100))>0.000001||!date(p.nextDueDate)||!date(p.endDate)||p.nextDueDate>p.endDate||!uuid.test(p.externalReference)||p.description!=='EnergyOS: previa privada de recorrencia sandbox; sem envio ou ativacao.')throw fail();
 }
 private async request(path:string,method:'GET'|'POST',body?:SubscriptionParameters):Promise<any>{
  const key=this.key();
  try{
   const r=await fetch(SANDBOX_URL+path,{method,headers:{access_token:key,'User-Agent':'EnergyOS-Sandbox-4F','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!r.ok||!r.body)throw fail();
   const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>65536)throw fail();chunks.push(x.value);}}finally{await reader.cancel();}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{throw fail();}
 }
 private compatible(raw:any,p:SubscriptionParameters):SubscriptionSummary {
  if(!raw||typeof raw!=='object'||!/^sub_[a-zA-Z0-9]{1,100}$/.test(raw.id)||raw.customer!==p.customer||raw.externalReference!==p.externalReference||raw.billingType!==p.billingType||raw.cycle!==p.cycle||typeof raw.value!=='number'||!Number.isFinite(raw.value)||Math.abs(raw.value*100-Math.round(raw.value*100))>0.000001||Math.round(raw.value*100)!==Math.round(p.value*100)||!date(raw.nextDueDate)||raw.nextDueDate<p.nextDueDate||raw.endDate!==p.endDate||!['ACTIVE','INACTIVE','EXPIRED'].includes(raw.status)||typeof raw.deleted!=='boolean')throw fail();
  // nextDueDate may advance when Asaas generates a bill. First due date is
  // verified separately by the command orchestrator against payment evidence.
  return {id:raw.id,customer:raw.customer,reference:raw.externalReference,grossCents:Math.round(raw.value*100),cycle:raw.cycle,billingType:raw.billingType,nextDueDate:raw.nextDueDate,endDate:raw.endDate,status:raw.status,deleted:raw.deleted};
 }
 private async list(p:SubscriptionParameters){
  return this.request('/subscriptions?externalReference='+encodeURIComponent(p.externalReference)+'&customer='+encodeURIComponent(p.customer)+'&includeDeleted=true&limit=2','GET');
 }
 async absenceProof(p:SubscriptionParameters){
  this.valid(p);
  const customer=await this.request('/customers/'+p.customer,'GET');
  if(customer.id!==p.customer||customer.deleted!==false||customer.notificationDisabled!==true)throw fail();
  const page=await this.list(p);
  if(!page||!Array.isArray(page.data)||page.data.length!==0||page.totalCount!==0||page.hasMore!==false)throw fail();
  return {customer:p.customer,reference:p.externalReference,notificationDisabled:true,totalCount:0,hasMore:false};
 }
 async dispatchReserved(p:SubscriptionParameters){
  this.valid(p);
  // Internal service only. Durable POST_RESERVED precedes this one POST.
  return this.compatible(await this.request('/subscriptions','POST',p),p);
 }
 async reconcile(p:SubscriptionParameters){
  this.valid(p);const page=await this.list(p);
  if(!page||!Array.isArray(page.data)||page.data.length!==1||page.totalCount!==1||page.hasMore!==false)throw fail();
  return this.compatible(page.data[0],p);
 }
}
