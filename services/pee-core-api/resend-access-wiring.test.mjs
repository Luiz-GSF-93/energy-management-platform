import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {createAccessServer} from './access-server.mjs';

test('production access wiring verifies Resend signatures and acknowledges unrelated account events without reading private data',async()=>{
 const secret='whsec_'+randomBytes(32).toString('base64');
 const env={NODE_ENV:'test',PEE_PROJECTS_ENABLED:'true',PEE_RESEND_ENABLED:'true',PEE_RESEND_API_KEY:'re_synthetic_test_key_only',PEE_RESEND_WEBHOOK_SECRET:secret,PEE_MAIL_FROM:'projetos@pee.example.invalid',PEE_MAIL_RECEIVING_DOMAIN:'replies.pee.example.invalid',SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVER_KEY:'sb_secret_synthetic_test_only',PEE_CLIENT_PORTAL_ENABLED:'false',PEE_CONTENT_PROTECTION_ENABLED:'false'};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),originalFetch=globalThis.fetch;
 Object.assign(process.env,env);
 let server;globalThis.fetch=async()=>{throw Error('Unrelated provider events must not access external data');};
 try{
  ({server}=createAccessServer({config:{publicOrigin:'https://pee.example.invalid',coreOrigin:'https://core.example.invalid',organization:randomUUID(),tenant:randomUUID(),peerSecret:randomBytes(32).toString('base64url'),cookieKey:randomBytes(32).toString('base64url')}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  async function post(raw,headers={}){return originalFetch(url+'/webhooks/resend',{method:'POST',body:raw,headers:{'Content-Type':'application/json',...headers}});}
  assert.equal((await post('{}')).status,401,'configured webhook must authenticate instead of returning 503');
  for(const type of ['email.delivered','email.received']){
   const raw=JSON.stringify({type,created_at:new Date().toISOString(),data:{email_id:randomUUID(),from:'another-app@example.invalid',to:['unrelated@example.invalid']}}),id='msg_'+randomBytes(12).toString('hex'),timestamp=String(Math.floor(Date.now()/1000));
   const headers={'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(id+'.'+timestamp+'.'+raw).digest('base64')};
   assert.equal((await post(raw,headers)).status,200,'unrelated signed event is acknowledged without storing or fetching it');
   assert.equal((await post(raw+' ',headers)).status,401,'modified payload must remain rejected');
  }
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;
  for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
