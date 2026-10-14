"""Audit additive migration using the established private DB connection helper.
Never prints credentials, rows, text, connection strings or raw provider responses.
"""
import sys,json,hashlib
from pathlib import Path
from rag_db_connection import connection
mode=sys.argv[1]
assert mode in ('dry-run','apply')
path=Path(__file__).resolve().parents[2]/'backend/src/database/migrations/20261104_platform_team_password_deadlines.sql'
source=path.read_text(encoding='utf-8')
assert source.strip().startswith('BEGIN;') and source.strip().endswith('COMMIT;')
body=source.strip()[len('BEGIN;'):-len('COMMIT;')]
new_tables=set()
password_tables={'platform_team_password_requests','platform_team_password_events'}
new_functions={'reserve_platform_team_password_expiring(uuid,uuid,uuid,text,timestamp with time zone)','start_platform_team_password(uuid,uuid)'}
changed_functions={'read_platform_team_password(uuid,uuid,integer)','reserve_platform_team_password(uuid,uuid,uuid,text)','finish_platform_team_password(uuid,uuid,text)'}

def snapshot(cur):
 cur.execute("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname")
 tables={r[0]:list(r[1:]) for r in cur.fetchall()}
 rows={}
 for name in tables:
  assert name.replace('_','').isalnum()
  projection="(to_jsonb(x)-'reservation_deadline'-'provider_started_at'-'resolution_reason')" if name=='platform_team_password_requests' else 'to_jsonb(x)'
  cur.execute("SELECT count(*),md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) FROM (SELECT md5("+projection+"::text) row_hash FROM public.\""+name+'" x) h')
  rows[name]=list(cur.fetchone())
 cur.execute("SELECT p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),p.proacl::text,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY 1")
 return {'tables':tables,'rows':rows,'functions':{r[0]:list(r[1:]) for r in cur.fetchall()}}
with connection() as conn:
 with conn.cursor() as cur:
  cur.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
  cur.execute("SET LOCAL statement_timeout='60s'")
  before=snapshot(cur)
  assert password_tables.issubset(before['tables']),'Initial migration required'
  assert not new_functions.intersection(before['functions']),'Already present; inspect first'
  cur.execute(body)
  after=snapshot(cur)
  cur.execute('SELECT count(*) FROM public.platform_team_password_requests WHERE reservation_deadline IS NOT NULL OR provider_started_at IS NOT NULL OR resolution_reason IS NOT NULL')
  assert cur.fetchone()[0]==0,'Historical rows must retain null metadata'
  assert set(after['tables'])-set(before['tables'])==new_tables
  assert set(after['functions'])-set(before['functions'])==new_functions
  for k,v in before['tables'].items():assert after['tables'][k]==v and after['rows'][k]==before['rows'][k],'Existing table changed'
  for k,v in before['functions'].items():
   if k in changed_functions:assert after['functions'][k][1:3]==v[1:3],'Function authorization changed'
   else:assert after['functions'][k]==v,'Unrelated function changed'
  for table in password_tables:
   assert after['tables'][table][:2]==[True,True]
   for role in ('anon','authenticated','service_role'):
    for perm in ('SELECT','INSERT','UPDATE','DELETE'):
     cur.execute('SELECT has_table_privilege(%s,%s,%s)',(role,table,perm));assert cur.fetchone()[0] is False
  for fn in new_functions|changed_functions:
   for role in ('anon','authenticated','service_role'):
    cur.execute("SELECT has_function_privilege(%s,%s,'EXECUTE')",(role,fn))
    allowed=role=='service_role' and fn!='team_password_events_immutable()'
    assert cur.fetchone()[0] is allowed
  report={'mode':mode,'result':'PASS','migrationSha256':hashlib.sha256(source.encode()).hexdigest(),'preservedTables':len(before['tables']),'preservedFunctions':len(before['functions']),'preservedRowsAndPermissions':True,'newTables':sorted(new_tables),'newFunctions':sorted(new_functions),'seedRows':0,'externalProviderCalls':0}
 if mode=='apply':conn.commit()
 else:conn.rollback()
Path('/tmp/team-password-deadline-migration-'+mode+'.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
