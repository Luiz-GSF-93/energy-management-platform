BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.organization_branding_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 revision integer NOT NULL CHECK(revision>0), object_path text NOT NULL CHECK(length(object_path)<300),
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'), mime text NOT NULL CHECK(mime='image/png'),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 60000), created_by text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,revision), UNIQUE(object_path)
);
ALTER TABLE public.organization_branding_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_branding_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_branding_versions FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.organization_branding_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'Branding history is immutable' USING ERRCODE='42501';END$$;
CREATE TRIGGER organization_branding_immutable BEFORE UPDATE OR DELETE ON public.organization_branding_versions FOR EACH ROW EXECUTE FUNCTION public.organization_branding_immutable();
CREATE FUNCTION public.organization_branding_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_revision integer,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE member record; org_name text; latest public.organization_branding_versions; saved public.organization_branding_versions; entitlement jsonb;
BEGIN
 IF p_org IS NULL OR p_actor IS NULL OR p_role IS NULL OR p_platform IS NULL OR p_action IS NULL OR p_action NOT IN('read','access','save') THEN RAISE EXCEPTION 'Branding actor required' USING ERRCODE='42501';END IF;
 SELECT name INTO org_name FROM public.organizations WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization unavailable' USING ERRCODE='42501';END IF;
 IF p_platform THEN
  PERFORM public.assert_license_platform_actor(p_actor::uuid);
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Active platform organization session required' USING ERRCODE='42501';END IF;
 ELSE
  IF (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND user_id::text=p_actor AND upper(status)='ACTIVE')<>1 THEN RAISE EXCEPTION 'Unique active membership required' USING ERRCODE='42501';END IF;
  SELECT r.name,m.affiliation_type,m.exclusive_customer_id INTO member FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
  WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' FOR SHARE OF m,r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active organization membership required' USING ERRCODE='42501';END IF;
  IF p_action<>'read' AND (member.name<>'admin_org' OR member.exclusive_customer_id IS NOT NULL OR member.affiliation_type IS DISTINCT FROM 'internal') THEN RAISE EXCEPTION 'Organization administrator required' USING ERRCODE='42501';END IF;
  IF member.exclusive_customer_id IS NOT NULL THEN
   IF member.name<>'consulta' OR member.affiliation_type IS DISTINCT FROM 'external' OR p_action<>'read' THEN RAISE EXCEPTION 'Client branding read only' USING ERRCODE='42501';END IF;
   entitlement:=public.client_portal_entitlement(p_org,p_actor,p_role,NULL);
   IF entitlement->>'enabled' IS DISTINCT FROM 'true' OR entitlement->>'customerId' IS DISTINCT FROM member.exclusive_customer_id THEN RAISE EXCEPTION 'Client license unavailable' USING ERRCODE='42501';END IF;
  END IF;
 END IF;
 IF p_action<>'read' THEN PERFORM pg_advisory_xact_lock(hashtextextended('org-branding:'||p_org,0));END IF;
 SELECT * INTO latest FROM public.organization_branding_versions WHERE organization_id=p_org ORDER BY revision DESC LIMIT 1;
 IF p_action='save' THEN
  IF p_revision IS NULL OR p_revision<>coalesce(latest.revision,0) THEN RAISE EXCEPTION 'Branding revision changed' USING ERRCODE='40001';END IF;
  IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['bytes','mime','object_path','reason','sha256'] OR left(p_body->>'object_path',length(p_org)+1)<>p_org||'/' OR p_body->>'object_path'~'\.\.' OR length(btrim(p_body->>'reason')) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Invalid branding input' USING ERRCODE='22023';END IF;
  INSERT INTO public.organization_branding_versions(organization_id,revision,object_path,sha256,mime,bytes,created_by,reason)
  VALUES(p_org,p_revision+1,p_body->>'object_path',p_body->>'sha256',p_body->>'mime',(p_body->>'bytes')::integer,p_actor,btrim(p_body->>'reason')) RETURNING * INTO saved;
  latest:=saved;
 END IF;
 RETURN jsonb_build_object('organizationId',p_org,'name',org_name,'revision',coalesce(latest.revision,0),'objectPath',latest.object_path,'sha256',latest.sha256,'bytes',latest.bytes,'updatedAt',latest.created_at);
END$$;
REVOKE ALL ON FUNCTION public.organization_branding_action(text,text,text,boolean,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organization_branding_action(text,text,text,boolean,text,integer,jsonb) TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('organization-branding','organization-branding',false,60000,ARRAY['image/png']) ON CONFLICT(id) DO NOTHING;
DO $$BEGIN IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='organization-branding' AND public) THEN RAISE EXCEPTION 'Branding bucket must be private';END IF;END$$;
COMMIT;
