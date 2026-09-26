// Isolated database only; no production business records.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const ok=x=>{assert.ok(x);checks++;};
const migration=readFileSync(new URL('../../src/database/migrations/20260926_f1_59_review_snapshots.sql',import.meta.url),'utf8');
try{
 await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;CREATE TABLE organizations(id text primary key);CREATE TABLE customers(id text primary key,organization_id text,deleted_at timestamp);CREATE TABLE consumer_units(id text primary key,organization_id text,customer_id text);INSERT INTO organizations VALUES('a'),('b');INSERT INTO customers VALUES('c','a',null),('d','b',null);INSERT INTO consumer_units VALUES('u','a','c'),('v','b','d');GRANT SELECT ON consumer_units,customers TO service_role;");
 await db.exec(migration);await db.exec(migration);ok(true);
 const payload={formatVersion:'unit-review-snapshot-1.0',sources:{unit:{id:'u',organization_id:'a',customer_id:'c'}},result:{unit:{id:'u'},month:'2026-08',counts:{blockers:1}}};
 const insert=async({org='a',customer='c',unit='u',month='2026-08',status='DRAFT',body=payload,key='11111111-1111-4111-8111-111111111111'}={})=>db.query('INSERT INTO calculation_review_snapshots(organization_id,customer_id,consumer_unit_id,month,status,request_id,note,created_by,payload,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[org,customer,unit,month,status,key,'Revisão teste','actor',JSON.stringify(body),'a'.repeat(64)]);
 const reject=async fn=>{await assert.rejects(fn);checks++;};
 await db.exec('SET ROLE service_role');const first=(await insert()).rows[0];ok(first.version===1&&first.status==='DRAFT');await reject(()=>insert());
 const second=(await insert({key:'22222222-2222-4222-8222-222222222222'})).rows[0];ok(second.version===2);await reject(()=>insert({org:'b'}));await reject(()=>insert({customer:'d'}));await reject(()=>insert({unit:'v'}));await reject(()=>insert({status:'APPROVED'}));await reject(()=>insert({month:'2026-13'}));await reject(()=>insert({body:{...payload,result:{unit:{id:'v'},month:'2026-08'}}}));await reject(()=>insert({body:{...payload,sources:{unit:{id:'u',organization_id:'b',customer_id:'c'}}}}));
 await reject(()=>db.exec("UPDATE calculation_review_snapshots SET note='changed'"));await reject(()=>db.exec('DELETE FROM calculation_review_snapshots'));await reject(()=>db.exec('TRUNCATE calculation_review_snapshots'));
 for(const role of ['anon','authenticated']){await db.exec('RESET ROLE;SET ROLE '+role);await reject(()=>db.query('SELECT * FROM calculation_review_snapshots'));await reject(()=>insert());}
 await db.exec('RESET ROLE');await reject(()=>db.exec("UPDATE calculation_review_snapshots SET status='APPROVED'"));await reject(()=>db.exec('DELETE FROM calculation_review_snapshots'));
 ok((await db.query('SELECT count(*)::int n FROM calculation_review_snapshots')).rows[0].n===2);
 console.log(checks+' review snapshot database checks passed');
}finally{await db.close();}
