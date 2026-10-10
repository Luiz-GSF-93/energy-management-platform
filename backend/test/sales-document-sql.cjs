// Disposable fixture only. No production contact, license or organization writes.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let checks=0;const reject=async(f,c='22023')=>{await assert.rejects(f,e=>e.code===c);checks++;};
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE user_roles(user_id text,role_id text);CREATE TABLE roles(id text,scope text,name text,organization_id text,permissions jsonb);CREATE TABLE platform_team_members(user_id uuid,active boolean,profile text);CREATE TABLE user_profiles(user_id uuid,full_name text);CREATE TABLE plan_catalog(id uuid PRIMARY KEY,name text,version integer,active boolean,max_consumer_units integer,max_users integer,report_generation boolean,documents_limit integer,documents_unlimited boolean,document_management boolean,bot_energy_rag boolean,free_market_management boolean);CREATE TABLE licenses(id uuid);`);
const t=fs.readFileSync('src/database/migrations/20261010_platform_team.sql','utf8');await db.exec(t.slice(t.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_owner('),t.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_lock(')));
for(const n of ['intake','retention','commercial'])await db.exec(fs.readFileSync('src/database/migrations/20261010_platform_sales_'+n+'.sql','utf8'));
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',plan='cccccccc-cccc-4ccc-8ccc-cccccccccccc',receipt='dddddddd-dddd-4ddd-8ddd-dddddddddddd',id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
await db.exec(`INSERT INTO roles VALUES('o','global','admin_platform','platform','["82e7fc71-479a-4dd6-8b22-4fba6eaa6841"]');INSERT INTO user_roles VALUES('${owner}','o');INSERT INTO platform_team_members VALUES('${owner}',true,'OWNER');INSERT INTO user_profiles VALUES('${owner}','Fixture Owner');INSERT INTO plan_catalog VALUES('${plan}','Fixture Basic',1,true,5,8,true,100,false,true,true,true);`);
await db.query('select submit_platform_sales_lead($1,$2,$3,$4)',[receipt,JSON.stringify({requestId:receipt,consent:true,consentVersion:'sales-contact-v1',company:'Fixture',email:'fixture@example.com',units:5,users:8,goals:['reports']}),'a'.repeat(64),'b'.repeat(64)]);
const d={basis:'PACKAGE',minUnits:1,maxUnits:5,maxUsers:8,monthlyCents:85000,annualDiscountBps:0,starts:'2020-01-01',ends:'2099-12-31',extras:[],taxTerms:'ISS and support included.',justification:'Fixture policy.'};
const save=(n,def=d,expected=0,a=owner,pv=1)=>db.query('select save_platform_sales_policy($1,$2,$3,$4,$5,$6) result',[a,id(n),plan,expected,pv,JSON.stringify(def)]);
let activeReceipt=receipt;
const quote=(n,extras=[],a=owner,v=1)=>db.query('select create_platform_sales_proposal($1,$2,$3,$4,$5,$6,$7,$8) result',[a,id(n),activeReceipt,plan,v,'MONTHLY',JSON.stringify(extras),'Fixture review.']);
await save(1);const legacy=(await quote(2)).rows[0].result;
const migration=fs.readFileSync('src/database/migrations/20261010_platform_sales_composition.sql','utf8');await db.exec(migration);await db.exec(migration);
await db.exec(fs.readFileSync('src/database/migrations/20261010_platform_sales_document.sql','utf8'));
await db.exec(fs.readFileSync('src/database/migrations/20261010_platform_sales_document.sql','utf8'));
const read=(actor=owner,proposal=id(2))=>db.query('select read_platform_sales_approved_proposal($1,$2) result',[actor,proposal]);
await reject(()=>read(owner,id(99)),'P3610');await reject(()=>read(owner,null));
await reject(()=>read(),'P3611');
const review=(n,expected,status)=>db.query('select transition_platform_sales_proposal($1,$2,$3,$4,$5,$6)',[owner,id(n),id(2),expected,status,'Fixture document approval.']);
await review(20,1,'CHECKED');await reject(()=>read(),'P3611');await review(21,2,'APPROVED_INTERNAL');
const approved=(await read()).rows[0].result;assert.deepEqual(approved.snapshot,legacy.snapshot);checks++;
assert(!JSON.stringify(approved).includes('actor_id'));assert(!JSON.stringify(approved).includes('Fixture Owner'));assert(!JSON.stringify(approved).includes('fixture@example.com'));checks++;
for(const [i,profile] of ['ADMINISTRATOR','FINANCE','SUPPORT','OPERATOR'].entries()){const actor=id(40+i);await db.query('insert into platform_team_members values($1,true,$2)',[actor,profile]);await db.query('insert into user_roles values($1,$2)',[actor,'o']);await reject(()=>read(actor),'42501');}
await reject(()=>read(other),'42501');await reject(()=>read(null),'42501');
await db.exec(`UPDATE platform_team_members SET active=false WHERE user_id='${owner}'`);await reject(()=>read(),'42501');await db.exec(`UPDATE platform_team_members SET active=true WHERE user_id='${owner}'`);
await db.exec(`UPDATE plan_catalog SET name='Changed current catalog',version=2 WHERE id='${plan}'`);await save(30,{...d,monthlyCents:999000},1,owner,2);assert.deepEqual((await read()).rows[0].result,approved);checks++;
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await reject(()=>read(),'42501');await db.exec('RESET ROLE');}
await db.exec('SET ROLE service_role');assert.deepEqual((await read()).rows[0].result,approved);checks++;await reject(()=>read(other),'42501');await reject(()=>db.query('select * from platform_sales_proposals'),'42501');await db.exec('RESET ROLE');
assert.equal((await db.query('select count(*)::int n from platform_sales_proposal_events')).rows[0].n,3);assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,0);checks++;
await db.close();console.log(checks+' document isolation checks passed (disposable database).');})().catch(e=>{console.error(e);process.exitCode=1;});
