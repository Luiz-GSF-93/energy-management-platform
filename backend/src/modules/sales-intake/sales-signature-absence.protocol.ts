import {CLICKSIGN_SANDBOX_API} from './sales-signature-protocol';
export const signatureUuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export type AbsenceProof={state:'EMPTY'|'CANDIDATE'|'INCOMPLETE';pages:number;candidateIds:string[];reason:string|null};
// A missing next link is not evidence that the collection was exhausted.
export function absencePage(raw:unknown,name:string,seen:Set<string>){
 const v=raw as any;
 if(!v||!Array.isArray(v.data)||v.data.length>100||!v.links||!Object.prototype.hasOwnProperty.call(v.links,'next'))throw Error('FORMAT');
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
