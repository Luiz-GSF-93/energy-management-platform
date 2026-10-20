BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Internal gateway: raw historical payload is verified in the service and NEVER returned to the browser.
CREATE FUNCTION public.read_portal_financial_components_v2(p_org text,p_actor text,p_role text,p_platform boolean,p_portal boolean,p_from text,p_to text,p_customer text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE modern jsonb; all_publications jsonb; result jsonb; legacy jsonb;
BEGIN
 all_publications:=public.read_eva_closing_publications(p_org,p_actor,p_role,p_platform,p_portal,p_from,p_to,p_customer);
 modern:=public.read_eva_published_components(p_org,p_actor,p_role,p_platform,p_portal,p_from,p_to,p_customer);
 SELECT coalesce(jsonb_agg(r||jsonb_build_object('unitContext',(SELECT jsonb_build_object('freeMarket',x->'free_market','state',x->'state','tariffGroup',x->'tariff_group','tariffSubgroup',x->'tariff_subgroup','tariffModality',x->'tariff_modality','voltage',x->'voltage') FROM jsonb_array_elements(coalesce(v.source_snapshot#>'{financial,tables,consumer_units}','[]')) x WHERE x->>'id'=r->>'unitId' AND x->>'organization_id'=p_org LIMIT 1),'invoiceTaxes',coalesce(unit#>'{methodology,taxes}','[]'),'cceeCosts',(SELECT coalesce(jsonb_agg(c.body||jsonb_build_object('closingHash',c.closing_hash,'month',c.month,'state',c.state,'provider',c.provider,'sourceReference',c.source_reference)),'[]') FROM public.ccee_financial_cost_snapshots c WHERE c.organization_id=p_org AND c.customer_id=p_customer AND c.consumer_unit_id=r->>'unitId' AND c.month=r->>'month' AND c.closing_hash=r->>'sourceHash' AND c.state='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM public.ccee_financial_cost_snapshots newer WHERE newer.organization_id=c.organization_id AND newer.consumer_unit_id=c.consumer_unit_id AND newer.month=c.month AND newer.closing_hash=c.closing_hash AND newer.revision>c.revision)))),'[]') INTO result
 FROM jsonb_array_elements(modern) r JOIN public.eva_assisted_closing_versions v ON v.id=(SELECT (p->>'closingId')::uuid FROM jsonb_array_elements(all_publications)p WHERE p->>'id'=r->>'publicationId') AND v.organization_id=p_org
 CROSS JOIN LATERAL jsonb_array_elements(v.report->'units') unit WHERE unit->>'id'=r->>'unitId' AND v.payload_hash=r->>'sourceHash';
 WITH latest AS(SELECT DISTINCT ON(f.customer_id,f.month) f.* FROM public.monthly_energy_settlements f
 WHERE f.organization_id=p_org AND f.customer_id=p_customer AND to_char(f.month,'YYYY-MM') BETWEEN p_from AND p_to AND f.financial_format='financial-settlement-1.0' AND f.status='PUBLISHED' AND f.validation_status='VALIDATED' AND f.approved_at IS NOT NULL AND f.published_at IS NOT NULL AND f.published_by IS NOT NULL
 ORDER BY f.customer_id,f.month,f.version_number DESC,f.published_at DESC)
 SELECT coalesce(jsonb_agg(jsonb_build_object('legacyPayload',f.financial_payload,'legacyHash',f.financial_hash,'publicationId',f.financial_group_id,'publishedAt',f.published_at,'customerId',f.customer_id,'month',to_char(f.month,'YYYY-MM'),'unitId',u.id,'name',u.name)),'[]') INTO legacy
 FROM latest f JOIN public.consumer_units u ON u.organization_id=p_org AND u.customer_id=p_customer AND u.status='ACTIVE'
 WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(f.financial_payload#>'{financial,units}') unit WHERE unit->>'id'=u.id)
 AND (SELECT count(*) FROM public.monthly_energy_settlements g WHERE g.organization_id=p_org AND g.financial_group_id=f.financial_group_id)=jsonb_array_length(f.financial_payload#>'{financial,units}')
 AND (SELECT count(DISTINCT g.consumer_unit_id) FROM public.monthly_energy_settlements g WHERE g.organization_id=p_org AND g.financial_group_id=f.financial_group_id)=jsonb_array_length(f.financial_payload#>'{financial,units}')
 AND NOT EXISTS(SELECT 1 FROM public.monthly_energy_settlements g WHERE g.organization_id=p_org AND g.financial_group_id=f.financial_group_id AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.financial_payload#>'{financial,units}') unit WHERE unit->>'id'=g.consumer_unit_id) OR g.customer_id IS DISTINCT FROM f.customer_id OR g.month IS DISTINCT FROM f.month OR g.version_number IS DISTINCT FROM f.version_number OR g.financial_hash IS DISTINCT FROM f.financial_hash OR g.status IS DISTINCT FROM 'PUBLISHED' OR g.validation_status IS DISTINCT FROM 'VALIDATED' OR g.published_at IS NULL OR g.approved_at IS NULL))
 AND NOT EXISTS(SELECT 1 FROM public.monthly_energy_settlements ambiguous WHERE ambiguous.organization_id=p_org AND ambiguous.customer_id=f.customer_id AND ambiguous.month=f.month AND ambiguous.version_number=f.version_number AND ambiguous.status='PUBLISHED' AND ambiguous.financial_group_id IS DISTINCT FROM f.financial_group_id)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(all_publications) p WHERE p#>>'{projection,month}'=to_char(f.month,'YYYY-MM') AND (p->>'publishedAt')::timestamptz>=f.published_at)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(modern)r WHERE r->>'month'=to_char(f.month,'YYYY-MM') AND r->>'unitId'=u.id);
 IF jsonb_array_length(result)+jsonb_array_length(legacy)>1200 THEN RAISE EXCEPTION 'Financial scope too large' USING ERRCODE='22023';END IF;
 RETURN result||legacy;
END$$;
CREATE FUNCTION public.energy_price_read_workspace(p_org text,p_actor text,p_role text,p_platform boolean,p_portal boolean,p_year integer,p_customer text DEFAULT NULL,p_unit text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; markets jsonb;
BEGIN
 result:=public.energy_price_read(p_org,p_actor,p_role,p_platform,p_portal,p_year,p_customer,p_unit);
 -- A registered supplier submarket is independent of an annual admission study.
 SELECT coalesce(jsonb_agg(jsonb_build_object('unitId',unit,'month',month,'submarket',market)),'[]') INTO markets FROM (
 SELECT u->>'id' AS unit,to_char(m,'YYYY-MM') AS month,min(c.submarket) AS market FROM jsonb_array_elements(result->'units')u
 CROSS JOIN generate_series(make_date(p_year,1,1),make_date(p_year,12,1),interval '1 month')m
 JOIN public.energy_contracts c ON c.organization_id=p_org AND c.customer_id=result->>'customerId' AND c.consumer_unit_id=u->>'id' AND c.contract_type='ENERGY_PURCHASE' AND c.status='ACTIVE' AND c.start_date<=m::date AND c.end_date>=(m+interval '1 month - 1 day')::date AND c.submarket IN('SE_CO','S','NE','N')
 GROUP BY u->>'id',to_char(m,'YYYY-MM') HAVING count(DISTINCT c.submarket)=1)x;
 RETURN result||jsonb_build_object('submarkets',markets);
END$$;
REVOKE ALL ON FUNCTION public.read_portal_financial_components_v2(text,text,text,boolean,boolean,text,text,text),public.energy_price_read_workspace(text,text,text,boolean,boolean,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_portal_financial_components_v2(text,text,text,boolean,boolean,text,text,text),public.energy_price_read_workspace(text,text,text,boolean,boolean,integer,text,text) TO service_role;
COMMIT;
