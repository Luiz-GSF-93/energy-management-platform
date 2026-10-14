// Actual installed SDK, isolated HTTP server: no credentials, production or email.
const assert=require('node:assert/strict'),http=require('node:http');
const {createClient}=require('@supabase/supabase-js');
(async()=>{
 let calls=0,mode='conflict';
 const server=http.createServer((req,res)=>{
  calls++;assert.equal(req.method,'POST');
  if(mode==='delay'){setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{'content-type':'application/json'});res.end('{}')}},100);return;}
  res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({code:'PT409',message:'Pending request or cooldown',details:null,hint:null}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const client=createClient('http://127.0.0.1:'+server.address().port,'synthetic-key',{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await client.rpc('reserve_platform_team_password_expiring',{}).retry(false);
  assert.equal(result.status,409);assert.equal(result.error.code,'PT409');assert.equal(calls,1);
  mode='delay';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20);
  const aborted=await client.rpc('reserve_platform_team_password_expiring',{}).retry(false).abortSignal(controller.signal);clearTimeout(timer);
  assert.ok(aborted.error);assert.equal(calls,2);await new Promise(r=>setTimeout(r,120));assert.equal(calls,2);
  console.log('PASS: installed SDK maps PT409, one POST per command, AbortSignal stops waiting and causes no automatic resend.');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
