BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.energy_forecast_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id), consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 version integer NOT NULL CHECK(version>0), cutoff text NOT NULL CHECK(cutoff ~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$'),
 request_id uuid NOT NULL, request jsonb NOT NULL, sources jsonb NOT NULL,
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=1000000),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'), created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,request_id), UNIQUE(organization_id,consumer_unit_id,cutoff,version), UNIQUE(organization_id,id)
);
CREATE TABLE public.energy_forecast_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, run_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('VALIDATED','PUBLISHED')), request_id uuid NOT NULL,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 20 AND 1000), actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,run_id) REFERENCES public.energy_forecast_runs(organization_id,id),
 UNIQUE(run_id,action), UNIQUE(organization_id,request_id)
);
ALTER TABLE public.energy_forecast_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.energy_forecast_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.energy_forecast_runs,public.energy_forecast_events FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER forecast_runs_immutable BEFORE UPDATE OR DELETE ON public.energy_forecast_runs FOR EACH ROW EXECUTE FUNCTION public.reject_report_change();
CREATE TRIGGER forecast_events_immutable BEFORE UPDATE OR DELETE ON public.energy_forecast_events FOR EACH ROW EXECUTE FUNCTION public.reject_report_change();

CREATE FUNCTION public.energy_forecast_source(p_org text,p_actor text,p_role text,p_platform boolean,p_admission uuid,p_evidence uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb; e public.acl_admission_evidence; r public.acl_admission_evidence_reviews;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,false);
 s:=public.acl_history_simulation_source(p_org,p_actor,p_role,p_platform,p_admission,p_evidence);
 SELECT * INTO e FROM public.acl_admission_evidence WHERE organization_id=p_org AND id=p_evidence AND admission_id=p_admission;
 SELECT * INTO r FROM public.acl_admission_evidence_reviews WHERE organization_id=p_org AND evidence_id=p_evidence AND decision='APPROVED';
 IF e.id IS NULL OR r.evidence_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=e.consumer_unit_id AND u.organization_id=p_org AND c.id=e.customer_id AND c.status='ACTIVE' AND c.deleted_at IS NULL AND u.status='ACTIVE') THEN RAISE EXCEPTION 'Forecast scope unavailable' USING ERRCODE='P3862';END IF;
 RETURN s||jsonb_build_object('organizationId',p_org,'customerId',e.customer_id,'unitId',e.consumer_unit_id,'admissionId',p_admission,'reviewedBy',r.reviewed_by,'reviewedAt',r.reviewed_at);
END $$;
CREATE FUNCTION public.energy_forecast_sources(p_org text,p_actor text,p_role text,p_platform boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,false);
 PERFORM public.acl_assert_actor(p_org,p_actor,p_role,p_platform,false);
 RETURN (SELECT COALESCE(jsonb_agg(q.body),'[]'::jsonb) FROM (SELECT jsonb_build_object('admissionId',e.admission_id,'evidenceId',e.id,'customerId',e.customer_id,'unitId',e.consumer_unit_id,'customerName',c.company_name,'unitName',u.name,'reviewedAt',r.reviewed_at,'lastMonth',e.facts#>>'{history,rows,11,month}') body
 FROM public.acl_admission_evidence e JOIN public.acl_admission_evidence_reviews r ON r.organization_id=e.organization_id AND r.evidence_id=e.id AND r.decision='APPROVED'
 JOIN public.customers c ON c.id=e.customer_id AND c.organization_id=e.organization_id AND c.deleted_at IS NULL AND c.status='ACTIVE'
 JOIN public.consumer_units u ON u.id=e.consumer_unit_id AND u.organization_id=e.organization_id AND u.customer_id=c.id AND u.status='ACTIVE'
 WHERE e.organization_id=p_org AND e.stage_key='invoices' AND e.kind='COMPLETE' AND e.facts ? 'history' ORDER BY r.reviewed_at DESC LIMIT 100) q);
END $$;
CREATE FUNCTION public.energy_forecast_prepare(p_org text,p_actor text,p_role text,p_platform boolean,p_request jsonb,p_sources jsonb,p_body jsonb,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.energy_forecast_runs; s jsonb; current_source jsonb; n integer;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,true);
 IF p_request IS NULL OR p_sources IS NULL OR jsonb_typeof(p_sources)<>'array' OR jsonb_array_length(p_sources) NOT BETWEEN 1 AND 36 OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
 OR p_body->>'formulaVersion' IS DISTINCT FROM 'consumption-forecast/1.0' OR p_body->>'status' IS DISTINCT FROM 'PRELIMINARY'
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
CREATE FUNCTION public.energy_forecast_transition(p_org text,p_actor text,p_role text,p_platform boolean,p_run uuid,p_request uuid,p_hash text,p_action text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.energy_forecast_runs; s jsonb; ev public.energy_forecast_events;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,true);
 IF p_action IS NULL OR p_action NOT IN ('VALIDATED','PUBLISHED') OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||p_run::text,909));
 SELECT * INTO r FROM public.energy_forecast_runs WHERE organization_id=p_org AND id=p_run;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forecast unavailable' USING ERRCODE='P3862';END IF;
 IF r.payload_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Forecast changed' USING ERRCODE='40001';END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(r.sources) LOOP
  IF s ? 'historyId' THEN
   PERFORM public.energy_forecast_history_actor(p_org,p_actor,true,true);
   IF public.energy_forecast_history_source(p_org,p_actor,(s->>'historyId')::uuid)<>s THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='40001';END IF;
  ELSE
   PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,(s->>'admissionId')::uuid,false,true);
   IF public.energy_forecast_source(p_org,p_actor,p_role,p_platform,(s->>'admissionId')::uuid,(s->>'evidenceId')::uuid)<>s THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='40001';END IF;
  END IF;
 END LOOP;
 SELECT * INTO ev FROM public.energy_forecast_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF ev.run_id<>p_run OR ev.action<>p_action OR ev.note<>p_note OR ev.actor<>p_actor THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;RETURN to_jsonb(ev);END IF;
 IF EXISTS(SELECT 1 FROM public.energy_forecast_events WHERE run_id=p_run AND action=p_action) OR (p_action='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM public.energy_forecast_events WHERE run_id=p_run AND action='VALIDATED')) OR (p_action='VALIDATED' AND EXISTS(SELECT 1 FROM public.energy_forecast_events WHERE run_id=p_run AND action='PUBLISHED')) THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='40001';END IF;
 INSERT INTO public.energy_forecast_events(organization_id,run_id,action,request_id,note,actor) VALUES(p_org,p_run,p_action,p_request,p_note,p_actor) RETURNING * INTO ev;
 RETURN to_jsonb(ev);
END $$;
CREATE FUNCTION public.energy_forecast_read(p_org text,p_actor text,p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,false);
 SELECT COALESCE(jsonb_agg(q.body),'[]'::jsonb) INTO result FROM (SELECT to_jsonb(r)-'sources'||jsonb_build_object('customerName',c.company_name,'unitName',u.name,'events',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at),'[]'::jsonb) FROM public.energy_forecast_events e WHERE e.organization_id=p_org AND e.run_id=r.id)) body
 FROM public.energy_forecast_runs r JOIN public.consumer_units u ON u.id=r.consumer_unit_id AND u.organization_id=r.organization_id AND u.customer_id=r.customer_id AND u.status='ACTIVE'
 JOIN public.customers c ON c.id=r.customer_id AND c.organization_id=r.organization_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 WHERE r.organization_id=p_org AND (p_run IS NULL OR r.id=p_run) ORDER BY r.created_at DESC LIMIT 100) q;
 IF p_run IS NOT NULL THEN IF jsonb_array_length(result)<>1 THEN RAISE EXCEPTION 'Forecast unavailable' USING ERRCODE='P3862';END IF;RETURN result->0;END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.energy_forecast_request(p_org text,p_actor text,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run uuid;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,false);
 SELECT id INTO run FROM public.energy_forecast_runs WHERE organization_id=p_org AND request_id=p_request;
 IF run IS NULL THEN RETURN NULL; END IF;
 RETURN public.energy_forecast_read(p_org,p_actor,run);
END $$;
CREATE FUNCTION public.energy_forecast_published(p_org text,p_actor text,p_customer text,p_unit text,p_cutoff text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run uuid;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,false);
 SELECT r.id INTO run FROM public.energy_forecast_runs r JOIN public.energy_forecast_events e ON e.organization_id=r.organization_id AND e.run_id=r.id AND e.action='PUBLISHED'
 WHERE r.organization_id=p_org AND r.customer_id=p_customer AND r.consumer_unit_id=p_unit AND r.cutoff=p_cutoff ORDER BY e.created_at DESC,r.version DESC LIMIT 1;
 IF run IS NULL THEN RETURN NULL; END IF;
 RETURN public.energy_forecast_read(p_org,p_actor,run);
END $$;
REVOKE ALL ON FUNCTION public.energy_forecast_source(text,text,text,boolean,uuid,uuid),public.energy_forecast_sources(text,text,text,boolean),public.energy_forecast_prepare(text,text,text,boolean,jsonb,jsonb,jsonb,text),public.energy_forecast_transition(text,text,text,boolean,uuid,uuid,text,text,text),public.energy_forecast_read(text,text,uuid),public.energy_forecast_request(text,text,uuid),public.energy_forecast_published(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.energy_forecast_source(text,text,text,boolean,uuid,uuid),public.energy_forecast_sources(text,text,text,boolean),public.energy_forecast_prepare(text,text,text,boolean,jsonb,jsonb,jsonb,text),public.energy_forecast_transition(text,text,text,boolean,uuid,uuid,text,text,text),public.energy_forecast_read(text,text,uuid),public.energy_forecast_request(text,text,uuid),public.energy_forecast_published(text,text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
