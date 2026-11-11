BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- The navigation badge must not aggregate the historical audit workspace.
CREATE FUNCTION public.energy_audit_alert_count(p_org text,p_actor uuid,p_global boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE amount bigint;
BEGIN
 PERFORM public.energy_audit_authorize(p_org,p_actor,p_global,CASE WHEN p_global THEN 'dbb580ca-d940-4e80-97fb-e9f9619a0004' ELSE 'dbb580ca-d940-4e80-97fb-e9f9619a0001' END);
 SELECT count(*) INTO amount FROM public.energy_audit_alerts a WHERE (p_global OR a.organization_id=p_org) AND a.last_at BETWEEN now()-interval '30 days' AND now() AND a.state IN('OPEN','ANALYSIS');
 RETURN jsonb_build_object('openAlertCount',amount);
END$$;
REVOKE ALL ON FUNCTION public.energy_audit_alert_count(text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.energy_audit_alert_count(text,uuid,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
