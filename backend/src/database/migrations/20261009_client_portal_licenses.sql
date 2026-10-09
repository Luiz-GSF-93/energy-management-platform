BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Additive, disabled rollout. Existing license snapshots and financial data are untouched.
ALTER TABLE public.plan_catalog ADD COLUMN max_clients integer CHECK(max_clients>=0);
ALTER TABLE public.licenses ADD COLUMN max_clients integer CHECK(max_clients>=0);
CREATE TABLE public.client_portal_policies (
 organization_id text PRIMARY KEY REFERENCES public.organizations(id), enabled boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid NOT NULL
);
CREATE TABLE public.client_portal_licenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),status text NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED','CANCELLED')),
 starts date NOT NULL,ends date NOT NULL CHECK(ends>=starts),modules jsonb NOT NULL CHECK(jsonb_typeof(modules)='array'),
 max_users integer NOT NULL CHECK(max_users>=0),max_units integer NOT NULL CHECK(max_units>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_by uuid NOT NULL,updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,customer_id)
);
CREATE TABLE public.license_client_additions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 license_id text NOT NULL REFERENCES public.licenses(id),slots integer NOT NULL CHECK(slots>0),
 starts date NOT NULL,ends date NOT NULL CHECK(ends>=starts),status text NOT NULL CHECK(status IN ('ACTIVE','CANCELLED')),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 3 AND 500),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL,updated_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.client_portal_license_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 actor_id uuid NOT NULL,actor_name text,actor_affiliation text NOT NULL DEFAULT 'platform',actor_role text NOT NULL DEFAULT 'admin_platform',kind text NOT NULL,resource_id text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
 before_snapshot jsonb,after_snapshot jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_portal_events_org_time ON public.client_portal_license_events(organization_id,created_at DESC);
CREATE INDEX client_additions_org_license ON public.license_client_additions(organization_id,license_id);
CREATE FUNCTION public.snapshot_portal_actor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.assert_license_platform_actor(NEW.actor_id);
 SELECT coalesce(nullif(btrim(m.display_name),''),nullif(btrim(p.name),'')) INTO NEW.actor_name
 FROM public.user_profiles p LEFT JOIN public.organization_members m ON m.user_id=p.user_id AND m.organization_id=NEW.organization_id WHERE p.user_id=NEW.actor_id;
 NEW.actor_affiliation:='platform';NEW.actor_role:='admin_platform';RETURN NEW;
END $$;
CREATE TRIGGER snapshot_portal_actor BEFORE INSERT ON public.client_portal_license_events FOR EACH ROW EXECUTE FUNCTION public.snapshot_portal_actor();
CREATE FUNCTION public.client_portal_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Portal license history is immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER client_portal_history_immutable BEFORE UPDATE OR DELETE ON public.client_portal_license_events FOR EACH ROW EXECUTE FUNCTION public.client_portal_history_immutable();
ALTER TABLE public.client_portal_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_portal_policies FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.client_portal_policies TO service_role;
ALTER TABLE public.client_portal_licenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_portal_licenses FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.client_portal_licenses TO service_role;
ALTER TABLE public.license_client_additions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.license_client_additions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.license_client_additions TO service_role;
ALTER TABLE public.client_portal_license_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_portal_license_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.client_portal_license_events TO service_role;
ALTER FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) RENAME TO save_catalog_plan_before_clients;
REVOKE ALL ON FUNCTION public.save_catalog_plan_before_clients(uuid,integer,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; previous_limit integer; next_limit integer;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 PERFORM pg_advisory_xact_lock(60405);
 IF target_id IS NOT NULL THEN SELECT max_clients INTO previous_limit FROM public.plan_catalog WHERE id=target_id FOR UPDATE; END IF;
 next_limit:=previous_limit;
 IF definition ? 'max_clients' THEN
  IF jsonb_typeof(definition->'max_clients')<>'number' OR (definition->>'max_clients') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Invalid client quota' USING ERRCODE='22023'; END IF;
  next_limit:=(definition->>'max_clients')::integer;
 END IF;
 saved:=public.save_catalog_plan_before_clients(target_id,expected_version,definition-'max_clients',actor_id,audit_ip,audit_agent);
 UPDATE public.plan_catalog SET max_clients=next_limit WHERE id=(saved->>'id')::uuid RETURNING to_jsonb(plan_catalog.*) INTO saved;
 -- Finalize only the current transaction's catalog audit entry, never an earlier snapshot.
 UPDATE public.platform_plan_audit SET changes=jsonb_set(changes,'{after}',saved) WHERE plan_id=(saved->>'id')::uuid AND (changes->'after'->>'version')::integer=(saved->>'version')::integer;
 RETURN saved;
END $$;
CREATE FUNCTION public.client_capacity(org text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lic public.licenses; n integer; used bigint; extra bigint; enabled boolean; cap bigint;
BEGIN
 SELECT coalesce((SELECT p.enabled FROM public.client_portal_policies p WHERE p.organization_id=org),false) INTO enabled;
 SELECT count(*) INTO used FROM public.customers WHERE organization_id=org AND deleted_at IS NULL;
 SELECT count(*) INTO n FROM public.licenses WHERE organization_id=org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
 IF n=1 THEN
  SELECT * INTO lic FROM public.licenses WHERE organization_id=org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
  SELECT coalesce(sum(slots::bigint),0) INTO extra FROM public.license_client_additions WHERE organization_id=org AND license_id=lic.id AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE;
  IF lic.max_clients IS NOT NULL THEN cap:=lic.max_clients::bigint+extra; END IF;
 END IF;
 RETURN jsonb_build_object('enabled',enabled,'licenseId',lic.id,'base',lic.max_clients,'additional',coalesce(extra,0),'contracted',cap,'used',used,'available',CASE WHEN cap IS NULL THEN NULL ELSE greatest(0,cap-used) END,'configured',n=1 AND cap IS NOT NULL);
END $$;
CREATE FUNCTION public.snapshot_client_license_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE used bigint;
BEGIN
 IF TG_OP='INSERT' OR NEW.plan_snapshot IS DISTINCT FROM OLD.plan_snapshot THEN
  NEW.max_clients:=(NEW.plan_snapshot->>'max_clients')::integer;
 ELSE NEW.max_clients:=OLD.max_clients; END IF;
 IF NEW.active AND lower(NEW.status)='active' AND NEW.max_clients IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
  SELECT count(*) INTO used FROM public.customers WHERE organization_id=NEW.organization_id AND deleted_at IS NULL;
  IF NEW.max_clients::bigint+coalesce((SELECT sum(slots::bigint) FROM public.license_client_additions WHERE organization_id=NEW.organization_id AND license_id=NEW.id AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE),0)<used THEN RAISE EXCEPTION 'Client quota below retained usage' USING ERRCODE='P3412'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_license_snapshot BEFORE INSERT OR UPDATE ON public.licenses FOR EACH ROW EXECUTE FUNCTION public.snapshot_client_license_capacity();
CREATE FUNCTION public.enforce_client_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 IF NOT coalesce((SELECT enabled FROM public.client_portal_policies WHERE organization_id=NEW.organization_id),false) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'Customer organization is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.deleted_at IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 state:=public.client_capacity(NEW.organization_id);
 IF state->>'configured'<>'true' THEN RAISE EXCEPTION 'Configure client quota in catalog license' USING ERRCODE='P3410'; END IF;
 IF (state->>'available')::bigint<=0 THEN RAISE EXCEPTION 'Client quota exceeded; request upgrade or addition' USING ERRCODE='P3411'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_client_capacity BEFORE INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.enforce_client_capacity();
CREATE FUNCTION public.client_portal_parent_license(org text) RETURNS public.licenses LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lic public.licenses;
BEGIN
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1 THEN RAISE EXCEPTION 'One effective organization license required' USING ERRCODE='42501'; END IF;
 SELECT * INTO lic FROM public.licenses WHERE organization_id=org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
 IF lic.plan_id IS NULL OR lic.plan_version IS NULL OR lic.max_users IS NULL OR lic.max_consumer_units IS NULL THEN RAISE EXCEPTION 'Regularize parent catalog license before Portal preparation' USING ERRCODE='P3410'; END IF;
 RETURN lic;
END $$;
CREATE FUNCTION public.check_portal_modules(lic public.licenses,modules jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_typeof(modules)='array' AND jsonb_array_length(modules)<=6 AND jsonb_array_length(modules)=(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(modules) x) AND NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements_text(modules) x WHERE CASE x
 WHEN 'reports' THEN lic.report_generation AND lic.free_market_management
 WHEN 'forecasts' THEN lic.report_generation AND lic.free_market_management AND lic.advanced_analytics
 WHEN 'energy_prices' THEN lic.report_generation AND lic.free_market_management
 WHEN 'acl' THEN lic.free_market_management
 WHEN 'documents' THEN lic.document_management
 WHEN 'bot' THEN lic.bot_energy_rag AND lic.report_generation AND lic.free_market_management
 ELSE false END IS DISTINCT FROM true),false);
$$;
CREATE FUNCTION public.save_client_portal_license(p_org text,p_customer text,p_actor uuid,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous public.client_portal_licenses; saved public.client_portal_licenses; lic public.licenses; revision integer; reason text;
BEGIN
 PERFORM public.assert_license_platform_actor(p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND organization_id=p_org AND deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Customer outside organization' USING ERRCODE='42501'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR NOT p_data ?& ARRAY['revision','status','starts','ends','modules','maxUsers','maxUnits','reason'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('revision','status','starts','ends','modules','maxUsers','maxUnits','reason')) THEN RAISE EXCEPTION 'Invalid portal license fields' USING ERRCODE='22023'; END IF;
 lic:=public.client_portal_parent_license(p_org);reason:=btrim(p_data->>'reason');revision:=(p_data->>'revision')::integer;
 IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 1000 OR p_data->>'status' NOT IN ('ACTIVE','SUSPENDED','CANCELLED') OR (p_data->>'starts')::date IS NULL OR (p_data->>'ends')::date IS NULL OR (p_data->>'ends')::date<(p_data->>'starts')::date OR NOT public.check_portal_modules(lic,p_data->'modules') OR (p_data->>'maxUsers')::integer IS NULL OR (p_data->>'maxUnits')::integer IS NULL OR (p_data->>'maxUsers')::integer<0 OR (p_data->>'maxUnits')::integer<0 OR (p_data->>'maxUsers')::integer>lic.max_users OR (p_data->>'maxUnits')::integer>lic.max_consumer_units THEN RAISE EXCEPTION 'Portal conditions exceed parent license or are invalid' USING ERRCODE='22023'; END IF;
 IF (p_data->>'starts')::date<lic.start_date OR (lic.end_date IS NOT NULL AND (p_data->>'ends')::date>lic.end_date) THEN RAISE EXCEPTION 'Portal dates exceed parent license' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND exclusive_customer_id=p_customer AND status='active' AND affiliation_type='external')>(p_data->>'maxUsers')::integer OR (SELECT count(*) FROM public.consumer_units WHERE organization_id=p_org AND customer_id=p_customer)>(p_data->>'maxUnits')::integer THEN RAISE EXCEPTION 'Portal limit below retained usage' USING ERRCODE='P3412'; END IF;
 SELECT * INTO previous FROM public.client_portal_licenses WHERE organization_id=p_org AND customer_id=p_customer FOR UPDATE;
 IF NOT FOUND THEN
  IF revision IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Portal license revision changed' USING ERRCODE='P3413'; END IF;
  INSERT INTO public.client_portal_licenses(organization_id,customer_id,status,starts,ends,modules,max_users,max_units,created_by,updated_by) VALUES(p_org,p_customer,p_data->>'status',(p_data->>'starts')::date,(p_data->>'ends')::date,p_data->'modules',(p_data->>'maxUsers')::integer,(p_data->>'maxUnits')::integer,p_actor,p_actor) RETURNING * INTO saved;
 ELSE
  IF revision IS DISTINCT FROM previous.revision THEN RAISE EXCEPTION 'Portal license revision changed' USING ERRCODE='P3413'; END IF;
  -- Customer uniqueness and optimistic revision prevent duplicate grants on retry.
  UPDATE public.client_portal_licenses SET status=p_data->>'status',starts=(p_data->>'starts')::date,ends=(p_data->>'ends')::date,modules=p_data->'modules',max_users=(p_data->>'maxUsers')::integer,max_units=(p_data->>'maxUnits')::integer,revision=client_portal_licenses.revision+1,updated_by=p_actor,updated_at=now() WHERE id=previous.id RETURNING * INTO saved;
 END IF;
 INSERT INTO public.client_portal_license_events(organization_id,actor_id,kind,resource_id,reason,before_snapshot,after_snapshot) VALUES(p_org,p_actor,'PORTAL_LICENSE',saved.id::text,reason,CASE WHEN previous.id IS NULL THEN NULL ELSE to_jsonb(previous) END,to_jsonb(saved));
 RETURN to_jsonb(saved);
END $$;
CREATE FUNCTION public.set_client_portal_policy(p_org text,p_actor uuid,p_enabled boolean,p_revision integer,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous public.client_portal_policies; saved public.client_portal_policies; capacity jsonb;
BEGIN
 PERFORM public.assert_license_platform_actor(p_actor);PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
 IF p_enabled IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid rollout definition' USING ERRCODE='22023'; END IF;
 IF p_enabled THEN
  capacity:=public.client_capacity(p_org);
  IF capacity->>'configured'<>'true' OR (capacity->>'contracted')::bigint<(capacity->>'used')::bigint THEN RAISE EXCEPTION 'Configure compatible client quota before activation' USING ERRCODE='P3410'; END IF;
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
CREATE FUNCTION public.save_license_client_addition(p_org text,p_actor uuid,p_id uuid,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lic public.licenses; previous public.license_client_additions; saved public.license_client_additions;
BEGIN
 PERFORM public.assert_license_platform_actor(p_actor);PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));lic:=public.client_portal_parent_license(p_org);
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR NOT p_data ?& ARRAY['revision','slots','starts','ends','status','reference','reason'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('revision','slots','starts','ends','status','reference','reason')) OR p_id IS NULL THEN RAISE EXCEPTION 'Invalid addition fields' USING ERRCODE='22023'; END IF;
 IF lic.max_clients IS NULL OR (p_data->>'slots')::integer IS NULL OR (p_data->>'slots')::integer<=0 OR p_data->>'status' NOT IN ('ACTIVE','CANCELLED') OR (p_data->>'starts')::date IS NULL OR (p_data->>'ends')::date IS NULL OR (p_data->>'ends')::date<(p_data->>'starts')::date OR (p_data->>'starts')::date<lic.start_date OR (lic.end_date IS NOT NULL AND (p_data->>'ends')::date>lic.end_date) OR length(btrim(p_data->>'reference')) NOT BETWEEN 3 AND 500 OR length(btrim(p_data->>'reason')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Invalid client addition' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous FROM public.license_client_additions WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF previous.organization_id<>p_org OR previous.license_id<>lic.id THEN RAISE EXCEPTION 'Addition outside license scope' USING ERRCODE='42501'; END IF;
  IF previous.revision IS DISTINCT FROM (p_data->>'revision')::integer THEN RAISE EXCEPTION 'Addition revision changed' USING ERRCODE='P3413'; END IF;
  UPDATE public.license_client_additions SET slots=(p_data->>'slots')::integer,starts=(p_data->>'starts')::date,ends=(p_data->>'ends')::date,status=p_data->>'status',reference=btrim(p_data->>'reference'),revision=revision+1,updated_by=p_actor WHERE id=p_id RETURNING * INTO saved;
 ELSE
  IF (p_data->>'revision')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Addition revision changed' USING ERRCODE='P3413'; END IF;
  INSERT INTO public.license_client_additions(id,organization_id,license_id,slots,starts,ends,status,reference,created_by,updated_by) VALUES(p_id,p_org,lic.id,(p_data->>'slots')::integer,(p_data->>'starts')::date,(p_data->>'ends')::date,p_data->>'status',btrim(p_data->>'reference'),p_actor,p_actor) RETURNING * INTO saved;
 END IF;
 INSERT INTO public.client_portal_license_events(organization_id,actor_id,kind,resource_id,reason,before_snapshot,after_snapshot) VALUES(p_org,p_actor,'CLIENT_ADDITION',p_id::text,btrim(p_data->>'reason'),CASE WHEN previous.id IS NULL THEN NULL ELSE to_jsonb(previous) END,to_jsonb(saved));
 RETURN to_jsonb(saved);
END $$;
CREATE FUNCTION public.client_portal_entitlement(p_org text,p_actor text,p_role text,p_module text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer text; portal public.client_portal_licenses; lic public.licenses; enabled boolean;
BEGIN
 IF p_module IS NOT NULL AND p_module NOT IN ('reports','forecasts','energy_prices','acl','documents','bot') THEN RAISE EXCEPTION 'Invalid portal module' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Client scope required' USING ERRCODE='42501'; END IF;
 SELECT c.id INTO customer FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' JOIN public.customers c ON c.id=m.exclusive_customer_id AND c.organization_id=m.organization_id JOIN public.organizations o ON o.id=m.organization_id AND o.deleted_at IS NULL
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id=p_role AND m.status='active' AND m.affiliation_type='external' AND r.name='consulta' AND c.status='ACTIVE' AND c.deleted_at IS NULL;
 IF customer IS NULL THEN RAISE EXCEPTION 'Exclusive client scope required' USING ERRCODE='42501'; END IF;
 SELECT coalesce((SELECT p.enabled FROM public.client_portal_policies p WHERE p.organization_id=p_org),false) INTO enabled;
 IF NOT enabled THEN RETURN jsonb_build_object('enabled',false); END IF;
 lic:=public.client_portal_parent_license(p_org);
 SELECT * INTO portal FROM public.client_portal_licenses WHERE organization_id=p_org AND customer_id=customer AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE;
 IF NOT FOUND OR NOT public.check_portal_modules(lic,portal.modules) OR (p_module IS NOT NULL AND NOT (portal.modules ? p_module)) THEN RAISE EXCEPTION 'Portal license or module unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('enabled',true,'organizationId',p_org,'customerId',customer,'status',portal.status,'starts',portal.starts,'ends',portal.ends,'modules',portal.modules,'maxUsers',portal.max_users,'maxUnits',portal.max_units,'revision',portal.revision);
END $$;
CREATE FUNCTION public.enforce_client_portal_resource_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
  SELECT max_users INTO cap FROM public.client_portal_licenses WHERE organization_id=NEW.organization_id AND customer_id=customer AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE;
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
CREATE TRIGGER portal_member_capacity BEFORE INSERT OR UPDATE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.enforce_client_portal_resource_capacity();
CREATE TRIGGER portal_unit_capacity BEFORE INSERT OR UPDATE ON public.consumer_units FOR EACH ROW EXECUTE FUNCTION public.enforce_client_portal_resource_capacity();
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['save_catalog_plan(uuid,integer,jsonb,uuid,text,text)','client_capacity(text)','save_client_portal_license(text,text,uuid,jsonb)','set_client_portal_policy(text,uuid,boolean,integer,text)','save_license_client_addition(text,uuid,uuid,jsonb)','client_portal_entitlement(text,text,text,text)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION public.'||signature||' FROM PUBLIC,anon,authenticated,service_role';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||signature||' TO service_role';
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_portal_actor(),public.client_portal_parent_license(text),public.check_portal_modules(public.licenses,jsonb),public.client_portal_history_immutable(),public.snapshot_client_license_capacity(),public.enforce_client_capacity(),public.enforce_client_portal_resource_capacity() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
