BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.eva_scoped_platform_owner(p_org text,p_actor text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_actor IS NULL OR p_actor !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor::uuid AND u.deleted_at IS NULL AND(u.banned_until IS NULL OR u.banned_until<clock_timestamp()))
 OR NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions s WHERE s.organization_id=p_org AND s.user_id::text=p_actor AND s.expires_at>clock_timestamp() AND s.revoked_at IS NULL) THEN RETURN false;END IF;
 PERFORM public.platform_team_owner(p_actor::uuid);RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.eva_scoped_platform_owner(text,text) FROM PUBLIC,anon,authenticated,service_role;
-- Patch only the known authorization seam, retaining all later queue and identity safeguards.
DO $patch$
DECLARE d text; old_guard text; new_guard text; seam text;
BEGIN
 d:=pg_get_functiondef('public.eva_document_review_queue(text,text,text,text,jsonb)'::regprocedure);
 old_guard:=$old$IF NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL) THEN RAISE EXCEPTION 'Internal membership required' USING ERRCODE='42501';END IF;
 rights:=public.eva_flow_actor(p_org,p_actor,p_action='submit');$old$;
 new_guard:=$new$IF public.eva_scoped_platform_owner(p_org,p_actor) THEN
  rights:=public.eva_scoped_closing_action(p_org,p_actor,p_role,true,'history',
   (SELECT u.id FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.organization_id=p_org AND u.status='ACTIVE' AND c.status='ACTIVE' AND c.deleted_at IS NULL ORDER BY u.id LIMIT 1),
   to_char(current_date,'YYYY-MM'),NULL,'{"page":0}'::jsonb,'UNIT','BASE',false);
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL) THEN RAISE EXCEPTION 'Internal membership required' USING ERRCODE='42501';END IF;
  rights:=public.eva_flow_actor(p_org,p_actor,p_action='submit');
 END IF;$new$;
 seam:=substring(d from 'IF\s+NOT\s+EXISTS\([^;]*Internal membership required[^;]*;\s*END\s+IF;\s*rights:=public\.eva_flow_actor\(p_org,p_actor,p_action=''submit''\);');
 IF seam IS NULL OR regexp_replace(seam,'\s','','g') IS DISTINCT FROM regexp_replace(old_guard,'\s','','g') THEN RAISE EXCEPTION 'Unexpected EVA queue authorization definition';END IF;
 EXECUTE replace(d,seam,new_guard);
 d:=pg_get_functiondef('public.eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 old_guard:=$old$IF a->>'external' IS DISTINCT FROM 'false' OR NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND lower(m.status)='active' AND m.affiliation_type='internal' AND r.name IN('admin_org','gestor','operacional')) THEN RAISE EXCEPTION 'Internal documents access required' USING ERRCODE='42501';END IF;$old$;
 new_guard:=$new$IF a->>'external' IS DISTINCT FROM 'false' OR NOT(coalesce(p_platform,false) AND p_action='justifications' AND public.eva_scoped_platform_owner(p_org,p_actor)) AND NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND lower(m.status)='active' AND m.affiliation_type='internal' AND r.name IN('admin_org','gestor','operacional')) THEN RAISE EXCEPTION 'Internal documents access required' USING ERRCODE='42501';END IF;$new$;
 seam:=substring(d from 'IF\s+a->>''external''[^;]*Internal documents access required[^;]*;\s*END\s+IF;');
 IF seam IS NULL OR regexp_replace(seam,'\s','','g') IS DISTINCT FROM regexp_replace(old_guard,'\s','','g') THEN RAISE EXCEPTION 'Unexpected EVA identity authorization definition';END IF;
 EXECUTE replace(d,seam,new_guard);
END $patch$;
COMMIT;
