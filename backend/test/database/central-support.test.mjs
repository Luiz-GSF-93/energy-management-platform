import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();let assertions=0;
const ok=v=>{assert.ok(v);assertions++;};
const admin=randomUUID(),operator=randomUUID(),foreign=randomUUID(),owner=randomUUID(),support=randomUUID(),outsider=randomUUID(),plan=randomUUID();
const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
const action=async(x,id=null,b={},actor=admin,org='org_default')=>(await q('SELECT central_support_action($1,$2,$3,$4,$5) v',[org,actor,x,id,JSON.stringify(b)]))[0].v;
const platform=async(x,id=null,b={},actor=owner)=>(await q('SELECT central_support_platform($1,$2,$3,$4) v',[actor,x,id,JSON.stringify(b)]))[0].v;
const deny=async f=>{await assert.rejects(f);assertions++;};
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE organizations(id text PRIMARY KEY,name text,deleted_at timestamptz);INSERT INTO organizations(id,name) VALUES('org_default','Expert Energy'),('foreign','Other');
 CREATE TABLE operation_notification_reads(organization_id text,user_id text,notification_key text,PRIMARY KEY(organization_id,user_id,notification_key));
 CREATE TABLE roles(id uuid PRIMARY KEY,name text,scope text,organization_id text,permissions jsonb NOT NULL DEFAULT '[]');CREATE TABLE organization_members(organization_id text,user_id uuid,role_id uuid,status text,affiliation_type text);
 CREATE TABLE plan_catalog(id uuid PRIMARY KEY);
 CREATE TABLE licenses(id text PRIMARY KEY,organization_id text,plan_id uuid,active boolean,status text,start_date date,end_date date,plan_snapshot jsonb DEFAULT '{}',max_users integer DEFAULT 10,max_consumer_units integer DEFAULT 10,documents_unlimited boolean DEFAULT true,documents_limit integer DEFAULT 10,documents_used integer DEFAULT 0,governance_revision integer DEFAULT 1,updated_at timestamptz DEFAULT now());
 CREATE TABLE platform_team_members(user_id uuid,profile text,active boolean,first_name text,last_name text);
 CREATE TABLE user_roles(user_id uuid,role_id uuid);CREATE TABLE user_profiles(user_id uuid,name text);
 CREATE TABLE platform_support_case_events(id uuid DEFAULT gen_random_uuid(),case_id uuid,revision integer,actor_id uuid,details jsonb,UNIQUE(case_id,revision));
 CREATE TABLE audit_logs(id text,organization_id text NOT NULL,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text);
 CREATE TABLE platform_plan_audit(id uuid DEFAULT gen_random_uuid(),plan_id uuid NOT NULL,actor_id uuid NOT NULL,action text,changes jsonb);
 CREATE TABLE platform_support_cases(id uuid PRIMARY KEY,revision integer,organization_id text,requester_id uuid,assignee_id uuid,title text,priority text,deadline date,status text,updated_at timestamptz);
 CREATE FUNCTION platform_workflow_actor(a uuid,p text) RETURNS text LANGUAGE plpgsql SET search_path=public AS $$DECLARE n text;BEGIN SELECT profile INTO n FROM platform_team_members WHERE user_id=a AND active;IF n IS NULL THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END IF;RETURN n;END$$;
 CREATE FUNCTION save_platform_support_case(a uuid,i uuid,v integer,b jsonb,ip text,ua text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$BEGIN
 IF coalesce((SELECT revision FROM platform_support_cases WHERE id=i),0)<>v THEN RAISE EXCEPTION 'stale' USING ERRCODE='40001';END IF;
 INSERT INTO platform_support_cases VALUES(i,1,b->>'organizationId',a,(b->>'assigneeId')::uuid,b->>'title',b->>'priority',(b->>'deadline')::date,b->>'status',now())
 ON CONFLICT(id) DO UPDATE SET revision=v+1,deadline=excluded.deadline,status=excluded.status,assignee_id=excluded.assignee_id;
 RETURN jsonb_build_object('id',i);END$$;`);
 for(const [id,email] of [[admin,'admin@example.test'],[operator,'operator@example.test'],[foreign,'foreign@example.test'],[owner,'owner@example.test'],[support,'support@example.test'],[outsider,'external@example.test']])await q('INSERT INTO auth.users(id,email) VALUES($1,$2)',[id,email]);
 const ar=randomUUID(),opr=randomUUID(),ex=randomUUID(),fr=randomUUID();await q("INSERT INTO roles(id,name,scope,organization_id) VALUES($1,'admin_org','organization','org_default'),($2,'operacional','organization','org_default'),($3,'consulta','organization','org_default'),($4,'admin_org','organization','foreign')",[ar,opr,ex,fr]);
 for(const [org,user,role,aff]of [['org_default',admin,ar,'internal'],['org_default',operator,opr,'internal'],['foreign',foreign,fr,'internal'],['org_default',outsider,ex,'external']])await q("INSERT INTO organization_members VALUES($1,$2,$3,'active',$4)",[org,user,role,aff]);
 await q("INSERT INTO platform_team_members(user_id,profile,active) VALUES($1,'OWNER',true),($2,'SUPPORT',true)",[owner,support]);await q('INSERT INTO plan_catalog VALUES($1)',[plan]);
 await q("INSERT INTO licenses(id,organization_id,plan_id,active,status,start_date,end_date) VALUES('license','org_default',$1,true,'ACTIVE',(CURRENT_DATE-interval '1 month')::date,NULL)",[plan]);

 const ownerRole=randomUUID(),supportRole=randomUUID();
 await q("INSERT INTO roles(id,name,scope,permissions) VALUES($1,'admin_platform','global',$3),($2,'platform_support','global',$4)",[ownerRole,supportRole,JSON.stringify(['a7c8f257-580d-4d39-8900-4a5788068203','a7c8f257-580d-4d39-8900-4a5788068204','af285642-16b0-405a-982c-58de1a10f987']),JSON.stringify(['a7c8f257-580d-4d39-8900-4a5788068204'])]);
 await q('INSERT INTO user_roles VALUES($1,$2),($3,$4)',[owner,ownerRole,support,supportRole]);
 for(const user of [admin,operator,foreign,owner,support,outsider])await q("INSERT INTO user_profiles VALUES($1,'Synthetic user')",[user]);
 await db.exec('DROP FUNCTION public.platform_workflow_actor(uuid,text);DROP FUNCTION public.save_platform_support_case(uuid,uuid,integer,jsonb,text,text);');
 const originalWorkflows=readFileSync(new URL('../../src/database/migrations/20261010_platform_workflows.sql',import.meta.url),'utf8');
 for(const name of ['platform_workflow_actor','platform_workflow_name','save_platform_support_case']){
 const start=originalWorkflows.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=originalWorkflows.indexOf('$$;',originalWorkflows.indexOf('AS $$',start))+3;
 assert.ok(start>=0&&end>start);await db.exec(originalWorkflows.slice(start,end));
 }

 await db.exec("CREATE FUNCTION public.organization_resource_usage(o text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('users',0,'units',0,'documents',0)$$;");
 const licenseGovernance=readFileSync(new URL('../../src/database/migrations/20260925_f1_39_license_governance.sql',import.meta.url),'utf8');
 for(const name of ['assert_license_platform_actor','guard_license_governance']){
 const start=licenseGovernance.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=licenseGovernance.indexOf('$$;',licenseGovernance.indexOf('AS $$',start))+3;
 assert.ok(start>=0&&end>start);await db.exec(licenseGovernance.slice(start,end));
 }
 await db.exec('CREATE TRIGGER guard_license_governance BEFORE INSERT OR UPDATE ON public.licenses FOR EACH ROW EXECUTE FUNCTION public.guard_license_governance();');
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261240_central_support.sql',import.meta.url),'utf8'));
 await deny(()=>action('list'));await deny(()=>action('list',null,{},outsider));
 await platform('policy',plan,{revision:0,allowance:1,extraMinor:2500,reason:'Approved test policy'});
 await platform('activate',null,{licenseId:'license',enabled:true,reason:'Test rollout'});
 let inbox=await action('list');ok(inbox.summary.allowance===1&&inbox.summary.remaining===1);
 const id=randomUUID(),hash='a'.repeat(64),draft={title:'Test support request',description:'Synthetic request without private information'};
 await action('draft',id,draft,operator);await action('draft',id,draft,operator);
 await deny(()=>action('authorize',id,{revision:1,confirmed:true,quoteMinor:0,codeHash:hash},operator));
 await deny(()=>action('submit',id,{codeHash:hash},foreign,'foreign'));await deny(()=>action('list',null,{},admin,'foreign'));
 await action('authorize',id,{revision:1,confirmed:true,quoteMinor:0,codeHash:hash});
 const wrong=await action('submit',id,{codeHash:'b'.repeat(64)},operator);ok(wrong.error==='CODE');
 ok((await q('SELECT attempts FROM central_support_requests WHERE id=$1',[id]))[0].attempts===1);
 await action('submit',id,{codeHash:hash},operator);await action('submit',id,{codeHash:hash},operator);
 ok((await q('SELECT count(*)::int n FROM central_support_movements'))[0].n===1);
 inbox=await action('list');ok(inbox.summary.remaining===0&&inbox.summary.includedUsed===1);
 ok(!JSON.stringify(inbox).includes(hash));ok(inbox.rows[0].consent.authorizedBy===admin);
 await platform('triage',id,{replyRevision:0,assigneeId:support,priority:'NORMAL',deadline:'2026-12-31',status:'OPEN',reason:'Prazo inicial informado'});
 inbox=await action('list');ok(inbox.rows[0].deadline==='2026-12-31');ok(inbox.rows[0].reply==='Prazo inicial informado');
 await deny(()=>platform('reply',id,{replyRevision:0,reason:'Stale reply'}));
 await platform('reply',id,{replyRevision:1,reason:'Resposta pública registrada'},support);
 const id2=randomUUID();await action('draft',id2,draft);await deny(()=>action('authorize',id2,{revision:1,confirmed:true,quoteMinor:0,codeHash:hash}));
 await action('authorize',id2,{revision:1,confirmed:true,quoteMinor:2500,codeHash:hash});await action('submit',id2,{codeHash:hash});
 ok((await q('SELECT amount_minor,state FROM central_support_extras WHERE request_id=$1',[id2]))[0].amount_minor===2500);
 inbox=await action('list');ok(inbox.summary.extrasUsed===1&&inbox.summary.totalUsed===2);
 await platform('policy',plan,{revision:1,allowance:99,extraMinor:1000,reason:'Future policy version'});inbox=await action('list');ok(inbox.summary.allowance===1&&inbox.summary.extraMinor===2500);
 const id3=randomUUID();await action('draft',id3,draft);await action('authorize',id3,{revision:1,confirmed:true,quoteMinor:2500,codeHash:hash});
 for(let n=0;n<5;n++)await action('submit',id3,{codeHash:'c'.repeat(64)});ok((await action('submit',id3,{codeHash:hash})).error==='EXPIRED');
 const id4=randomUUID();await action('draft',id4,draft);await action('authorize',id4,{revision:1,confirmed:true,quoteMinor:2500,codeHash:hash});
 await q("UPDATE central_support_requests SET code_expires=now()-interval '1 minute' WHERE id=$1",[id4]);ok((await action('submit',id4,{codeHash:hash})).error==='EXPIRED');

 // Two administrators can authorize while the last included slot is still free;
 // the second send must never silently become a paid ticket.
 await q("UPDATE central_support_cycles SET policy=jsonb_set(policy,'{allowance}','2')");
 const race1=randomUUID(),race2=randomUUID();
 for(const request of [race1,race2]){await action('draft',request,draft);await action('authorize',request,{revision:1,confirmed:true,quoteMinor:0,codeHash:hash});}
 await action('submit',race1,{codeHash:hash});
 ok((await action('submit',race2,{codeHash:hash})).error==='PRICE_CHANGED');
 ok((await q('SELECT count(*)::int n FROM central_support_movements WHERE request_id=$1',[race2]))[0].n===0);
 const notices=(await q('SELECT central_support_notifications($1,$2,NULL) v',['org_default',operator]))[0].v.rows;
 ok(notices.length>0&&notices.every(n=>n.id===id));
 const externalNotices=(await q('SELECT central_support_notifications($1,$2,NULL) v',['org_default',outsider]))[0].v.rows;ok(externalNotices.length===0);
 await deny(()=>q('SELECT central_support_notifications($1,$2,$3)',['foreign',foreign,notices[0].key]));
 await q('SELECT central_support_notifications($1,$2,$3)',['org_default',operator,notices[0].key]);
 ok((await q('SELECT count(*)::int n FROM operation_notification_reads'))[0].n===1);
 await deny(()=>q('UPDATE platform_support_cases SET organization_id=$1 WHERE id=$2',['foreign',id]));
 ok((await q('SELECT requester_id FROM platform_support_cases WHERE id=$1',[id]))[0].requester_id===operator);
 // Start a new anniversary cycle while retaining the old records and usage.
 const beforeCycle=(await action('list')).summary.cycleId;
 await q("UPDATE central_support_cycles SET anchor=(anchor-interval '12 months')::date, starts=(starts-interval '12 months')::date, ends=(ends-interval '12 months')::date");
 const renewed=await action('list');ok(renewed.summary.cycleId!==beforeCycle);ok(renewed.summary.allowance===99&&renewed.summary.totalUsed===0);
 ok((await q('SELECT count(*)::int n FROM central_support_cycles'))[0].n===2);
 ok((await q('SELECT count(*)::int n FROM central_support_movements'))[0].n===3);
  const claimed=(await q('SELECT central_support_delivery($1,$2,$3) v',['claim',randomUUID(),'{}']))[0].v;ok(claimed.recipients.length===1&&claimed.recipients[0]==='admin@example.test');
 ok(!(claimed.recipients.includes('foreign@example.test')));
 await q("UPDATE organization_members SET status='revoked' WHERE user_id=$1",[admin]);
 await deny(()=>action('list'));await deny(()=>action('submit',id4,{codeHash:hash},operator));

 await deny(()=>platform('policy',plan,{revision:2,allowance:100,extraMinor:0,reason:'Unauthorized configuration'},support));
 await deny(()=>platform('triage',id2,{replyRevision:0,assigneeId:support,priority:'NORMAL',deadline:'2026-12-31',status:'OPEN',reason:'Unauthorized assignment'},support));
 await deny(()=>platform('reply',id2,{replyRevision:0,reason:'Unassigned confidential request'},support));
 const ownSupportList=await platform('list',null,{},support);ok(ownSupportList.rows.every(r=>r.case?.assignee_id===support));
 const notificationId=claimed.id;
 await q("UPDATE central_support_outbox SET state='UNKNOWN' WHERE id=$1",[notificationId]);
 await platform('retry_email',notificationId,{reason:'Provider evidence checked; safe idempotent retry'});
 ok((await q('SELECT state FROM central_support_outbox WHERE id=$1',[notificationId]))[0].state==='PENDING');
 await deny(()=>platform('retry_email',notificationId,{reason:'Duplicate retry rejected'}));
 await q("UPDATE central_support_outbox SET state='UNKNOWN',created_at=now()-interval '24 hours' WHERE id=$1",[notificationId]);
 await deny(()=>platform('retry_email',notificationId,{reason:'Expired idempotency window'}));
 await db.exec('SET ROLE authenticated');
 await deny(()=>q('SELECT * FROM central_support_requests'));
 await deny(()=>q('SELECT central_support_action($1,$2,$3,NULL,$4)',['org_default',operator,'list','{}']));
 await db.exec('RESET ROLE;SET ROLE service_role');
 await deny(()=>q('SELECT * FROM central_support_requests'));
 await db.exec('RESET ROLE');
 await q("SELECT set_config('app.license_actor',$1,false)",[owner]);
 await q("INSERT INTO licenses(id,organization_id,plan_id,active,status,start_date,central_support_enabled) VALUES('foreign-license','foreign',$1,true,'ACTIVE','2024-02-29',true)",[plan]);
 const leap=await action('list',null,{},foreign,'foreign');ok(/-02-(28|29)$/.test(leap.summary.starts));ok(leap.summary.allowance===99&&leap.summary.totalUsed===0);
 await q("UPDATE organizations SET deleted_at=now() WHERE id='foreign'");await deny(()=>action('list',null,{},foreign,'foreign'));
 console.log('Central Support database assertions passed:',assertions);
}catch(e){console.error(e.message,e.code,e.where);process.exitCode=1;}finally{await db.close();}
