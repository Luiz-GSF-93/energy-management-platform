// Disposable database only. No network credentials or production mutations.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();let checks=0;const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
 const owner=id(1),other=id(2),proposal=id(10),draft=id(11),document=id(12),binding=id(13),evidence=id(14),financial=id(15),org='fixture-org';
 const reject=async(f,code='22023')=>{await assert.rejects(f,e=>e.code===code);checks++;};
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE user_roles(user_id text,role_id text);CREATE TABLE roles(id text,scope text,name text,organization_id text,permissions jsonb);
 CREATE TABLE platform_team_members(user_id uuid,active boolean,profile text);CREATE TABLE user_profiles(user_id uuid,full_name text);
 CREATE TABLE organizations(id text PRIMARY KEY,name text,registration jsonb);CREATE TABLE licenses(id uuid,organization_id text);
 CREATE TABLE platform_sales_proposals(id uuid PRIMARY KEY,snapshot jsonb);
 CREATE TABLE platform_sales_proposal_events(proposal_id uuid,version int,status text);
 CREATE TABLE platform_sales_contract_drafts(id uuid PRIMARY KEY,proposal_id uuid,terms_revision int,snapshot jsonb,sha256 text);
 CREATE TABLE platform_sales_signed_documents(id uuid PRIMARY KEY,draft_id uuid,draft_sha256 text,sha256 text);
 CREATE TABLE platform_sales_signed_document_events(document_id uuid,version int,status text);
 CREATE TABLE platform_sales_contract_events(draft_id uuid,version int,status text);
 CREATE TABLE platform_sales_offer_terms(proposal_id uuid,revision int,definition jsonb);
 CREATE TABLE platform_sales_offer_term_events(proposal_id uuid,revision int,version int,status text);
 CREATE TABLE platform_sales_asaas_bindings(id uuid PRIMARY KEY,proposal_id uuid,environment text,payment_id text,customer_id text,gross_cents bigint);
 CREATE TABLE platform_sales_evidence_attempts(id uuid,kind text,source_id uuid,source jsonb,created_at timestamptz);
 CREATE TABLE platform_sales_evidence_revisions(attempt_id uuid,status text,evidence jsonb);
 CREATE TABLE platform_sales_asaas_checks(id uuid,event_id uuid,status text,summary jsonb,created_at timestamptz);
 CREATE TABLE platform_sales_asaas_inbox(id uuid,payment_id text,received_at timestamptz);
 CREATE TABLE platform_sales_cycle_bindings(payment_id text);
 CREATE FUNCTION platform_sales_commercial_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable' USING ERRCODE='42501';END$$;`);
 const team=fs.readFileSync('src/database/migrations/20261010_platform_team.sql','utf8');await db.exec(team.slice(team.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_owner('),team.indexOf('CREATE OR REPLACE FUNCTION public.platform_team_lock(')));
 const names=fs.readFileSync('src/database/migrations/20261010_platform_sales_finance_read.sql','utf8').match(/CREATE OR REPLACE FUNCTION public.platform_sales_finance_name[\s\S]*?END \$\$;/)[0];await db.exec(names);
 await db.query('insert into roles values($1,$2,$3,$4,$5)',['owner','global','admin_platform','platform',JSON.stringify(['82e7fc71-479a-4dd6-8b22-4fba6eaa6841'])]);
 await db.query('insert into user_roles values($1,$2)',[owner,'owner']);await db.query('insert into platform_team_members values($1,true,$2)',[owner,'OWNER']);await db.query('insert into user_profiles values($1,$2)',[owner,'Fixture Owner']);
 const scope={planId:id(100),planVersion:1,policyVersion:1,units:2,users:3,documentsLimit:800,modules:{trading_hub:true},currency:'BRL',initialTotalCents:260000,policy:{basis:'PACKAGE',maxUnits:5,maxUsers:8,starts:'2020-01-01',ends:'2099-12-31'}};
 await db.query('insert into organizations values($1,$2,$3)',[org,'Fixture only',JSON.stringify({taxId:'12345678000190'})]);
 await db.query('insert into platform_sales_proposals values($1,$2)',[proposal,JSON.stringify(scope)]);await db.query('insert into platform_sales_proposal_events values($1,3,$2)',[proposal,'APPROVED_INTERNAL']);
 await db.query('insert into platform_sales_contract_drafts values($1,$2,1,$3,$4)',[draft,proposal,JSON.stringify({proposal:{snapshot:scope},parties:{customer:{document:'12.345.678/0001-90'}}}),'a'.repeat(64)]);
 await db.query('insert into platform_sales_signed_documents values($1,$2,$3,$4)',[document,draft,'a'.repeat(64),'b'.repeat(64)]);await db.query('insert into platform_sales_signed_document_events values($1,3,$2)',[document,'ACCEPTED']);await db.query('insert into platform_sales_contract_events values($1,3,$2)',[draft,'APPROVED_INTERNAL']);
 await db.query('insert into platform_sales_offer_terms values($1,1,$2)',[proposal,JSON.stringify({validUntil:'2099-12-31'})]);await db.query('insert into platform_sales_offer_term_events values($1,1,3,$2)',[proposal,'APPROVED_INTERNAL']);
 await db.query('insert into platform_sales_asaas_bindings values($1,$2,$3,$4,$5,260000)',[binding,proposal,'SANDBOX','pay_fixture','cus_fixture']);
 const payment={id:'pay_fixture',customer:'cus_fixture',reference:binding,grossCents:260000,status:'RECEIVED'};
 await db.query('insert into platform_sales_asaas_inbox values($1,$2,$3)',[id(16),'pay_fixture','2026-01-01']);await db.query('insert into platform_sales_asaas_checks values($1,$2,$3,$4,$5)',[financial,id(16),'VERIFIED',JSON.stringify(payment),'2026-01-02']);
 await db.query('insert into platform_sales_evidence_attempts values($1,$2,$3,$4,$5)',[evidence,'ONCE',binding,JSON.stringify({paymentId:'pay_fixture',customer:'cus_fixture',reference:binding,grossCents:260000,verified:true}),'2026-01-03']);
 const ev={payment,refunds:[],invoices:[],refundsComplete:true,invoicesComplete:true};await db.query('insert into platform_sales_evidence_revisions values($1,$2,$3)',[evidence,'COMPLETE',JSON.stringify(ev)]);
 await db.exec(`ALTER TABLE licenses ALTER COLUMN id TYPE text USING id::text;ALTER TABLE licenses ADD PRIMARY KEY(id);
 ALTER TABLE licenses ADD license_type text,ADD documents_limit int,ADD documents_used int,ADD documents_unlimited boolean,ADD renewal_date date,ADD start_date date,ADD end_date date,ADD status text,ADD active boolean,ADD max_consumer_units int,ADD max_users int,ADD document_management boolean,ADD advanced_analytics boolean,ADD report_generation boolean,ADD free_market_management boolean,ADD client_portal boolean,ADD ccee_registrations boolean,ADD trading_hub boolean,ADD bot_energy_rag boolean,ADD ai_monthly_limit_micro_usd bigint,ADD monthly_price_brl_cents bigint,ADD plan_id uuid,ADD plan_version int,ADD plan_snapshot jsonb,ADD governance_revision int DEFAULT 1,ADD updated_at timestamptz DEFAULT now();
 CREATE TABLE audit_logs(id text PRIMARY KEY,organization_id text,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text,ip_address text,user_agent text);
 CREATE TABLE fixture_usage(users int,units int,documents int);INSERT INTO fixture_usage VALUES(0,0,0);
 CREATE FUNCTION organization_resource_usage(text) RETURNS jsonb LANGUAGE sql AS $$SELECT to_jsonb(x) FROM public.fixture_usage x$$;
 CREATE FUNCTION assert_license_platform_actor(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN PERFORM public.platform_team_owner($1);END$$;`);
 const governance=fs.readFileSync('src/database/migrations/20260925_f1_39_license_governance.sql','utf8');
 await db.exec(governance.slice(governance.indexOf('CREATE OR REPLACE FUNCTION public.guard_license_governance()'),governance.indexOf('DO $$ BEGIN',governance.indexOf('CREATE OR REPLACE FUNCTION public.guard_license_governance()'))));
 await db.exec(fs.readFileSync('src/database/migrations/20261012_platform_sales_activation_preparation.sql','utf8'));
 const migration=fs.readFileSync('src/database/migrations/20261013_platform_sales_provisioning.sql','utf8');
 const fingerprint=async()=>JSON.stringify((await db.query('select to_jsonb(x) r from platform_sales_proposals x')).rows);
 await db.exec('CREATE TABLE plan_catalog(id uuid,version int,documents_limit int,monthly_price_brl_cents bigint)');await db.query('insert into plan_catalog values($1,99,100,85000)',[id(100)]);
 const before=await fingerprint();await db.exec('BEGIN');await db.exec(migration.replace(/^BEGIN;/,'').replace(/COMMIT;\s*$/,''));await db.exec('ROLLBACK');
 assert.equal((await db.query("select to_regclass('platform_sales_provisioning_commands') t")).rows[0].t,null);checks++;assert.equal(await fingerprint(),before);checks++;
 await db.exec(migration);assert.equal(await fingerprint(),before);checks++;
 const activation=id(200),cid=id(201),note='Disposable fixture only; never platform sources.',complement={starts:'2026-10-01',ends:'2027-09-30',renews:'2027-09-30',aiMonthlyMicroUsd:0,contractConfirmed:true};
 const rpc=async(action,body,actor=owner)=>(await db.query('select platform_sales_provisioning_action($1,$2,$3) r',[actor,action,JSON.stringify(body)])).rows[0].r;
 const act=async(action,body)=>(await db.query('select platform_sales_activation_action($1,$2,$3) r',[owner,action,JSON.stringify(body)])).rows[0].r;
 const setup=async()=>{await act('prepare',{id:activation,organizationId:org,proposalId:proposal,documentId:document,bindingId:binding,justification:note});const s=(await act('read',{id:activation})).current;await act('review',{id:activation,requestId:id(202),expectedVersion:1,sourceHash:s.sourceHash,status:'CHECKED_INTERNAL',checks:{recipient:true,contract:true,payment:true,scope:true,fiscal:true},justification:note});};
 await db.query("update platform_sales_proposals set snapshot=snapshot||$1::jsonb",[JSON.stringify({planName:'Frozen fixture package',cycle:'MONTHLY',monthlyRecurringCents:260000})]);
 await db.query("update platform_sales_contract_drafts set snapshot=jsonb_set(snapshot,'{proposal,snapshot}',(select snapshot from platform_sales_proposals limit 1))");
 // Sandbox-positive preparation is rolled back; no shared database is contacted.
 await db.exec('BEGIN');await setup();
 let p=await rpc('preview',{id:activation,complement:{}});for(const reason of ['LICENSE_DATES_MISSING','AI_QUOTA_MISSING','COMPLEMENT_CONTRACT_REVIEW']){assert.ok(p.blockers.includes(reason));checks++;}
 p=await rpc('preview',{id:activation,complement});assert.deepEqual(p.blockers,[]);checks++;
 const prepare={id:cid,activationId:activation,payloadHash:p.payloadHash,complement,justification:note};await rpc('prepare',prepare);await rpc('prepare',prepare);checks++;
 const authorize={id:cid,requestId:id(203),expectedVersion:1,payloadHash:p.payloadHash,justification:note};await rpc('authorize',authorize);
 const execute={id:cid,requestId:id(204),expectedVersion:2,payloadHash:p.payloadHash,justification:note};
 await db.exec('SAVEPOINT sandbox');await reject(()=>rpc('execute',execute),'42501');await db.exec('ROLLBACK TO sandbox');
 assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,0);checks++;await db.exec('ROLLBACK');
 // A synthetic production adapter exists ONLY in this disposable fixture schema.
 // This proves the transactional kernel, not production evidence/adapters readiness.
 await db.exec(`ALTER FUNCTION platform_sales_activation_source(text,uuid,uuid,uuid) RENAME TO fixture_sandbox_source;
 CREATE FUNCTION platform_sales_activation_source(text,uuid,uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE s jsonb;v jsonb;BEGIN s:=public.fixture_sandbox_source($1,$2,$3,$4);v:=(s->'snapshot')||jsonb_build_object('environment','PRODUCTION','realActivationEligible',true);RETURN s||jsonb_build_object('snapshot',v,'realActivationEligible',true,'sourceHash',encode(sha256(convert_to(v::text,'UTF8')),'hex'));END$$;
 REVOKE ALL ON FUNCTION platform_sales_activation_source(text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;`);
 await setup();p=await rpc('preview',{id:activation,complement});prepare.payloadHash=p.payloadHash;authorize.payloadHash=p.payloadHash;execute.payloadHash=p.payloadHash;
 await reject(()=>rpc('list',{page:0,search:'',status:''},other),'42501');
 for(const profile of ['ADMINISTRATOR','FINANCE','SUPPORT']){await db.exec('BEGIN');await db.query('update platform_team_members set profile=$1 where user_id=$2',[profile,owner]);await db.exec('SAVEPOINT profile_denied');await reject(()=>rpc('read',{id:cid}),'42501');await db.exec('ROLLBACK');}
 await reject(()=>rpc('prepare',{...prepare,environment:'PRODUCTION'}));
 await rpc('prepare',prepare);assert.equal((await rpc('read',{id:cid})).command.payload.scope.documentsLimit,800);checks++;
 await reject(()=>rpc('prepare',{...prepare,justification:'Changed replay justification.'}),'P3621');
 await rpc('authorize',authorize);await rpc('authorize',authorize);checks++;
 await reject(()=>rpc(null,execute));
 await db.exec('BEGIN');await rpc('withdraw',{...execute,requestId:id(206)});await db.exec('SAVEPOINT withdrawn');await reject(()=>rpc('execute',{...execute,expectedVersion:3}),'P3621');await db.exec('ROLLBACK');
 await db.exec('update plan_catalog set version=100,documents_limit=50,monthly_price_brl_cents=990000');
 await db.exec('BEGIN');await db.query('update platform_team_members set active=false where user_id=$1',[owner]);await db.exec('SAVEPOINT denied');await reject(()=>rpc('execute',execute),'42501');await db.exec('ROLLBACK');
 await db.exec('BEGIN');await db.query("update platform_sales_proposals set snapshot=jsonb_set(snapshot,'{monthlyRecurringCents}','999999')");await db.exec('SAVEPOINT changed');await reject(()=>rpc('execute',execute),'P3621');await db.exec('ROLLBACK');
 await db.exec('BEGIN');await db.exec('update fixture_usage set users=9');await db.exec('SAVEPOINT cap');await reject(()=>rpc('execute',execute),'P3393');await db.exec('ROLLBACK');
 await db.exec(`CREATE FUNCTION fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture audit failure' USING ERRCODE='P3999';END$$;CREATE TRIGGER fixture_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_fail_audit();`);
 await reject(()=>rpc('execute',execute),'P3999');assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,0);checks++;assert.equal((await db.query('select count(*)::int n from platform_sales_provisioning_results')).rows[0].n,0);checks++;await db.exec('DROP TRIGGER fixture_audit ON audit_logs');
 // Real PG mode uses independent connections; PGlite serializes requests internally.
 db.concurrent=true;const race=await Promise.allSettled([rpc('execute',execute),rpc('execute',{...execute,requestId:id(205)})]);db.concurrent=false;
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);checks++;
 const winner=race[0].status==='fulfilled'?execute:{...execute,requestId:id(205)};
 const recovered=await rpc('execute',winner);assert.equal(recovered.payload_hash,p.payloadHash);checks++;
 const license=(await db.query('select * from licenses')).rows[0];assert.equal(license.max_users,8);checks++;assert.equal(license.max_consumer_units,5);checks++;assert.equal(license.documents_limit,800);checks++;assert.equal(Number(license.monthly_price_brl_cents),260000);checks++;assert.equal(license.trading_hub,true);checks++;
 assert.equal((await db.query('select count(*)::int n from audit_logs')).rows[0].n,1);checks++;assert.equal((await db.query('select count(*)::int n from licenses')).rows[0].n,1);checks++;
 await reject(()=>rpc('execute',{...winner,justification:'Divergent retry must not apply again.'}),'P3621');
 await reject(()=>rpc('withdraw',{...winner,requestId:id(207),expectedVersion:3}),'P3621');
 await db.exec('BEGIN');await db.query("select set_config('app.license_actor',$1,true)",[owner]);await db.query("update licenses set status='SUSPENDED',active=false");await db.exec('SAVEPOINT mismatch');await reject(()=>rpc('execute',winner),'P3621');await db.exec('ROLLBACK');
 await db.query('update user_profiles set full_name=$1 where user_id=$2',['Renamed fixture Owner',owner]);assert.equal((await rpc('read',{id:cid})).events[0].actor_name,'Fixture Owner');checks++;assert.equal((await rpc('read',{id:cid})).events[0].currentActorName,'Renamed fixture Owner');checks++;
 await db.exec('ALTER TABLE user_profiles RENAME TO fixture_profiles_offline');assert.equal((await rpc('read',{id:cid})).events[0].currentActorName,null);checks++;await db.exec('ALTER TABLE fixture_profiles_offline RENAME TO user_profiles');
 for(const table of ['platform_sales_provisioning_commands','platform_sales_provisioning_events','platform_sales_provisioning_results']){await reject(()=>db.exec('delete from '+table),'42501');for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await reject(()=>db.query('select * from '+table),'42501');await db.exec('RESET ROLE');}}
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await reject(()=>rpc('read',{id:cid}),'42501');await db.exec('RESET ROLE');}
 await db.exec('SET ROLE service_role');await reject(()=>db.query('select platform_sales_provisioning_payload($1,$2)',[activation,JSON.stringify(complement)]),'42501');await db.exec('RESET ROLE');
 console.log('5B disposable SQL checks passed: '+checks+'; sandbox blocked, frozen scope, rollback, real governance trigger, replay, independent race, recovery, isolation and immutable history.');await db.close();
})().catch(e=>{console.error(e.message,e.code,e.where);process.exit(1);});
