const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
let request;const load=Module._load;Module._load=function(n,p,m){if(n==='@/app/lib/api/client')return {apiRequest:(...a)=>request(...a)};return load.call(this,n,p,m)};
const {supplierSourceRequest}=require('../app/backoffice/contracts/supplier-source-request.ts');
(async()=>{
 const realSet=global.setTimeout,realClear=global.clearTimeout;let deadline,cleared=0,signal,late;
 global.setTimeout=(f,ms)=>{assert.equal(ms,45000);deadline=f;return 123};global.clearTimeout=id=>{assert.equal(id,123);cleared++};
 try{
  request=(_,o)=>{signal=o.signal;return new Promise(resolve=>late=resolve)};
  const pending=supplierSourceRequest('/read');deadline();await assert.rejects(pending,/Os dados salvos foram preservados/);assert(signal.aborted);late({stale:true});await Promise.resolve();assert.equal(cleared,1);
  const controller=new AbortController();const cancelled=supplierSourceRequest('/read',controller.signal);controller.abort();await assert.rejects(cancelled,/cancelada/);assert(signal.aborted);assert.equal(cleared,2);
  request=async()=>({source:'verified'});assert.deepEqual(await supplierSourceRequest('/read'),{source:'verified'});assert.equal(cleared,3);
  console.log('PASS source read deadline, abandoned authentication/fetch, cancellation, late completion and successful retry');
 }finally{global.setTimeout=realSet;global.clearTimeout=realClear}
})().catch(e=>{console.error(e);process.exitCode=1});
