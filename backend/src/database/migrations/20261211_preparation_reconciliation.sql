BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Append an interrupted result; never rewrite the run, its original actor or saved drafts.
CREATE FUNCTION public.calculation_autofill_reconcile(p_org text,p_actor text,p_role text,p_platform boolean,p_unit text,p_month text,p_run uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.calculation_preparation_runs;e public.calculation_preparation_run_events;receipt jsonb;
BEGIN
 PERFORM public.calculation_autofill_action(p_org,p_actor,p_role,p_platform,'access',p_unit,p_month,null,'{}');
 IF NOT p_platform AND NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles rr ON rr.id=m.role_id AND rr.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND rr.scope='organization' AND rr.name='admin_org' AND rr.permissions ? '92e1b670-ab10-483a-b825-c6e16799496d' AND rr.permissions ? 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 IF p_run IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['basis','currentBasis','note','sourceHash'] OR EXISTS(SELECT 1 FROM unnest(ARRAY['basis','currentBasis','sourceHash'])k WHERE jsonb_typeof(p_body->k) IS DISTINCT FROM 'string' OR p_body->>k !~ '^[a-f0-9]{64}$') OR jsonb_typeof(p_body->'note') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'note')) NOT BETWEEN 30 AND 1000 THEN RAISE EXCEPTION 'Invalid reconciliation proof' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('calculation-autofill:'||p_org||':'||p_unit||':'||p_month,0));
 SELECT * INTO r FROM public.calculation_preparation_runs WHERE id=p_run AND organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='42501';END IF;
 IF r.source_basis<>p_body->>'basis' OR r.source_hash<>p_body->>'sourceHash' OR r.created_at>clock_timestamp()-interval '30 minutes' OR coalesce(r.plan->'manualOverrides','{}')<>'{}'::jsonb THEN RAISE EXCEPTION 'Reconciliation requires source review' USING ERRCODE='40001';END IF;
 IF (SELECT count(*) FROM public.documents WHERE organization_id=p_org AND customer_id=r.customer_id AND consumer_unit_id=p_unit AND document_type='INVOICE_DISTRIBUTOR' AND to_char(reference_month,'YYYY-MM')=p_month)<>1 OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=r.document_id AND organization_id=p_org AND customer_id=r.customer_id AND consumer_unit_id=p_unit AND document_type='INVOICE_DISTRIBUTOR' AND to_char(reference_month,'YYYY-MM')=p_month AND file_verified AND file_hash=r.source_hash) THEN RAISE EXCEPTION 'Invoice changed' USING ERRCODE='40001';END IF;
 receipt:=jsonb_build_array(jsonb_build_object('label','Administrative reconciliation: interrupted preparation; fresh preparation required','state','VERIFY_REQUIRED','kind','ADMIN_INTERRUPTED','originalActor',r.actor_id,'originalBasis',r.source_basis,'currentBasis',p_body->>'currentBasis','sourceHash',r.source_hash,'note',btrim(p_body->>'note')));
 SELECT * INTO e FROM public.calculation_preparation_run_events WHERE run_id=r.id AND sequence=2;
 IF FOUND THEN
  IF e.state<>'PARTIAL' OR e.actor_id<>p_actor OR e.receipts<>receipt THEN RAISE EXCEPTION 'Immutable result' USING ERRCODE='23505';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.calculation_preparation_run_events WHERE run_id=r.id AND sequence=1 AND state='RUNNING') THEN RAISE EXCEPTION 'Running evidence unavailable' USING ERRCODE='40001';END IF;
  INSERT INTO public.calculation_preparation_run_events(run_id,organization_id,sequence,state,actor_id,receipts) VALUES(r.id,p_org,2,'PARTIAL',p_actor,receipt);
 END IF;
 RETURN jsonb_build_object('id',r.id,'state','PARTIAL','canPublish',false);
END$$;
REVOKE ALL ON FUNCTION public.calculation_autofill_reconcile(text,text,text,boolean,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.calculation_autofill_reconcile(text,text,text,boolean,text,text,uuid,jsonb) TO service_role;
COMMIT;
