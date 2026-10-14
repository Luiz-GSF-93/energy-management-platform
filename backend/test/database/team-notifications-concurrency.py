"""Run only in a disposable PostgreSQL container, with no production connection."""
import concurrent.futures,subprocess,sys
from pathlib import Path
container='energyos-team-notifications-20261014'
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
assert result.returncode==0,result.stderr
root=Path(__file__).parents[2]/'src/database/migrations'
for name in ['20261010_platform_team.sql','20261031_platform_team_notifications.sql']:
 result=query((root/name).read_text());assert result.returncode==0,result.stderr
result=query(f"SELECT save_platform_team_member('{owner}','{second}','SUPPORT','Test','Support',true,null,'{second}@example.com',false,'Queue concurrency fixture',null,null);")
assert result.returncode==0,result.stderr
def claim(n):
 return query(f"BEGIN;SELECT claim_platform_team_notification('00000000-0000-4000-8000-{n:012d}') IS NOT NULL;SELECT pg_sleep(0.5);COMMIT;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
 results=list(executor.map(claim,[1,2]))
assert all(r.returncode==0 for r in results),[r.stderr for r in results]
assert sum('\nt\n' in '\n'+r.stdout for r in results)==1,[r.stdout for r in results]
assert query("SELECT count(*) FROM platform_team_notifications WHERE state='SENDING';").stdout.strip()=='1'
assert query("SELECT count(*) FROM platform_team_notification_events WHERE state='SENDING';").stdout.strip()=='1'
result=query(f"BEGIN;SELECT save_platform_team_member('{owner}','{third}','SUPPORT','Test','Rollback',true,null,'{third}@example.com',false,'Rollback notification fixture',null,null);ROLLBACK;")
assert result.returncode==0,result.stderr
assert query("SELECT count(*) FROM platform_team_notifications;").stdout.strip()=='1'
result=query((root/'20261102_platform_team_notification_prepare.sql').read_text(encoding='utf-8'));assert result.returncode==0,result.stderr
result=query(f"BEGIN;ALTER TABLE platform_team_audit DISABLE TRIGGER platform_team_notification_grant;SELECT save_platform_team_member('{owner}','{third}','SUPPORT','Historical','Support',true,null,'{third}@example.com',false,'Historical grant fixture',null,null);ALTER TABLE platform_team_audit ENABLE TRIGGER platform_team_notification_grant;COMMIT;")
assert result.returncode==0,result.stderr
result=query(f"BEGIN;SELECT prepare_platform_team_notification('{owner}','{third}','Owner approved the historical notice.');ROLLBACK;")
assert result.returncode==0,result.stderr
assert query('SELECT count(*) FROM platform_team_notifications;').stdout.strip()=='1'
def prepare(n):return query(f"BEGIN;SELECT prepare_platform_team_notification('{owner}','{third}','Owner approved the historical notice.')->>'created';SELECT pg_sleep(0.5);COMMIT;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:results=list(executor.map(prepare,[1,2]))
assert all(r.returncode==0 for r in results),[r.stderr for r in results]
assert sum('true' in r.stdout for r in results)==1 and sum('false' in r.stdout for r in results)==1
assert query('SELECT count(*) FROM platform_team_notifications;').stdout.strip()=='2'
assert query("SELECT count(*) FROM platform_team_notification_events WHERE source='OWNER';").stdout.strip()=='1'
print('PASS: manual preparation rollback and two concurrent Owner commands preserve exactly one notification/event.')
print('PASS: PostgreSQL concurrent workers reserve one message only; grant rollback leaves no outbox or mail event.')
