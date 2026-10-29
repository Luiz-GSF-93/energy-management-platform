import {BadRequestException,ForbiddenException} from '@nestjs/common';
import {TenantContext} from '../interfaces/tenant-context.interface';

export function selectedPortalUnits(value:unknown,allowed:string[],single?:string):string[]|null {
 if(value===undefined)return single?selectedPortalUnits(single,allowed):null;
 if(single||typeof value!=='string'||value.length>21000)throw new BadRequestException('Selecione unidades válidas.');
 const ids=value.split(',');
 if(!ids.length||ids.length>200||new Set(ids).size!==ids.length||ids.some(id=>!/^[A-Za-z0-9_-]{1,100}$/.test(id)))throw new BadRequestException('Selecione unidades sem repetições.');
 if(ids.some(id=>!allowed.includes(id)))throw new ForbiddenException('Unidade fora do acesso autorizado.');
 return [...ids].sort();
}
/** Reuses live organization/customer/unit authorization; never grants access. */
export async function resolvePortalUnits(db:any,t:TenantContext,value:unknown):Promise<string[]|null>{
 if(value===undefined)return null;
 const r=await db.rpc('portal_presentation_action',{p_org:t.organizationId,p_actor:t.userId,p_role:t.roleId,p_action:'identity',p_id:null,p_body:{}});
 if(r.error||r.data?.organizationId!==t.organizationId||!r.data.customerId||!Array.isArray(r.data.units)||t.portalCustomerScope&&r.data.customerId!==t.portalCustomerScope.customerId)throw new ForbiddenException('Confira o vínculo atual do Portal.');
 const allowed=r.data.units.map((u:any)=>u.id).filter((id:string)=>!t.portalCustomerScope||t.portalCustomerScope.units.some(u=>u.id===id));
 return selectedPortalUnits(value,allowed);
}
