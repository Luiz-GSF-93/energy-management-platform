import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createCoreTransport,opaque,validateCoreTask,validateCoreAnswer} from './core-transport.mjs';
import {createSealer} from './session-seal.mjs';
import {accessConfiguration,createAccessServer} from './access-server.mjs';

const organization=randomUUID(),tenant=randomUUID(),subject=randomUUID();
const exchangePayload=()=>({organization_id:organization,audience:'energyos-pee',code:opaque(),code_verifier:opaque()});
const exchanged=()=>({token:opaque(),expires_in:300,tenant_id:tenant,sub:subject,audience:'energyos-pee'});
const grant=()=>({active:true,sub:subject,tenant_id:tenant,organization_id:organization,role:'editor',scopes:['projects:read','projects:create','projects:edit'],monthly_project_limit:5,expires_at:new Date(Date.now()+250000).toISOString(),audience:'energyos-pee'});
const options={organization,tenant,timeoutMs:150,pollMs:40};

test('transport accepts only the fixed Core organization and access/activity operations',()=>{
 assert.ok(validateCoreTask('exchange',exchangePayload(),organization));
 for(const [operation,payload] of [['execute',exchangePayload()],['exchange',{...exchangePayload(),organization_id:randomUUID()}],['exchange',{...exchangePayload(),url:'https://untrusted.invalid'}],['exchange',{...exchangePayload(),code_verifier:'bad'}]])assert.throws(()=>validateCoreTask(operation,payload,organization));
});
test('a Core answer cannot select a licensed tenant or invent elevated scopes',()=>{
 assert.ok(validateCoreAnswer('introspect',grant(),organization,Date.now(),tenant));
 for(const value of [{...grant(),tenant_id:randomUUID()},{...grant(),organization_id:randomUUID()},{...grant(),role:'admin'},{...grant(),scopes:['projects:read','licenses:release']},{...grant(),expires_at:new Date(0).toISOString()},{...grant(),monthly_project_limit:0}])assert.throws(()=>validateCoreAnswer('introspect',value,organization,Date.now(),tenant));
});

test('identity names and workspace team remain bounded data rather than elevated permissions',()=>{
 const answer={...grant(),display_name:'Luiz',members:[{id:subject,name:'Luiz',role:'editor',active:true,expires_at:null,monthly_limit:5}],has_more:false,next_cursor:null};
 assert.ok(validateCoreTask('members',{organization_id:organization,audience:'energyos-pee',token:opaque(),after_id:null},organization));
 assert.ok(validateCoreAnswer('members',answer,organization,Date.now(),tenant));
 for(const bad of [{...answer,members:[{...answer.members[0],role:'admin'}]},{...answer,members:[{...answer.members[0],email:'unexpected@example.invalid'}]},{...answer,has_more:true,next_cursor:null},{...answer,display_name:'Luiz\nforged'}])assert.throws(()=>validateCoreAnswer('members',bad,organization,Date.now(),tenant));
});

test('author resolution cannot return another actor than those requested by the server',async()=>{
 const broker=createCoreTransport(options),pending=assert.rejects(broker.call('authors',{organization_id:organization,audience:'energyos-pee',token:opaque(),author_ids:[subject]})),task=await broker.poll();
 assert.throws(()=>broker.reply({id:task.id,nonce:task.nonce,status:200,data:{...grant(),author_names:[{id:randomUUID(),name:'Other actor'}]}}));await pending;assert.equal(broker.size(),0);broker.close();
});
test('a dispatched request needs the matching nonce and can be answered only once',async()=>{
 const b=createCoreTransport(options),pending=b.call('exchange',exchangePayload()),task=await b.poll();
 assert.throws(()=>b.reply({id:task.id,nonce:opaque(),status:200,data:exchanged()}));
 const answer=exchanged();b.reply({id:task.id,nonce:task.nonce,status:200,data:answer});assert.deepEqual(await pending,answer);
 assert.throws(()=>b.reply({id:task.id,nonce:task.nonce,status:200,data:answer}));assert.equal(b.size(),0);b.close();
});
test('bounded transport refuses overload and fails closed when Core is unavailable',async()=>{
 const b=createCoreTransport({...options,maxPending:1,timeoutMs:30});const first=assert.rejects(b.call('exchange',exchangePayload()),e=>e.status===503);await assert.rejects(b.call('exchange',exchangePayload()),e=>e.status===503);await first;assert.equal(b.size(),0);b.close();
});
test('a malformed Core reply fails its caller closed without keeping a pending request',async()=>{
 const b=createCoreTransport(options),pending=assert.rejects(b.call('exchange',exchangePayload()),e=>e.status===503),task=await b.poll();assert.throws(()=>b.reply({id:task.id,nonce:task.nonce,status:200,data:{...exchanged(),tenant_id:randomUUID()}}));await pending;assert.equal(b.size(),0);b.close();
});
test('only one long poll is held and a disconnected connector does not remain registered',async()=>{
 const b=createCoreTransport(options),controller=new AbortController(),poll=b.poll(controller.signal);await assert.rejects(b.poll(),e=>e.status===409);controller.abort();assert.equal(await poll,null);const next=b.poll();b.close();assert.equal(await next,null);
});
test('cookies are encrypted, purpose-bound, tamper-evident and expiring',()=>{
 let now=100000;const sealer=createSealer(opaque(),{now:()=>now}),secret=opaque(),value={secret},sealed=sealer.seal('state',value,10);assert.ok(!sealed.includes(secret));assert.deepEqual(sealer.open('state',sealed),value);assert.throws(()=>sealer.open('session',sealed));const raw=Buffer.from(sealed,'base64url');raw[30]^=1;assert.throws(()=>sealer.open('state',raw.toString('base64url')));now+=10001;assert.throws(()=>sealer.open('state',sealed));
});
test('access startup is disabled by default and refuses insecure or mixed-mode configuration',()=>{
 assert.equal(accessConfiguration({}),null);const env={PEE_ACCESS_ENABLED:'true',PEE_PUBLIC_ORIGIN:'https://pee.synthetic.invalid',CORE_PUBLIC_ORIGIN:'https://core.synthetic.invalid',CORE_OWNER_ORGANIZATION_ID:organization,CORE_WORKSPACE_TENANT_ID:tenant,CORE_PEER_SECRET:opaque(),PEE_COOKIE_KEY:opaque()};assert.equal(accessConfiguration(env).tenant,tenant);
 for(const patch of [{PEE_CORE_ENABLED:'true'},{PEE_PUBLIC_ORIGIN:'http://pee.synthetic.invalid'},{CORE_WORKSPACE_TENANT_ID:''},{PEE_COOKIE_KEY:env.CORE_PEER_SECRET},{CORE_PUBLIC_ORIGIN:env.PEE_PUBLIC_ORIGIN}])assert.throws(()=>accessConfiguration({...env,...patch}));
});

test('HTTP access flow binds the browser, hides Core credentials, rechecks revocation and enforces logout CSRF',async()=>{
 const config={publicOrigin:'https://pee.synthetic.invalid',coreOrigin:'https://core.synthetic.invalid',organization,tenant,peerSecret:opaque(),cookieKey:opaque(),workspaceName:'Expert Energy',activityEnabled:true},transport=createCoreTransport({...options,timeoutMs:1200}),{server}=createAccessServer({config,transport});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 const send=async(path,{body,headers={},method=body===undefined?'GET':'POST'}={})=>fetch(url+path,{method,redirect:'manual',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const machine={'Authorization':'Bearer '+config.peerSecret};
 async function answer(result,status=200){const r=await send('/internal/core/poll',{body:{organization_id:organization},headers:machine});assert.equal(r.status,200);const {task}=await r.json();assert.ok(task);const reply=await send('/internal/core/reply',{body:{id:task.id,nonce:task.nonce,status,data:result},headers:machine});assert.equal(reply.status,200);await reply.json();return task;}
 try{
  assert.equal((await send('/api/session')).status,401);assert.equal((await send('/internal/core/poll',{body:{organization_id:organization}})).status,401);assert.equal((await send('/internal/core/poll',{body:{organization_id:randomUUID()},headers:machine})).status,403);
  const start=await send('/auth/core/start');assert.equal(start.status,302);const target=new URL(start.headers.get('location'));assert.equal(target.origin,config.coreOrigin);assert.equal(target.pathname,'/pee/authorize');const state=target.searchParams.get('state'),challenge=target.searchParams.get('code_challenge'),stateCookie=start.headers.getSetCookie()[0];assert.match(stateCookie,/HttpOnly; Secure; SameSite=Lax/);const stateHeader=stateCookie.split(';')[0],body={code:opaque(),organization_id:organization,state},browser={'Origin':config.publicOrigin,'Cookie':stateHeader};
  assert.equal((await send('/auth/core/exchange',{body,headers:{...browser,Origin:'https://other.synthetic.invalid'}})).status,403);assert.equal((await send('/auth/core/exchange',{body:{...body,state:opaque()},headers:browser})).status,403);assert.equal(transport.size(),0);
  const login=send('/auth/core/exchange',{body,headers:browser}),coreToken=exchanged();const task=await answer(coreToken);assert.equal(task.operation,'exchange');assert.equal(createHash('sha256').update(task.payload.code_verifier).digest('base64url'),challenge);
  const logged=await login;assert.equal(logged.status,200);assert.deepEqual(await logged.json(),{ok:true});const sessionCookie=logged.headers.getSetCookie().find(c=>c.startsWith('__Host-pee_session='));assert.ok(!sessionCookie.includes(coreToken.token));assert.match(sessionCookie,/HttpOnly; Secure; SameSite=Lax/);const sessionHeader=sessionCookie.split(';')[0];
  assert.equal((await send('/auth/core/exchange',{body,headers:browser})).status,409);assert.equal(transport.size(),0);
  const inspected=send('/api/session',{headers:{Cookie:sessionHeader}});await answer(grant());const sessionResponse=await inspected;assert.equal(sessionResponse.status,200);const identity=await sessionResponse.json();assert.equal(identity.role,'editor');assert.equal(identity.workspace,'Expert Energy');assert.equal(identity.monthly_project_limit,5);assert.ok(!JSON.stringify(identity).includes(coreToken.token));
  assert.equal(sessionResponse.headers.get('set-cookie'),null,'Passive reads do not renew the cookie');
  assert.equal((await send('/api/app/activity',{body:{csrf:identity.csrf,activity_age_ms:0},headers:{Origin:'https://attacker.invalid',Cookie:sessionHeader}})).status,403);
  assert.equal((await send('/api/app/activity',{body:{csrf:opaque(),activity_age_ms:0},headers:{Origin:config.publicOrigin,Cookie:sessionHeader}})).status,403);
  const pulse=send('/api/app/activity',{body:{csrf:identity.csrf,activity_age_ms:2500},headers:{Origin:config.publicOrigin,Cookie:sessionHeader}});const pulseTask=await answer({...grant(),expires_at:new Date(Date.now()+897500).toISOString()});assert.equal(pulseTask.operation,'activity');assert.equal(pulseTask.payload.activity_age_ms,2500);const renewed=await pulse;assert.equal(renewed.status,200);assert.match(renewed.headers.get('set-cookie'),/Max-Age=89[0-9]/);assert.equal((await renewed.json()).idle_seconds,900);
  const revoked=send('/api/session',{headers:{Cookie:sessionHeader}});await answer({message:'Denied'},403);assert.equal((await revoked).status,403);
  assert.equal((await send('/auth/logout',{body:{csrf:opaque()},headers:{Origin:config.publicOrigin,Cookie:sessionHeader}})).status,403);
  assert.equal((await send('/auth/logout',{body:{csrf:identity.csrf},headers:{Cookie:sessionHeader}})).status,403);
  const logout=await send('/auth/logout',{body:{csrf:identity.csrf},headers:{Origin:config.publicOrigin,Cookie:sessionHeader}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await send('/v1/license-requests',{body:{}})).status,503);const health=await (await send('/health')).json();assert.equal(health.ready,false);assert.equal(health.enabled,false);
 }finally{transport.close();await new Promise(resolve=>server.close(resolve));}
});
