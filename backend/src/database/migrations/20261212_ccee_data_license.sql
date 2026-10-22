-- Independent opt-in. Existing plans/licenses remain disabled; no role/user grants.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
ALTER TABLE public.plan_catalog ADD COLUMN ccee_data boolean NOT NULL DEFAULT false;
ALTER TABLE public.licenses ADD COLUMN ccee_data boolean NOT NULL DEFAULT false;

ALTER FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) RENAME TO save_catalog_plan_before_ccee_data;
REVOKE ALL ON FUNCTION public.save_catalog_plan_before_ccee_data(uuid,integer,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; enabled boolean:=false;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 PERFORM pg_advisory_xact_lock(60405);
 IF definition ? 'ccee_data' AND jsonb_typeof(definition->'ccee_data') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid CCEE data flag' USING ERRCODE='22023';END IF;
 IF target_id IS NOT NULL THEN SELECT ccee_data INTO enabled FROM public.plan_catalog WHERE id=target_id FOR UPDATE;END IF;
 enabled:=CASE WHEN definition ? 'ccee_data' THEN (definition->>'ccee_data')::boolean ELSE coalesce(enabled,false) END;
 saved:=public.save_catalog_plan_before_ccee_data(target_id,expected_version,definition-'ccee_data',actor_id,audit_ip,audit_agent);
 UPDATE public.plan_catalog SET ccee_data=enabled WHERE id=(saved->>'id')::uuid RETURNING to_jsonb(plan_catalog.*) INTO saved;
 UPDATE public.platform_plan_audit SET changes=jsonb_set(changes,'{after}',saved) WHERE plan_id=(saved->>'id')::uuid AND (changes->'after'->>'version')::integer=(saved->>'version')::integer;
 RETURN saved;
END $$;

ALTER FUNCTION public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) RENAME TO save_plan_license_before_ccee_data;
REVOKE ALL ON FUNCTION public.save_plan_license_before_ccee_data(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_plan_license(target_organization text,target_license text,expected_revision integer,target_plan uuid,expected_version integer,starts date,ends date,renews date,next_status text,selected_modules jsonb,actor_id uuid,audit_ip text,audit_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; enabled boolean:=false; available boolean; prior_actor text;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 PERFORM pg_advisory_xact_lock(60405);
 PERFORM pg_advisory_xact_lock(hashtextextended(target_organization,315));
 IF selected_modules IS NOT NULL AND (jsonb_typeof(selected_modules) IS DISTINCT FROM 'object' OR selected_modules ? 'ccee_data' AND jsonb_typeof(selected_modules->'ccee_data') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'Invalid CCEE data selection' USING ERRCODE='22023';END IF;
 -- A legacy edit preserves an existing selection, but a new/legacy license never inherits the plan's flag.
 IF target_license IS NOT NULL THEN SELECT ccee_data INTO enabled FROM public.licenses WHERE id=target_license AND organization_id=target_organization FOR UPDATE;END IF;
 enabled:=CASE WHEN selected_modules ? 'ccee_data' THEN (selected_modules->>'ccee_data')::boolean ELSE coalesce(enabled,false) END;
 SELECT ccee_data INTO available FROM public.plan_catalog WHERE id=target_plan FOR SHARE;
 IF enabled AND available IS DISTINCT FROM true THEN RAISE EXCEPTION 'CCEE data unavailable in selected plan' USING ERRCODE='22023';END IF;
 saved:=public.save_plan_license_before_ccee_data(target_organization,target_license,expected_revision,target_plan,expected_version,starts,ends,renews,next_status,selected_modules-'ccee_data',actor_id,audit_ip,audit_agent);
 prior_actor:=current_setting('app.license_actor',true);
 PERFORM set_config('app.license_actor',actor_id::text,true);
 UPDATE public.licenses SET ccee_data=enabled WHERE id=saved->>'id' AND organization_id=target_organization RETURNING to_jsonb(licenses.*) INTO saved;
 PERFORM set_config('app.license_actor',coalesce(prior_actor,''),true);
 UPDATE public.audit_logs SET changes=jsonb_set(changes,'{after}',saved)
 WHERE organization_id=target_organization AND user_id=actor_id AND resource_type='license' AND resource_id=saved->>'id'
 AND changes->'after'->>'governance_revision'=saved->>'governance_revision';
 RETURN saved;
END $$;

-- The same license boundary applies to UI, queue claim, each page and persistence.
CREATE OR REPLACE FUNCTION public.assert_ccee_data_actor(p_org text,p_actor text,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE role_name text; perms jsonb; permission text;
BEGIN
 IF p_action NOT IN ('view','manage','review') OR nullif(p_org,'') IS NULL OR nullif(p_actor,'') IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL)
 OR (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND ccee_data AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE)) THEN RAISE EXCEPTION 'CCEE data license unavailable' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN PERFORM public.assert_license_platform_actor(p_actor::uuid);RETURN;END IF;
 SELECT r.name,r.permissions INTO role_name,perms FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';
 permission:=CASE p_action WHEN 'view' THEN 'f5364101-4486-42c2-a90f-807937ac3011' WHEN 'manage' THEN 'f5364101-4486-42c2-a90f-807937ac3012' ELSE 'f5364101-4486-42c2-a90f-807937ac3013' END;
 IF role_name IS NULL OR role_name NOT IN ('admin_org','gestor','operacional') OR NOT COALESCE(perms?'f5364101-4486-42c2-a90f-807937ac3011',false) OR NOT COALESCE(perms?permission,false) OR(p_action='review' AND role_name NOT IN ('admin_org','gestor')) THEN RAISE EXCEPTION 'CCEE data permission denied' USING ERRCODE='42501';END IF;
END $$;

REVOKE ALL ON FUNCTION public.assert_ccee_data_actor(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
