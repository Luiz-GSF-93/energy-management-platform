import type {MapUnit} from './map-data';
import type {PlatformMapRow} from './platform-map-data';

export type ProfileFilters={market:string;gd:string;bess:string};
const technology=(value:boolean|null|undefined)=>value===true?'YES':value===false?'NO':'UNKNOWN';
export function portfolioProfiles(rows:(MapUnit|PlatformMapRow)[],organizationId?:string){
 const seen=new Set<string>();
 const groups=new Map<string,{key:string;filters:ProfileFilters;units:number;customers:Set<string>}>();
 for(const row of rows){
  if(organizationId!==undefined&&row.organizationId!==organizationId)continue;
  if('hasUnit' in row&&!row.hasUnit)continue;
  const unitKey=JSON.stringify([row.organizationId,row.id]);
  if(seen.has(unitKey))continue;seen.add(unitKey);
  const filters={market:row.market,gd:technology(row.hasGd),bess:technology(row.hasBess)};
  const key=JSON.stringify([filters.market,filters.gd,filters.bess]);
  let group=groups.get(key);
  if(!group){group={key,filters,units:0,customers:new Set<string>()};groups.set(key,group);}
  group.units++;group.customers.add(JSON.stringify([row.organizationId,row.customerId]));
 }
 return Array.from(groups.values()).map(g=>({...g,customers:g.customers.size})).sort((a,b)=>b.units-a.units||a.key.localeCompare(b.key));
}
export function profileLabel(filters:ProfileFilters){
 const market=filters.market==='UNKNOWN'?'Mercado não informado':filters.market;
 const gd=filters.gd==='YES'?'GD':filters.gd==='NO'?'Sem GD':'GD não informada';
 const bess=filters.bess==='YES'?'BESS':filters.bess==='NO'?'Sem BESS':'BESS não informado';
 return [market,gd,bess].join(' + ');
}
