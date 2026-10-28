BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.portal_intake_scoped_rpc(p_name text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;s jsonb;external boolean;
BEGIN
 IF p_name NOT IN('eva_intake_work_context','transition_eva_automatic_intake','eva_intake_reference_signature','eva_intake_unit_aliases') OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid intake continuation' USING ERRCODE='22023';END IF;
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=(p_args->>'p_id')::uuid AND lease_token=(p_args->>'p_token')::uuid AND lease_until>clock_timestamp();
 SELECT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=i.organization_id AND m.user_id::text=i.actor_id AND m.role_id::text=i.role_id AND upper(m.status)='ACTIVE' AND m.affiliation_type='external' AND r.name='consulta') INTO external;
 IF external AND coalesce((SELECT multi_customer_enabled FROM public.client_portal_policies WHERE organization_id=i.organization_id),false) THEN
  s:=public.portal_customer_scope(i.organization_id,i.actor_id,i.role_id,i.customer_id);
  IF i.unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'units')u WHERE u->>'id'=i.unit_id) THEN RAISE EXCEPTION 'Intake unit access revoked' USING ERRCODE='42501';END IF;
  RETURN public.portal_scoped_rpc(i.organization_id,i.actor_id,i.role_id,s->>'customerId',s->>'revision',p_name,p_args);
 END IF;
 CASE p_name
 WHEN 'eva_intake_work_context' THEN RETURN public.eva_intake_work_context(i.id,i.lease_token);
 WHEN 'transition_eva_automatic_intake' THEN RETURN public.transition_eva_automatic_intake(i.id,i.lease_token,p_args->>'p_action',coalesce(p_args->'p_body','{}'));
 WHEN 'eva_intake_reference_signature' THEN RETURN public.eva_intake_reference_signature(i.id,i.lease_token);
 WHEN 'eva_intake_unit_aliases' THEN RETURN public.eva_intake_unit_aliases(i.id,i.lease_token,p_args->>'p_unit');
 END CASE;
 RAISE EXCEPTION 'Intake operation unavailable' USING ERRCODE='42501';
END$$;
CREATE FUNCTION public.portal_intake_work_context_scoped(p_id uuid,p_token uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.portal_intake_scoped_rpc('eva_intake_work_context',jsonb_build_object('p_id',p_id,'p_token',p_token))
$$;
DO $$DECLARE body text;needle text:='public.eva_intake_work_context(i.id,i.lease_token)';BEGIN
 body:=pg_get_functiondef('public.claim_eva_automatic_intake(text[])'::regprocedure);
 IF(length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Review intake claim source before widening scope';END IF;
 EXECUTE replace(body,needle,'public.portal_intake_work_context_scoped(i.id,i.lease_token)');
END$$;
REVOKE ALL ON FUNCTION public.portal_intake_scoped_rpc(text,jsonb),public.portal_intake_work_context_scoped(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_intake_scoped_rpc(text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
