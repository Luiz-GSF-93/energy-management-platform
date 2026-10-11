import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SANDBOX_URL} from './sales-asaas.adapter';
import {AdjustmentQueryError,CheckSource,checkedPayment,checkedRefund,checkedSubscription,checkedAffectedPayment} from './sales-adjustment-check.adapter';
export type CommandContext={source:CheckSource;parameters:any;baseline:any};
@Injectable()
export class SalesAdjustmentCommandAdapter {
 constructor(private readonly config:ConfigService){}
 private async request(path:string,method:'GET'|'POST'|'DELETE',body?:unknown){
  const key=this.config.get<string>('SALES_ASAAS_SANDBOX_API_KEY');
  if(this.config.get('SALES_ADJUSTMENT_COMMANDS_ENABLED')!=='true'||this.config.get('SALES_ADJUSTMENT_COMMAND_CALLS_ENABLED')!=='true'||this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true'||this.config.get('SALES_ASAAS_BASE_URL')!==SANDBOX_URL||!key||key.length<20)throw new AdjustmentQueryError('QUERY_CONFIG_INVALID');
  if(!/^\/(?:subscriptions\/sub_[a-zA-Z0-9_-]{1,120}|payments\/pay_[a-zA-Z0-9_-]{1,120}(?:\/refunds(?:\?offset=\d+&limit=25)?|\/refund)?)$/.test(path))throw new AdjustmentQueryError('QUERY_BINDING_MISMATCH');
  let r:Response;try{r=await fetch(SANDBOX_URL+path,{method,headers:{access_token:key,'User-Agent':'EnergyOS-Sandbox-4K','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});}catch(error){throw new AdjustmentQueryError(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'QUERY_TIMEOUT':'QUERY_NETWORK_ERROR');}
  if(!r.ok)throw new AdjustmentQueryError('QUERY_HTTP_ERROR');if(!r.body)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
  const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>131072)throw new AdjustmentQueryError('QUERY_RESPONSE_LIMIT');parts.push(chunk.value);}}finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');}
 }
 async send(source:CheckSource,parameters:any,baseline:any){
  // Called only after a persistent DISPATCH event. No retry is ever performed here.
  if(source.kind==='CANCEL_SUBSCRIPTION'){
   const raw=await this.request('/subscriptions/'+source.remoteId,'DELETE');
   if(!raw||raw.deleted!==true||raw.id!==undefined&&raw.id!==source.remoteId)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
  }else if(source.kind==='REFUND_PAYMENT'){
   if(!Number.isSafeInteger(parameters.amountCents)||parameters.amountCents<1)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
   const raw=await this.request('/payments/'+source.remoteId+'/refund','POST',{value:parameters.amountCents/100,description:'EnergyOS sandbox: devolução conferida pelo Owner'});
   checkedPayment(raw,source);
   const added=Array.isArray(raw.refunds)?raw.refunds.map((x:any)=>checkedRefund(x,source.remoteId)).filter((x:any)=>!baseline.refunds.some((old:any)=>old.id===x.id)):[];
   if(added.length!==1||added[0].valueCents!==parameters.amountCents)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
   return {accepted:true,refundId:added[0].id};
  }else throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
  return {accepted:true};
 }
 async recover(ctx:CommandContext){
  const {source,baseline,parameters}=ctx;
  if(source.kind==='CANCEL_SUBSCRIPTION'){
   const subscription=checkedSubscription(await this.request('/subscriptions/'+source.remoteId,'GET'),source);
   // A 404 or status alone cannot prove this deletion. An exact bound deleted record is required.
   const payments:any[]=[];
   for(const old of baseline.payments.filter((x:any)=>x.affectedByRemoval)){payments.push(checkedAffectedPayment(await this.request('/payments/'+old.id,'GET'),subscription));}
   return {kind:source.kind,remoteId:source.remoteId,verified:subscription.deleted===true&&payments.every(x=>x.deleted),subscription,payments};
  }
  if(source.kind!=='REFUND_PAYMENT'||!Array.isArray(baseline?.refunds))throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
  const payment=checkedPayment(await this.request('/payments/'+source.remoteId,'GET'),source);
  const refunds:any[]=[];let total:number|undefined;let complete=false;
  for(let offset=0;offset<100;offset+=25){
   const raw=await this.request('/payments/'+source.remoteId+'/refunds?offset='+offset+'&limit=25','GET');
   if(Array.isArray(raw)){
    if(offset!==0||raw.length>100)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
    refunds.push(...raw.map(x=>checkedRefund(x,source.remoteId)));complete=true;break;
   }
   if(!raw||!Array.isArray(raw.data)||raw.data.length>25||typeof raw.hasMore!=='boolean'||!Number.isSafeInteger(raw.totalCount)||raw.totalCount<0||total!==undefined&&total!==raw.totalCount||raw.hasMore&&raw.data.length!==25)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
   total=raw.totalCount;refunds.push(...raw.data.map((x:any)=>checkedRefund(x,source.remoteId)));
   if(!raw.hasMore){complete=refunds.length===total;break;}
  }
  if(!complete||new Set(refunds.map(x=>x.id)).size!==refunds.length)throw new AdjustmentQueryError('QUERY_SCHEMA_INVALID');
  if(JSON.stringify(checkedPayment(await this.request('/payments/'+source.remoteId,'GET'),source))!==JSON.stringify(payment))throw new AdjustmentQueryError('QUERY_BINDING_MISMATCH');
  for(const old of baseline.refunds)if(!refunds.some(x=>JSON.stringify(x)===JSON.stringify(old)))throw new AdjustmentQueryError('QUERY_BINDING_MISMATCH');
  const added=refunds.filter(x=>!baseline.refunds.some((old:any)=>old.id===x.id));
  if(added.length!==1||added[0].valueCents!==parameters.amountCents||!['DONE','PENDING'].includes(added[0].status))throw new AdjustmentQueryError('QUERY_BINDING_MISMATCH');
  return {kind:source.kind,remoteId:source.remoteId,verified:added[0].status==='DONE'&&added[0].id===(ctx as any).receipt?.refundId,refund:added[0]};
 }
}
