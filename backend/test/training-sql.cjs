const {PGlite}=require('@electric-sql/pglite');const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let tests=0;const ok=(x)=>{assert.ok(x);tests++};
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA storage;
CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
CREATE TABLE public.organizations(id text PRIMARY KEY,deleted_at timestamptz);
CREATE TABLE public.roles(id text,organization_id text,scope text,name text,permissions jsonb);
CREATE TABLE public.organization_members(organization_id text,user_id uuid,status text,role_id text,affiliation_type text,permission_limit jsonb);
CREATE TABLE public.licenses(organization_id text,active boolean,status text,start_date date,end_date date,ccee_data boolean,ccee_registrations boolean,free_market_management boolean);
CREATE TABLE public.energy_audit_events(id uuid,organization_id text,actor_id text,module text,action text,resource text,reason text,result text);
CREATE TABLE storage.objects(bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
INSERT INTO public.organizations VALUES('org_default',NULL),('org-other',NULL);
INSERT INTO auth.users(id) VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
INSERT INTO roles VALUES('op','org_default','organization','operacional','["f5364101-4486-42c2-a90f-807937ac3011"]'),('other','org-other','organization','operacional','["f5364101-4486-42c2-a90f-807937ac3011"]');
INSERT INTO organization_members VALUES('org_default','11111111-1111-4111-8111-111111111111','active','op','internal',NULL),('org-other','22222222-2222-4222-8222-222222222222','active','other','internal',NULL),('org_default','33333333-3333-4333-8333-333333333333','active','op','external',NULL);
INSERT INTO licenses VALUES('org_default',true,'ACTIVE','2020-01-01',NULL,true,false,false),('org-other',true,'ACTIVE','2020-01-01',NULL,true,false,false);`);
await db.exec(fs.readFileSync('src/database/migrations/20261276_ccee_training.sql','utf8'));
const user='11111111-1111-4111-8111-111111111111',pid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const state=async(org='org_default',actor=user)=>(await db.query('SELECT public.training_state($1,$2,NULL) s',[org,actor])).rows[0].s;
const cmd=async(action,pos=0,playing=false,visible=true,player=pid)=>(await db.query('SELECT public.training_command($1,$2,$3,$4,$5,$6,$7,$8) s',['org_default',user,'ccee-operations-v2',action,player,pos,playing,visible])).rows[0].s;
ok(!(await state()).eligible); // Draft is not exposed.
await db.exec(`UPDATE training_content_versions SET status='PUBLISHED',mandatory=true,duration_seconds=30,published_at=now() WHERE id='ccee-operations-v2';`);
ok((await state()).eligible);ok(!(await state('org-other')).eligible);ok(!(await state('org_default','33333333-3333-4333-8333-333333333333')).eligible);ok(!(await state('org-other','22222222-2222-4222-8222-222222222222')).eligible);
ok((await cmd('DEFER')).progress.percent===0);ok(!(await state()).progress.completedAt);
await cmd('OPEN');await cmd('TICK',0,true);await cmd('TICK',30,false);ok(!(await state()).progress.completedAt);ok((await state()).progress.percent===0); // Seek-to-end never completes.
await cmd('RELEASE',30,false);await cmd('OPEN',0);await cmd('TICK',0,true);
await db.exec(`UPDATE organization_training_progress SET last_tick=clock_timestamp()-interval '10 seconds';`);await cmd('TICK',10,true);ok((await state()).progress.percent===33);
await db.exec(`UPDATE organization_training_progress SET last_tick=clock_timestamp()-interval '10 seconds';`);await cmd('TICK',20,true);ok((await state()).progress.percent===67);
await assert.rejects(()=>cmd('TICK',20,true,true,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));tests++;
await assert.rejects(()=>cmd('OPEN',20,false,true,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));tests++;
await db.exec(`UPDATE organization_training_progress SET last_tick=clock_timestamp()-interval '10 seconds';`);await cmd('TICK',30,false);ok(!!(await state()).progress.completedAt);ok((await state()).progress.percent===100);
await cmd('DEFER');ok(!!(await state()).progress.completedAt); // Deferral cannot regress completion.
await db.exec(`UPDATE organization_members SET permission_limit='[]' WHERE user_id='${user}';`);ok(!(await state()).eligible);
await db.exec(`UPDATE organization_members SET permission_limit=NULL WHERE user_id='${user}';UPDATE licenses SET end_date='2020-02-01' WHERE organization_id='org_default';`);ok(!(await state()).eligible);
await db.exec('SET ROLE authenticated;');await assert.rejects(()=>db.query('SELECT * FROM organization_training_progress'));tests++;await assert.rejects(()=>state());tests++;await db.exec('RESET ROLE;');
ok((await db.query("SELECT count(*)::int n FROM energy_audit_events WHERE action='TRAINING_COMPLETED'")).rows[0].n===1);
await db.close();console.log('training SQL:',tests,'checks passed');
})().catch(e=>{console.error(e);process.exit(1)});
