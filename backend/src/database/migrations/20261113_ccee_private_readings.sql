-- CCEE R1: additive private preparation. No grants to users, live jobs or provider writes.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
INSERT INTO public.permissions(id,code,name,module,resource,action) VALUES
 ('f5364101-4486-42c2-a90f-807937ac3011','ccee_data.view','Consultar leituras CCEE','ccee','data','view'),
 ('f5364101-4486-42c2-a90f-807937ac3012','ccee_data.manage','Preparar leituras CCEE','ccee','data','manage'),
 ('f5364101-4486-42c2-a90f-807937ac3013','ccee_data.review','Revisar vínculos CCEE','ccee','data','review');
ALTER TABLE public.ccee_unit_authorizations
 ADD COLUMN valid_from date,
 ADD COLUMN valid_to date,
 ADD COLUMN principal_profile_code text CHECK(principal_profile_code~'^[0-9]{1,12}$'),
 ADD COLUMN representation_kind text CHECK(representation_kind IN ('TOTAL','PARTIAL')),
 ADD COLUMN service_scope jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(service_scope)='array'),
 ADD COLUMN measurement_basis text NOT NULL DEFAULT 'UNKNOWN' CHECK(measurement_basis IN ('UNKNOWN','NO_LOSSES','WITH_LOSSES')),
 ADD COLUMN meter_code text CHECK(meter_code~'^[-A-Za-z0-9_]{1,100}$'),
 ADD CONSTRAINT ccee_authorization_period CHECK(valid_to IS NULL OR valid_from IS NOT NULL AND valid_to>=valid_from);
-- Legacy approvals deliberately receive no newly inferred validity, scope or principal profile.
CREATE TABLE public.ccee_integration_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),actor_id text NOT NULL,
 request_id uuid NOT NULL,request_payload jsonb NOT NULL,kind text NOT NULL CHECK(kind IN ('POINTS','MEASUREMENTS','PLD')),
 month date NOT NULL CHECK(extract(day from month)=1),environment text NOT NULL DEFAULT 'PRODUCTION' CHECK(environment IN ('PRODUCTION','PILOT')),
 authorization_id uuid REFERENCES public.ccee_unit_authorizations(id),measurement_kind text CHECK(measurement_kind IN ('FINAL','CONSOLIDADA','FALTANTES')),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
 lease_id uuid,lease_until timestamptz,result jsonb,error_code text,requests integer NOT NULL DEFAULT 0 CHECK(requests>=0),
 bytes bigint NOT NULL DEFAULT 0 CHECK(bytes>=0),duration_ms integer CHECK(duration_ms>=0),created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 UNIQUE(organization_id,request_id),CHECK((kind='PLD' AND authorization_id IS NULL AND measurement_kind IS NULL) OR(kind='POINTS' AND authorization_id IS NOT NULL AND measurement_kind IS NULL) OR(kind='MEASUREMENTS' AND authorization_id IS NOT NULL AND measurement_kind IS NOT NULL)),
 CHECK(result IS NULL OR jsonb_typeof(result)='object' AND octet_length(result::text)<=2097152)
);
CREATE INDEX ccee_jobs_queue ON public.ccee_integration_jobs(state,created_at);
CREATE INDEX ccee_jobs_scope ON public.ccee_integration_jobs(organization_id,month,created_at DESC);
CREATE TABLE public.ccee_integration_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text REFERENCES public.organizations(id),job_id uuid REFERENCES public.ccee_integration_jobs(id),
 actor_id text NOT NULL,event text NOT NULL,request_id uuid,details jsonb NOT NULL DEFAULT '{}',recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(length(event) BETWEEN 3 AND 80),CHECK(jsonb_typeof(details)='object' AND octet_length(details::text)<=12000)
);
CREATE INDEX ccee_events_scope ON public.ccee_integration_events(organization_id,recorded_at DESC);
CREATE UNIQUE INDEX ccee_events_request ON public.ccee_integration_events(organization_id,request_id) WHERE request_id IS NOT NULL;
CREATE TABLE public.ccee_calendar_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_url text NOT NULL,source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 normalized_hash text NOT NULL CHECK(normalized_hash~'^[a-f0-9]{64}$'),year integer NOT NULL CHECK(year BETWEEN 2021 AND 2099),
 mapping jsonb NOT NULL,coverage jsonb NOT NULL,issues jsonb NOT NULL,state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','APPROVED','REJECTED')),
 created_by text NOT NULL,reviewed_by text,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,request_id uuid UNIQUE NOT NULL,
 CHECK(length(reason) BETWEEN 3 AND 1000),CHECK(state='DRAFT' OR reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL),
 UNIQUE(source_hash,normalized_hash)
);
CREATE TABLE public.ccee_calendar_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid NOT NULL REFERENCES public.ccee_calendar_versions(id),code text NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 160),month date NOT NULL,due_at timestamptz NOT NULL,
 source_row integer NOT NULL CHECK(source_row>0),source_sheet text NOT NULL,applicability text NOT NULL CHECK(length(applicability) BETWEEN 3 AND 500),
 UNIQUE(version_id,code),CHECK(extract(day from month)=1)
);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['ccee_integration_jobs','ccee_integration_events','ccee_calendar_versions','ccee_calendar_items'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END$$;
CREATE TRIGGER ccee_events_immutable BEFORE UPDATE OR DELETE ON public.ccee_integration_events FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER ccee_calendar_items_immutable BEFORE UPDATE OR DELETE ON public.ccee_calendar_items FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER ccee_calendar_versions_immutable BEFORE UPDATE OR DELETE ON public.ccee_calendar_versions FOR EACH ROW WHEN(OLD.state<>'DRAFT') EXECUTE FUNCTION public.acl_preserve_record();

CREATE FUNCTION public.assert_ccee_data_actor(p_org text,p_actor text,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE role_name text; perms jsonb; permission text;
BEGIN
 IF p_action NOT IN ('view','manage','review') OR nullif(p_org,'') IS NULL OR nullif(p_actor,'') IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL)
 OR (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND free_market_management AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE)) THEN RAISE EXCEPTION 'CCEE scope/license unavailable' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN PERFORM public.assert_license_platform_actor(p_actor::uuid);RETURN;END IF;
 SELECT r.name,r.permissions INTO role_name,perms FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';
 permission:=CASE p_action WHEN 'view' THEN 'f5364101-4486-42c2-a90f-807937ac3011' WHEN 'manage' THEN 'f5364101-4486-42c2-a90f-807937ac3012' ELSE 'f5364101-4486-42c2-a90f-807937ac3013' END;
 IF role_name IS NULL OR role_name NOT IN ('admin_org','gestor','operacional') OR NOT COALESCE(perms?'f5364101-4486-42c2-a90f-807937ac3011',false) OR NOT COALESCE(perms?permission,false) OR(p_action='review' AND role_name NOT IN ('admin_org','gestor')) THEN RAISE EXCEPTION 'CCEE data permission denied' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION public.assert_ccee_data_binding(p_org text,p_id uuid,p_month date,p_service text DEFAULT 'MEASUREMENTS') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.ccee_unit_authorizations;
BEGIN
 SELECT * INTO a FROM public.ccee_unit_authorizations WHERE id=p_id AND organization_id=p_org;
 IF a.id IS NULL OR a.status<>'APPROVED' OR a.reviewed_by IS NULL OR a.reviewed_by=a.created_by OR a.valid_from IS NULL OR(p_service='MEASUREMENTS' AND a.principal_profile_code IS NULL) OR a.representation_kind IS NULL
 OR a.valid_from>p_month OR a.valid_to IS NOT NULL AND a.valid_to<(p_month+interval '1 month'-interval '1 day')::date
 OR p_service NOT IN('POINTS','MEASUREMENTS','AGENDA') OR NOT(a.service_scope?p_service)
 OR EXISTS(SELECT 1 FROM public.ccee_unit_authorizations newer WHERE newer.organization_id=p_org AND newer.consumer_unit_id=a.consumer_unit_id AND newer.revision>a.revision)
 OR NOT EXISTS(SELECT 1 FROM public.customers c JOIN public.consumer_units u ON u.organization_id=c.organization_id AND u.customer_id=c.id WHERE c.organization_id=p_org AND c.id=a.customer_id AND u.id=a.consumer_unit_id AND c.deleted_at IS NULL AND c.status='ACTIVE' AND u.status='ACTIVE')
 THEN RAISE EXCEPTION 'CCEE reviewed binding not current' USING ERRCODE='42501';END IF;
 RETURN to_jsonb(a);
END$$;

CREATE FUNCTION public.ccee_data_action(p_org text,p_actor text,p_action text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.ccee_unit_authorizations;previous public.ccee_integration_events;j public.ccee_integration_jobs;
 req uuid;unit_id text;payload jsonb;binding jsonb;result jsonb;pg integer;target date;next_revision integer;status text;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,CASE WHEN p_action IN ('list','history','job','calendar') THEN 'view' WHEN p_action IN ('approve_binding','revoke_binding') THEN 'review' ELSE 'manage' END);
 IF p_action NOT IN ('list','history','job','calendar','binding','approve_binding','revoke_binding','enqueue','cancel','preparation') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>12000 THEN RAISE EXCEPTION 'Invalid CCEE action' USING ERRCODE='22023';END IF;
 IF p_action IN ('list','history','calendar') THEN
  pg:=COALESCE((p_body->>'page')::integer,0);IF pg<0 OR pg>1000 OR p_body-ARRAY['page','month','versionId']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023';END IF;
  IF p_action='list' THEN
   RETURN jsonb_build_object('organizationId',p_org,'page',pg,
    'bindings',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]') FROM(SELECT * FROM public.ccee_unit_authorizations WHERE organization_id=p_org ORDER BY created_at DESC,id LIMIT 25 OFFSET pg*25)x),
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

CREATE FUNCTION public.ccee_claim_reading(p_private boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_integration_jobs;b jsonb;
BEGIN
 -- Interrupted reads are never silently resumed or transmitted again.
 FOR j IN UPDATE public.ccee_integration_jobs SET state='FAILED',error_code='LEASE_EXPIRED',finished_at=now() WHERE state='RUNNING' AND lease_until<now() RETURNING * LOOP
  INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,details)VALUES(j.organization_id,j.id,j.actor_id,'LEASE_EXPIRED','{}');
 END LOOP;
 SELECT * INTO j FROM public.ccee_integration_jobs WHERE state='QUEUED' AND(kind='PLD' OR p_private IS TRUE) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF j.id IS NULL THEN RETURN NULL;END IF;
 BEGIN
  PERFORM public.assert_ccee_data_actor(j.organization_id,j.actor_id,'manage');IF j.authorization_id IS NOT NULL THEN b:=public.assert_ccee_data_binding(j.organization_id,j.authorization_id,j.month,j.kind);END IF;
 EXCEPTION WHEN insufficient_privilege THEN
  UPDATE public.ccee_integration_jobs SET state='FAILED',error_code='ACCESS_REVOKED',finished_at=now() WHERE id=j.id;
  INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,details)VALUES(j.organization_id,j.id,j.actor_id,'ACCESS_REVOKED','{}');RETURN NULL;
 END;
 UPDATE public.ccee_integration_jobs SET state='RUNNING',lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes' WHERE id=j.id RETURNING * INTO j;
 INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,details)VALUES(j.organization_id,j.id,j.actor_id,'READ_STARTED','{}');
 RETURN to_jsonb(j)||jsonb_build_object('binding',b);
END$$;
CREATE FUNCTION public.ccee_assert_reading(p_id uuid,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_integration_jobs;b jsonb;
BEGIN
 SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=p_id AND state='RUNNING' AND lease_id=p_lease AND lease_until>now();
 IF j.id IS NULL THEN RAISE EXCEPTION 'Reading lease unavailable' USING ERRCODE='42501';END IF;
 PERFORM public.assert_ccee_data_actor(j.organization_id,j.actor_id,'manage');IF j.authorization_id IS NOT NULL THEN b:=public.assert_ccee_data_binding(j.organization_id,j.authorization_id,j.month,j.kind);END IF;
 RETURN to_jsonb(j)||jsonb_build_object('binding',b);
END$$;
CREATE FUNCTION public.ccee_finish_reading(p_id uuid,p_lease uuid,p_result jsonb,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_integration_jobs;b jsonb;r jsonb;
BEGIN
 SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.state<>'RUNNING' OR j.lease_id IS DISTINCT FROM p_lease OR j.lease_until<=now() THEN RAISE EXCEPTION 'Reading changed' USING ERRCODE='40001';END IF;
 IF p_error IS NOT NULL THEN
  IF p_error!~'^[A-Z_]{3,80}$' THEN RAISE EXCEPTION 'Invalid error code' USING ERRCODE='22023';END IF;
  IF p_result IS NOT NULL AND(jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>12000 OR p_result-ARRAY['requests','bytes','durationMs','hashes','transactions','httpStatus']<>'{}'::jsonb) THEN RAISE EXCEPTION 'Only bounded failure metrics allowed' USING ERRCODE='22023';END IF;
  UPDATE public.ccee_integration_jobs SET state='FAILED',error_code=p_error,requests=COALESCE((p_result->>'requests')::integer,0),bytes=COALESCE((p_result->>'bytes')::bigint,0),duration_ms=(p_result->>'durationMs')::integer,finished_at=now() WHERE id=j.id;
 ELSE
  PERFORM public.ccee_assert_reading(p_id,p_lease);
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>2097152 OR jsonb_typeof(p_result->'complete') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_result->'hashes') IS DISTINCT FROM 'array' OR p_result-ARRAY['complete','requests','bytes','durationMs','hashes','transactions','data','record']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid reading result' USING ERRCODE='22023';END IF;
  IF j.authorization_id IS NOT NULL THEN b:=public.assert_ccee_data_binding(j.organization_id,j.authorization_id,j.month,j.kind);END IF;
  IF p_result?'record' THEN
   r:=p_result->'record';
   IF j.kind<>'MEASUREMENTS' OR r->>'kind'<>'CONSUMPTION' OR r->>'schemaVersion'<>'ccee-record/1' OR r->'binding'->>'organizationId' IS DISTINCT FROM j.organization_id OR r->'binding'->>'authorizationId' IS DISTINCT FROM j.authorization_id::text OR r->'binding'->>'authorizationRevision' IS DISTINCT FROM b->>'revision' OR r->'binding'->>'unitId' IS DISTINCT FROM b->>'consumer_unit_id' OR r->'binding'->>'customerId' IS DISTINCT FROM b->>'customer_id' OR r->'binding'->>'profileCode' IS DISTINCT FROM b->>'profile_code' OR r->'binding'->>'measurementPoint' IS DISTINCT FROM b->>'measurement_point' OR r->'evidence'->>'month' IS DISTINCT FROM to_char(j.month,'YYYY-MM') THEN RAISE EXCEPTION 'Reading binding mismatch' USING ERRCODE='42501';END IF;
   INSERT INTO public.ccee_normalized_intake(organization_id,customer_id,consumer_unit_id,authorization_id,authorization_revision,kind,service,external_id,provider_revision,month,finality,source_hash,normalized_payload,state,retrieved_at)
   VALUES(j.organization_id,b->>'customer_id',b->>'consumer_unit_id',j.authorization_id,(b->>'revision')::integer,'CONSUMPTION',r->'evidence'->>'service',r->'evidence'->>'externalId',r->'evidence'->>'revision',j.month,r->'evidence'->>'finality',r->'evidence'->>'sourceHash',r,'PENDING',(r->'evidence'->>'retrievedAt')::timestamptz) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.ccee_integration_jobs SET state=CASE WHEN p_result->'complete'='true'::jsonb THEN 'SUCCEEDED' ELSE 'PARTIAL' END,result=p_result,requests=(p_result->>'requests')::integer,bytes=(p_result->>'bytes')::bigint,duration_ms=(p_result->>'durationMs')::integer,finished_at=now() WHERE id=j.id;
 END IF;
 INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,details)VALUES(j.organization_id,j.id,j.actor_id,CASE WHEN p_error IS NULL THEN 'READ_FINISHED' ELSE 'READ_FAILED' END,jsonb_build_object('errorCode',p_error,'httpStatus',p_result->'httpStatus','complete',p_result->'complete','transactions',p_result->'transactions','hashes',p_result->'hashes'));
 RETURN jsonb_build_object('recorded',true);
END$$;

CREATE FUNCTION public.ccee_calendar_action(p_actor uuid,p_action text,p_id uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE profile text;v public.ccee_calendar_versions;x jsonb;r jsonb;pg integer;req uuid;
BEGIN
 profile:=public.platform_workflow_actor(p_actor,'82e7fc71-479a-4dd6-8b22-4fba6eaa6841');
 IF profile IS DISTINCT FROM 'OWNER' OR p_action NOT IN('list','create','approve','reject') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>2097152 THEN RAISE EXCEPTION 'Calendar owner action unavailable' USING ERRCODE='42501';END IF;
 IF p_action='list' THEN
  pg:=COALESCE((p_body->>'page')::integer,0);IF pg NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('page',pg,'versions',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]')FROM(SELECT * FROM public.ccee_calendar_versions ORDER BY created_at DESC,id LIMIT 10 OFFSET pg*10)t),'items',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.source_row),'[]')FROM(SELECT * FROM public.ccee_calendar_items WHERE version_id=p_id ORDER BY source_row,id LIMIT 25 OFFSET pg*25)t),
   'differences',(SELECT jsonb_build_object('comparedWith',older.id,
    'added',(SELECT count(*) FROM public.ccee_calendar_items n WHERE n.version_id=current.id AND NOT EXISTS(SELECT 1 FROM public.ccee_calendar_items o WHERE o.version_id=older.id AND o.code=n.code)),
    'removed',(SELECT count(*) FROM public.ccee_calendar_items o WHERE o.version_id=older.id AND NOT EXISTS(SELECT 1 FROM public.ccee_calendar_items n WHERE n.version_id=current.id AND n.code=o.code)),
    'deadlinesChanged',(SELECT count(*) FROM public.ccee_calendar_items n JOIN public.ccee_calendar_items o ON o.code=n.code WHERE n.version_id=current.id AND o.version_id=older.id AND n.due_at<>o.due_at))
    FROM public.ccee_calendar_versions current LEFT JOIN LATERAL(SELECT id FROM public.ccee_calendar_versions WHERE source_url=current.source_url AND state='APPROVED' AND created_at<current.created_at ORDER BY created_at DESC,id LIMIT 1)older ON true WHERE current.id=p_id));
 END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(req::text,193));
 SELECT details INTO r FROM public.ccee_integration_events WHERE organization_id IS NULL AND details->>'requestId'=req::text AND event LIKE 'CALENDAR_%' LIMIT 1;
 IF FOUND THEN
  IF r->>'actor' IS DISTINCT FROM p_actor::text OR r->>'action' IS DISTINCT FROM p_action OR r->>'requestHash' IS DISTINCT FROM md5(p_body::text) THEN RAISE EXCEPTION 'Calendar request changed' USING ERRCODE='40001';END IF;
  SELECT * INTO v FROM public.ccee_calendar_versions WHERE id=(r->>'id')::uuid;RETURN to_jsonb(v);
 END IF;
 IF p_action='create' THEN
  IF p_body->>'sourceUrl'!~'^https://www[.]ccee[.]org[.]br/(documents/|o/ccee/documentos/)[A-Za-z0-9%_./() -]+$' OR p_body-ARRAY['requestId','sourceUrl','sourceHash','normalizedHash','year','mapping','coverage','issues','items','reason']<>'{}'::jsonb OR jsonb_typeof(p_body->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'items')>5000 OR jsonb_typeof(p_body->'issues') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid calendar' USING ERRCODE='22023';END IF;
  SELECT * INTO v FROM public.ccee_calendar_versions WHERE request_id=req;
  IF FOUND THEN IF v.source_hash IS DISTINCT FROM p_body->>'sourceHash' OR v.normalized_hash IS DISTINCT FROM p_body->>'normalizedHash' OR v.created_by<>p_actor::text THEN RAISE EXCEPTION 'Calendar request changed' USING ERRCODE='40001';END IF;RETURN to_jsonb(v);END IF;
  INSERT INTO public.ccee_calendar_versions(source_url,source_hash,normalized_hash,year,mapping,coverage,issues,created_by,reason,request_id)
  VALUES(p_body->>'sourceUrl',p_body->>'sourceHash',p_body->>'normalizedHash',(p_body->>'year')::integer,p_body->'mapping',p_body->'coverage',p_body->'issues',p_actor::text,p_body->>'reason',req) RETURNING * INTO v;
  FOR x IN SELECT value FROM jsonb_array_elements(p_body->'items') LOOP
   INSERT INTO public.ccee_calendar_items(version_id,code,title,month,due_at,source_row,source_sheet,applicability)VALUES(v.id,x->>'code',x->>'title',((x->>'month')||'-01')::date,(x->>'dueAt')::timestamptz,(x->>'sourceRow')::integer,x->>'sourceSheet',x->>'applicability');
  END LOOP;
 ELSE
  SELECT * INTO v FROM public.ccee_calendar_versions WHERE id=p_id FOR UPDATE;
  IF v.id IS NULL OR v.created_by=p_actor::text OR COALESCE(length(p_body->>'reason'),0) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Independent calendar review required' USING ERRCODE='42501';END IF;
  IF v.state<>'DRAFT' THEN RAISE EXCEPTION 'Calendar preserved' USING ERRCODE='40001';END IF;
  IF p_action='approve' AND(jsonb_array_length(v.issues)>0 OR NOT EXISTS(SELECT 1 FROM public.ccee_calendar_items WHERE version_id=v.id)) THEN RAISE EXCEPTION 'Calendar coverage requires review' USING ERRCODE='22023';END IF;
  UPDATE public.ccee_calendar_versions SET state=CASE WHEN p_action='approve' THEN 'APPROVED' ELSE 'REJECTED' END,reviewed_by=p_actor::text,reviewed_at=now() WHERE id=v.id RETURNING * INTO v;
 END IF;
 INSERT INTO public.ccee_integration_events(actor_id,event,details)VALUES(p_actor::text,'CALENDAR_'||upper(p_action),jsonb_build_object('id',v.id,'hash',v.normalized_hash,'reason',p_body->>'reason','requestId',req,'actor',p_actor,'action',p_action,'requestHash',md5(p_body::text)));RETURN to_jsonb(v);
END$$;

CREATE FUNCTION public.ccee_prepare_data_monthly(p_org text,p_actor text,p_job uuid,p_request uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_integration_jobs;b jsonb;r jsonb;u public.consumer_units;saved public.calculation_monthly_inputs;prior public.calculation_monthly_inputs;e public.ccee_integration_events;payload jsonb;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'manage');
 IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles rr ON rr.id=m.role_id AND rr.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND rr.permissions?'fd8a932f-87c0-4f86-8389-9f30c50e95b7') THEN RAISE EXCEPTION 'Monthly management permission required' USING ERRCODE='42501';END IF;
 IF p_request IS NULL OR COALESCE(length(p_reason),0) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||p_request::text,191));
 payload:=jsonb_build_object('job',p_job,'actor',p_actor,'reason',p_reason);
 SELECT * INTO e FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF e.event<>'MONTHLY_DRAFT' OR e.details->'request'<>payload THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001';END IF;RETURN e.details->'result';END IF;
 SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=p_job AND organization_id=p_org;
 IF j.id IS NULL OR j.kind<>'MEASUREMENTS' OR j.state<>'SUCCEEDED' OR j.measurement_kind<>'FINAL' THEN RAISE EXCEPTION 'Complete final reading required' USING ERRCODE='42501';END IF;
 SELECT * INTO u FROM public.consumer_units WHERE id=(SELECT consumer_unit_id FROM public.ccee_unit_authorizations WHERE id=j.authorization_id) AND organization_id=p_org;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||u.id,192));b:=public.assert_ccee_data_binding(p_org,j.authorization_id,j.month);r:=j.result->'record';
 IF b->>'measurement_basis' IS DISTINCT FROM 'NO_LOSSES' OR r->'evidence'->>'finality' IS DISTINCT FROM 'FINAL' OR r->'binding'->>'authorizationId' IS DISTINCT FROM j.authorization_id::text OR r->'binding'->>'authorizationRevision' IS DISTINCT FROM b->>'revision' OR NOT COALESCE(r->'lines'->0->>'quantityKwh'~'^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$',false) THEN RAISE EXCEPTION 'Measurement basis requires reconciliation' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||u.id||':'||to_char(j.month,'YYYY-MM'),134));
 SELECT * INTO prior FROM public.calculation_monthly_inputs WHERE organization_id=p_org AND consumer_unit_id=u.id AND month=to_char(j.month,'YYYY-MM') ORDER BY version DESC LIMIT 1;
 IF prior.id IS NOT NULL AND prior.status<>'VALIDATED' THEN RAISE EXCEPTION 'Existing draft preserved; reconcile in monthly module' USING ERRCODE='40001';END IF;
 INSERT INTO public.calculation_monthly_inputs(organization_id,customer_id,consumer_unit_id,month,previous_id,measurements,source_reference,notes,correction_reason,unit_context,created_by,updated_by)
 VALUES(p_org,u.customer_id,u.id,to_char(j.month,'YYYY-MM'),prior.id,
 jsonb_build_object('consumptionTotal',r->'lines'->0->>'quantityKwh','consumptionPeak',NULL,'consumptionOffPeak',NULL,'demandSingle',NULL,'demandPeak',NULL,'demandOffPeak',NULL,'reactiveTotal',NULL),
 'CCEE · ListarMedidaBSv1 · execução '||j.id||' · SHA-256 '||(r->'evidence'->>'sourceHash'),
 'Consumo CCEE para conciliação com a fatura. Ponta/fora-ponta, demanda e reativos faturados não foram inferidos. Versões anteriores preservadas.',p_reason,
 jsonb_build_object('distributor',to_jsonb(u)->'distributor','tariff_group',to_jsonb(u)->'tariff_group','tariff_subgroup',to_jsonb(u)->'tariff_subgroup','tariff_modality',to_jsonb(u)->'tariff_modality','state',to_jsonb(u)->'state','free_market',to_jsonb(u)->'free_market'),p_actor,p_actor) RETURNING * INTO saved;
 payload:=jsonb_build_object('request',payload,'result',jsonb_build_object('inputId',saved.id,'status',saved.status,'version',saved.version));
 INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,request_id,details)VALUES(p_org,j.id,p_actor,'MONTHLY_DRAFT',p_request,payload);RETURN payload->'result';
END$$;
CREATE FUNCTION public.ccee_apply_calendar(p_org text,p_actor text,p_version uuid,p_item uuid,p_binding uuid,p_responsible text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v public.ccee_calendar_versions;i public.ccee_calendar_items;b jsonb;req uuid;d jsonb;r jsonb;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'manage');
 SELECT * INTO v FROM public.ccee_calendar_versions WHERE id=p_version AND state='APPROVED' FOR SHARE;
 SELECT * INTO i FROM public.ccee_calendar_items WHERE id=p_item AND version_id=p_version;
 IF v.id IS NULL OR i.id IS NULL OR EXISTS(SELECT 1 FROM public.ccee_calendar_versions WHERE source_url=v.source_url AND state='APPROVED' AND created_at>v.created_at) OR i.due_at<=now() OR COALESCE(length(p_reason),0) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Calendar source changed or overdue' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||(SELECT consumer_unit_id FROM public.ccee_unit_authorizations WHERE id=p_binding AND organization_id=p_org),192));
 b:=public.assert_ccee_data_binding(p_org,p_binding,i.month,'AGENDA');
 req:=md5(p_org||p_version::text||p_item::text||p_binding::text)::uuid;
 d:=jsonb_build_object('requestId',req,'revision',0,'reason',p_reason,'title',i.title,'description','Fonte CCEE: '||v.source_url||' · versão '||v.id||' · linha '||i.source_row||' · SHA-256 '||v.source_hash||'. Aplicabilidade conferida pelo operador: '||i.applicability||'. Não comprova cumprimento da obrigação na CCEE.','priority','HIGH','customerId',b->>'customer_id','unitId',b->>'consumer_unit_id','responsibleId',p_responsible,'startsAt',i.due_at,'endsAt',NULL,'dueAt',i.due_at);
 -- Reuse authoritative Operations RBAC, responsible membership, ACL, license and idempotency in the same transaction.
 r:=public.save_operation_record(p_org,p_actor,'agenda',NULL,req,0,p_reason,d);
 IF NOT EXISTS(SELECT 1 FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=req) THEN INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details)VALUES(p_org,p_actor,'CALENDAR_ASSIGNED',req,jsonb_build_object('versionId',v.id,'itemId',i.id,'bindingId',p_binding));END IF;
 RETURN r;
END$$;
CREATE FUNCTION public.ccee_data_metrics(p_actor uuid,p_month date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE profile text;
BEGIN
 SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
 IF profile IS NULL OR profile NOT IN('OWNER','FINANCE') THEN RAISE EXCEPTION 'Financial metrics unavailable' USING ERRCODE='42501';END IF;
 PERFORM public.platform_workflow_actor(p_actor,CASE WHEN profile='OWNER' THEN 'e23a5c98-8b68-4ed2-aef8-70a7166407e4' ELSE '699703af-10ba-43a3-8eb8-9f0d9e477498' END);
 IF extract(day from p_month)<>1 THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';END IF;
 RETURN(SELECT jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'jobs',count(*),'completed',count(*) FILTER(WHERE state='SUCCEEDED'),'partial',count(*) FILTER(WHERE state='PARTIAL'),'failed',count(*) FILTER(WHERE state='FAILED'),'requests',COALESCE(sum(requests),0),'bytes',COALESCE(sum(bytes),0),'durationMs',COALESCE(sum(duration_ms),0),'providerBillingConnected',false,'actualCostMinor',NULL,'budgetMinor',NULL) FROM public.ccee_integration_jobs WHERE created_at>=p_month AND created_at<p_month+interval '1 month');
END$$;
DO $$DECLARE f record;BEGIN
 FOR f IN SELECT p.proname,p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('assert_ccee_data_actor','assert_ccee_data_binding','ccee_data_action','ccee_claim_reading','ccee_assert_reading','ccee_finish_reading','ccee_calendar_action','ccee_prepare_data_monthly','ccee_apply_calendar','ccee_data_metrics') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.proname NOT LIKE 'assert_ccee_data_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);END IF;
 END LOOP;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
