BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.published_report_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 kind text NOT NULL CHECK(kind IN ('OPERATIONAL','EXECUTIVE')),request_id uuid NOT NULL,request jsonb NOT NULL,
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=1000000),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_id)
);
CREATE INDEX published_reports_scope ON public.published_report_snapshots(organization_id,created_at DESC);
ALTER TABLE public.published_report_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.published_report_snapshots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.published_report_snapshots TO service_role;
CREATE FUNCTION public.reject_report_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Published report is immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER report_immutable BEFORE UPDATE OR DELETE ON public.published_report_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_report_change();
CREATE FUNCTION public.assert_report_actor(p_org text,p_actor text,p_write boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE role_name text;perms jsonb;
BEGIN
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND report_generation IS TRUE AND free_market_management IS TRUE)
 THEN RAISE EXCEPTION 'Active license and organization required' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN PERFORM public.assert_license_platform_actor(p_actor::uuid);RETURN;END IF;
 SELECT r.name,r.permissions INTO role_name,perms FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';
 IF role_name IS NULL OR role_name NOT IN ('admin_org','gestor','operacional') OR NOT COALESCE(perms ? '3ebadd32-6f30-459e-8ed3-0d2843d89946',false) OR NOT COALESCE(perms ? '60f9690a-145b-4dba-b23f-9f945baca296',false) OR (p_write AND NOT COALESCE(perms ? '9541a7bb-c20a-4c4d-9f4c-2185262c8e9c',false)) THEN RAISE EXCEPTION 'Backoffice report access required' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION public.capture_published_report(p_org text,p_actor text,p_request jsonb,p_body jsonb,p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c text;u text;req uuid;r public.published_report_snapshots;src jsonb;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,true);
 IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_request))<>6 OR NOT p_request ?& ARRAY['kind','customerId','unitId','from','to','requestId'] OR p_request->>'kind' NOT IN ('OPERATIONAL','EXECUTIVE')
 OR COALESCE(p_request->>'from','') !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR COALESCE(p_request->>'to','') !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR p_request->>'to'<p_request->>'from' OR (p_request->>'to'||'-01')::date>(p_request->>'from'||'-01')::date+interval '11 months'
 OR p_body IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR octet_length(p_body::text)>1000000
 THEN RAISE EXCEPTION 'Invalid report request' USING ERRCODE='22023';END IF;
 c:=p_request->>'customerId';u:=p_request->>'unitId';req:=(p_request->>'requestId')::uuid;
 PERFORM 1 FROM public.customers WHERE id=c AND organization_id=p_org AND deleted_at IS NULL AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report scope unavailable' USING ERRCODE='P3862';END IF;
 PERFORM 1 FROM public.consumer_units WHERE id=u AND customer_id=c AND organization_id=p_org AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report scope unavailable' USING ERRCODE='P3862';END IF;
 SELECT * INTO r FROM public.published_report_snapshots WHERE organization_id=p_org AND request_id=req;
 IF FOUND THEN IF r.created_by<>p_actor OR r.request<>p_request THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;RETURN to_jsonb(r);END IF;
 IF p_body->>'formatVersion' IS DISTINCT FROM 'energy-report-1.0' OR p_body->>'kind' IS DISTINCT FROM p_request->>'kind'
 OR p_body#>>'{header,organizationId}' IS DISTINCT FROM p_org OR p_body#>>'{header,customerId}' IS DISTINCT FROM c OR p_body#>>'{header,unitId}' IS DISTINCT FROM u
 OR p_body#>>'{period,from}' IS DISTINCT FROM p_request->>'from' OR p_body#>>'{period,to}' IS DISTINCT FROM p_request->>'to'
 OR jsonb_typeof(p_body->'publications') IS DISTINCT FROM 'array' OR jsonb_typeof(p_body->'totals') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid report body' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_body->'publications') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Invalid publication count' USING ERRCODE='22023';END IF;
 FOR src IN SELECT value FROM jsonb_array_elements(p_body->'publications') LOOP
  IF src->>'customerId' IS DISTINCT FROM c OR src->>'month'<p_request->>'from' OR src->>'month'>p_request->>'to' OR NOT EXISTS(SELECT 1 FROM public.monthly_energy_settlements s WHERE s.organization_id=p_org AND s.customer_id=c AND s.consumer_unit_id=u AND s.financial_group_id::text=src->>'id' AND s.status='PUBLISHED' AND s.validation_status='VALIDATED' AND s.financial_hash=src->>'payloadHash' AND s.version_number::text=src->>'version' AND to_char(s.month,'YYYY-MM')=src->>'month') THEN RAISE EXCEPTION 'Published source changed' USING ERRCODE='40001';END IF;
 END LOOP;
 INSERT INTO public.published_report_snapshots(organization_id,customer_id,consumer_unit_id,kind,request_id,request,body,payload_hash,created_by) VALUES(p_org,c,u,p_request->>'kind',req,p_request,p_body,p_hash,p_actor) RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION public.read_published_reports(p_org text,p_actor text,p_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.published_report_snapshots;result jsonb;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,false);
 IF p_id IS NOT NULL THEN
  SELECT s.* INTO r FROM public.published_report_snapshots s JOIN public.customers c ON c.id=s.customer_id AND c.organization_id=s.organization_id JOIN public.consumer_units u ON u.id=s.consumer_unit_id AND u.customer_id=c.id AND u.organization_id=s.organization_id WHERE s.organization_id=p_org AND s.id=p_id AND c.deleted_at IS NULL AND c.status='ACTIVE' AND u.status='ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Report unavailable' USING ERRCODE='P3862';END IF;
  RETURN to_jsonb(r);
 END IF;
 SELECT COALESCE(jsonb_agg(j ORDER BY j->>'created_at' DESC),'[]'::jsonb) INTO result FROM (SELECT jsonb_build_object('id',s.id,'kind',s.kind,'created_at',s.created_at,'customer_id',s.customer_id,'consumer_unit_id',s.consumer_unit_id,'customer_name',s.body#>>'{header,customerName}','unit_name',s.body#>>'{header,unitName}','period',s.body->'period','payload_hash',s.payload_hash) j FROM public.published_report_snapshots s JOIN public.customers c ON c.id=s.customer_id AND c.organization_id=s.organization_id JOIN public.consumer_units u ON u.id=s.consumer_unit_id AND u.organization_id=s.organization_id AND u.customer_id=c.id WHERE s.organization_id=p_org AND c.deleted_at IS NULL AND c.status='ACTIVE' AND u.status='ACTIVE' ORDER BY s.created_at DESC LIMIT 100) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reject_report_change(),public.assert_report_actor(text,text,boolean),public.capture_published_report(text,text,jsonb,jsonb,text),public.read_published_reports(text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.assert_report_actor(text,text,boolean),public.capture_published_report(text,text,jsonb,jsonb,text),public.read_published_reports(text,text,uuid) TO service_role;
COMMIT;
