import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {paymentSummary,SANDBOX_URL} from './sales-asaas.adapter';
export type CreationParameters={customer:string;billingType:'BOLETO';value:number;dueDate:string;externalReference:string;description:string};
@Injectable()
export class SalesCreationAdapter {
 constructor(private readonly config:ConfigService){}
 private key(){
  const key=this.config.get<string>('SALES_ASAAS_SANDBOX_API_KEY');
  if(this.config.get('SALES_ASAAS_CREATION_ENABLED')!=='true'||this.config.get('SALES_ASAAS_CREATION_CALLS_ENABLED')!=='true'||this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true'||this.config.get('SALES_ASAAS_BASE_URL')!==SANDBOX_URL||!key||key.length<20)throw new ServiceUnavailableException('Criacao externa sandbox desligada.');
  return key;
 }
 assertEnabled(){this.key();}
 private valid(p:CreationParameters){
  if(!p||!/^cus_[a-zA-Z0-9]{1,100}$/.test(p.customer)||p.billingType!=='BOLETO'||!Number.isFinite(p.value)||p.value<=0||p.value>10000000||Math.abs(p.value*100-Math.round(p.value*100))>0.000001||!/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate)||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.externalReference)||p.description!=='EnergyOS: homologacao sandbox de primeiro ciclo; sem ativacao de licenca.')throw new ServiceUnavailableException('Parametros preservados invalidos.');
 }
 private async request(path:string,method:'GET'|'POST',body?:CreationParameters):Promise<any>{
  const key=this.key();
  try{
   const r=await fetch(SANDBOX_URL+path,{method,headers:{access_token:key,'User-Agent':'EnergyOS-Sandbox-4D','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!r.ok||!r.body)throw new Error();
   const reader=r.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>65536)throw new Error();chunks.push(x.value);}}finally{await reader.cancel();}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{throw new ServiceUnavailableException('Resposta sandbox indisponivel; reconciliar sem repetir criacao.');}
 }
 private compatible(raw:unknown,p:CreationParameters){
  const s=paymentSummary(raw);
  if(s.customer!==p.customer||s.reference!==p.externalReference||s.grossCents!==Math.round(p.value*100))throw new ServiceUnavailableException('Resultado divergente; requer reconciliacao.');
  return s;
 }
 async preflight(p:CreationParameters){
  this.valid(p);const customer=await this.request('/customers/'+p.customer,'GET');
  if(customer.id!==p.customer||customer.deleted!==false||customer.notificationDisabled!==true)throw new ServiceUnavailableException('Pagador sandbox nao confirmado.');
 }
 async dispatch(p:CreationParameters){
  this.valid(p);
  // Caller must persist POST_RESERVED before this single POST. Never retry.
  return this.compatible(await this.request('/payments','POST',p),p);
 }
 async create(p:CreationParameters){await this.preflight(p);return this.dispatch(p);}
 async recoveryProof(p:CreationParameters){
  await this.preflight(p);
  const page=await this.request('/payments?externalReference='+encodeURIComponent(p.externalReference)+'&customer='+encodeURIComponent(p.customer)+'&limit=2','GET');
  if(!page||!Array.isArray(page.data)||page.data.length!==0||page.totalCount!==0||page.hasMore!==false)throw new ServiceUnavailableException('Ausencia de cobranca nao confirmada; reconciliar sem criar.');
  return {customer:p.customer,reference:p.externalReference,notificationDisabled:true,totalCount:0,hasMore:false};
 }
 async reconcile(p:CreationParameters){
  this.valid(p);const page=await this.request('/payments?externalReference='+encodeURIComponent(p.externalReference)+'&customer='+encodeURIComponent(p.customer)+'&limit=2','GET');
  if(!page||!Array.isArray(page.data)||page.data.length!==1||page.totalCount!==1||page.hasMore!==false)throw new ServiceUnavailableException('Nenhuma correspondencia unica; criacao continua bloqueada.');
  return this.compatible(page.data[0],p);
 }
}
