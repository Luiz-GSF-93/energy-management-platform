import {portalRouteModule} from '../../modules/client-portal-licenses/portal-route-module';
// An explicit external client binding narrows legacy organization-wide permissions.
// NULL bindings remain shared/backoffice; a customer must never be inferred.
export function restrictClientPortalRequest(member:any,role:any,path:string,method:string){
 if(role?.name!=='consulta'||member?.affiliation_type!=='external'||typeof member.exclusive_customer_id!=='string'||!member.exclusive_customer_id)return false;
 const normalized=path.replace(/^\/api\/v1(?=\/)/,'').replace(/\/$/,'');
 const existingRead=method==='GET'&&['/portal/access','/portal/financial','/portal/acl-admissions','/portal/license','/auth/context','/auth/profile'].includes(normalized);
 return !existingRead&&portalRouteModule(normalized,method)===null;
}
