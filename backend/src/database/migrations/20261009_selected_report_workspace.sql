BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.read_selected_reports(p_org text,p_actor text,p_customer text,p_unit text,p_from text,p_to text,p_kind text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,false);
 IF p_from !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR p_to !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR p_from>p_to OR p_kind NOT IN ('OPERATIONAL','EXECUTIVE') THEN RAISE EXCEPTION 'Invalid selection' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customers c JOIN public.consumer_units u ON u.customer_id=c.id AND u.organization_id=c.organization_id WHERE c.organization_id=p_org AND c.id=p_customer AND u.id=p_unit AND c.deleted_at IS NULL AND c.status='ACTIVE' AND u.status='ACTIVE') THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='P3862'; END IF;
 SELECT coalesce(jsonb_agg(j ORDER BY j->>'created_at' DESC),'[]'::jsonb) INTO result FROM (SELECT jsonb_build_object('id',s.id,'kind',s.kind,'created_at',s.created_at,'customer_id',s.customer_id,'consumer_unit_id',s.consumer_unit_id,'customer_name',s.body#>>'{header,customerName}','unit_name',s.body#>>'{header,unitName}','period',s.body->'period','payload_hash',s.payload_hash) j FROM public.published_report_snapshots s WHERE s.organization_id=p_org AND s.customer_id=p_customer AND s.consumer_unit_id=p_unit AND s.kind=p_kind AND s.body#>>'{period,from}'>=p_from AND s.body#>>'{period,to}'<=p_to ORDER BY s.created_at DESC LIMIT 100) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_selected_reports(text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_selected_reports(text,text,text,text,text,text,text) TO service_role;

CREATE FUNCTION public.energy_forecast_histories_selected(p_org text,p_actor text,p_customer text,p_unit text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.energy_forecast_history_actor(p_org,p_actor,false,false);
 RETURN (SELECT COALESCE(jsonb_agg(q.body),'[]'::jsonb) FROM (SELECT to_jsonb(h)||jsonb_build_object('reviewedAt',r.reviewed_at,'customerName',c.company_name,'unitName',u.name,'lastMonth',h.rows->(jsonb_array_length(h.rows)-1)->>'month') body
 FROM public.energy_forecast_histories h LEFT JOIN public.energy_forecast_history_reviews r ON r.organization_id=h.organization_id AND r.history_id=h.id
 JOIN public.consumer_units u ON u.id=h.consumer_unit_id AND u.organization_id=h.organization_id AND u.customer_id=h.customer_id AND u.status='ACTIVE'
 JOIN public.customers c ON c.id=h.customer_id AND c.organization_id=h.organization_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 WHERE h.organization_id=p_org AND h.customer_id=p_customer AND h.consumer_unit_id=p_unit ORDER BY h.created_at DESC LIMIT 100) q);
END $$;
REVOKE ALL ON FUNCTION public.energy_forecast_histories_selected(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.energy_forecast_histories_selected(text,text,text,text) TO service_role;
CREATE FUNCTION public.energy_forecast_read_selected(p_org text,p_actor text,p_customer text,p_unit text,p_run uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,false);
 SELECT COALESCE(jsonb_agg(q.body),'[]'::jsonb) INTO result FROM (SELECT to_jsonb(r)-'sources'||jsonb_build_object('customerName',c.company_name,'unitName',u.name,'events',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at),'[]'::jsonb) FROM public.energy_forecast_events e WHERE e.organization_id=p_org AND e.run_id=r.id)) body
 FROM public.energy_forecast_runs r JOIN public.consumer_units u ON u.id=r.consumer_unit_id AND u.organization_id=r.organization_id AND u.customer_id=r.customer_id AND u.status='ACTIVE'
 JOIN public.customers c ON c.id=r.customer_id AND c.organization_id=r.organization_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 WHERE r.organization_id=p_org AND r.customer_id=p_customer AND r.consumer_unit_id=p_unit AND (p_run IS NULL OR r.id=p_run) ORDER BY r.created_at DESC LIMIT 100) q;
 IF p_run IS NOT NULL THEN IF jsonb_array_length(result)<>1 THEN RAISE EXCEPTION 'Forecast unavailable' USING ERRCODE='P3862';END IF;RETURN result->0;END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.energy_forecast_read_selected(text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.energy_forecast_read_selected(text,text,text,text,uuid) TO service_role;
CREATE FUNCTION public.energy_forecast_sources_selected(p_org text,p_actor text,p_role text,p_platform boolean,p_customer text,p_unit text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,false);
 PERFORM public.acl_assert_actor(p_org,p_actor,p_role,p_platform,false);
 RETURN (SELECT COALESCE(jsonb_agg(q.body),'[]'::jsonb) FROM (SELECT jsonb_build_object('admissionId',e.admission_id,'evidenceId',e.id,'customerId',e.customer_id,'unitId',e.consumer_unit_id,'customerName',c.company_name,'unitName',u.name,'reviewedAt',r.reviewed_at,'lastMonth',e.facts#>>'{history,rows,11,month}') body
 FROM public.acl_admission_evidence e JOIN public.acl_admission_evidence_reviews r ON r.organization_id=e.organization_id AND r.evidence_id=e.id AND r.decision='APPROVED'
 JOIN public.customers c ON c.id=e.customer_id AND c.organization_id=e.organization_id AND c.deleted_at IS NULL AND c.status='ACTIVE'
 JOIN public.consumer_units u ON u.id=e.consumer_unit_id AND u.organization_id=e.organization_id AND u.customer_id=c.id AND u.status='ACTIVE'
 WHERE e.organization_id=p_org AND e.customer_id=p_customer AND e.consumer_unit_id=p_unit AND e.stage_key='invoices' AND e.kind='COMPLETE' AND e.facts ? 'history' ORDER BY r.reviewed_at DESC LIMIT 100) q);
END $$;
REVOKE ALL ON FUNCTION public.energy_forecast_sources_selected(text,text,text,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.energy_forecast_sources_selected(text,text,text,boolean,text,text) TO service_role;
COMMIT;
