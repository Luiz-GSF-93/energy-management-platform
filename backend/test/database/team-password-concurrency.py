"""Disposable PostgreSQL only; no production credentials or provider."""
import runpy,concurrent.futures
from pathlib import Path
fixture=runpy.run_path(str(Path(__file__).with_name('team-notifications-concurrency.py')))
query,owner,second=fixture['query'],fixture['owner'],fixture['second']
r=query("ALTER TABLE auth.users ADD COLUMN invited_at timestamptz DEFAULT now(), ADD COLUMN email_confirmed_at timestamptz, ADD COLUMN last_sign_in_at timestamptz;")
assert r.returncode==0,r.stderr
r=query((fixture['root']/'20261103_platform_team_password_requests.sql').read_text(encoding='utf-8'));assert r.returncode==0,r.stderr
r=query((fixture['root']/'20261104_platform_team_password_deadlines.sql').read_text(encoding='utf-8'));assert r.returncode==0,r.stderr
def reserve(n):return query(f"BEGIN;SELECT reserve_platform_team_password('{owner}','{second}','00000000-0000-4000-8000-{n:012d}','Owner approved disposable invitation');SELECT pg_sleep(0.5);COMMIT;")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(reserve,[1,2]))
assert sum(r.returncode==0 for r in results)==1
assert query('SELECT count(*) FROM platform_team_password_requests;').stdout.strip()=='1'
assert query('SELECT count(*) FROM platform_team_password_events;').stdout.strip()=='1'
assert query('SELECT count(*) FROM platform_team_notifications;').stdout.strip()=='2'
print('PASS: concurrent distinct password commands reserve one request/event and do not resend role notices.')

# Definitive business conflict, never a transient serialization failure.
r=query("\\set VERBOSITY verbose\n"+f"SELECT reserve_platform_team_password_expiring('{owner}','{second}','00000000-0000-4000-8000-000000000003','Owner approved disposable recovery',clock_timestamp()+interval '45 seconds');")
assert r.returncode!=0 and 'PT409' in r.stderr,r.stderr
r=query("\\set VERBOSITY verbose\n"+f"SELECT reserve_platform_team_password_expiring('{owner}','{second}','00000000-0000-4000-8000-000000000004','Owner approved disposable recovery',clock_timestamp()-interval '1 second');")
assert r.returncode!=0 and 'PT408' in r.stderr,r.stderr
assert query('SELECT count(*) FROM platform_team_password_requests;').stdout.strip()=='1'
# Preserve the old reservation in history and test a new private command in disposable DB only.
r=query("UPDATE platform_team_password_requests SET state='FAILED',created_at=now()-interval '11 minutes';")
assert r.returncode==0,r.stderr
r=query("\\set VERBOSITY verbose\n"+f"SELECT reserve_platform_team_password_expiring('{owner}','{second}','00000000-0000-4000-8000-000000000005','Owner approved disposable recovery',clock_timestamp()+interval '45 seconds');")
assert r.returncode==0,r.stderr
rid=query("SELECT id FROM platform_team_password_requests WHERE request_key='00000000-0000-4000-8000-000000000005'").stdout.strip()
r=query("\\set VERBOSITY verbose\n"+f"SELECT finish_platform_team_password('{owner}','{rid}','ACCEPTED');")
assert r.returncode!=0 and 'PT409' in r.stderr,r.stderr
r=query(f"SELECT start_platform_team_password('{second}','{rid}');")
assert r.returncode!=0,r.stderr
r=query(f"SELECT start_platform_team_password('{owner}','{rid}');")
assert r.returncode==0 and 'true' in r.stdout,r.stderr
r=query(f"SELECT start_platform_team_password('{owner}','{rid}');")
assert r.returncode==0 and 'false' in r.stdout,r.stderr
r=query("\\set VERBOSITY verbose\n"+f"SELECT finish_platform_team_password('{owner}','{rid}','NOT_SENT');")
assert r.returncode!=0 and 'PT409' in r.stderr,r.stderr
r=query("\\set VERBOSITY verbose\n"+f"SELECT finish_platform_team_password('{owner}','{rid}','UNKNOWN');")
assert r.returncode==0,r.stderr
assert query("SELECT count(*) FROM platform_team_password_events WHERE state='PROVIDER_STARTED'").stdout.strip()=='1'
assert query('SELECT count(*) FROM platform_team_notifications;').stdout.strip()=='2'
print('PASS: PT409 cooldown, PT408 expired reservation, no late insert, durable checkpoint once, Owner isolation and unknown-result lock.')

# A queued reservation cannot become valid after its caller deadline.
assert query("UPDATE platform_team_password_requests SET state='FAILED',created_at=now()-interval '11 minutes';").returncode==0
import time
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
 lock=pool.submit(query,"BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));SELECT pg_sleep(1.5);COMMIT;")
 time.sleep(.2)
 before=query('SELECT count(*) FROM platform_team_password_requests;').stdout.strip()
 r=query("\\set VERBOSITY verbose\n"+f"SELECT reserve_platform_team_password_expiring('{owner}','{second}','00000000-0000-4000-8000-000000000006','Owner approved queued command test',clock_timestamp()+interval '300 milliseconds');")
 assert r.returncode!=0 and 'PT408' in r.stderr,r.stderr
 assert lock.result().returncode==0
 assert query('SELECT count(*) FROM platform_team_password_requests;').stdout.strip()==before
print('PASS: reservation delayed by transaction lock expires without inserting a row.')
