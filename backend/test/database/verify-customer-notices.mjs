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
 for(const file of ['20261006_r2_published_reports.sql','20261006_r3_report_recurrence.sql','20261007_whatsapp_delivery.sql','20261007_report_delivery.sql','20261007_sms_delivery.sql'])await db.exec(readFileSync(new URL('../../src/database/migrations/'+file,import.meta.url),'utf8'));
 await db.exec(`CREATE TABLE operation_records(id uuid PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,kind text,revision int,status text,due_at timestamptz,starts_at timestamptz,updated_at timestamptz DEFAULT now());
 CREATE TABLE acl_admissions(id uuid PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text);
 CREATE TABLE acl_admission_public_summaries(organization_id text,admission_id uuid,published_at timestamptz DEFAULT now());
 CREATE FUNCTION assert_operation_actor(p_org text,p_actor text,p_kind text,p_write boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org AND user_id=p_actor AND status='ACTIVE') THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END IF;END $$;
 CREATE FUNCTION acl_operation_allowed(p_org text,p_actor text,p_id uuid,p_write boolean) RETURNS boolean LANGUAGE sql AS $$ SELECT NOT EXISTS(SELECT 1 FROM public.operation_records WHERE id=p_id AND status='PRIVATE') $$;`);
 await db.query("UPDATE roles SET permissions=permissions||$1::jsonb WHERE id IN ('r1','r2','rc')",[JSON.stringify(['cbb2e904-0718-4eec-9396-dba899118cdd','b142bd7b-05a3-45ee-befd-e593066c2775'])]);
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261007_customer_notices.sql',import.meta.url),'utf8'));
 const nc={customerId:customer,unitId:unit,events:['REQUEST','AGENDA','ACL_PUBLISHED'],channels:['email','sms'],contactIds:[contact]};
 const save=async(c=nc,p=null,enabled=false,org='o1',actor='a1',request=randomUUID())=>(await db.query('SELECT save_customer_notice_policy($1,$2,$3,$4,$5,$6,$7) r',[org,actor,p?.id??null,p?.version??null,request,JSON.stringify(c),enabled])).rows[0].r;
 const read=async(org='o1',actor='a1')=>(await db.query('SELECT read_customer_notices($1,$2) r',[org,actor])).rows[0].r;
 const claim=async(channels=['email','sms'])=>(await db.query('SELECT claim_customer_notice($1) r',[JSON.stringify(channels)])).rows[0].r;
 const start=async(d,org=d.organization_id,lease=d.lease_id)=>(await db.query('SELECT start_customer_notice($1,$2,$3) r',[org,d.id,lease])).rows[0].r;
 const finish=async(d,state='ACCEPTED',provider='SM'+'1'.repeat(32),reason=null)=>db.query('SELECT finish_customer_notice($1,$2,$3,$4,$5,$6)',[d.organization_id,d.id,d.lease_id,state,provider,reason]);
 const record=async(kind='requests',status='OPEN',due='1 hour')=>{const id=randomUUID();await db.query("INSERT INTO operation_records(id,organization_id,customer_id,consumer_unit_id,kind,revision,status,due_at,starts_at) VALUES($1,'o1',$2,$3,$4,1,$5,now()+$6::interval,now()+$6::interval)",[id,customer,unit,kind,status,due]);return id;};
 const oldRecord=await record();let p=await save();check(p.state==='PAUSED');check(await claim()===null);
 await deny(()=>save(nc,null,true),'22023');await deny(()=>save({...nc,customerId:foreign}),'P3862');await deny(()=>read('o1','a2'),'42501');await deny(()=>read('o1','client'),'42501');await deny(()=>save({...nc,events:['UNAPPROVED']}),'22023');await deny(()=>save({...nc,channels:['sms']}),'22023');await deny(()=>save({...nc,contactIds:[randomUUID()]}),'22023');await deny(()=>save({...nc,extra:true}),'22023');
 p=await save(nc,p,true);check(p.state==='ACTIVE');check(await claim()===null);check((await read()).deliveries.length===0); // existing requests never backfill
 const created=await record();check((await read()).deliveries.length===2);await deny(()=>save(nc,{...p,version:1},true),'40001');
 check(await claim(['sms'])===null);const acceptedEmail=await claim(['email']);check(await start(acceptedEmail));await finish(acceptedEmail,'ACCEPTED','email-first');let d=await claim(['sms']);check(d.channel==='sms'&&d.destination===contacts[0].phone);check(await claim(['sms'])===null);await deny(()=>start(d,'o2'),'40001');await deny(()=>start(d,'o1',randomUUID()),'40001');check(await start(d));
 const sid='SM'+'1'.repeat(32);await db.query("SELECT record_sms_receipt($1,$2,'delivered',NULL)",[d.id,sid]);await finish(d,'ACCEPTED',sid);await db.query("SELECT record_sms_receipt($1,$2,'sent',NULL)",[d.id,sid]);await db.query("SELECT record_sms_receipt($1,$2,'delivered',NULL)",[d.id,sid]);check((await read()).deliveries.find(x=>x.id===d.id).deliveryStatus==='delivered');check((await db.query('SELECT count(*)::int n FROM sms_delivery_receipts WHERE delivery_id=$1',[d.id])).rows[0].n===2);
 await deny(()=>finish(d),'40001');const foreignSid='SM'+'2'.repeat(32);await db.query("SELECT record_sms_receipt($1,$2,'failed',NULL)",[d.id,foreignSid]);check((await db.query('SELECT count(*)::int n FROM sms_delivery_receipts WHERE message_sid=$1',[foreignSid])).rows[0].n===0);
 // Contact changed after claim prevents network start.
 await record();d=await claim(['email']);await db.query('UPDATE customers SET report_contacts=$1 WHERE id=$2',[JSON.stringify(contacts.map(c=>({...c,email:'changed@example.invalid'}))),customer]);check(await start(d)===false);check((await read()).deliveries.find(x=>x.id===d.id).state==='BLOCKED');
 await deny(()=>save(nc,p,true),'40001');p=await save(nc,p,false);check(p.state==='PAUSED');p=await save(nc,p,true);
 const privateId=await record('requests','PRIVATE');check(await claim(['email'])===null);check((await read()).deliveries.find(x=>x.event==='REQUEST'&&x.state==='BLOCKED')); // ACL restriction
 const active=await record();d=await claim(['email']);check(d.source_id===active);await db.query('UPDATE operation_records SET revision=2,updated_at=now() WHERE id=$1',[active]);check(await start(d)===false);
 d=await claim(['email']);check(d.source_version===2);p=await save(nc,p,false);check(await start(d)===false);p=await save(nc,p,true);
 const uncertain=await record();d=await claim(['email']);check(d.source_id===uncertain);check(await start(d));await db.query("UPDATE customer_notice_deliveries SET lease_until=now()-interval '1 second' WHERE id=$1",[d.id]);await claim(['email']);check((await read()).deliveries.find(x=>x.id===d.id).state==='UNKNOWN');
 const expiry=await record();await db.query("UPDATE customer_notice_deliveries SET expires_at=now()-interval '1 second' WHERE source_id=$1",[expiry]);await claim(['email']);check((await read()).deliveries.filter(x=>x.state==='BLOCKED'&&x.reason==='EXPIRED').length===2);
 const permission=await record();d=await claim(['email']);await db.query("UPDATE roles SET permissions=permissions-'51da7cca-8196-4135-84ce-f989be5ee594' WHERE id='r1'");check(await start(d)===false);await deny(()=>read(),'42501');await db.query("UPDATE roles SET permissions=permissions||$1::jsonb WHERE id='r1'",[JSON.stringify(['51da7cca-8196-4135-84ce-f989be5ee594'])]);
 // Published summary only; no internal ACL transition produces an external notice.
 p=await save(nc,p,false);p=await save(nc,p,true);const admission=randomUUID();await db.query("INSERT INTO acl_admissions VALUES($1,'o1',$2,$3)",[admission,customer,unit]);check((await read()).deliveries.filter(x=>x.event==='ACL_PUBLISHED').length===0);await db.query("INSERT INTO acl_admission_public_summaries VALUES('o1',$1,now())",[admission]);check((await read()).deliveries.filter(x=>x.event==='ACL_PUBLISHED').length===2);
 check((await read('o2','a2')).deliveries.length===0);check((await read()).deliveries.every(x=>!('destination' in x)&&!('provider_id' in x)));
 // Deadline creation is bounded, future-only and unique across repeated polls.
 const reminderConfig={...nc,events:['DEADLINE']};p=await save(reminderConfig,p,false);p=await save(reminderConfig,p,true);
 const deadline=await record(),distant=await record('requests','OPEN','25 hours'),past=await record('requests','OPEN','-1 hour'),done=await record('requests','DONE');
 for(let i=0;i<20;i++)await claim(['sms']);const notices=(await read()).deliveries.filter(x=>x.event==='DEADLINE');check(notices.length===2);await claim(['sms']);check((await read()).deliveries.filter(x=>x.event==='DEADLINE').length===2);
 for(let i=0;i<20;i++){d=await claim(['email']);if(d)break;}check(d?.source_id===deadline);await db.exec("UPDATE licenses SET active=false WHERE organization_id='o1'");check(await start(d)===false);await deny(()=>read(),'42501');await db.exec("UPDATE licenses SET active=true WHERE organization_id='o1'");
 // Polls advance beyond the first bounded batch rather than starving later deadlines.
 for(let i=0;i<120;i++)await record();await claim(['sms']);await claim(['sms']);check((await read()).deliveries.length===100);
 check((await db.query("SELECT count(*)::int n FROM customer_notice_deliveries WHERE event='DEADLINE'")).rows[0].n===242);
 // New reports may queue SMS. Legacy blocked sends are never automatically reactivated.
 const reportPolicy=randomUUID(),job=randomUUID();await db.query("INSERT INTO report_policies(id,organization_id,customer_id,consumer_unit_id,state,config,contacts,owner_id) VALUES($1,'o1',$2,$3,'ACTIVE',$4,$5,'a1')",[reportPolicy,customer,unit,JSON.stringify({...config,channels:['email','sms']}),JSON.stringify(contacts.map(c=>({...c,email:'changed@example.invalid'})))]);
 await db.query("INSERT INTO report_jobs(id,organization_id,policy_id,policy_version,slot,month,config,contacts,owner_id,requests,report_ids) SELECT $1,'o1',id,version,now(),current_date,config,contacts,'a1','{}',$3 FROM report_policies WHERE id=$2",[job,reportPolicy,JSON.stringify([{id:randomUUID(),kind:'OPERATIONAL'}])]);await db.query("UPDATE report_jobs SET state='READY' WHERE id=$1",[job]);
 check((await db.query("SELECT claim_report_delivery('[\"sms\"]') r")).rows[0].r===null);const re=(await db.query("SELECT claim_report_delivery('[\"email\"]') r")).rows[0].r.delivery;await db.query('SELECT start_report_delivery($1,$2,$3)',['o1',re.id,re.lease_id]);await db.query("SELECT finish_report_delivery($1,$2,$3,'ACCEPTED','email-report',NULL)",['o1',re.id,re.lease_id]);
 const reportSms=(await db.query("SELECT claim_report_delivery('[\"sms\"]') r")).rows[0].r.delivery;check(reportSms.channel==='sms');check((await db.query('SELECT start_report_delivery($1,$2,$3) r',['o1',reportSms.id,reportSms.lease_id])).rows[0].r);
 const reportSid='SM'+'3'.repeat(32);await db.query("SELECT record_sms_receipt($1,$2,'delivered',NULL)",[reportSms.id,reportSid]);await db.query("SELECT finish_report_delivery($1,$2,$3,'ACCEPTED',$4,NULL)",['o1',reportSms.id,reportSms.lease_id,reportSid]);check((await db.query("SELECT read_report_deliveries('o1','a1') r")).rows[0].r.find(x=>x.id===reportSms.id).deliveryStatus==='delivered');
 for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);for(const table of ['customer_notice_policies','customer_notice_history','customer_notice_deliveries','sms_delivery_receipts'])await deny(()=>db.exec('SELECT * FROM '+table),'42501');await db.exec('RESET ROLE');}
 await deny(()=>db.exec('DELETE FROM customer_notice_history'),'23514');await db.exec('SET ROLE authenticated');await deny(()=>read(),'42501');await db.exec('RESET ROLE');
 console.log(JSON.stringify({ok:true,checks}));
}finally{await db.close();}
