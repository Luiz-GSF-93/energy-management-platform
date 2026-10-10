-- Global platform team. Existing admin_platform identity/role remain unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
DO $$ BEGIN
 IF (SELECT count(*) FROM public.roles WHERE scope='global' AND name='admin_platform')<>1 THEN
  RAISE EXCEPTION 'Owner role integrity failed'; END IF;
 IF (SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE r.scope='global' AND r.name='admin_platform') NOT BETWEEN 1 AND 2 THEN
  RAISE EXCEPTION 'Review existing Owners before migration'; END IF;
 IF EXISTS(SELECT u.user_id FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE r.scope='global' GROUP BY u.user_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Ambiguous global identity'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE r.scope='global' AND r.name NOT IN ('admin_platform','platform_administrator','platform_finance','platform_support'))
 OR EXISTS(SELECT 1 FROM public.roles WHERE scope='global' AND name='admin_platform' AND jsonb_typeof(permissions) IS DISTINCT FROM 'array') THEN
  RAISE EXCEPTION 'Review existing global assignments'; END IF;
END $$;
INSERT INTO public.permissions(id,code,name,module,resource,action) VALUES
 ('82e7fc71-479a-4dd6-8b22-4fba6eaa6841','platform.team.manage','Gerenciar equipe da plataforma','platform','team','manage'),
 ('699703af-10ba-43a3-8eb8-9f0d9e477498','platform.costs.view','Consultar gastos da plataforma','platform','costs','view'),
 ('c51b6e94-969a-4b9b-bcf9-05c18a4cb2d7','platform.support.view','Consultar entregas e modelos','platform','support','view')
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.permissions WHERE id='82e7fc71-479a-4dd6-8b22-4fba6eaa6841' AND code='platform.team.manage')
 OR NOT EXISTS(SELECT 1 FROM public.permissions WHERE id='699703af-10ba-43a3-8eb8-9f0d9e477498' AND code='platform.costs.view')
 OR NOT EXISTS(SELECT 1 FROM public.permissions WHERE id='c51b6e94-969a-4b9b-bcf9-05c18a4cb2d7' AND code='platform.support.view') THEN
  RAISE EXCEPTION 'Permission identifiers conflict'; END IF;
END $$;
UPDATE public.roles SET permissions=permissions ||
 (SELECT coalesce(jsonb_agg(p),'[]'::jsonb) FROM jsonb_array_elements_text('["82e7fc71-479a-4dd6-8b22-4fba6eaa6841","699703af-10ba-43a3-8eb8-9f0d9e477498","c51b6e94-969a-4b9b-bcf9-05c18a4cb2d7"]'::jsonb) p WHERE NOT permissions ? p)
WHERE scope='global' AND name='admin_platform';
INSERT INTO public.roles(id,organization_id,name,scope,permissions)
SELECT x.id,r.organization_id,x.name,'global',x.permissions::jsonb
FROM public.roles r CROSS JOIN (VALUES
 ('19a48d9e-bbc4-4297-a83a-f5f8b83a2e28','platform_administrator','["9a679254-bb1a-4353-9d17-cc2bd9eb5abd","6f62969b-1a2d-4adc-a784-2f49cba40dd5","ede45b9c-8af4-4b47-8490-9d386a3efb13"]'),
 ('982324a9-f135-4d8a-aed8-2f2b38e64a07','platform_finance','["699703af-10ba-43a3-8eb8-9f0d9e477498"]'),
 ('2eb8c83f-4d5c-45ac-9c6e-9c3a23bb54aa','platform_support','["c51b6e94-969a-4b9b-bcf9-05c18a4cb2d7"]')
) x(id,name,permissions)
WHERE r.scope='global' AND r.name='admin_platform'
ON CONFLICT(id) DO NOTHING;
-- Never overwrite a preexisting role with conflicting permissions.
DO $$ BEGIN
 IF (SELECT count(*) FROM public.roles WHERE scope='global' AND organization_id=(SELECT organization_id FROM public.roles WHERE scope='global' AND name='admin_platform') AND
 ((id='19a48d9e-bbc4-4297-a83a-f5f8b83a2e28' AND name='platform_administrator' AND permissions='["9a679254-bb1a-4353-9d17-cc2bd9eb5abd","6f62969b-1a2d-4adc-a784-2f49cba40dd5","ede45b9c-8af4-4b47-8490-9d386a3efb13"]'::jsonb)
 OR (id='982324a9-f135-4d8a-aed8-2f2b38e64a07' AND name='platform_finance' AND permissions='["699703af-10ba-43a3-8eb8-9f0d9e477498"]'::jsonb)
 OR (id='2eb8c83f-4d5c-45ac-9c6e-9c3a23bb54aa' AND name='platform_support' AND permissions='["c51b6e94-969a-4b9b-bcf9-05c18a4cb2d7"]'::jsonb)))<>3 THEN
  RAISE EXCEPTION 'Team roles conflict'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.platform_team_members(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id),
 profile text NOT NULL CHECK(profile IN ('OWNER','ADMINISTRATOR','FINANCE','SUPPORT')),
 first_name text, last_name text,
 active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_team_members FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS public.platform_team_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 target_id uuid NOT NULL REFERENCES auth.users(id),
 changes jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_team_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_team_audit FROM PUBLIC,anon,authenticated,service_role;
-- Preserve bootstrap identities and exact historical name; do not invent split names.
INSERT INTO public.platform_team_members(user_id,profile)
SELECT u.user_id::uuid,'OWNER' FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id
WHERE r.scope='global' AND r.name='admin_platform' ON CONFLICT(user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.platform_team_owner(p_actor uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org text;
BEGIN
 IF (SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE u.user_id::text=p_actor::text AND r.scope='global')<>1 THEN
  RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 SELECT r.organization_id INTO org FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id
 JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text AND t.active AND t.profile='OWNER'
 WHERE u.user_id::text=p_actor::text AND r.scope='global' AND r.name='admin_platform'
 AND r.permissions ? '82e7fc71-479a-4dd6-8b22-4fba6eaa6841';
 IF org IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE user_id=p_actor) THEN
  RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 RETURN org;
END $$;
CREATE OR REPLACE FUNCTION public.platform_team_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
 RETURN coalesce(NEW,OLD);
END $$;
CREATE OR REPLACE FUNCTION public.platform_team_bounds() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE owners integer;
BEGIN
 SELECT count(*) INTO owners FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE r.scope='global' AND r.name='admin_platform';
 IF owners<1 THEN RAISE EXCEPTION 'Last Owner protected' USING ERRCODE='P4001'; END IF;
 IF owners>2 THEN RAISE EXCEPTION 'Two Owners maximum' USING ERRCODE='P4002'; END IF;
 IF EXISTS(SELECT u.user_id FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE r.scope='global' GROUP BY u.user_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'One global profile per identity' USING ERRCODE='P4004'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id LEFT JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text
 WHERE r.scope='global' AND (t.user_id IS NULL OR NOT t.active OR r.name IS DISTINCT FROM CASE t.profile
 WHEN 'OWNER' THEN 'admin_platform' WHEN 'ADMINISTRATOR' THEN 'platform_administrator' WHEN 'FINANCE' THEN 'platform_finance' WHEN 'SUPPORT' THEN 'platform_support' END)) THEN
  RAISE EXCEPTION 'Global assignment does not match active team profile' USING ERRCODE='P4004'; END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS platform_team_write_lock ON public.user_roles;
CREATE TRIGGER platform_team_write_lock BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.platform_team_lock();
DROP TRIGGER IF EXISTS platform_team_owner_bounds ON public.user_roles;
CREATE CONSTRAINT TRIGGER platform_team_owner_bounds AFTER INSERT OR UPDATE OR DELETE ON public.user_roles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.platform_team_bounds();

CREATE OR REPLACE FUNCTION public.prepare_platform_team_invite(p_actor uuid,p_profile text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM public.platform_team_owner(p_actor);
 IF p_profile NOT IN ('OWNER','ADMINISTRATOR','FINANCE','SUPPORT') OR p_profile IS NULL THEN RAISE EXCEPTION 'Invalid profile' USING ERRCODE='22023'; END IF;
 IF p_profile='OWNER' AND (SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE r.scope='global' AND r.name='admin_platform')>=2 THEN
  RAISE EXCEPTION 'Two Owners maximum' USING ERRCODE='P4002'; END IF;
 RETURN jsonb_build_object('authorized',true);
END $$;
CREATE OR REPLACE FUNCTION public.read_platform_team(p_actor uuid,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; org text;
BEGIN
 org:=public.platform_team_owner(p_actor);
 IF p_offset<0 OR p_offset>250000 OR p_offset IS NULL THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(j),'[]'::jsonb) INTO result FROM
 (SELECT jsonb_build_object('userId',t.user_id,'profile',t.profile,'firstName',t.first_name,'lastName',t.last_name,
 'registeredName',p.name,'email',p.email,'active',t.active,'revision',t.revision) j
 FROM public.platform_team_members t LEFT JOIN public.user_profiles p ON p.user_id=t.user_id
 ORDER BY t.created_at,t.user_id LIMIT 25 OFFSET p_offset) q;
 RETURN jsonb_build_object('rows',result,'total',(SELECT count(*) FROM public.platform_team_members),
 'ownerCount',(SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE r.scope='global' AND r.name='admin_platform'),
 'history',coalesce((SELECT jsonb_agg(j) FROM (SELECT jsonb_build_object('id',a.id,'at',a.created_at,'actorId',a.actor_id,'targetId',a.target_id,'changes',a.changes) j
 FROM public.platform_team_audit a ORDER BY a.created_at DESC,a.id DESC LIMIT 20) h),'[]'::jsonb));
END $$;
CREATE OR REPLACE FUNCTION public.save_platform_team_member(p_actor uuid,p_user uuid,p_profile text,p_first text,p_last text,p_active boolean,p_revision integer,p_email text,p_new_identity boolean,p_reason text,p_ip text,p_agent text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org text; target_role text; previous public.platform_team_members%ROWTYPE; assignment public.user_roles%ROWTYPE; result jsonb; actor_name text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
 org:=public.platform_team_owner(p_actor);
 IF p_profile IS NULL OR p_profile NOT IN ('OWNER','ADMINISTRATOR','FINANCE','SUPPORT') OR p_active IS NULL
 OR length(btrim(coalesce(p_first,''))) NOT BETWEEN 1 AND 80 OR length(btrim(coalesce(p_last,''))) NOT BETWEEN 1 AND 120
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Invalid team input' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous FROM public.platform_team_members WHERE user_id=p_user FOR UPDATE;
 IF (previous.user_id IS NULL AND p_revision IS NOT NULL) OR (previous.user_id IS NOT NULL AND p_revision IS DISTINCT FROM previous.revision) THEN
  RAISE EXCEPTION 'Stale team version' USING ERRCODE='P4003'; END IF;
 IF previous.user_id IS NULL THEN
  IF p_email IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND lower(email)=p_email)
  OR EXISTS(SELECT 1 FROM public.organization_members WHERE user_id=p_user)
  OR EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE u.user_id::text=p_user::text AND r.scope='global') THEN
   RAISE EXCEPTION 'Identity affiliation conflict' USING ERRCODE='P4004'; END IF;
  IF p_new_identity THEN
   INSERT INTO public.user_profiles(id,user_id,email,name,organization_id,affiliation_type)
   VALUES(gen_random_uuid()::text,p_user,p_email,btrim(p_first)||' '||btrim(p_last),org,'internal');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE user_id=p_user AND lower(email)=p_email AND organization_id=org) THEN
   RAISE EXCEPTION 'Identity profile mismatch' USING ERRCODE='P4004'; END IF;
 ELSE
  IF p_new_identity OR p_email IS NOT NULL THEN RAISE EXCEPTION 'Identity cannot be rewritten' USING ERRCODE='22023'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE user_id=p_user) THEN RAISE EXCEPTION 'Profile unavailable' USING ERRCODE='P4004'; END IF;
 IF p_active AND EXISTS(SELECT 1 FROM public.organization_members m LEFT JOIN public.roles r ON r.id=m.role_id
 WHERE m.user_id=p_user AND NOT coalesce(r.scope='global' AND r.name='admin_platform' AND r.organization_id=org,false)) THEN
  RAISE EXCEPTION 'Team cannot reuse organization or Portal affiliation' USING ERRCODE='P4004'; END IF;
 SELECT id INTO target_role FROM public.roles WHERE scope='global' AND name=CASE p_profile WHEN 'OWNER' THEN 'admin_platform' WHEN 'ADMINISTRATOR' THEN 'platform_administrator' WHEN 'FINANCE' THEN 'platform_finance' ELSE 'platform_support' END;
 IF target_role IS NULL THEN RAISE EXCEPTION 'Team role missing'; END IF;
 IF previous.profile='OWNER' AND previous.active AND (NOT p_active OR p_profile<>'OWNER') AND
 (SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE r.scope='global' AND r.name='admin_platform')<=1 THEN
  RAISE EXCEPTION 'Last Owner protected' USING ERRCODE='P4001'; END IF;
 IF p_active AND p_profile='OWNER' AND NOT coalesce(previous.profile='OWNER' AND previous.active,false) AND
 (SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE r.scope='global' AND r.name='admin_platform')>=2 THEN
  RAISE EXCEPTION 'Two Owners maximum' USING ERRCODE='P4002'; END IF;
 DELETE FROM public.user_roles u USING public.roles r WHERE u.role_id=r.id AND r.scope='global' AND u.user_id::text=p_user::text;
 IF p_active THEN
  assignment.user_id:=p_user::text; assignment.role_id:=target_role;
  INSERT INTO public.user_roles(user_id,role_id) VALUES(assignment.user_id,assignment.role_id);
 END IF;
 INSERT INTO public.platform_team_members(user_id,profile,first_name,last_name,active)
 VALUES(p_user,p_profile,btrim(p_first),btrim(p_last),p_active)
 ON CONFLICT(user_id) DO UPDATE SET profile=excluded.profile,first_name=excluded.first_name,last_name=excluded.last_name,active=excluded.active,revision=platform_team_members.revision+1,updated_at=now();
 SELECT jsonb_build_object('userId',user_id,'profile',profile,'firstName',first_name,'lastName',last_name,'active',active,'revision',revision) INTO result FROM public.platform_team_members WHERE user_id=p_user;
 SELECT name INTO actor_name FROM public.user_profiles WHERE user_id=p_actor;
 INSERT INTO public.platform_team_audit(actor_id,target_id,changes)
 VALUES(p_actor,p_user,jsonb_build_object('action',CASE WHEN previous.user_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END,
 'before',CASE WHEN previous.user_id IS NULL THEN NULL ELSE to_jsonb(previous) END,'after',result,'reason',btrim(p_reason),
 'actorNameAtTime',actor_name,'actorProfileAtTime','OWNER','ip',left(p_ip,100),'agent',left(p_agent,1000)));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.platform_team_owner(uuid), public.platform_team_lock(),public.platform_team_bounds(),public.prepare_platform_team_invite(uuid,text),public.read_platform_team(uuid,integer),public.save_platform_team_member(uuid,uuid,text,text,text,boolean,integer,text,boolean,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_platform_team_invite(uuid,text),public.read_platform_team(uuid,integer),public.save_platform_team_member(uuid,uuid,text,text,text,boolean,integer,text,boolean,text,text,text) TO service_role;
COMMIT;
