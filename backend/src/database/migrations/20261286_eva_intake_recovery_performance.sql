BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';

-- Fixed tables/identifiers only; a browser cannot choose the tenant or a table.
-- The scoped continuation rechecks the live author/delegation/license first.
CREATE FUNCTION public.eva_intake_source_fingerprint(p_id uuid,p_token uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;i public.eva_automatic_intakes;name text;predicate text;values_json jsonb;parts jsonb:='[]';
BEGIN
 ctx:=public.portal_intake_work_context_scoped(p_id,p_token);
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp();
 IF i.unit_id IS NULL OR i.customer_id IS NULL THEN RAISE EXCEPTION 'Identified source required' USING ERRCODE='42501';END IF;
 FOREACH name IN ARRAY ARRAY['consumer_units','customers','documents','energy_contracts','calculation_parameters','calculation_monthly_inputs','calculation_monthly_costs','supplier_billing_rules','supplier_spot_reconciliations','calculation_cost_absences','management_contracts','management_fee_allocations','commercial_fee_adjustments','unit_demand_periods','unit_demand_approvals','tariff_library_versions'] LOOP
  predicate:='organization_id=$1';
  IF name IN('consumer_units','customers') THEN predicate:=predicate||' AND id=$2';
  ELSE
   IF name NOT IN('tariff_library_versions','calculation_parameters') THEN predicate:=predicate||' AND customer_id=$2';END IF;
   IF name NOT IN('management_contracts','management_fee_allocations','commercial_fee_adjustments','tariff_library_versions') THEN predicate:=predicate||' AND consumer_unit_id=$3';END IF;
  END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),''[]''::jsonb) FROM (SELECT * FROM public.%I WHERE %s ORDER BY id LIMIT 501)x',name,predicate)
   INTO values_json USING i.organization_id,CASE WHEN name='consumer_units' THEN i.unit_id ELSE i.customer_id END,i.unit_id;
  IF jsonb_array_length(values_json)>500 OR name IN('consumer_units','customers') AND jsonb_array_length(values_json)<>1 THEN RAISE EXCEPTION 'Source signature unavailable' USING ERRCODE='22023';END IF;
  parts:=parts||jsonb_build_array(jsonb_build_array(name,md5(values_json::text)));
 END LOOP;
 RETURN encode(sha256(convert_to(jsonb_build_array('intake-fingerprint-2',parts,public.portal_intake_scoped_rpc('eva_intake_reference_signature',jsonb_build_object('p_id',p_id,'p_token',p_token)))::text,'UTF8')),'hex');
END$$;

CREATE FUNCTION public.eva_intake_alias_catalog(p_id uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;u jsonb;lineage jsonb;result jsonb:='{}';
BEGIN
 ctx:=public.portal_intake_work_context_scoped(p_id,p_token);
 FOR u IN SELECT * FROM jsonb_array_elements(ctx->'units') LOOP
  lineage:=public.ocr_identity_unit_lineage(ctx#>>'{intake,organization_id}',u->>'customer_id',u->>'id',u->>'consumer_unit_number');
  result:=result||jsonb_build_object(u->>'id',coalesce(lineage->'codes','[]'::jsonb));
 END LOOP;
 RETURN result;
END$$;

-- Read status by indexed exact IDs. Never deserialize an OCR or report payload
-- merely to locate the last event.
CREATE INDEX IF NOT EXISTS eva_intake_events_recent ON public.eva_automatic_intake_events(intake_id,event,sequence DESC);
CREATE INDEX IF NOT EXISTS eva_closing_events_recent ON public.eva_assisted_closing_events(organization_id,closing_id,sequence DESC);
CREATE INDEX IF NOT EXISTS eva_publication_events_recent ON public.eva_closing_publication_events(organization_id,publication_id,sequence DESC);

REVOKE ALL ON FUNCTION public.eva_intake_source_fingerprint(uuid,uuid),public.eva_intake_alias_catalog(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_source_fingerprint(uuid,uuid),public.eva_intake_alias_catalog(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
