"""Audit additive migration using the established private DB connection helper.
Never prints credentials, rows, text, connection strings or raw provider responses.
"""
import sys,json,hashlib
from pathlib import Path
from rag_db_connection import connection
mode=sys.argv[1]
assert mode in ('dry-run','apply')
path=Path(__file__).resolve().parents[2]/'backend/src/database/migrations/20261105_eva_corpus_publication.sql'
source=path.read_text()
assert source.strip().startswith('BEGIN;') and source.strip().endswith('COMMIT;')
body=source.strip()[len('BEGIN;'):-len('COMMIT;')]
new_tables={'eva_corpus_publications','eva_corpus_events'}
new_functions={'eva_corpus_source(uuid,boolean)','eva_corpus_action(uuid,text,uuid,jsonb)','eva_corpus_rag(uuid,text,text,boolean,text,jsonb)'}
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
  for k,v in before['functions'].items():assert after['functions'][k]==v,'Existing function changed'
  for table in new_tables:
   assert after['tables'][table][:2]==[True,True] and after['rows'][table][0]==0
   for role in ('anon','authenticated','service_role'):
    for perm in ('SELECT','INSERT','UPDATE','DELETE'):
     cur.execute('SELECT has_table_privilege(%s,%s,%s)',(role,table,perm));assert cur.fetchone()[0] is False
  for role in ('anon','authenticated','service_role'):
   cur.execute("SELECT has_function_privilege(%s,'eva_corpus_source(uuid,boolean)','EXECUTE')",(role,));assert cur.fetchone()[0] is False
  for function in ('eva_corpus_action(uuid,text,uuid,jsonb)','eva_corpus_rag(uuid,text,text,boolean,text,jsonb)'):
   for role in ('anon','authenticated'):
    cur.execute('SELECT has_function_privilege(%s,%s,\'EXECUTE\')',(role,function));assert cur.fetchone()[0] is False
   cur.execute('SELECT has_function_privilege(\'service_role\',%s,\'EXECUTE\')',(function,));assert cur.fetchone()[0] is True
  # Execute private read paths against the real schema, without writing events.
  cur.execute("SELECT user_id FROM public.platform_team_members WHERE profile='OWNER' AND active ORDER BY user_id LIMIT 1")
  owner=cur.fetchone()[0]
  cur.execute("SELECT eva_corpus_action(%s,'list',null,'{\"page\":0,\"state\":\"\",\"search\":\"\"}'::jsonb)",(owner,));assert cur.fetchone()[0]['total']==0
  cur.execute("SELECT eva_corpus_action(%s,'metrics',null,jsonb_build_object('month',to_char(now(),'YYYY-MM')))",(owner,));assert cur.fetchone()[0]['completed']==0
  report={'mode':mode,'result':'PASS','migrationSha256':hashlib.sha256(source.encode()).hexdigest(),'preservedTables':len(before['tables']),'preservedFunctions':len(before['functions']),'preservedRowsAndPermissions':True,'newTables':sorted(new_tables),'newFunctions':sorted(new_functions),'seedRows':0,'externalProviderCalls':0}
 if mode=='apply':conn.commit()
 else:conn.rollback()
Path('/tmp/eva-corpus-migration-'+mode+'.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
