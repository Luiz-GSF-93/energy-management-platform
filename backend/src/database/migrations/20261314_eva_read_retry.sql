BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Read failures do not invalidate an identity attestation or acknowledge a write.
-- Lease, source scope, current actor/license and financial reservations remain gates.
CREATE OR REPLACE FUNCTION public.eva_intake_retry_read(p_id uuid,p_token uuid,p_read text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;ctx jsonb;
BEGIN
 IF p_read IS NULL OR p_read NOT IN('eva_scoped_closing_action:history','eva_scoped_closing_action:capture','eva_intake_prepared_checkpoint:lookup','eva_intake_source_state:lookup','closing:inspect','closing:snapshot') THEN RAISE EXCEPTION 'Explicit read-only checkpoint required' USING ERRCODE='22023';END IF;
 IF to_regprocedure('public.portal_intake_work_context_scoped(uuid,uuid)') IS NOT NULL THEN EXECUTE 'SELECT public.portal_intake_work_context_scoped($1,$2)' INTO ctx USING p_id,p_token;ELSE ctx:=public.eva_intake_work_context(p_id,p_token);END IF;
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 IF i.state NOT IN('PREPARING','WAITING_OCR','AWAITING_SOURCES','PROPOSAL_READY') OR i.document_id IS NULL OR i.proof->>'state' IS DISTINCT FROM 'MATCH'
 OR EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=i.organization_id AND r.consumer_unit_id=i.unit_id AND r.month=i.month AND coalesce(public.calculation_preparation_effective_state(r.organization_id,r.id),'RUNNING') NOT IN('PREPARED','PARTIAL'))
 OR EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.organization_id=i.organization_id AND v.customer_id=i.customer_id AND v.month=i.month AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1) IN('PREPARING','UNKNOWN')) THEN RAISE EXCEPTION 'Financial effects require separate reconciliation' USING ERRCODE='40001';END IF;
 UPDATE public.eva_automatic_intakes SET state='WAITING_OCR',lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp(),note='Consulta temporariamente indisponível. Leitura, respostas e rascunhos preservados; retomada automática sem reenviar o documento.' WHERE id=i.id;
 PERFORM public.eva_intake_event(i.id,'READ_RETRY_SCHEDULED',jsonb_build_object('read',p_read,'sourceHash',i.file_hash,'repeatOcr',false,'financialApproval',false),i.actor_id);
 RETURN jsonb_build_object('id',i.id,'state','WAITING_OCR','retryScheduled',true);
END$$;
-- Compare the complete immutable snapshot inside PostgreSQL instead of moving
-- megabytes of unchanged sources through HTTP and preparing the same proposal.
CREATE OR REPLACE FUNCTION public.eva_intake_prepared_checkpoint(p_id uuid,p_token uuid,p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='20s' AS $$
DECLARE i public.eva_automatic_intakes;v public.eva_assisted_closing_versions;ctx jsonb;kind text;state text;current_sources jsonb;
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN('BASE','CONTRACT','DOCUMENTED') THEN RAISE EXCEPTION 'Invalid closing mode' USING ERRCODE='22023';END IF;
 IF to_regprocedure('public.portal_intake_work_context_scoped(uuid,uuid)') IS NOT NULL THEN EXECUTE 'SELECT public.portal_intake_work_context_scoped($1,$2)' INTO ctx USING p_id,p_token;ELSE ctx:=public.eva_intake_work_context(p_id,p_token);END IF;
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp();
 IF i.state NOT IN('WAITING_OCR','AWAITING_SOURCES','PROPOSAL_READY') OR i.proof->>'state' IS DISTINCT FROM 'MATCH' OR i.closing_id IS NULL THEN RETURN jsonb_build_object('row',NULL);END IF;
 SELECT * INTO v FROM public.eva_assisted_closing_versions WHERE id=i.closing_id AND organization_id=i.organization_id AND customer_id=i.customer_id AND month=i.month;
 IF v.id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units')u WHERE u->>'id'=i.unit_id AND u->>'documentId'=i.document_id AND u->>'sourceHash'=i.file_hash)
 OR NOT EXISTS(SELECT 1 FROM public.documents d JOIN public.document_ocr_jobs j ON j.organization_id=d.organization_id AND j.document_id=d.id AND j.file_hash=d.file_hash WHERE d.organization_id=i.organization_id AND d.id=i.document_id AND d.customer_id=i.customer_id AND d.consumer_unit_id=i.unit_id AND d.file_hash=i.file_hash AND d.file_verified AND j.state='SUCCEEDED') THEN RETURN jsonb_build_object('row',NULL);END IF;
 kind:=coalesce(v.report#>>'{scope,kind}','CUSTOMER');
 IF kind NOT IN('UNIT','CUSTOMER') OR kind='UNIT' AND v.report#>'{scope,unitIds}' IS DISTINCT FROM jsonb_build_array(i.unit_id)
 OR EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions n WHERE n.organization_id=i.organization_id AND n.customer_id=i.customer_id AND n.month=i.month AND n.version>v.version AND coalesce(n.report#>>'{scope,kind}','CUSTOMER')=kind AND(kind='CUSTOMER' OR n.report#>'{scope,unitIds}'=jsonb_build_array(i.unit_id)))
 OR EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=i.organization_id AND r.consumer_unit_id=i.unit_id AND r.month=i.month AND coalesce(public.calculation_preparation_effective_state(r.organization_id,r.id),'RUNNING') NOT IN('PREPARED','PARTIAL')) THEN RETURN jsonb_build_object('row',NULL);END IF;
 SELECT e.state INTO state FROM public.eva_assisted_closing_events e WHERE e.closing_id=v.id ORDER BY sequence DESC LIMIT 1;
 IF state NOT IN('READY_FOR_REVIEW','INCOMPLETE') OR state IS NULL THEN RETURN jsonb_build_object('row',NULL);END IF;
 current_sources:=public.eva_scoped_closing_action(p_org=>i.organization_id,p_actor=>ctx#>>'{delegate,userId}',p_role=>ctx#>>'{delegate,roleId}',p_platform=>coalesce(ctx#>>'{delegate,accessMode}'='platform_operation',false),p_action=>'capture',p_disclose=>false,p_mode=>p_mode,p_scope=>kind,p_unit=>i.unit_id,p_month=>i.month,p_id=>NULL,p_body=>'{}'::jsonb);
 IF current_sources IS DISTINCT FROM v.source_snapshot THEN RETURN jsonb_build_object('row',NULL);END IF;
 RETURN jsonb_build_object('row',to_jsonb(v)-'source_snapshot'||jsonb_build_object('state',state),'sourcesCurrent',true);
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_retry_read(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_retry_read(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.eva_intake_prepared_checkpoint(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_prepared_checkpoint(uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.energyos_dependency_health() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT jsonb_build_object('database',true)$$;
REVOKE ALL ON FUNCTION public.energyos_dependency_health() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.energyos_dependency_health() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
