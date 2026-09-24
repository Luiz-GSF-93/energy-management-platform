import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++};const user='11111111-1111-4111-8111-111111111111';
try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE organization_members(id text PRIMARY KEY,user_id uuid,organization_id text,status varchar,role_id text);CREATE TABLE audit_logs(id text,organization_id text,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text,ip_address text,user_agent text);INSERT INTO organization_members VALUES('a','${user}','org-a','active','ra'),('b','${user}','org-b','active','rb');`);
const migration=readFileSync(new URL('../../src/database/migrations/20260924_f1_13_membership_details.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
const change=(org,aff,name)=>db.query('SELECT update_organization_member_details($1,$2,$2,$3,$4,null,null)',[org,user,aff,name]);
ok((await db.query('SELECT affiliation_type FROM organization_members')).rows.every(r=>r.affiliation_type===null),'legacy classification not guessed');
await change('org-a','internal','Name A');await change('org-b','external','Name B');const rows=(await db.query('SELECT affiliation_type,display_name FROM organization_members ORDER BY id')).rows;assert.deepEqual(rows,[{affiliation_type:'internal',display_name:'Name A'},{affiliation_type:'external',display_name:'Name B'}]);checks++;
await change('org-a','external',null);ok((await db.query("SELECT display_name FROM organization_members WHERE id='a'")).rows[0].display_name==='Name A','affiliation edit preserves name');
await assert.rejects(()=>change('org-c','internal','Xx'),e=>e.code==='P3130');checks++;
await assert.rejects(()=>change('org-a','invalid','Xx'));checks++;
await db.exec("CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END$$;CREATE TRIGGER audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit();");
await assert.rejects(()=>change('org-a','internal','Changed'));checks++;
ok((await db.query("SELECT display_name,affiliation_type FROM organization_members WHERE id='a'")).rows[0].affiliation_type==='external','audit failure rolls back');
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(()=>change('org-a','internal','Test'),e=>e.code==='42501');checks++;await db.exec('RESET ROLE');}
console.log('PASS',checks,'membership database checks');
}finally{await db.close()}
