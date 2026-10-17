const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),pglite=require('@electric-sql/pglite');
let PGlite=pglite.PGlite;
if(process.env.EVA_CHANGES_TEST_PG_PORT){if(process.env.EVA_CHANGES_TEST_PG_PORT!=='55484')throw Error('Disposable loopback only');const {Pool}=require('pg');PGlite=class{constructor(){this.ready=(async()=>{const a=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'postgres'});await a.query('CREATE DATABASE eva_closing_changes_test');await a.end();this.pool=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'eva_closing_changes_test',max:4})})();}async exec(sql){await this.ready;return this.pool.query(sql)}async query(sql,args){await this.ready;return this.pool.query(sql,args)}async close(){await this.ready;return this.pool.end()}};}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=x=>{assert(x);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
 const fixture=fs.readFileSync(path.join(__dirname,'calculation-autofill.cjs'),'utf8').split('await db.exec(`')[1].split('`);')[0].replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n)).replace(/\$\{'a'\.repeat\(64\)\}/g,'a'.repeat(64));await db.exec(process.env.EVA_CHANGES_TEST_PG_PORT?fixture.replace('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;',''):fixture);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261109_calculation_autofill.sql'),'utf8'));
 await db.exec(`ALTER TABLE licenses ADD COLUMN id text;UPDATE licenses SET id=organization_id;ALTER TABLE licenses ADD PRIMARY KEY(id);ALTER TABLE licenses ADD COLUMN documents_used bigint DEFAULT 0;ALTER TABLE licenses ADD COLUMN documents_limit bigint DEFAULT 3;ALTER TABLE licenses ADD COLUMN documents_unlimited boolean DEFAULT false;
 UPDATE roles SET permissions=permissions||'["62443ab1-9187-42e4-a932-a7cf54f76250"]';
 CREATE TABLE tariff_library_versions(id text,organization_id text);CREATE TABLE monthly_energy_settlements(id text,organization_id text,customer_id text,consumer_unit_id text,month date,version_number integer,financial_hash text,status text,validation_status text,approved_at timestamptz,published_at timestamptz,financial_format text);
 CREATE TABLE eva_tariff_model_evaluations(organization_id text,quota_units integer);
 CREATE FUNCTION capture_financial_sources(text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('tables',jsonb_build_object('consumer_units',(SELECT jsonb_agg(to_jsonb(u)) FROM public.consumer_units u WHERE organization_id=$1 AND customer_id=$2)))$$;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261110_eva_assisted_closing.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261112_eva_closing_changes.sql'),'utf8'));
 const close=(action,rid,body)=>db.query('SELECT eva_assisted_closing_action($1,$2,$3,false,$4,$5,$6,$7,$8) data',['org',id(20),'operator',action,id(1),'2026-08',rid,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const change=(action,rid,body,actor=id(20),role='operator',org='org')=>db.query('SELECT eva_closing_change_action($1,$2,$3,false,$4,$5,$6,$7,$8) data',[org,actor,role,action,id(1),'2026-08',rid,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const usage=async()=>Number((await db.query("SELECT organization_resource_usage('org')->>'documents' n")).rows[0].n);
 const financial={status:'AVAILABLE',acr:'1000.00',aclBeforeFees:'700.00',fixedFee:'50.00',variableFee:'0.00',totalFees:'50.00',aclAfterFees:'750.00',savings:'250.00'};
 const report={formatVersion:'eva-assisted-closing-1.0',organizationId:'org',customerId:'customer',month:'2026-08',unitIds:[id(1)],units:[{id:id(1),...financial}],completeness:'ESTIMATED',approvalEligible:true,missing:[],financial,publicationAllowed:false,automaticApproval:false,methodology:'SAME_INVOICE_AMOUNTS_V2'};
 const sources=await close('capture',null,{});await close('reserve',id(30),{basis:'a'.repeat(64),hash:'b'.repeat(64),report,sources});await close('finish',id(30),{});
 const body={sourceId:id(30),sourceHash:'b'.repeat(64),reportHash:'c'.repeat(64),question:'Altere o honorário fixo conforme premissa',report:{...report,methodology:'EVA_CONFIRMED_CHANGES_V1'},diff:[{field:'fixedFee',before:'40',after:'50'}]};
 ok(await usage()===1);
 for(const [actor,role,org] of [[id(22),'client','org'],[id(21),'viewer','org'],[id(23),'operator','org'],[id(20),'operator','other']])await deny(()=>change('propose',id(40),body,actor,role,org));
 const p=await change('propose',id(40),body);ok(p.state==='PROPOSED'&&!p.charged&&p.documentCharge===1);ok(await usage()===1);
 await deny(()=>change('confirm',id(40),{hash:p.hash,acknowledge:false}));await deny(()=>change('confirm',id(40),{hash:'f'.repeat(64),acknowledge:true}));
 const results=await Promise.all([change('confirm',id(40),{hash:p.hash,acknowledge:true}),change('confirm',id(40),{hash:p.hash,acknowledge:true})]);ok(results.every(r=>r.state==='APPLIED'&&r.charged));ok(await usage()===2);ok((await close('history',null,{page:0})).total===2);
 ok(Number((await db.query('SELECT count(*) n FROM eva_closing_document_credits')).rows[0].n)===1);ok(Number((await db.query("SELECT documents_used FROM licenses WHERE id='org'")).rows[0].documents_used)===2);
 ok((await change('status',id(40),{hash:p.hash})).closingId===id(40));
 const b2={...body,sourceId:id(40),sourceHash:p.hash,reportHash:'d'.repeat(64)};const p2=await change('propose',id(41),b2);await change('cancel',id(41),{hash:p2.hash});await deny(()=>change('confirm',id(41),{hash:p2.hash,acknowledge:true}));ok(await usage()===2);
 const p3=await change('propose',id(42),{...b2,reportHash:'e'.repeat(64)});await db.exec("UPDATE licenses SET documents_limit=2 WHERE id='org'");await deny(()=>change('confirm',id(42),{hash:p3.hash,acknowledge:true}));ok(await usage()===2);ok((await close('history',null,{page:0})).total===2);
 await db.exec("UPDATE licenses SET documents_unlimited=true WHERE id='org'");ok((await change('confirm',id(42),{hash:p3.hash,acknowledge:true})).state==='APPLIED');ok(await usage()===3);
 const rollbackBody={...body,sourceId:id(42),sourceHash:p3.hash,reportHash:'7'.repeat(64)};
 const rp=await change('propose',id(50),rollbackBody);
 await db.exec(`CREATE FUNCTION fail_credit_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'simulated ledger failure';END$$;CREATE TRIGGER fail_credit BEFORE INSERT ON eva_closing_document_credits FOR EACH ROW EXECUTE FUNCTION fail_credit_test()`);
 await deny(()=>change('confirm',id(50),{hash:rp.hash,acknowledge:true}));ok(await usage()===3);ok((await close('history',null,{page:0})).total===3);ok((await change('status',id(50),{hash:rp.hash})).state==='PROPOSED');
 await db.exec('DROP TRIGGER fail_credit ON eva_closing_document_credits;DROP FUNCTION fail_credit_test()');
 ok((await change('history',id(42),{hash:p3.hash})).rows.some(p=>p.id===id(50)));
 const b3={...body,sourceId:id(42),sourceHash:p3.hash,reportHash:'f'.repeat(64)};const p4=await change('propose',id(43),b3);await db.exec("INSERT INTO tariff_library_versions VALUES('changed','org')");await deny(()=>change('confirm',id(43),{hash:p4.hash,acknowledge:true}));ok(await usage()===3);
 await db.exec("UPDATE roles SET permissions=permissions-'62443ab1-9187-42e4-a932-a7cf54f76250' WHERE id='operator'");await deny(()=>change('status',id(40),{hash:p.hash}));
 for(const table of ['eva_closing_change_proposals','eva_closing_change_events','eva_closing_document_credits']){
  const r=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[table])).rows[0];ok(r.relrowsecurity&&r.relforcerowsecurity);
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) p',[role,table,privilege])).rows[0].p);
  await deny(()=>db.exec('UPDATE '+table+' SET organization_id=organization_id'));await deny(()=>db.exec('DELETE FROM '+table));
 }
 for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_closing_change_action(text,text,text,boolean,text,text,text,uuid,jsonb)','EXECUTE') p",[role])).rows[0].p);
 console.log('Closing corrections SQL:',checks,'checks passed; no external calls');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
