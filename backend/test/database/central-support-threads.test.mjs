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
 CREATE TABLE platform_support_case_events(id uuid DEFAULT gen_random_uuid(),case_id uuid,revision integer,actor_id uuid NOT NULL,details jsonb,UNIQUE(case_id,revision));
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
 for(const user of [admin,operator,foreign,owner,support,outsider])await q("INSERT INTO user_profiles VALUES($1,$2)",[user,'Synthetic '+user]);
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
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261241_central_support_audit_names.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261242_central_support_admin_triage.sql',import.meta.url),'utf8'));

 await db.exec(readFileSync(new URL('../../src/database/migrations/20261248_central_support_threads.sql',import.meta.url),'utf8'));
 await platform('policy',plan,{revision:0,allowance:60,extraMinor:2500,reason:'Approved test policy'});
 await platform('activate',null,{licenseId:'license',enabled:true,reason:'Test rollout'});
 const id=randomUUID(),hash='a'.repeat(64);
 await action('draft',id,{title:'Synthetic ticket',description:'Test support continuity'},operator);
 const thread=async(x,b={},actor=owner,p=true)=>(await q('SELECT central_support_thread($1,$2,$3,$4,$5,$6) v',[p?null:'org_default',actor,p,x,id,JSON.stringify(b)]))[0].v;
 const files=async(x,b={},actor=operator,p=false)=>(await q('SELECT central_support_files($1,$2,$3,$4,$5,$6) v',[p?null:'org_default',actor,p,x,id,JSON.stringify(b)]))[0].v;
 await deny(()=>thread('read',{},foreign,false));await deny(()=>thread('read',{},outsider,false));
 let f=await files('reserve',{filename:'evidence.pdf',mime:'application/pdf',bytes:200,sha256:hash});
 await deny(()=>action('authorize',id,{revision:1,confirmed:true,quoteMinor:0,codeHash:hash}));
 await files('finish',{id:f.id,sha256:hash});
 await action('authorize',id,{revision:1,confirmed:true,quoteMinor:0,codeHash:hash});
 await action('submit',id,{codeHash:hash},operator);
 const start={commandId:randomUUID(),revision:0,text:'Iniciando atendimento',deadline:'2027-12-31'};
 await thread('START',start);ok((await thread('START',start)).idempotent);
 await deny(()=>thread('START',{...start,text:'Changed command'}));await deny(()=>thread('read',{},support));
 const send=async(x,text,actor=owner,p=true)=>{const t=await thread('read',{},actor,p);return thread(x,{commandId:randomUUID(),revision:t.revision,text},actor,p);};
 await send('WAIT','Precisamos de mais evidências');await send('UPDATE','Evidências conferidas pela organização',operator,false);
 ok((await thread('read')).status==='IN_PROGRESS');await send('RESOLVE','Solução aplicada e verificada');
 ok((await q('SELECT central_support_close_due(50) v'))[0].v.closed===0);
 await q("UPDATE central_support_outbox SET state='UNKNOWN' WHERE id=(SELECT resolution_notice_id FROM central_support_requests WHERE id=$1)",[id]);
 ok((await q('SELECT central_support_close_due(50) v'))[0].v.armed===0);
 await q("UPDATE central_support_outbox SET state='ACCEPTED',accepted_at=now() WHERE id=(SELECT resolution_notice_id FROM central_support_requests WHERE id=$1)",[id]);
 ok((await q('SELECT central_support_close_due(50) v'))[0].v.armed===1);
 await send('CONTEST','Problema continua acontecendo',operator,false);ok(!(await thread('read')).resolution.id);
 await send('RESOLVE','Solução revista e aplicada');await send('CONFIRM','Solução confirmada pela organização',operator,false);
 ok((await thread('read')).status==='CLOSED');await deny(()=>send('UPDATE','Tentativa depois do encerramento'));
 ok((await q('SELECT count(*)::integer n FROM central_support_movements'))[0].n===1);
 await deny(()=>q("UPDATE central_support_messages SET body='Alterado' WHERE request_id=$1",[id]));
 await deny(()=>files('path',{id:f.id},foreign,false));ok((await files('path',{id:f.id})).bytes===200);

 // A second resolution closes once after a full 24h of accepted notification.
 const id2=randomUUID();await action('draft',id2,{title:'Second synthetic ticket',description:'Automatic closure verification'});
 await action('authorize',id2,{revision:1,confirmed:true,quoteMinor:0,codeHash:hash});await action('submit',id2,{codeHash:hash});
 const t2=async(x,b={})=>(await q('SELECT central_support_thread(NULL,$1,true,$2,$3,$4) v',[owner,x,id2,JSON.stringify(b)]))[0].v;
 await t2('START',{commandId:randomUUID(),revision:0,text:'Atendimento iniciado',deadline:'2027-12-31',assigneeId:support});
 await t2('RESOLVE',{commandId:randomUUID(),revision:1,text:'Solução disponível no painel'});
 await q("UPDATE central_support_requests SET resolved_at=now()-interval '25 hours' WHERE id=$1",[id2]);
 await q("UPDATE central_support_outbox SET created_at=now()-interval '25 hours',state='ACCEPTED',accepted_at=now()-interval '23 hours' WHERE id=(SELECT resolution_notice_id FROM central_support_requests WHERE id=$1)",[id2]);
 ok((await q('SELECT central_support_close_due(50) v'))[0].v.closed===0);
 await q("UPDATE central_support_outbox SET accepted_at=now()-interval '25 hours' WHERE id=(SELECT resolution_notice_id FROM central_support_requests WHERE id=$1)",[id2]);
 await q("UPDATE central_support_requests SET close_due_at=now()-interval '1 hour' WHERE id=$1",[id2]);
 ok((await q('SELECT central_support_close_due(50) v'))[0].v.closed===1);ok((await q('SELECT central_support_close_due(50) v'))[0].v.closed===0);
 ok((await t2('read')).status==='CLOSED');
 const id3=randomUUID();await action('draft',id3,{title:'Attachment limits test',description:'Private attachment limit verification'});
 const f3=async(x,b)=>(await q('SELECT central_support_files($1,$2,false,$3,$4,$5) v',['org_default',admin,x,id3,JSON.stringify(b)]))[0].v;
 for(let n=1;n<=5;n++)await f3('reserve',{filename:'evidence'+n+'.png',mime:'image/png',bytes:5242880,sha256:String(n).repeat(64)});
 await deny(()=>f3('reserve',{filename:'sixth.png',mime:'image/png',bytes:1,sha256:'6'.repeat(64)}));
 const dup=await f3('reserve',{filename:'duplicate.png',mime:'image/png',bytes:5242880,sha256:'1'.repeat(64)});ok(dup.state==='RESERVED');
 await deny(()=>f3('reserve',{filename:'oversized.pdf',mime:'application/pdf',bytes:5242881,sha256:'7'.repeat(64)}));
 await db.exec('SET ROLE authenticated');await deny(()=>q('SELECT * FROM central_support_messages'));await db.exec('RESET ROLE');
 const queue=await platform('list');ok(queue.rows.length===2);ok(queue.rows.every(r=>typeof r.hasOrganizationReply==='boolean'));
 console.log('Support thread database assertions passed:',assertions);
}catch(e){console.error(e.message,e.code,e.where);process.exitCode=1;}finally{await db.close();}
