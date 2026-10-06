import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const db=new PGlite(),actor='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222';let checks=0;
const migration=n=>readFileSync(new URL('../../src/database/migrations/'+n,import.meta.url),'utf8');
const fail=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
const ok=v=>{assert.ok(v);checks++;};
try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE TABLE organizations(id text PRIMARY KEY);INSERT INTO organizations VALUES('org'),('other');
CREATE TABLE customers(id text PRIMARY KEY,organization_id text,company_name text,document text,deleted_at timestamp);
CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_number text,address text,city text,state text,free_market boolean);
CREATE TABLE roles(id text PRIMARY KEY,organization_id text,permissions jsonb);
CREATE TABLE organization_members(user_id uuid,organization_id text,role_id text,status text);
CREATE TABLE platform_organization_sessions(user_id uuid,organization_id text,expires_at timestamptz,revoked_at timestamptz);
CREATE TABLE documents(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,reference_month timestamp,file_verified boolean,document_type text,file_hash text);
CREATE TABLE document_ocr_jobs(id uuid PRIMARY KEY,organization_id text,document_id text,file_hash text,state text);
CREATE TABLE document_ocr_results(job_id uuid,organization_id text,document_id text,file_hash text);
INSERT INTO customers VALUES('c','org','Empresa','123',NULL);
INSERT INTO consumer_units VALUES('u','org','c','UC1','Rua Antiga 100','Cidade','SP',false);
INSERT INTO roles VALUES('r','org','["8f105b02-4443-49de-b188-847e0284e7ed","92e1b670-ab10-483a-b825-c6e16799496d"]');
INSERT INTO organization_members VALUES('${actor}','org','r','ACTIVE');
INSERT INTO documents VALUES('d','org','c','u','2026-08-01',true,'INVOICE_DISTRIBUTOR',repeat('a',64));
INSERT INTO document_ocr_jobs VALUES('${job}','org','d',repeat('a',64),'SUCCEEDED');
INSERT INTO document_ocr_results SELECT id,organization_id,document_id,file_hash FROM document_ocr_jobs;
-- Map actor RPC has its own regression suite; fixture preserves its fail-closed boundary.
CREATE FUNCTION public.assert_energy_map_actor(o text,a text,manage boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=o AND user_id::text=a AND status='ACTIVE') THEN RAISE EXCEPTION 'Actor denied' USING ERRCODE='42501';END IF;END $$;`);
await db.exec(migration('20260927_f1_84_registration_edits.sql'));
await db.exec(migration('20261005_f14_reviewed_unit_address.sql'));
const snapshot=async()=>{const u=(await db.query("SELECT id,customer_id,consumer_unit_number,address,city,state,edit_version FROM consumer_units WHERE id='u'")).rows[0];return {format:'ocr-address-correction-v1',jobId:job,unit:u,document:(await db.query("SELECT id,organization_id,customer_id,consumer_unit_id,to_char(reference_month,'YYYY-MM-DD') as reference_month,file_verified,document_type,file_hash FROM documents WHERE id='d'")).rows[0],registration:{customer:(await db.query("SELECT company_name,document FROM customers WHERE id='c'")).rows[0],unit:(await db.query("SELECT consumer_unit_number,address,free_market FROM consumer_units WHERE id='u'")).rows[0]}};};
const input=(s)=>({address:'Rua Nova 100',city:'Cidade Nova',state:'SP',reason:'Conferido no PDF e na UC vinculada.',sourceHash:'b'.repeat(64),expectedVersion:s.unit.edit_version,requestId:randomUUID(),checkedPdf:true,checkedUnit:true});
const save=(s,i,org='org',who=actor)=>db.query('SELECT public.save_reviewed_unit_address($1,$2,$3,$4,$5) AS result',[org,who,'d',i,s]);
const s=await snapshot(),i=input(s);
for(const patch of [{checkedPdf:false},{checkedUnit:false},{sourceHash:null},{expectedVersion:-1},{expectedVersion:0.5},{requestId:'bad'},{address:'Rua;bad'},{city:null},{state:'XX'},{reason:'curto'},{organizationId:'other'}])await fail(()=>save(s,{...i,...patch}),'22023');
await fail(()=>save(s,i,'other'),'42501');await fail(()=>save(s,i,'org',randomUUID()),'42501');
await fail(()=>save({...s,unit:{...s.unit,edit_version:1}},i),'40001');
await fail(()=>save({...s,registration:{...s.registration,customer:{company_name:'changed',document:'123'}}},i),'40001');
await fail(()=>save({...s,document:{...s.document,file_hash:'c'.repeat(64)}},i),'40001');
await db.exec("UPDATE documents SET file_verified=false WHERE id='d'");await fail(()=>save(s,i),'40001');await db.exec("UPDATE documents SET file_verified=true WHERE id='d'");
await db.exec("UPDATE document_ocr_jobs SET state='FAILED'");await fail(()=>save(s,i),'40001');await db.exec("UPDATE document_ocr_jobs SET state='SUCCEEDED'");
await db.exec("INSERT INTO documents SELECT 'duplicate',organization_id,customer_id,consumer_unit_id,reference_month,file_verified,document_type,file_hash FROM documents");await fail(()=>save(s,i),'40001');await db.exec("DELETE FROM documents WHERE id='duplicate'");
await db.exec("UPDATE roles SET permissions='[]'");await fail(()=>save(s,i),'42501');await db.exec(`UPDATE roles SET permissions='["8f105b02-4443-49de-b188-847e0284e7ed","92e1b670-ab10-483a-b825-c6e16799496d"]'`);
await db.exec('SET ROLE service_role');const result=(await save(s,i)).rows[0].result;ok(result.address===i.address&&result.city===i.city&&result.edit_version===1);
assert.deepEqual((await save(s,i)).rows[0].result,result);checks++;
await fail(()=>save(s,{...i,reason:'Different long enough correction reason'}),'40001');
await fail(()=>save(s,{...i,requestId:randomUUID()}),'40001');
ok((await db.query('SELECT * FROM ocr_unit_address_corrections')).rows.length===1);ok((await db.query('SELECT * FROM registration_edits')).rows.length===1);
await fail(()=>db.exec("UPDATE ocr_unit_address_corrections SET created_by='forged'"),'42501');await fail(()=>db.exec('DELETE FROM ocr_unit_address_corrections'),'42501');
await db.exec('RESET ROLE');await fail(()=>db.exec('DELETE FROM ocr_unit_address_corrections'),'23514');
const fresh=await snapshot();await fail(()=>save(fresh,{...input(fresh),address:fresh.unit.address,city:fresh.unit.city}),'P3841');
// A failed origin audit must roll back the cadastral edit and registration audit together.
await db.exec("CREATE FUNCTION reject_address_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure' USING ERRCODE='P9999';END $$;CREATE TRIGGER reject_address_origin BEFORE INSERT ON ocr_unit_address_corrections FOR EACH ROW EXECUTE FUNCTION reject_address_origin();");
await fail(()=>save(fresh,{...input(fresh),address:'Rua Outra 200'}),'P9999');ok((await snapshot()).unit.edit_version===1);ok((await db.query('SELECT * FROM registration_edits')).rows.length===1);
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await fail(()=>save(s,i),'42501');await fail(()=>db.exec('SELECT * FROM ocr_unit_address_corrections'),'42501');await db.exec('RESET ROLE');}
console.log(checks+' database checks passed: reviewed address, isolation, stale origin, replay, immutable and atomic audit.');
}finally{await db.close();}
