"""Audit additive migration using the established private DB connection helper.
Never prints credentials, rows, text, connection strings or raw provider responses.
"""
import sys,json,hashlib
from pathlib import Path
from rag_db_connection import connection
mode=sys.argv[1]
assert mode in ('dry-run','apply')
path=Path(__file__).resolve().parents[2]/'backend/src/database/migrations/20261101_platform_team_webhook_isolation.sql'
source=path.read_text()
assert source.strip().startswith('BEGIN;') and source.strip().endswith('COMMIT;')
body=source.strip()[len('BEGIN;'):-len('COMMIT;')]
new_tables=set()
new_functions=set()
changed='record_platform_team_notification_delivery(text,text,text,timestamp with time zone,uuid,text,text,text)'

def snapshot(cur):
 cur.execute("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname")
 tables={r[0]:list(r[1:]) for r in cur.fetchall()}
 rows={}
 for name in tables:
  assert name.replace('_','').isalnum()
  cur.execute('SELECT count(*),md5(coalesce(string_agg(row_hash,\'\' ORDER BY row_hash),\'\')) FROM (SELECT md5(to_jsonb(x)::text) row_hash FROM public."'+name+'" x) h')
  rows[name]=list(cur.fetchone())
 cur.execute("SELECT p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),p.proacl::text,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY 1")
 return {'tables':tables,'rows':rows,'functions':{r[0]:list(r[1:]) for r in cur.fetchall()}}
with connection() as conn:
 with conn.cursor() as cur:
  cur.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
  cur.execute("SET LOCAL statement_timeout='60s'")
  before=snapshot(cur)
  assert not new_tables.intersection(before['tables']),'Already present; do not reapply migration'
  assert not new_functions.intersection(before['functions']),'Already present; inspect first'
  cur.execute(body)
  after=snapshot(cur)
  assert set(after['tables'])-set(before['tables'])==new_tables
  assert set(after['functions'])-set(before['functions'])==new_functions
  for k,v in before['tables'].items():assert after['tables'][k]==v and after['rows'][k]==before['rows'][k],'Existing table changed'
  for k,v in before['functions'].items():
   if k==changed:assert after['functions'][k][1:]==v[1:] and after['functions'][k][0]!=v[0],'Function ACL or safety attributes changed'
   else:assert after['functions'][k]==v,'Other existing function changed'
  assert changed in before['functions'],'Expected private function missing'
  for table in new_tables:
   assert after['tables'][table][:2]==[True,True] and after['rows'][table][0]==0
   for role in ('anon','authenticated','service_role'):
    for perm in ('SELECT','INSERT','UPDATE','DELETE'):
     cur.execute('SELECT has_table_privilege(%s,%s,%s)',(role,table,perm));assert cur.fetchone()[0] is False
  for fn in new_functions:
   for role in ('anon','authenticated','service_role'):
    cur.execute("SELECT has_function_privilege(%s,%s,'EXECUTE')",(role,fn))
    allowed=role=='service_role' and fn not in ('platform_team_notification_immutable()','platform_team_notification_enqueue()')
    assert cur.fetchone()[0] is allowed
  report={'mode':mode,'result':'PASS','migrationSha256':hashlib.sha256(source.encode()).hexdigest(),'preservedTables':len(before['tables']),'preservedFunctions':len(before['functions']),'preservedRowsAndPermissions':True,'newTables':sorted(new_tables),'newFunctions':sorted(new_functions),'seedRows':0,'externalProviderCalls':0}
 if mode=='apply':conn.commit()
 else:conn.rollback()
Path('/tmp/team-notifications-isolation-migration-'+mode+'.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
