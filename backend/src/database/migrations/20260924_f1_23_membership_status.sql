-- F1.23: status and audit commit atomically; never changes existing memberships at installation.
CREATE OR REPLACE FUNCTION public.set_organization_member_status(
 target_organization_id text, target_user_id uuid, actor_user_id uuid,
 target_status text, expected_status text, expected_role_id text, audit_ip text, audit_agent text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.organization_members%ROWTYPE; r public.roles%ROWTYPE;
 actor_permissions jsonb; is_platform boolean; required_permission text; before_row jsonb; after_row jsonb;
BEGIN
 IF target_status IS NULL OR target_status NOT IN ('active','inactive') OR expected_status IS NULL OR
 expected_status NOT IN ('active','inactive') OR target_status=expected_status THEN
 RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
 IF actor_user_id IS NULL OR target_user_id=actor_user_id THEN RAISE EXCEPTION 'Self change forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_organization_id,315));
 SELECT * INTO m FROM public.organization_members x WHERE x.organization_id=target_organization_id AND x.user_id=target_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Membership missing' USING ERRCODE='P3230'; END IF;
 IF m.status IS DISTINCT FROM expected_status OR m.role_id::text IS DISTINCT FROM expected_role_id THEN RAISE EXCEPTION 'Membership changed' USING ERRCODE='P3231'; END IF;
 SELECT * INTO r FROM public.roles x WHERE x.id=m.role_id AND x.organization_id=target_organization_id AND x.scope='organization' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid role' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles x ON x.id=ur.role_id WHERE ur.user_id=actor_user_id AND x.name='admin_platform' AND x.scope='global') INTO is_platform;
 IF NOT is_platform THEN
 SELECT x.permissions::jsonb INTO actor_permissions FROM public.organization_members am JOIN public.roles x ON x.id=am.role_id AND x.organization_id=am.organization_id AND x.scope='organization'
 WHERE am.organization_id=target_organization_id AND am.user_id=actor_user_id AND am.status='active' FOR SHARE OF am,x;
 required_permission:=CASE WHEN target_status='active' THEN '5f91d918-8def-4bc1-b6c7-37e1ff2d14e2' ELSE '4c53c778-69c6-4994-b12f-c74a6867ca63' END;
 IF actor_permissions IS NULL OR jsonb_typeof(actor_permissions)<>'array' OR NOT actor_permissions ? required_permission OR r.name='admin_org' OR r.permissions IS NULL OR jsonb_typeof(r.permissions::jsonb)<>'array' OR NOT actor_permissions @> r.permissions::jsonb THEN RAISE EXCEPTION 'Actor cannot manage role' USING ERRCODE='42501'; END IF;
 END IF;
 IF target_status='inactive' AND r.name IN ('admin_org','gestor') THEN
 PERFORM other.id FROM public.organization_members other JOIN public.roles rr ON rr.id=other.role_id AND rr.organization_id=other.organization_id AND rr.scope='organization'
 WHERE other.organization_id=target_organization_id AND other.user_id<>target_user_id AND other.status='active' AND rr.name IN ('admin_org','gestor') FOR SHARE OF other,rr;
 IF NOT FOUND THEN RAISE EXCEPTION 'Last responsible member' USING ERRCODE='P3232'; END IF;
 END IF;
 before_row:=to_jsonb(m);
 UPDATE public.organization_members x SET status=target_status WHERE x.id=m.id RETURNING to_jsonb(x) INTO after_row;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent)
 VALUES(gen_random_uuid()::text,target_organization_id,actor_user_id,'UPDATE','organization_member',m.id::text,jsonb_build_object('before',before_row,'after',after_row),'success',audit_ip,audit_agent);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.set_organization_member_status(text,uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_organization_member_status(text,uuid,uuid,text,text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
