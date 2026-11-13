// Disposable database. No provider, production credentials or financial values.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=v=>{assert(v);checks++;},deny=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};try{
 await require('./eva-manual-preparation-fixture.cjs')(db);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261319_eva_owner_manual_queue.sql'),'utf8'));
 // Only supplies the administration signature for timeout metadata; the real
 // administration/source/tenant behavior remains covered by eva-automatic-intake.
 await db.exec("CREATE FUNCTION eva_intake_administration(text,text,text,boolean,text,uuid,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RETURN '{}'::jsonb;END$$");
 const migration=fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261320_eva_continuation_conflicts.sql'),'utf8');
 await db.exec(migration);await db.exec(migration);
 const action=(name,job=null,body={},unit=id(1),actor=id(20),role='operator')=>db.query('SELECT eva_manual_preparation_action($1,$2,$3,$4,$5,$6,$7,$8,$9) data',['org',actor,role,name,unit,'2026-08','UNIT',job,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const work=(name,c={},body={})=>db.query('SELECT eva_manual_preparation_worker($1,$2,$3,$4) data',[name,c.id??null,c.token??null,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const first=await action('request',id(100));ok(first.job.state==='QUEUED');
 for(let n=0;n<100;n++)await deny(()=>action('request',id(100),{},id(3)),'PT409');
 ok(Number((await db.query('SELECT count(*) n FROM eva_manual_preparations')).rows[0].n)===1);
 const claim=await work('claim');ok(claim.id===id(100));
 await deny(()=>work('context',{...claim,token:id(999)}),'PT409');
 ok((await work('begin',claim)).accepted);await deny(()=>work('begin',claim),'PT409');
 await deny(()=>work('finish',claim,{state:'FAILED',code:'SYNTHETIC'}),'PT409');
 ok((await work('finish',claim,{state:'UNKNOWN',code:'WRITE_ACK_PENDING'})).state==='UNKNOWN');
 await deny(()=>action('reconcile',claim.id,{reason:'Synthetic confirmation with preserved financial history.',confirmed:true}),'42501');
 await db.exec(`INSERT INTO calculation_preparation_runs(id,organization_id,customer_id,consumer_unit_id,month,document_id,source_hash,source_basis,plan,actor_id) VALUES('${id(500)}','org','customer','${id(1)}','2026-08','${id(2)}','${'a'.repeat(64)}','${'b'.repeat(64)}','{}','${id(20)}');INSERT INTO calculation_preparation_run_events(run_id,organization_id,sequence,state,actor_id,receipts) VALUES('${id(500)}','org',1,'RUNNING','${id(20)}','[]')`);
 await deny(()=>action('reconcile',claim.id,{reason:'Synthetic confirmation with preserved financial history.',confirmed:true},id(1),id(24),'admin'),'PT409');
 ok((await action('status',claim.id)).job.state==='UNKNOWN');
 await deny(()=>db.exec("DO $$BEGIN RAISE SQLSTATE '40001' USING MESSAGE='synthetic genuine engine serialization';END$$"),'40001');
 const config=(await db.query("SELECT proconfig FROM pg_proc WHERE oid='eva_intake_administration(text,text,text,boolean,text,uuid,jsonb)'::regprocedure")).rows[0].proconfig;
 ok(config.includes('statement_timeout=8s')&&config.includes('lock_timeout=2s'));
 ok(!(await db.query("SELECT pg_get_functiondef('eva_manual_preparation_action_context(text,boolean,text,text,text,text,text,text,uuid,jsonb)'::regprocedure) d")).rows[0].d.includes("ERRCODE='40001'"));
 console.log(JSON.stringify({suite:'eva-continuation-domain-conflicts',checks,domainConflict:'PT409',engineSerialization:'40001',financialUncertainty:'preserved',externalCalls:0}));
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
