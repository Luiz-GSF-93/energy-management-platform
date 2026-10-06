export type MapUnit = {
 id:string;organizationId:string;customerId:string;customerName:string;group:string|null;
 hasGd?:boolean|null;hasBess?:boolean|null;
 name:string|null;number:string;address:string|null;city:string|null;state:string|null;
 distributor:string;status:string;market:'ACL'|'ACR'|'UNKNOWN';addressHash:string;revision:number;
 locationStatus:'CONFIRMED'|'PENDING'|'STALE';latitude:number|null;longitude:number|null;
 precision:'ADDRESS'|'STREET'|'POSTCODE'|'CITY'|null;updatedAt:string|null;
};
export type MapResponse = {
 organizationId:string;canManage:boolean;enabled:boolean;rows:MapUnit[];total:number;customers:number;
 confirmed:number;pending:number;stale:number;offset:number;limit:number;
};
export const locationLabels={CONFIRMED:'Conferida',PENDING:'Sem localização',STALE:'Revisar endereço'};
export const precisionLabels={ADDRESS:'Endereço / imóvel',STREET:'Rua (aproximada)',POSTCODE:'CEP (aproximada)',CITY:'Cidade (aproximada)'};
export function located(u:MapUnit):boolean {
 return u.locationStatus==='CONFIRMED'&&typeof u.latitude==='number'&&Number.isFinite(u.latitude)&&Math.abs(u.latitude)<=90
 &&typeof u.longitude==='number'&&Number.isFinite(u.longitude)&&Math.abs(u.longitude)<=180&&(u.latitude!==0||u.longitude!==0);
}
export function mapGeoJson(rows:MapUnit[],organizationId:string) {
 return {type:'FeatureCollection' as const,features:rows.filter(u=>u.organizationId===organizationId&&located(u)).map(u=>({
  type:'Feature' as const,id:u.id,geometry:{type:'Point' as const,coordinates:[u.longitude!,u.latitude!]},
  // Keep private properties on the client. The provider receives only basemap requests.
  properties:{id:u.id,market:u.market,gd:u.hasGd===true,bess:u.hasBess===true,approximate:u.precision!=='ADDRESS'},
 }))};
}

export const gdLabel=(row:{hasGd?:boolean|null})=>row.hasGd===true?'GD — Geração Distribuída':row.hasGd===false?'Sem GD (conferido)':'GD não informada';

export const bessLabel=(row:{hasBess?:boolean|null})=>row.hasBess===true?'BESS — Armazenamento em baterias':row.hasBess===false?'Sem BESS (conferido)':'BESS não informado';
