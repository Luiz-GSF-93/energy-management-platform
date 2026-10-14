"""Disposable PostgreSQL only; no production credentials or provider."""
import runpy,concurrent.futures
from pathlib import Path
fixture=runpy.run_path(str(Path(__file__).with_name('team-notifications-concurrency.py')))
query,owner,second=fixture['query'],fixture['owner'],fixture['second']
r=query("ALTER TABLE auth.users ADD COLUMN invited_at timestamptz DEFAULT now(), ADD COLUMN email_confirmed_at timestamptz, ADD COLUMN last_sign_in_at timestamptz;")
assert r.returncode==0,r.stderr
r=query((fixture['root']/'20261103_platform_team_password_requests.sql').read_text());assert r.returncode==0,r.stderr
def reserve(n):return query(f"BEGIN;SELECT reserve_platform_team_password('{owner}','{second}','00000000-0000-4000-8000-{n:012d}','Owner approved disposable invitation');SELECT pg_sleep(0.5);COMMIT;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(reserve,[1,2]))
assert sum(r.returncode==0 for r in results)==1
assert query('SELECT count(*) FROM platform_team_password_requests;').stdout.strip()=='1'
assert query('SELECT count(*) FROM platform_team_password_events;').stdout.strip()=='1'
assert query('SELECT count(*) FROM platform_team_notifications;').stdout.strip()=='2'
print('PASS: concurrent distinct password commands reserve one request/event and do not resend role notices.')
