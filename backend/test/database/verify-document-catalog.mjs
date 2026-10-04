// Isolated PostgreSQL-compatible checks, never production.
import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const ok=v=>{assert.ok(v);checks++;};const deny=async(sql,params=[])=>{await assert.rejects(()=>db.query(sql,params));checks++;};
const operator='00000000-0000-4000-8000-000000000001',manager='00000000-0000-4000-8000-000000000002';
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
 CREATE TABLE organizations(id text PRIMARY KEY);INSERT INTO organizations VALUES('a'),('b');
 CREATE TABLE licenses(organization_id text,active boolean,status text,start_date date,end_date date,document_management boolean);INSERT INTO licenses VALUES('a',true,'ACTIVE','2020-01-01','2030-01-01',true),('b',true,'ACTIVE','2020-01-01','2030-01-01',true);
 CREATE TABLE roles(id text,organization_id text,scope text,name text,permissions jsonb);
 INSERT INTO roles VALUES('op','a','organization','operacional','["8f105b02-4443-49de-b188-847e0284e7ed","613b71d0-67db-4761-9e11-61fdf63ac8d5"]'),('mgr','a','organization','gestor','["8f105b02-4443-49de-b188-847e0284e7ed","613b71d0-67db-4761-9e11-61fdf63ac8d5"]');
 CREATE TABLE organization_members(organization_id text,user_id uuid,role_id text,status text,affiliation_type text);
 INSERT INTO organization_members VALUES('a','${operator}','op','ACTIVE','internal'),('a','${manager}','mgr','ACTIVE','internal');
 CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
 CREATE TABLE documents(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,reference_month timestamp,document_type text,file_verified boolean,uploaded_by_auth_user_id uuid,file_hash text,UNIQUE(organization_id,file_hash));GRANT ALL ON documents TO service_role;
 CREATE FUNCTION preserve_operation_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'History immutable';END $$;
 INSERT INTO documents VALUES('legacy','a','c','u','2026-08-01','OTHER',true,'${operator}','legacy-hash');`);
 const migration=readFileSync(new URL('../../src/database/migrations/20261004_f3_7_document_catalog.sql',import.meta.url),'utf8');await db.exec(migration);
 ok((await db.query("SELECT tag FROM document_catalog WHERE document_id='legacy'")).rows[0].tag==='DRAFT');
 await db.exec('SET ROLE service_role');
 const insert=(id,previous=null,org='a',unit='u',month='2026-08-01',type='OTHER')=>db.query('INSERT INTO documents(id,organization_id,customer_id,consumer_unit_id,reference_month,document_type,file_verified,uploaded_by_auth_user_id,file_hash,catalog_previous_id) VALUES($1,$2,\'c\',$3,$4,$5,true,$6,$1,$7)',[id,org,unit,month,type,operator,previous]);
 await insert('d1');ok((await db.query("SELECT version FROM document_catalog WHERE document_id='d1'")).rows[0].version===1);
 await insert('d2','d1');let current=(await db.query("SELECT * FROM document_catalog WHERE document_id='d2'")).rows[0];ok(current.version===2&&current.tag==='REVIEWED'&&current.previous_id==='d1'&&current.series_id==='d1');
 for(const options of [['bad-org','d2','b'],['bad-unit','d2','a','x'],['bad-month','d2','a','u','2026-09-01'],['bad-type','d2','a','u','2026-08-01','CONTRACT_ENERGY'],['stale','d1']]){await assert.rejects(()=>insert(...options));checks++;}
 const save=(actor,tag,rev=1,checked=true,reason='Conferido no documento original e suas assinaturas.')=>db.query('SELECT save_document_catalog($1,$2,$3,$4,$5,$6,$7) AS saved',['a',actor,'d2',rev,tag,reason,checked]);
 await deny('SELECT save_document_catalog($1,$2,$3,1,\'APPROVED\',\'Conferido no documento original.\',true)',['a',operator,'d2']);
 await assert.rejects(()=>save(manager,'APPROVED',1,false));checks++;
 await assert.rejects(()=>save(manager,'APPROVED',1,true,'curto'));checks++;
 await save(manager,'APPROVED');current=(await db.query("SELECT * FROM document_catalog WHERE document_id='d2'")).rows[0];ok(current.revision===2&&current.tag==='APPROVED');
 await assert.rejects(()=>save(operator,'DRAFT',2));checks++;
 await assert.rejects(()=>save(manager,'OBSOLETE',1));checks++;
 await save(manager,'OBSOLETE',2);ok((await db.query("SELECT count(*) AS n FROM document_catalog_events WHERE document_id='d2'")).rows[0].n===3);
 await deny("UPDATE document_catalog SET tag='APPROVED' WHERE document_id='d1'");await deny("DELETE FROM document_catalog_events WHERE document_id='d2'");
 await deny('SELECT favorite_document($1,$2,$3,true)',['b',operator,'d1']);await deny('SELECT favorite_document($1,$2,$3,true)',['a',operator,'missing']);
 await db.query('SELECT favorite_document($1,$2,$3,true)',['a',operator,'d1']);await db.query('SELECT favorite_document($1,$2,$3,true)',['a',operator,'d1']);await db.query('SELECT favorite_document($1,$2,$3,true)',['a',manager,'d1']);ok((await db.query("SELECT count(*) AS n FROM document_favorites")).rows[0].n===2);
 await db.query('SELECT favorite_document($1,$2,$3,false)',['a',operator,'d1']);ok((await db.query("SELECT actor_id FROM document_favorites")).rows[0].actor_id===manager);
 await db.exec("RESET ROLE;UPDATE licenses SET active=false WHERE organization_id='a';SET ROLE service_role");await assert.rejects(()=>save(manager,'MODEL',3));checks++;
 await db.exec('RESET ROLE;SET ROLE anon');await deny('SELECT * FROM document_catalog');await deny('SELECT * FROM document_favorites');await deny('SELECT favorite_document($1,$2,$3,true)',['a',manager,'d1']);
 console.log('Document catalog: '+checks+' isolated checks passed (RBAC, license, private metadata, immutable history, versions, scope, concurrency and favorites).');
}finally{await db.close();}
