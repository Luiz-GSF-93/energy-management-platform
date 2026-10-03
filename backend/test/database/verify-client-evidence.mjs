import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const db=new PGlite();let checks=0;const ok=v=>{assert.ok(v);checks++;};
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text,public boolean,allowed_mime_types text[]);INSERT INTO storage.buckets VALUES('energy-documents-private',false,ARRAY['application/pdf']);CREATE TABLE organizations(id text PRIMARY KEY);CREATE TABLE customers(id text PRIMARY KEY,organization_id text,status text,deleted_at timestamptz);CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text);CREATE TABLE documents(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,file_verified boolean,uploaded_by_auth_user_id uuid,document_type text);CREATE TABLE roles(id text PRIMARY KEY,organization_id text,scope text,name text,permissions jsonb);CREATE TABLE users(auth_user_id uuid,organization_id text,name text);CREATE TABLE organization_members(organization_id text,user_id uuid,role_id text,status text,display_name text,affiliation_type text,exclusive_customer_id text);CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,expires_at timestamptz,revoked_at timestamptz);INSERT INTO organizations VALUES('a'),('b');INSERT INTO customers VALUES('c','a','ACTIVE',null),('foreign','b','ACTIVE',null);INSERT INTO consumer_units VALUES('u','a','c'),('u2','a','c'),('foreign','b','foreign');`);
 const operator=randomUUID(),client=randomUUID(),other=randomUUID(),internal=randomUUID(),upload=randomUUID(),foreign=randomUUID();
 const permissions=['6da45eb4-810c-4e40-9933-d9cda66a8841','cb949e2a-e01d-4cf0-8c69-6ca74fe4d627','8f105b02-4443-49de-b188-847e0284e7ed'];
 for(const [id,org,name,perm,aff,c] of [[operator,'a','operacional',permissions,'internal',null],[client,'a','consulta',['3ebadd32-6f30-459e-8ed3-0d2843d89946'],'external','c'],[other,'b','consulta',['3ebadd32-6f30-459e-8ed3-0d2843d89946'],'external','foreign'],[internal,'a','consulta',['3ebadd32-6f30-459e-8ed3-0d2843d89946'],'internal','c']]){await db.query('INSERT INTO roles VALUES($1,$2,$3,$4,$5)',[id,org,'organization',name,JSON.stringify(perm)]);await db.query('INSERT INTO organization_members VALUES($1,$2::uuid,$2,$3,$4,$5,$6)',[org,id,'ACTIVE','Solicitante real',aff,c]);}
 await db.query("INSERT INTO documents VALUES($1,'a','c','u',true,$2,'OTHER'),($3,'b','foreign','foreign',true,$4,'OTHER')",[upload,client,foreign,other]);
 await db.exec(await readFile(new URL('../../src/database/migrations/20261003_f3_1_operations.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../src/database/migrations/20261003_f3_3_client_evidence.sql',import.meta.url),'utf8'));
 const data={title:'Atividade interna',description:'Nota interna não disponibilizada',priority:'NORMAL',customerId:'c',unitId:'u',responsibleId:operator,startsAt:'2026-10-04T12:00:00Z'};
 const save=async(id=null,revision=0,d=data)=>(await db.query('SELECT save_operation_record($1,$2,$3,$4,$5,$6,$7,$8) result',['a',operator,'agenda',id,randomUUID(),revision,'Fonte do registro',d])).rows[0].result;
 const append=async(actor=operator,record=null,request=randomUUID(),direction='OUTBOUND',docs=[],org='a',body='Mensagem ao cliente')=>(await db.query('SELECT append_operation_client_message($1,$2,$3,$4,$5,$6,$7,$8) result',[org,actor,record,request,direction,'Assunto externo',body,docs])).rows[0].result;
 const reject=async(f,code)=>{await assert.rejects(f,e=>e.code===code);checks++;};
 await db.exec('SET ROLE service_role');const r=await save();ok(r.operation_number>0&&r.requested_by_name==='Solicitante real');
 await reject(()=>append(client,r.id,randomUUID(),'INBOUND'), 'P2033');
 const request=randomUUID(),m=await append(operator,r.id,request,'OUTBOUND',[upload]);ok(m.document_ids[0]===upload&&m.actor_name==='Solicitante real');ok((await append(operator,r.id,request,'OUTBOUND',[upload])).id===m.id);
 await reject(()=>append(operator,r.id,request,'OUTBOUND',[upload],'a','Mudou a mensagem'), 'P2032');
 await reject(()=>append(operator,r.id,randomUUID(),'OUTBOUND',[foreign]), 'P2031');
 await reject(()=>append(other,r.id,randomUUID(),'INBOUND',[],'a'), 'P2031');
 await reject(()=>append(internal,r.id,randomUUID(),'INBOUND'), 'P2031');
 await reject(()=>append(client,r.id,randomUUID(),'INBOUND',[foreign]), 'P2031');
 const reply=await append(client,r.id,randomUUID(),'INBOUND',[upload]);ok(reply.direction==='INBOUND');
 await db.query('SELECT open_operation_client_message($1,$2,$3)',['a',client,m.id]);await db.query('SELECT open_operation_client_message($1,$2,$3)',['a',client,m.id]);ok((await db.query('SELECT count(*)::int n FROM operation_client_reads')).rows[0].n===1);
 await reject(()=>db.query('SELECT open_operation_client_message($1,$2,$3)',['a',other,m.id]),'P2031');
 await reject(()=>db.query('SELECT open_operation_client_message($1,$2,$3)',['a',client,reply.id]),'P2033');
 await reject(()=>save(r.id,1,{...data,unitId:'u2'}),'P2032');
 const changed=await save(r.id,1,{...data,title:'Título interno revisado'});ok(changed.operation_number===r.operation_number&&changed.created_at===r.created_at);
 await reject(()=>db.exec('UPDATE operation_client_messages SET body=\'Alteração indevida\''),'42501');
 await reject(()=>db.exec('DELETE FROM operation_client_reads'),'42501');
 await db.exec('RESET ROLE');await reject(()=>db.exec('DELETE FROM operation_client_messages'),'P2032');
 await db.query("UPDATE roles SET permissions='[]' WHERE id=$1",[client]);await db.exec('SET ROLE service_role');await reject(()=>append(client,r.id,randomUUID(),'INBOUND'),'P2031');await db.exec('RESET ROLE');
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await reject(()=>db.exec('SELECT * FROM operation_client_messages'),'42501');await reject(()=>append(operator,r.id),'42501');await db.exec('RESET ROLE');}
 ok((await db.query("SELECT allowed_mime_types FROM storage.buckets")).rows[0].allowed_mime_types.includes('text/csv'));
 ok((await db.query('SELECT count(*)::int n FROM operation_client_messages')).rows[0].n===2);
 console.log(JSON.stringify({checks,result:'PASS'}));
}finally{await db.close();}
