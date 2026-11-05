const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let checks=0;const reject=async(f,c)=>{await assert.rejects(f,e=>e.code===c);checks++;};
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE user_roles(user_id text,role_id text);CREATE TABLE roles(id text,scope text,name text,organization_id text,permissions jsonb);CREATE TABLE platform_team_members(user_id uuid,active boolean,profile text);CREATE TABLE user_profiles(user_id uuid,full_name text);CREATE TABLE plan_catalog(id uuid PRIMARY KEY,name text,version integer,active boolean,max_consumer_units integer,max_users integer,report_generation boolean);`);
const t=fs.readFileSync('src/database/migrations/20261010_platform_team.sql','utf8');await db.exec(t.slice(t.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_owner('),t.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_lock(')));
for(const n of ['intake','retention','commercial','composition']){const s=fs.readFileSync('src/database/migrations/20261010_platform_sales_'+n+'.sql','utf8');await db.exec(s);await db.exec(s);checks++;}
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',plan='cccccccc-cccc-4ccc-8ccc-cccccccccccc',receipt='dddddddd-dddd-4ddd-8ddd-dddddddddddd',id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
await db.exec(`INSERT INTO roles VALUES('o','global','admin_platform','platform','["82e7fc71-479a-4dd6-8b22-4fba6eaa6841"]');INSERT INTO user_roles VALUES('${owner}','o');INSERT INTO platform_team_members VALUES('${owner}',true,'OWNER');INSERT INTO user_profiles VALUES('${owner}','Original Owner');INSERT INTO plan_catalog VALUES('${plan}','Original plan',1,true,100,100,true);`);
await db.query('select submit_platform_sales_lead($1,$2,$3,$4)',[receipt,JSON.stringify({requestId:receipt,consent:true,consentVersion:'sales-contact-v1',company:'Test',email:'test@example.com',units:10,users:20,goals:['reports']}),'a'.repeat(64),'b'.repeat(64)]);
for(const n of ['20261272_platform_sales_effective_policies.sql','20261273_platform_sales_journey.sql']){const sql=fs.readFileSync('src/database/migrations/'+n,'utf8');await db.exec(sql);await db.exec(sql);}
const call=async(n,a)=>(await db.query('select '+n+'('+a.map((_,i)=>'$'+(i+1)).join(',')+') result',a)).rows[0].result;
const d={basis:'UNIT',minUnits:10,maxUnits:20,maxUsers:30,monthlyCents:26500,annualDiscountBps:1200,starts:'2020-01-01',ends:'2099-12-31',extras:[],taxTerms:'Explicit taxes.',justification:'Test policy.'},token='c'.repeat(64),wrong='f'.repeat(64),code='d'.repeat(64);
await call('save_platform_sales_policy',[owner,id(1),plan,0,1,JSON.stringify(d)]);
const payload={requestId:receipt,consent:true,consentVersion:'sales-contact-v1',company:'Test',email:'test@example.com',units:10,users:20,goals:['reports']};
await call('submit_platform_sales_journey',[receipt,JSON.stringify(payload),'a'.repeat(64),'b'.repeat(64),token]);
await reject(()=>call('read_sales_journey',[receipt,wrong]),'42501');
const q=await call('preserve_sales_suggestion',[id(2),receipt,token,plan,1,'ANNUAL']);assert.equal(q.snapshot.annualRecurringCents,2798400);
assert.equal((await call('preserve_sales_suggestion',[id(3),receipt,token,plan,1,'ANNUAL'])).id,q.id);
await reject(()=>call('accept_sales_suggestion',[id(4),receipt,token,q.id,wrong]),'42501');
await call('sales_contact_challenge',[receipt,token,id(5),code]);assert.equal((await call('sales_contact_challenge',[receipt,token,id(6),code])).limited,true);
assert.equal((await call('verify_sales_contact',[receipt,token,wrong,wrong])).verified,false);assert.equal((await call('verify_sales_contact',[receipt,token,code,wrong])).verified,true);
await call('accept_sales_suggestion',[id(7),receipt,token,q.id,wrong]);await call('accept_sales_suggestion',[id(7),receipt,token,q.id,wrong]);
assert.equal((await call('read_platform_sales_leads',[owner,0,''])).rows[0].awaitingOwner,true);
await reject(()=>call('approve_sales_journey',[other,id(8),receipt,q.id,'Test approval.']),'42501');
assert.equal((await call('approve_sales_journey',[owner,id(8),receipt,q.id,'Test approval.'])).status,'APPROVED_INTERNAL');
assert.equal((await call('approve_sales_journey',[owner,id(9),receipt,q.id,'Test approval.'])).proposalId,id(8));
await call('save_platform_sales_policy',[owner,id(10),plan,1,1,JSON.stringify({...d,starts:'2090-01-01',monthlyCents:30000})]);
assert.equal((await call('read_platform_sales_leads',[owner,0,''])).rows[0].awaitingOwner,false);
const state=await call('read_platform_sales_commercial',[owner,receipt]);assert.equal(state.policies[0].version,2);assert.equal(state.effectivePolicies[0].version,1);assert.equal(state.proposals[0].events.at(-1).status,'APPROVED_INTERNAL');
await call('create_platform_sales_proposal',[owner,id(11),receipt,plan,1,'MONTHLY','[]','Test current policy.']);
const newerReceipt=id(30),payload2={...payload,requestId:newerReceipt};await call('submit_platform_sales_journey',[newerReceipt,JSON.stringify(payload2),'1'.repeat(64),'b'.repeat(64),token]);
const monthly=await call('preserve_sales_suggestion',[id(31),newerReceipt,token,plan,1,'MONTHLY']);await call('sales_contact_challenge',[newerReceipt,token,id(32),code]);await call('verify_sales_contact',[newerReceipt,token,code,wrong]);await call('accept_sales_suggestion',[id(33),newerReceipt,token,monthly.id,wrong]);
const annual=await call('preserve_sales_suggestion',[id(34),newerReceipt,token,plan,1,'ANNUAL']);await call('accept_sales_suggestion',[id(35),newerReceipt,token,annual.id,wrong]);await reject(()=>call('approve_sales_journey',[owner,id(36),newerReceipt,monthly.id,'Outdated cycle acceptance.']),'P3610');
await call('save_platform_sales_policy',[owner,id(37),plan,2,1,JSON.stringify({...d,monthlyCents:29000})]);await reject(()=>call('approve_sales_journey',[owner,id(38),newerReceipt,annual.id,'Outdated policy acceptance.']),'P3611');
assert.equal((await db.query('select count(*)::int n from platform_sales_proposals')).rows[0].n,2);
for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);for(const table of ['platform_sales_access','platform_sales_suggestions','platform_sales_journey_events','platform_sales_journey_outbox'])await reject(()=>db.exec('SELECT * FROM '+table),'42501');if(role!=='service_role')await reject(()=>call('read_sales_journey',[receipt,token]),'42501');await db.exec('RESET ROLE');}
await db.exec("UPDATE platform_sales_access SET expires_at=now()-interval '1 second' WHERE receipt='"+receipt+"'");await reject(()=>call('read_sales_journey',[receipt,token]),'42501');
await call('erase_platform_sales_lead',[owner,receipt,receipt,'DATA_SUBJECT_REQUEST']);assert.equal((await db.query('select count(*)::int n from platform_sales_access where receipt=$1',[receipt])).rows[0].n,0);
await db.close();console.log(checks+' permission checks plus end-to-end journey, exact price, idempotency, effective dates, erasure and approval assertions passed.');})().catch(e=>{console.error(e);process.exitCode=1;});
