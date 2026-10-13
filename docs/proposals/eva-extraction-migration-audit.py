"""Explicit dry-run/apply for the reviewed additive migration; never prints connection data."""
import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,'/workspaces')
from rag_db_connection import connection
mode=sys.argv[1]
assert mode in ('dry-run','apply')
root=Path('/workspaces/energyos-clicksign-sandbox')
path=root/'backend/src/database/migrations/20261027_eva_official_extraction_curation.sql'
source=path.read_text()
assert source.strip().startswith('BEGIN;') and source.strip().endswith('COMMIT;')
body=source.strip()[len('BEGIN;'):-len('COMMIT;')]
tables=['eva_official_extraction_jobs','eva_official_extraction_job_events','eva_official_extraction_versions','eva_official_extraction_sections','eva_official_curation_events']
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
  assert not set(tables)&set(before['tables']),'New tables already present; inspect before retrying'
  cur.execute(body)
  after=snapshot(cur)
  assert all(after['tables'].get(k)==v for k,v in before['tables'].items()),'Existing ACL or RLS changed'
  assert all(after['rows'].get(k)==v for k,v in before['rows'].items()),'Existing rows changed'
  assert all(after['functions'].get(k)==v for k,v in before['functions'].items()),'Existing functions changed'
  assert set(after['tables'])-set(before['tables'])==set(tables)
  assert len(after['functions'])-len(before['functions'])==4
  for table in tables:
   assert after['rows'][table][0]==0 and after['tables'][table][:2]==[True,True]
   for role in ['anon','authenticated','service_role']:
    for privilege in ['SELECT','INSERT','UPDATE','DELETE']:
     cur.execute('SELECT has_table_privilege(%s,%s,%s)',(role,table,privilege));assert cur.fetchone()[0] is False
  report={'mode':mode,'result':'PASS','migrationSha256':hashlib.sha256(source.encode()).hexdigest(),'preservedTables':len(before['tables']),'preservedFunctions':len(before['functions']),'newTables':5,'newFunctions':4,'seedRows':0,'externalProviderCalls':0,'flags':'delivery disabled','beforeDigest':hashlib.sha256(json.dumps(before,sort_keys=True,default=str).encode()).hexdigest(),'newTableRows':{t:after['rows'][t][0] for t in tables}}
 if mode=='apply':conn.commit()
 else:conn.rollback()
Path('/tmp/eva-2b2-migration-'+mode+'.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
