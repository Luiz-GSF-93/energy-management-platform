// Disposable synthetic database only. No application secrets or external service calls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let PGlite;
if(process.env.CALCULATION_AUTOFILL_TEST_PG_PORT){
 if(process.env.CALCULATION_AUTOFILL_TEST_PG_PORT!=='55484')throw Error('Disposable loopback port required');
 const {Pool,types}=require('pg');types.setTypeParser(20,Number);
 PGlite=class{constructor(){this.pool=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'postgres',max:4})}exec(sql){return this.pool.query(sql)}query(sql,args){return this.pool.query(sql,args)}close(){return this.pool.end()}};
}else PGlite=require('@electric-sql/pglite').PGlite;
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=x=>{assert(x);checks++};
const deny=async(fn,codes)=>{try{await fn()}catch(e){if(codes)assert([].concat(codes).includes(e.code),e.code+': '+e.message);checks++;return}throw Error('Expected rejection')};
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE organizations(id text PRIMARY KEY,deleted_at timestamptz);
 CREATE TABLE customers(id text PRIMARY KEY,organization_id text,deleted_at timestamptz,status text);
 CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text,status text);
 CREATE TABLE documents(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,document_type text,reference_month date,file_verified boolean,file_hash text);
 CREATE TABLE licenses(organization_id text,active boolean,status text,start_date date,end_date date,free_market_management boolean,document_management boolean);
 CREATE TABLE roles(id text PRIMARY KEY,organization_id text,scope text,name text,permissions jsonb);
 CREATE TABLE organization_members(organization_id text,user_id text,role_id text,status text,exclusive_customer_id text,affiliation_type text);
 CREATE TABLE platform_organization_sessions(organization_id text,user_id text,expires_at timestamptz,revoked_at timestamptz);
 CREATE FUNCTION assert_license_platform_actor(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF $1::text<>'${id(99)}' THEN RAISE EXCEPTION 'not Owner' USING ERRCODE='42501';END IF;END$$;
 INSERT INTO organizations VALUES('org',null),('other',null);
 INSERT INTO customers VALUES('customer','org',null,'ACTIVE'),('other-customer','other',null,'ACTIVE');
 INSERT INTO consumer_units VALUES('${id(1)}','org','customer','ACTIVE'),('${id(11)}','other','other-customer','ACTIVE');
 INSERT INTO documents VALUES('${id(2)}','org','customer','${id(1)}','INVOICE_DISTRIBUTOR','2026-08-01',true,'${'a'.repeat(64)}');
 INSERT INTO licenses VALUES('org',true,'active','2020-01-01','2099-01-01',true,true),('other',true,'active','2020-01-01','2099-01-01',true,true);
 INSERT INTO roles VALUES('operator','org','organization','operacional','["8f105b02-4443-49de-b188-847e0284e7ed","60f9690a-145b-4dba-b23f-9f945baca296","92e1b670-ab10-483a-b825-c6e16799496d","fd8a932f-87c0-4f86-8389-9f30c50e95b7"]'),('viewer','org','organization','gestor','["8f105b02-4443-49de-b188-847e0284e7ed","60f9690a-145b-4dba-b23f-9f945baca296"]'),('client','org','organization','cliente','["8f105b02-4443-49de-b188-847e0284e7ed","60f9690a-145b-4dba-b23f-9f945baca296"]');
 INSERT INTO organization_members VALUES('org','${id(20)}','operator','ACTIVE',null,'internal'),('org','${id(21)}','viewer','ACTIVE',null,'internal'),('org','${id(22)}','client','ACTIVE',null,'internal'),('org','${id(23)}','operator','ACTIVE','forbidden-customer','external');`);
 const existing=await db.query(`SELECT (SELECT count(*) FROM documents) docs,(SELECT count(*) FROM consumer_units) units,(SELECT count(*) FROM roles) roles`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261109_calculation_autofill.sql'),'utf8'));
 assert.deepEqual((await db.query(`SELECT (SELECT count(*) FROM documents) docs,(SELECT count(*) FROM consumer_units) units,(SELECT count(*) FROM roles) roles`)).rows,existing.rows);ok(true);
 for(const t of ['calculation_preparation_runs','calculation_preparation_run_events']){
  const flags=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[t])).rows[0];ok(flags.relrowsecurity&&flags.relforcerowsecurity);
  for(const role of ['anon','authenticated','service_role'])for(const permission of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) p',[role,t,permission])).rows[0].p);
 }
 for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'calculation_autofill_action(text,text,text,boolean,text,text,text,uuid,jsonb)','EXECUTE') p",[role])).rows[0].p);
 const action=(a,run,body,patch={})=>db.query('SELECT calculation_autofill_action($1,$2,$3,$4,$5,$6,$7,$8,$9) data',[patch.org??'org',patch.actor??id(20),patch.role??'operator',patch.platform??false,a,patch.unit??id(1),patch.month??'2026-08',run,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const plan={manualOverrides:{fixedFee:'900.00'},manualAuthor:id(20),percent:100,total:1,filled:1,pending:0,readyForValidation:true,fields:[{key:'consumption',value:'1000',source:'Synthetic PDF only',state:'FILLED'}],canPublish:false};
 const input={basis:'b'.repeat(64),documentId:id(2),sourceHash:'a'.repeat(64),plan};
 ok((await action('access',null,{})).allowed);ok((await action('history',null,{page:0})).total===0);
 for(const patch of [{actor:id(22),role:'client'},{actor:id(23)},{org:'other'},{unit:id(11)},{actor:id(50)},{platform:true,actor:id(99)}])await deny(()=>action('reserve',id(30),input,patch),'42501');
 await deny(()=>action('reserve',id(30),input,{actor:id(21),role:'viewer'}),'42501');ok((await action('access',null,{},{actor:id(21),role:'viewer'})).allowed);
 for(const body of [{page:-1},{page:0,organizationId:'other'},{page:0.5},{page:'0'},{}])await deny(()=>action('history',null,body),'22023');
 for(const change of [{documentId:id(999)},{sourceHash:'f'.repeat(64)},{documentId:id(11)}])await deny(()=>action('reserve',id(30),{...input,...change}),'40001');
 for(const change of [{amount:'0'},{plan:{...plan,canPublish:true}},{basis:'wrong'},{plan:{...plan,fields:[]}},{basis:null},{plan:{...plan,percent:101}},{plan:{...plan,pending:1}},{plan:{...plan,fields:[{key:'consumption',value:null,source:'',state:'FILLED'}]}}])await deny(()=>action('reserve',id(30),{...input,...change}),'22023');
 const reserved=await action('reserve',id(30),input);ok(reserved.acquired);ok(reserved.run.plan.percent===100);ok(reserved.run.state==='RUNNING');
 const otherAttempt=await action('reserve',id(31),input);ok(!otherAttempt.acquired);ok(otherAttempt.run.id===id(30));
 await deny(()=>action('reserve',id(30),{...input,basis:'c'.repeat(64)}),'23505');
 await deny(()=>action('finish',id(30),{status:'PREPARED',receipts:[]},{actor:id(21),role:'viewer'}),'42501');
 const result={status:'PARTIAL',receipts:[{label:'Synthetic draft saved',state:'SAVED_DRAFT'},{label:'Uncertain second step',state:'VERIFY_REQUIRED'}]};
 ok((await action('finish',id(30),result)).state==='PARTIAL');ok((await action('finish',id(30),result)).state==='PARTIAL');
 await deny(()=>action('finish',id(30),{status:'PREPARED',receipts:[]}),'23505');
 const history=await action('history',null,{page:0});ok(history.total===1&&history.rows.length===1);ok(history.rows[0].events.length===2&&history.rows[0].events[1].receipts.length===2);ok((await action('history',null,{page:1})).rows.length===0);
 await db.exec('SET ROLE service_role');const scopedHistory=await action('history',null,{page:0});await db.exec('RESET ROLE');ok(scopedHistory.rows[0].plan.manualOverrides.fixedFee==='900.00'&&scopedHistory.rows[0].plan.manualAuthor===id(20));ok(scopedHistory.rows[0].organization_id==='org'&&scopedHistory.rows[0].document_id===id(2)&&scopedHistory.rows[0].source_hash==='a'.repeat(64));
 await deny(()=>db.query('UPDATE calculation_preparation_runs SET plan=$1 WHERE id=$2',[JSON.stringify({}),id(30)]),'23514');await deny(()=>db.exec('DELETE FROM calculation_preparation_run_events'),'23514');
 await db.exec(`UPDATE organization_members SET status='INACTIVE' WHERE user_id='${id(20)}'`);await deny(()=>action('history',null,{page:0}),'42501');await db.exec(`UPDATE organization_members SET status='ACTIVE' WHERE user_id='${id(20)}'`);
 await db.exec(`UPDATE licenses SET document_management=false WHERE organization_id='org'`);await deny(()=>action('reserve',id(32),input),'42501');await db.exec(`UPDATE licenses SET document_management=true WHERE organization_id='org'`);
 await db.exec(`INSERT INTO platform_organization_sessions VALUES('org','${id(99)}',now()+interval '1 hour',null)`);ok((await action('access',null,{},{actor:id(99),role:'global-owner',platform:true})).allowed);
 await db.exec(`INSERT INTO documents SELECT '${id(3)}',organization_id,customer_id,consumer_unit_id,document_type,reference_month,file_verified,file_hash FROM documents WHERE id='${id(2)}'`);await deny(()=>action('reserve',id(32),{...input,basis:'d'.repeat(64)}),'40001');
 await db.exec(`DELETE FROM documents WHERE id='${id(3)}'`);
 if(process.env.CALCULATION_AUTOFILL_TEST_PG_PORT){const race=await Promise.all([action('reserve',id(40),{...input,basis:'e'.repeat(64)}),action('reserve',id(41),{...input,basis:'e'.repeat(64)})]);ok(race.filter(r=>r.acquired).length===1);ok(race[0].run.id===race[1].run.id);}
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261211_preparation_reconciliation.sql'),'utf8'));
 await db.exec(`INSERT INTO roles VALUES('admin','org','organization','admin_org','["8f105b02-4443-49de-b188-847e0284e7ed","60f9690a-145b-4dba-b23f-9f945baca296","92e1b670-ab10-483a-b825-c6e16799496d","beb6ec90-8ba8-40ce-a156-aeef6cc75cce"]');INSERT INTO organization_members VALUES('org','${id(24)}','admin','ACTIVE',null,'internal');`);
 const proof={basis:'8'.repeat(64),currentBasis:'9'.repeat(64),sourceHash:'a'.repeat(64),note:'Backend replaced; original execution interrupted; sources checked.'};
 const recover=(run=id(60),body=proof,patch={})=>db.query('SELECT calculation_autofill_reconcile($1,$2,$3,$4,$5,$6,$7,$8) data',[patch.org??'org',patch.actor??id(24),patch.role??'admin',patch.platform??false,patch.unit??id(1),'2026-08',run,JSON.stringify(body)]).then(r=>r.rows[0].data);
 // Separate statements also work on the real PostgreSQL driver.
 const seedOld=async(n,age,manual={})=>{await db.query(`INSERT INTO calculation_preparation_runs(id,organization_id,customer_id,consumer_unit_id,month,document_id,source_hash,source_basis,plan,actor_id,created_at) VALUES($1,'org','customer',$2,'2026-08',$3,$4,$5,$6,$7,clock_timestamp()-$8::interval)`,[id(n),id(1),id(2),'a'.repeat(64),proof.basis.slice(0,62)+String(n),JSON.stringify({...plan,manualOverrides:manual}),id(20),age]);await db.query(`INSERT INTO calculation_preparation_run_events(run_id,organization_id,sequence,state,actor_id,receipts) VALUES($1,'org',1,'RUNNING',$2,'[]')`,[id(n),id(20)]);};
 await seedOld(60,'1 hour');proof.basis=proof.basis.slice(0,62)+'60';
 for(const patch of [{actor:id(20),role:'operator'},{actor:id(21),role:'viewer'},{org:'other'},{unit:id(11)}])await deny(()=>recover(id(60),proof,patch),'42501');
 for(const body of [{...proof,note:'short'},{...proof,extra:true},{...proof,currentBasis:null}])await deny(()=>recover(id(60),body),'22023');
 await deny(()=>recover(id(60),{...proof,sourceHash:'f'.repeat(64)}),'40001');
 await seedOld(61,'1 minute');await deny(()=>recover(id(61),{...proof,basis:proof.basis.slice(0,62)+'61'}),'40001');
 await seedOld(62,'1 hour',{fixedFee:'100'});await deny(()=>recover(id(62),{...proof,basis:proof.basis.slice(0,62)+'62'}),'40001');
 ok((await recover()).state==='PARTIAL');ok((await recover()).state==='PARTIAL');
 await deny(()=>recover(id(60),{...proof,note:proof.note+' changed'}),'23505');
 const audit=(await db.query('SELECT r.actor_id original,e.actor_id reviewer,e.state,e.receipts FROM calculation_preparation_runs r JOIN calculation_preparation_run_events e ON e.run_id=r.id AND e.sequence=2 WHERE r.id=$1',[id(60)])).rows[0];
 ok(audit.original===id(20)&&audit.reviewer===id(24)&&audit.state==='PARTIAL'&&audit.receipts[0].originalActor===id(20)&&audit.receipts[0].currentBasis===proof.currentBasis);
 await seedOld(63,'1 hour');const concurrentProof={...proof,basis:proof.basis.slice(0,62)+'63'};
 const reconciled=await Promise.all([recover(id(63),concurrentProof),recover(id(63),concurrentProof)]);ok(reconciled.every(x=>x.state==='PARTIAL'));ok((await db.query('SELECT count(*) n FROM calculation_preparation_run_events WHERE run_id=$1',[id(63)])).rows[0].n===2);
 await seedOld(64,'1 hour');await action('finish',id(64),{status:'PREPARED',receipts:[]});await deny(()=>recover(id(64),{...proof,basis:proof.basis.slice(0,62)+'64'}),'23505');
 for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'calculation_autofill_reconcile(text,text,text,boolean,text,text,uuid,jsonb)','EXECUTE') p",[role])).rows[0].p);
 // New invoice attention uses the same tenant/source gate and immutable private audit.
 await db.exec(`ALTER TABLE documents ADD COLUMN original_filename text DEFAULT 'synthetic.pdf',ADD COLUMN created_at timestamptz DEFAULT now();ALTER TABLE customers ADD COLUMN company_name text DEFAULT 'Synthetic';ALTER TABLE consumer_units ADD COLUMN name text DEFAULT 'Synthetic unit';CREATE TABLE portal_document_intakes(id uuid DEFAULT gen_random_uuid(),document_id text,organization_id text,file_hash text,kind text,created_at timestamptz DEFAULT now());CREATE TABLE portal_document_events(intake_id uuid,event_key text);CREATE TABLE document_ocr_jobs(id uuid DEFAULT gen_random_uuid(),organization_id text,document_id text,state text,created_at timestamptz DEFAULT now());CREATE TABLE operation_records(id uuid,organization_id text,kind text,document_id text,consumer_unit_id text,customer_id text,created_by text,status text);INSERT INTO portal_document_intakes(document_id,organization_id,file_hash,kind) VALUES('${id(2)}','org','${'a'.repeat(64)}','INVOICE');INSERT INTO document_ocr_jobs(organization_id,document_id,state) VALUES('org','${id(2)}','SUCCEEDED');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261214_eva_invoice_attention.sql'),'utf8'));
 const attention=(act='list',document=null,body={},patch={})=>db.query('SELECT eva_invoice_attention($1,$2,$3,$4,$5,$6,$7) data',[patch.org??'org',patch.actor??id(20),patch.role??'operator',patch.platform??false,act,document,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const decision={requestId:id(80),state:'DEFERRED',sourceHash:'a'.repeat(64),note:'Resume with current sources later',agendaId:null};
 ok((await attention()).rows[0].documentId===id(2));ok((await attention()).rows[0].ocrState==='SUCCEEDED');ok((await attention('list',null,{},{org:'other'})).rows.length===0);ok((await attention('list',null,{},{actor:id(22),role:'client'})).rows.length===0);
 await deny(()=>attention('record',id(2),{...decision,sourceHash:'f'.repeat(64)}),'40001');await deny(()=>attention('record',id(2),decision,{org:'other'}),'42501');
 const twice=await Promise.all([attention('record',id(2),decision),attention('record',id(2),decision)]);ok(twice.every(r=>r.recorded&&r.state==='DEFERRED'));ok((await db.query('SELECT count(*) n FROM eva_invoice_attention_events')).rows[0].n===1);
 await deny(()=>attention('record',id(2),{...decision,state:'OPENED'}),'23505');
 const schedule={...decision,requestId:id(81),state:'SCHEDULED',agendaId:id(85)};await deny(()=>attention('record',id(2),schedule),'42501');
 await db.query(`INSERT INTO operation_records VALUES($1,'org','agenda',$2,$3,'customer',$4,'OPEN')`,[id(85),id(2),id(1),id(20)]);ok((await attention('record',id(2),schedule)).agendaId===id(85));ok((await attention()).rows[0].state==='SCHEDULED');
 await deny(()=>db.exec('DELETE FROM eva_invoice_attention_events'),'23514');
 for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) p',[role,'eva_invoice_attention_events',privilege])).rows[0].p);
 for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_invoice_attention(text,text,text,boolean,text,text,jsonb)','EXECUTE') p",[role])).rows[0].p);
 // Completion is derived from an active published version, never from month alone.
 await db.exec(`CREATE TABLE eva_assisted_closing_versions(id uuid,organization_id text,customer_id text,month text,payload_hash text,report jsonb);
 CREATE TABLE eva_closing_publications(id uuid,organization_id text,customer_id text,closing_id uuid,source_hash text,projection jsonb);
 CREATE TABLE eva_assisted_closing_events(organization_id text,closing_id uuid,sequence integer,state text);
 CREATE TABLE eva_closing_publication_events(organization_id text,publication_id uuid,sequence integer,state text);`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261218_eva_invoice_attention_publications.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261218_eva_invoice_attention_publications.sql'),'utf8')); // Idempotent rollout preserves completion history.
 ok((await attention()).rows.length===1);
 const report={units:[{id:id(1),documentId:id(2),sourceHash:'a'.repeat(64)}]};
 const projection={organizationId:'org',customerId:'customer',month:'2026-08',sourceHash:'c'.repeat(64)};
 await db.query(`INSERT INTO eva_assisted_closing_versions VALUES($1,'org','customer','2026-08',$2,$3)`,[id(90),'c'.repeat(64),JSON.stringify(report)]);
 await db.query(`INSERT INTO eva_closing_publications VALUES($1,'org','customer',$2,$3,$4)`,[id(91),id(90),'c'.repeat(64),JSON.stringify(projection)]);
 await db.query(`INSERT INTO eva_assisted_closing_events VALUES('org',$1,1,'APPROVED');`,[id(90)]);
 await db.query(`INSERT INTO eva_closing_publication_events VALUES('org',$1,1,'PUBLISHED');`,[id(91)]);
 ok((await attention()).rows.length===0);
 await deny(()=>attention('record',id(2),{...decision,requestId:id(82),state:'OPENED'}),'42501');
 // Preserve the source and previous user decisions; only the pending view changes.
 ok((await db.query('SELECT count(*) n FROM eva_invoice_attention_events')).rows[0].n===2);
 ok((await db.query('SELECT count(*) n FROM documents')).rows[0].n===1);
 for(const changed of [
  {units:[{...report.units[0],id:id(11)}]},
  {units:[{...report.units[0],documentId:id(3)}]},
  {units:[{...report.units[0],sourceHash:'f'.repeat(64)}]},
  {units:[]},{units:{}},
 ]){
  await db.query('UPDATE eva_assisted_closing_versions SET report=$1',[JSON.stringify(changed)]);
  ok((await attention()).rows.length===1);
 }
 await db.query('UPDATE eva_assisted_closing_versions SET report=$1',[JSON.stringify(report)]);
 for(const changed of [{...projection,organizationId:'other'},{...projection,customerId:'other-customer'},{...projection,month:'2026-09'},{...projection,sourceHash:'f'.repeat(64)}]){
  await db.query('UPDATE eva_closing_publications SET projection=$1',[JSON.stringify(changed)]);
  ok((await attention()).rows.length===1);
 }
 await db.query('UPDATE eva_closing_publications SET projection=$1',[JSON.stringify(projection)]);
 for(const mutation of [
  "UPDATE eva_closing_publications SET organization_id='other'",
  "UPDATE eva_closing_publications SET customer_id='other-customer'",
  "UPDATE eva_closing_publications SET source_hash=repeat('f',64)",
  "UPDATE eva_assisted_closing_versions SET month='2026-09'",
  "UPDATE eva_assisted_closing_events SET state='READY_FOR_REVIEW'",
 ]){
  await db.exec('BEGIN');await db.exec(mutation);ok((await attention()).rows.length===1);await db.exec('ROLLBACK');
 }
 await db.query("INSERT INTO eva_closing_publication_events VALUES('org',$1,2,'WITHDRAWN')",[id(91)]);
 ok((await attention()).rows.length===1);
 await db.query("INSERT INTO eva_closing_publication_events VALUES('org',$1,3,'PUBLISHED')",[id(91)]);
 ok((await attention()).rows.length===0);
 // A distinct upload in the same period is still pending, even with identical bytes.
 await db.query(`INSERT INTO documents SELECT $1,organization_id,customer_id,consumer_unit_id,document_type,reference_month,file_verified,file_hash,'new-upload.pdf',now() FROM documents WHERE id=$2`,[id(3),id(2)]);
 await db.query(`INSERT INTO portal_document_intakes(document_id,organization_id,file_hash,kind) VALUES($1,'org',$2,'INVOICE')`,[id(3),'a'.repeat(64)]);
 ok((await attention()).rows.length===1&&(await attention()).rows[0].documentId===id(3));
 await db.query('UPDATE documents SET file_hash=$1 WHERE id=$2',['b'.repeat(64),id(2)]);
 await db.query(`INSERT INTO portal_document_intakes(document_id,organization_id,file_hash,kind) VALUES($1,'org',$2,'INVOICE')`,[id(2),'b'.repeat(64)]);
 ok((await attention()).rows.length===2);
 // Approved administrative reconciliation of final UNKNOWN, without changing original events.
 await db.exec(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT '2000-01-01', ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT '2000-01-01';
 CREATE TABLE calculation_parameters(id text,organization_id text,consumer_unit_id text,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE calculation_monthly_inputs(id text,organization_id text,consumer_unit_id text,month text,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE calculation_monthly_costs(id text,organization_id text,consumer_unit_id text,month text,created_at timestamptz,updated_at timestamptz);
 CREATE FUNCTION capture_eva_assisted_closing_sources(p_org text,p_customer text,p_month text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE result jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('id',r.id,'state',(SELECT state FROM public.calculation_preparation_run_events WHERE run_id=r.id ORDER BY sequence DESC LIMIT 1))) INTO result FROM public.calculation_preparation_runs r WHERE organization_id=p_org AND customer_id=p_customer AND month=p_month;
 RETURN jsonb_build_object('commercial',result);END$$;
 UPDATE documents SET file_hash='${'a'.repeat(64)}',created_at='2000-01-01',updated_at='2000-01-01' WHERE id='${id(2)}';DELETE FROM documents WHERE id='${id(3)}';`);
 const migration=fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261219_unknown_preparation_reconciliation.sql'),'utf8');await db.exec(migration);await db.exec(migration);
 const unknown=async(n,receipts=[{label:'Etapa não confirmada; consultar histórico',state:'VERIFY_REQUIRED'}],manual={fixedFee:'123.45'})=>{await seedOld(n,'0 seconds',manual);await db.query(`INSERT INTO calculation_preparation_run_events(run_id,organization_id,sequence,state,actor_id,receipts) VALUES($1,'org',2,'UNKNOWN',$2,$3)`,[id(n),id(20),JSON.stringify(receipts)]);return {...proof,basis:proof.basis.slice(0,62)+String(n)};};
 const u70=await unknown(70);
 for(const patch of [{actor:id(20),role:'operator'},{actor:id(21),role:'viewer'},{org:'other'},{unit:id(11)}])await deny(()=>recover(id(70),u70,patch),'42501');
 await deny(()=>recover(id(70),{...u70,note:'short'}),'22023');await deny(()=>recover(id(70),{...u70,sourceHash:'f'.repeat(64)}),'40001');
 const eventsBefore=JSON.stringify((await db.query('SELECT * FROM calculation_preparation_run_events WHERE run_id=$1 ORDER BY sequence',[id(70)])).rows);
 ok((await recover(id(70),u70)).state==='PARTIAL');ok((await recover(id(70),u70)).replayed===true);
 ok((await action('history',null,{page:0})).rows.find(r=>r.id===id(70)).state==='PARTIAL');
 ok((await action('reserve',id(79),{...input,basis:u70.basis})).run.state==='PARTIAL');
 ok(JSON.stringify((await db.query('SELECT * FROM calculation_preparation_run_events WHERE run_id=$1 ORDER BY sequence',[id(70)])).rows)===eventsBefore);
 const aud=(await db.query('SELECT * FROM calculation_preparation_reconciliations WHERE run_id=$1',[id(70)])).rows[0];ok(aud.original_state==='UNKNOWN'&&aud.effective_state==='PARTIAL'&&aud.manual_snapshot.fixedFee==='123.45'&&aud.actor_id===id(24));
 ok((await db.query(`SELECT capture_eva_assisted_closing_sources('org','customer','2026-08') data`)).rows[0].data.commercial.find(r=>r.id===id(70)).state==='PARTIAL');
 await deny(()=>db.query('UPDATE calculation_preparation_reconciliations SET note=note WHERE run_id=$1',[id(70)]),'23514');await deny(()=>db.query('DELETE FROM calculation_preparation_reconciliations WHERE run_id=$1',[id(70)]),'23514');
 await deny(()=>recover(id(70),{...u70,note:u70.note+' changed'}),'23505');
 const u71=await unknown(71);await db.exec(`INSERT INTO calculation_monthly_inputs VALUES('changed','org','${id(1)}','2026-08',clock_timestamp(),clock_timestamp())`);await deny(()=>recover(id(71),u71),'40001');await db.exec(`DELETE FROM calculation_monthly_inputs`);
 const u72=await unknown(72,[{label:'write','state':'SAVED_DRAFT',id:id(77)},{label:'lost','state':'VERIFY_REQUIRED'}]);await deny(()=>recover(id(72),u72),'40001');
 const u73=await unknown(73);await db.query('UPDATE documents SET file_hash=$1 WHERE id=$2',['c'.repeat(64),id(2)]);await deny(()=>recover(id(73),u73),'40001');await db.query('UPDATE documents SET file_hash=$1 WHERE id=$2',['a'.repeat(64),id(2)]);
 const u74=await unknown(74);await deny(()=>recover(id(73),u73),'40001');const raceAudit=await Promise.all([recover(id(74),u74),recover(id(74),u74)]);ok(raceAudit.every(r=>r.state==='PARTIAL'));ok((await db.query('SELECT count(*) n FROM calculation_preparation_reconciliations WHERE run_id=$1',[id(74)])).rows[0].n===1);
 const u75=await unknown(75,[{label:'Missing state'}]);await deny(()=>recover(id(75),u75),'40001');
 const u76=await unknown(76,[null]);await deny(()=>recover(id(76),u76),'40001');
 await db.query(`INSERT INTO documents(id,organization_id,customer_id,consumer_unit_id,document_type,reference_month,file_verified,file_hash,created_at,updated_at) VALUES($1,'org','customer',$2,'INVOICE_SUPPLIER','2026-08-01',true,$3,'2000-01-01','2000-01-01'),($4,'org','customer',$2,'INVOICE_SUPPLIER','2026-08-01',true,$5,'2000-01-01','2000-01-01')`,[id(4),id(1),'b'.repeat(64),id(5),'c'.repeat(64)]);
 const u77=await unknown(77,undefined,{supplierSettlement:{documentId:id(4),fileHash:'b'.repeat(64),regularInvoice:{source:'Verified NF '+id(5)+' SHA-256 '+'c'.repeat(64)}}});
 await db.query('UPDATE documents SET file_hash=$1 WHERE id=$2',['d'.repeat(64),id(4)]);await deny(()=>recover(id(77),u77),'40001');await db.query('UPDATE documents SET file_hash=$1 WHERE id=$2',['b'.repeat(64),id(4)]);
 await db.query('UPDATE documents SET file_hash=$1 WHERE id=$2',['d'.repeat(64),id(5)]);await deny(()=>recover(id(77),u77),'40001');await db.query('UPDATE documents SET file_hash=$1 WHERE id=$2',['c'.repeat(64),id(5)]);
 ok((await recover(id(77),u77)).state==='PARTIAL');
 for(const role of ['anon','authenticated','service_role'])ok(!(await db.query("SELECT has_table_privilege($1,'calculation_preparation_reconciliations','SELECT') p",[role])).rows[0].p);
 for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'calculation_autofill_reconcile(text,text,text,boolean,text,text,uuid,jsonb)','EXECUTE') p",[role])).rows[0].p);
 console.log(JSON.stringify({result:'PASS',checks,privateTables:4,financialRecordsWritten:0,externalCalls:0}));
}finally{await db.close();}})().catch(e=>{console.error({code:e.code,message:e.message});process.exitCode=1});
