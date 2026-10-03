import type {AuthContext} from '@/app/lib/api';

export type InboxEntry={id:string;addedAt:number};
export type InboxUpdate={state:'WAITING'|'PREPARING'|'READY'|'FAILED'|'RECORDED';message:string;blockers?:number;reviews?:number;fields?:number;proposals?:number};
type StorageAccess=Pick<Storage,'getItem'|'setItem'>;
const lifetime=24*60*60*1000;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function inboxScope(context:AuthContext|null){
 if(!context||context.scope==='global')return '';
 return 'bot-energy-inbox-v1:'+JSON.stringify([context.currentOrganization.id,context.user.id,context.currentOrganization.role,context.accessMode??'', [...context.currentOrganization.permissions].sort()]);
}
export function readInbox(storage:StorageAccess,scope:string,now=Date.now()):InboxEntry[]{
 if(!scope)return [];
 try{
  const items:unknown=JSON.parse(storage.getItem(scope)??'[]');
  if(!Array.isArray(items))return [];
  const seen=new Set<string>();
  return items.filter((v):v is InboxEntry=>!!v&&typeof v==='object'&&uuid.test(v.id)&&typeof v.addedAt==='number'&&Number.isFinite(v.addedAt)&&v.addedAt<=now&&now-v.addedAt<lifetime&&!seen.has(v.id)&&!!seen.add(v.id)).slice(-32).map(({id,addedAt})=>({id,addedAt}));
 }catch{return [];}
}
export function writeInbox(storage:StorageAccess,scope:string,items:InboxEntry[]){
 // Pointers only: never persist OCR values, answers, authorization tokens or financial plans.
 try{if(scope)storage.setItem(scope,JSON.stringify(items.map(({id,addedAt})=>({id,addedAt})).slice(-32)));}catch{/* The live queue remains usable when browser storage is unavailable. */}
}
export function pendingFields(tasks:readonly {confirmed:boolean;canConfirm:boolean}[]){
 return tasks.filter(f=>!f.confirmed).length;
}
