import {ApiError,apiRequest} from './client';
export const portalModules=[['reports','Relatórios publicados'],['forecasts','Previsão de consumo'],['energy_prices','Preços de energia'],['acl','Adesão ACL'],['documents','Documentos'],['bot','Bot-Energy']] as const;
export type PortalModule=typeof portalModules[number][0];
export type PortalLicense={id:string;customer_id:string;customers?:{company_name:string};status:'ACTIVE'|'SUSPENDED'|'CANCELLED';starts:string;ends:string;modules:PortalModule[];max_users:number;max_units:number;revision:number};
export type ClientAddition={id:string;slots:number;starts:string;ends:string;status:'ACTIVE'|'CANCELLED';reference:string;revision:number};
export type PortalLicenses={available:boolean;enabled:boolean;revision:number;capacity?:{configured:boolean;base:number|null;additional:number;contracted:number|null;used:number;available:number|null};licenses:PortalLicense[];additions:ClientAddition[];history:{id:string;actor_id:string;actor_name:string|null;actor_affiliation:string;actor_role:string;kind:string;reason:string;created_at:string}[]};
export type PortalEntitlement={enabled:boolean;modules?:PortalModule[];starts?:string;ends?:string};
// Compatibility applies only to a backend that has not received the additive route.
// Authorization, validation and availability errors never become a positive license.
export async function loadPortalLicense<T>(path:string,legacy:T):Promise<T>{
 try{return await apiRequest<T>(path);}catch(e){if(e instanceof ApiError&&e.status===404)return legacy;throw e;}
}
