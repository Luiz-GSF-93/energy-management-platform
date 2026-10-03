import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const db=new PGlite();let checks=0;const ok=x=>{assert.ok(x);checks++;};
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE organizations(id text PRIMARY KEY);CREATE TABLE customers(id text PRIMARY KEY,organization_id text,deleted_at timestamptz);CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text);CREATE TABLE documents(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,file_verified boolean);CREATE TABLE roles(id text PRIMARY KEY,organization_id text,scope text,name text,permissions jsonb);CREATE TABLE organization_members(organization_id text,user_id uuid,role_id text,status text);CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,expires_at timestamptz,revoked_at timestamptz);INSERT INTO organizations VALUES('a'),('b');INSERT INTO customers VALUES('c','a',null),('foreign','b',null);INSERT INTO consumer_units VALUES('u','a','c'),('foreign','b','foreign');INSERT INTO documents VALUES('doc','a','c','u',true),('foreign','b','foreign','foreign',true);`);
 const operator=randomUUID(),manager=randomUUID(),reader=randomUUID(),permissions=['6da45eb4-810c-4e40-9933-d9cda66a8841','cb949e2a-e01d-4cf0-8c69-6ca74fe4d627','d1f1b3be-a842-41e7-aeb1-45fefeb2f4c1','1479c0b7-9608-4e95-bd83-7e6899255a78','d617b0f0-0fba-42f8-8707-811070346ef0','489e6387-d5fc-4cb0-81f9-d7a76269dca5'];
 for(const [id,name,perm] of [[operator,'operacional',permissions],[manager,'gestor',permissions],[reader,'consulta',permissions]]){await db.query("INSERT INTO roles VALUES($1,'a','organization',$2,$3)",[id,name,JSON.stringify(perm)]);await db.query("INSERT INTO organization_members VALUES('a',$1::uuid,$1::text,'ACTIVE')",[id]);}
 await db.exec(await readFile(new URL('../../src/database/migrations/20261003_f3_1_operations.sql',import.meta.url),'utf8'));
 const data={title:'Conferir fatura',description:'Conferir a fatura do cliente com fonte original.',priority:'NORMAL',customerId:'c',unitId:'u',responsibleId:operator,documentId:'doc',dueAt:'2026-10-10T12:00:00Z',startsAt:'2026-10-09T23:00:00-03:00',requestType:'INVOICE'};
 const save=async(kind='agenda',id=null,rev=0,request=randomUUID(),d=data,actor=operator,org='a')=>(await db.query('select save_operation_record($1,$2,$3,$4,$5,$6,$7,$8) result',[org,actor,kind,id,request,rev,'Conferido pelo operador.',d])).rows[0].result;
 const transition=async(id,kind,rev,status,actor=operator,request=randomUUID(),org='a')=>(await db.query('select transition_operation_record($1,$2,$3,$4,$5,$6,$7,$8) result',[org,actor,kind,id,request,rev,'Revisado pelo responsável.',status])).rows[0].result;
 await db.exec('SET ROLE service_role');
 const request=randomUUID(),a=await save('agenda',null,0,request);ok(a.revision===1&&a.status==='OPEN');ok(a.effective_date==='2026-10-09');ok((await save('agenda',null,0,request)).id===a.id);
 await assert.rejects(()=>save('agenda',null,0,request,{...data,title:'Different content'}),e=>e.code==='P2032');checks++;
 for(const d of [{...data,customerId:'foreign'},{...data,unitId:'foreign'},{...data,documentId:'foreign'},{...data,responsibleId:randomUUID()}]){await assert.rejects(()=>save('agenda',null,0,randomUUID(),d),e=>e.code==='P2031');checks++;}
 await assert.rejects(()=>save('agenda',null,0,randomUUID(),data,operator,'b'),e=>e.code==='P2031');checks++;
 await assert.rejects(()=>save('agenda',null,0,randomUUID(),data,reader),e=>e.code==='P2031');checks++;
 const b=await save('agenda',a.id,1,randomUUID(),{...data,title:'Atualizado com fonte'});ok(b.revision===2);await assert.rejects(()=>save('agenda',a.id,1),e=>e.code==='P2032');checks++;
 const done=await transition(a.id,'agenda',2,'DONE');ok(done.revision===3);await assert.rejects(()=>save('agenda',a.id,3),e=>e.code==='P2032');checks++;
 const e=await save('events');await assert.rejects(()=>transition(e.id,'events',1,'PUBLISHED',manager),x=>x.code==='P2031');checks++;
 const review=await transition(e.id,'events',1,'REVIEW');ok(review.revision===2);await assert.rejects(()=>transition(e.id,'events',2,'PUBLISHED'),x=>x.code==='P2031');checks++;
 const pub=await transition(e.id,'events',2,'PUBLISHED',manager);ok(pub.status==='PUBLISHED');await assert.rejects(()=>save('events',e.id,3),x=>x.code==='P2032');checks++;
 const req=await save('requests');ok(req.status==='OPEN');await db.query('select read_operation_notification($1,$2,$3)',['a',operator,req.id+':1']);await db.query('select read_operation_notification($1,$2,$3)',['a',operator,req.id+':1']);ok((await db.query('select count(*)::int n from operation_notification_reads')).rows[0].n===1);
 await assert.rejects(()=>db.query('select read_operation_notification($1,$2,$3)',['b',operator,req.id+':1']),x=>x.code==='P2033');checks++;
 await assert.rejects(()=>db.query('update operation_records set title=$1 where id=$2',['Unauthorized',req.id]),x=>x.code==='42501');checks++;
 ok((await db.query('select count(*)::int n from operation_record_history')).rows[0].n===7);
 await db.exec('RESET ROLE');await assert.rejects(()=>db.exec('delete from operation_record_history'),x=>x.code==='P2032');checks++;
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(()=>db.exec('select * from operation_records'),x=>x.code==='42501');checks++;await assert.rejects(()=>save(),x=>x.code==='42501');checks++;await db.exec('RESET ROLE');}
 console.log(JSON.stringify({checks,result:'PASS'}));
}finally{await db.close();}
