import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;
const ids=Array.from({length:6},(_,i)=>`${i+1}`.repeat(8)+'-'+`${i+1}`.repeat(4)+'-4'+`${i+1}`.repeat(3)+'-8'+`${i+1}`.repeat(3)+'-'+`${i+1}`.repeat(12));
const [owner,second,third,finance,support,tenant]=ids;
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const ok=(v,label)=>{assert.ok(v,label);checks++;};
const denied=async(run,code)=>{await assert.rejects(run,e=>!code||e.code===code);checks++;};
const save=(user,profile='SUPPORT',revision=null,active=true,actor=owner,first='Ana',reason='AlteraÃ§Ã£o conferida')=>db.query('select save_platform_team_member($1,$2,$3,$4,$5,$6,$7,$8,false,$9,null,null)',[actor,user,profile,first,'Silva',active,revision,revision===null?user+'@example.com':null,reason]);
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,invited_at timestamptz DEFAULT now(),email_confirmed_at timestamptz,last_sign_in_at timestamptz);
 CREATE TABLE roles(id text PRIMARY KEY,organization_id text,name text,scope text,permissions jsonb);
 CREATE TABLE user_roles(user_id text,role_id text,PRIMARY KEY(user_id,role_id));
 CREATE TABLE permissions(id text PRIMARY KEY,code text UNIQUE,name text,module text,resource text,action text);
 CREATE TABLE user_profiles(id text PRIMARY KEY,user_id uuid UNIQUE,email text,name text,organization_id text,affiliation_type text);
 CREATE TABLE organization_members(user_id uuid,organization_id text,role_id text);
 CREATE TABLE audit_logs(id text PRIMARY KEY,organization_id text,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text,ip_address text,user_agent text,created_at timestamptz DEFAULT now());
 INSERT INTO roles VALUES('owner','platform','admin_platform','global','["af285642-16b0-405a-982c-58de1a10f987"]'),('org','customer','consulta','organization','[]');
 INSERT INTO user_roles VALUES('${owner}','owner');`);
 for(const id of ids){await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.com']);await db.query('insert into user_profiles values($1::text,$1::uuid,$2,$3,$4,\'internal\')',[id,id+'@example.com',id===owner?'Administrador':'Nome original',id===tenant?'customer':'platform']);}
 await db.query('insert into organization_members values($1,\'customer\',\'org\')',[tenant]);
 await db.exec(readFileSync(new URL("../../src/database/migrations/20261010_platform_team.sql",import.meta.url),"utf8"));
 await db.exec(readFileSync(new URL("../../src/database/migrations/20261031_platform_team_notifications.sql",import.meta.url),"utf8"));
 await db.exec(readFileSync(new URL("../../src/database/migrations/20261101_platform_team_webhook_isolation.sql",import.meta.url),"utf8"));
 await db.exec(readFileSync(new URL("../../src/database/migrations/20261102_platform_team_notification_prepare.sql",import.meta.url),"utf8"));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261103_platform_team_password_requests.sql',import.meta.url),'utf8'));
 await save(second,'OWNER');await save(finance,'FINANCE');await save(support,'SUPPORT');
 const key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const begin=(a=owner,u=second,k=key)=>value('select reserve_platform_team_password($1,$2,$3,$4)',[a,u,k,'Convite solicitado e conferido pelo Owner']);
 for(const a of [finance,support,tenant]){await denied(()=>value('select read_platform_team_password($1,$2)',[a,second]),'42501');await denied(()=>begin(a),'42501');}
 await denied(()=>begin(owner,tenant),'22023');
 const grant=await value("select to_jsonb(t) from platform_team_members t where user_id=$1",[second]);
 const noticeCount=await value('select count(*) from platform_team_notifications');
 const r=await begin();ok(r.created&&r.purpose==='INVITE','existing invited identity reserved');
 ok(!(await begin()).created,'same request key is idempotent');
 await denied(()=>begin(second,second,key),'42501');
 await denied(()=>begin(owner,second,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'40001');
 await value("select finish_platform_team_password($1,$2,'ACCEPTED')",[owner,r.id]);
 ok((await value('select read_platform_team_password($1,$2)',[owner,second])).rows[0].events.length===2,'immutable reserved and outcome events');
 await denied(()=>db.query('delete from platform_team_password_events'),'42501');
 await db.query("update auth.users set email_confirmed_at=now() where id=$1",[support]);
 const recovered=await begin(owner,support,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');ok(recovered.purpose==='RECOVERY','confirmed identity reserves recovery');
 await value("select finish_platform_team_password($1,$2,'UNKNOWN')",[owner,recovered.id]);
 await denied(()=>begin(owner,support,'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),'40001');
 ok(JSON.stringify(await value('select to_jsonb(t) from platform_team_members t where user_id=$1',[second]))===JSON.stringify(grant),'grant unchanged');
 ok(await value('select count(*) from platform_team_notifications')===noticeCount,'password requests do not queue role notices');
 for(const role of ['anon','authenticated','service_role']){ok(!await value("select has_table_privilege($1,'platform_team_password_requests','SELECT')",[role]),'no direct request access '+role);ok(!await value("select has_table_privilege($1,'platform_team_password_events','INSERT')",[role]),'no direct history write '+role);}
 for(const role of ['anon','authenticated'])ok(!await value("select has_function_privilege($1,'reserve_platform_team_password(uuid,uuid,uuid,text)','EXECUTE')",[role]),'RPC denied '+role);
 const detail=await value('select read_platform_team_password($1,$2)',[owner,second]);ok(detail.total===1&&!JSON.stringify(detail).includes('token'),'safe paged metadata');
 console.log(JSON.stringify({checks,status:'PASS'}));
}finally{await db.close();}
