import {MapUnit,located,mapGeoJson} from './map-data';
export type PlatformMapRow=Omit<MapUnit,'locationStatus'> & {hasUnit:boolean;organizationName:string;locationStatus:MapUnit['locationStatus']|'NO_UNIT'};
export type PlatformMapResponse={scope:'global';rows:PlatformMapRow[];total:number;customers:number;organizations:number;units:number;withoutUnits:number;confirmed:number;pending:number;offset:number;limit:number;organizationOptions:{id:string;name:string}[]};
export function platformLocated(row:PlatformMapRow){return row.hasUnit&&row.locationStatus!=='NO_UNIT'&&located(row as MapUnit);}
export function platformMapGeoJson(rows:PlatformMapRow[]){
 return {type:'FeatureCollection' as const,features:rows.filter(platformLocated).flatMap(row=>mapGeoJson([row as MapUnit],row.organizationId).features)};
}
export function validPlatformMap(value:PlatformMapResponse){
 return value?.scope==='global'&&Array.isArray(value.rows)&&value.rows.length<=200&&Number.isSafeInteger(value.total)&&value.total>=value.rows.length&&Array.isArray(value.organizationOptions)&&value.rows.every(r=>typeof r.id==='string'&&typeof r.organizationId==='string'&&!!r.organizationId&&typeof r.hasUnit==='boolean'&&['PENDING','CONFIRMED','STALE','NO_UNIT'].includes(r.locationStatus));
}
