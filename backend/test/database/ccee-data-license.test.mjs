import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite(),actor='11111111-1111-4111-8111-111111111111',admin='22222222-2222-4222-8222-222222222222';let checks=0;
const ok=(v)=>{assert.ok(v);checks++;};
const reject=async(p,code)=>{await assert.rejects(p,e=>e.code===code);checks++;};
const migration=n=>readFileSync(new URL('../../src/database/migrations/'+n,import.meta.url),'utf8');
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE permissions(id uuid PRIMARY KEY,code text UNIQUE,name text,module text,resource text,action text);
 CREATE TABLE roles(id text PRIMARY KEY,name text,scope text,permissions jsonb,organization_id text);
 CREATE TABLE user_roles(user_id uuid,role_id text);
 CREATE TABLE organizations(id text PRIMARY KEY,name text,deleted_at timestamptz);
 CREATE TABLE organization_members(id text PRIMARY KEY,user_id uuid,organization_id text,status text,role_id text);
 CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
 CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,status text,deleted_at timestamptz);
 CREATE TABLE documents(id text PRIMARY KEY,organization_id text,upload_license_id text);
 CREATE TABLE audit_logs(id text,organization_id text NOT NULL,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text,ip_address text,user_agent text);
 CREATE TABLE licenses(id text PRIMARY KEY,organization_id text,license_type text,documents_limit int,documents_used int,renewal_date date,start_date date,end_date date,status text,active bool,max_consumer_units int,document_management bool,advanced_analytics bool,report_generation bool,free_market_management bool,updated_at timestamptz);
 INSERT INTO roles VALUES('global','admin_platform','global','[]',null);INSERT INTO user_roles VALUES('${actor}','global');INSERT INTO organizations VALUES('a','A',null),('b','B',null);`);
 for(const name of ['20260924_f1_15_plan_catalog.sql','20260925_f1_39_license_governance.sql'])await db.exec(migration(name));
 await db.exec(`ALTER TABLE plan_catalog ADD trading_hub boolean DEFAULT false,ADD bot_energy_rag boolean DEFAULT false,ADD ai_monthly_limit_micro_usd bigint DEFAULT 10000000,ADD monthly_price_brl_cents bigint;
 ALTER TABLE licenses ADD trading_hub boolean DEFAULT false,ADD bot_energy_rag boolean DEFAULT false,ADD ai_monthly_limit_micro_usd bigint DEFAULT 0,ADD monthly_price_brl_cents bigint;`);
 await db.exec(migration('20261008_ccee_registration_plan.sql'));
 const definition={name:'Available CCEE',description:'Explicit per organization',active:true,documents_limit:10,documents_unlimited:false,max_consumer_units:10,max_users:10,document_management:false,advanced_analytics:false,report_generation:false,free_market_management:true,ccee_registrations:false};
 const save=async(d=definition,id=null,v=null)=>(await db.query('SELECT save_catalog_plan($1,$2,$3,$4,null,null) p',[id,v,d,actor])).rows[0].p;
 const apply=async(org,p,prev=null,modules=null)=>(await db.query("SELECT save_plan_license($1,$2,$3,$4,$5,CURRENT_DATE,null,CURRENT_DATE,'ACTIVE',$6,$7,null,null) l",[org,prev?.id??null,prev?.governance_revision??null,p.id,p.version,modules,actor])).rows[0].l;
 const oldPlan=await save(),oldLicense=await apply('a',oldPlan);
 await db.exec(migration('20261212_ccee_data_license.sql'));
 ok((await db.query('SELECT ccee_data FROM plan_catalog WHERE id=$1',[oldPlan.id])).rows[0].ccee_data===false);
 ok((await db.query('SELECT ccee_data FROM licenses WHERE id=$1',[oldLicense.id])).rows[0].ccee_data===false);
 ok((await db.query('SELECT count(*)::int n FROM roles')).rows[0].n===1); // no automatic role grant
 const p=await save({...definition,name:'CCEE opt-in',ccee_data:true});ok(p.ccee_data);
 const b=await apply('b',p);ok(b.ccee_data===false);ok(b.plan_snapshot.ccee_data===true); // availability is not entitlement
 const modules={document_management:false,advanced_analytics:false,report_generation:false,free_market_management:true,ccee_data:true};
 const a=await apply('a',p,oldLicense,modules);ok(a.ccee_data);ok(a.governance_revision===oldLicense.governance_revision+1);
 const aLegacy=await apply('a',p,a);ok(aLegacy.ccee_data); // old client retains existing selection
 const same=await save({...definition,name:p.name},p.id,p.version);ok(same.ccee_data); // old catalog client retains availability
 await reject(apply('b',oldPlan,b,modules),'22023');
 await reject(save({...definition,name:'Bad',ccee_data:'yes'}),'22023');
 await reject(apply('b',p,b,{...modules,ccee_data:null}),'22023');
 await reject(apply('b',p,b,{...modules,ccee_data:'true'}),'22023');
 const availableOff=await save({...definition,name:p.name,ccee_data:false},same.id,same.version);ok(!availableOff.ccee_data);
 ok((await db.query('SELECT ccee_data FROM licenses WHERE id=$1',[a.id])).rows[0].ccee_data); // no retroactive catalog change
 const off=await apply('a',availableOff,aLegacy,{...modules,ccee_data:false});ok(!off.ccee_data);
 const audit=(await db.query("SELECT changes FROM audit_logs WHERE resource_type='license' AND resource_id=$1 AND changes->'after'->>'governance_revision'=$2",[off.id,String(off.governance_revision)])).rows;
 ok(audit.length===1);ok(audit[0].changes.before.ccee_data===true);ok(audit[0].changes.after.ccee_data===false);
 await reject(db.query('UPDATE licenses SET ccee_data=true WHERE id=$1',[off.id]),'42501');
 await db.exec(`INSERT INTO roles VALUES('admin-a','admin_org','organization','["f5364101-4486-42c2-a90f-807937ac3011","f5364101-4486-42c2-a90f-807937ac3012","f5364101-4486-42c2-a90f-807937ac3013"]','a');INSERT INTO organization_members VALUES('member','${admin}','a','active','admin-a');`);
 await reject(db.query("SELECT assert_ccee_data_actor('a',$1,'view')",[admin]),'42501'); // free_market alone is insufficient
 const pOn=await save({...definition,name:'Independent',free_market_management:false,ccee_data:true});
 const on=await apply('a',pOn,off,{...modules,free_market_management:false});ok(on.ccee_data&&!on.free_market_management);
 await db.query("SELECT assert_ccee_data_actor('a',$1,'review')",[admin]);checks++;
 await reject(db.query("SELECT assert_ccee_data_actor('b',$1,'view')",[admin]),'42501');
 const suspended=(await db.query("SELECT save_plan_license('a',$1,$2,$3,$4,CURRENT_DATE,null,CURRENT_DATE,'SUSPENDED',$5,$6,null,null) l",[on.id,on.governance_revision,pOn.id,pOn.version,{...modules,free_market_management:false},actor])).rows[0].l;
 ok(suspended.ccee_data);await reject(db.query("SELECT assert_ccee_data_actor('a',$1,'view')",[admin]),'42501');
 await db.exec('SET ROLE authenticated');await reject(save(),'42501');await db.exec('RESET ROLE');
 ok((await db.query("SELECT has_function_privilege('service_role','public.save_plan_license_before_ccee_data(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text)','execute') allowed")).rows[0].allowed===false);
 console.log(checks+' CCEE license checks passed: opt-in, legacy preservation, snapshots, audit, isolation, RBAC and license revocation.');
}finally{await db.close();}
