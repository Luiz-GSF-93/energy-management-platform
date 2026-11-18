BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Recovery never declares an unknown provider request free or successful.
-- Only the canonical Owner can authorize one new attempt against a locked checkpoint.
CREATE FUNCTION public.legal_audit_recover_ai(p_owner uuid,p_org text,p_id uuid,p_request uuid,p_expected timestamptz,p_reason text,p_keep_reservation boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.legal_audit_jobs; usage_row public.bot_energy_ai_usage; failure public.audit_logs;
BEGIN
 PERFORM public.platform_team_owner(p_owner);
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<clock_timestamp())) THEN RAISE EXCEPTION 'Active Owner required' USING ERRCODE='42501';END IF;
 IF p_keep_reservation IS DISTINCT FROM true OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 20 AND 1000 OR p_expected IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'Explicit reserved-usage acknowledgement required' USING ERRCODE='22023';END IF;
 SELECT * INTO j FROM public.legal_audit_jobs WHERE id=p_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Analysis unavailable' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.legal_audit_events WHERE job_id=j.id AND kind='UNKNOWN_AI_RETRY_AUTHORIZED' AND body->>'requestId'=p_request::text) THEN RETURN jsonb_build_object('id',j.id,'state',j.state,'replayed',true);END IF;
 IF j.state<>'TECHNICAL_REVIEW' OR j.note NOT LIKE 'AI_RESULT_UNKNOWN%' OR j.updated_at IS DISTINCT FROM p_expected OR j.lease_token IS NOT NULL OR j.report IS NOT NULL OR jsonb_array_length(j.pages)=0 OR jsonb_array_length(j.narratives)<>j.cursor THEN RAISE EXCEPTION 'Checkpoint changed or not eligible' USING ERRCODE='40001';END IF;
 PERFORM public.legal_audit_actor(j.organization_id,j.actor_id,j.role_id,j.platform,true);
 IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=j.document_id AND organization_id=j.organization_id AND customer_id=j.customer_id AND consumer_unit_id=j.unit_id AND file_hash=j.source_hash AND file_verified) THEN RAISE EXCEPTION 'Original changed' USING ERRCODE='40001';END IF;
 SELECT * INTO usage_row FROM public.bot_energy_ai_usage WHERE id=p_request AND organization_id=p_org AND module='AUDITORIA' FOR UPDATE;
 IF NOT FOUND OR usage_row.state<>'RESERVED' OR usage_row.actual_micro_usd IS NOT NULL OR usage_row.settled_at IS NOT NULL THEN RAISE EXCEPTION 'Unknown reservation required' USING ERRCODE='40001';END IF;
 SELECT * INTO failure FROM public.audit_logs WHERE resource_type='backoffice_ai_interpretation' AND resource_id=p_request::text AND organization_id=p_org AND changes->'after'->>'state'='FAILED' ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND OR failure.changes->'after'->>'documentId' IS DISTINCT FROM j.document_id OR failure.changes->'after'->>'consumptionState' IS DISTINCT FROM 'PENDING' OR failure.created_at>j.updated_at OR NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE resource_type='backoffice_ai_interpretation' AND resource_id=p_request::text AND organization_id=p_org AND changes->'after'->>'state'='REQUESTED' AND changes->'after'->>'documentId'=j.document_id) OR EXISTS(SELECT 1 FROM public.audit_logs WHERE resource_type='backoffice_ai_interpretation' AND organization_id=p_org AND changes->'after'->>'documentId'=j.document_id AND created_at>failure.created_at AND changes->'after'->>'state' IN('REQUESTED','READY','NO_EVIDENCE')) THEN RAISE EXCEPTION 'Provider audit does not match pending checkpoint' USING ERRCODE='40001';END IF;
 UPDATE public.legal_audit_jobs SET state='ANALYZING',next_attempt_at=now(),updated_at=clock_timestamp(),note='Retomada autorizada pelo Owner. Leitura preservada; reserva anterior mantida para conciliação, sem novo crédito documental.' WHERE id=j.id RETURNING * INTO j;
 INSERT INTO public.legal_audit_events(job_id,organization_id,state,kind,body,actor_id) VALUES(j.id,p_org,j.state,'UNKNOWN_AI_RETRY_AUTHORIZED',jsonb_build_object('requestId',p_request,'reason',btrim(p_reason),'cursor',j.cursor,'reservationPreserved',true,'reservedMicroUsd',usage_row.reserved_micro_usd,'additionalDocumentCredits',0),p_owner::text);
 RETURN jsonb_build_object('id',j.id,'state',j.state,'replayed',false,'reservationPreserved',true);
END$$;
REVOKE ALL ON FUNCTION public.legal_audit_recover_ai(uuid,text,uuid,uuid,timestamptz,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.legal_audit_recover_ai(uuid,text,uuid,uuid,timestamptz,text,boolean) TO service_role;
COMMIT;
