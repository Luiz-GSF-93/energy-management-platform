BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Closing reads are scoped to a unit/month, independent of unrelated job pages.
CREATE OR REPLACE FUNCTION public.ccee_closing_sources(p_org text,p_actor text,p_unit text,p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.ccee_unit_authorizations;u public.consumer_units;a date;z date;shared boolean;jobs jsonb;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'view');
 IF coalesce(p_month,'')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';END IF;
 a:=(p_month||'-01')::date;z:=(a+interval '1 month'-interval '1 day')::date;
 SELECT * INTO u FROM public.consumer_units WHERE organization_id=p_org AND id=p_unit AND status='ACTIVE';
 IF NOT FOUND THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.ccee_unit_authorizations WHERE organization_id=p_org AND customer_id=u.customer_id AND consumer_unit_id=u.id ORDER BY revision DESC LIMIT 1;
 IF b.id IS NULL OR b.status<>'APPROVED' OR b.valid_from IS NULL OR b.valid_from>a OR b.valid_to<z OR NOT(b.service_scope?'DRI_READ') THEN RETURN jsonb_build_object('organizationId',p_org,'binding',NULL,'jobs','[]'::jsonb);END IF;
 -- Reuse the existing representation gate; this function grants no new scope.
 PERFORM public.assert_ccee_data_binding(p_org,b.id,a,'DRI_READ');
 SELECT count(*)>1 INTO shared FROM (
  SELECT DISTINCT ON(consumer_unit_id) * FROM public.ccee_unit_authorizations WHERE organization_id=p_org ORDER BY consumer_unit_id,revision DESC
 ) x WHERE x.status='APPROVED' AND x.dri_tax_id=b.dri_tax_id AND x.valid_from<=a AND(x.valid_to IS NULL OR x.valid_to>=z) AND x.service_scope?'DRI_READ';
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO jobs FROM (
  SELECT DISTINCT ON(request_payload->>'reportId',request_payload->>'frameId') id,authorization_id,kind,state,month,finished_at,request_payload->>'reportId' AS report_id,request_payload->>'frameId' AS frame_id
  FROM public.ccee_integration_jobs WHERE organization_id=p_org AND authorization_id=b.id AND kind='DRI_RESULTS' AND state='SUCCEEDED' AND result->'complete'='true'::jsonb AND month=a
  ORDER BY request_payload->>'reportId',request_payload->>'frameId',finished_at DESC NULLS LAST,created_at DESC,id DESC LIMIT 33
 ) x;
 RETURN jsonb_build_object('organizationId',p_org,'binding',jsonb_build_object('id',b.id,'organization_id',p_org,'customer_id',u.customer_id,'consumer_unit_id',u.id,'status',b.status,'revision',b.revision,'valid_from',b.valid_from,'valid_to',b.valid_to,'service_scope',b.service_scope),'allocationAmbiguous',shared,'jobs',jobs);
END$$;
REVOKE ALL ON FUNCTION public.ccee_closing_sources(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ccee_closing_sources(text,text,text,text) TO service_role;
CREATE INDEX IF NOT EXISTS ccee_closing_source_lookup ON public.ccee_integration_jobs(organization_id,authorization_id,month,finished_at DESC) WHERE kind='DRI_RESULTS' AND state='SUCCEEDED';
COMMIT;
