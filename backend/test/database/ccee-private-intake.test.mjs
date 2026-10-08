import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE organizations(id text PRIMARY KEY);INSERT INTO organizations VALUES('o1'),('o2');
 CREATE TABLE customers(id text PRIMARY KEY,organization_id text,deleted_at timestamptz);INSERT INTO customers VALUES('c1','o1',NULL),('c2','o2',NULL);
 CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text);INSERT INTO consumer_units VALUES('u1','o1','c1'),('u2','o2','c2');
 CREATE FUNCTION acl_preserve_record() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Immutable';END$$;`);
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261008_ccee_private_intake.sql',import.meta.url),'utf8'));
 const auth=randomUUID();
 const bind=(org='o1',client='c1',unit='u1',id=auth,status='APPROVED',revision=1)=>db.query(`INSERT INTO ccee_unit_authorizations(id,organization_id,customer_id,consumer_unit_id,profile_code,measurement_point,revision,status,evidence_reference,created_by,reviewed_by,reviewed_at) VALUES($1,$2,$3,$4,'80021','meter',$6,$5,'representation evidence','author','reviewer',now())`,[id,org,client,unit,status,revision]);
 await assert.rejects(bind('o1','c2','u2'),e=>e.code==='42501');await bind();
 const insert=()=>db.query(`INSERT INTO ccee_normalized_intake(organization_id,customer_id,consumer_unit_id,authorization_id,authorization_revision,kind,service,external_id,provider_revision,month,finality,source_hash,normalized_payload,state,retrieved_at) VALUES('o1','c1','u1',$1,1,'CREDIT','adapter','item','1','2026-08-01','FINAL',$2,'{}','READY_FOR_REVIEW',now())`,[auth,'a'.repeat(64)]);
 await insert();await assert.rejects(insert(),e=>e.code==='23505');
 await assert.rejects(db.query(`UPDATE ccee_unit_authorizations SET profile_code='999' WHERE id=$1`,[auth]));
 await assert.rejects(db.query(`UPDATE ccee_normalized_intake SET finality='PROVISIONAL'`));
 await bind('o1','c1','u1',randomUUID(),'REVOKED',2);
 await assert.rejects(insert(),e=>e.code==='42501');
 await db.exec('SET ROLE service_role');await assert.rejects(db.query('SELECT * FROM ccee_normalized_intake'),e=>e.code==='42501');await db.exec('RESET ROLE');
 console.log('CCEE private intake SQL: tenant binding, reviewed authorization, idempotency, revocation, immutability and blocked direct access passed');
}finally{await db.close();}
