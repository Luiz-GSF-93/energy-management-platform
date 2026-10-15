import {CLICKSIGN_SANDBOX_API} from './sales-signature-protocol';
export const signatureUuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export type AbsenceProof={state:'EMPTY'|'CANDIDATE'|'INCOMPLETE';pages:number;candidateIds:string[];reason:string|null};
// The documented empty collection omits next, but supplies zero count and equal first/last.
// This exception is restricted to an empty first response, never a truncated later page.
function emptyBoundary(value:unknown,name:string){
 if(typeof value!=='string'||value.length>2000)throw Error('PAGINATION');
 let u:URL;try{u=new URL(value);}catch{throw Error('PAGINATION');}
 if(u.origin!=='https://sandbox.clicksign.com'||u.pathname!=='/api/v3/envelopes'||u.username||u.password||u.hash)throw Error('PAGINATION');
 for(const key of u.searchParams.keys())if(!['filter[name]','page[number]','page[size]'].includes(key)||u.searchParams.getAll(key).length!==1)throw Error('PAGINATION');
 if(u.searchParams.has('filter[name]')&&u.searchParams.get('filter[name]')!==name)throw Error('PAGINATION');
 if(u.searchParams.has('page[number]')&&u.searchParams.get('page[number]')!=='1')throw Error('PAGINATION');
 if(u.searchParams.has('page[size]')&&!/^(100|[1-9][0-9]?)$/.test(u.searchParams.get('page[size]')!))throw Error('PAGINATION');
 u.searchParams.sort();return u.href;
}
export function absencePage(raw:unknown,name:string,seen:Set<string>,pageNumber=1){
 const v=raw as any;
 if(!v||!Array.isArray(v.data)||v.data.length>100||!v.links||typeof v.links!=='object'||Array.isArray(v.links))throw Error('FORMAT');
 if(!Object.prototype.hasOwnProperty.call(v.links,'next')){
  if(pageNumber!==1||seen.size!==0||v.data.length!==0||v.meta?.record_count!==0||('prev' in v.links&&v.links.prev!==null))throw Error('FORMAT');
  if(emptyBoundary(v.links.first,name)!==emptyBoundary(v.links.last,name))throw Error('PAGINATION');
  return {ids:[] as string[],next:null as string|null};
 }
 const ids:string[]=[];
 for(const row of v.data){
  if(row?.type!=='envelopes'||!signatureUuid.test(row.id)||row.attributes?.name!==name||seen.has(row.id))throw Error('FORMAT');
  seen.add(row.id);ids.push(row.id);
 }
 const next=v.links.next;
 if(next===null)return {ids,next:null as string|null};
 if(typeof next!=='string'||next.length>2000)throw Error('PAGINATION');
 const u=new URL(next,CLICKSIGN_SANDBOX_API+'/');
 if(u.origin!=='https://sandbox.clicksign.com'||u.pathname!=='/api/v3/envelopes'||u.username||u.password||u.hash||u.searchParams.get('filter[name]')!==name)throw Error('PAGINATION');
 for(const key of u.searchParams.keys())if(!['filter[name]','page[number]','page[size]'].includes(key)||u.searchParams.getAll(key).length!==1)throw Error('PAGINATION');
 if(!/^[1-9][0-9]{0,3}$/.test(u.searchParams.get('page[number]')??''))throw Error('PAGINATION');
 if(u.searchParams.has('page[size]')&&!/^(100|[1-9][0-9]?)$/.test(u.searchParams.get('page[size]')!))throw Error('PAGINATION');
 return {ids,next:u.href};
}
