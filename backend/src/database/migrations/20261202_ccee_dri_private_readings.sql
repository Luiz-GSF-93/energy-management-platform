-- CCEE R2A, deployed disabled. No provider calls, grants to users or financial writes.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
ALTER TABLE public.ccee_unit_authorizations ADD COLUMN dri_agent_code text CHECK(dri_agent_code~'^[0-9]{1,12}$'),ADD COLUMN dri_tax_id text CHECK(dri_tax_id~'^[0-9]{14}$');
DO $$DECLARE c record;BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.ccee_integration_jobs'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%kind%' LOOP EXECUTE format('ALTER TABLE public.ccee_integration_jobs DROP CONSTRAINT %I',c.conname);END LOOP;
END$$;
ALTER TABLE public.ccee_integration_jobs ADD CONSTRAINT ccee_job_kind_r2a CHECK(kind IN('POINTS','MEASUREMENTS','PLD','DRI_EVENTS','DRI_REPORTS','DRI_RESULTS')),
 ADD CONSTRAINT ccee_job_scope_r2a CHECK((kind='PLD' AND authorization_id IS NULL AND measurement_kind IS NULL) OR(kind IN('POINTS','DRI_EVENTS','DRI_REPORTS','DRI_RESULTS') AND authorization_id IS NOT NULL AND measurement_kind IS NULL) OR(kind='MEASUREMENTS' AND authorization_id IS NOT NULL AND measurement_kind IS NOT NULL));
CREATE TABLE public.ccee_dri_catalog_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),authorization_id uuid NOT NULL REFERENCES public.ccee_unit_authorizations(id),job_id uuid UNIQUE NOT NULL REFERENCES public.ccee_integration_jobs(id),
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),month date NOT NULL,kind text NOT NULL CHECK(kind IN('DRI_EVENTS','DRI_REPORTS')),payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=2097152),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ccee_dri_result_snapshots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),authorization_id uuid NOT NULL REFERENCES public.ccee_unit_authorizations(id),job_id uuid UNIQUE NOT NULL REFERENCES public.ccee_integration_jobs(id),
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),month date NOT NULL,scope text NOT NULL DEFAULT 'PARTICIPANT' CHECK(scope='PARTICIPANT'),financial_state text NOT NULL DEFAULT 'UNMAPPED_REVIEW_REQUIRED' CHECK(financial_state='UNMAPPED_REVIEW_REQUIRED'),payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=2097152),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ccee_dri_catalog_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ccee_dri_result_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_dri_catalog_versions,public.ccee_dri_result_snapshots FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ccee_dri_catalog_scope ON public.ccee_dri_catalog_versions(organization_id,authorization_id,month);
CREATE INDEX ccee_dri_result_scope ON public.ccee_dri_result_snapshots(organization_id,authorization_id,month);
CREATE TRIGGER ccee_dri_catalog_immutable BEFORE UPDATE OR DELETE ON public.ccee_dri_catalog_versions FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER ccee_dri_results_immutable BEFORE UPDATE OR DELETE ON public.ccee_dri_result_snapshots FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();

CREATE OR REPLACE FUNCTION public.assert_ccee_data_binding(p_org text,p_id uuid,p_month date,p_service text DEFAULT 'MEASUREMENTS') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.ccee_unit_authorizations;
BEGIN
 SELECT * INTO a FROM public.ccee_unit_authorizations WHERE id=p_id AND organization_id=p_org;
 IF a.id IS NULL OR a.status<>'APPROVED' OR a.reviewed_by IS NULL OR a.reviewed_by=a.created_by OR a.valid_from IS NULL OR(p_service='MEASUREMENTS' AND a.principal_profile_code IS NULL) OR a.representation_kind IS NULL
 OR a.valid_from>p_month OR a.valid_to IS NOT NULL AND a.valid_to<(p_month+interval '1 month'-interval '1 day')::date
 OR p_service NOT IN('POINTS','MEASUREMENTS','AGENDA','DRI_READ','DRI_EVENTS','DRI_REPORTS','DRI_RESULTS') OR NOT(a.service_scope?CASE WHEN p_service LIKE 'DRI_%' THEN 'DRI_READ' ELSE p_service END)
 OR EXISTS(SELECT 1 FROM public.ccee_unit_authorizations newer WHERE newer.organization_id=p_org AND newer.consumer_unit_id=a.consumer_unit_id AND newer.revision>a.revision)
 OR NOT EXISTS(SELECT 1 FROM public.customers c JOIN public.consumer_units u ON u.organization_id=c.organization_id AND u.customer_id=c.id WHERE c.organization_id=p_org AND c.id=a.customer_id AND u.id=a.consumer_unit_id AND c.deleted_at IS NULL AND c.status='ACTIVE' AND u.status='ACTIVE')
 THEN RAISE EXCEPTION 'CCEE reviewed binding not current' USING ERRCODE='42501';END IF;
 IF p_service LIKE 'DRI_%' AND(a.dri_agent_code IS NULL OR a.dri_tax_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.id=a.customer_id AND c.organization_id=p_org AND regexp_replace(c.document,'[^0-9]','','g')=a.dri_tax_id)) THEN RAISE EXCEPTION 'Explicit DRI participant evidence required' USING ERRCODE='42501';END IF;
 RETURN to_jsonb(a);
END$$;
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
  IF jsonb_typeof(p_body->'serviceScope') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'serviceScope') NOT BETWEEN 1 AND 4 OR NOT(p_body->'serviceScope'<@'["POINTS","MEASUREMENTS","AGENDA","DRI_READ"]'::jsonb) OR(p_body->'serviceScope'?'MEASUREMENTS' AND nullif(p_body->>'principalProfileCode','') IS NULL) THEN RAISE EXCEPTION 'Explicit service scope required' USING ERRCODE='22023';END IF;
  IF p_body-ARRAY['requestId','customerId','unitId','profileCode','principalProfileCode','measurementPoint','meterCode','representationKind','serviceScope','validFrom','validTo','measurementBasis','evidenceReference','reason','driAgentCode','driTaxId']<>'{}'::jsonb OR p_body->>'profileCode'!~'^\d{1,12}$' OR nullif(p_body->>'principalProfileCode','') IS NOT NULL AND p_body->>'principalProfileCode'!~'^\d{1,12}$' OR p_body->>'measurementPoint'!~'^[-A-Za-z0-9_]{1,100}$' OR p_body->>'representationKind' NOT IN('TOTAL','PARTIAL') OR p_body->>'measurementBasis' NOT IN('UNKNOWN','NO_LOSSES','WITH_LOSSES') OR COALESCE(length(p_body->>'reason'),0) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid binding' USING ERRCODE='22023';END IF;
  IF p_body->'serviceScope'?'DRI_READ' AND (NOT COALESCE(p_body->>'driAgentCode'~'^[0-9]{1,12}$',false) OR NOT COALESCE(p_body->>'driTaxId'~'^[0-9]{14}$',false) OR NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.id=p_body->>'customerId' AND c.organization_id=p_org AND regexp_replace(c.document,'[^0-9]','','g')=p_body->>'driTaxId')) THEN RAISE EXCEPTION 'Explicit DRI participant evidence required' USING ERRCODE='22023';END IF;
  unit_id:=p_body->>'unitId';PERFORM pg_advisory_xact_lock(hashtextextended(p_org||unit_id,192));
  SELECT COALESCE(max(revision),0)+1 INTO next_revision FROM public.ccee_unit_authorizations WHERE organization_id=p_org AND consumer_unit_id=unit_id;
  INSERT INTO public.ccee_unit_authorizations(organization_id,customer_id,consumer_unit_id,profile_code,principal_profile_code,measurement_point,meter_code,revision,status,evidence_reference,created_by,valid_from,valid_to,representation_kind,service_scope,measurement_basis,dri_agent_code,dri_tax_id)
  VALUES(p_org,p_body->>'customerId',unit_id,p_body->>'profileCode',nullif(p_body->>'principalProfileCode',''),p_body->>'measurementPoint',nullif(p_body->>'meterCode',''),next_revision,'DRAFT',p_body->>'evidenceReference',p_actor,(p_body->>'validFrom')::date,nullif(p_body->>'validTo','')::date,p_body->>'representationKind',p_body->'serviceScope',p_body->>'measurementBasis',nullif(p_body->>'driAgentCode',''),nullif(p_body->>'driTaxId','')) RETURNING * INTO a;
  IF a.valid_from IS NULL THEN RAISE EXCEPTION 'Validity required' USING ERRCODE='22023';END IF;result:=to_jsonb(a);
 ELSIF p_action IN ('approve_binding','revoke_binding') THEN
  SELECT * INTO a FROM public.ccee_unit_authorizations WHERE id=p_id AND organization_id=p_org;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Binding unavailable' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org||a.consumer_unit_id,192));
  IF p_body-ARRAY['requestId','revision','reason']<>'{}'::jsonb OR (p_body->>'revision')::integer IS DISTINCT FROM a.revision OR COALESCE(length(p_body->>'reason'),0) NOT BETWEEN 3 AND 500 OR EXISTS(SELECT 1 FROM public.ccee_unit_authorizations WHERE organization_id=p_org AND consumer_unit_id=a.consumer_unit_id AND revision>a.revision) THEN RAISE EXCEPTION 'Binding revision changed' USING ERRCODE='40001';END IF;
  IF a.created_by=p_actor OR(p_action='approve_binding' AND a.status<>'DRAFT') OR(p_action='revoke_binding' AND a.status='REVOKED') THEN RAISE EXCEPTION 'Independent review required' USING ERRCODE='42501';END IF;
  IF p_action='approve_binding' AND(a.valid_from IS NULL OR a.representation_kind IS NULL OR jsonb_array_length(a.service_scope)=0 OR(a.service_scope?'MEASUREMENTS' AND a.principal_profile_code IS NULL)) THEN RAISE EXCEPTION 'Prepare explicit validity and scope before review' USING ERRCODE='22023';END IF;
  status:=CASE WHEN p_action='approve_binding' THEN 'APPROVED' ELSE 'REVOKED' END;
  INSERT INTO public.ccee_unit_authorizations(organization_id,customer_id,consumer_unit_id,profile_code,principal_profile_code,measurement_point,meter_code,revision,status,evidence_reference,created_by,reviewed_by,reviewed_at,valid_from,valid_to,representation_kind,service_scope,measurement_basis,dri_agent_code,dri_tax_id)
  VALUES(p_org,a.customer_id,a.consumer_unit_id,a.profile_code,a.principal_profile_code,a.measurement_point,a.meter_code,a.revision+1,status,a.evidence_reference,a.created_by,p_actor,now(),a.valid_from,a.valid_to,a.representation_kind,a.service_scope,a.measurement_basis,a.dri_agent_code,a.dri_tax_id) RETURNING * INTO a;
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
CREATE OR REPLACE FUNCTION public.ccee_claim_reading(p_private boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_integration_jobs;b jsonb;
BEGIN
 -- Interrupted reads are never silently resumed or transmitted again.
 FOR j IN UPDATE public.ccee_integration_jobs SET state='FAILED',error_code='LEASE_EXPIRED',finished_at=now() WHERE state='RUNNING' AND lease_until<now() RETURNING * LOOP
  INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,details)VALUES(j.organization_id,j.id,j.actor_id,'LEASE_EXPIRED','{}');
 END LOOP;
 SELECT * INTO j FROM public.ccee_integration_jobs WHERE state='QUEUED' AND kind NOT LIKE 'DRI_%' AND(kind='PLD' OR p_private IS TRUE) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
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

CREATE FUNCTION public.ccee_dri_action(p_org text,p_actor text,p_action text,p_id uuid,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;j public.ccee_integration_jobs;parent public.ccee_integration_jobs;target date;req uuid;e public.ccee_integration_events;result jsonb;f jsonb;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,CASE WHEN p_action='enqueue' THEN 'manage' ELSE 'view' END);
 IF p_action NOT IN('list','job','enqueue','context') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>12000 THEN RAISE EXCEPTION 'Invalid DRI action' USING ERRCODE='22023';END IF;
 IF p_action='job' THEN
  SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=p_id AND organization_id=p_org AND kind LIKE 'DRI_%';
  IF j.id IS NULL THEN RAISE EXCEPTION 'DRI job unavailable' USING ERRCODE='42501';END IF;
  b:=public.assert_ccee_data_binding(p_org,j.authorization_id,j.month,'DRI_READ');RETURN jsonb_build_object('organizationId',p_org,'job',to_jsonb(j),'binding',b);
 END IF;
 IF NOT COALESCE(p_body->>'month'~'^20[0-9]{2}-(0[1-9]|1[0-2])$',false) THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';END IF;
 target:=((p_body->>'month')||'-01')::date;IF target<'2021-01-01' OR target>=date_trunc('month',now())::date THEN RAISE EXCEPTION 'Closed month required' USING ERRCODE='22023';END IF;
 IF p_action='context' THEN
  SELECT to_jsonb(a) INTO b FROM public.ccee_unit_authorizations a WHERE a.organization_id=p_org AND a.consumer_unit_id=p_id::text ORDER BY revision DESC LIMIT 1;
  IF b IS NULL THEN RETURN jsonb_build_object('organizationId',p_org,'rows','[]'::jsonb);END IF;
  b:=public.assert_ccee_data_binding(p_org,(b->>'id')::uuid,target,'DRI_READ');
  RETURN jsonb_build_object('organizationId',p_org,'rows',(SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT s.id,s.job_id,s.source_hash,s.month,s.scope,s.financial_state,s.created_at,j.request_payload,jsonb_path_query_array(s.payload,'$.rows[0 to 2]') AS preview_rows FROM public.ccee_dri_result_snapshots s JOIN public.ccee_integration_jobs j ON j.id=s.job_id WHERE s.organization_id=p_org AND s.authorization_id=(b->>'id')::uuid AND s.month=target ORDER BY s.created_at DESC,s.id LIMIT 5)x));
 END IF;
 b:=public.assert_ccee_data_binding(p_org,p_id,target,'DRI_READ');
 IF p_action='list' THEN
  IF p_body-ARRAY['month']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('organizationId',p_org,'jobs',(SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id,kind,month,state,error_code,requests,created_at FROM public.ccee_integration_jobs WHERE organization_id=p_org AND authorization_id=p_id AND month=target AND kind LIKE 'DRI_%' ORDER BY created_at DESC,id LIMIT 25)x));
 END IF;
 IF p_body-ARRAY['requestId','authorizationId','kind','month','parentJobId','eventCode','reportId','frameId']<>'{}'::jsonb OR p_body->>'authorizationId' IS DISTINCT FROM p_id::text OR p_body->>'kind' NOT IN('DRI_EVENTS','DRI_REPORTS','DRI_RESULTS') THEN RAISE EXCEPTION 'Invalid DRI request' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
 IF p_body->>'kind'='DRI_EVENTS' THEN
  IF p_body ?| ARRAY['parentJobId','eventCode','reportId','frameId'] THEN RAISE EXCEPTION 'Unexpected selection' USING ERRCODE='22023';END IF;
 ELSE
  IF NOT COALESCE(p_body->>'eventCode'~'^[0-9]{1,20}$',false) THEN RAISE EXCEPTION 'Select event' USING ERRCODE='22023';END IF;
  SELECT * INTO parent FROM public.ccee_integration_jobs WHERE id=(p_body->>'parentJobId')::uuid AND organization_id=p_org AND authorization_id=p_id AND month=target AND state='SUCCEEDED';
  IF parent.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.ccee_dri_catalog_versions WHERE job_id=parent.id AND authorization_id=p_id AND organization_id=p_org) THEN RAISE EXCEPTION 'Select a complete catalog' USING ERRCODE='42501';END IF;
  IF p_body->>'kind'='DRI_REPORTS' THEN
   IF parent.kind<>'DRI_EVENTS' OR p_body ?| ARRAY['reportId','frameId'] OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parent.result->'data'->'rows') x WHERE x->>'code'=p_body->>'eventCode') THEN RAISE EXCEPTION 'Event not in catalog' USING ERRCODE='22023';END IF;
  ELSE
   IF parent.kind<>'DRI_REPORTS' OR parent.request_payload->>'eventCode' IS DISTINCT FROM p_body->>'eventCode' OR NOT COALESCE(p_body->>'reportId'~'^[0-9]{1,20}$',false) OR NOT COALESCE(p_body->>'frameId'~'^[0-9]{1,20}$',false) THEN RAISE EXCEPTION 'Report not in catalog' USING ERRCODE='22023';END IF;
   SELECT frame INTO f FROM jsonb_array_elements(parent.result->'data'->'rows') r CROSS JOIN LATERAL jsonb_array_elements(r->'frames') frame WHERE r->>'id'=p_body->>'reportId' AND frame->>'id'=p_body->>'frameId' AND (r->'period'->>'start')::date<=target AND (r->'period'->>'end')::date>=(target+interval '1 month'-interval '1 day')::date;
   IF f IS NULL OR NOT(f->'parameters'?'CODIGO_AGENTE') OR NOT(f->'parameters'<@'["CODIGO_AGENTE","CODIGO_EVENTO_CONTABIL"]'::jsonb) THEN RAISE EXCEPTION 'Frame parameters require review' USING ERRCODE='22023';END IF;
  END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||req::text,191));
 SELECT * INTO e FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=req;
 IF FOUND THEN IF e.event<>'DRI_ENQUEUED' OR e.details->'request' IS DISTINCT FROM jsonb_build_object('actor',p_actor,'body',p_body) THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001';END IF;RETURN e.details->'result';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org,194));
 SELECT * INTO j FROM public.ccee_integration_jobs WHERE organization_id=p_org AND authorization_id=p_id AND request_payload-ARRAY['requestId']=p_body-ARRAY['requestId'] AND state IN('QUEUED','RUNNING') LIMIT 1;
 IF j.id IS NULL THEN
  IF(SELECT count(*) FROM public.ccee_integration_jobs WHERE organization_id=p_org AND state IN('QUEUED','RUNNING'))>=20 THEN RAISE EXCEPTION 'Queue limit' USING ERRCODE='22023';END IF;
  INSERT INTO public.ccee_integration_jobs(organization_id,actor_id,request_id,request_payload,kind,month,authorization_id) VALUES(p_org,p_actor,req,p_body,p_body->>'kind',target,p_id) RETURNING * INTO j;
 END IF;
 result:=jsonb_build_object('organizationId',p_org,'job',to_jsonb(j));
 INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,request_id,details) VALUES(p_org,j.id,p_actor,'DRI_ENQUEUED',req,jsonb_build_object('request',jsonb_build_object('actor',p_actor,'body',p_body),'result',result));RETURN result;
END$$;

CREATE FUNCTION public.ccee_claim_dri_reading() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_integration_jobs;b jsonb;p jsonb;
BEGIN
 SELECT * INTO j FROM public.ccee_integration_jobs WHERE state='QUEUED' AND kind LIKE 'DRI_%' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF j.id IS NULL THEN RETURN NULL;END IF;
 BEGIN PERFORM public.assert_ccee_data_actor(j.organization_id,j.actor_id,'manage');b:=public.assert_ccee_data_binding(j.organization_id,j.authorization_id,j.month,'DRI_READ');
 EXCEPTION WHEN insufficient_privilege THEN UPDATE public.ccee_integration_jobs SET state='FAILED',error_code='ACCESS_REVOKED',finished_at=now() WHERE id=j.id;INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event)VALUES(j.organization_id,j.id,j.actor_id,'ACCESS_REVOKED');RETURN NULL;END;
 IF j.kind='DRI_RESULTS' THEN SELECT frame->'parameters' INTO p FROM public.ccee_integration_jobs parent CROSS JOIN LATERAL jsonb_array_elements(parent.result->'data'->'rows') r CROSS JOIN LATERAL jsonb_array_elements(r->'frames') frame WHERE parent.id=(j.request_payload->>'parentJobId')::uuid AND parent.organization_id=j.organization_id AND parent.authorization_id=j.authorization_id AND parent.state='SUCCEEDED' AND r->>'id'=j.request_payload->>'reportId' AND frame->>'id'=j.request_payload->>'frameId';END IF;
 UPDATE public.ccee_integration_jobs SET state='RUNNING',lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes' WHERE id=j.id RETURNING * INTO j;
 INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event)VALUES(j.organization_id,j.id,j.actor_id,'READ_STARTED');
 RETURN to_jsonb(j)||jsonb_build_object('binding',b,'dri_parameters',COALESCE(p,'[]'::jsonb));
END$$;

CREATE FUNCTION public.ccee_finish_dri_reading(p_id uuid,p_lease uuid,p_result jsonb,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_integration_jobs;d jsonb;b jsonb;r jsonb;tax_column integer;
BEGIN
 SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=p_id FOR UPDATE;
 IF j.kind NOT LIKE 'DRI_%' OR j.id IS NULL THEN RAISE EXCEPTION 'DRI job required' USING ERRCODE='42501';END IF;
 -- The existing finish routine rechecks lease, RBAC, license and current authorization, with no normalized financial record.
 d:=public.ccee_finish_reading(p_id,p_lease,p_result,p_error);
 IF p_error IS NULL THEN
  b:=public.assert_ccee_data_binding(j.organization_id,j.authorization_id,j.month,'DRI_READ');
  IF p_result?'record' OR p_result->'complete' IS DISTINCT FROM 'true'::jsonb OR p_result->'data'->>'kind' IS DISTINCT FROM j.kind OR p_result->'data'->>'month' IS DISTINCT FROM to_char(j.month,'YYYY-MM') OR NOT COALESCE(p_result->'data'->>'sourceHash'~'^[a-f0-9]{64}$',false) OR jsonb_typeof(p_result->'data'->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'data'->'rows')>10000 OR (p_result->>'requests')::integer NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid DRI result' USING ERRCODE='22023';END IF;
  IF p_result->'data'->>'participantCode' IS DISTINCT FROM b->>'dri_agent_code' OR p_result->'data'->>'participantTaxId' IS DISTINCT FROM b->>'dri_tax_id' OR p_result->'data'->>'eventCode' IS DISTINCT FROM j.request_payload->>'eventCode' OR p_result->'data'->>'reportId' IS DISTINCT FROM j.request_payload->>'reportId' OR p_result->'data'->>'frameId' IS DISTINCT FROM j.request_payload->>'frameId' THEN RAISE EXCEPTION 'DRI source selection mismatch' USING ERRCODE='42501';END IF;
  IF j.kind='DRI_RESULTS' THEN
   FOR r IN SELECT value FROM jsonb_array_elements(p_result->'data'->'rows') LOOP
    IF jsonb_typeof(r->'columns') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'cells') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'columns') NOT BETWEEN 1 AND 100 OR jsonb_array_length(r->'columns')<>jsonb_array_length(r->'cells') OR r->>'reportId' IS DISTINCT FROM j.request_payload->>'reportId' OR r->>'frameId' IS DISTINCT FROM j.request_payload->>'frameId' THEN RAISE EXCEPTION 'Invalid DRI row' USING ERRCODE='22023';END IF;
    SELECT CASE WHEN count(*)=1 THEN min(ordinality)::integer-1 END INTO tax_column FROM jsonb_array_elements_text(r->'columns') WITH ORDINALITY WHERE upper(value)='CNPJ DO AGENTE';
    IF tax_column IS NULL OR regexp_replace(r->'cells'->>tax_column,'[^0-9]','','g') IS DISTINCT FROM b->>'dri_tax_id' THEN RAISE EXCEPTION 'DRI participant mismatch' USING ERRCODE='42501';END IF;
   END LOOP;
   INSERT INTO public.ccee_dri_result_snapshots(organization_id,authorization_id,job_id,source_hash,month,payload) VALUES(j.organization_id,j.authorization_id,j.id,p_result->'data'->>'sourceHash',j.month,p_result->'data');
  ELSE INSERT INTO public.ccee_dri_catalog_versions(organization_id,authorization_id,job_id,source_hash,month,kind,payload) VALUES(j.organization_id,j.authorization_id,j.id,p_result->'data'->>'sourceHash',j.month,j.kind,p_result->'data');END IF;
 END IF;RETURN d;
END$$;
DO $$DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('ccee_dri_action','ccee_claim_dri_reading','ccee_finish_dri_reading') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);END LOOP;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
