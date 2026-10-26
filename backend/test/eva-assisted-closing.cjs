const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),pglite=require('@electric-sql/pglite');
let PGlite=pglite.PGlite;
if(process.env.EVA_CLOSING_TEST_PG_PORT){if(process.env.EVA_CLOSING_TEST_PG_PORT!=='55484')throw Error('Disposable loopback only');const {Pool}=require('pg');PGlite=class{constructor(){this.ready=(async()=>{const a=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'postgres'});await a.query('CREATE DATABASE eva_assisted_closing_test');await a.end();this.pool=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'eva_assisted_closing_test',max:4})})();}async exec(sql){await this.ready;return this.pool.query(sql)}async query(sql,args){await this.ready;return this.pool.query(sql,args)}async close(){await this.ready;return this.pool.end()}};}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=x=>{assert(x);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
 const fixture=fs.readFileSync(path.join(__dirname,'calculation-autofill.cjs'),'utf8').split('await db.exec(`')[1].split('`);')[0].replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n)).replace(/\$\{'a'\.repeat\(64\)\}/g,'a'.repeat(64));await db.exec(process.env.EVA_CLOSING_TEST_PG_PORT?fixture.replace('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;',''):fixture);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261109_calculation_autofill.sql'),'utf8'));
 await db.exec(`CREATE TABLE tariff_library_versions(id text,organization_id text);CREATE TABLE monthly_energy_settlements(id text,organization_id text,customer_id text,consumer_unit_id text,month date,version_number integer,financial_hash text,status text,validation_status text,approved_at timestamptz,published_at timestamptz,financial_format text);
 CREATE FUNCTION capture_financial_sources(text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('largeProof',repeat('private snapshot evidence ',40000),'tables',jsonb_build_object('consumer_units',(SELECT jsonb_agg(to_jsonb(u)) FROM public.consumer_units u WHERE organization_id=$1 AND customer_id=$2)))$$;
 INSERT INTO roles SELECT 'manager',organization_id,scope,'admin_org',permissions FROM roles WHERE id='operator';INSERT INTO organization_members VALUES('org','${id(24)}','manager','ACTIVE',null,'internal');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261110_eva_assisted_closing.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261221_eva_closing_history_projection.sql'),'utf8'));
 // Re-applying the guarded performance migration preserves the exact interface.
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261221_eva_closing_history_projection.sql'),'utf8'));
 const call=(action,idArg,body,actor=id(20),role='operator',org='org')=>db.query('SELECT eva_assisted_closing_action($1,$2,$3,false,$4,$5,$6,$7,$8) data',[org,actor,role,action,id(1),'2026-08',idArg,JSON.stringify(body)]).then(r=>r.rows[0].data);
 let sources=await call('capture',null,{});
 const financial={status:'AVAILABLE',acr:'1000.00',aclBeforeFees:'700.00',fixedFee:'50.00',variableFee:'0.00',totalFees:'50.00',aclAfterFees:'750.00',savings:'250.00'};
 const report={formatVersion:'eva-assisted-closing-1.0',organizationId:'org',customerId:'customer',month:'2026-08',unitIds:[id(1)],units:[{id:id(1),...financial}],completeness:'COMPLETE',approvalEligible:true,missing:[],financial,publicationAllowed:false,automaticApproval:false};
 const b={basis:'b'.repeat(64),hash:'c'.repeat(64),sources,report};
 ok((await call('history',null,{page:0})).total===0);
 for(const actor of [id(22),id(23),id(50)])await deny(()=>call('reserve',id(30),b,actor));
 await deny(()=>call('reserve',id(30),{...b,report:{...report,completeness:null}}));
 const concurrent=await Promise.all([call('reserve',id(30),b),call('reserve',id(30),b)]);ok(concurrent.filter(r=>r.acquired).length===1);ok(concurrent.every(r=>r.row.id===concurrent[0].row.id));
 ok((await call('finish',id(30),{})).state==='READY_FOR_REVIEW');
 const decision={decision:'APPROVE',hash:b.hash,acknowledge:true,note:'Fontes conferidas na simulação descartável.'};
 await deny(()=>call('decide',id(30),decision));await deny(()=>call('decide',id(30),{...decision,decision:null},id(24),'manager'));
 ok((await call('decide',id(30),decision,id(24),'manager')).state==='APPROVED');ok((await call('decide',id(30),decision,id(24),'manager')).state==='APPROVED');
 await deny(()=>call('decide',id(30),{...decision,decision:'REJECT'},id(24),'manager'));
 const h=await call('history',null,{page:0});ok(h.rows.length===1&&!('source_snapshot' in h.rows[0]));
 const stored=(await db.query('SELECT * FROM eva_assisted_closing_versions WHERE id=$1',[id(30)])).rows[0];
 ok(stored.source_snapshot.financial.largeProof.length>500000);
 for(const key of ['id','organization_id','customer_id','consumer_unit_id','month','version','previous_id','basis','payload_hash','report','created_by'])assert.deepEqual(h.rows[0][key],stored[key]);
 ok(JSON.stringify(h.rows[0]).length<5000);
 const definition=(await db.query("SELECT pg_get_functiondef('eva_assisted_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb)'::regprocedure) definition")).rows[0].definition;
 ok(!/to_jsonb\((?:t|r|old)\)-'source_snapshot'/.test(definition));
 ok(definition.includes('r.source_snapshot IS DISTINCT FROM public.capture_eva_assisted_closing_sources')); 
 for(const table of ['eva_assisted_closing_versions','eva_assisted_closing_events']){
  await deny(()=>db.query('UPDATE '+table+' SET organization_id=organization_id'));
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) p',[role,table,privilege])).rows[0].p);
 }
 // A changed capture invalidates approval but permits explicit rejection and another immutable revision.
 const b2={...b,basis:'d'.repeat(64)};await call('reserve',id(32),b2);await call('finish',id(32),{});await db.exec(`INSERT INTO tariff_library_versions VALUES('changed','org')`);
 await deny(()=>call('decide',id(32),decision,id(24),'manager'));
 ok((await call('decide',id(32),{...decision,decision:'REJECT'},id(24),'manager')).state==='REJECTED');
 sources=await call('capture',null,{});ok((await call('reserve',id(33),{...b,basis:'e'.repeat(64),sources})).acquired);ok((await call('finish',id(33),{})).state==='READY_FOR_REVIEW');
 await deny(()=>call('history',null,{page:0},id(20),'operator','other'));
 console.log('Assisted closing SQL:',checks,'checks passed');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});

