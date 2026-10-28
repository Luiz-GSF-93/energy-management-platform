import {portalRouteModule} from '../../modules/client-portal-licenses/portal-route-module';
// An explicit external client binding narrows legacy organization-wide permissions.
// NULL bindings remain shared/backoffice; a customer must never be inferred.
export function restrictClientPortalRequest(member:any,role:any,path:string,method:string){
 if(role?.name!=='consulta'||member?.affiliation_type!=='external'||(!member.portal_scope_managed&&(typeof member.exclusive_customer_id!=='string'||!member.exclusive_customer_id)))return false;
 const normalized=path.replace(/^\/api\/v1(?=\/)/,'').replace(/\/$/,'');
 // The identity gateway checks the exclusive binding and any licensed reports,
 // documents or notifications module itself; it must also work without reports.
 const existingRead=method==='GET'&&['/portal/customers','/portal/access','/portal/financial','/portal/acl-admissions','/portal/license','/auth/context','/auth/profile','/organization-branding','/portal/workspace/presentation/identity'].includes(normalized);
 return !existingRead&&portalRouteModule(normalized,method)===null;
}
