"""One approved incident only. No Auth/SMTP call and no generic unlock capability."""
import sys,json,hashlib
from pathlib import Path
from rag_db_connection import connection
mode=sys.argv[1]
assert mode in ('dry-run','apply')
actor='8039dae4-1c8e-4032-8a9a-d647b1644f16'
user='8b2eaf32-7589-4146-8575-0c51b3a0beda'
rid='ed213d50-25e7-451a-88f0-f106964daf7b'
reason='Resolução excepcional aprovada pelo Owner em 14/10/2026: reserva às 17:57:23 posterior à resposta HTTP encerrada às 17:55:33, antes de qualquer chamada Auth; registros Resend reconferidos sem recuperação correspondente. Histórico preservado; sem reenvio automático.'
with connection() as c:
 with c.cursor() as q:
  q.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
  q.execute("SET LOCAL lock_timeout='3s'")
  q.execute("SET LOCAL statement_timeout='15s'")
  q.execute("SELECT pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0))")
  q.execute('SELECT public.platform_team_owner(%s)',(actor,))
  q.execute("SELECT count(*) FROM pg_stat_activity WHERE usename='authenticator' AND state='active' AND query ILIKE '%reserve_platform_team_password%'")
  assert q.fetchone()[0]==0,'Reserve process still active; stop'
  q.execute('SELECT actor_id,user_id,purpose,state,created_at,finished_at,provider_started_at,reservation_deadline,recipient,reason FROM public.platform_team_password_requests WHERE id=%s FOR UPDATE',(rid,))
  r=q.fetchone();assert r,'Missing incident'
  assert str(r[0])==actor and str(r[1])==user and r[2]=='RECOVERY' and r[3]=='RESERVED'
  assert r[4].isoformat()=='2026-10-14T20:57:23.767841+00:00' and r[5] is None and r[6] is None and r[7] is None
  assert r[8]=='bruno.santos@expertenergy.com.br' and r[9]=='não recebeu a senha primeira'
  q.execute('SELECT id,actor_id,state,created_at FROM public.platform_team_password_events WHERE request_id=%s ORDER BY created_at,id',(rid,))
  events=q.fetchall();assert len(events)==1 and events[0][2]=='RESERVED'
  q.execute('SELECT count(*) FROM public.platform_team_password_requests WHERE user_id=%s',(user,));before=q.fetchone()[0]
  q.execute("UPDATE public.platform_team_password_requests SET state='NOT_SENT',finished_at=clock_timestamp(),resolution_reason=%s WHERE id=%s AND state='RESERVED'",(reason,rid));assert q.rowcount==1
  q.execute("INSERT INTO public.platform_team_password_events(request_id,actor_id,state) VALUES(%s,%s,'NOT_SENT')",(rid,actor))
  q.execute('SELECT id,actor_id,state,created_at FROM public.platform_team_password_events WHERE request_id=%s ORDER BY created_at,id',(rid,))
  after=q.fetchall();assert after[:-1]==events and len(after)==2 and after[-1][2]=='NOT_SENT'
  q.execute('SELECT count(*) FROM public.platform_team_password_requests WHERE user_id=%s',(user,));assert q.fetchone()[0]==before
  report={'mode':mode,'result':'PASS','requestId':rid,'state':'NOT_SENT','previousEventsPreserved':True,'appendedEvents':1,'emailCalls':0,'roleChanges':0}
 if mode=='apply':c.commit()
 else:c.rollback()
Path('/tmp/team-password-late-resolution-'+mode+'.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
