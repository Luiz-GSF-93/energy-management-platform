import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const check=v=>{assert.ok(v);checks++;},deny=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
const customer=randomUUID(),unit=randomUUID(),contact=randomUUID(),foreign=randomUUID();
const config={name:'Mensal',customerId:customer,unitId:unit,frequency:'MONTHLY',days:[5],hour:9,monthlyLimit:1,kinds:['OPERATIONAL'],formats:['pdf'],channels:['email'],contactIds:[contact]};
const contacts=[{id:contact,name:'Consultor',department:'Financeiro',email:'test@example.invalid',phone:'+5516999999999',active:true,channels:['email','sms']}];
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE organizations(id text PRIMARY KEY,deleted_at timestamptz);INSERT INTO organizations VALUES('o1',NULL),('o2',NULL);
 CREATE TABLE customers(id text PRIMARY KEY,organization_id text,status text,deleted_at timestamptz,company_name text,report_contacts jsonb DEFAULT '[]');
 CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text,status text,name text);
 CREATE TABLE licenses(organization_id text,active boolean,status text,start_date date,end_date date,report_generation boolean,free_market_management boolean);INSERT INTO licenses VALUES('o1',true,'ACTIVE','2020-01-01',NULL,true,true),('o2',true,'ACTIVE','2020-01-01',NULL,true,true);
 CREATE TABLE roles(id text,organization_id text,name text,scope text,permissions jsonb);CREATE TABLE organization_members(organization_id text,user_id text,role_id text,status text);
 CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
 CREATE FUNCTION assert_license_platform_actor(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END $$;
 CREATE TABLE monthly_energy_settlements(organization_id text,customer_id text,consumer_unit_id text,financial_group_id uuid,status text,validation_status text,financial_hash text,version_number int,month date);`);
 await db.query("INSERT INTO customers VALUES($1,'o1','ACTIVE',NULL,'Cliente',$2),($3,'o2','ACTIVE',NULL,'Outro','[]')",[customer,JSON.stringify(contacts),foreign]);
 await db.query("INSERT INTO consumer_units VALUES($1,'o1',$2,'ACTIVE','Unidade')",[unit,customer]);
 const permissions=['3ebadd32-6f30-459e-8ed3-0d2843d89946','60f9690a-145b-4dba-b23f-9f945baca296','9541a7bb-c20a-4c4d-9f4c-2185262c8e9c','51da7cca-8196-4135-84ce-f989be5ee594'];
 await db.query("INSERT INTO roles VALUES('r1','o1','gestor','organization',$1),('r2','o2','gestor','organization',$1),('rc','o1','consulta','organization',$1)",[JSON.stringify(permissions)]);
 await db.exec("INSERT INTO organization_members VALUES('o1','a1','r1','ACTIVE'),('o2','a2','r2','ACTIVE'),('o1','client','rc','ACTIVE');");
 for(const file of ['20261006_r2_published_reports.sql','20261006_r3_report_recurrence.sql','20261007_whatsapp_delivery.sql','20261007_report_delivery.sql'])await db.exec(readFileSync(new URL('../../src/database/migrations/'+file,import.meta.url),'utf8'));
 const save=async(c=config,id=null,version=null,request=randomUUID(),org='o1',actor='a1')=>(await db.query('SELECT save_report_policy($1,$2,$3,$4,$5,$6) r',[org,actor,id,version,request,JSON.stringify(c)])).rows[0].r;
 const state=async(p,enabled=true,org='o1',actor='a1',request=randomUUID())=>(await db.query('SELECT set_report_policy_state($1,$2,$3,$4,$5,$6) r',[org,actor,p.id,p.version,request,enabled])).rows[0].r;
 const read=async(org='o1',actor='a1')=>(await db.query('SELECT read_report_configuration($1,$2) r',[org,actor])).rows[0].r;
 const claim=async()=>(await db.query('SELECT claim_report_preparation() r')).rows[0].r;
 const finish=async(j,reports=[],reason='WAITING_PUBLICATION')=>db.query('SELECT finish_report_preparation($1,$2,$3,$4,$5)',[j.organization_id,j.id,j.lease_id,JSON.stringify(reports),reason]);
 const request=randomUUID();let p=await save(config,null,null,request);check(p.state==='PAUSED'&&p.next_run===null);check((await save(config,null,null,request)).id===p.id);check((await read()).customers[0].contacts[0].id===contact);check((await read('o2','a2')).policies.length===0);
 await deny(()=>save({...config,channels:['sms']}),'22023');await deny(()=>save({...config,contactIds:[randomUUID()]}),'22023');await deny(()=>save({...config,customerId:foreign}),'P3862');await deny(()=>read('o1','a2'),'42501');await deny(()=>read('o1','client'),'42501');await deny(()=>state(p,true,'o2','a2'),'P3862');
 const slot=async(c,after)=>(await db.query('SELECT next_report_slot($1,$2) r',[JSON.stringify(c),after])).rows[0].r.toISOString();
 check((await slot({...config,days:[31]},'2028-02-01T00:00:00Z')).startsWith('2028-02-29T12:00:00'));
 check((await slot({...config,days:[31]},'2027-02-01T00:00:00Z')).startsWith('2027-02-28T12:00:00'));
 check((await slot({...config,frequency:'FORTNIGHTLY',days:[30,31],monthlyLimit:2},'2027-02-28T12:00:00Z')).startsWith('2027-03-30T12:00:00'));
 p=await state(p);check(p.state==='ACTIVE'&&Date.parse(p.next_run)>Date.now());await deny(()=>save(config,p.id,1),'40001');
 await db.query("UPDATE report_policies SET next_run=now()-interval '1 hour' WHERE id=$1",[p.id]);const first=await claim();check(first.job.config.unitId===unit&&first.context.organizationId==='o1');check(await claim()===null);check(Object.keys(first.job.requests).length===1);
 await finish(first.job);check((await read()).jobs[0].state==='WAITING_PUBLICATION');await deny(()=>finish(first.job),'40001');
 await db.query("UPDATE report_jobs SET retry_after=now()-interval '1 second' WHERE id=$1",[first.job.id]);const second=await claim();check(second.job.requests.OPERATIONAL===first.job.requests.OPERATIONAL&&second.job.lease_id!==first.job.lease_id);
 await deny(()=>finish(second.job,[{id:randomUUID(),kind:'OPERATIONAL'}],null),'40001');
 const month=second.job.month.slice(0,7),group=randomUUID(),hash='a'.repeat(64);await db.query("INSERT INTO monthly_energy_settlements VALUES('o1',$1,$2,$3,'PUBLISHED','VALIDATED',$4,1,$5)",[customer,unit,group,hash,month+'-01']);
 const req={kind:'OPERATIONAL',customerId:customer,unitId:unit,from:month,to:month,requestId:second.job.requests.OPERATIONAL},body={formatVersion:'energy-report-1.0',kind:'OPERATIONAL',header:{organizationId:'o1',customerId:customer,unitId:unit},period:{from:month,to:month},totals:{acr:'100.00'},publications:[{id:group,customerId:customer,month,version:1,payloadHash:hash}]};
 const captured=(await db.query("SELECT capture_published_report('o1','a1',$1,$2,$3) r",[JSON.stringify(req),JSON.stringify(body),hash])).rows[0].r;
 await finish(second.job,[{id:captured.id,kind:'OPERATIONAL'}],null);check((await read()).jobs[0].state==='READY');
 const claimDelivery=async(channels=['email'])=>(await db.query('SELECT claim_report_delivery($1) r',[JSON.stringify(channels)])).rows[0].r;
 const readDelivery=async(org='o1',actor='a1')=>(await db.query('SELECT read_report_deliveries($1,$2) r',[org,actor])).rows[0].r;
 const startDelivery=async(d,org=d.organization_id,lease=d.lease_id)=>(await db.query('SELECT start_report_delivery($1,$2,$3) r',[org,d.id,lease])).rows[0].r;
 const finishDelivery=async(d,state='ACCEPTED',provider='provider-one',reason=null)=>db.query('SELECT finish_report_delivery($1,$2,$3,$4,$5,$6)',[d.organization_id,d.id,d.lease_id,state,provider,reason]);
 check((await readDelivery()).length===1);check((await readDelivery('o2','a2')).length===0);
 await deny(()=>readDelivery('o1','a2'),'42501');await deny(()=>claimDelivery(['sms']),'22023');check(await claimDelivery([])===null);
 const deliveryClaim=await claimDelivery();check(deliveryClaim.context.organizationId==='o1'&&deliveryClaim.delivery.destination==='test@example.invalid');check(await claimDelivery()===null);
 await deny(()=>startDelivery(deliveryClaim.delivery,'o2'),'40001');await deny(()=>startDelivery(deliveryClaim.delivery,'o1',randomUUID()),'40001');
 check(await startDelivery(deliveryClaim.delivery)===true);await deny(()=>startDelivery(deliveryClaim.delivery),'40001');
 await finishDelivery(deliveryClaim.delivery);check((await readDelivery())[0].state==='ACCEPTED');await deny(()=>finishDelivery(deliveryClaim.delivery),'40001');check(await claimDelivery()===null);
 for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await deny(()=>db.exec('SELECT * FROM report_deliveries'),'42501');await db.exec('RESET ROLE');}
 // Expired network starts are marked unknown and cannot be silently resent.
 await db.query("UPDATE report_deliveries SET state='TRANSMITTING',lease_until=now()-interval '1 second' WHERE id=$1",[deliveryClaim.delivery.id]);check(await claimDelivery()===null);check((await readDelivery())[0].state==='UNKNOWN');
 // A contact change between claim and start blocks the final network action.
 await db.query("UPDATE report_deliveries SET state='QUEUED',provider_id=NULL WHERE id=$1",[deliveryClaim.delivery.id]);const secondDelivery=await claimDelivery();
 await db.query("UPDATE customers SET report_contacts=$1 WHERE id=$2",[JSON.stringify(contacts.map(c=>({...c,email:'changed@example.invalid'}))),customer]);
 check(await startDelivery(secondDelivery.delivery)===false);check((await readDelivery())[0].state==='BLOCKED');
 await db.query("UPDATE customers SET report_contacts=$1 WHERE id=$2",[JSON.stringify(contacts),customer]);

 await db.query("UPDATE report_policies SET next_run=now()-interval '1 minute' WHERE id=$1",[p.id]);check(await claim()===null);check((await read()).jobs.length===1);
 const changed=contacts.map(c=>({...c,email:'changed@example.invalid'}));await db.query('UPDATE customers SET report_contacts=$1 WHERE id=$2',[JSON.stringify(changed),customer]);await deny(()=>state(p),'40001');
 await db.query("UPDATE report_policies SET next_run=now()-interval '1 minute' WHERE id=$1",[p.id]);await claim();check((await read()).policies[0].state==='BLOCKED');
 p=await save(config,p.id,p.version);check(p.state==='PAUSED'&&p.contacts[0].email==='changed@example.invalid');p=await state(p);await db.query("UPDATE report_policies SET next_run=now()-interval '1 minute' WHERE id=$1",[p.id]);await db.exec("UPDATE licenses SET active=false WHERE organization_id='o1'");await claim();await deny(()=>read(),'42501');await db.exec("UPDATE licenses SET active=true WHERE organization_id='o1'");check((await read()).policies[0].reason==='ACCESS_REVOKED');
 for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await deny(()=>db.exec('SELECT * FROM report_policies'),'42501');await db.exec('RESET ROLE');}
 await db.exec('SET ROLE authenticated');await deny(()=>read(),'42501');await db.exec('RESET ROLE');await deny(()=>db.exec('DELETE FROM report_policy_history'),'23514');await deny(()=>db.exec('UPDATE report_job_events SET state=state'),'23514');
 await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(permissions.filter(x=>x!=='51da7cca-8196-4135-84ce-f989be5ee594'))]);await deny(()=>read(),'42501');
 console.log(JSON.stringify({ok:true,checks}));
}finally{await db.close();}
