export type TerritoryCounts={coverage:'FULL_FILTER';method:'PORTFOLIO_COUNTS_V1';states:CountGroup[];distributors:CountGroup[];distributorGroups:number;profiles:CountGroup[]};
type CountGroup={label:string;units:number;customers:number;confirmed:number};
export function validTerritory(data:TerritoryCounts,totalUnits:number){
 const valid=(rows:CountGroup[])=>Array.isArray(rows)&&rows.every(r=>typeof r.label==='string'&&r.label.length>0&&['units','customers','confirmed'].every(k=>Number.isSafeInteger(r[k as keyof CountGroup])&&Number(r[k as keyof CountGroup])>=0)&&r.confirmed<=r.units);
 return data?.coverage==='FULL_FILTER'&&data.method==='PORTFOLIO_COUNTS_V1'&&valid(data.states)&&valid(data.distributors)&&valid(data.profiles)&&data.distributors.length<=20&&Number.isSafeInteger(data.distributorGroups)&&data.distributorGroups>=data.distributors.length&&data.states.reduce((n,v)=>n+v.units,0)===totalUnits&&data.profiles.reduce((n,v)=>n+v.units,0)===totalUnits&&data.distributors.reduce((n,v)=>n+v.units,0)<=totalUnits;
}
export type RadiusValues={radiusLatitude:string;radiusLongitude:string;radiusKm:string};
export function validRadius(v:RadiusValues){return /^-?\d{1,3}(\.\d{1,7})?$/.test(v.radiusLatitude)&&/^-?\d{1,3}(\.\d{1,7})?$/.test(v.radiusLongitude)&&/^\d{1,3}(\.\d{1,3})?$/.test(v.radiusKm)&&Math.abs(Number(v.radiusLatitude))<=90&&Math.abs(Number(v.radiusLongitude))<=180&&Number(v.radiusKm)>=1&&Number(v.radiusKm)<=500;}
