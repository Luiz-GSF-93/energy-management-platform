// Dedicated Docker lab only. No remote DB URL, credentials or production data.
// Start postgres:17 with --network none and no exposed ports, then run this test.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { aclFixture } from './acl-test-fixture.mjs';
const run=promisify(execFile),container='acl-concurrency-lab-20261006';let checks=0;
const sql=async(text,db='acl_lab')=>{try{return(await run('docker',['exec',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d',db,'-c',text],{maxBuffer:2e6})).stdout.trim();}catch(e){e.code=e.stderr?.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]??e.code;throw e;}};
const literal=v=>v==null?'NULL':Array.isArray(v)?literal('{'+v.join(',')+'}'):typeof v==='object'?literal(JSON.stringify(v)):typeof v==='boolean'?String(v):typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const adapter={exec:sql,close:async()=>{},query:async(text,params=[])=>{const expanded=text.replace(/\$(\d+)/g,(_,i)=>literal(params[Number(i)-1]));if(!/^\s*SELECT/i.test(expanded)){await sql(expanded);return{rows:[]};}return{rows:JSON.parse(await sql("SELECT coalesce(json_agg(row_to_json(q)),'[]') FROM ("+expanded+") q"))};}};
const check=v=>{assert.ok(v);checks++;};const delay=ms=>new Promise(r=>setTimeout(r,ms));
await sql('CREATE DATABASE acl_lab','postgres');
const f=await aclFixture(adapter),{db,actor,peer,client,call,migrate,create,work,evidence,doc}=f;
await migrate('20261006_acl_admission_closure.sql');await migrate('20261006_acl_admission_history.sql');
await migrate('20261006_acl_history_simulation.sql');
let row=await create();
// The holder opens a contention window. Assert both independently connected
// commands are actually queued before it commits; do not infer concurrency.
async function race(commands){
 const holder=sql("BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('acl-work:o1',0));SELECT pg_sleep(1);COMMIT;");
 for(let i=0;i<100;i++){if(Number(await sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted"))>0)break;if(i===99)throw new Error('Lab lock holder unavailable');await delay(10);}
 const pending=commands.map(fn=>fn());let waiting=0;
 for(let i=0;i<100;i++){waiting=Number(await sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted"));if(waiting>=commands.length)break;await delay(10);}
 check(waiting>=commands.length);await holder;return Promise.all(pending);
}
const request=randomUUID(),args=['o1',actor,'r1',false,row.id,request,row.revision,'registration','START',null,null];
let results=await race([()=>call('acl_work_command',args),()=>call('acl_work_command',args)]);
check(results.every(r=>r.ok)&&results.filter(r=>r.replayed).length===1);row=results[0].admission;
check(Number(await sql('SELECT count(*) FROM acl_admission_work_sessions WHERE ended_at IS NULL'))===1);
check(Number(await sql("SELECT count(*) FROM acl_admission_events WHERE action='START'"))===1);
row=(await call('acl_work_command',['o1',actor,'r1',false,row.id,randomUUID(),row.revision,'registration','PAUSE','ENDING_ACTIVITY',null])).admission;
results=await race([()=>work(row.id,row.revision,'registration','RESUME'),()=>work(row.id,row.revision,'registration','RESUME',peer)]);
check(results.filter(r=>r.ok).length===1&&results.some(r=>r.code==='CONFLICT'));row=results.find(r=>r.ok).admission;
const owner=row.stages[0].active.actorId;
row=(await call('acl_work_command',['o1',owner,'r1',false,row.id,randomUUID(),row.revision,'registration','PAUSE','ENDING_ACTIVITY',null])).admission;
// Real current-authority check after the queued command acquires its lock.
const holder=sql("BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('acl-work:o1',0));SELECT pg_sleep(1);COMMIT;");
for(let i=0;i<100;i++){if(Number(await sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted"))>0)break;await delay(10);}
const denied=work(row.id,row.revision,'registration','RESUME').then(()=>false,e=>e.code==='42501');
for(let i=0;i<100;i++){if(Number(await sql("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted"))>0)break;await delay(10);}
await sql("UPDATE organization_members SET status='INACTIVE' WHERE user_id="+literal(actor));await holder;check(await denied);await sql("UPDATE organization_members SET status='ACTIVE' WHERE user_id="+literal(actor));
// Complete actual stages before racing closure and reopening.
const note='Conferência dos documentos e regras pelo Consultor no laboratório.';
for(const stage of ['registration','invoices','feasibility','modality','contracts','technical','metering','custody','contract-registration','termination','validation','supply']){
 row=(await work(row.id,row.revision,stage,stage==='registration'?'RESUME':'START')).admission;
 let docs=[await doc('lab-'+stage)];if(stage==='invoices'){docs=[];for(let i=0;i<12;i++)docs.push(await doc('lab-invoice-'+i,'INVOICE_DISTRIBUTOR',new Date(Date.UTC(2025,9+i,1)).toISOString().slice(0,10)));}
 if(stage==='contracts')docs=[await doc('lab-energy','CONTRACT_ENERGY'),await doc('lab-management','CONTRACT_MANAGEMENT')];
 const facts=stage==='modality'?{modality:'RETAIL'}:stage==='supply'?{supplyDate:'2026-12-01'}:{};
 const ev=await evidence(row.id,row.revision,'SUBMIT',{stage,documents:docs,kind:'COMPLETE',facts,note});row=ev.admission;
 if(stage==='registration'){
  results=await race([()=>evidence(row.id,row.revision,'APPROVE',{evidence:ev.evidenceId,note}),()=>evidence(row.id,row.revision,'APPROVE',{evidence:ev.evidenceId,note,actor:peer})]);
  check(results.filter(r=>r.ok).length===1&&results.some(r=>r.code==='CONFLICT'));row=results.find(r=>r.ok).admission;
  const completionRequest=randomUUID();results=await race([()=>evidence(row.id,row.revision,'COMPLETE',{evidence:ev.evidenceId,request:completionRequest}),()=>evidence(row.id,row.revision,'COMPLETE',{evidence:ev.evidenceId,request:completionRequest})]);
  check(results.every(r=>r.ok)&&results.filter(r=>r.replayed).length===1);row=results[0].admission;
 }else{
  row=(await evidence(row.id,row.revision,'APPROVE',{evidence:ev.evidenceId,note,actor:peer})).admission;
  row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:ev.evidenceId})).admission;
 }
}
const close=who=>call('acl_closure_command',['o1',who,'r1',false,row.id,randomUUID(),row.revision,'CLOSE',true,null,null]);
results=await race([()=>close(actor),()=>close(peer)]);check(results.filter(r=>r.ok).length===1&&results.some(r=>r.code==='CONFLICT'));row=results.find(r=>r.ok).admission;
check(Number(await sql('SELECT count(*) FROM acl_admission_performance_versions'))===1);
const performance=results.find(r=>r.ok).closure.performance;
const publish=who=>call('acl_closure_command',['o1',who,'r1',false,row.id,randomUUID(),row.revision,'PUBLISH',true,note,performance.hash]);
results=await race([()=>publish(actor),()=>publish(peer)]);check(results.filter(r=>r.ok).length===1&&results.some(r=>r.code==='LOCKED'));
check(Number(await sql('SELECT count(*) FROM acl_admission_public_summaries'))===1);
const reopen=who=>call('acl_reopen',['o1',who,'r1',false,row.id,randomUUID(),row.revision,note,true]);
results=await race([()=>reopen(actor),()=>reopen(peer)]);check(results.filter(r=>r.ok).length===1&&results.some(r=>r.code==='LOCKED'));
check(Number(await sql("SELECT count(*) FROM acl_admissions WHERE status<>'COMPLETED'"))===1);
const portal=await call('acl_portal',['o1',client,'client',null]);check(portal.length===1&&portal[0].status==='IN_PROGRESS'&&!portal[0].summary);
// Reopened process: one invoice replaces twelve documents only with reviewed history.
row=results.find(r=>r.ok).admission;
const registrationSource=await doc('history-registration');
row=(await work(row.id,row.revision,'registration','START')).admission;
let ev=await evidence(row.id,row.revision,'SUBMIT',{stage:'registration',documents:[registrationSource],facts:{},kind:'COMPLETE',note});row=ev.admission;
row=(await evidence(row.id,row.revision,'APPROVE',{evidence:ev.evidenceId,note,actor:peer})).admission;
row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:ev.evidenceId})).admission;
const historySource=await doc('history-single','INVOICE_DISTRIBUTOR','2026-08-01');
const historyRows=Array.from({length:12},(_,i)=>({month:new Date(Date.UTC(2025,8+i,1)).toISOString().slice(0,7),peakKwh:'100',offPeakKwh:'1000',demandKw:'250',days:30,page:2,source:'tables[0]'}));
row=(await work(row.id,row.revision,'invoices','START')).admission;
ev=await evidence(row.id,row.revision,'SUBMIT',{stage:'invoices',documents:[historySource],facts:{history:{sourceDocumentId:historySource,rows:historyRows}},kind:'COMPLETE',note});check(ev.ok);row=ev.admission;
row=(await evidence(row.id,row.revision,'APPROVE',{evidence:ev.evidenceId,note,actor:peer})).admission;
const historyRequest=randomUUID();results=await race([()=>evidence(row.id,row.revision,'COMPLETE',{evidence:ev.evidenceId,request:historyRequest}),()=>evidence(row.id,row.revision,'COMPLETE',{evidence:ev.evidenceId,request:historyRequest})]);
check(results.every(r=>r.ok)&&results.filter(r=>r.replayed).length===1);row=results[0].admission;
check(row.stages.find(r=>r.key==='invoices').status==='COMPLETED');
const simulation=()=>call('acl_history_simulation_source',['o1',actor,'r1',false,row.id,ev.evidenceId]);
check((await simulation()).history.rows.length===12);
await assert.rejects(()=>call('acl_history_simulation_source',['o2',actor,'r1',false,row.id,ev.evidenceId]));checks++;
await sql("UPDATE documents SET file_hash=repeat('f',64) WHERE id='history-single'");await assert.rejects(simulation);checks++;
check((await db.query("SELECT NOT has_function_privilege('authenticated','acl_history_simulation_source(text,text,text,boolean,uuid,uuid)','EXECUTE') AS denied")).rows[0].denied);
console.log(JSON.stringify({ok:true,checks,engine:'PostgreSQL 17',isolated:true}));
