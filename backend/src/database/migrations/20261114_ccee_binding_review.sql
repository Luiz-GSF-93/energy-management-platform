-- Additive presentation only: keep the authorized RPC signature and all write paths.
-- The migration sequence follows the repository; deployment date is 19/10/2026.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.ccee_data_action(p_org text,p_actor text,p_action text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.ccee_unit_authorizations;previous public.ccee_integration_events;j public.ccee_integration_jobs;
 req uuid;unit_id text;payload jsonb;binding jsonb;result jsonb;pg integer;target date;next_revision integer;status text;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,CASE WHEN p_action IN ('list','history','job','calendar') THEN 'view' WHEN p_action IN ('approve_binding','revoke_binding') THEN 'review' ELSE 'manage' END);
 IF p_action NOT IN ('list','history','job','calendar','binding','approve_binding','revoke_binding','enqueue','cancel','preparation') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>12000 THEN RAISE EXCEPTION 'Invalid CCEE action' USING ERRCODE='22023';END IF;
 IF p_action IN ('list','history','calendar') THEN
  pg:=COALESCE((p_body->>'page')::integer,0);IF pg<0 OR pg>1000 OR p_body-ARRAY['page','month','versionId']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023';END IF;
  IF p_action='list' THEN
   RETURN jsonb_build_object('organizationId',p_org,'page',pg,
    'bindings',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id),'[]') FROM(
     SELECT bound_row.*,
      c.company_name AS customer_name,c.document AS customer_document,
      u.name AS unit_name,u.consumer_unit_number,u.distributor,
      (c.id IS NOT NULL AND u.id IS NOT NULL) AS identity_complete,
      evidence.details->'request'->'body'->>'reason' AS revision_reason
     FROM (SELECT * FROM public.ccee_unit_authorizations WHERE organization_id=p_org ORDER BY created_at DESC,id LIMIT 25 OFFSET pg*25) bound_row
     LEFT JOIN public.customers c ON c.id=bound_row.customer_id AND c.organization_id=bound_row.organization_id
     LEFT JOIN public.consumer_units u ON u.id=bound_row.consumer_unit_id AND u.organization_id=bound_row.organization_id
      AND u.customer_id=bound_row.customer_id AND c.id IS NOT NULL
     LEFT JOIN LATERAL (
      SELECT e.details FROM public.ccee_integration_events e
      WHERE e.organization_id=bound_row.organization_id AND e.event IN ('binding','approve_binding','revoke_binding')
       AND e.details->'result'->>'id'=bound_row.id::text
       AND e.details->'result'->>'organization_id'=bound_row.organization_id
       AND e.details->'result'->>'revision'=bound_row.revision::text
       AND e.details->'request'->>'action'=e.event
      ORDER BY e.recorded_at DESC,e.id LIMIT 1
     ) evidence ON true
    )x),
    'jobs',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]') FROM(SELECT id,kind,month,environment,state,authorization_id,measurement_kind,requests,bytes,duration_ms,created_at,finished_at,error_code FROM public.ccee_integration_jobs WHERE organization_id=p_org ORDER BY created_at DESC,id LIMIT 25 OFFSET pg*25)x));
  ELSIF p_action='history' THEN
   IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ccee_integration_jobs WHERE id=p_id AND organization_id=p_org) THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='42501';END IF;
   RETURN jsonb_build_object('organizationId',p_org,'page',pg,'rows',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.recorded_at DESC),'[]') FROM(SELECT * FROM public.ccee_integration_events WHERE organization_id=p_org AND(p_id IS NULL OR job_id=p_id) ORDER BY recorded_at DESC,id LIMIT 25 OFFSET pg*25)x));
  ELSE
   RETURN jsonb_build_object('organizationId',p_org,'page',pg,'versions',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]') FROM(SELECT id,year,source_url,source_hash,normalized_hash,coverage,created_at FROM public.ccee_calendar_versions WHERE state='APPROVED' ORDER BY created_at DESC,id LIMIT 25 OFFSET pg*25)x),
    'items',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.due_at),'[]') FROM(SELECT i.* FROM public.ccee_calendar_items i JOIN public.ccee_calendar_versions v ON v.id=i.version_id WHERE v.state='APPROVED' AND i.version_id=nullif(p_body->>'versionId','')::uuid ORDER BY due_at,id LIMIT 25 OFFSET pg*25)x));
  END IF;
 END IF;
 IF p_action IN ('job','preparation') THEN
  SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=p_id AND organization_id=p_org;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='42501';END IF;
  IF j.authorization_id IS NOT NULL THEN binding:=public.assert_ccee_data_binding(p_org,j.authorization_id,j.month,j.kind);END IF;
  RETURN jsonb_build_object('organizationId',p_org,'job',to_jsonb(j),'binding',binding);
 END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request id required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||req::text,191));payload:=jsonb_build_object('action',p_action,'id',p_id,'actor',p_actor,'body',p_body);
 SELECT * INTO previous FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=req;
 IF FOUND THEN IF previous.details->'request' IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001';END IF;RETURN previous.details->'result';END IF;
 IF p_action='binding' THEN
  IF jsonb_typeof(p_body->'serviceScope') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'serviceScope') NOT BETWEEN 1 AND 3 OR NOT(p_body->'serviceScope'<@'["POINTS","MEASUREMENTS","AGENDA"]'::jsonb) OR(p_body->'serviceScope'?'MEASUREMENTS' AND nullif(p_body->>'principalProfileCode','') IS NULL) THEN RAISE EXCEPTION 'Explicit service scope required' USING ERRCODE='22023';END IF;
  IF p_body-ARRAY['requestId','customerId','unitId','profileCode','principalProfileCode','measurementPoint','meterCode','representationKind','serviceScope','validFrom','validTo','measurementBasis','evidenceReference','reason']<>'{}'::jsonb OR p_body->>'profileCode'!~'^\d{1,12}$' OR nullif(p_body->>'principalProfileCode','') IS NOT NULL AND p_body->>'principalProfileCode'!~'^\d{1,12}$' OR p_body->>'measurementPoint'!~'^[-A-Za-z0-9_]{1,100}$' OR p_body->>'representationKind' NOT IN('TOTAL','PARTIAL') OR p_body->>'measurementBasis' NOT IN('UNKNOWN','NO_LOSSES','WITH_LOSSES') OR COALESCE(length(p_body->>'reason'),0) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid binding' USING ERRCODE='22023';END IF;
  unit_id:=p_body->>'unitId';PERFORM pg_advisory_xact_lock(hashtextextended(p_org||unit_id,192));
  SELECT COALESCE(max(revision),0)+1 INTO next_revision FROM public.ccee_unit_authorizations WHERE organization_id=p_org AND consumer_unit_id=unit_id;
  INSERT INTO public.ccee_unit_authorizations(organization_id,customer_id,consumer_unit_id,profile_code,principal_profile_code,measurement_point,meter_code,revision,status,evidence_reference,created_by,valid_from,valid_to,representation_kind,service_scope,measurement_basis)
  VALUES(p_org,p_body->>'customerId',unit_id,p_body->>'profileCode',nullif(p_body->>'principalProfileCode',''),p_body->>'measurementPoint',nullif(p_body->>'meterCode',''),next_revision,'DRAFT',p_body->>'evidenceReference',p_actor,(p_body->>'validFrom')::date,nullif(p_body->>'validTo','')::date,p_body->>'representationKind',p_body->'serviceScope',p_body->>'measurementBasis') RETURNING * INTO a;
  IF a.valid_from IS NULL THEN RAISE EXCEPTION 'Validity required' USING ERRCODE='22023';END IF;result:=to_jsonb(a);
 ELSIF p_action IN ('approve_binding','revoke_binding') THEN
  SELECT * INTO a FROM public.ccee_unit_authorizations WHERE id=p_id AND organization_id=p_org;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Binding unavailable' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org||a.consumer_unit_id,192));
  IF p_body-ARRAY['requestId','revision','reason']<>'{}'::jsonb OR (p_body->>'revision')::integer IS DISTINCT FROM a.revision OR COALESCE(length(p_body->>'reason'),0) NOT BETWEEN 3 AND 500 OR EXISTS(SELECT 1 FROM public.ccee_unit_authorizations WHERE organization_id=p_org AND consumer_unit_id=a.consumer_unit_id AND revision>a.revision) THEN RAISE EXCEPTION 'Binding revision changed' USING ERRCODE='40001';END IF;
  IF a.created_by=p_actor OR(p_action='approve_binding' AND a.status<>'DRAFT') OR(p_action='revoke_binding' AND a.status='REVOKED') THEN RAISE EXCEPTION 'Independent review required' USING ERRCODE='42501';END IF;
  IF p_action='approve_binding' AND(a.valid_from IS NULL OR a.representation_kind IS NULL OR jsonb_array_length(a.service_scope)=0 OR(a.service_scope?'MEASUREMENTS' AND a.principal_profile_code IS NULL)) THEN RAISE EXCEPTION 'Prepare explicit validity and scope before review' USING ERRCODE='22023';END IF;
  status:=CASE WHEN p_action='approve_binding' THEN 'APPROVED' ELSE 'REVOKED' END;
  INSERT INTO public.ccee_unit_authorizations(organization_id,customer_id,consumer_unit_id,profile_code,principal_profile_code,measurement_point,meter_code,revision,status,evidence_reference,created_by,reviewed_by,reviewed_at,valid_from,valid_to,representation_kind,service_scope,measurement_basis)
  VALUES(p_org,a.customer_id,a.consumer_unit_id,a.profile_code,a.principal_profile_code,a.measurement_point,a.meter_code,a.revision+1,status,a.evidence_reference,a.created_by,p_actor,now(),a.valid_from,a.valid_to,a.representation_kind,a.service_scope,a.measurement_basis) RETURNING * INTO a;
  result:=to_jsonb(a);
 ELSIF p_action='enqueue' THEN
  IF p_body-ARRAY['requestId','kind','month','authorizationId','measurementKind']<>'{}'::jsonb OR p_body->>'kind' NOT IN('POINTS','MEASUREMENTS','PLD') OR p_body->>'month'!~'^20\d{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid reading' USING ERRCODE='22023';END IF;
  target:=((p_body->>'month')||'-01')::date;IF target<'2021-01-01' OR target>=date_trunc('month',now())::date THEN RAISE EXCEPTION 'Closed month required' USING ERRCODE='22023';END IF;
  IF p_body->>'kind'<>'PLD' THEN binding:=public.assert_ccee_data_binding(p_org,(p_body->>'authorizationId')::uuid,target,p_body->>'kind');END IF;
  -- Serialize the organization queue cap as well as equivalent requests.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org,194));
  SELECT * INTO j FROM public.ccee_integration_jobs WHERE organization_id=p_org AND kind=p_body->>'kind' AND month=target AND authorization_id IS NOT DISTINCT FROM nullif(p_body->>'authorizationId','')::uuid AND measurement_kind IS NOT DISTINCT FROM p_body->>'measurementKind' AND state IN('QUEUED','RUNNING') LIMIT 1;
  IF NOT FOUND THEN
   IF(SELECT count(*) FROM public.ccee_integration_jobs WHERE organization_id=p_org AND state IN('QUEUED','RUNNING'))>=20 THEN RAISE EXCEPTION 'Reading queue limit reached' USING ERRCODE='22023';END IF;
   INSERT INTO public.ccee_integration_jobs(organization_id,actor_id,request_id,request_payload,kind,month,authorization_id,measurement_kind)
   VALUES(p_org,p_actor,req,p_body,p_body->>'kind',target,nullif(p_body->>'authorizationId','')::uuid,p_body->>'measurementKind') RETURNING * INTO j;
  END IF;result:=to_jsonb(j);
 ELSIF p_action='cancel' THEN
  UPDATE public.ccee_integration_jobs SET state='CANCELLED',finished_at=now() WHERE id=p_id AND organization_id=p_org AND state='QUEUED' RETURNING * INTO j;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Only a queued reading may be cancelled' USING ERRCODE='40001';END IF;result:=to_jsonb(j);
 END IF;
 INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,request_id,details) VALUES(p_org,j.id,p_actor,p_action,req,jsonb_build_object('request',payload,'result',result));
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.ccee_data_action(text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ccee_data_action(text,text,text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
