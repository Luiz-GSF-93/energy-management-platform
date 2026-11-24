BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- One explicit retry of an unacknowledged OCR submission, on the same original.
CREATE FUNCTION public.eva_intake_reading_recovery(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_action text,p_body jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;i public.eva_automatic_intakes;prior public.eva_automatic_intake_events;
BEGIN
 a:=public.eva_intake_actor(p_org,p_actor,p_role,p_platform,NULL);
 IF a->>'external' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Internal document operator required' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN('inspect','resume') OR p_id IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid reading recovery' USING ERRCODE='22023';END IF;
 SELECT * INTO i FROM public.eva_automatic_intakes WHERE id=p_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Receipt unavailable' USING ERRCODE='42501';END IF;
 IF p_action='resume' THEN
  IF p_body-ARRAY['requestId','sourceHash','expectedUpdatedAt','confirmed','reason']<>'{}' OR NOT p_body ?& ARRAY['requestId','sourceHash','expectedUpdatedAt','confirmed','reason'] OR p_body->>'requestId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR p_body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(p_body->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'reason')) NOT BETWEEN 20 AND 1000 OR p_body->>'sourceHash' IS DISTINCT FROM i.file_hash THEN RAISE EXCEPTION 'Explicit reading retry confirmation required' USING ERRCODE='22023';END IF;
  SELECT * INTO prior FROM public.eva_automatic_intake_events WHERE intake_id=i.id AND organization_id=p_org AND event='OCR_RETRY_AUTHORIZED' AND body->>'requestId'=p_body->>'requestId';
  IF FOUND THEN RETURN jsonb_build_object('id',i.id,'state',i.state,'replayed',true);END IF;
 END IF;
 IF i.state<>'UNKNOWN' OR NOT i.stored OR NOT i.consent OR i.external OR i.document_id IS NOT NULL OR i.closing_id IS NOT NULL OR i.raw_result IS NOT NULL OR i.operation_url IS NOT NULL OR i.lease_token IS NOT NULL OR i.ai_attempted OR NOT EXISTS(SELECT 1 FROM public.eva_automatic_intake_events e WHERE e.intake_id=i.id AND e.organization_id=p_org AND e.event='unknown' AND e.body->'diagnostic'->>'cause'='SUBMISSION_UNKNOWN') OR EXISTS(SELECT 1 FROM public.eva_automatic_intake_events WHERE intake_id=i.id AND organization_id=p_org AND event='OCR_RETRY_AUTHORIZED') THEN RAISE EXCEPTION 'Reading receipt changed or requires separate reconciliation' USING ERRCODE='40001';END IF;
 IF p_action='inspect' THEN
  IF p_body<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid reading inspection' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('id',i.id,'state',i.state,'readingRecovery',jsonb_build_object('sourceHash',i.file_hash,'expectedUpdatedAt',i.updated_at,'filename',i.filename,'maxAttempts',1,'unknownPreviousCharge',true));
 END IF;
 IF (p_body->>'expectedUpdatedAt')::timestamptz IS DISTINCT FROM i.updated_at THEN RAISE EXCEPTION 'Reading receipt changed' USING ERRCODE='40001';END IF;
 UPDATE public.eva_automatic_intakes SET state='RECOGNIZING',actor_id=p_actor,role_id=p_role,platform=p_platform,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),note='Retomada única autorizada da leitura. Original e histórico preservados; sem nova inclusão documental.' WHERE id=i.id;
 PERFORM public.eva_intake_event(i.id,'OCR_RETRY_AUTHORIZED',jsonb_build_object('requestId',p_body->>'requestId','reason',btrim(p_body->>'reason'),'sourceHash',i.file_hash,'previousState',i.state,'unknownPreviousCharge',true,'maxAttempts',1,'repeatAi',false,'financialApproval',false),p_actor);
 RETURN jsonb_build_object('id',i.id,'state','RECOGNIZING','replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_reading_recovery(text,text,text,boolean,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_intake_reading_recovery(text,text,text,boolean,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
