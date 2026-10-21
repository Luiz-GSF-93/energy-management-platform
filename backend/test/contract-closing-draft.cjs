const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),pglite=require('@electric-sql/pglite');
let PGlite=pglite.PGlite;
if(process.env.EVA_CLOSING_TEST_PG_PORT){if(process.env.EVA_CLOSING_TEST_PG_PORT!=='55484')throw Error('Disposable loopback only');const {Pool}=require('pg');PGlite=class{constructor(){this.ready=(async()=>{const a=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'postgres'});await a.query('CREATE DATABASE eva_contract_closing_draft_test');await a.end();this.pool=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'eva_contract_closing_draft_test',max:4})})();}async exec(sql){await this.ready;return this.pool.query(sql)}async query(sql,args){await this.ready;return this.pool.query(sql,args)}async close(){await this.ready;return this.pool.end()}};}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=x=>{assert(x);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
 const fixture=fs.readFileSync(path.join(__dirname,'calculation-autofill.cjs'),'utf8').split('await db.exec(`')[1].split('`);')[0].replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n)).replace(/\$\{'a'\.repeat\(64\)\}/g,'a'.repeat(64));await db.exec(process.env.EVA_CLOSING_TEST_PG_PORT?fixture.replace('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;',''):fixture);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261109_calculation_autofill.sql'),'utf8'));
 await db.exec(`CREATE TABLE tariff_library_versions(id text,organization_id text);CREATE TABLE monthly_energy_settlements(id text,organization_id text,customer_id text,consumer_unit_id text,month date,version_number integer,financial_hash text,status text,validation_status text,approved_at timestamptz,published_at timestamptz,financial_format text);
 CREATE FUNCTION capture_financial_sources(text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('tables',jsonb_build_object('consumer_units',(SELECT jsonb_agg(to_jsonb(u)) FROM public.consumer_units u WHERE organization_id=$1 AND customer_id=$2)))$$;
 INSERT INTO roles SELECT 'manager',organization_id,scope,'admin_org',permissions FROM roles WHERE id='operator';INSERT INTO organization_members VALUES('org','${id(24)}','manager','ACTIVE',null,'internal');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261110_eva_assisted_closing.sql'),'utf8'));
 await db.exec(`CREATE TABLE energy_contracts(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,contract_type text,status text,start_date date,end_date date,current_price numeric,adjustment_index text);ALTER TABLE documents ADD COLUMN energy_contract_id text;
 INSERT INTO energy_contracts VALUES('${id(3)}','org','customer','${id(1)}','ENERGY_PURCHASE','ACTIVE','2026-01-01','2026-12-31',118,'IPCA');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261205_contract_index_memories.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261206_eva_contract_closing_drafts.sql'),'utf8'));
 const call=(modern,action,request,body,actor=id(20),role='operator',org='org')=>db.query(modern?'SELECT eva_contract_closing_action($1,$2,$3,false,$4,$5,$6,$7,$8,false) data':'SELECT eva_assisted_closing_action($1,$2,$3,false,$4,$5,$6,$7,$8) data',[org,actor,role,action,id(1),'2026-08',request,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const insert=async(n,month='2026-08')=>db.query(`INSERT INTO contract_index_memories(id,organization_id,customer_id,consumer_unit_id,contract_id,version,parameters,contract_snapshot,plan,payload_hash,state,created_by) VALUES($1,'org','customer',$2,$3,$4,$5,'{}','{}',$6,'DRAFT',$7)`,[id(n),id(1),id(3),n,JSON.stringify({month}),'a'.repeat(64),id(20)]);
 const legacy=await call(false,'capture',null,{});ok(!('contractMemories' in legacy));await insert(50);await insert(51,'2026-09');
 const sources=await call(true,'capture',null,{});ok(sources.contractMemories.length===1);ok(sources.contractMemories[0].id===id(50));ok(JSON.stringify(await call(false,'capture',null,{}))===JSON.stringify(legacy));
 ok((await db.query("SELECT coalesce(current_setting('energyos.contract_closing_drafts',true),'') value")).rows[0].value!=='on');
 for(const actor of [id(22),id(23),id(99)])await deny(()=>call(true,'capture',null,{},actor));await deny(()=>call(true,'capture',null,{},id(20),'operator','other'));
 for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_contract_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,boolean)','EXECUTE') p",[role])).rows[0].p);
 ok((await db.query("SELECT has_function_privilege('service_role','eva_contract_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,boolean)','EXECUTE') p")).rows[0].p);
 const financial={status:'AVAILABLE',acr:'1000.00',aclBeforeFees:'700.00',fixedFee:'50.00',variableFee:'0.00',totalFees:'50.00',aclAfterFees:'750.00',savings:'250.00'};
 const report={formatVersion:'eva-assisted-closing-1.0',organizationId:'org',customerId:'customer',month:'2026-08',unitIds:[id(1)],units:[{id:id(1),...financial}],completeness:'COMPLETE',approvalEligible:true,missing:[],financial,publicationAllowed:false,automaticApproval:false};
 const b={basis:'b'.repeat(64),hash:'c'.repeat(64),sources,report};
 await call(true,'reserve',id(30),b);ok((await call(true,'finish',id(30),{})).state==='READY_FOR_REVIEW');
 await db.query("UPDATE contract_index_memories SET state='CANCELLED',finished_at=clock_timestamp() WHERE id=$1",[id(50)]);
 const decision={decision:'APPROVE',hash:b.hash,acknowledge:true,note:'Conferência em ambiente descartável de testes.'};
 await deny(()=>call(true,'decide',id(30),decision,id(24),'manager'));
 // Toggling the path cannot approve a report whose memory snapshot is no longer current.
 await deny(()=>call(false,'decide',id(30),decision,id(24),'manager'));
 await call(true,'decide',id(30),{...decision,decision:'REJECT'},id(24),'manager');
 await call(false,'reserve',id(31),{...b,basis:'d'.repeat(64),sources:legacy});ok((await call(false,'finish',id(31),{})).state==='READY_FOR_REVIEW');
 await insert(52);ok((await call(false,'decide',id(31),decision,id(24),'manager')).state==='APPROVED');
 const current=await call(true,'capture',null,{});await call(true,'reserve',id(32),{...b,basis:'e'.repeat(64),sources:current});await insert(53);
 ok((await call(true,'finish',id(32),{})).state==='INCOMPLETE');
 // A failing wrapper restores the transaction-local switch as well.
 await db.exec('BEGIN');await deny(()=>call(true,'capture',null,{},id(99)));await db.exec('ROLLBACK');
 ok((await db.query("SELECT coalesce(current_setting('energyos.contract_closing_drafts',true),'') value")).rows[0].value!=='on');
 console.log('Contract closing draft SQL:',checks,'checks passed');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
