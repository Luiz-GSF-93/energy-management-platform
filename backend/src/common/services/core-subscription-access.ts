import {ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
export type CoreSubscription={managed:boolean;organizationId?:string;state?:string;blocked?:boolean;notice?:string|null;overdueDays?:number;paidThrough?:string|null;oldestUnpaidDueOn?:string|null};
const cache=new Map<string,{until:number;value:CoreSubscription}>(),flights=new Map<string,Promise<CoreSubscription>>();
export function invalidateCoreSubscription(org:string){cache.delete(org);}
export async function coreSubscription(client:any,org:string,user:string):Promise<CoreSubscription|undefined>{
 if(process.env.SALES_CORE_LICENSES_ENABLED!=='true')return undefined;
 const prior=cache.get(org);if(prior&&prior.until>Date.now())return prior.value;
 if(flights.has(org))return flights.get(org)!;
 const flight=(async()=>{
  const r=await client.rpc('platform_core_subscription_access',{p_org:org,p_user:user});if(r.error||!r.data||typeof r.data.managed!=='boolean'||r.data.managed&&(r.data.organizationId!==org||!['active','grace','suspended','cancelled'].includes(r.data.state)||typeof r.data.blocked!=='boolean'))throw new ServiceUnavailableException('Não foi possível conferir a assinatura. Tente atualizar; sua sessão foi preservada.');
  if(cache.size>10000){for(const[k,v]of cache)if(v.until<=Date.now())cache.delete(k);if(cache.size>10000)cache.clear();}
  cache.set(org,{until:Date.now()+(r.data.managed?15000:300000),value:r.data});return r.data as CoreSubscription;
 })();flights.set(org,flight);try{return await flight;}finally{flights.delete(org);}
}
export async function assertCoreSubscription(client:any,org:string,user:string,path:string){
 const value=await coreSubscription(client,org,user);
 if(value?.managed&&value.blocked&&!['/auth/context','/auth/profile','/auth/switch-organization'].includes(path.replace(/^\/api\/v1/,'')))throw new ForbiddenException({code:'SUBSCRIPTION_SUSPENDED',message:value.notice||'Assinatura em atraso. O acesso retorna após a conciliação da regularização.'});
 return value;
}
