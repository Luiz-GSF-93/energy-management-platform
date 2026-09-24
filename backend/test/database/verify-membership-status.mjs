import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++};
const actor='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222',manager='33333333-3333-4333-8333-333333333333';
const perms=['5f91d918-8def-4bc1-b6c7-37e1ff2d14e2','4c53c778-69c6-4994-b12f-c74a6867ca63'];
try {
await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE permissions(id uuid PRIMARY KEY,code text UNIQUE,name text,module text,resource text,action text);CREATE TABLE roles(id text PRIMARY KEY,name text,scope text,permissions jsonb,organization_id text);CREATE TABLE user_roles(user_id uuid,role_id text);CREATE TABLE organizations(id text PRIMARY KEY,deleted_at timestamptz);CREATE TABLE organization_members(id text PRIMARY KEY,user_id uuid,organization_id text,status text,role_id text);CREATE TABLE audit_logs(id text,organization_id text NOT NULL,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text,ip_address text,user_agent text);CREATE TABLE licenses(id text PRIMARY KEY,organization_id text,license_type text,documents_limit int,documents_used int,renewal_date date,start_date date,end_date date,status text,active bool,max_consumer_units int,document_management bool,advanced_analytics bool,report_generation bool,free_market_management bool);");

await db.query("INSERT INTO roles VALUES('global','admin_platform','global','[]',null),('ra','operacional','organization','[]','a'),('rb','operacional','organization','[]','b'),('ma','gestor','organization',$1,'a'),('aa','admin_org','organization',$1,'a')",[JSON.stringify(perms)]);
await db.query("INSERT INTO user_roles VALUES($1,'global')",[actor]);
for(const phase of ['15_plan_catalog','23_membership_status']){const sql=readFileSync(new URL('../../src/database/migrations/20260924_f1_'+phase+'.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);}
await db.query("INSERT INTO organization_members VALUES('ta',$1,'a','active','ra'),('tb',$1,'b','active','rb'),('ma',$2,'a','active','ma')",[target,manager]);
const change=(status,org='a',who=actor,role='ra',user=target,expected=status==='active'?'inactive':'active')=>db.query('SELECT set_organization_member_status($1,$2,$3,$4,$5,$6,null,null)',[org,user,who,status,expected,role]);
await change('inactive');ok((await db.query("SELECT status FROM organization_members WHERE id='ta'")).rows[0].status==='inactive','deactivated');ok((await db.query("SELECT status FROM organization_members WHERE id='tb'")).rows[0].status==='active','other organization preserved');ok((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n===1,'one audit');
await assert.rejects(()=>change('inactive'),e=>e.code==='P3231');checks++;
await change('active','a',manager);ok(true,'manager reactivates subordinate');
await assert.rejects(()=>change('inactive','a',target),e=>e.code==='42501');checks++;
await assert.rejects(()=>change('inactive','missing'),e=>e.code==='P3230');checks++;
await assert.rejects(()=>change('inactive','a',actor,'old-role'),e=>e.code==='P3231');checks++;
await assert.rejects(()=>change('inactive','a',actor,'ma',manager),e=>e.code==='P3232');checks++;
await db.exec("UPDATE organization_members SET role_id='aa' WHERE id='ta'");
await assert.rejects(()=>change('inactive','a',manager,'aa'),e=>e.code==='42501');checks++;
await change('inactive','a',actor,'aa');ok(true,'platform manages admin with another responsible');
await db.exec("UPDATE organization_members SET role_id='ra' WHERE id='ta';INSERT INTO licenses(id,organization_id,status,active,start_date,max_users) VALUES('la','a','active',true,CURRENT_DATE,1)");
await assert.rejects(()=>change('active'),e=>e.code==='P3152');checks++;
ok((await db.query("SELECT status FROM organization_members WHERE id='ta'")).rows[0].status==='inactive','quota preserves status');
await db.exec("UPDATE licenses SET max_users=2 WHERE id='la';CREATE FUNCTION fail_status_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END$$;CREATE TRIGGER reject_status_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_status_audit();");
await assert.rejects(()=>change('active'));checks++;ok((await db.query("SELECT status FROM organization_members WHERE id='ta'")).rows[0].status==='inactive','audit failure rolls back');
await db.exec('DROP TRIGGER reject_status_audit ON audit_logs');
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(()=>change('active'),e=>e.code==='42501');checks++;await db.exec('RESET ROLE');}
await db.exec("UPDATE organization_members SET status='inactive' WHERE id='ma'");
await assert.rejects(()=>change('active','a',manager),e=>e.code==='42501');checks++;
await db.exec("UPDATE organization_members SET status='active' WHERE id='ma';UPDATE roles SET permissions='[]' WHERE id='ma'");
await assert.rejects(()=>change('active','a',manager),e=>e.code==='42501');checks++;
await db.query("UPDATE roles SET permissions=$1 WHERE id='ma'",[JSON.stringify(perms)]);
await db.exec("UPDATE roles SET permissions='[\"unassigned-permission\"]' WHERE id='ra'");
await assert.rejects(()=>change('active','a',manager),e=>e.code==='42501');checks++;
await db.exec("UPDATE roles SET permissions='[]' WHERE id='ra';SET ROLE service_role");await change('active');await db.exec('RESET ROLE');ok(true,'service role can execute after all safeguards');
console.log('PASS',checks,'membership transaction, hierarchy, tenant isolation and quota checks');
} finally{await db.close()}
