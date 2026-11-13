BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
ALTER TABLE public.eva_manual_preparations ADD COLUMN IF NOT EXISTS platform_actor boolean NOT NULL DEFAULT false;

-- Same operation that the Owner could execute synchronously, now a durable intent.
-- An explicit context selects this path; a global role never bypasses member limits implicitly.
CREATE OR REPLACE FUNCTION public.eva_manual_preparation_actor(p_org text,p_actor text,p_role text,p_unit text,p_month text,p_scope text,p_platform boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permissions jsonb;
BEGIN
 IF p_platform IS NULL THEN RAISE EXCEPTION 'Explicit preparation context required' USING ERRCODE='42501';END IF;
 IF NOT p_platform THEN RETURN public.eva_manual_preparation_actor(p_org,p_actor,p_role,p_unit,p_month,p_scope);END IF;
 IF p_scope IS NULL OR p_scope NOT IN('UNIT','CUSTOMER') THEN RAISE EXCEPTION 'Invalid preparation scope' USING ERRCODE='22023';END IF;
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor::uuid AND u.deleted_at IS NULL AND(u.banned_until IS NULL OR u.banned_until<=clock_timestamp())) THEN RAISE EXCEPTION 'Active Owner required' USING ERRCODE='42501';END IF;
  PERFORM public.platform_team_owner(p_actor::uuid);
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END;
 -- Established gate rechecks target unit/customer, licensed module and platform role binding.
 PERFORM public.calculation_autofill_action(p_org,p_actor,p_role,true,'access',p_unit,p_month,NULL,'{}');
 SELECT r.permissions INTO permissions FROM public.roles r WHERE r.id::text=p_role AND r.organization_id=p_org AND r.scope='organization' AND r.name='admin_org';
 IF NOT FOUND OR jsonb_typeof(permissions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Target administrator role unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('userId',p_actor,'roleId',p_role,'role','admin_org','permissions',permissions,'accessMode','platform_operation');
END$$;
REVOKE ALL ON FUNCTION public.eva_manual_preparation_actor(text,text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

DO $$DECLARE source text;updated text;
BEGIN
 IF to_regprocedure('public.eva_manual_preparation_action_context(text,boolean,text,text,text,text,text,text,uuid,jsonb)') IS NULL THEN
  source:=pg_get_functiondef('public.eva_manual_preparation_action(text,text,text,text,text,text,text,uuid,jsonb)'::regprocedure);
  IF position('actor:=public.eva_manual_preparation_actor(p_org,p_actor,p_role,p_unit,p_month,p_scope);' in source)=0
   OR position('actor_id,role_id,execution_id)' in source)=0
   OR position('actor_id=p_actor,role_id=p_role,write_started=false' in source)=0 THEN RAISE EXCEPTION 'Unexpected manual queue action definition';END IF;
  updated:=replace(source,'FUNCTION public.eva_manual_preparation_action(','FUNCTION public.eva_manual_preparation_action_context(');
  updated:=replace(updated,'p_org text,','p_org text, p_platform boolean,');
  updated:=replace(updated,'actor:=public.eva_manual_preparation_actor(p_org,p_actor,p_role,p_unit,p_month,p_scope);','actor:=public.eva_manual_preparation_actor(p_org,p_actor,p_role,p_unit,p_month,p_scope,p_platform);');
  updated:=replace(updated,'actor_id,role_id,execution_id)','actor_id,role_id,execution_id,platform_actor)');
  updated:=replace(updated,'p_scope,selected_key,p_actor,p_role,p_id);','p_scope,selected_key,p_actor,p_role,p_id,p_platform);');
  updated:=replace(updated,'actor_id=p_actor,role_id=p_role,write_started=false','actor_id=p_actor,role_id=p_role,platform_actor=p_platform,write_started=false');
  IF updated=source THEN RAISE EXCEPTION 'Manual queue context transformation failed';END IF;
  EXECUTE updated;
 END IF;
END$$;
REVOKE ALL ON FUNCTION public.eva_manual_preparation_action_context(text,boolean,text,text,text,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_manual_preparation_action_context(text,boolean,text,text,text,text,text,text,uuid,jsonb) TO service_role;

-- Existing API instances remain compatible and cannot accidentally inherit platform context.
CREATE OR REPLACE FUNCTION public.eva_manual_preparation_action(p_org text,p_actor text,p_role text,p_action text,p_unit text,p_month text,p_scope text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' AS $$
 SELECT public.eva_manual_preparation_action_context(p_org,false,p_actor,p_role,p_action,p_unit,p_month,p_scope,p_id,p_body)
$$;
REVOKE ALL ON FUNCTION public.eva_manual_preparation_action(text,text,text,text,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_manual_preparation_action(text,text,text,text,text,text,text,uuid,jsonb) TO service_role;

DO $$DECLARE source text;updated text;
BEGIN
 source:=pg_get_functiondef('public.eva_manual_preparation_worker(text,uuid,uuid,jsonb)'::regprocedure);
 IF position('j.scope_kind,j.platform_actor)' in source)=0 THEN
  IF position('actor:=public.eva_manual_preparation_actor(j.organization_id,j.actor_id,j.role_id,j.consumer_unit_id,j.month,j.scope_kind);' in source)=0 THEN RAISE EXCEPTION 'Unexpected manual worker definition';END IF;
  updated:=replace(source,'actor:=public.eva_manual_preparation_actor(j.organization_id,j.actor_id,j.role_id,j.consumer_unit_id,j.month,j.scope_kind);','actor:=public.eva_manual_preparation_actor(j.organization_id,j.actor_id,j.role_id,j.consumer_unit_id,j.month,j.scope_kind,j.platform_actor);');
  updated:=replace(updated,'IF p_action IN(''context'',''begin'') THEN','IF j.platform_actor AND p_action NOT IN(''context'',''begin'') THEN PERFORM public.eva_manual_preparation_actor(j.organization_id,j.actor_id,j.role_id,j.consumer_unit_id,j.month,j.scope_kind,true);END IF; IF p_action IN(''context'',''begin'') THEN');
  EXECUTE updated;
 END IF;
 source:=pg_get_functiondef('public.eva_manual_preparation_event(uuid,text,jsonb)'::regprocedure);
 IF position('''platformActor''' in source)=0 THEN
  IF position('jsonb_build_object(''financialApproval'',false)' in source)=0 THEN RAISE EXCEPTION 'Unexpected manual audit definition';END IF;
  EXECUTE replace(source,'jsonb_build_object(''financialApproval'',false)','jsonb_build_object(''financialApproval'',false,''platformActor'',j.platform_actor)');
 END IF;
END$$;
COMMIT;
