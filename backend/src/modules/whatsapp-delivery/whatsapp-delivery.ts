import {createHmac,timingSafeEqual} from 'node:crypto';
export function validSignature(raw:Buffer|undefined,signature:unknown,secret:string|undefined){
 if(!raw||!secret||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 const expected=createHmac('sha256',secret).update(raw).digest();
 return timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'));
}
export function validChallenge(token:unknown,expected:string|undefined){
 if(!expected||typeof token!=='string')return false;
 const a=Buffer.from(token),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
export type StatusEvent={event_key:string;message_id:string;status:string;event_at:string;error_codes:number[]};
export function statusEvents(payload:any,waba:string|undefined,phone:string|undefined):StatusEvent[]{
 if(!waba||!phone||payload?.object!=='whatsapp_business_account')return [];
 const events:StatusEvent[]=[];
 for(const entry of Array.isArray(payload.entry)?payload.entry:[]){
  if(entry?.id!==waba)continue;
  for(const change of Array.isArray(entry.changes)?entry.changes:[]){
   const value=change?.value;
   if(change?.field!=='messages'||value?.metadata?.phone_number_id!==phone)continue;
   for(const s of Array.isArray(value.statuses)?value.statuses:[]){
    if(typeof s?.id!=='string'||!/^wamid\.[A-Za-z0-9+/=_-]{1,500}$/.test(s.id)||!['sent','delivered','read','failed'].includes(s.status)||!/^\d{1,12}$/.test(String(s.timestamp)))continue;
    const time=Number(s.timestamp)*1000;if(!Number.isFinite(time)||time>8640000000000000)continue;
    const codes=(Array.isArray(s.errors)?s.errors:[]).map((e:any)=>e?.code).filter((c:any)=>Number.isSafeInteger(c)&&c>=0).slice(0,10);
    events.push({event_key:`${s.id}:${s.status}:${s.timestamp}`,message_id:s.id,status:s.status,event_at:new Date(time).toISOString(),error_codes:codes});
   }
  }
 }
 return events;
}
