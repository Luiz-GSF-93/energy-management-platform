import {MapUnit,located} from './map-data';
import type {PlatformMapRow} from './platform-map-data';
type Row=MapUnit|PlatformMapRow;
const states=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
export function territorySummary(rows:Row[],organizationId?:string){
 const groups=new Map<string,{state:string;customers:Set<string>;units:number;confirmed:number}>();
 const seen=new Set<string>();let omitted=0;
 for(const row of rows){
  if(organizationId!==undefined&&row.organizationId!==organizationId)continue;
  if('hasUnit' in row&&!row.hasUnit)continue;
  const key=JSON.stringify([row.organizationId,row.id]);if(seen.has(key))continue;seen.add(key);
  const state=row.state?.trim().toUpperCase();if(!state||!states.has(state)){omitted++;continue;}
  let group=groups.get(state);if(!group){group={state,customers:new Set(),units:0,confirmed:0};groups.set(state,group);}
  group.customers.add(JSON.stringify([row.organizationId,row.customerId]));group.units++;
  if(located(row as MapUnit))group.confirmed++;
 }
 return {regions:Array.from(groups.values()).map(g=>({state:g.state,customers:g.customers.size,units:g.units,confirmed:g.confirmed})).sort((a,b)=>b.units-a.units||a.state.localeCompare(b.state)),omitted};
}
