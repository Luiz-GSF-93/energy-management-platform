import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;
const ids=Array.from({length:6},(_,i)=>`${i+1}`.repeat(8)+'-'+`${i+1}`.repeat(4)+'-4'+`${i+1}`.repeat(3)+'-8'+`${i+1}`.repeat(3)+'-'+`${i+1}`.repeat(12));
const [owner,second,third,finance,support,tenant]=ids;
const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const ok=(v,label)=>{assert.ok(v,label);checks++;};
const denied=async(run,code)=>{await assert.rejects(run,e=>!code||e.code===code);checks++;};
const save=(user,profile='SUPPORT',revision=null,active=true,actor=owner,first='Ana',reason='Alteração conferida')=>db.query('select save_platform_team_member($1,$2,$3,$4,$5,$6,$7,$8,false,$9,null,null)',[actor,user,profile,first,'Silva',active,revision,revision===null?user+'@example.com':null,reason]);
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE TABLE roles(id text PRIMARY KEY,organization_id text,name text,scope text,permissions jsonb);
 CREATE TABLE user_roles(user_id text,role_id text,PRIMARY KEY(user_id,role_id));
 CREATE TABLE permissions(id text PRIMARY KEY,code text UNIQUE,name text,module text,resource text,action text);
 CREATE TABLE user_profiles(id text PRIMARY KEY,user_id uuid UNIQUE,email text,name text,organization_id text,affiliation_type text);
 CREATE TABLE organization_members(user_id uuid,organization_id text,role_id text);
 CREATE TABLE audit_logs(id text PRIMARY KEY,organization_id text,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text,ip_address text,user_agent text,created_at timestamptz DEFAULT now());
 INSERT INTO roles VALUES('owner','platform','admin_platform','global','["af285642-16b0-405a-982c-58de1a10f987"]'),('org','customer','consulta','organization','[]');
 INSERT INTO user_roles VALUES('${owner}','owner');`);
 for(const id of ids){await db.query('insert into auth.users values($1,$2)',[id,id+'@example.com']);await db.query('insert into user_profiles values($1::text,$1::uuid,$2,$3,$4,\'internal\')',[id,id+'@example.com',id===owner?'Administrador':'Nome original',id===tenant?'customer':'platform']);}
 await db.query('insert into organization_members values($1,\'customer\',\'org\')',[tenant]);
 const sql=readFileSync(new URL('../../src/database/migrations/20261010_platform_team.sql',import.meta.url),'utf8');
 await db.exec(sql);await db.exec(sql);
 ok(await value('select count(*)=1 from platform_team_members'),'bootstrap no extra identities');
 ok(await value("select name='Administrador' from user_profiles where user_id=$1",[owner]),'existing identity preserved');
 const snapshot=()=>value('select read_platform_team($1,0)',[owner]);
 ok((await snapshot()).ownerCount===1,'one original Owner');
 await denied(()=>save(owner,'SUPPORT',1),'P4001');
 await denied(()=>save(owner,'OWNER',1,false),'P4001');
 await denied(()=>save(tenant),'P4004');
 await save(second,'OWNER');ok((await snapshot()).ownerCount===2,'second Owner allowed');
 await denied(()=>save(third,'OWNER'),'P4002');
 await save(finance,'FINANCE');await save(support,'SUPPORT');
 for(const actor of [finance,support,tenant]){
  await denied(()=>save(third,'OWNER',null,true,actor),'42501');
  await denied(()=>value('select read_platform_team($1,0)',[actor]),'42501');
 }
 ok(await value("select permissions='[\"699703af-10ba-43a3-8eb8-9f0d9e477498\"]'::jsonb from roles where name='platform_finance'"),'finance has no plan/access permissions');
 ok(await value("select permissions='[\"c51b6e94-969a-4b9b-bcf9-05c18a4cb2d7\"]'::jsonb from roles where name='platform_support'"),'support isolated from financial permissions');
 await save(second,'OWNER',1,true,owner,'Renata');
 await denied(()=>save(second,'SUPPORT',1),'P4003');
 ok(await value("select name='Nome original' from user_profiles where user_id=$1",[second]),'team rename preserves original identity');
 ok(await value("select changes#>>'{after,firstName}'='Renata' and changes->>'actorNameAtTime'='Administrador' from platform_team_audit where target_id=$1 order by created_at desc,id desc limit 1",[second]),'historical author and team name recorded');
 await save(second,'SUPPORT',2);
 ok((await snapshot()).ownerCount===1,'demotion preserves one Owner');
 await denied(()=>save(owner,'SUPPORT',1,true,second),'42501');
 await save(second,'OWNER',3);
 await save(second,'OWNER',4,false);
 ok(await value('select count(*)=0 from user_roles where user_id=$1',[second]),'deactivation revokes global calls immediately');
 await denied(()=>value('select read_platform_team($1,0)',[second]),'42501');
 await db.query('insert into organization_members values($1,\'customer\',\'org\')',[second]);
 await denied(()=>save(second,'OWNER',5,true),'P4004');
 await db.query('delete from organization_members where user_id=$1',[second]);
 await save(third,'OWNER');
 await denied(()=>save(second,'OWNER',5,true),'P4002');
 await denied(()=>db.query("delete from user_roles where role_id='owner'"),'P4001');
 ok((await snapshot()).ownerCount===2,'last Owner deletion rolled back');
 await denied(()=>db.query("insert into user_roles values($1,'owner')",[finance]),'P4002');
 await denied(()=>db.query("insert into user_roles values($1,'2eb8c83f-4d5c-45ac-9c6e-9c3a23bb54aa')",[owner]),'P4004');
 await db.exec("CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit unavailable';END$$;CREATE TRIGGER reject_audit BEFORE INSERT ON platform_team_audit FOR EACH ROW EXECUTE FUNCTION fail_audit();");
 await denied(()=>save(support,'FINANCE',1));
 ok(await value("select profile='SUPPORT' and revision=1 from platform_team_members where user_id=$1",[support]),'audit failure rolls access change back');
 await db.exec('DROP TRIGGER reject_audit ON platform_team_audit');
 await db.query('delete from user_profiles where user_id=$1',[support]);
 await denied(()=>save(support,'FINANCE',1),'P4004');
 ok((await snapshot()).rows.find(r=>r.userId===support).registeredName===null,'missing name explicit no role fallback');
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('SET ROLE '+role);await denied(()=>db.query('select * from platform_team_members'));await denied(()=>db.query('select * from platform_team_audit'));
  if(role!=='service_role')await denied(()=>snapshot());
  await db.exec('RESET ROLE');
 }
 console.log('PASS',checks,'platform team database checks');
}catch(error){console.error('FAIL',error.message,error.code??'',error.where??'');process.exitCode=1;}finally{await db.close();}
