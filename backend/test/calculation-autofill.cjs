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
 const plan={percent:100,total:1,filled:1,pending:0,readyForValidation:true,fields:[{key:'consumption',value:'1000',source:'Synthetic PDF only',state:'FILLED'}],canPublish:false};
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
 await deny(()=>db.query('UPDATE calculation_preparation_runs SET plan=$1 WHERE id=$2',[JSON.stringify({}),id(30)]),'23514');await deny(()=>db.exec('DELETE FROM calculation_preparation_run_events'),'23514');
 await db.exec(`UPDATE organization_members SET status='INACTIVE' WHERE user_id='${id(20)}'`);await deny(()=>action('history',null,{page:0}),'42501');await db.exec(`UPDATE organization_members SET status='ACTIVE' WHERE user_id='${id(20)}'`);
 await db.exec(`UPDATE licenses SET document_management=false WHERE organization_id='org'`);await deny(()=>action('reserve',id(32),input),'42501');await db.exec(`UPDATE licenses SET document_management=true WHERE organization_id='org'`);
 await db.exec(`INSERT INTO platform_organization_sessions VALUES('org','${id(99)}',now()+interval '1 hour',null)`);ok((await action('access',null,{},{actor:id(99),role:'global-owner',platform:true})).allowed);
 await db.exec(`INSERT INTO documents SELECT '${id(3)}',organization_id,customer_id,consumer_unit_id,document_type,reference_month,file_verified,file_hash FROM documents WHERE id='${id(2)}'`);await deny(()=>action('reserve',id(32),{...input,basis:'d'.repeat(64)}),'40001');
 await db.exec(`DELETE FROM documents WHERE id='${id(3)}'`);
 if(process.env.CALCULATION_AUTOFILL_TEST_PG_PORT){const race=await Promise.all([action('reserve',id(40),{...input,basis:'e'.repeat(64)}),action('reserve',id(41),{...input,basis:'e'.repeat(64)})]);ok(race.filter(r=>r.acquired).length===1);ok(race[0].run.id===race[1].run.id);}
 console.log(JSON.stringify({result:'PASS',checks,privateTables:2,financialRecordsWritten:0,externalCalls:0}));
}finally{await db.close();}})().catch(e=>{console.error({code:e.code,message:e.message});process.exitCode=1});
