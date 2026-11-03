BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';

CREATE FUNCTION public.assert_trading_supplier_actor(p_org text,p_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permissions jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN PERFORM public.assert_trading_actor(p_org,p_actor,true);RETURN;END IF;
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO permissions FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' CROSS JOIN LATERAL jsonb_array_elements(r.permissions) x WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND lower(m.status)='active' AND (m.permission_limit IS NULL OR m.permission_limit @> jsonb_build_array(x));
 IF permissions ? 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce' THEN PERFORM public.assert_trading_actor(p_org,p_actor,true);RETURN;END IF;
 PERFORM public.assert_trading_actor(p_org,p_actor,false);
 IF NOT permissions ? 'f1c2d3a4-7c53-4b05-8ed3-f32b88f32131' THEN RAISE EXCEPTION 'Supplier management permission required' USING ERRCODE='42501';END IF;
END$$;

DO $$DECLARE source text;marker text;replacement text;BEGIN
 source:=pg_get_functiondef('public.assert_trading_actor(text,text,boolean,boolean)'::regprocedure);
 marker:='SELECT r.name,r.permissions INTO n,permissions';
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Trading actor source changed';END IF;
 replacement:='SELECT r.name,(SELECT coalesce(jsonb_agg(x),''[]''::jsonb) FROM jsonb_array_elements(r.permissions) x WHERE m.permission_limit IS NULL OR m.permission_limit @> jsonb_build_array(x)) INTO n,permissions';
 EXECUTE replace(source,marker,replacement);

 source:=pg_get_functiondef('public.save_trading_record(text,text,text,uuid,integer,uuid,jsonb,text)'::regprocedure);
 marker:='PERFORM public.assert_trading_actor(p_org,p_actor,true);';
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Trading save source changed';END IF;
 EXECUTE replace(source,marker,'IF p_kind=''supplier'' THEN PERFORM public.assert_trading_supplier_actor(p_org,p_actor);ELSE PERFORM public.assert_trading_actor(p_org,p_actor,true);END IF;');

 source:=pg_get_functiondef('public.transition_trading_record(text,text,uuid,integer,text,text)'::regprocedure);
 marker:='PERFORM public.assert_trading_actor(p_org,p_actor,true,p_status=''MANAGER_APPROVED'');';
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Trading transition source changed';END IF;
 EXECUTE replace(source,marker,'IF EXISTS(SELECT 1 FROM public.trading_records WHERE id=p_id AND organization_id=p_org AND kind=''supplier'') THEN PERFORM public.assert_trading_supplier_actor(p_org,p_actor);ELSE PERFORM public.assert_trading_actor(p_org,p_actor,true,p_status=''MANAGER_APPROVED'');END IF;');
END$$;
REVOKE ALL ON FUNCTION public.assert_trading_supplier_actor(text,text) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
