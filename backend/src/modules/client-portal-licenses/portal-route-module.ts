export type PortalModule='reports'|'forecasts'|'energy_prices'|'acl'|'documents'|'bot'|'agenda'|'notifications'|'map'|'trading';
const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function portalRouteModule(path:string,method:string):PortalModule|null {
 const route=path.replace(/^\/api\/v1(?=\/)/,'').replace(/\/$/,'');
 if(method==='GET'&&route==='/portal/workspace/presentation/usage')return 'reports';
 if(method==='GET'&&['/portal/workspace/presentation/requests','/portal/workspace/presentation/notices'].includes(route))return 'notifications';
 if(method==='GET'&&new RegExp('^/portal/workspace/invoices/'+uuid+'/details$').test(route))return 'documents';
 if(method==='POST'&&new RegExp('^/portal/workspace/invoices/'+uuid+'/payment-declaration$').test(route))return 'documents';
 if(method==='GET'&&['/portal/workspace/context','/portal/workspace/invoices'].includes(route))return 'documents';
 if(method==='GET'&&new RegExp('^/portal/workspace/invoices/'+uuid+'/(?:file|readout|content)$').test(route))return 'documents';
 if(method==='POST'&&route==='/portal/workspace/invoices/library')return 'documents';
 if(method==='POST'&&route==='/portal/workspace/uploads')return 'documents';
 if(['GET','POST'].includes(method)&&route==='/portal/workspace/preferences')return 'notifications';
 if(method==='GET'&&['/portal/workspace/service-context','/portal/workspace/requests','/portal/workspace/notifications'].includes(route)||method==='POST'&&(route==='/portal/workspace/requests'||new RegExp('^/portal/workspace/notifications/'+uuid+'/read$').test(route)))return 'notifications';
 if(method==='GET'&&route==='/portal/financial')return 'reports';
 if(method==='POST'&&route==='/portal/financial-details/corrections')return 'reports';
 if(method==='GET'&&route==='/portal/financial-details')return 'reports';
 if(method==='GET'&&route==='/portal/energy-forecasts')return 'forecasts';
 if(method==='GET'&&route==='/portal/energy-prices')return 'energy_prices';
 if(method==='GET'&&route==='/portal/acl-admissions')return 'acl';
 if((method==='GET'&&route==='/bot-energy/reports/client/units')||(method==='POST'&&route==='/bot-energy/reports/client'))return 'bot';
 if(method==='GET'&&(route==='/portal/evidence'||new RegExp('^/portal/evidence/'+uuid+'(?:/files/'+uuid+')?$').test(route)))return 'documents';
 if(method==='POST'&&new RegExp('^/portal/evidence/'+uuid+'(?:/upload|/opened/'+uuid+')?$').test(route))return 'documents';
 return null;
}
