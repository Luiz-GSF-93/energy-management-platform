export type PortalModule='reports'|'forecasts'|'energy_prices'|'acl'|'documents'|'bot'|'agenda'|'notifications'|'map'|'trading';
const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function portalRouteModule(path:string,method:string):PortalModule|null {
 const route=path.replace(/^\/api\/v1(?=\/)/,'').replace(/\/$/,'');
 if(method==='GET'&&route==='/portal/financial')return 'reports';
 if(method==='GET'&&route==='/portal/energy-forecasts')return 'forecasts';
 if(method==='GET'&&route==='/portal/energy-prices')return 'energy_prices';
 if(method==='GET'&&route==='/portal/acl-admissions')return 'acl';
 if((method==='GET'&&route==='/bot-energy/reports/client/units')||(method==='POST'&&route==='/bot-energy/reports/client'))return 'bot';
 if(method==='GET'&&(route==='/portal/evidence'||new RegExp('^/portal/evidence/'+uuid+'(?:/files/'+uuid+')?$').test(route)))return 'documents';
 if(method==='POST'&&new RegExp('^/portal/evidence/'+uuid+'(?:/upload|/opened/'+uuid+')?$').test(route))return 'documents';
 return null;
}
