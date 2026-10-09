BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Existing prepare logic and grants preserved; accept the isolated annual climate formula.
CREATE OR REPLACE FUNCTION public.energy_forecast_prepare(p_org text,p_actor text,p_role text,p_platform boolean,p_request jsonb,p_sources jsonb,p_body jsonb,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.energy_forecast_runs; s jsonb; current_source jsonb; n integer;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,true);
 IF p_request IS NULL OR p_sources IS NULL OR jsonb_typeof(p_sources)<>'array' OR jsonb_array_length(p_sources) NOT BETWEEN 1 AND 36 OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
 OR (p_body->>'formulaVersion' IS NULL OR p_body->>'formulaVersion' NOT IN ('consumption-forecast/1.0','consumption-forecast/1.1','consumption-forecast/1.2','consumption-forecast/1.3','consumption-forecast/1.4')) OR p_body->>'status' IS DISTINCT FROM 'PRELIMINARY'
 OR p_body->>'organizationId' IS DISTINCT FROM p_org OR p_body->>'customerId' IS DISTINCT FROM p_request->>'customerId' OR p_body->>'unitId' IS DISTINCT FROM p_request->>'unitId' OR p_body->>'asOfMonth' IS DISTINCT FROM p_request->>'asOfMonth' THEN RAISE EXCEPTION 'Invalid forecast' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||(p_request->>'unitId')||':'||(p_request->>'asOfMonth'),909));
 SELECT * INTO r FROM public.energy_forecast_runs WHERE organization_id=p_org AND request_id=(p_request->>'requestId')::uuid;
 IF FOUND THEN IF r.created_by<>p_actor OR r.request<>p_request THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF; RETURN to_jsonb(r);END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_sources) LOOP
  IF s ? 'historyId' THEN current_source:=public.energy_forecast_history_source(p_org,p_actor,(s->>'historyId')::uuid); ELSE current_source:=public.energy_forecast_source(p_org,p_actor,p_role,p_platform,(s->>'admissionId')::uuid,(s->>'evidenceId')::uuid); END IF;
  IF current_source<>s OR s->>'customerId' IS DISTINCT FROM p_request->>'customerId' OR s->>'unitId' IS DISTINCT FROM p_request->>'unitId' THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='40001';END IF;
 END LOOP;
 SELECT COALESCE(max(version),0)+1 INTO n FROM public.energy_forecast_runs WHERE organization_id=p_org AND consumer_unit_id=p_request->>'unitId' AND cutoff=p_request->>'asOfMonth';
 INSERT INTO public.energy_forecast_runs(organization_id,customer_id,consumer_unit_id,version,cutoff,request_id,request,sources,body,payload_hash,created_by)
 VALUES(p_org,p_request->>'customerId',p_request->>'unitId',n,p_request->>'asOfMonth',(p_request->>'requestId')::uuid,p_request,p_sources,p_body,p_hash,p_actor) RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
