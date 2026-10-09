BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Read-only, service-only entry point. Never relax forecast table grants or backoffice RPCs.
CREATE FUNCTION public.energy_forecast_client_published(p_org text,p_actor text,p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer text; result jsonb;
BEGIN
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
 AND c.status='ACTIVE' AND c.deleted_at IS NULL;
 IF customer IS NULL THEN RAISE EXCEPTION 'Client scope unavailable' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(q.record ORDER BY q.cutoff DESC,q.unit_id),'[]'::jsonb) INTO result FROM (
  SELECT DISTINCT ON (f.consumer_unit_id,f.cutoff) f.cutoff,f.consumer_unit_id AS unit_id,
   jsonb_build_object('id',f.id,'version',f.version,'organization_id',f.organization_id,'customer_id',f.customer_id,
    'consumer_unit_id',f.consumer_unit_id,'cutoff',f.cutoff,'body',f.body,'payload_hash',f.payload_hash,
    'unitName',u.name,'publishedAt',p.created_at,'validatedAt',v.created_at) AS record
  FROM public.energy_forecast_runs f
  JOIN public.consumer_units u ON u.id=f.consumer_unit_id AND u.organization_id=f.organization_id AND u.customer_id=f.customer_id AND u.status='ACTIVE'
  JOIN public.energy_forecast_events p ON p.run_id=f.id AND p.organization_id=f.organization_id AND p.action='PUBLISHED'
  JOIN public.energy_forecast_events v ON v.run_id=f.id AND v.organization_id=f.organization_id AND v.action='VALIDATED' AND v.created_at<=p.created_at
  WHERE f.organization_id=p_org AND f.customer_id=customer
  ORDER BY f.consumer_unit_id,f.cutoff,f.version DESC LIMIT 100
 ) q;
 RETURN jsonb_build_object('customerId',customer,'rows',result);
END $$;
REVOKE ALL ON FUNCTION public.energy_forecast_client_published(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.energy_forecast_client_published(text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
