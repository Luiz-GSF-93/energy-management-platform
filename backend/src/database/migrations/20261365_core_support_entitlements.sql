BEGIN;
SET LOCAL lock_timeout='5s';
-- Preserve the signed command, idempotency checks, Owner authorization and production payment guards.
ALTER FUNCTION public.platform_core_license_sync(uuid,jsonb) RENAME TO platform_core_license_sync_before_support;
REVOKE ALL ON FUNCTION public.platform_core_license_sync_before_support(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.platform_core_license_sync(p_actor uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb:=p_body#>'{plan,support}';result jsonb;l public.licenses;p public.central_support_policies;link public.platform_core_license_links;prior_actor text;
BEGIN
 IF s IS NOT NULL AND (jsonb_typeof(s)<>'object' OR s-ARRAY['enabled','annual_tickets','extra_ticket_cents']<>'{}' OR
 jsonb_typeof(s->'enabled') IS DISTINCT FROM 'boolean' OR coalesce(s->>'annual_tickets','')!~'^[0-9]{1,6}$' OR
 coalesce(s->>'extra_ticket_cents','')!~'^[0-9]{1,9}$') THEN RAISE EXCEPTION 'Invalid support entitlement' USING ERRCODE='22023';END IF;
 IF s IS NOT NULL AND ((s->>'annual_tickets')::integer>100000 OR (s->>'extra_ticket_cents')::integer>100000000 OR
 s->>'enabled'='false' AND ((s->>'annual_tickets')::integer<>0 OR (s->>'extra_ticket_cents')::integer<>0)) THEN RAISE EXCEPTION 'Invalid support allowance' USING ERRCODE='22023';END IF;
 result:=public.platform_core_license_sync_before_support(p_actor,p_body);
 IF s IS NULL THEN RETURN result;END IF;
 SELECT * INTO STRICT link FROM public.platform_core_license_links WHERE core_subscription_id=(p_body->>'coreSubscriptionId')::uuid FOR UPDATE;
 -- Replaying an old event must not restore an old entitlement after a later amendment.
 IF link.revision<>(p_body->>'revision')::integer THEN RETURN result;END IF;
 SELECT * INTO STRICT l FROM public.licenses WHERE id::text=result->>'licenseId' AND organization_id=result->>'organizationId' FOR UPDATE;
 IF l.governance_revision<>link.license_revision OR NOT EXISTS(SELECT 1 FROM public.platform_core_plan_links m WHERE m.plan_id=l.plan_id AND m.core_plan_id=(p_body#>>'{plan,id}')::uuid AND m.core_version=(p_body#>>'{plan,version}')::integer AND m.cycle=p_body#>>'{payment,cycle}') THEN
 RAISE EXCEPTION 'Owner changed license; reconcile before applying support' USING ERRCODE='P3660';END IF;
 -- A Core version maps to an immutable catalog plan. Never replace an Owner-edited policy.
 INSERT INTO public.central_support_policies(plan_id,revision,allowance,extra_minor,updated_by)
 VALUES(l.plan_id,1,(s->>'annual_tickets')::integer,(s->>'extra_ticket_cents')::integer,p_actor) ON CONFLICT(plan_id) DO NOTHING;
 SELECT * INTO STRICT p FROM public.central_support_policies WHERE plan_id=l.plan_id FOR SHARE;
 IF p.allowance<>(s->>'annual_tickets')::integer OR p.extra_minor<>(s->>'extra_ticket_cents')::integer THEN
 RAISE EXCEPTION 'Support policy changed; reconcile the signed plan' USING ERRCODE='P3660';END IF;
 IF l.central_support_enabled IS DISTINCT FROM (s->>'enabled')::boolean THEN
  prior_actor:=current_setting('app.license_actor',true);PERFORM set_config('app.license_actor',p_actor::text,true);
  UPDATE public.licenses SET central_support_enabled=(s->>'enabled')::boolean,governance_revision=governance_revision+1,updated_at=now() WHERE id=l.id RETURNING * INTO l;
  PERFORM set_config('app.license_actor',coalesce(prior_actor,''),true);
  UPDATE public.platform_core_license_links SET license_revision=l.governance_revision WHERE core_subscription_id=(p_body->>'coreSubscriptionId')::uuid AND license_id=l.id::text;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.platform_core_license_sync(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.platform_core_license_sync(uuid,jsonb) TO service_role;

-- Read-only summary: opening the plan does not start a support cycle or consume a ticket.
CREATE FUNCTION public.central_support_license_usage(p_org text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l public.licenses;p public.central_support_policies;c public.central_support_cycles;today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=today AND(end_date IS NULL OR end_date>=today))<>1 THEN RETURN NULL;END IF;
 SELECT * INTO l FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=today AND(end_date IS NULL OR end_date>=today);
 SELECT * INTO p FROM public.central_support_policies WHERE plan_id=l.plan_id;
 IF NOT l.central_support_enabled OR p.plan_id IS NULL THEN RETURN jsonb_build_object('configured',false);END IF;
 SELECT * INTO c FROM public.central_support_cycles WHERE organization_id=p_org AND starts<=today AND ends>today ORDER BY starts DESC LIMIT 1;
 RETURN jsonb_build_object('configured',true,'period','ANNUAL','contracted',p.allowance,'extraMinor',p.extra_minor,
 'currentCycle',CASE WHEN c.id IS NULL THEN NULL ELSE public.central_support_summary(c.id) END);
END $$;
REVOKE ALL ON FUNCTION public.central_support_license_usage(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.central_support_license_usage(text) TO service_role;
COMMIT;
