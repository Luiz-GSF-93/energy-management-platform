"""Disposable PostgreSQL only. No credentials or production connection."""
import concurrent.futures,json,subprocess,sys
from pathlib import Path
container='energyos-platform-workflows-20261010'
def query(sql):
 return subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input=sql,text=True,capture_output=True,timeout=45)
ids=[str(i)*8+'-'+str(i)*4+'-4'+str(i)*3+'-8'+str(i)*3+'-'+str(i)*12 for i in range(1,6)]
owner,other,finance,support,support2=ids
setup="""CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);CREATE TABLE storage.objects(bucket_id text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE TABLE roles(id text PRIMARY KEY,name text,scope text,permissions jsonb);CREATE TABLE user_roles(user_id text,role_id text);
CREATE TABLE permissions(id text PRIMARY KEY,code text UNIQUE,name text,module text,resource text,action text);
CREATE TABLE platform_team_members(user_id uuid,profile text,active boolean,first_name text,last_name text);CREATE TABLE user_profiles(user_id uuid,name text);CREATE TABLE organizations(id text PRIMARY KEY,name text);
INSERT INTO organizations VALUES('a','Fixture A');INSERT INTO roles VALUES('OWNER','admin_platform','global','[]'),('FINANCE','platform_finance','global','[]'),('SUPPORT','platform_support','global','[]');
"""
for i,identity in enumerate(ids):
 profile=['OWNER','OWNER','FINANCE','SUPPORT','SUPPORT'][i]
 setup+=f"INSERT INTO auth.users VALUES('{identity}');INSERT INTO user_profiles VALUES('{identity}','Fixture name');INSERT INTO platform_team_members VALUES('{identity}','{profile}',true,'Fixture','User');INSERT INTO user_roles VALUES('{identity}','{profile}');\n"
r=query(setup);assert r.returncode==0,r.stderr
r=query((Path(__file__).parents[2]/'src/database/migrations/20261010_platform_workflows.sql').read_text(encoding='utf-8'));assert r.returncode==0,r.stderr
ticket='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
body=json.dumps(dict(title='Concurrent fixture',organizationId='a',assigneeId=support,priority='NORMAL',deadline='2026-12-01',reason='Concurrency fixture'))
r=query(f"SELECT save_platform_support_case('{owner}','{ticket}',0,'{body}',null,null);");assert r.returncode==0,r.stderr
def update(actor):
 body=json.dumps(dict(status='IN_PROGRESS',reason='Concurrent update')) if actor==support else json.dumps(dict(assigneeId=support2,reason='Concurrent reassignment'))
 return query(f"BEGIN;SELECT save_platform_support_case('{actor}','{ticket}',1,'{body}',null,null);SELECT pg_sleep(0.5);COMMIT;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(update,[owner,support]))
assert sum(r.returncode==0 for r in results)==1,[(r.returncode,r.stderr) for r in results]
assert query(f"SELECT revision FROM platform_support_cases WHERE id='{ticket}';").stdout.strip()=='2'
assert query('SELECT count(*) FROM platform_support_case_events;').stdout.strip()=='2'
evidence='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';recon='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
financial=json.dumps(dict(provider='Fixture provider',month='2026-10-01',currency='EUR',amountMinor=10000,basis='PROVIDER_CONFIRMED',evidenceId=evidence,externalReference='fixture-1',method='',allocations=[],reason='Concurrency fixture'))
r=query(f"SELECT register_platform_financial_evidence('{finance}','{evidence}','{'a'*64}','{evidence}/evidence.pdf','fixture.pdf',100);SELECT save_platform_reconciliation('{finance}','{recon}',0,'PROPOSE','{financial}',null,null);");assert r.returncode==0,r.stderr
def decide(actor):
 action='CONFIRM' if actor==owner else 'REJECT'
 return query(f"BEGIN;SELECT save_platform_reconciliation('{actor}','{recon}',1,'{action}','{{\"reason\":\"Concurrent decision\"}}',null,null);SELECT pg_sleep(0.5);COMMIT;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(decide,[owner,other]))
assert sum(r.returncode==0 for r in results)==1,[(r.returncode,r.stderr) for r in results]
assert query('SELECT count(*) FROM platform_cost_reconciliation_versions;').stdout.strip()=='2'
assert query('SELECT count(*) FROM platform_cost_reconciliation_audit;').stdout.strip()=='2'
print('PASS PostgreSQL concurrent case reassignment/update and independent financial decisions: one revision wins, stale command denied, audit atomic.')
