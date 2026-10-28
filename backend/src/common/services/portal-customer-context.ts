import {AsyncLocalStorage} from 'node:async_hooks';
import {ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
export interface PortalCustomerContext {
 enabled:true;organizationId:string;userId:string;roleId:string;customerId:string;revision:string;
 allUnits:boolean;units:{id:string;name:string;number:string}[];customers:{id:string;name:string}[];
}
export const portalRequestScope=new AsyncLocalStorage<PortalCustomerContext>();
export const multiCustomerEnabled=(org:string)=>process.env.PORTAL_MULTI_CUSTOMER_ENABLED==='true'&&String(process.env.PORTAL_MULTI_CUSTOMER_ORGANIZATIONS??'').split(',').map(s=>s.trim()).includes(org);
export function validatePortalContext(value:any,org:string,actor:string,role:string):PortalCustomerContext|null {
 if(value?.enabled===false)return null;
 if(value?.enabled!==true||value.organizationId!==org||value.userId!==actor||value.roleId!==role||typeof value.customerId!=='string'||!value.customerId||typeof value.revision!=='string'||!/^[a-f0-9]{32}$/.test(value.revision)||!Array.isArray(value.units)||value.units.length<1||value.units.length>100||new Set(value.units.map((u:any)=>u.id)).size!==value.units.length||value.units.some((u:any)=>typeof u.id!=='string'||typeof u.name!=='string')||!Array.isArray(value.customers)||value.customers.length>100||!value.customers.some((c:any)=>c.id===value.customerId))throw new ServiceUnavailableException('O escopo do Portal não foi confirmado.');
 return value;
}
/** The RPC bridge receives only a server-validated context. It rechecks the
 * grant revision for each database transaction; no actor/customer comes from a DTO. */
export function scopedPortalClient(client:any,scope:PortalCustomerContext) {
 return new Proxy(client,{get(target,key,receiver){
  if(key!=='rpc')return Reflect.get(target,key,receiver);
  return(name:string,args:any,options?:any)=>{
   if(name==='portal_customer_scope')return target.rpc(name,args,options);
   return target.rpc('portal_scoped_rpc',{p_org:scope.organizationId,p_actor:scope.userId,p_role:scope.roleId,p_customer:scope.customerId,p_revision:scope.revision,p_name:name,p_args:args??{}},options);
  };
 }});
}
export async function assertCurrentPortalScope(client:any,scope:PortalCustomerContext) {
 const r=await client.rpc('portal_customer_scope',{p_org:scope.organizationId,p_actor:scope.userId,p_role:scope.roleId,p_customer:scope.customerId});
 if(r.error&&r.error.code!=='42501')throw new ServiceUnavailableException('Não foi possível reconferir o acesso ao Portal. Tente novamente.');
 if(r.error||r.data?.revision!==scope.revision)throw new ForbiddenException('O vínculo do Portal mudou. Selecione novamente a empresa e as unidades autorizadas.');
 return validatePortalContext(r.data,scope.organizationId,scope.userId,scope.roleId)!;
}
