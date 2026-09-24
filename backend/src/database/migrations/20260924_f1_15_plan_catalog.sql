-- Versioned catalog. Applying a plan copies its limits; later edits are not retroactive.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
INSERT INTO public.permissions(id,code,name,module,resource,action) VALUES
('e23a5c98-8b68-4ed2-aef8-70a7166407e4','platform.plans.view','Consultar planos','platform','plans','view'),
('af285642-16b0-405a-982c-58de1a10f987','platform.plans.manage','Administrar planos','platform','plans','manage')
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.permissions WHERE id='e23a5c98-8b68-4ed2-aef8-70a7166407e4' AND code='platform.plans.view') OR
 NOT EXISTS(SELECT 1 FROM public.permissions WHERE id='af285642-16b0-405a-982c-58de1a10f987' AND code='platform.plans.manage') THEN RAISE EXCEPTION 'Plan permission mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.roles WHERE name='admin_platform' AND scope='global' AND jsonb_typeof(permissions)='array') THEN RAISE EXCEPTION 'Platform administrator missing'; END IF;
END $$;
UPDATE public.roles SET permissions=permissions || '["e23a5c98-8b68-4ed2-aef8-70a7166407e4"]'::jsonb WHERE name='admin_platform' AND scope='global' AND NOT permissions ? 'e23a5c98-8b68-4ed2-aef8-70a7166407e4';
UPDATE public.roles SET permissions=permissions || '["af285642-16b0-405a-982c-58de1a10f987"]'::jsonb WHERE name='admin_platform' AND scope='global' AND NOT permissions ? 'af285642-16b0-405a-982c-58de1a10f987';
CREATE TABLE IF NOT EXISTS public.plan_catalog (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 120),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),documents_limit integer NOT NULL CHECK(documents_limit>=0),
 max_consumer_units integer NOT NULL CHECK(max_consumer_units>=0),max_users integer NOT NULL CHECK(max_users>=0),
 document_management boolean NOT NULL,advanced_analytics boolean NOT NULL,report_generation boolean NOT NULL,free_market_management boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS plan_catalog_name_unique ON public.plan_catalog(lower(btrim(name)));
ALTER TABLE public.plan_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_catalog FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.plan_catalog TO service_role;
CREATE TABLE IF NOT EXISTS public.platform_plan_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_id uuid NOT NULL REFERENCES public.plan_catalog(id),
 actor_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('CREATE','UPDATE')),
 changes jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),ip_address text,user_agent text
);
ALTER TABLE public.platform_plan_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_plan_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.platform_plan_audit TO service_role;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.plan_catalog(id);
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS plan_version integer;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS max_users integer CHECK(max_users>=0);
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS plan_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous jsonb; saved public.plan_catalog; actual_version integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id::text=actor_id::text AND r.scope='global' AND r.permissions ? 'af285642-16b0-405a-982c-58de1a10f987') THEN RAISE EXCEPTION 'Plan administration denied' USING ERRCODE='42501'; END IF;
 IF target_id IS NULL THEN
  INSERT INTO public.plan_catalog(name,description,active,documents_limit,max_consumer_units,max_users,document_management,advanced_analytics,report_generation,free_market_management)
  VALUES(btrim(definition->>'name'),definition->>'description',(definition->>'active')::boolean,(definition->>'documents_limit')::integer,(definition->>'max_consumer_units')::integer,(definition->>'max_users')::integer,(definition->>'document_management')::boolean,(definition->>'advanced_analytics')::boolean,(definition->>'report_generation')::boolean,(definition->>'free_market_management')::boolean) RETURNING * INTO saved;
 ELSE
  SELECT to_jsonb(p),p.version INTO previous,actual_version FROM public.plan_catalog p WHERE p.id=target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan missing' USING ERRCODE='P3150'; END IF;
  IF expected_version IS DISTINCT FROM actual_version THEN RAISE EXCEPTION 'Plan changed, reload' USING ERRCODE='P3151'; END IF;
  UPDATE public.plan_catalog SET name=btrim(definition->>'name'),description=definition->>'description',active=(definition->>'active')::boolean,
   documents_limit=(definition->>'documents_limit')::integer,max_consumer_units=(definition->>'max_consumer_units')::integer,max_users=(definition->>'max_users')::integer,
   document_management=(definition->>'document_management')::boolean,advanced_analytics=(definition->>'advanced_analytics')::boolean,report_generation=(definition->>'report_generation')::boolean,free_market_management=(definition->>'free_market_management')::boolean,version=version+1,updated_at=now() WHERE id=target_id RETURNING * INTO saved;
 END IF;
 INSERT INTO public.platform_plan_audit(plan_id,actor_id,action,changes,ip_address,user_agent)
 VALUES(saved.id,actor_id,CASE WHEN target_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END,jsonb_build_object('before',previous,'after',to_jsonb(saved)),audit_ip,audit_agent);
 RETURN to_jsonb(saved);
END $$;

CREATE OR REPLACE FUNCTION public.create_license_from_plan(target_organization text,target_plan uuid,expected_version integer,starts date,ends date,renews date,actor_id uuid,audit_ip text,audit_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.plan_catalog; saved public.licenses;
BEGIN
 IF starts IS NULL OR renews IS NULL OR (ends IS NOT NULL AND ends<starts) THEN RAISE EXCEPTION 'Invalid dates' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=target_organization AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Organization missing' USING ERRCODE='P3150'; END IF;
 SELECT * INTO p FROM public.plan_catalog WHERE id=target_plan FOR SHARE;
 IF NOT FOUND OR NOT p.active THEN RAISE EXCEPTION 'Active plan missing' USING ERRCODE='P3150'; END IF;
 IF p.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'Plan changed, reload' USING ERRCODE='P3151'; END IF;
 INSERT INTO public.licenses(id,organization_id,license_type,documents_limit,documents_used,renewal_date,start_date,end_date,status,active,max_consumer_units,max_users,document_management,advanced_analytics,report_generation,free_market_management,plan_id,plan_version,plan_snapshot)
 VALUES(gen_random_uuid()::text,target_organization,p.name,p.documents_limit,0,renews,starts,ends,'ACTIVE',true,p.max_consumer_units,p.max_users,p.document_management,p.advanced_analytics,p.report_generation,p.free_market_management,p.id,p.version,to_jsonb(p)) RETURNING * INTO saved;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent)
 VALUES(gen_random_uuid()::text,target_organization,actor_id,'CREATE','license',saved.id::text,jsonb_build_object('after',to_jsonb(saved)),'success',audit_ip,audit_agent);
 RETURN to_jsonb(saved);
END $$;

CREATE OR REPLACE FUNCTION public.enforce_membership_license_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cap integer; used integer;
BEGIN
 IF NEW.status<>'active' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN IF OLD.status='active' AND OLD.organization_id=NEW.organization_id THEN RETURN NEW; END IF; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 SELECT min(max_users) INTO cap FROM public.licenses WHERE organization_id=NEW.organization_id AND active=true AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
 IF cap IS NOT NULL THEN
  SELECT count(*) INTO used FROM public.organization_members WHERE organization_id=NEW.organization_id AND status='active' AND id<>NEW.id;
  IF used>=cap THEN RAISE EXCEPTION 'Organization user quota exceeded' USING ERRCODE='P3152'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS membership_license_limit ON public.organization_members;
CREATE TRIGGER membership_license_limit BEFORE INSERT OR UPDATE OF status,organization_id ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_license_limit();
CREATE OR REPLACE FUNCTION public.validate_license_user_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 IF NEW.active AND lower(NEW.status)='active' AND NEW.max_users IS NOT NULL AND NEW.start_date<=CURRENT_DATE AND (NEW.end_date IS NULL OR NEW.end_date>=CURRENT_DATE) THEN
  IF (SELECT count(*) FROM public.organization_members WHERE organization_id=NEW.organization_id AND status='active')>NEW.max_users THEN RAISE EXCEPTION 'License user limit below active membership count' USING ERRCODE='P3152'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS license_user_limit ON public.licenses;
CREATE TRIGGER license_user_limit BEFORE INSERT OR UPDATE OF max_users,status,active,start_date,end_date ON public.licenses FOR EACH ROW EXECUTE FUNCTION public.validate_license_user_limit();
REVOKE ALL ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.create_license_from_plan(text,uuid,integer,date,date,date,uuid,text,text),public.enforce_membership_license_limit(),public.validate_license_user_limit() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.create_license_from_plan(text,uuid,integer,date,date,date,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
