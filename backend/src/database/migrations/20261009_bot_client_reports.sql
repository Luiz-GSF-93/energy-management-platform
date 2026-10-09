BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- New read-only entry point; no writes, table grants, role assignments or corpus releases.
CREATE FUNCTION public.bot_energy_client_reports(p_org text,p_actor text,p_role text,p_from text,p_to text,p_unit text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer text; units jsonb; groups jsonb;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_from !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' OR p_to !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' OR p_from>p_to OR
 ((left(p_to,4)::int-left(p_from,4)::int)*12+right(p_to,2)::int-right(p_from,2)::int)>=12
 THEN RAISE EXCEPTION 'Invalid report period' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND report_generation IS TRUE AND free_market_management IS TRUE)
 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL)
 THEN RAISE EXCEPTION 'Client scope unavailable' USING ERRCODE='42501'; END IF;
 SELECT c.id INTO customer FROM public.organization_members m
 JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 JOIN public.customers c ON c.id=m.exclusive_customer_id AND c.organization_id=m.organization_id
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id=p_role AND upper(m.status)='ACTIVE'
 AND m.affiliation_type='external' AND r.name='consulta' AND r.permissions ? '3ebadd32-6f30-459e-8ed3-0d2843d89946'
 AND r.permissions ? '62443ab1-9187-42e4-a932-a7cf54f76250' AND c.status='ACTIVE' AND c.deleted_at IS NULL;
 IF customer IS NULL THEN RAISE EXCEPTION 'Client scope unavailable' USING ERRCODE='42501'; END IF;
 IF p_unit IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE organization_id=p_org AND customer_id=customer AND id=p_unit AND status='ACTIVE')
 THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.consumer_units WHERE organization_id=p_org AND customer_id=customer AND status='ACTIVE')>40
 THEN RAISE EXCEPTION 'Too many units' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id),'[]'::jsonb) INTO units FROM public.consumer_units WHERE organization_id=p_org AND customer_id=customer AND status='ACTIVE';
 IF p_unit IS NULL THEN RETURN jsonb_build_object('customerId',customer,'units',units,'groups','[]'::jsonb); END IF;
 IF p_unit IS NULL THEN RETURN jsonb_build_object('customerId',customer,'units',units,'groups','[]'::jsonb); END IF;
 IF EXISTS(SELECT 1 FROM public.monthly_energy_settlements WHERE organization_id=p_org AND customer_id=customer AND financial_format='financial-settlement-1.0' AND status='PUBLISHED' AND validation_status='VALIDATED' AND month>=(p_from||'-01')::date AND month<=(p_to||'-01')::date GROUP BY month,version_number HAVING count(DISTINCT financial_group_id)>1) THEN RAISE EXCEPTION 'Ambiguous published version' USING ERRCODE='22023'; END IF;
 -- Internal payloads travel only to the backend integrity checker, never directly to a client or LLM.
 SELECT coalesce(jsonb_agg(q.record ORDER BY q.month),'[]'::jsonb) INTO groups FROM (
 SELECT latest.month,(SELECT jsonb_build_object('rows',jsonb_agg(to_jsonb(s)-'financial_payload' ORDER BY s.consumer_unit_id),'payload',first.financial_payload,'consistent',bool_and(s.financial_payload=first.financial_payload)) FROM public.monthly_energy_settlements s
 CROSS JOIN LATERAL (SELECT financial_payload FROM public.monthly_energy_settlements x WHERE x.organization_id=p_org AND x.customer_id=customer AND x.financial_group_id=latest.financial_group_id ORDER BY x.consumer_unit_id LIMIT 1) first
 WHERE s.organization_id=p_org AND s.customer_id=customer AND s.financial_group_id=latest.financial_group_id GROUP BY first.financial_payload) record
 FROM (SELECT DISTINCT ON (month) month,financial_group_id FROM public.monthly_energy_settlements
 WHERE organization_id=p_org AND customer_id=customer AND financial_format='financial-settlement-1.0'
 AND status='PUBLISHED' AND validation_status='VALIDATED' AND approved_at IS NOT NULL AND published_at IS NOT NULL AND published_by IS NOT NULL
 AND month>= (p_from||'-01')::date AND month<= (p_to||'-01')::date ORDER BY month,version_number DESC) latest
 ) q;
 RETURN jsonb_build_object('customerId',customer,'units',units,'groups',groups);
END $$;
REVOKE ALL ON FUNCTION public.bot_energy_client_reports(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bot_energy_client_reports(text,text,text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
