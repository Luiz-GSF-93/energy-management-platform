-- F1.39: platform-owned licensing, retained-resource quotas, upgrade requests.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.plan_catalog ADD COLUMN IF NOT EXISTS documents_unlimited boolean NOT NULL DEFAULT false;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS documents_unlimited boolean NOT NULL DEFAULT false;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS governance_revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS public.license_upgrade_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 requested_by uuid NOT NULL, note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS license_upgrade_one_pending ON public.license_upgrade_requests(organization_id) WHERE status='pending';
ALTER TABLE public.license_upgrade_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.license_upgrade_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.license_upgrade_requests TO service_role;
CREATE OR REPLACE FUNCTION public.assert_license_platform_actor(actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id::text=actor::text AND r.name='admin_platform' AND r.scope='global') THEN RAISE EXCEPTION 'Only platform administrator can manage licenses' USING ERRCODE='42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.organization_resource_usage(org text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('users',(SELECT count(*) FROM public.organization_members WHERE organization_id=org AND status='active'),
 'units',(SELECT count(*) FROM public.consumer_units u WHERE organization_id=org AND to_jsonb(u)->>'deleted_at' IS NULL),
 'documents',(SELECT count(*) FROM public.documents WHERE organization_id=org));
$$;
-- Guard every capacity-consuming insertion/restoration, including the contract wizard.
CREATE OR REPLACE FUNCTION public.enforce_organization_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lic public.licenses; n integer; used bigint; resource text; cap bigint;
BEGIN
 IF TG_OP='UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'Resource organization is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='organization_members' THEN
  IF NEW.status<>'active' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='active' THEN RETURN NEW; END IF;
  resource:='users';
 ELSIF TG_TABLE_NAME='consumer_units' THEN
  IF to_jsonb(NEW)->>'deleted_at' IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)->>'deleted_at' IS NULL THEN RETURN NEW; END IF;
  resource:='units';
 ELSE
  IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
  resource:='documents';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 SELECT count(*) INTO n FROM public.licenses WHERE organization_id=NEW.organization_id AND active=true AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
 IF n<>1 THEN RAISE EXCEPTION 'Active license required' USING ERRCODE='P3390'; END IF;
 SELECT * INTO lic FROM public.licenses WHERE organization_id=NEW.organization_id AND active=true AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
 IF lic.plan_id IS NULL THEN RAISE EXCEPTION 'Select a catalog plan before new registrations' USING ERRCODE='P3392'; END IF;
 IF resource='documents' AND lic.document_management IS DISTINCT FROM true THEN RAISE EXCEPTION 'DOCUMENT_LICENSE_REQUIRED'; END IF;
 used:=(public.organization_resource_usage(NEW.organization_id)->>resource)::bigint;
 cap:=CASE resource WHEN 'users' THEN lic.max_users WHEN 'units' THEN lic.max_consumer_units ELSE lic.documents_limit END;
 IF resource='documents' AND lic.documents_unlimited THEN cap:=NULL; END IF;
 -- Legacy missing limits remain visible as requiring regularization; new plans require finite user/unit limits.
 IF cap IS NOT NULL AND used>=cap THEN RAISE EXCEPTION 'Organization capacity exceeded: %',resource USING ERRCODE='P3391'; END IF;
 IF resource='documents' THEN NEW.upload_license_id:=lic.id; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS membership_license_limit ON public.organization_members;
CREATE TRIGGER membership_license_limit BEFORE INSERT OR UPDATE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_capacity();
DROP TRIGGER IF EXISTS enforce_unit_capacity ON public.consumer_units;
CREATE TRIGGER enforce_unit_capacity BEFORE INSERT OR UPDATE ON public.consumer_units FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_capacity();
DROP TRIGGER IF EXISTS enforce_document_upload_quota ON public.documents;
CREATE TRIGGER enforce_document_upload_quota BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_capacity();
-- Keep the legacy counter consistent for existing dashboards; decisions use retained records above.
CREATE OR REPLACE FUNCTION public.refresh_document_usage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org text;
BEGIN
 org:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
 PERFORM pg_advisory_xact_lock(hashtextextended(org,315));
 UPDATE public.licenses SET documents_used=(SELECT count(*) FROM public.documents WHERE organization_id=org) WHERE organization_id=org;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS refresh_document_usage ON public.documents;
CREATE TRIGGER refresh_document_usage AFTER INSERT OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.refresh_document_usage();
UPDATE public.licenses l SET documents_used=(SELECT count(*) FROM public.documents d WHERE d.organization_id=l.organization_id);
CREATE OR REPLACE FUNCTION public.guard_license_governance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE usage jsonb; actor uuid;
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'documents_used'-'updated_at')=(to_jsonb(OLD)-'documents_used'-'updated_at') THEN RETURN NEW; END IF;
 actor:=NULLIF(current_setting('app.license_actor',true),'')::uuid;
 PERFORM public.assert_license_platform_actor(actor);
 IF NEW.plan_id IS NULL OR NEW.plan_snapshot IS NULL OR NEW.max_users IS NULL OR NEW.max_consumer_units IS NULL THEN RAISE EXCEPTION 'Select a catalog plan' USING ERRCODE='P3392'; END IF;
 IF TG_OP='UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN RAISE EXCEPTION 'License organization is immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 usage:=public.organization_resource_usage(NEW.organization_id);
 IF NEW.active AND lower(NEW.status)='active' THEN
  IF NEW.max_users<(usage->>'users')::bigint OR NEW.max_consumer_units<(usage->>'units')::bigint OR (NOT NEW.documents_unlimited AND NEW.documents_limit<(usage->>'documents')::bigint) THEN RAISE EXCEPTION 'Plan below current usage' USING ERRCODE='P3393'; END IF;
 END IF;
 NEW.documents_used:=(usage->>'documents')::integer;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS license_governance ON public.licenses;
CREATE TRIGGER license_governance BEFORE INSERT OR UPDATE ON public.licenses FOR EACH ROW EXECUTE FUNCTION public.guard_license_governance();

DO $$ BEGIN
 IF to_regprocedure('public.save_catalog_plan_v15(uuid,integer,jsonb,uuid,text,text)') IS NULL THEN ALTER FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) RENAME TO save_catalog_plan_v15; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; unlimited boolean;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 unlimited:=COALESCE((definition->>'documents_unlimited')::boolean,false);
 saved:=public.save_catalog_plan_v15(target_id,expected_version,definition,actor_id,audit_ip,audit_agent);
 UPDATE public.plan_catalog SET documents_unlimited=unlimited WHERE id=(saved->>'id')::uuid RETURNING to_jsonb(plan_catalog.*) INTO saved;
 UPDATE public.platform_plan_audit SET changes=jsonb_set(changes,'{after}',saved) WHERE plan_id=(saved->>'id')::uuid AND (changes->'after'->>'version')::integer=(saved->>'version')::integer;
 RETURN saved;
END $$;
CREATE OR REPLACE FUNCTION public.save_plan_license(target_organization text,target_license text,expected_revision integer,target_plan uuid,expected_version integer,starts date,ends date,renews date,next_status text,selected_modules jsonb,actor_id uuid,audit_ip text,audit_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.plan_catalog; saved public.licenses; previous public.licenses; chosen jsonb; k text;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(target_organization,315));
 IF starts IS NULL OR renews IS NULL OR (ends IS NOT NULL AND ends<starts) OR next_status NOT IN ('ACTIVE','SUSPENDED','EXPIRED','CANCELLED') THEN RAISE EXCEPTION 'Invalid license dates/status' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=target_organization AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Organization missing' USING ERRCODE='P3150'; END IF;
 SELECT * INTO p FROM public.plan_catalog WHERE id=target_plan FOR SHARE;
 IF NOT FOUND OR NOT p.active THEN RAISE EXCEPTION 'Active plan missing' USING ERRCODE='P3150'; END IF;
 IF p.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'Plan changed' USING ERRCODE='P3151'; END IF;
 IF target_license IS NOT NULL THEN
  SELECT * INTO previous FROM public.licenses WHERE id=target_license AND organization_id=target_organization FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'License missing' USING ERRCODE='P3150'; END IF;
  IF previous.governance_revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'License changed' USING ERRCODE='P3151'; END IF;
 END IF;
 chosen:=COALESCE(selected_modules,jsonb_build_object('document_management',p.document_management,'advanced_analytics',p.advanced_analytics,'report_generation',p.report_generation,'free_market_management',p.free_market_management));
 IF jsonb_typeof(chosen)<>'object' OR chosen-'document_management'-'advanced_analytics'-'report_generation'-'free_market_management'<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid module selection' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['document_management','advanced_analytics','report_generation','free_market_management'] LOOP
  IF jsonb_typeof(chosen->k) IS DISTINCT FROM 'boolean' OR ((chosen->>k)::boolean AND NOT (to_jsonb(p)->>k)::boolean) THEN RAISE EXCEPTION 'Module unavailable in plan' USING ERRCODE='22023'; END IF;
 END LOOP;
 PERFORM set_config('app.license_actor',actor_id::text,true);
 IF target_license IS NULL THEN
  INSERT INTO public.licenses(id,organization_id,license_type,documents_limit,documents_used,documents_unlimited,renewal_date,start_date,end_date,status,active,max_consumer_units,max_users,document_management,advanced_analytics,report_generation,free_market_management,plan_id,plan_version,plan_snapshot)
  VALUES(gen_random_uuid()::text,target_organization,p.name,p.documents_limit,0,p.documents_unlimited,renews,starts,ends,next_status,next_status='ACTIVE',p.max_consumer_units,p.max_users,(chosen->>'document_management')::boolean,(chosen->>'advanced_analytics')::boolean,(chosen->>'report_generation')::boolean,(chosen->>'free_market_management')::boolean,p.id,p.version,to_jsonb(p)) RETURNING * INTO saved;
 ELSE
  UPDATE public.licenses SET license_type=p.name,documents_limit=p.documents_limit,documents_unlimited=p.documents_unlimited,renewal_date=renews,start_date=starts,end_date=ends,status=next_status,active=next_status='ACTIVE',max_consumer_units=p.max_consumer_units,max_users=p.max_users,document_management=(chosen->>'document_management')::boolean,advanced_analytics=(chosen->>'advanced_analytics')::boolean,report_generation=(chosen->>'report_generation')::boolean,free_market_management=(chosen->>'free_market_management')::boolean,plan_id=p.id,plan_version=p.version,plan_snapshot=to_jsonb(p),governance_revision=governance_revision+1,updated_at=now() WHERE id=target_license RETURNING * INTO saved;
 END IF;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent)
 VALUES(gen_random_uuid()::text,target_organization,actor_id,CASE WHEN target_license IS NULL THEN 'CREATE' ELSE 'UPDATE' END,'license',saved.id::text,jsonb_build_object('before',CASE WHEN target_license IS NULL THEN NULL ELSE to_jsonb(previous) END,'after',to_jsonb(saved)),'success',audit_ip,audit_agent);
 PERFORM set_config('app.license_actor','',true);
 RETURN to_jsonb(saved);
END $$;
-- Existing API cannot bypass the stricter operation.
CREATE OR REPLACE FUNCTION public.create_license_from_plan(target_organization text,target_plan uuid,expected_version integer,starts date,ends date,renews date,actor_id uuid,audit_ip text,audit_agent text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.save_plan_license(target_organization,NULL,NULL,target_plan,expected_version,starts,ends,renews,'ACTIVE',NULL,actor_id,audit_ip,audit_agent);
$$;
CREATE OR REPLACE FUNCTION public.request_license_upgrade(org text,actor uuid,message text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved public.license_upgrade_requests;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=org AND user_id::text=actor::text AND status='active') THEN PERFORM public.assert_license_platform_actor(actor); END IF;
 INSERT INTO public.license_upgrade_requests(organization_id,requested_by,note) VALUES(org,actor,btrim(message)) RETURNING * INTO saved;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status) VALUES(gen_random_uuid()::text,org,actor,'CREATE','license_upgrade_request',saved.id::text,jsonb_build_object('after',to_jsonb(saved)),'success');
 RETURN to_jsonb(saved);
END $$;
CREATE OR REPLACE FUNCTION public.resolve_license_upgrade(target uuid,actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved public.license_upgrade_requests;
BEGIN
 PERFORM public.assert_license_platform_actor(actor);
 UPDATE public.license_upgrade_requests SET status='resolved',resolved_at=now(),resolved_by=actor WHERE id=target AND status='pending' RETURNING * INTO saved;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='P3151'; END IF;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status) VALUES(gen_random_uuid()::text,saved.organization_id,actor,'UPDATE','license_upgrade_request',saved.id::text,jsonb_build_object('after',to_jsonb(saved)),'success');
 RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.save_catalog_plan_v15(uuid,integer,jsonb,uuid,text,text),public.assert_license_platform_actor(uuid),public.organization_resource_usage(text),public.enforce_organization_capacity(),public.refresh_document_usage(),public.guard_license_governance(),public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text),public.request_license_upgrade(text,uuid,text),public.resolve_license_upgrade(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.organization_resource_usage(text),public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text),public.request_license_upgrade(text,uuid,text),public.resolve_license_upgrade(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
