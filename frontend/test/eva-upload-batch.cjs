const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {validateEvaFiles,sendEvaBatch}=require('../app/components/eva-upload-batch.ts');
const file=name=>new File(['x'.repeat(40)],name,{type:name.endsWith('.xml')?'application/xml':'application/pdf'});
(async()=>{
 assert(validateEvaFiles([]));assert(validateEvaFiles(Array.from({length:11},()=>file('invoice.pdf'))));
 assert(validateEvaFiles([{name:'invoice.xml',type:'application/xml',size:2*1024*1024+1}]));
 assert(validateEvaFiles([{name:'invoice.pdf',type:'application/pdf',size:15*1024*1024+1}]));
 assert(validateEvaFiles(Array.from({length:4},()=>({name:'invoice.pdf',type:'application/pdf',size:15*1024*1024}))));
 assert(validateEvaFiles([file('document.html')]));assert.equal(validateEvaFiles([file('invoice.pdf'),file('invoice.xml')]),'');
 const items=['invoice.pdf','supplier.xml','branch.pdf'].map((name,i)=>({file:file(name),requestId:'request-'+i,state:'pending'}));
 let calls=[],inFlight=0,peak=0;
 const first=await sendEvaBatch(items,'selected-company',async body=>{calls.push(body);inFlight++;peak=Math.max(peak,inFlight);await Promise.resolve();inFlight--;if(body.get('requestId')==='request-1')throw Error('Acknowledgement unavailable');},()=>{});
 assert.equal(first.complete,false);assert.equal(first.items[0].state,'received');assert.equal(first.items[1].state,'uncertain');assert.equal(first.items[2].state,'pending');assert.equal(peak,1);assert.equal(calls.length,2);
 assert(calls.every(body=>body.get('customerId')==='selected-company'&&body.get('consent')==='true'&&body.get('file') instanceof File));
 assert(calls.every(body=>!body.has('organizationId')&&!body.has('unitId')&&!body.has('approved')));
 const originalId=calls[1].get('requestId');calls=[];
 const retry=await sendEvaBatch(first.items,'selected-company',async body=>calls.push(body),()=>{});
 assert.equal(retry.complete,true);assert.deepEqual(calls.map(b=>b.get('requestId')),[originalId,'request-2']);assert.equal(retry.items.filter(i=>i.state==='received').length,3);
 calls=[];await sendEvaBatch(retry.items,'selected-company',async body=>calls.push(body),()=>{});assert.equal(calls.length,0,'Received originals must not be uploaded again');
 await sendEvaBatch([items[0]],undefined,async body=>assert(!body.has('customerId')),()=>{});
 const rejectedItems=['bad.xml','good.pdf','supplier.xml'].map((name,i)=>({file:file(name),requestId:'rejection-'+i,state:'pending'}));calls=[];
 const rejected=await sendEvaBatch(rejectedItems,'selected-company',async body=>{calls.push(body);if(body.get('requestId')==='rejection-0')throw Object.assign(new Error('XML fiscal inválido'),{status:400});},()=>{});
 assert.equal(rejected.complete,false);assert.deepEqual(rejected.items.map(i=>i.state),['rejected','received','received']);assert.equal(calls.length,3,'A definitive XML rejection cannot block the following PDF');assert(rejected.items[0].message.includes('Não recebido'));
 calls=[];await sendEvaBatch(rejected.items,'selected-company',async body=>calls.push(body),()=>{});assert.equal(calls.length,0,'Received and rejected originals are not replayed');
 for(const status of [401,403,409,429,500,503]){calls=[];const stopped=await sendEvaBatch(rejectedItems,'selected-company',async body=>{calls.push(body);throw Object.assign(new Error('Request unavailable'),{status});},()=>{});assert.equal(calls.length,1);assert.deepEqual(stopped.items.map(i=>i.state),['uncertain','pending','pending'],'Access, quota and uncertain server failures still stop new sends');}
 for(const status of [413,415,422]){calls=[];const continued=await sendEvaBatch(rejectedItems,'selected-company',async body=>{calls.push(body);if(body.get('requestId')==='rejection-0')throw Object.assign(new Error('File rejected'),{status});},()=>{});assert.equal(calls.length,3);assert.deepEqual(continued.items.map(i=>i.state),['rejected','received','received']);}
 console.log('PASS company-scoped sequential upload: limits, acknowledgement recovery, stable request IDs and no duplicate received uploads.');
})().catch(error=>{console.error(error);process.exitCode=1});
