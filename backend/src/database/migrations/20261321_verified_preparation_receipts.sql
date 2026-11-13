-- Administrative maintenance only. No application role receives EXECUTE.
-- Historical recovery recognizes acknowledged writes; it never calls a writer.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.calculation_preparation_saved_tail_proof(p_org text,p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' AS $$
DECLARE r public.calculation_preparation_runs;e public.calculation_preparation_run_events;
 newer public.calculation_preparation_runs;ne public.calculation_preparation_run_events;
 lib public.tariff_library_versions;p public.calculation_parameters;item jsonb;receipt jsonb;
 expected text;digest text;ids jsonb:='[]';last_ack jsonb;found_last boolean:=false;
BEGIN
 SELECT * INTO r FROM public.calculation_preparation_runs WHERE id=p_run AND organization_id=p_org;
 IF NOT FOUND OR r.created_at<'2026-11-13 00:00:00+00'::timestamptz OR r.created_at>='2026-11-13 20:00:00+00'::timestamptz
  OR r.created_at>clock_timestamp()-interval '30 minutes' OR coalesce(r.plan->'manualOverrides','{}')<>'{}'::jsonb OR r.plan->'canPublish' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(r.plan->'library') IS DISTINCT FROM 'object' OR coalesce(r.plan#>>'{library,version}','')!~'^[0-9]{1,6}$' THEN RETURN NULL;END IF;
 SELECT * INTO e FROM public.calculation_preparation_run_events WHERE organization_id=p_org AND run_id=r.id ORDER BY sequence DESC LIMIT 1;
 IF NOT FOUND OR e.state IS DISTINCT FROM 'UNKNOWN' OR e.created_at<r.created_at OR jsonb_typeof(e.receipts) IS DISTINCT FROM 'array' OR jsonb_array_length(e.receipts) NOT BETWEEN 2 AND 200 THEN RETURN NULL;END IF;
 IF e.receipts->-1 IS DISTINCT FROM '{"label":"Etapa não confirmada; consultar histórico","state":"VERIFY_REQUIRED"}'::jsonb THEN RETURN NULL;END IF;
 last_ack:=e.receipts->(jsonb_array_length(e.receipts)-2);
 IF coalesce(last_ack->>'label','') NOT LIKE 'ACR · % em rascunho para conferência' THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE))<>1
  OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management AND document_management)
  OR NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.organization_id=u.organization_id AND c.id=u.customer_id JOIN public.organizations o ON o.id=u.organization_id WHERE u.organization_id=p_org AND u.id=r.consumer_unit_id AND u.customer_id=r.customer_id AND u.status='ACTIVE' AND c.status='ACTIVE' AND c.deleted_at IS NULL AND o.deleted_at IS NULL)
  OR (SELECT count(*) FROM public.documents WHERE organization_id=p_org AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id AND document_type='INVOICE_DISTRIBUTOR' AND to_char(reference_month,'YYYY-MM')=r.month)<>1
  OR NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.organization_id=p_org AND d.id=r.document_id AND d.customer_id=r.customer_id AND d.consumer_unit_id=r.consumer_unit_id AND d.document_type='INVOICE_DISTRIBUTOR' AND to_char(d.reference_month,'YYYY-MM')=r.month AND d.file_verified AND d.file_hash=r.source_hash AND EXISTS(SELECT 1 FROM public.document_ocr_jobs j WHERE j.organization_id=p_org AND j.document_id=d.id AND j.file_hash=r.source_hash AND j.state='SUCCEEDED'))
  OR EXISTS(SELECT 1 FROM public.calculation_preparation_runs n WHERE n.organization_id=p_org AND n.consumer_unit_id=r.consumer_unit_id AND n.month=r.month AND n.id<>r.id AND coalesce(public.calculation_preparation_effective_state(p_org,n.id),'RUNNING') IN('RUNNING','UNKNOWN'))
  OR EXISTS(SELECT 1 FROM public.eva_manual_preparations j WHERE j.organization_id=p_org AND j.customer_id=r.customer_id AND j.month=r.month AND j.state='RUNNING' AND j.lease_until>clock_timestamp())
  OR EXISTS(SELECT 1 FROM public.eva_automatic_intakes j WHERE j.organization_id=p_org AND j.customer_id=r.customer_id AND j.month=r.month AND j.state='PREPARING' AND j.lease_until>clock_timestamp())
  OR EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.organization_id=p_org AND v.customer_id=r.customer_id AND v.month=r.month AND public.eva_intake_approval_overlaps(v.report,r.consumer_unit_id) AND(SELECT state FROM public.eva_assisted_closing_events ce WHERE ce.closing_id=v.id ORDER BY sequence DESC LIMIT 1) IN('PREPARING','UNKNOWN','APPROVED')) THEN RETURN NULL;END IF;
 SELECT * INTO lib FROM public.tariff_library_versions WHERE organization_id=p_org AND id::text=r.plan#>>'{library,id}' AND version=(r.plan#>>'{library,version}')::integer;
 IF NOT FOUND OR jsonb_typeof(lib.profile->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(lib.profile->'items') NOT BETWEEN 1 AND 50 THEN RETURN NULL;END IF;
 SELECT n.* INTO newer FROM public.calculation_preparation_runs n JOIN LATERAL(SELECT state FROM public.calculation_preparation_run_events x WHERE x.run_id=n.id AND x.organization_id=p_org ORDER BY sequence DESC LIMIT 1)x ON true
  WHERE n.organization_id=p_org AND n.customer_id=r.customer_id AND n.consumer_unit_id=r.consumer_unit_id AND n.month=r.month AND n.document_id=r.document_id AND n.source_hash=r.source_hash AND n.created_at>e.created_at AND n.plan->'library'=r.plan->'library' AND coalesce(n.plan->'manualOverrides','{}')='{}'::jsonb AND x.state IN('PREPARED','PARTIAL') ORDER BY n.created_at DESC,n.id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO ne FROM public.calculation_preparation_run_events WHERE organization_id=p_org AND run_id=newer.id ORDER BY sequence DESC LIMIT 1;
 IF ne.created_at<newer.created_at THEN RETURN NULL;END IF;
 FOR receipt IN SELECT value FROM jsonb_array_elements(e.receipts) WITH ORDINALITY a(value,ordinal) WHERE ordinal<jsonb_array_length(e.receipts) LOOP
  IF jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR receipt->>'state' IS DISTINCT FROM 'SAVED_DRAFT' OR coalesce(receipt->>'id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   OR NOT(EXISTS(SELECT 1 FROM public.calculation_parameters x WHERE x.id::text=receipt->>'id' AND x.organization_id=p_org AND x.consumer_unit_id=r.consumer_unit_id AND x.created_at<=e.created_at)
    OR EXISTS(SELECT 1 FROM public.calculation_monthly_inputs x WHERE x.id::text=receipt->>'id' AND x.organization_id=p_org AND x.consumer_unit_id=r.consumer_unit_id AND x.month=r.month AND x.created_at<=e.created_at)
    OR EXISTS(SELECT 1 FROM public.calculation_monthly_costs x WHERE x.id::text=receipt->>'id' AND x.organization_id=p_org AND x.consumer_unit_id=r.consumer_unit_id AND x.month=r.month AND x.created_at<=e.created_at)) THEN RETURN NULL;END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(lib.profile->'items') LOOP
  digest:=encode(sha256(convert_to(array_to_json(ARRAY['bot-resolution-1','autofill-acr-v2',p_org,r.document_id,r.source_hash,lib.id::text,item->>'component',item->>'band'])::text,'UTF8')),'hex');
  expected:=substr(digest,1,8)||'-'||substr(digest,9,4)||'-5'||substr(digest,14,3)||'-8'||substr(digest,18,3)||'-'||substr(digest,21,12);
  SELECT * INTO p FROM public.calculation_parameters WHERE id::text=expected AND organization_id=p_org AND consumer_unit_id=r.consumer_unit_id;
  IF NOT FOUND OR p.created_at>ne.created_at OR p.status IS DISTINCT FROM 'DRAFT' OR p.revision IS DISTINCT FROM 1 OR p.kind IS DISTINCT FROM 'TARIFF' OR p.scenario IS DISTINCT FROM 'ACR' OR p.component_code IS DISTINCT FROM item->>'component' OR p.time_band IS DISTINCT FROM item->>'band' OR p.measure::text IS DISTINCT FROM item->>'measure'
   OR coalesce(item->>'value','')!~'^-?[0-9]+([.][0-9]+)?$' OR coalesce(p.amount_text,'')!~'^-?[0-9]+([.][0-9]+)?$'
   OR p.start_date::date IS DISTINCT FROM (r.month||'-01')::date OR p.end_date::date IS DISTINCT FROM ((r.month||'-01')::date+interval '1 month'-interval '1 day')::date THEN RETURN NULL;END IF;
  IF p.amount_text::numeric IS DISTINCT FROM (item->>'value')::numeric THEN RETURN NULL;END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.receipts||ne.receipts)x WHERE x->>'state'='SAVED_DRAFT' AND x->>'id'=expected AND x->>'label'='ACR · '||(item->>'label')||' em rascunho para conferência') THEN RETURN NULL;END IF;
  IF last_ack->>'id'=expected AND last_ack->>'label'='ACR · '||(item->>'label')||' em rascunho para conferência' THEN found_last:=true;END IF;
  ids:=ids||jsonb_build_array(expected);
 END LOOP;
 IF NOT found_last OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.receipts)x WHERE x->>'label' LIKE 'ACR · % em rascunho para conferência' AND NOT(ids? (x->>'id'))) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('method','ACKNOWLEDGED_PREFIX_AND_CONFIRMED_ACR_TAIL_V1','sourceHash',r.source_hash,'originalActor',r.actor_id,'originalSequence',e.sequence,'originalReceipts',e.receipts,'confirmedByRunId',newer.id,'confirmedBasis',newer.source_basis,'libraryId',lib.id,'libraryVersion',lib.version,'verifiedParameterIds',ids,'checkedAt',clock_timestamp(),'financialApproval',false,'financialWrites',false,'repeatOcr',false,'requiresNewPreparation',true);
END$$;
REVOKE ALL ON FUNCTION public.calculation_preparation_saved_tail_proof(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.calculation_preparation_reconcile_saved_tail(p_org text,p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' SET lock_timeout='2s' AS $$
DECLARE r public.calculation_preparation_runs;a public.calculation_preparation_reconciliations;proof jsonb;
BEGIN
 SELECT * INTO r FROM public.calculation_preparation_runs WHERE organization_id=p_org AND id=p_run FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='PT409';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('calculation-autofill:'||p_org||':'||r.consumer_unit_id||':'||r.month,0));
 SELECT * INTO a FROM public.calculation_preparation_reconciliations WHERE organization_id=p_org AND run_id=p_run;
 IF FOUND THEN
  IF a.proof->>'method' IS DISTINCT FROM 'ACKNOWLEDGED_PREFIX_AND_CONFIRMED_ACR_TAIL_V1' OR a.source_hash<>r.source_hash OR a.original_basis<>r.source_basis THEN RAISE EXCEPTION 'Different reconciliation already recorded' USING ERRCODE='PT409';END IF;
  RETURN jsonb_build_object('runId',r.id,'effectiveState','PARTIAL','replayed',true,'financialWrites',false);
 END IF;
 proof:=public.calculation_preparation_saved_tail_proof(p_org,p_run);
 IF proof IS NULL THEN RAISE EXCEPTION 'Existing effects are not fully proven' USING ERRCODE='PT409';END IF;
 INSERT INTO public.calculation_preparation_reconciliations(run_id,organization_id,customer_id,consumer_unit_id,month,source_hash,original_basis,current_basis,original_state,effective_state,manual_snapshot,actor_id,note,proof)
 VALUES(r.id,p_org,r.customer_id,r.consumer_unit_id,r.month,r.source_hash,r.source_basis,proof->>'confirmedBasis','UNKNOWN','PARTIAL',coalesce(r.plan->'manualOverrides','{}'),'system:verified-preparation-receipts','Reconciliação técnica: recibos anteriores reconhecidos e tarifas restantes comprovadas por identificadores idempotentes e execução posterior. Nenhum valor financeiro foi alterado ou aprovado.',proof);
 RETURN jsonb_build_object('runId',r.id,'effectiveState','PARTIAL','replayed',false,'financialWrites',false,'financialApproval',false);
END$$;
REVOKE ALL ON FUNCTION public.calculation_preparation_reconcile_saved_tail(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
