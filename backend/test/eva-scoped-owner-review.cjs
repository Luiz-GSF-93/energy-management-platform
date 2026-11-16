const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),hash='a'.repeat(64);
(async()=>{const db=new PGlite();let checks=0;const ok=v=>{assert(v);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE organizations(id text PRIMARY KEY);INSERT INTO organizations VALUES('org'),('other');
CREATE TABLE organization_members(organization_id text,user_id text,role_id text,status text,affiliation_type text,exclusive_customer_id text);
INSERT INTO organization_members VALUES('org','operator','op','ACTIVE','internal',NULL),('org','manager','mgr','ACTIVE','internal',NULL),('other','foreign','mgr','ACTIVE','internal',NULL),('org','external','op','ACTIVE','external','customer');
CREATE TABLE customers(id text PRIMARY KEY,organization_id text,company_name text,status text,deleted_at timestamptz);INSERT INTO customers VALUES('customer','org','Company','ACTIVE',NULL),('foreign','other','Other company','ACTIVE',NULL);
CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text,name text,consumer_unit_number text,status text);INSERT INTO consumer_units VALUES('${id(1)}','org','customer','Branch one','111','ACTIVE'),('${id(2)}','org','customer','Branch two','222','ACTIVE'),('${id(3)}','other','foreign','Foreign','333','ACTIVE');
CREATE TABLE eva_assisted_closing_versions(id uuid PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,month text,version int,payload_hash text,report jsonb,UNIQUE(organization_id,id));
CREATE TABLE eva_assisted_closing_events(organization_id text,closing_id uuid,sequence int,state text,created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE eva_operational_reviews(id uuid,organization_id text,closing_id uuid,closing_hash text,state text,submitted_at timestamptz,updated_at timestamptz);
CREATE TABLE eva_closing_publications(id uuid,organization_id text,closing_id uuid);CREATE TABLE eva_closing_publication_events(organization_id text,publication_id uuid,sequence int,state text);
CREATE TABLE operation_notification_reads(organization_id text,user_id text,notification_key text,PRIMARY KEY(organization_id,user_id,notification_key));
CREATE FUNCTION preserve_calculation_autofill() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Immutable';END$$;
CREATE FUNCTION eva_flow_actor(o text,a text,w boolean) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=o AND user_id=a AND status='ACTIVE' AND affiliation_type='internal' AND exclusive_customer_id IS NULL) OR w AND a<>'operator' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END IF;RETURN jsonb_build_object('canPrepare',a='operator','canManage',a='manager');END$$;
`);
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261302_eva_document_review_queue.sql','utf8'));
const report=(units,complete=true,scope='UNIT')=>({unitIds:units,scope:{kind:scope,unitIds:units},approvalEligible:complete,preparation:{percent:100},pendingActions:complete?[]:[{code:'SOURCE'}]});
async function closing(n,unit,version,complete=true,units=[unit],scope='UNIT',org='org',customer='customer'){
 await db.query('INSERT INTO eva_assisted_closing_versions VALUES($1,$2,$3,$4,\'2026-01\',$5,$6,$7)',[id(n),org,customer,unit,version,hash,JSON.stringify(report(units,complete,scope))]);
 await db.query('INSERT INTO eva_assisted_closing_events(organization_id,closing_id,sequence,state) VALUES($1,$2,1,$3)',[org,id(n),complete?'READY_FOR_REVIEW':'INCOMPLETE']);
}
const call=(action,body={},actor='operator',role='op',org='org')=>db.query('SELECT eva_document_review_queue($1,$2,$3,$4,$5) data',[org,actor,role,action,JSON.stringify(body)]).then(r=>r.rows[0].data);
const command=(closingId,n)=>({closingId:id(closingId),hash,requestId:id(n),reason:'Operator checked this exact source and version.',confirmed:true});
await closing(10,id(1),1);await closing(11,id(2),2,false);await closing(12,id(3),1,true,[id(3)],'UNIT','other','foreign');
let q=await call('list');ok(q.total===2);ok(q.rows.every(r=>r.customerId==='customer'));ok(q.summary.operator===2);ok(q.rows.find(r=>r.id===id(11)).approvalEligible===false);
ok((await call('status',{closingId:id(12)})).row===null);
await deny(()=>call('list',{},'external'));await deny(()=>call('list',{},'operator','mgr'));await deny(()=>call('list',{},'operator','op','other'));
await deny(()=>call('submit',command(11,100)));await deny(()=>call('submit',{...command(10,101),hash:'b'.repeat(64)}));await deny(()=>call('submit',{...command(10,102),confirmed:false}));
const countsBefore=(await db.query('SELECT count(*) n FROM eva_assisted_closing_events')).rows[0].n;
ok((await call('submit',command(10,103))).stage==='APPROVAL');ok((await call('submit',command(10,103))).replayed);
ok((await db.query('SELECT count(*) n FROM eva_closing_review_events')).rows[0].n===1);
await deny(()=>call('submit',{...command(10,103),reason:'Different command for a reused request identifier.'}));
let notices=await call('notifications',{},'manager','mgr');ok(notices.rows.length===1);ok(notices.rows[0].href.includes('/backoffice/documents?reviewClosing='));
await call('read_notification',{key:notices.rows[0].key},'manager','mgr');ok((await call('list',{stage:'APPROVAL'},'manager','mgr')).total===1);
await deny(()=>call('return',command(10,104)));ok((await call('return',command(10,105),'manager','mgr')).stage==='RETURNED');
ok((await call('submit',command(10,106))).stage==='APPROVAL');
await closing(13,id(2),3);ok((await call('status',{closingId:id(10)})).row.stage==='APPROVAL'); // unrelated branch never hides submission
await closing(14,id(1),4);ok((await call('status',{closingId:id(10)})).row===null);ok((await call('notifications',{},'manager','mgr')).rows.length===0);
await deny(()=>call('submit',command(10,107)));ok((await call('status',{closingId:id(14)})).row.stage==='OPERATOR');
await closing(15,id(1),5,true,[id(1),id(2)],'CUSTOMER');q=await call('list');ok(q.total===1);ok(q.rows[0].scopeKind==='CUSTOMER'&&q.rows[0].units.length===2);
ok((await call('submit',command(15,108))).stage==='APPROVAL');
await db.query("INSERT INTO eva_assisted_closing_events(organization_id,closing_id,sequence,state) VALUES('org',$1,2,'APPROVED')",[id(15)]);
ok((await call('list')).rows[0].stage==='PUBLICATION');ok((await call('notifications',{},'manager','mgr')).rows.length===1);
await db.query("INSERT INTO eva_closing_publications VALUES($1,'org',$2)",[id(90),id(15)]);await db.query("INSERT INTO eva_closing_publication_events VALUES('org',$1,1,'PUBLISHED')",[id(90)]);ok((await call('list')).total===0);ok((await call('notifications',{},'manager','mgr')).rows.length===0);
ok((await db.query('SELECT count(*) n FROM eva_assisted_closing_events')).rows[0].n===countsBefore+4,'Handoff never writes a financial decision');
for(const role of ['anon','authenticated','service_role'])for(const p of ['SELECT','INSERT','UPDATE','DELETE'])ok(!(await db.query("SELECT has_table_privilege($1,'eva_closing_review_events',$2) v",[role,p])).rows[0].v);
await deny(()=>db.exec('UPDATE eva_closing_review_events SET reason=reason'));
for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_document_review_queue(text,text,text,text,jsonb)','EXECUTE') v",[role])).rows[0].v);
for(const role of ['anon','authenticated','service_role'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_document_review_rows(text)','EXECUTE') v",[role])).rows[0].v);
await deny(()=>call('list',{page:-1}));await deny(()=>call('list',{stage:'APPROVED'}));
// Published competencies can have newer revisions, but they are not new original tasks.
const prioritySql=fs.readFileSync(__dirname+'/../src/database/migrations/20261303_eva_published_review_priority.sql','utf8');
await db.exec('ALTER TABLE eva_closing_publications ADD COLUMN customer_id text;ALTER TABLE eva_closing_publications ADD COLUMN source_hash text;');
await db.query('UPDATE eva_closing_publications SET customer_id=$1,source_hash=$2',['customer',hash]);
await db.exec(prioritySql);await db.exec(prioritySql);
await closing(16,id(1),6);q=await call('list');ok(q.total===1);ok(q.rows[0].stage==='REVISION');ok(q.summary.revision===1&&q.summary.operator===0&&q.summary.approval===0);
ok((await call('list',{stage:'APPROVAL'})).total===0);ok((await call('list',{stage:'REVISION'})).total===1);
ok((await call('notifications')).rows.length===0);
const published=(org,customer,units)=>db.query('SELECT public.eva_review_previously_published($1,$2,$3,$4) v',[org,customer,'2026-01',JSON.stringify(units)]).then(r=>r.rows[0].v);
ok(await published('org','customer',[id(1)]));ok(!(await published('other','customer',[id(1)])));ok(!(await published('org','foreign',[id(1)])));ok(!(await published('org','customer',[id(1),id(3)])));ok(!(await published('org','customer',[])));ok(!(await published('org','customer',null)));
ok((await call('submit',command(16,109))).stage==='APPROVAL');ok((await call('list',{stage:'APPROVAL'},'manager','mgr')).total===1);
ok((await db.query("SELECT state FROM eva_closing_publication_events WHERE publication_id=$1 ORDER BY sequence DESC LIMIT 1",[id(90)])).rows[0].state==='PUBLISHED');
await db.query("INSERT INTO eva_closing_publication_events VALUES('org',$1,2,'WITHDRAWN')",[id(90)]);ok(!(await published('org','customer',[id(1)])));

// Financial rejection is different from a handoff return, but remains actionable.
await db.exec("ALTER TABLE eva_assisted_closing_events ADD COLUMN note text NOT NULL DEFAULT '';");
const visibilitySql=fs.readFileSync(__dirname+'/../src/database/migrations/20261306_eva_queue_rejected_visibility.sql','utf8');
await db.exec(visibilitySql);await db.exec(visibilitySql);
await db.query("INSERT INTO eva_assisted_closing_events(organization_id,closing_id,sequence,state,note) VALUES('org',$1,2,'REJECTED','Manager requires invoice reconciliation')",[id(16)]);
q=await call('list',{stage:'RETURNED'});ok(q.total===1);ok(q.rows[0].stage==='RETURNED');ok(q.rows[0].returnReason==='Manager requires invoice reconciliation');ok(q.rows[0].approvalEligible===false);ok(q.summary.returned===1);
ok((await call('list',{stage:'APPROVAL'})).total===0);await deny(()=>call('submit',command(16,110)));
await closing(17,id(2),7);q=await call('list',{stage:'ALL'});ok(q.total===2);ok(q.rows[0].id===id(17));ok(q.rows[1].id===id(16));
ok((await call('list',{stage:'OPERATOR'})).total===2);ok((await call('list',{stage:'INPUT'})).total===0);ok((await call('list',{stage:'PUBLICATION'})).total===0);
await db.query("UPDATE eva_assisted_closing_versions SET report=jsonb_set(report,'{preparation,percent}','75') WHERE id=$1",[id(17)]);
await db.query("UPDATE eva_assisted_closing_versions SET report=jsonb_set(report,'{approvalEligible}','false') WHERE id=$1",[id(17)]);
q=await call('list',{stage:'INPUT'});ok(q.total===1&&q.rows[0].id===id(17));
ok((await call('status',{closingId:id(16)})).row.stage==='RETURNED');ok((await call('status',{closingId:id(12)})).row===null);

const owner=id(801),notOwner=id(802);
await db.exec(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);INSERT INTO auth.users VALUES('${owner}',NULL,NULL),('${notOwner}',NULL,NULL);
CREATE TABLE platform_organization_sessions(user_id uuid,organization_id text,expires_at timestamptz,revoked_at timestamptz);INSERT INTO platform_organization_sessions VALUES('${owner}','org',now()+interval '1 hour',NULL),('${notOwner}','org',now()+interval '1 hour',NULL);
CREATE TABLE owner_fixture(active boolean,licensed boolean);INSERT INTO owner_fixture VALUES(true,true);
CREATE TABLE roles(id text,organization_id text,name text);INSERT INTO roles VALUES('op','org','operacional'),('mgr','org','gestor');
CREATE FUNCTION platform_team_owner(a uuid) RETURNS text LANGUAGE plpgsql AS $$BEGIN IF a<>'${owner}'::uuid OR NOT(SELECT active FROM public.owner_fixture) THEN RAISE EXCEPTION 'Owner denied' USING ERRCODE='42501';END IF;RETURN 'platform';END$$;
CREATE FUNCTION eva_scoped_closing_action(o text,a text,r text,p boolean,action text,u text,m text,i uuid,b jsonb,s text,mode text,disclose boolean) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF o<>'org' OR NOT(SELECT licensed FROM public.owner_fixture) OR u IS NULL OR action<>'history' OR NOT p THEN RAISE EXCEPTION 'License/scope denied' USING ERRCODE='42501';END IF;RETURN '{"canPrepare":true,"canManage":true}'::jsonb;END$$;
CREATE FUNCTION eva_intake_actor(o text,a text,r text,p boolean,c text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF o<>'org' OR NOT(SELECT licensed FROM public.owner_fixture) THEN RAISE EXCEPTION 'Document license denied' USING ERRCODE='42501';END IF;RETURN '{"external":false}'::jsonb;END$$;
CREATE FUNCTION eva_intake_identity_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE a jsonb;BEGIN
 a:=public.eva_intake_actor(p_org,p_actor,p_role,p_platform,NULL);
 IF a->>'external' IS DISTINCT FROM 'false' OR NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND lower(m.status)='active' AND m.affiliation_type='internal' AND r.name IN('admin_org','gestor','operacional')) THEN RAISE EXCEPTION 'Internal documents access required' USING ERRCODE='42501';END IF;
 RETURN '{"justifications":[]}'::jsonb;END$$;
`);
// The production SQL editor reformatted this existing authorization block.
for(const signature of ['eva_document_review_queue(text,text,text,text,jsonb)','eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb)']){
 const definition=(await db.query('SELECT pg_get_functiondef($1::regprocedure) definition',['public.'+signature])).rows[0].definition;
 await db.exec(definition.replaceAll('EXISTS(SELECT','EXISTS(\n SELECT').replaceAll(';END IF;',';\n END IF;'));
}
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261331_eva_scoped_owner_review.sql','utf8'));
await closing(91,id(1),100);
const ownerStatus=()=>call('status',{closingId:id(91)},owner,'scoped-role');
const justification=(actor=owner,platform=true,action='justifications')=>db.query('SELECT eva_intake_identity_action($1,$2,$3,$4,$5,NULL,$6)', ['org',actor,'scoped-role',platform,action,'{}']);
ok((await ownerStatus()).canSubmit===true);await justification();checks++;
ok((await call('submit',command(91,901),owner,'scoped-role')).stage==='APPROVAL');
ok((await db.query('SELECT state FROM eva_assisted_closing_events WHERE closing_id=$1 ORDER BY sequence DESC LIMIT 1',[id(91)])).rows[0].state==='READY_FOR_REVIEW');
await deny(()=>justification(owner,false));await deny(()=>justification(notOwner));await deny(()=>justification(owner,true,'decide'));
await deny(()=>call('status',{closingId:id(91)},notOwner,'scoped-role'));
for(const change of ["UPDATE platform_organization_sessions SET revoked_at=now() WHERE user_id='"+owner+"'", "UPDATE platform_organization_sessions SET expires_at=now()-interval '1 minute' WHERE user_id='"+owner+"'", "UPDATE platform_organization_sessions SET organization_id='other' WHERE user_id='"+owner+"'", "UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='"+owner+"'", "UPDATE auth.users SET deleted_at=now() WHERE id='"+owner+"'", "UPDATE owner_fixture SET active=false", "UPDATE owner_fixture SET licensed=false"]){
 await db.exec('BEGIN');await db.exec(change);await deny(ownerStatus);await deny(()=>justification());await db.exec('ROLLBACK');
}
ok((await call('status',{closingId:id(91)})).canSubmit===true);
ok((await db.query('SELECT count(*)::int n FROM organization_members WHERE user_id=$1',[owner])).rows[0].n===0);
for(const role of ['anon','authenticated','service_role'])ok((await db.query("SELECT has_function_privilege($1,'eva_scoped_platform_owner(text,text)','EXECUTE') value",[role])).rows[0].value===false);
console.log('Scoped Owner access: active exact-organization session, current Owner, licensed scope, banned/deleted/revoked/expired denials; no approval or membership writes.');
console.log('Document review queue SQL:',checks,'checks passed');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
