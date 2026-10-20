const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
let PGlite=require('@electric-sql/pglite').PGlite;
if(process.env.CONTRACT_INDEX_TEST_PG_PORT){if(process.env.CONTRACT_INDEX_TEST_PG_PORT!=='55484')throw Error('Disposable loopback only');const {Pool}=require('pg');PGlite=class{constructor(){this.ready=(async()=>{const admin=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'postgres'});await admin.query('CREATE DATABASE contract_index_memory_test');await admin.end();this.pool=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'contract_index_memory_test',max:4})})();}async exec(sql){await this.ready;return this.pool.query(sql)}async query(sql,args){await this.ready;return this.pool.query(sql,args)}async close(){await this.ready;return this.pool.end()}};}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=v=>{assert(v);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
 const fixture=fs.readFileSync(path.join(__dirname,'calculation-autofill.cjs'),'utf8').split('await db.exec(`')[1].split('`);')[0].replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n)).replace(/\$\{'a'\.repeat\(64\)\}/g,'a'.repeat(64));await db.exec(process.env.CONTRACT_INDEX_TEST_PG_PORT?fixture.replace('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;',''):fixture);
 await db.exec(`CREATE TABLE energy_contracts(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,contract_type text,status text,start_date date,end_date date,current_price numeric,adjustment_index text);ALTER TABLE documents ADD COLUMN energy_contract_id text;
 INSERT INTO energy_contracts VALUES('${id(3)}','org','customer','${id(1)}','ENERGY_PURCHASE','ACTIVE','2026-01-01','2026-04-30',118,'4,5');UPDATE documents SET energy_contract_id='${id(3)}';`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261205_contract_index_memories.sql'),'utf8'));
 const call=(action,request,body={},actor=id(20),role='operator',org='org')=>db.query('SELECT contract_index_memory_action($1,$2,$3,false,$4,$5,$6,$7) data',[org,actor,role,id(3),action,request,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const c=(await call('history')).contract;const b={parameters:{month:'2026-03',index:'IPCA',sourceDocumentId:id(2)},contract:c,plan:{host:'apisidra.ibge.gov.br'},hash:'a'.repeat(64),previousId:null};
 ok((await call('history')).rows.length===0);ok((await call('history',null,{},id(21),'viewer')).canWrite===false);
 for(const actor of [id(22),id(23),id(50)])await deny(()=>call('history',null,{},actor));await deny(()=>call('history',null,{},id(20),'operator','other'));
 await deny(()=>call('preview',id(30),b,id(21),'viewer'));await deny(()=>call('preview',id(30),{...b,contract:{...c,current_price:999}}));
 const created=await call('preview',id(30),b);ok(created.row.state==='DRAFT'&&created.row.consent_at===null);ok((await call('preview',id(30),b)).replayed);
 await deny(()=>call('preview',id(30),{...b,hash:'b'.repeat(64)}));await deny(()=>call('claim',id(30),{}));
 const consent={hash:b.hash,acknowledge:true,note:'Autorizo somente os meses e a série apresentados.'};
 await deny(()=>call('claim',id(30),consent,id(21),'viewer'));await deny(()=>call('claim',id(30),{...consent,hash:'b'.repeat(64)}));
 const concurrent=await Promise.all([call('claim',id(30),consent),call('claim',id(30),consent)]);ok(concurrent.filter(r=>r.acquired).length===1);ok(concurrent.every(r=>r.row.consent_at));
 ok((await call('cancel',id(30))).row.state==='FETCHING');
 const finish={state:'COMPLETE',result:{financialApplication:false,pricePerMwh:'128.372561'}};
 ok((await call('finish',id(30),finish)).row.state==='COMPLETE');ok(!(await call('claim',id(30),consent)).acquired);
 ok((await call('finish',id(30),{...finish,result:{pricePerMwh:'999'}})).row.result.pricePerMwh==='128.372561');
 await deny(()=>call('preview',id(31),b));
 const b2={...b,previousId:id(30)};await call('preview',id(31),b2);ok((await call('cancel',id(31))).row.state==='CANCELLED');ok(!(await call('claim',id(31),consent)).acquired);
 await call('preview',id(32),{...b,previousId:id(31)});await db.exec(`UPDATE energy_contracts SET current_price=119`);await deny(()=>call('claim',id(32),consent));await db.exec(`UPDATE energy_contracts SET current_price=118`);
 await db.exec(`UPDATE documents SET file_hash='${'b'.repeat(64)}'`);await deny(()=>call('claim',id(32),consent));
 await db.exec(`INSERT INTO organization_members VALUES('org','${id(24)}','operator','ACTIVE',null,'internal');INSERT INTO contract_index_memories SELECT '${id(34)}',organization_id,customer_id,consumer_unit_id,contract_id,4,id,parameters,contract_snapshot,source_document,plan,payload_hash,'DRAFT',created_by,created_at,now()-interval '1 second',null,null,null,null FROM contract_index_memories WHERE id='${id(32)}'`);await deny(()=>call('claim',id(34),consent));await deny(()=>call('claim',id(32),consent,id(24)));
 // The end states and source snapshots cannot be edited, including by the table owner.
 await deny(()=>db.exec(`UPDATE contract_index_memories SET result='{}' WHERE id='${id(30)}'`));await deny(()=>db.exec(`DELETE FROM contract_index_memories`));await deny(()=>db.exec(`UPDATE contract_index_memories SET expires_at=now()+interval '1 hour' WHERE id='${id(32)}'`));
 const flags=(await db.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='contract_index_memories'::regclass`)).rows[0];ok(flags.relrowsecurity&&flags.relforcerowsecurity);
 for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) p',[role,'contract_index_memories',privilege])).rows[0].p);
 for(const role of ['anon','authenticated'])ok(!(await db.query(`SELECT has_function_privilege($1,'contract_index_memory_action(text,text,text,boolean,text,text,uuid,jsonb)','EXECUTE') p`,[role])).rows[0].p);
 ok((await db.query(`SELECT current_price::text price FROM energy_contracts`)).rows[0].price==='118');
 console.log('Contract index SQL:',checks,'checks passed');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
