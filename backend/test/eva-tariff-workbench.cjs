// Disposable synthetic PostgreSQL engine. No credentials, real data or provider requests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let {PGlite}=require('@electric-sql/pglite');
if(process.env.EVA_TARIFF_TEST_PG_PORT){if(process.env.EVA_TARIFF_TEST_PG_PORT!=='55484')throw Error('Disposable loopback only');const {Pool,types}=require('pg');types.setTypeParser(20,Number);PGlite=class{constructor(){this.ready=(async()=>{const a=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'postgres'});await a.query('CREATE DATABASE eva_tariff_workbench_test');await a.end();this.pool=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'eva_tariff_workbench_test',max:4})})();}async exec(sql){await this.ready;return this.pool.query(sql)}async query(sql,args){await this.ready;return this.pool.query(sql,args)}async close(){await this.ready;return this.pool.end()}};}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=x=>{assert(x);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
 await db.exec((process.env.EVA_TARIFF_TEST_PG_PORT?'':'CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;')+`
 CREATE TABLE organizations(id text PRIMARY KEY);CREATE TABLE customers(id text PRIMARY KEY);
 CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text,distributor text,tariff_group text,tariff_subgroup text,tariff_modality text);
 CREATE TABLE documents(id text PRIMARY KEY,organization_id text,consumer_unit_id text,reference_month date,document_type text,file_verified boolean,file_hash text,original_filename text,customer_id text DEFAULT 'customer',created_at timestamptz DEFAULT now());
 CREATE TABLE document_catalog(document_id text,organization_id text,tag text);
 CREATE TABLE licenses(id text PRIMARY KEY,organization_id text,active boolean,status text,start_date date,end_date date,documents_limit integer,documents_unlimited boolean,documents_used bigint);
 CREATE TABLE roles(id text,organization_id text,scope text,name text,permissions jsonb);CREATE TABLE organization_members(organization_id text,user_id text,role_id text,status text);
 CREATE FUNCTION preserve_calculation_autofill() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;
 CREATE FUNCTION eva_assisted_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF $1<>'org' OR $2<>'actor' OR $3<>'manager' OR $6<>'${id(1)}' OR $7<>'2026-09' OR $4 THEN RAISE EXCEPTION 'denied' USING ERRCODE='42501';END IF;
 RETURN '{"canPrepare":true,"canManage":true}';END$$;
 INSERT INTO organizations VALUES('org'),('other');INSERT INTO customers VALUES('customer');
 INSERT INTO consumer_units VALUES('${id(1)}','org','customer','Teste','A','A4','GREEN');
 INSERT INTO documents(id,organization_id,consumer_unit_id,reference_month,document_type,file_verified,file_hash,original_filename) VALUES('${id(2)}','org','${id(1)}','2026-09-01','INVOICE_DISTRIBUTOR',true,'${'a'.repeat(64)}','synthetic.pdf');
 INSERT INTO licenses VALUES('license','org',true,'active','2026-01-01','2027-01-01',10,false,1);
 INSERT INTO roles VALUES('manager','org','organization','admin_org','["beb6ec90-8ba8-40ce-a156-aeef6cc75cce","fd8a932f-87c0-4f86-8389-9f30c50e95b7"]');INSERT INTO organization_members VALUES('org','actor','manager','ACTIVE');`);
 const lib=fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261001_f1_135_tariff_library.sql'),'utf8');await db.exec(lib.split('CREATE TABLE public.tariff_library_applications')[0]+'COMMIT;');await db.exec(lib.slice(lib.indexOf('CREATE FUNCTION public.save_tariff_library'),lib.indexOf('CREATE FUNCTION public.apply_tariff_library')));
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261111_eva_tariff_workbench.sql'),'utf8'));
 const call=(action,request,body,org='org',actor='actor')=>db.query('SELECT eva_tariff_workbench_action($1,$2,$3,false,$4,$5,$6,$7,$8) d',[org,actor,'manager',action,id(1),'2026-09',request,JSON.stringify(body)]).then(r=>r.rows[0].d);
 const candidate={profile:{distributor:'Teste',group:'A',subgroup:'A4',modality:'GREEN'},documentId:id(2),sourceHash:'a'.repeat(64),modelKey:'b'.repeat(64),candidates:[{key:'TE:PEAK',value:'1.00',confidence:0.95}],evaluation:{score:0.95,threshold:0.9,state:'READY_FOR_REVIEW'},reason:'Conferência de modelo sintético.'};
 const body={payload:candidate,hash:'c'.repeat(64)};
 ok((await call('inspect',null,{page:0})).canWrite);await deny(()=>call('inspect',null,{page:0},'other'));await deny(()=>call('inspect',null,{page:0},'org','another'));await deny(()=>call('checkDocument',null,{documentId:id(9)}));
 await call('import',id(10),body);ok((await call('import',id(10),body)).replayed);ok((await db.query('SELECT count(*) n FROM eva_tariff_model_evaluations')).rows[0].n===1);
 ok((await db.query("SELECT organization_resource_usage('org')->>'documents' n")).rows[0].n==='1');
 await deny(()=>call('import',id(11),{payload:{...candidate,sourceHash:'f'.repeat(64)},hash:'d'.repeat(64)}));
 await deny(()=>call('import',id(10),{...body,hash:'d'.repeat(64)}));
 for(let n=11;n<=15;n++)await call('import',id(n),body);
 ok((await db.query("SELECT organization_resource_usage('org')->>'documents' n")).rows[0].n==='6');await deny(()=>call('import',id(16),body));ok((await db.query('SELECT count(*) n FROM eva_tariff_imports')).rows[0].n===6);
 const qualify={payload:{importId:id(15),acknowledge:true,note:'Conferência independente de qualidade.'},hash:'d'.repeat(64)};await deny(()=>call('qualify',id(20),qualify));
 const aiIntent={payload:{importId:id(15)},hash:'e'.repeat(64)};ok((await call('adviceReserve',id(21),aiIntent)).acquired);ok(!(await call('adviceReserve',id(22),aiIntent)).acquired);
 await call('adviceFinish',id(23),{payload:{importId:id(15),reservationId:id(21),advice:{state:'READY',answer:'Simulação sem IA externa.'}},hash:'f'.repeat(64)});
 ok((await call('qualify',id(24),qualify)).event.payload.result.state==='HOMOLOGATED');await deny(()=>call('adviceFinish',id(25),{payload:{importId:id(15),reservationId:id(21),advice:{state:'READY'}},hash:'f'.repeat(64)}));
 // Another model must still respect the common document allowance.
 await db.exec("UPDATE licenses SET documents_limit=6");await deny(()=>call('import',id(30),{payload:{...candidate,modelKey:'d'.repeat(64)},hash:'e'.repeat(64)}));
 await db.exec("UPDATE licenses SET documents_limit=100");
 for(let n=40;n<=46;n++)await db.query(`INSERT INTO documents(id,organization_id,consumer_unit_id,reference_month,document_type,file_verified,file_hash,original_filename) VALUES($1,'org',$2,'2026-09-01','INVOICE_DISTRIBUTOR',true,$3,'new-model.pdf')`,[id(n),id(1),'a'.repeat(64)]);
 for(let n=40;n<=45;n++)ok((await call('reserveModel',id(n+100),{payload:{documentId:id(n),modelKey:'e'.repeat(64)},hash:'d'.repeat(64)})).acquired);
 await deny(()=>call('reserveModel',id(146),{payload:{documentId:id(46),modelKey:'e'.repeat(64)},hash:'d'.repeat(64)}));
 for(const table of ['eva_tariff_imports','eva_tariff_candidates','eva_tariff_model_evaluations','eva_tariff_events']){
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) p',[role,table,privilege])).rows[0].p);
  await deny(()=>db.exec('UPDATE '+table+' SET organization_id=organization_id'));
 }
 ok((await call('inspect',null,{page:0})).imports.length===6);ok((await db.query('SELECT count(*) n FROM eva_operational_invoices')).rows[0].n===8);await db.exec("INSERT INTO document_catalog VALUES('00000000-0000-4000-8000-000000000002','org','MODEL')");ok((await db.query('SELECT count(*) n FROM eva_operational_invoices')).rows[0].n===7);console.log('Tariff workbench SQL:',checks,'checks passed');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
