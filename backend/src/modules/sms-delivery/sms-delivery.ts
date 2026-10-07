import {validateRequest} from 'twilio';
export const SMS_CALLBACK_PATH='/api/v1/integrations/sms/status';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function smsReady(env:NodeJS.ProcessEnv=process.env){
 return env.TWILIO_SMS_ENABLED==='true'&&env.TWILIO_SENDER_APPROVED==='true'&&/^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID??'')&&/^MG[0-9a-f]{32}$/i.test(env.TWILIO_MESSAGING_SERVICE_SID??'')&&!!env.TWILIO_AUTH_TOKEN&&callbackBase(env.TWILIO_STATUS_CALLBACK_URL)!==null;
}
function callbackBase(value:string|undefined){try{const u=new URL(value??'');return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname===SMS_CALLBACK_PATH?u.toString():null;}catch{return null;}}
export function smsCallback(id:string,env:NodeJS.ProcessEnv=process.env){const base=callbackBase(env.TWILIO_STATUS_CALLBACK_URL);return base&&uuid.test(id)?base+'?delivery='+id:null;}
export function smsReceipt(originalUrl:string,signature:unknown,body:unknown,env:NodeJS.ProcessEnv=process.env){
 if(typeof signature!=='string'||!body||typeof body!=='object'||Array.isArray(body)||!env.TWILIO_AUTH_TOKEN)return null;
 const match=originalUrl.match(/^\/api\/v1\/integrations\/sms\/status\?delivery=([0-9a-f-]{36})$/i),id=match?.[1];if(!id)return null;
 const url=smsCallback(id,env);if(!url)return null;
 const params=body as Record<string,string>;if(Object.keys(params).length>100||Object.values(params).some(v=>typeof v!=='string'||v.length>4096))return null;
 // The exact configured public URL is used; never trust forwarded Host headers.
 if(!validateRequest(env.TWILIO_AUTH_TOKEN,signature,url,params)||params.AccountSid!==env.TWILIO_ACCOUNT_SID||!/^SM[0-9a-f]{32}$/i.test(params.MessageSid??''))return null;
 if(!['queued','sending','sent','delivered','undelivered','failed'].includes(params.MessageStatus))return null;
 return {deliveryId:id,messageSid:params.MessageSid,status:params.MessageStatus,errorCode:/^\d{1,8}$/.test(params.ErrorCode??'')?params.ErrorCode:null};
}
export async function sendSms(id:string,destination:string,text:string,transport:typeof fetch=fetch):Promise<{state:'ACCEPTED'|'FAILED'|'UNKNOWN';providerId?:string;reason?:string}>{
 const callback=smsCallback(id);if(!smsReady()||!callback)return {state:'FAILED',reason:'PROVIDER_NOT_READY'};
 if(!/^\+[1-9]\d{7,14}$/.test(destination))return {state:'FAILED',reason:'INVALID_DESTINATION'};
 if(!text||text.length>320)return {state:'FAILED',reason:'PROVIDER_REJECTED'};
 try{
  const response=await transport(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Basic '+Buffer.from(process.env.TWILIO_ACCOUNT_SID+':'+process.env.TWILIO_AUTH_TOKEN).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:destination,MessagingServiceSid:process.env.TWILIO_MESSAGING_SERVICE_SID!,Body:text,StatusCallback:callback}).toString()});
  if(!response.ok)return response.status>=500||response.status===429?{state:'UNKNOWN',reason:'PROVIDER_UNCERTAIN'}:{state:'FAILED',reason:'PROVIDER_REJECTED'};
  const data=await response.json() as {sid?:string};return /^SM[0-9a-f]{32}$/i.test(data.sid??'')?{state:'ACCEPTED',providerId:data.sid}:{state:'UNKNOWN',reason:'MISSING_RECEIPT'};
 }catch{return {state:'UNKNOWN',reason:'PROVIDER_UNCERTAIN'};}
}
