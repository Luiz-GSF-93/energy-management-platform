-- Bounded DRI diagnostics; existing authorization/lease checks remain authoritative.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
ALTER FUNCTION public.ccee_finish_dri_reading(uuid,uuid,jsonb,text) RENAME TO ccee_finish_dri_reading_before_diagnostic;
CREATE FUNCTION public.ccee_finish_dri_reading(p_id uuid,p_lease uuid,p_result jsonb,p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE answer jsonb;d jsonb;j public.ccee_integration_jobs;v text;
BEGIN
 d:=p_result->'diagnostic';
 IF d IS NOT NULL THEN
  IF p_error IS DISTINCT FROM 'DRI_EVENT_IDENTITY_CONFLICT' OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>5000 OR d-ARRAY['version','stage','eventCode','sourceHashes','changedPaths','truncated']<>'{}'::jsonb OR d->>'version' IS DISTINCT FROM '1' OR d->>'stage' IS DISTINCT FROM 'EVENT_IDENTITY' OR NOT coalesce(d->>'eventCode'~'^[0-9]{1,20}$',false) OR jsonb_typeof(d->'sourceHashes') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'sourceHashes')<>2 OR jsonb_typeof(d->'changedPaths') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'changedPaths') NOT BETWEEN 1 AND 16 OR jsonb_typeof(d->'truncated') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid bounded DRI diagnostic' USING ERRCODE='22023';END IF;
  FOR v IN SELECT jsonb_array_elements_text(d->'sourceHashes') LOOP IF v!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid source hash' USING ERRCODE='22023';END IF;END LOOP;
  FOR v IN SELECT jsonb_array_elements_text(d->'changedPaths') LOOP IF length(v) NOT BETWEEN 1 AND 240 OR v!~'^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$' OR v~*'(password|senha|secret|token|pfx|private|credential|username|usuario|authorization)' THEN RAISE EXCEPTION 'Unsafe diagnostic field' USING ERRCODE='22023';END IF;END LOOP;
 END IF;
 -- Strip additive metadata before calling the established strict failure schema.
 answer:=public.ccee_finish_dri_reading_before_diagnostic(p_id,p_lease,CASE WHEN p_result IS NULL THEN NULL ELSE p_result-'diagnostic' END,p_error);
 IF d IS NOT NULL THEN
  SELECT * INTO STRICT j FROM public.ccee_integration_jobs WHERE id=p_id;
  INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,details)VALUES(j.organization_id,j.id,j.actor_id,'READ_DIAGNOSTIC',d);
 END IF;
 RETURN answer;
END$$;
CREATE FUNCTION public.ccee_dri_diagnostic_read(p_org text,p_actor text,p_id uuid,p_latest boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_integration_jobs;binding jsonb;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'view');
 SELECT * INTO j FROM public.ccee_integration_jobs WHERE organization_id=p_org AND kind LIKE 'DRI_%' AND CASE WHEN p_latest THEN authorization_id=p_id ELSE id=p_id END ORDER BY created_at DESC,id DESC LIMIT 1;
 IF j.id IS NULL THEN RETURN jsonb_build_object('organizationId',p_org,'job',null);END IF;
 binding:=public.assert_ccee_data_binding(p_org,j.authorization_id,j.month,'DRI_READ');
 RETURN jsonb_build_object('organizationId',p_org,'job',jsonb_build_object('id',j.id,'kind',j.kind,'month',j.month,'state',j.state,'error_code',j.error_code,'created_at',j.created_at,'finished_at',j.finished_at,'request_payload',j.request_payload-ARRAY['requestId','authorizationId','parentJobId']),
  'provenance',(SELECT details FROM public.ccee_integration_events WHERE organization_id=p_org AND job_id=j.id AND event IN('READ_FAILED','READ_FINISHED') ORDER BY recorded_at DESC,id DESC LIMIT 1),
  'diagnostic',(SELECT details FROM public.ccee_integration_events WHERE organization_id=p_org AND job_id=j.id AND event='READ_DIAGNOSTIC' ORDER BY recorded_at DESC,id DESC LIMIT 1));
END$$;
REVOKE ALL ON FUNCTION public.ccee_finish_dri_reading_before_diagnostic(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ccee_finish_dri_reading(uuid,uuid,jsonb,text),public.ccee_dri_diagnostic_read(text,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ccee_finish_dri_reading(uuid,uuid,jsonb,text),public.ccee_dri_diagnostic_read(text,text,uuid,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
