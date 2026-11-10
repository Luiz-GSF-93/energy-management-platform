-- Additive reconciliation versions; financial records and published reports are untouched.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.ccee_reconciliation_action(p_org text,p_actor text,p_action text,p_id uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_integration_jobs;b jsonb;d public.documents;o public.document_ocr_results;f text;r public.ccee_invoice_reconciliations;v integer;pg integer;req uuid;payload jsonb;rows jsonb;jobs jsonb;period_start timestamptz;period_end timestamptz;period_month date;
BEGIN
 IF p_action NOT IN('candidates','source','save','list') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>210000 THEN RAISE EXCEPTION 'Invalid reconciliation action' USING ERRCODE='22023';END IF;
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,CASE WHEN p_action='save' THEN 'manage' ELSE 'view' END);
 IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles rr ON rr.id=m.role_id AND rr.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND rr.permissions?'8f105b02-4443-49de-b188-847e0284e7ed') THEN RAISE EXCEPTION 'Document read permission required' USING ERRCODE='42501';END IF;
 IF p_action='list' THEN
  IF p_body-ARRAY['unitId','month','page']<>'{}'::jsonb OR COALESCE(p_body->>'month','')!~'^20\d{2}-(0[1-9]|1[0-2])$' OR NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.organization_id=p_org AND u.id=p_body->>'unitId' AND u.status='ACTIVE' AND c.status='ACTIVE' AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'Reconciliation scope unavailable' USING ERRCODE='42501';END IF;
  pg:=COALESCE((p_body->>'page')::integer,0);IF pg NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  rows:='[]';
  FOR r IN SELECT * FROM public.ccee_invoice_reconciliations WHERE organization_id=p_org AND consumer_unit_id=p_body->>'unitId' AND month=((p_body->>'month')||'-01')::date ORDER BY version DESC LIMIT 25 OFFSET pg*25 LOOP
   SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=r.job_id AND organization_id=p_org;
   PERFORM public.assert_ccee_data_binding(p_org,j.authorization_id,j.month,'MEASUREMENTS');
   rows:=rows||jsonb_build_array(to_jsonb(r));
  END LOOP;
  RETURN jsonb_build_object('organizationId',p_org,'rows',rows,'page',pg);
 END IF;
 SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=p_id AND organization_id=p_org FOR SHARE;
 IF j.id IS NULL OR j.kind<>'MEASUREMENTS' OR j.state NOT IN('SUCCEEDED','PARTIAL') THEN RAISE EXCEPTION 'Measurement source unavailable' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||(SELECT consumer_unit_id FROM public.ccee_unit_authorizations WHERE id=j.authorization_id),192));
 b:=public.assert_ccee_data_binding(p_org,j.authorization_id,j.month,'MEASUREMENTS');
 IF p_action='candidates' THEN
  IF p_body<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid candidates filter' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('organizationId',p_org,'documents',(SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]')FROM(SELECT id,original_filename,reference_month FROM public.documents WHERE organization_id=p_org AND customer_id=b->>'customer_id' AND consumer_unit_id=b->>'consumer_unit_id' AND document_type='INVOICE_DISTRIBUTOR' AND file_verified AND reference_month>=j.month AND reference_month<j.month+interval '1 month' ORDER BY id LIMIT 100)x));
 END IF;
 IF p_body-ARRAY['documentId','sourceFingerprint','payload','reason','requestId','periodStart','periodEnd']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid source request' USING ERRCODE='22023';END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_body->>'documentId' AND organization_id=p_org AND customer_id=b->>'customer_id' AND consumer_unit_id=b->>'consumer_unit_id' AND document_type='INVOICE_DISTRIBUTOR' AND file_verified AND reference_month>=j.month AND reference_month<j.month+interval '1 month' FOR SHARE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Invoice source unavailable' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM public.document_ocr_results WHERE document_id=d.id AND organization_id=p_org AND file_hash=d.file_hash)<>1 THEN RAISE EXCEPTION 'OCR evidence unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO o FROM public.document_ocr_results WHERE document_id=d.id AND organization_id=p_org AND file_hash=d.file_hash FOR SHARE;
 jobs:='[]';
 IF p_body ? 'periodStart' OR p_body ? 'periodEnd' THEN
  IF coalesce(p_body->>'periodStart','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:00:00-03:00$' OR coalesce(p_body->>'periodEnd','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:00:00-03:00$' THEN RAISE EXCEPTION 'Invalid invoice period' USING ERRCODE='22023';END IF;
  period_start:=(p_body->>'periodStart')::timestamptz;period_end:=(p_body->>'periodEnd')::timestamptz;
  IF period_end<=period_start OR period_end-period_start>interval '90 days' OR period_start<(j.month-interval '2 months')::timestamp AT TIME ZONE 'America/Sao_Paulo' OR period_end>(j.month+interval '3 months')::timestamp AT TIME ZONE 'America/Sao_Paulo' THEN RAISE EXCEPTION 'Invoice period outside supported coverage' USING ERRCODE='22023';END IF;
  FOR period_month IN SELECT generate_series(date_trunc('month',period_start AT TIME ZONE 'America/Sao_Paulo'),date_trunc('month',(period_end-interval '1 second') AT TIME ZONE 'America/Sao_Paulo'),interval '1 month')::date LOOP
   PERFORM public.assert_ccee_data_binding(p_org,j.authorization_id,period_month,'MEASUREMENTS');
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.month),'[]') INTO jobs FROM (
   SELECT DISTINCT ON(month) * FROM public.ccee_integration_jobs
   WHERE organization_id=p_org AND authorization_id=j.authorization_id AND kind='MEASUREMENTS' AND measurement_kind='FINAL' AND state='SUCCEEDED'
   AND month>=date_trunc('month',period_start AT TIME ZONE 'America/Sao_Paulo')::date AND month<=date_trunc('month',(period_end-interval '1 second') AT TIME ZONE 'America/Sao_Paulo')::date
   ORDER BY month,finished_at DESC NULLS LAST,created_at DESC,id DESC
  ) x;
 END IF;
 f:=md5(to_jsonb(d)::text||to_jsonb(o)::text||CASE WHEN period_start IS NULL THEN '' ELSE jsonb_build_array(p_body->>'periodStart',p_body->>'periodEnd',jobs)::text END);
 IF p_action='source' THEN RETURN jsonb_build_object('organizationId',p_org,'job',to_jsonb(j),'periodJobs',jobs,'binding',b,'document',to_jsonb(d),'ocr',to_jsonb(o),'sourceFingerprint',f,'baseSourceFingerprint',md5(to_jsonb(d)::text||to_jsonb(o)::text));END IF;
 IF p_body->>'sourceFingerprint' IS DISTINCT FROM f THEN RAISE EXCEPTION 'Source changed during reconciliation' USING ERRCODE='40001';END IF;
 req:=(p_body->>'requestId')::uuid;payload:=p_body->'payload';
 IF req IS NULL OR COALESCE(length(p_body->>'reason'),0) NOT BETWEEN 3 AND 500 OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>200000 OR coalesce(payload->>'formulaVersion','') NOT IN('ccee-invoice-v1','ccee-invoice-v2-hour-label','ccee-invoice-v3-reading-period') OR payload->>'organizationId' IS DISTINCT FROM p_org OR payload->>'unitId' IS DISTINCT FROM b->>'consumer_unit_id' OR payload->>'customerId' IS DISTINCT FROM b->>'customer_id' OR payload->>'month' IS DISTINCT FROM to_char(j.month,'YYYY-MM') OR payload->>'jobId' IS DISTINCT FROM j.id::text OR payload->>'documentId' IS DISTINCT FROM d.id OR COALESCE(payload->>'payloadHash','')!~'^[a-f0-9]{64}$' OR COALESCE(payload->>'state','') NOT IN('COMPARABLE','REVIEW_REQUIRED') THEN RAISE EXCEPTION 'Invalid reconciliation snapshot' USING ERRCODE='22023';END IF;
 IF payload->>'formulaVersion'='ccee-invoice-v3-reading-period' AND (period_start IS NULL OR payload#>>'{source,intervalStart}' IS DISTINCT FROM p_body->>'periodStart' OR payload#>>'{source,intervalEnd}' IS DISTINCT FROM p_body->>'periodEnd') THEN RAISE EXCEPTION 'Period snapshot mismatch' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||(b->>'consumer_unit_id')||j.month::text,195));
 SELECT * INTO r FROM public.ccee_invoice_reconciliations WHERE organization_id=p_org AND request_id=req;
 IF FOUND THEN IF r.job_id<>j.id OR r.document_id<>d.id OR r.actor_id<>p_actor OR r.payload<>payload OR r.reason<>p_body->>'reason' OR r.source_fingerprint<>f THEN RAISE EXCEPTION 'Reconciliation request changed' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('organizationId',p_org,'row',to_jsonb(r));END IF;
 SELECT COALESCE(max(version),0)+1 INTO v FROM public.ccee_invoice_reconciliations WHERE organization_id=p_org AND consumer_unit_id=b->>'consumer_unit_id' AND month=j.month;
 INSERT INTO public.ccee_invoice_reconciliations(organization_id,customer_id,consumer_unit_id,job_id,document_id,month,version,source_fingerprint,payload_hash,payload,actor_id,reason,request_id)
 VALUES(p_org,b->>'customer_id',b->>'consumer_unit_id',j.id,d.id,j.month,v,f,payload->>'payloadHash',payload,p_actor,p_body->>'reason',req) RETURNING * INTO r;
 INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,details)VALUES(p_org,j.id,p_actor,'INVOICE_RECONCILED',jsonb_build_object('id',r.id,'version',v,'payloadHash',r.payload_hash,'state',payload->>'state','documentId',d.id,'requestId',req));
 RETURN jsonb_build_object('organizationId',p_org,'row',to_jsonb(r));
END$$;
REVOKE ALL ON FUNCTION public.ccee_reconciliation_action(text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ccee_reconciliation_action(text,text,text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
