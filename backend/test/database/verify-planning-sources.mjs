// Disposable database: source isolation, publication boundary and CCEE eligibility.
import assert from 'node:assert/strict';
import {aclFixture} from './acl-test-fixture.mjs';
const {db,client,actor,call,migrate}=await aclFixture();let checks=0;
const check=v=>{assert.ok(v);checks++;},deny=async f=>{await assert.rejects(f,e=>e.code==='42501');checks++;};
try{
 await db.exec(`ALTER TABLE licenses ADD COLUMN report_generation boolean DEFAULT true;
 CREATE TABLE monthly_energy_settlements(organization_id text,customer_id text,consumer_unit_id text,financial_group_id uuid,status text,validation_status text,financial_hash text,version_number int,month date);`);
 for(const name of ['20261006_r2_published_reports.sql','20261009_energy_forecast.sql','20261009_energy_forecast_client.sql'])await migrate(name);
 await db.exec(`CREATE TABLE planning_test_publications(payload jsonb);
 CREATE FUNCTION read_portal_financial_components_v2(text,text,text,boolean,boolean,text,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(jsonb_agg(payload),'[]') FROM public.planning_test_publications WHERE payload->>'customerId'=$8 AND payload->>'month' BETWEEN $6 AND $7 $$;
 CREATE TABLE eva_closing_publications(id uuid,organization_id text,customer_id text,closing_id uuid,source_hash text,created_at timestamptz);
 CREATE TABLE eva_assisted_closing_versions(id uuid,organization_id text,payload_hash text,month text,report jsonb);
 CREATE TABLE document_ocr_jobs(id uuid,organization_id text,document_id text,file_hash text,state text,created_at timestamptz);
 CREATE TABLE document_ocr_results(job_id uuid,organization_id text,document_id text,file_hash text,raw_result jsonb);
 CREATE TABLE ccee_unit_authorizations(id uuid,organization_id text,customer_id text,consumer_unit_id text,status text,reviewed_at timestamptz,measurement_basis text,service_scope jsonb,valid_from date,valid_to date,revision int);
 CREATE TABLE ccee_integration_jobs(id uuid,organization_id text,authorization_id uuid,month date,environment text,kind text,measurement_kind text,state text,result jsonb,finished_at timestamptz);`);
 await migrate('20261238_portal_planning_sources.sql');
 const read=()=>call('energy_forecast_client_sources',['o1',client,'client']);
 check((await read()).units.length===0);
 const publicationId='10000000-0000-4000-8000-000000000001',closing='10000000-0000-4000-8000-000000000002',job='10000000-0000-4000-8000-000000000003',binding='10000000-0000-4000-8000-000000000004',hash='a'.repeat(64);
 await db.query(`INSERT INTO planning_test_publications VALUES($1),($2)`,[JSON.stringify({publicationId,sourceHash:hash,customerId:'c1',unitId:'u1',month:'2026-09'}),JSON.stringify({customerId:'c2',unitId:'u2',month:'2026-09'})]);
 await db.query(`INSERT INTO documents VALUES('invoice','o1','c1','u1',true,$1,'INVOICE_DISTRIBUTOR','2026-09-01','invoice.pdf')`,[hash]);
 await db.query('INSERT INTO eva_closing_publications VALUES($1,\'o1\',\'c1\',$2,$3,now())',[publicationId,closing,hash]);
 await db.query('INSERT INTO eva_assisted_closing_versions VALUES($1,\'o1\',$2,\'2026-09\',$3)',[closing,hash,JSON.stringify({units:[{id:'u1',documentId:'invoice',sourceHash:hash}]})]);
 await db.query(`INSERT INTO document_ocr_jobs VALUES($1,'o1','invoice',$2,'SUCCEEDED',now())`,[job,hash]);await db.query(`INSERT INTO document_ocr_results VALUES($1,'o1','invoice',$2,'{"content":"private OCR"}')`,[job,hash]);
 let r=await read();check(r.units.length===1&&r.units[0].unitId==='u1');check(r.units[0].invoice.documentId==='invoice');check(r.units[0].publications.length===1);
 await db.exec("UPDATE documents SET file_hash=repeat('b',64) WHERE id='invoice'");check((await read()).units[0].invoice===null);await db.query("UPDATE documents SET file_hash=$1 WHERE id='invoice'",[hash]);
 await db.query(`INSERT INTO ccee_unit_authorizations VALUES($1,'o1','c1','u1','APPROVED',now(),'NO_LOSSES','["MEASUREMENTS"]','2026-01-01',NULL,1)`,[binding]);
 const result={complete:true,data:{timeSemantics:'CCEE_HOUR_LABEL_V2',rows:[],expectedHours:720,totalKwh:'1'},record:{evidence:{finality:'FINAL'},binding:{authorizationRevision:'1'}}};
 await db.query(`INSERT INTO ccee_integration_jobs VALUES($1,'o1',$2,'2026-09-01','PRODUCTION','MEASUREMENTS','FINAL','SUCCEEDED',$3,now())`,[job,binding,JSON.stringify(result)]);check((await read()).units[0].ccee.length===1);
 for(const change of ["UPDATE ccee_integration_jobs SET environment='PILOT'","UPDATE ccee_integration_jobs SET state='PARTIAL'","UPDATE ccee_unit_authorizations SET measurement_basis='WITH_LOSSES'","UPDATE ccee_unit_authorizations SET status='REVOKED'","UPDATE ccee_unit_authorizations SET valid_to='2026-09-29'","UPDATE ccee_integration_jobs SET month='2026-10-01'"]){await db.exec('BEGIN');await db.exec(change);check((await read()).units[0].ccee.length===0);await db.exec('ROLLBACK');}
 await db.query(`INSERT INTO ccee_unit_authorizations VALUES('10000000-0000-4000-8000-000000000005','o1','c1','u1','DRAFT',NULL,'NO_LOSSES','[]','2026-01-01',NULL,2)`);check((await read()).units[0].ccee.length===0);
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await deny(read);await db.exec('RESET ROLE');}
 await deny(()=>call('energy_forecast_client_sources',['o2',client,'client']));await deny(()=>call('energy_forecast_client_sources',['o1',actor,'r1']));
 for(const change of ["UPDATE organization_members SET status='INACTIVE' WHERE role_id='client'","UPDATE licenses SET report_generation=false WHERE organization_id='o1'","UPDATE roles SET permissions='[]' WHERE id='client'"]){await db.exec('BEGIN');await db.exec(change);await deny(read);await db.exec('ROLLBACK');}
 await db.exec('DELETE FROM planning_test_publications');check((await read()).units.length===0);
 check((await db.query("SELECT proconfig FROM pg_proc WHERE proname='energy_forecast_client_sources'")).rows[0].proconfig.includes('search_path=pg_catalog'));
 console.log(JSON.stringify({ok:true,checks}));
}finally{await db.close();}
