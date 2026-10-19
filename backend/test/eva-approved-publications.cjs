// Synthetic, disposable database. Never reads application credentials or production data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let {PGlite}=require('@electric-sql/pglite');
if(process.env.EVA_PUBLICATIONS_TEST_PG_PORT){if(process.env.EVA_PUBLICATIONS_TEST_PG_PORT!=='55484')throw Error('Disposable loopback only');const {Pool,types}=require('pg');types.setTypeParser(20,Number);PGlite=class{constructor(){this.ready=(async()=>{const a=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'postgres'});await a.query('CREATE DATABASE eva_publications_test');await a.end();this.pool=new Pool({host:'127.0.0.1',port:55484,user:'postgres',database:'eva_publications_test',max:4})})();}async exec(sql){await this.ready;return this.pool.query(sql)}async query(sql,args){await this.ready;return this.pool.query(sql,args)}async close(){await this.ready;return this.pool.end()}};}

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=x=>{assert(x);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
 const fixture=fs.readFileSync(path.join(__dirname,'calculation-autofill.cjs'),'utf8').split('await db.exec(`')[1].split('`);')[0].replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n)).replace(/\$\{'a'\.repeat\(64\)\}/g,'a'.repeat(64));await db.exec(process.env.EVA_PUBLICATIONS_TEST_PG_PORT?fixture.replace('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;',''):fixture);
 await db.exec(`ALTER TABLE customers ADD COLUMN company_name text DEFAULT 'Synthetic customer';
 CREATE TABLE tariff_library_versions(id text,organization_id text);CREATE TABLE monthly_energy_settlements(financial_group_id uuid,id text,organization_id text,customer_id text,consumer_unit_id text,month date,version_number integer,financial_hash text,status text,validation_status text,approved_at timestamptz,published_at timestamptz,financial_format text);
 CREATE TABLE published_report_snapshots(id uuid DEFAULT gen_random_uuid(),organization_id text,customer_id text,consumer_unit_id text,kind text,request_id uuid,request jsonb,body jsonb,payload_hash text,created_by text);
 CREATE FUNCTION assert_report_actor(text,text,boolean) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF $1<>'org' OR $2<>'${id(24)}' THEN RAISE EXCEPTION 'Denied';END IF;END$$;
 CREATE FUNCTION capture_financial_sources(text,text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('tables',jsonb_build_object('consumer_units',(SELECT jsonb_agg(to_jsonb(u)) FROM public.consumer_units u WHERE organization_id=$1 AND customer_id=$2)))$$;
 INSERT INTO roles SELECT 'manager',organization_id,scope,'admin_org',permissions FROM roles WHERE id='operator';INSERT INTO organization_members VALUES('org','${id(24)}','manager','ACTIVE',null,'internal');
 INSERT INTO roles VALUES('portal','org','organization','consulta','["3ebadd32-6f30-459e-8ed3-0d2843d89946"]');INSERT INTO organization_members VALUES('org','${id(25)}','portal','ACTIVE','customer','external');`);
 for(const f of ['20261109_calculation_autofill.sql','20261110_eva_assisted_closing.sql','20261119_eva_approved_publications.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations',f),'utf8'));
 const closing=(action,key,body,actor=id(20),role='operator')=>db.query('SELECT eva_assisted_closing_action($1,$2,$3,false,$4,$5,$6,$7,$8) data',['org',actor,role,action,id(1),'2026-08',key,JSON.stringify(body)]).then(r=>r.rows[0].data);
 const publish=(key,action='publish',patch={})=>db.query('SELECT eva_closing_publication_action($1,$2,$3,$4,$5,$6,$7,$8,$9) data',[patch.org??'org',patch.actor??id(24),patch.role??'manager',patch.platform??false,action,patch.unit??id(1),'2026-08',key,JSON.stringify({hash:'c'.repeat(64),note:'Disponibilizar resultado aprovado na base sintética.',...patch.body})]).then(r=>r.rows[0].data);
 const read=(portal=false,customer=null,patch={})=>db.query('SELECT read_eva_closing_publications($1,$2,$3,$4,$5,$6,$7,$8) data',[patch.org??'org',patch.actor??(portal?id(25):id(24)),patch.role??(portal?'portal':'manager'),patch.platform??false,portal,patch.from??'2026-08',patch.to??'2026-08',customer]).then(r=>r.rows[0].data);
 const financial={status:'AVAILABLE',acr:'1000.00',aclBeforeFees:'700.00',fixedFee:'50.00',variableFee:'30.00',totalFees:'80.00',aclAfterFees:'780.00',savings:'220.00'};
 const report={formatVersion:'eva-assisted-closing-1.0',organizationId:'org',customerId:'customer',month:'2026-08',unitIds:[id(1)],units:[{id:id(1),name:'Synthetic unit',...financial,fields:[{key:'secret',value:'PRIVATE OCR'}],sources:{private:'NOT FOR PORTAL'}}],completeness:'ESTIMATED',approvalEligible:true,missing:[],financial,publicationAllowed:false,automaticApproval:false,observations:['PRIVATE NOTE'],recommendations:['PRIVATE RECOMMENDATION']};
 let sources=await closing('capture',null,{});
 const prepare=async(key,basis,custom=report)=>{await closing('reserve',key,{basis:basis.repeat(64),hash:'c'.repeat(64),sources,report:custom});await closing('finish',key,{});};
 await prepare(id(30),'b');
 await deny(()=>publish(id(30)));ok((await read()).length===0);
 const body={decision:'APPROVE',hash:'c'.repeat(64),note:'Fontes e disponibilização conferidas na simulação.',acknowledge:true,disclose:true};
 const approve=(key,b=body)=>db.query('SELECT decide_eva_with_publication($1,$2,$3,false,$4,$5,$6,$7) data',['org',id(24),'manager',id(1),'2026-08',key,JSON.stringify(b)]).then(r=>r.rows[0].data);
 await deny(()=>approve(id(30),{...body,disclose:false}));ok((await closing('history',null,{page:0})).rows[0].state==='READY_FOR_REVIEW');
 const result=await approve(id(30));ok(result.state==='APPROVED'&&result.publication.state==='PUBLISHED');ok((await approve(id(30))).publication.id===result.publication.id);ok((await publish(id(30))).id===result.publication.id);
 const published=await read(true,'customer');ok(published.length===1);ok(published[0].projection.financial.savingsAfterFees==='220.00');ok(published[0].projection.estimated===true);
 for(const secret of ['PRIVATE OCR','PRIVATE NOTE','PRIVATE RECOMMENDATION','source_snapshot','fields','created_by'])ok(!JSON.stringify(published).includes(secret));
 ok((await read(false,'customer')).length===1);
 for(const patch of [{org:'other'},{actor:id(22),role:'client'},{actor:id(25),role:'portal'},{actor:id(50)},{platform:true,actor:id(99)}])await deny(()=>publish(id(30),'publish',patch));
 await deny(()=>read(true,'other-customer'));await deny(()=>read(true,null));await deny(()=>read(true,'customer',{actor:id(20),role:'operator'}));await deny(()=>read(false,null,{actor:id(25),role:'portal'}));await deny(()=>read(false,null,{org:'other'}));await deny(()=>read(false,null,{from:'2026-01',to:'2027-01'}));
 await db.exec(`UPDATE organization_members SET status='inactive' WHERE user_id='${id(25)}'`);await deny(()=>read(true,'customer'));await db.exec(`UPDATE organization_members SET status='ACTIVE' WHERE user_id='${id(25)}'`);
 const request={kind:'EXECUTIVE',customerId:'customer',unitId:id(1),from:'2026-08',to:'2026-08',requestId:id(60)};
 const reportBody={formatVersion:'energy-report-1.0',kind:'EXECUTIVE',header:{organizationId:'org',customerId:'customer',unitId:id(1)},period:{from:'2026-08',to:'2026-08'},publications:[{customerId:'customer',month:'2026-08',id:result.publication.id,payloadHash:'c'.repeat(64),version:1}],totals:{}};
 const capture=(body=reportBody)=>db.query('SELECT capture_published_report($1,$2,$3,$4,$5) data',['org',id(24),JSON.stringify({...request,requestId:crypto.randomUUID()}),JSON.stringify(body),'d'.repeat(64)]);
 ok(!!(await capture()).rows[0].data);await deny(()=>capture({...reportBody,publications:[{...reportBody.publications[0],payloadHash:'e'.repeat(64)}]}));
 const withdrawn=await publish(id(30),'withdraw');ok(withdrawn.state==='WITHDRAWN');await deny(()=>capture());ok((await read(true,'customer'))[0].state==='WITHDRAWN');ok((await read())[0].state==='WITHDRAWN');await deny(()=>publish(id(30)));
 // Publication validation fails after the approval action: the entire transaction must roll back.
 await prepare(id(31),'d');await db.exec("UPDATE customers SET company_name=NULL WHERE id='customer'");
 await deny(()=>approve(id(31)));ok((await closing('history',null,{page:0})).rows.find(x=>x.id===id(31)).state==='READY_FOR_REVIEW');ok((await db.query('SELECT count(*) n FROM eva_closing_publications WHERE closing_id=$1',[id(31)])).rows[0].n===0);await db.exec("UPDATE customers SET company_name='Synthetic customer' WHERE id='customer'");
 for(const table of ['eva_closing_publications','eva_closing_publication_events']){
  const r=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[table])).rows[0];ok(r.relrowsecurity&&r.relforcerowsecurity);
  await deny(()=>db.query('UPDATE '+table+' SET organization_id=organization_id'));
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query('SELECT has_table_privilege($1,$2,$3) p',[role,table,privilege])).rows[0].p);
 }
 console.log('Approved publication SQL:',checks,'checks passed');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
