BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
ALTER TABLE public.eva_automatic_intakes DROP CONSTRAINT eva_automatic_intakes_state_check;
ALTER TABLE public.eva_automatic_intakes ADD CONSTRAINT eva_automatic_intakes_state_check CHECK(state IN('RECEIVING','RECOGNIZING','OCR_QUEUED','OCR_SUBMITTING','OCR_POLLING','LINKING','WAITING_OCR','PREPARING','AWAITING_SOURCES','PROPOSAL_READY','REVIEW_REQUIRED','UNKNOWN','PUBLISHED','SOURCE_READY','DISMISSED'));

-- Remove terminal receipts before LIMIT, in both reviewed tenant runtimes.
-- No permission or scope branch is changed. Refresh only the exact public
-- signature whose scoped copy receives the same reviewed predicate.
DO $$DECLARE schema_name text;definition text;needle text:='WHERE organization_id=p_org AND (a->>''external''';replacement text:='WHERE state<>''DISMISSED'' AND organization_id=p_org AND (a->>''external''';BEGIN
 FOREACH schema_name IN ARRAY ARRAY['public','portal_scope'] LOOP
  IF to_regprocedure(schema_name||'.eva_intake_action(text,text,text,boolean,text,uuid,jsonb)') IS NULL THEN CONTINUE;END IF;
  definition:=pg_get_functiondef(to_regprocedure(schema_name||'.eva_intake_action(text,text,text,boolean,text,uuid,jsonb)'));
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Review intake list baseline for %',schema_name;END IF;
  EXECUTE replace(definition,needle,replacement);
 END LOOP;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN
  UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid)
  WHERE original_oid='public.eva_intake_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure;
 END IF;
END$$;

CREATE FUNCTION public.eva_intake_administration(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;i public.eva_automatic_intakes;allowed boolean;proof jsonb;
BEGIN
 a:=public.eva_intake_actor(p_org,p_actor,p_role,p_platform,NULL);
 IF a->>'external' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Backoffice only' USING ERRCODE='42501';END IF;
 allowed:=p_platform OR EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id::text=m.role_id::text AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND r.name IN('admin_org','gestor'));
 IF p_action='list' THEN
  IF p_id IS NOT NULL OR p_body<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid administration query' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('dismissible',CASE WHEN allowed THEN (SELECT coalesce(jsonb_agg(id),'[]') FROM public.eva_automatic_intakes WHERE organization_id=p_org AND stored AND state='REVIEW_REQUIRED' AND document_id IS NULL AND closing_id IS NULL AND lease_token IS NULL AND operation_url IS NULL) ELSE '[]'::jsonb END,
   'dismissed',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT jsonb_build_object('id',closed.id,'filename',closed.filename,'state',closed.state,'note',closed.note,'updatedAt',closed.updated_at,'reason',e.body->>'reason') x FROM public.eva_automatic_intakes closed JOIN LATERAL(SELECT body FROM public.eva_automatic_intake_events WHERE intake_id=closed.id AND event='DISMISSED' ORDER BY sequence DESC LIMIT 1)e ON true WHERE closed.organization_id=p_org AND closed.state='DISMISSED' ORDER BY closed.updated_at DESC LIMIT 10)s));
 END IF;
 IF NOT allowed THEN RAISE EXCEPTION 'Administrator or manager required' USING ERRCODE='42501';END IF;
 IF p_id IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR p_body-ARRAY['reason']<>'{}' OR jsonb_typeof(p_body->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'reason')) NOT BETWEEN 15 AND 1000 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023';END IF;
 SELECT * INTO i FROM public.eva_automatic_intakes WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Receipt unavailable' USING ERRCODE='42501';END IF;
 IF p_action='dismiss' THEN
  IF i.state='DISMISSED' AND EXISTS(SELECT 1 FROM public.eva_automatic_intake_events WHERE intake_id=i.id AND event='DISMISSED' AND actor_id=p_actor AND body->>'reason'=btrim(p_body->>'reason')) THEN RETURN jsonb_build_object('id',i.id,'state','DISMISSED','replayed',true);END IF;
  IF NOT i.stored OR i.state<>'REVIEW_REQUIRED' OR i.document_id IS NOT NULL OR i.closing_id IS NOT NULL OR i.lease_token IS NOT NULL OR i.operation_url IS NOT NULL THEN RAISE EXCEPTION 'Only paused unlinked originals can be dismissed' USING ERRCODE='40001';END IF;
  UPDATE public.eva_automatic_intakes SET state='DISMISSED',next_attempt_at='infinity',updated_at=clock_timestamp(),note='Envio incorreto encerrado. Original e histórico preservados; não utilizado na apuração.' WHERE id=i.id;
  PERFORM public.eva_intake_event(i.id,'DISMISSED',jsonb_build_object('reason',btrim(p_body->>'reason'),'previousState',i.state,'sourceHash',i.file_hash,'financialApproval',false),p_actor);
  RETURN jsonb_build_object('id',i.id,'state','DISMISSED','replayed',false);
 ELSIF p_action='reconcile_preparation' THEN
  -- This path resumes only a known partial commercial preparation. An
  -- uncertain/RUNNING financial write still needs its own reconciliation.
  IF i.state<>'UNKNOWN' OR NOT i.ai_attempted OR i.lease_token IS NOT NULL OR i.document_type IS DISTINCT FROM 'INVOICE_DISTRIBUTOR' OR i.document_id IS NULL OR i.proof->>'state' IS DISTINCT FROM 'MATCH' THEN RAISE EXCEPTION 'Preparation review required' USING ERRCODE='40001';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('calculation-autofill:'||p_org||':'||i.unit_id||':'||i.month,0));
  IF NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=i.document_id AND d.organization_id=p_org AND d.customer_id=i.customer_id AND d.consumer_unit_id=i.unit_id AND to_char(d.reference_month,'YYYY-MM')=i.month AND d.file_verified AND d.file_hash=i.file_hash AND EXISTS(SELECT 1 FROM public.document_ocr_jobs j WHERE j.organization_id=p_org AND j.document_id=d.id AND j.file_hash=i.file_hash AND j.state='SUCCEEDED') AND EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=i.unit_id AND u.organization_id=p_org AND u.customer_id=i.customer_id AND u.status='ACTIVE' AND c.status='ACTIVE' AND c.deleted_at IS NULL)) THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='40001';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=p_org AND r.consumer_unit_id=i.unit_id AND r.month=i.month AND r.document_id=i.document_id AND r.source_hash=i.file_hash)
   OR EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=p_org AND r.consumer_unit_id=i.unit_id AND r.month=i.month AND (coalesce(public.calculation_preparation_effective_state(p_org,r.id),'RUNNING') NOT IN('PREPARED','PARTIAL') OR r.document_id IS DISTINCT FROM i.document_id OR r.source_hash IS DISTINCT FROM i.file_hash))
   OR EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.organization_id=p_org AND v.customer_id=i.customer_id AND v.month=i.month AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)='APPROVED') THEN RAISE EXCEPTION 'Financial effects require separate reconciliation' USING ERRCODE='40001';END IF;
  SELECT jsonb_agg(jsonb_build_object('runId',r.id,'sourceHash',r.source_hash,'basis',r.source_basis,'effectiveState',public.calculation_preparation_effective_state(p_org,r.id),'receipts',e.receipts) ORDER BY r.created_at) INTO proof
   FROM public.calculation_preparation_runs r JOIN LATERAL(SELECT receipts FROM public.calculation_preparation_run_events WHERE run_id=r.id ORDER BY sequence DESC LIMIT 1)e ON true WHERE r.organization_id=p_org AND r.consumer_unit_id=i.unit_id AND r.month=i.month;
  UPDATE public.eva_automatic_intakes SET state='AWAITING_SOURCES',signature=NULL,updated_at=clock_timestamp(),next_attempt_at=clock_timestamp(),note='Retomada auditada da proposta com as fontes existentes. Sem nova leitura paga.' WHERE id=i.id;
  PERFORM public.eva_intake_event(i.id,'PREPARATION_RECONCILED',jsonb_build_object('reason',btrim(p_body->>'reason'),'sourceHash',i.file_hash,'previousState',i.state,'runs',proof,'financialApproval',false,'repeatOcr',false),p_actor);
  RETURN jsonb_build_object('id',i.id,'state','AWAITING_SOURCES');
 END IF;
 RAISE EXCEPTION 'Invalid administration action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_administration(text,text,text,boolean,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_intake_administration(text,text,text,boolean,text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
