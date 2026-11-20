import{salesTask,salesAnswer}from'./sales-policy.mjs';
import{evaOperations,evaTask,evaAnswer}from'./eva-policy.mjs';
import {licensedOperations,licensedTask,licensedAnswer} from './licensed-policy.mjs';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
export const identifier=value=>typeof value==='string'&&uuid.test(value);
export const opaque=()=>randomBytes(32).toString('base64url');
const hash=x=>createHash('sha256').update(x).digest();
export function equalSecret(actual,expected){return typeof actual==='string'&&typeof expected==='string'&&expected.length>=43&&timingSafeEqual(hash(actual),hash(expected));}
export class AccessFailure extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status=503,message='O Core não confirmou o acesso. Tente novamente.')=>new AccessFailure(status,message);
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
export function validateCoreTask(operation,payload,organization){
 if(operation==='commercial_offer'){try{return salesTask(payload,organization);}catch{throw fail(422,'Oferta inválida.');}}
 if(evaOperations.has(operation)){try{return evaTask(operation,payload,organization);}catch{throw fail(422,'Consulta EVA inválida');}}
 if(licensedOperations.has(operation)){try{return licensedTask(operation,payload,organization);}catch{throw fail(400,'Solicitação de licença inválida');}}
 const fields=operation==='exchange'?['organization_id','audience','code','code_verifier']:operation==='activity'?['organization_id','audience','token','activity_age_ms']:operation==='authors'?['organization_id','audience','token','author_ids']:operation==='members'?['organization_id','audience','token','after_id']:operation==='introspect'?['organization_id','audience','token']:[];
 if(!fields.length||!exact(payload,fields)||payload.organization_id!==organization||!identifier(organization)||payload.audience!=='energyos-pee'||!token(operation==='exchange'?payload.code:payload.token)||operation==='exchange'&&!token(payload.code_verifier))throw fail(400,'Solicitação de acesso inválida');
 if(operation==='activity'&&(!Number.isInteger(payload.activity_age_ms)||payload.activity_age_ms<0||payload.activity_age_ms>60000))throw fail(400,'Atividade inválida');
 if(operation==='authors'&&(!Array.isArray(payload.author_ids)||payload.author_ids.length<1||payload.author_ids.length>40||payload.author_ids.some(id=>!identifier(id))||new Set(payload.author_ids).size!==payload.author_ids.length))throw fail(400,'Consulta de autores inválida');
 if(operation==='members'&&payload.after_id!==null&&!identifier(payload.after_id))throw fail(400,'Paginação da equipe inválida');
 return payload;
}
const scopes={viewer:['projects:read'],editor:['projects:read','projects:create','projects:edit'],reviewer:['projects:read','projects:review']};
export function validateCoreAnswer(operation,data,organization,now=Date.now(),tenant){
 if(operation==='commercial_offer'){try{return salesAnswer(data);}catch{throw fail();}}
 if(evaOperations.has(operation)){try{return evaAnswer(data,now);}catch{throw fail();}}
 if(licensedOperations.has(operation)){try{return licensedAnswer(operation,data,organization,tenant,now);}catch{throw fail();}}
 if(tenant&&data?.tenant_id!==tenant)throw fail();
 if(!data||data.audience!=='energyos-pee'||!identifier(data.sub)||!identifier(data.tenant_id))throw fail();
 if(operation==='exchange'){
  if(!exact(data,['token','expires_in','tenant_id','sub','audience'])||!token(data.token)||!Number.isInteger(data.expires_in)||data.expires_in<1||data.expires_in>900)throw fail();
 }else{
  const keys=['active','sub','tenant_id','organization_id','role','scopes','monthly_project_limit','expires_at','audience',...(Object.hasOwn(data,'display_name')?['display_name']:[]),...(Object.hasOwn(data,'email')?['email']:[]),...(operation==='authors'?['author_names']:[]),...(operation==='members'?['members','has_more','next_cursor']:[])];
  if(!exact(data,keys)||data.active!==true||data.organization_id!==organization||!Object.hasOwn(scopes,data.role)||JSON.stringify(data.scopes)!==JSON.stringify(scopes[data.role])||!Number.isInteger(data.monthly_project_limit)||data.monthly_project_limit<1||data.monthly_project_limit>10000||!Number.isFinite(Date.parse(data.expires_at))||Date.parse(data.expires_at)<=now||Date.parse(data.expires_at)>now+905000)throw fail();
  if(Object.hasOwn(data,'email')&&(typeof data.email!=='string'||data.email.length>254||!/^[-a-zA-Z0-9.!#$%&'*+/=?^_`{|}~]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/.test(data.email)))throw fail();
  if(Object.hasOwn(data,'display_name')&&(typeof data.display_name!=='string'||!data.display_name.trim()||data.display_name.length>200||/[\x00-\x1f]/.test(data.display_name)))throw fail();
  if(operation==='authors'&&(!Array.isArray(data.author_names)||data.author_names.length>40||new Set(data.author_names.map(a=>a.id)).size!==data.author_names.length||data.author_names.some(a=>!exact(a,['id','name'])||!identifier(a.id)||typeof a.name!=='string'||!a.name.trim()||a.name.length>200||/[\x00-\x1f]/.test(a.name))))throw fail();
  if(operation==='members'&&(!Array.isArray(data.members)||data.members.length>25||typeof data.has_more!=='boolean'||data.has_more&&(!data.members.length||data.next_cursor!==data.members.at(-1).id)||!data.has_more&&data.next_cursor!==null||data.members.some(a=>!exact(a,['id','name','role','active','expires_at','monthly_limit'])||!identifier(a.id)||typeof a.name!=='string'||!a.name.trim()||a.name.length>200||/[\x00-\x1f]/.test(a.name)||!Object.hasOwn(scopes,a.role)||typeof a.active!=='boolean'||!Number.isInteger(a.monthly_limit)||a.monthly_limit<1||a.monthly_limit>10000||a.expires_at!==null&&!Number.isFinite(Date.parse(a.expires_at)))||new Set(data.members.map(a=>a.id)).size!==data.members.length))throw fail();
 }
 return data;
}

// Access checks and bounded EVA start/status handles only. Model generation runs asynchronously in Core; no files or engineering records enter this queue.
// Current deployment requires exactly one PEE replica and one Core connector.
// Loss of this process fails pending requests closed; nothing is authorized offline.
export function createCoreTransport({organization,tenant,timeoutMs=8000,pollMs=20000,maxPending=128,now=Date.now}={}){
 if(!identifier(organization)||!identifier(tenant)||timeoutMs<20||timeoutMs>15000||pollMs<10||pollMs>25000||maxPending<1||maxPending>512)throw Error('Invalid Core transport configuration');
 const pending=new Map();let waiter=null,lastPeer=0,closed=false;
 const take=()=>{for(const task of pending.values())if(!task.claimed){task.claimed=true;return {id:task.id,nonce:task.nonce,operation:task.operation,payload:task.payload};}return null;};
 const wake=()=>{if(!waiter)return;const task=take();if(task){const w=waiter;waiter=null;w.finish(task);}};
 return {
  ready:()=>!closed&&lastPeer>0&&now()-lastPeer<45000,
  size:()=>pending.size,
  call(operation,payload){
   validateCoreTask(operation,payload,organization);if(closed||pending.size>=maxPending)return Promise.reject(fail());
   return new Promise((resolve,reject)=>{const id=randomUUID(),nonce=opaque(),task={id,nonce,operation,payload:structuredClone(payload),resolve,reject,claimed:false};
    task.timer=setTimeout(()=>{pending.delete(id);reject(fail());},timeoutMs);pending.set(id,task);wake();});
  },
  async poll(signal){
   if(closed)throw fail();if(waiter)throw fail(409,'Conector já conectado');lastPeer=now();const task=take();if(task)return task;
   return new Promise(resolve=>{let timer;const finish=value=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(value);};const slot={finish};const abort=()=>{if(waiter===slot)waiter=null;finish(null);};timer=setTimeout(abort,pollMs);waiter=slot;if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
  },
  reply(body){
   if(!exact(body,['id','nonce','status','data'])||!identifier(body.id)||!token(body.nonce)||!Number.isInteger(body.status))throw fail(400,'Resposta inválida');
   const task=pending.get(body.id);if(!task||!task.claimed||!equalSecret(body.nonce,task.nonce))throw fail(409,'Solicitação expirada');
   if(![200,400,401,403,409,422,429,503].includes(body.status))throw fail(400,'Resposta inválida');
   if(body.status!==200){clearTimeout(task.timer);pending.delete(task.id);task.reject(fail([400,401,403,409,422,429].includes(body.status)?body.status:503,body.status===403?'Acesso não liberado pelo Core':'O Core não confirmou o acesso'));return;}
   let data;try{data=validateCoreAnswer(task.operation,body.data,organization,now(),tenant);if(task.operation==='commercial_offer'&&(data.offer_id!==task.payload.offer_id||data.license_id!==task.payload.license_id))throw fail();if(evaOperations.has(task.operation)&&(data.tenant_id!==(task.payload.source==='core'?tenant:task.payload.license_id)||task.payload.source==='licensed'&&data.sub!==task.payload.subject||task.operation==='eva_status'&&data.job_id!==task.payload.job_id||task.operation==='eva_start'&&data.citations.some(id=>!task.payload.sources.some(s=>s.source_id===id))))throw fail();if(licensedOperations.has(task.operation)&&(task.operation==='licensed_enrollment'?data.license_id!==task.payload.license_id:data.sub!==task.payload.subject||data.tenant_id!==task.payload.license_id))throw fail();if(task.operation==='authors'&&data.author_names.some(a=>!task.payload.author_ids.includes(a.id)))throw fail();}catch{clearTimeout(task.timer);pending.delete(task.id);task.reject(fail());throw fail(400,'Resposta inválida');}
   clearTimeout(task.timer);pending.delete(task.id);lastPeer=now();task.resolve(data);
  },
  close(){closed=true;if(waiter){const w=waiter;waiter=null;w.finish(null);}for(const task of pending.values()){clearTimeout(task.timer);task.reject(fail());}pending.clear();}
 };
}
