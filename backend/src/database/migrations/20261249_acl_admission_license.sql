-- Adesão ACL opt-in. Existing access continuity is reconciled separately in deployment; no role/user grants.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
ALTER TABLE public.plan_catalog ADD COLUMN acl_admissions boolean NOT NULL DEFAULT false;
ALTER TABLE public.licenses ADD COLUMN acl_admissions boolean NOT NULL DEFAULT false;

ALTER FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) RENAME TO save_catalog_plan_before_acl_admissions;
REVOKE ALL ON FUNCTION public.save_catalog_plan_before_acl_admissions(uuid,integer,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; enabled boolean:=false;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 PERFORM pg_advisory_xact_lock(60405);
 IF definition ? 'acl_admissions' AND jsonb_typeof(definition->'acl_admissions') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid Adesão ACL flag' USING ERRCODE='22023';END IF;
 IF target_id IS NOT NULL THEN SELECT acl_admissions INTO enabled FROM public.plan_catalog WHERE id=target_id FOR UPDATE;END IF;
 enabled:=CASE WHEN definition ? 'acl_admissions' THEN (definition->>'acl_admissions')::boolean ELSE coalesce(enabled,false) END;
 saved:=public.save_catalog_plan_before_acl_admissions(target_id,expected_version,definition-'acl_admissions',actor_id,audit_ip,audit_agent);
 IF enabled AND coalesce((saved->>'free_market_management')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'ACL requires free market management' USING ERRCODE='P4A01';END IF;
 UPDATE public.plan_catalog SET acl_admissions=enabled WHERE id=(saved->>'id')::uuid RETURNING to_jsonb(plan_catalog.*) INTO saved;
 UPDATE public.platform_plan_audit SET changes=jsonb_set(changes,'{after}',saved) WHERE plan_id=(saved->>'id')::uuid AND (changes->'after'->>'version')::integer=(saved->>'version')::integer;
 RETURN saved;
END $$;

ALTER FUNCTION public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) RENAME TO save_plan_license_before_acl_admissions;
REVOKE ALL ON FUNCTION public.save_plan_license_before_acl_admissions(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_plan_license(target_organization text,target_license text,expected_revision integer,target_plan uuid,expected_version integer,starts date,ends date,renews date,next_status text,selected_modules jsonb,actor_id uuid,audit_ip text,audit_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; enabled boolean:=false; available boolean; prior_actor text;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 PERFORM pg_advisory_xact_lock(60405);
 PERFORM pg_advisory_xact_lock(hashtextextended(target_organization,315));
 IF selected_modules IS NOT NULL AND (jsonb_typeof(selected_modules) IS DISTINCT FROM 'object' OR selected_modules ? 'acl_admissions' AND jsonb_typeof(selected_modules->'acl_admissions') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'Invalid Adesão ACL selection' USING ERRCODE='22023';END IF;
 -- A legacy edit preserves an existing selection, but a new/legacy license never inherits the plan's flag.
 IF target_license IS NOT NULL THEN SELECT acl_admissions INTO enabled FROM public.licenses WHERE id=target_license AND organization_id=target_organization FOR UPDATE;END IF;
 enabled:=CASE WHEN selected_modules ? 'acl_admissions' THEN (selected_modules->>'acl_admissions')::boolean ELSE coalesce(enabled,false) END;
 SELECT acl_admissions INTO available FROM public.plan_catalog WHERE id=target_plan FOR SHARE;
 IF enabled AND available IS DISTINCT FROM true THEN RAISE EXCEPTION 'ACL unavailable in selected plan' USING ERRCODE='P4A02';END IF;
 saved:=public.save_plan_license_before_acl_admissions(target_organization,target_license,expected_revision,target_plan,expected_version,starts,ends,renews,next_status,selected_modules-'acl_admissions',actor_id,audit_ip,audit_agent);
 IF enabled AND coalesce((saved->>'free_market_management')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'ACL requires free market management' USING ERRCODE='P4A01';END IF;
 prior_actor:=current_setting('app.license_actor',true);
 PERFORM set_config('app.license_actor',actor_id::text,true);
 UPDATE public.licenses SET plan_snapshot=jsonb_set(coalesce(plan_snapshot,'{}'::jsonb),'{acl_admissions}',to_jsonb(enabled)),acl_admissions=enabled WHERE id=saved->>'id' AND organization_id=target_organization RETURNING to_jsonb(licenses.*) INTO saved;
 PERFORM set_config('app.license_actor',coalesce(prior_actor,''),true);
 UPDATE public.audit_logs SET changes=jsonb_set(changes,'{after}',saved)
 WHERE organization_id=target_organization AND user_id=actor_id AND resource_type='license' AND resource_id=saved->>'id'
 AND changes->'after'->>'governance_revision'=saved->>'governance_revision';
 RETURN saved;
END $$;

REVOKE ALL ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
