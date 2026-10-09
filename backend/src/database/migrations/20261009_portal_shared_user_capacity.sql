-- Supersedes the unactivated company quota with the existing shared active-user quota.
-- No rows, grants, identities, roles, limits or rollout flags are changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DROP TRIGGER IF EXISTS client_license_snapshot ON public.licenses;
CREATE OR REPLACE FUNCTION public.client_capacity(org text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lic public.licenses; used bigint; cap bigint; n bigint; enabled boolean;
BEGIN
 SELECT coalesce((SELECT p.enabled FROM public.client_portal_policies p WHERE p.organization_id=org),false) INTO enabled;
 SELECT count(*) INTO used FROM public.organization_members WHERE organization_id=org AND status='active';
 SELECT count(*) INTO n FROM public.licenses WHERE organization_id=org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
 IF n=1 THEN
  SELECT * INTO lic FROM public.licenses WHERE organization_id=org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
  cap:=lic.max_users;
 END IF;
 RETURN jsonb_build_object('enabled',enabled,'licenseId',lic.id,'base',cap,'additional',0,'contracted',cap,'used',used,'available',CASE WHEN cap IS NULL THEN NULL ELSE greatest(0,cap-used) END,'configured',n=1 AND cap IS NOT NULL AND lic.plan_id IS NOT NULL AND lic.plan_version IS NOT NULL,'resource','users','shared',true);
END $$;
CREATE OR REPLACE FUNCTION public.enforce_client_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 IF coalesce((SELECT enabled FROM public.client_portal_policies WHERE organization_id=NEW.organization_id),false) AND TG_OP='UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'Customer organization is immutable' USING ERRCODE='23514'; END IF;
 -- Registering/restoring a company does not consume a user seat. Existing member quota triggers remain authoritative.
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.set_client_portal_policy(p_org text,p_actor uuid,p_enabled boolean,p_revision integer,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous public.client_portal_policies; saved public.client_portal_policies; capacity jsonb;
BEGIN
 PERFORM public.assert_license_platform_actor(p_actor);PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
 IF p_enabled IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid rollout definition' USING ERRCODE='22023'; END IF;
 IF p_enabled THEN
  capacity:=public.client_capacity(p_org);
  IF capacity->>'configured'<>'true' OR (capacity->>'contracted')::bigint<(capacity->>'used')::bigint THEN RAISE EXCEPTION 'Regularize shared user quota before activation' USING ERRCODE='P3410'; END IF;
  IF EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_org AND m.status='active' AND m.affiliation_type='external' AND m.exclusive_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.client_portal_licenses l WHERE l.organization_id=p_org AND l.customer_id=m.exclusive_customer_id AND l.status='ACTIVE' AND l.starts<=CURRENT_DATE AND l.ends>=CURRENT_DATE)) THEN RAISE EXCEPTION 'Existing clients need portal licenses before activation' USING ERRCODE='P3410'; END IF;
 END IF;
 SELECT * INTO previous FROM public.client_portal_policies WHERE organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN
  IF p_revision IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Rollout revision changed' USING ERRCODE='P3413'; END IF;
  INSERT INTO public.client_portal_policies(organization_id,enabled,updated_by) VALUES(p_org,p_enabled,p_actor) RETURNING * INTO saved;
 ELSE
  IF p_revision IS DISTINCT FROM previous.revision THEN RAISE EXCEPTION 'Rollout revision changed' USING ERRCODE='P3413'; END IF;
  UPDATE public.client_portal_policies SET enabled=p_enabled,revision=revision+1,updated_by=p_actor,updated_at=now() WHERE organization_id=p_org RETURNING * INTO saved;
 END IF;
 INSERT INTO public.client_portal_license_events(organization_id,actor_id,kind,resource_id,reason,before_snapshot,after_snapshot) VALUES(p_org,p_actor,'PORTAL_ROLLOUT',p_org,btrim(p_reason),CASE WHEN previous.organization_id IS NULL THEN NULL ELSE to_jsonb(previous) END,to_jsonb(saved));
 RETURN to_jsonb(saved);
END $$;
CREATE OR REPLACE FUNCTION public.save_license_client_addition(p_org text,p_actor uuid,p_id uuid,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.assert_license_platform_actor(p_actor);
 RAISE EXCEPTION 'Company additions retired; update the contracted shared user plan through existing governance' USING ERRCODE='22023';
END $$;
CREATE OR REPLACE FUNCTION public.enforce_client_portal_resource_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer text; cap integer; used bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 IF NOT coalesce((SELECT enabled FROM public.client_portal_policies WHERE organization_id=NEW.organization_id),false) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='organization_members' THEN
  IF NEW.status<>'active' OR NEW.affiliation_type IS DISTINCT FROM 'external' OR NEW.exclusive_customer_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='active' AND OLD.affiliation_type='external' AND OLD.exclusive_customer_id=NEW.exclusive_customer_id THEN RETURN NEW; END IF;
  customer:=NEW.exclusive_customer_id;
 ELSE
  IF TG_OP='UPDATE' AND OLD.customer_id=NEW.customer_id THEN RETURN NEW; END IF;
  customer:=NEW.customer_id;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 IF TG_TABLE_NAME='organization_members' THEN
  IF NOT EXISTS(SELECT 1 FROM public.roles r JOIN public.customers c ON c.id=customer AND c.organization_id=NEW.organization_id AND c.status='ACTIVE' AND c.deleted_at IS NULL WHERE r.id=NEW.role_id AND r.organization_id=NEW.organization_id AND r.scope='organization' AND r.name='consulta') THEN RAISE EXCEPTION 'Exclusive client and read-only role required' USING ERRCODE='42501'; END IF;
  SELECT max_users INTO cap FROM public.client_portal_licenses WHERE organization_id=NEW.organization_id AND customer_id=customer AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE AND public.check_portal_modules(public.client_portal_parent_license(NEW.organization_id),modules);
  IF cap IS NULL THEN RAISE EXCEPTION 'Client portal license required for external membership' USING ERRCODE='P3410'; END IF;
  SELECT count(*) INTO used FROM public.organization_members WHERE organization_id=NEW.organization_id AND exclusive_customer_id=customer AND status='active' AND affiliation_type='external' AND id<>NEW.id;
 ELSE
  SELECT max_units INTO cap FROM public.client_portal_licenses WHERE organization_id=NEW.organization_id AND customer_id=customer AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE;
  IF cap IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO used FROM public.consumer_units WHERE organization_id=NEW.organization_id AND customer_id=customer AND id<>NEW.id;
 END IF;
 IF used>=cap THEN RAISE EXCEPTION 'Client portal resource quota exceeded' USING ERRCODE='P3411'; END IF;
 RETURN NEW;
END $$;
-- Existing ACLs/RLS remain unchanged; retired columns/tables are retained for compatibility and history.
NOTIFY pgrst,'reload schema';
COMMIT;
