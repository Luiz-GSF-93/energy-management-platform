const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {createOperationalRefresh}=require('../app/backoffice/documents/operations/operational-refresh.ts');
const {serviceAvailability}=require('../app/backoffice/documents/operations/service-availability.ts');
const nativeSet=setTimeout,nativeClear=clearTimeout,nativeFetch=global.fetch,originalApi=process.env.NEXT_PUBLIC_API_URL;
const watchdog=nativeSet(()=>{console.error('FAIL: unresolved operational resilience scenario');process.exitCode=1;},10000);
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function clock(){
 let now=0,seq=0;const jobs=new Map();
 global.setTimeout=(fn,ms)=>{const id=++seq;jobs.set(id,{fn,at:now+ms});return id;};global.clearTimeout=id=>jobs.delete(id);
 return {size:()=>jobs.size,advance:async ms=>{const end=now+ms;let remaining=1000;while(remaining--){const entry=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;jobs.delete(entry[0]);entry[1].fn();await flush();}assert(remaining>0,'scheduler must remain bounded');now=end;await flush();}};
}
let checks=0;
const test=async(run)=>{try{await run();checks++;}finally{global.setTimeout=nativeSet;global.clearTimeout=nativeClear;global.fetch=nativeFetch;}};
(async()=>{try{
 await test(async()=>{
  const c=clock();let reads=0;const states=[],results=[];
  const loop=createOperationalRefresh({read:async()=>++reads,canRead:()=>true,result:r=>results.push(r),error:()=>assert.fail('unexpected error'),state:s=>states.push(s)});
  await flush();assert.equal(reads,1);assert.equal(states.at(-1).delayMs,30000);await c.advance(29999);assert.equal(reads,1);await c.advance(1);assert.equal(reads,2);loop.stop();await flush();assert.equal(c.size(),0);
 });
 await test(async()=>{
  const c=clock();let reads=0,errors=0;const states=[];
  const loop=createOperationalRefresh({read:async()=>{reads++;if(reads<4)throw Error('offline');return 'ok';},canRead:()=>true,result:()=>{},error:()=>errors++,state:s=>states.push(s)});
  await flush();assert.equal(states.at(-1).delayMs,60000);await c.advance(60000);assert.equal(states.at(-1).delayMs,120000);await c.advance(120000);assert.equal(states.at(-1).delayMs,120000);await c.advance(120000);assert.equal(states.at(-1).delayMs,30000);assert.equal(errors,3);assert.equal(reads,4);loop.stop();
 });
 await test(async()=>{
  const c=clock();let reads=0,finish;const results=[],errors=[];
  const loop=createOperationalRefresh({read:()=>{reads++;return new Promise(resolve=>finish=resolve);},canRead:()=>true,result:r=>results.push(r),error:e=>errors.push(e),state:()=>{}});
  await flush();loop.refresh();loop.refresh();await c.advance(14999);assert.equal(reads,1);await c.advance(1);assert.equal(errors.length,1);assert.equal(errors[0].name,'AbortError');finish('late result');await flush();assert.equal(results.length,0,'a late result cannot overwrite the last successful query');loop.stop();assert.equal(c.size(),0);
 });
 await test(async()=>{
  const c=clock();let connected=false,reads=0;const states=[];
  const loop=createOperationalRefresh({read:async()=>++reads,canRead:()=>connected,result:()=>{},error:()=>{},state:s=>states.push(s)});
  await flush();assert.equal(reads,0);assert.equal(c.size(),0);assert.equal(states.at(-1).mode,'paused');connected=true;loop.refresh();await flush();assert.equal(reads,1);connected=false;await c.advance(30000);assert.equal(reads,1);assert.equal(states.at(-1).mode,'paused');connected=true;loop.refresh();await flush();assert.equal(reads,2);loop.stop();
 });
 await test(async()=>{
  const c=clock();let signal,finish,callbacks=0;
  const loop=createOperationalRefresh({read:s=>{signal=s;return new Promise(resolve=>finish=resolve);},canRead:()=>true,result:()=>callbacks++,error:()=>callbacks++,state:()=>{}});
  await flush();loop.stop();assert(signal.aborted);finish('old tenant');await flush();assert.equal(callbacks,0);assert.equal(c.size(),0);loop.refresh();await flush();assert.equal(callbacks,0);
 });
 process.env.NEXT_PUBLIC_API_URL='https://api.example.invalid/';
 const payload={status:'ready',dependencies:{database:'up',auth:'up'},checkedAt:'2026-11-12T20:00:00Z',privateExtra:'not returned'};
 await test(async()=>{
  let observed;global.fetch=async(url,init)=>{observed={url,init};return new Response(JSON.stringify(payload));};
  const r=await serviceAvailability(new AbortController().signal);assert.deepEqual(r,{database:'up',auth:'up',checkedAt:payload.checkedAt});assert.equal(observed.url,'https://api.example.invalid/api/v1/health/ready');assert.equal(observed.init.method,'GET');assert.equal(observed.init.credentials,'omit');assert.equal(observed.init.headers,undefined);assert(!JSON.stringify(r).includes('not returned'));
 });
 await test(async()=>{
  global.fetch=async()=>new Response(JSON.stringify({...payload,status:'degraded',dependencies:{database:'up',auth:'down'}}),{status:503});
  assert.deepEqual(await serviceAvailability(new AbortController().signal),{database:'up',auth:'down',checkedAt:payload.checkedAt});
 });
 await test(async()=>{
  for(const data of [{}, {...payload,dependencies:{database:'up',auth:'down'}},{...payload,checkedAt:'invalid'}]){global.fetch=async()=>new Response(JSON.stringify(data));assert.equal((await serviceAvailability(new AbortController().signal)).auth,'unknown');}
 });
 await test(async()=>{
  let reads=0;global.fetch=async()=>{reads++;throw Error('network');};const parent=new AbortController();parent.abort();assert.equal((await serviceAvailability(parent.signal)).auth,'unknown');assert.equal(reads,0);
 });
 await test(async()=>{
  const c=clock();let signal;global.fetch=(_url,init)=>new Promise((_,reject)=>{signal=init.signal;signal.addEventListener('abort',()=>reject(Error('aborted')));});
  const result=serviceAvailability(new AbortController().signal);await c.advance(5000);assert.equal((await result).auth,'unknown');assert(signal.aborted);assert.equal(c.size(),0);
 });
 await test(async()=>{
  const c=clock();const parent=new AbortController();
  // Native fetch cancellation covers body streaming; this fixture supplies that behavior explicitly.
  global.fetch=(_url,init)=>Promise.resolve({ok:true,status:200,json:()=>init.signal.aborted?Promise.reject(Error('body aborted')):new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('body aborted'))))});
  const result=serviceAvailability(parent.signal);parent.abort();await flush();assert.equal((await result).auth,'unknown');assert.equal(c.size(),0);
 });
 console.log(`PASS ${checks} EVA operational resilience scenarios: single-flight queries, deadline, backoff, recovery, tenant teardown, public sanitized readiness and cancellation.`);
}finally{nativeClear(watchdog);global.setTimeout=nativeSet;global.clearTimeout=nativeClear;global.fetch=nativeFetch;if(originalApi===undefined)delete process.env.NEXT_PUBLIC_API_URL;else process.env.NEXT_PUBLIC_API_URL=originalApi;}})().catch(e=>{console.error(e);process.exitCode=1});
