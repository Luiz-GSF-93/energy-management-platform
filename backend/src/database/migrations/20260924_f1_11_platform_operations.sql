-- Explicit, audited, expiring platform operation. No memberships are rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS registration jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.roles WHERE name='admin_platform' AND scope='global') THEN
   RAISE EXCEPTION 'Global administrator role missing';
 END IF;
 IF EXISTS (SELECT 1 FROM public.permissions WHERE code='platform.organizations.operate' AND id<>'5f6e284b-07b2-4e3c-aec3-a331c071719a') THEN
   RAISE EXCEPTION 'Permission identifier mismatch';
 END IF;
END $$;
INSERT INTO public.permissions(id,code,name,module,resource,action)
VALUES('5f6e284b-07b2-4e3c-aec3-a331c071719a','platform.organizations.operate','Operar organização como administrador da plataforma','platform','organizations','operate')
ON CONFLICT(id) DO NOTHING;
UPDATE public.roles SET permissions=permissions || '["5f6e284b-07b2-4e3c-aec3-a331c071719a"]'::jsonb
WHERE name='admin_platform' AND scope='global'
AND jsonb_typeof(permissions)='array' AND NOT permissions ? '5f6e284b-07b2-4e3c-aec3-a331c071719a';

CREATE TABLE IF NOT EXISTS public.platform_organization_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 organization_id text NOT NULL REFERENCES public.organizations(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
 revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '1 hour')
);
ALTER TABLE public.platform_organization_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_organization_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.platform_organization_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_platform_organization_session(target_session_id uuid,target_user_id uuid)
RETURNS TABLE(organization_id text,organization_name text,role_id text,permissions jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT o.id,o.name,r.id,r.permissions
 FROM public.platform_organization_sessions s
 JOIN public.organizations o ON o.id=s.organization_id AND o.deleted_at IS NULL
 JOIN public.roles r ON r.organization_id=o.id AND r.scope='organization' AND r.name='admin_org'
 WHERE s.id=target_session_id AND s.user_id=target_user_id
 AND s.revoked_at IS NULL AND s.expires_at>now()
 AND (SELECT count(*) FROM public.roles rr WHERE rr.organization_id=o.id AND rr.scope='organization' AND rr.name='admin_org')=1
 AND (SELECT count(*) FROM public.user_roles ur JOIN public.roles gr ON gr.id=ur.role_id
      WHERE ur.user_id::text=target_user_id::text AND gr.scope='global' AND jsonb_typeof(gr.permissions)='array')=1
 AND EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles gr ON gr.id=ur.role_id
      WHERE ur.user_id::text=target_user_id::text AND gr.scope='global'
      AND gr.permissions ? '5f6e284b-07b2-4e3c-aec3-a331c071719a');
$$;

CREATE OR REPLACE FUNCTION public.enter_platform_organization(target_organization_id text,target_user_id uuid,request_ip text,request_agent text)
RETURNS TABLE(session_id uuid,organization_id text,organization_name text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sid uuid; resolved record;
BEGIN
 INSERT INTO public.platform_organization_sessions(user_id,organization_id)
 VALUES(target_user_id,target_organization_id) RETURNING id INTO sid;
 SELECT * INTO resolved FROM public.resolve_platform_organization_session(sid,target_user_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization operation not authorized' USING ERRCODE='42501'; END IF;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent)
 VALUES(gen_random_uuid()::text,target_organization_id,target_user_id,'CREATE','platform_organization_session',sid::text,
   jsonb_build_object('after',jsonb_build_object('access_mode','platform_operation','organization_id',target_organization_id)),
   'success',request_ip,request_agent);
 RETURN QUERY SELECT s.id,s.organization_id,resolved.organization_name,s.expires_at FROM public.platform_organization_sessions s WHERE s.id=sid;
END $$;

CREATE OR REPLACE FUNCTION public.update_organization_registration(target_organization_id text,target_user_id uuid,target_registration jsonb,request_ip text,request_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous jsonb;
BEGIN
 IF jsonb_typeof(target_registration)<>'object' OR octet_length(target_registration::text)>16000 THEN
   RAISE EXCEPTION 'Invalid organization registration'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
   WHERE ur.user_id::text=target_user_id::text AND r.scope='global' AND r.permissions ? 'ede45b9c-8af4-4b47-8490-9d386a3efb13') THEN
   RAISE EXCEPTION 'Organization update not authorized' USING ERRCODE='42501'; END IF;
 SELECT registration INTO previous FROM public.organizations WHERE id=target_organization_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found'; END IF;
 UPDATE public.organizations SET registration=target_registration,updated_at=now() WHERE id=target_organization_id;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent)
 VALUES(gen_random_uuid()::text,target_organization_id,target_user_id,'UPDATE','organization_registration',target_organization_id,
 jsonb_build_object('before',previous,'after',target_registration),'success',request_ip,request_agent);
 RETURN target_registration;
END $$;
REVOKE ALL ON FUNCTION public.resolve_platform_organization_session(uuid,uuid),public.enter_platform_organization(text,uuid,text,text),public.update_organization_registration(text,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_platform_organization_session(uuid,uuid),public.enter_platform_organization(text,uuid,text,text),public.update_organization_registration(text,uuid,jsonb,text,text) TO service_role;
COMMIT;
