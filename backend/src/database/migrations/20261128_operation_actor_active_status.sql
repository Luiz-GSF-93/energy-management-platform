BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Membership status is stored as active by the current identity module.
-- Preserve roles, permissions, organization scope and platform-session checks.
CREATE OR REPLACE FUNCTION public.assert_operation_actor(p_org text,p_actor text,p_kind text,p_write boolean,p_publish boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE perm text;name text;permissions jsonb;
BEGIN
 IF p_kind NOT IN ('agenda','requests','events') OR nullif(p_actor,'') IS NULL OR nullif(p_org,'') IS NULL THEN RAISE EXCEPTION 'Invalid scope' USING ERRCODE='P2031';END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions s WHERE s.organization_id=p_org AND s.user_id::text=p_actor AND s.expires_at>now() AND s.revoked_at IS NULL) THEN RETURN;END IF;
 SELECT r.name,r.permissions INTO name,permissions FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';
 perm:=CASE p_kind WHEN 'agenda' THEN CASE WHEN p_write THEN '6da45eb4-810c-4e40-9933-d9cda66a8841' ELSE 'cb949e2a-e01d-4cf0-8c69-6ca74fe4d627' END WHEN 'requests' THEN CASE WHEN p_write THEN 'd1f1b3be-a842-41e7-aeb1-45fefeb2f4c1' ELSE '1479c0b7-9608-4e95-bd83-7e6899255a78' END ELSE CASE WHEN p_write THEN 'd617b0f0-0fba-42f8-8707-811070346ef0' ELSE '489e6387-d5fc-4cb0-81f9-d7a76269dca5' END END;
 IF name IS NULL OR name NOT IN ('admin_org','gestor','operacional') OR NOT coalesce(permissions ? perm,false) OR (p_publish AND name NOT IN ('admin_org','gestor')) THEN RAISE EXCEPTION 'Unauthorized operation actor' USING ERRCODE='P2031';END IF;
END $$;

COMMIT;
