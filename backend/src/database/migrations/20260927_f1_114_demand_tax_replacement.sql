-- F1.114: extend included-tax replacement from TUSD/CDE to the two reviewed demand parcels.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.approve_parameter_replacement(p_organization text,p_parameter uuid,p_revision integer,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE n public.calculation_parameters%ROWTYPE; o public.calculation_parameters%ROWTYPE; b public.calculation_parameters%ROWTYPE; item jsonb; old_count integer; new_count integer; demand_mode boolean;
BEGIN
 IF nullif(btrim(p_actor),'') IS NULL OR nullif(btrim(p_organization),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Actor and organization required';END IF;
 SELECT * INTO n FROM public.calculation_parameters WHERE id=p_parameter AND organization_id=p_organization;
 IF NOT FOUND OR n.supersedes_parameter_id IS NULL OR n.supersedes_parameter_id=n.id THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Replacement lineage required';END IF;
 -- Same advisory lock as the ordinary approval guard; serialize approvals for this scope.
 PERFORM pg_advisory_xact_lock(hashtextextended(n.organization_id||':'||n.consumer_unit_id::text||':'||n.kind||':'||n.component_code||':'||n.scenario,0));
 PERFORM 1 FROM public.calculation_parameters WHERE organization_id=p_organization AND id IN (p_parameter,n.supersedes_parameter_id) ORDER BY id FOR UPDATE;
 SELECT * INTO n FROM public.calculation_parameters WHERE id=p_parameter AND organization_id=p_organization;
 SELECT * INTO o FROM public.calculation_parameters WHERE id=n.supersedes_parameter_id AND organization_id=p_organization;
 IF NOT FOUND OR n.kind<>'TAX' OR o.kind<>'TAX' OR n.component_code NOT IN ('ICMS','PIS','COFINS') OR n.component_code<>o.component_code
  OR n.customer_id<>o.customer_id OR n.consumer_unit_id<>o.consumer_unit_id OR n.scenario<>'ACL' OR o.scenario<>'ACL'
  OR n.start_date<>o.start_date OR n.end_date<>o.end_date OR n.treatment<>'INCLUDED' OR o.treatment<>'INCLUDED'
  OR n.measure<>'PERCENT' OR o.measure<>'PERCENT' OR n.amount_text IS NOT NULL OR o.amount_text IS NOT NULL
  OR n.time_band<>'ALL' OR o.time_band<>'ALL' OR n.direction<>'DEBIT' OR o.direction<>'DEBIT'
  OR n.source<>o.source||' · versão ampliada do parâmetro '||o.id::text
  OR o.source !~ '^OCR CPFL · documento [0-9a-f-]{36} · SHA-256 [0-9a-f]{64}( · versão ampliada do parâmetro [0-9a-f-]{36})?$'
 THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Incompatible replacement';END IF;
 IF n.status='APPROVED' AND o.status='RETIRED' THEN RETURN to_jsonb(n);END IF;
 IF n.status<>'DRAFT' OR n.revision<>p_revision OR o.status NOT IN ('APPROVED','RETIRED') THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Revision or state changed';END IF;
 old_count:=jsonb_array_length(o.tax_basis->'items'); new_count:=jsonb_array_length(n.tax_basis->'items'); demand_mode:=old_count=4 AND new_count=6;
 IF NOT ((old_count=2 AND new_count=4) OR demand_mode)
  OR n.tax_basis->>'version' IS DISTINCT FROM '1' OR o.tax_basis->>'version' IS DISTINCT FROM '1'
  OR n.tax_basis-ARRAY['version','items']<>'{}'::jsonb OR o.tax_basis-ARRAY['version','items']<>'{}'::jsonb
 THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Expected exact TUSD and CDE bases';END IF;
 IF (SELECT count(DISTINCT i->>'parameterId') FROM jsonb_array_elements(n.tax_basis->'items') i)<>new_count
  OR (SELECT count(DISTINCT i->>'parameterId') FROM jsonb_array_elements(o.tax_basis->'items') i)<>old_count
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(o.tax_basis->'items') i WHERE NOT (n.tax_basis->'items' @> jsonb_build_array(i)))
 THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Original basis must be preserved';END IF;
 -- Lock source bases; concurrent retirement cannot slip between validation and approval.
 PERFORM 1 FROM public.calculation_parameters WHERE id IN (SELECT (i->>'parameterId')::uuid FROM jsonb_array_elements(n.tax_basis->'items') i) ORDER BY id FOR SHARE;
 FOR item IN SELECT * FROM jsonb_array_elements(n.tax_basis->'items') LOOP
  SELECT * INTO b FROM public.calculation_parameters WHERE id=(item->>'parameterId')::uuid AND organization_id=p_organization;
  IF NOT FOUND OR item->>'operation' IS DISTINCT FROM (CASE WHEN b.embedded_tax_codes @> jsonb_build_array(n.component_code) THEN 'INCLUDE' ELSE 'EXCLUDE' END) OR b.revision::text IS DISTINCT FROM item->>'revision'
   OR b.status<>'APPROVED' OR b.kind<>'TARIFF' OR (b.component_code NOT IN ('TUSD_ENERGY','CDE_WATER_SCARCITY') AND (NOT demand_mode OR b.component_code NOT IN ('TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED')))
   OR (CASE WHEN b.component_code IN ('TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED') THEN b.time_band<>'ALL' OR b.measure<>'BRL_KW' ELSE b.time_band NOT IN ('PEAK','OFF_PEAK') OR b.measure<>'BRL_MWH' END) OR b.customer_id<>n.customer_id OR b.consumer_unit_id<>n.consumer_unit_id
   OR b.scenario<>n.scenario OR b.treatment<>'GROSS' OR b.direction<>'DEBIT' OR b.start_date>n.start_date OR b.end_date<n.end_date
   OR (item->>'operation'='EXCLUDE' AND (NOT demand_mode OR b.component_code<>'TUSD_DEMAND_UNUSED' OR n.component_code<>'ICMS'))
   OR (CASE WHEN demand_mode THEN b.component_code IN ('TUSD_ENERGY','CDE_WATER_SCARCITY') ELSE b.component_code='TUSD_ENERGY' END) IS DISTINCT FROM (o.tax_basis->'items' @> jsonb_build_array(item))
  THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Current approved compatible bases required';END IF;
 END LOOP;
 IF (SELECT count(DISTINCT base_row.component_code||':'||base_row.time_band) FROM public.calculation_parameters base_row WHERE base_row.id IN (SELECT (i->>'parameterId')::uuid FROM jsonb_array_elements(n.tax_basis->'items') i))<>new_count
 THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='One base per component and tariff band required';END IF;
 IF o.status='APPROVED' THEN
  UPDATE public.calculation_parameters SET status='RETIRED',updated_by=p_actor,retirement_reason='Substituição automática pelo parâmetro '||n.id::text||', aprovado na mesma transação após validação das bases tributárias e suas revisões.' WHERE id=o.id AND organization_id=p_organization;
 END IF;
 -- Existing guards validate approval and overlap. Any failure rolls back the retirement too.
 UPDATE public.calculation_parameters SET status='APPROVED',updated_by=p_actor WHERE id=n.id AND organization_id=p_organization RETURNING * INTO n;
 RETURN to_jsonb(n);
END $$;
REVOKE ALL ON FUNCTION public.approve_parameter_replacement(text,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_parameter_replacement(text,uuid,integer,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;