"""Run only in a disposable PostgreSQL container, with no production connection."""
import concurrent.futures,subprocess,sys
from pathlib import Path
container='energyos-platform-team-20261010'
def query(sql):
 return subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input=sql,text=True,capture_output=True,timeout=45)
owner='11111111-1111-4111-8111-111111111111'
second='22222222-2222-4222-8222-222222222222'
third='33333333-3333-4333-8333-333333333333'
setup=f"""CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE TABLE roles(id text PRIMARY KEY,organization_id text,name text,scope text,permissions jsonb);
CREATE TABLE user_roles(user_id text,role_id text,PRIMARY KEY(user_id,role_id));
CREATE TABLE permissions(id text PRIMARY KEY,code text UNIQUE,name text,module text,resource text,action text);
CREATE TABLE user_profiles(id text PRIMARY KEY,user_id uuid UNIQUE,email text,name text,organization_id text,affiliation_type text);
CREATE TABLE organization_members(user_id uuid,organization_id text,role_id text);
CREATE TABLE audit_logs(id text PRIMARY KEY,organization_id text,user_id uuid,action text,resource_type text,resource_id text,changes jsonb,status text,ip_address text,user_agent text,created_at timestamptz DEFAULT now());
INSERT INTO roles VALUES('owner','platform','admin_platform','global','[]');
INSERT INTO user_roles VALUES('{owner}','owner');
"""
for identity in [owner,second,third]:
 setup+=f"INSERT INTO auth.users VALUES('{identity}','{identity}@example.com');INSERT INTO user_profiles VALUES('{identity}','{identity}','{identity}@example.com','Test fixture','platform','internal');\n"
result=query(setup)
if result.returncode:sys.exit('Fixture setup failed: '+result.stderr)
sql_path=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).parents[2]/'src/database/migrations/20261010_platform_team.sql'
result=query(sql_path.read_text())
if result.returncode:sys.exit('Migration failed: '+result.stderr)
def grant(target):
 return query(f"BEGIN;SELECT save_platform_team_member('{owner}','{target}','OWNER','Test','Owner',true,null,'{target}@example.com',false,'Concurrency test',null,null);SELECT pg_sleep(1);COMMIT;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
 results=list(executor.map(grant,[second,third]))
assert sum(r.returncode==0 for r in results)==1,[(r.returncode,r.stderr) for r in results]
winner=[second,third][next(i for i,r in enumerate(results) if r.returncode==0)]
assert query("SELECT count(*) FROM user_roles WHERE role_id='owner';").stdout.strip()=='2'
def deactivate(target):
 return query(f"BEGIN;SELECT save_platform_team_member('{target}','{target}','OWNER','Test','Owner',false,1,null,false,'Concurrency disable',null,null);SELECT pg_sleep(1);COMMIT;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
 results=list(executor.map(deactivate,[owner,winner]))
assert sum(r.returncode==0 for r in results)==1,[(r.returncode,r.stderr) for r in results]
assert query("SELECT count(*) FROM user_roles WHERE role_id='owner';").stdout.strip()=='1'
assert query("SELECT count(*) FROM platform_team_members WHERE active AND profile='OWNER';").stdout.strip()=='1'
print('PASS: PostgreSQL concurrent Owner creation and last-Owner deactivation; one creation and one deactivation rejected.')
