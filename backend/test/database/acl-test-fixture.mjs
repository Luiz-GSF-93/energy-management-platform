// Disposable in-memory fixtures only. Never seed production with these records.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID,createHash } from 'node:crypto';
export async function aclFixture(database=null){
 const db=database??new PGlite(),actor=randomUUID(),peer=randomUUID(),client=randomUUID();
 const perms=['2c933fdf-0bbf-406a-915c-03e7921e54d8','820dc44f-15a0-4c2a-871e-2c1d2d443d9e','26cadaa7-2eea-4080-91f6-1f26f87ca809','cbb2e904-0718-4eec-9396-dba899118cdd','8f105b02-4443-49de-b188-847e0284e7ed'];
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE permissions(id uuid PRIMARY KEY,code text UNIQUE,name text,module text,resource text,action text);
 CREATE TABLE organizations(id text PRIMARY KEY,deleted_at timestamptz);INSERT INTO organizations VALUES('o1',NULL),('o2',NULL);
 CREATE TABLE customers(id text PRIMARY KEY,organization_id text,status text,deleted_at timestamptz,company_name text);INSERT INTO customers VALUES('c1','o1','ACTIVE',NULL,'C1'),('c2','o2','ACTIVE',NULL,'C2');
 CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text,status text,free_market boolean,tariff_subgroup text,name text);INSERT INTO consumer_units VALUES('u1','o1','c1','ACTIVE',false,'A4','U1'),('u1b','o1','c1','ACTIVE',false,'A4','U1b'),('u2','o2','c2','ACTIVE',false,'A4','U2');
 CREATE TABLE licenses(organization_id text,active boolean,status text,start_date date,end_date date,free_market_management boolean,document_management boolean);INSERT INTO licenses VALUES('o1',true,'ACTIVE',CURRENT_DATE-1,NULL,true,true),('o2',true,'ACTIVE',CURRENT_DATE-1,NULL,true,true);
 CREATE TABLE roles(id text PRIMARY KEY,organization_id text,name text,scope text,permissions jsonb);
 CREATE TABLE organization_members(organization_id text,user_id uuid,role_id text,status text,affiliation_type text,exclusive_customer_id text,display_name text);
 CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
 CREATE TABLE documents(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,file_verified boolean,file_hash text,document_type text,reference_month date,original_filename text);
 CREATE TABLE document_catalog(document_id text PRIMARY KEY,organization_id text,series_id text,version integer,revision integer,tag text);
 CREATE FUNCTION assert_license_platform_actor(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END$$;`);
 await db.query("INSERT INTO roles VALUES('r1','o1','gestor','organization',$1),('r2','o2','gestor','organization',$1),('client','o1','consulta','organization',$2)",[JSON.stringify(perms),JSON.stringify(['3ebadd32-6f30-459e-8ed3-0d2843d89946'])]);
 await db.query("INSERT INTO organization_members VALUES('o1',$1,'r1','ACTIVE','internal',NULL,'Consultor 1'),('o1',$2,'r1','ACTIVE','internal',NULL,'Consultor 2'),('o1',$3,'client','ACTIVE','external','c1','Cliente')",[actor,peer,client]);
 const migrate=async name=>db.exec(readFileSync(new URL('../../src/database/migrations/'+name,import.meta.url),'utf8'));
 for(const name of ['20261006_acl_admission_registry.sql','20261006_acl_admission_timer.sql','20261006_acl_admission_evidence.sql'])await migrate(name);
 const call=async(name,args)=>(await db.query(`SELECT ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS value`,args)).rows[0].value;
 const create=()=>call('acl_create',['o1',actor,'r1',false,randomUUID(),'c1','u1']);
 const work=(id,revision,stage,action,who=actor)=>call('acl_work_command',['o1',who,'r1',false,id,randomUUID(),revision,stage,action,null,null]);
 const evidence=(id,revision,action,opts={})=>call('acl_evidence_command',[opts.org??'o1',opts.actor??actor,opts.role??'r1',false,id,opts.request??randomUUID(),revision,action,opts.stage??null,opts.evidence??null,opts.documents??null,opts.note??null,opts.facts??null,opts.kind??null,opts.checked??true]);
 const doc=async(id,type='OTHER',month='2026-09-01',unit='u1',org='o1',customer='c1')=>{
  await db.query('INSERT INTO documents VALUES($1,$2,$3,$4,true,$5,$6,$7,$8)',[id,org,customer,unit,createHash('sha256').update(id).digest('hex'),type,month,id+'.pdf']);
  await db.query("INSERT INTO document_catalog VALUES($1,$2,$1,1,1,'REVIEWED')",[id,org]);return id;
 };
 return{db,actor,peer,client,perms,call,migrate,create,work,evidence,doc};
}
