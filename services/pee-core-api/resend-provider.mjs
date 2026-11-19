import {createHmac,timingSafeEqual,createHash}from'node:crypto';
import {emailAddress}from'./communications-policy.mjs';
export class ResendFailure extends Error{constructor(code,{uncertain=false,retryable=false}={}){super(code);this.code=code;this.uncertain=uncertain;this.retryable=retryable;}}
export function resendConfiguration(env=process.env){
 if(env.PEE_RESEND_ENABLED!=='true')return null;
 const key=env.PEE_RESEND_API_KEY??'',secret=env.PEE_RESEND_WEBHOOK_SECRET??'',from=emailAddress(env.PEE_MAIL_FROM),domain=String(env.PEE_MAIL_RECEIVING_DOMAIN??'').toLowerCase();
 if(!/^re_[A-Za-z0-9_-]{10,250}$/.test(key)||!/^whsec_[A-Za-z0-9+/=]{20,200}$/.test(secret)||Buffer.from(secret.slice(6),'base64').length<16||!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(domain)||domain.includes('..'))throw Error('Dedicated Resend mail configuration required');
 return {key,secret,from,receivingDomain:domain,enabled:true};
}
export function verifyResendEvent(raw,headers,secret,{now=Date.now()}={}){
 const id=headers['svix-id'],timestamp=headers['svix-timestamp'],signature=headers['svix-signature'];
 if(typeof raw!=='string'||Buffer.byteLength(raw)>1000000||typeof id!=='string'||!/^[A-Za-z0-9_-]{8,160}$/.test(id)||typeof timestamp!=='string'||!/^\d{9,12}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||typeof signature!=='string'||signature.length>2048||!/^whsec_[A-Za-z0-9+/=]{20,200}$/.test(secret??''))throw new ResendFailure('WEBHOOK_INVALID');
 const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(id+'.'+timestamp+'.'+raw).digest();
 const matched=signature.split(/\s+/).some(part=>{const m=/^v1,([A-Za-z0-9+/]+={0,2})$/.exec(part);if(!m)return false;const actual=Buffer.from(m[1],'base64');return actual.length===expected.length&&timingSafeEqual(expected,actual);});
 if(!matched)throw new ResendFailure('WEBHOOK_INVALID');let event;try{event=JSON.parse(raw);}catch{throw new ResendFailure('WEBHOOK_INVALID');}
 if(!event||typeof event.type!=='string'||!event.data||typeof event.data!=='object'||Array.isArray(event.data)||!/^[a-f0-9-]{36}$/i.test(event.data.email_id??''))throw new ResendFailure('WEBHOOK_INVALID');
 return {id,hash:createHash('sha256').update(raw).digest('hex'),event};
}
export function createResendProvider(config,{fetcher=fetch,now=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!config?.key)throw Error('Resend configuration required');
 // Reserve at most two request starts/second for PEE in this shared account.
 let scheduled=Promise.resolve(),nextStart=0,queued=0;
 async function reserve(){
  if(queued>=20)throw new ResendFailure('RESEND_QUEUE_LIMIT',{retryable:true});
  queued++;const turn=scheduled.then(async()=>{const delay=Math.max(0,nextStart-now());if(delay>10000)throw new ResendFailure('RESEND_COOLDOWN',{retryable:true});if(delay)await pause(delay);nextStart=now()+500;});scheduled=turn.catch(()=>{});
  try{await turn;}finally{queued--;}
 }
 async function request(path,{method='GET',body,idempotencyKey}={}){
  if(!/^\/emails(?:\/receiving)?(?:\/[a-f0-9-]{36}(?:\/attachments(?:\/[a-f0-9-]{36})?)?)?$/.test(path))throw new ResendFailure('RESEND_PATH_INVALID');
  await reserve();let response;try{response=await fetcher('https://api.resend.com'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new ResendFailure('RESEND_UNCONFIRMED',{uncertain:method==='POST',retryable:true});}
  if(!response.ok){const status=response.status;if(status===429){const retry=response.headers.get('retry-after'),seconds=Number(retry),until=retry&&Number.isFinite(seconds)?now()+Math.max(1,seconds)*1000:Date.parse(retry??'');nextStart=Math.max(nextStart,Number.isFinite(until)?until:now()+5000);}await response.body?.cancel();throw new ResendFailure('RESEND_HTTP_'+status,{uncertain:method==='POST'&&status>=500,retryable:status===429||status>=500});}
  try{const length=Number(response.headers.get('content-length')??0);if(length>2000000){await response.body?.cancel();throw Error('limit');}const chunks=[];let size=0;for await(const chunk of response.body??[]){size+=chunk.length;if(size>2000000)throw Error('limit');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ResendFailure('RESEND_RESPONSE_INVALID',{uncertain:method==='POST'});}
 }
 return {configuration:{from:config.from,receivingDomain:config.receivingDomain},
  async send({message,thread,attachments}){
   const body={from:message.sender_name.replace(/[<>\r\n]/g,'').slice(0,120)+' <'+config.from+'>',to:message.to,...(message.cc?.length?{cc:message.cc}:{}),...(message.bcc?.length?{bcc:message.bcc}:{}),subject:message.subject,text:message.body,html:message.html,reply_to:'p-'+thread.reply_token+'@'+config.receivingDomain,attachments:attachments.map(a=>({filename:a.name,content:a.bytes.toString('base64'),content_type:a.mime})),...(message.in_reply_to?{headers:{'In-Reply-To':message.in_reply_to,References:message.in_reply_to}}:{}),tags:[{name:'energyos_pee_message',value:message.id}]};
   const result=await request('/emails',{method:'POST',body,idempotencyKey:'energyos-pee/'+message.id+'/'+message.preview_hash});if(!/^[a-f0-9-]{36}$/i.test(result.id??''))throw new ResendFailure('RESEND_RESPONSE_INVALID',{uncertain:true});return {id:result.id};
  },
  received:id=>request('/emails/receiving/'+id),
  receivedAttachments:id=>request('/emails/receiving/'+id+'/attachments'),
  attachment:(emailId,id)=>request('/emails/receiving/'+emailId+'/attachments/'+id),
  outgoing:id=>request('/emails/'+id)
 };
}
