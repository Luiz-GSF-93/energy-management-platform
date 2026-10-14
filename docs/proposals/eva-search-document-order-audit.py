import sys,json,hashlib
from pathlib import Path
from rag_db_connection import connection
mode=sys.argv[1];assert mode in ('dry-run','apply')
path=Path('/workspaces/eva-search-2c1/backend/src/database/migrations/20261029_eva_search_document_order.sql')
source=path.read_text();assert source.strip().startswith('BEGIN;') and source.strip().endswith('COMMIT;')
body=source.strip()[len('BEGIN;'):-len('COMMIT;')]
def snapshot(cur):
 cur.execute("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname")
 info={r[0]:list(r[1:]) for r in cur.fetchall()}
 rows={}
 for name in info:
  assert name.replace('_','').isalnum()
  cur.execute('SELECT count(*),md5(coalesce(string_agg(row_hash,\'\' ORDER BY row_hash),\'\')) FROM (SELECT md5(to_jsonb(x)::text) AS row_hash FROM public."'+name+'" x) h')
  rows[name]=list(cur.fetchone())
 cur.execute("SELECT p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),p.proacl::text,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY 1")
 functions={r[0]:list(r[1:]) for r in cur.fetchall()}
 return {'tables':info,'rows':rows,'functions':functions}

with connection() as conn:
 with conn.cursor() as cur:
  cur.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
  cur.execute("SET LOCAL statement_timeout='60s'")
  before=snapshot(cur)
  cur.execute("SELECT pg_get_functiondef('public.eva_search_action(uuid,text,uuid,jsonb)'::regprocedure)");old=cur.fetchone()[0]
  assert 'ORDER BY page,section_id,ordinal' in old,'Inspect before repeating the migration'
  cur.execute(body)
  after=snapshot(cur)
  assert before['tables']==after['tables'] and before['rows']==after['rows'],'Rows or table permissions changed'
  changes=[k for k,v in before['functions'].items() if after['functions'].get(k)!=v]
  assert changes==['eva_search_action(uuid,text,uuid,jsonb)'],changes
  assert before['functions'][changes[0]][1:]==after['functions'][changes[0]][1:],'Function ACL/security changed'
  assert set(before['functions'])==set(after['functions'])
  report={'mode':mode,'result':'PASS','migrationSha256':hashlib.sha256(source.encode()).hexdigest(),'preservedTables':len(before['tables']),'preservedRowsAndPermissions':True,'changedFunctions':changes,'preservedFunctionACL':True,'releaseRows':after['rows']['eva_search_releases'][0],'chunkRows':after['rows']['eva_search_chunks'][0],'eventRows':after['rows']['eva_search_events'][0],'externalProviderCalls':0,'newTables':0}
 if mode=='apply':conn.commit()
 else:conn.rollback()
Path('/tmp/eva-search-order-migration-'+mode+'.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
