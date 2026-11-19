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
 const fields=operation==='exchange'?['organization_id','audience','code','code_verifier']:operation==='activity'?['organization_id','audience','token','activity_age_ms']:operation==='introspect'?['organization_id','audience','token']:[];
 if(!fields.length||!exact(payload,fields)||payload.organization_id!==organization||!identifier(organization)||payload.audience!=='energyos-pee'||!token(operation==='exchange'?payload.code:payload.token)||operation==='exchange'&&!token(payload.code_verifier))throw fail(400,'Solicitação de acesso inválida');
 if(operation==='activity'&&(!Number.isInteger(payload.activity_age_ms)||payload.activity_age_ms<0||payload.activity_age_ms>60000))throw fail(400,'Atividade inválida');
 return payload;
}
const scopes={viewer:['projects:read'],editor:['projects:read','projects:create','projects:edit'],reviewer:['projects:read','projects:review']};
export function validateCoreAnswer(operation,data,organization,now=Date.now(),tenant){
 if(tenant&&data?.tenant_id!==tenant)throw fail();
 if(!data||data.audience!=='energyos-pee'||!identifier(data.sub)||!identifier(data.tenant_id))throw fail();
 if(operation==='exchange'){
  if(!exact(data,['token','expires_in','tenant_id','sub','audience'])||!token(data.token)||!Number.isInteger(data.expires_in)||data.expires_in<1||data.expires_in>900)throw fail();
 }else{
  if(!exact(data,['active','sub','tenant_id','organization_id','role','scopes','monthly_project_limit','expires_at','audience'])||data.active!==true||data.organization_id!==organization||!Object.hasOwn(scopes,data.role)||JSON.stringify(data.scopes)!==JSON.stringify(scopes[data.role])||!Number.isInteger(data.monthly_project_limit)||data.monthly_project_limit<1||data.monthly_project_limit>10000||!Number.isFinite(Date.parse(data.expires_at))||Date.parse(data.expires_at)<=now||Date.parse(data.expires_at)>now+905000)throw fail();
 }
 return data;
}

// Only short-lived access checks are queued here, never business jobs or files.
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
   let data;try{data=validateCoreAnswer(task.operation,body.data,organization,now(),tenant);}catch{clearTimeout(task.timer);pending.delete(task.id);task.reject(fail());throw fail(400,'Resposta inválida');}
   clearTimeout(task.timer);pending.delete(task.id);lastPeer=now();task.resolve(data);
  },
  close(){closed=true;if(waiter){const w=waiter;waiter=null;w.finish(null);}for(const task of pending.values()){clearTimeout(task.timer);task.reject(fail());}pending.clear();}
 };
}
