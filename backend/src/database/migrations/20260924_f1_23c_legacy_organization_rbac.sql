-- F1.23c: repair the two pre-provisioning organizations without granting new memberships.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $repair$
DECLARE org text; canonical record; inserted_id text;
BEGIN
 FOR org IN SELECT id FROM public.organizations WHERE id IN ('org_default','1ed1c75e-55f8-402d-9046-ac3d446b406a') AND deleted_at IS NULL FOR UPDATE LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(org,315));
  IF EXISTS(SELECT 1 FROM public.roles WHERE organization_id=org AND scope='organization' GROUP BY name HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Duplicate organization roles require manual review';
  END IF;
  FOR canonical IN SELECT * FROM public.resolve_canonical_organization_rbac() LOOP
   IF NOT EXISTS(SELECT 1 FROM public.roles WHERE organization_id=org AND name=canonical.role_name AND scope='organization') THEN
    inserted_id:=gen_random_uuid()::text;
    INSERT INTO public.roles(id,organization_id,name,permissions,scope) VALUES(inserted_id,org,canonical.role_name,canonical.permission_ids,'organization');
    INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status)
    VALUES(gen_random_uuid()::text,org,NULL,'CREATE','role',inserted_id,jsonb_build_object('migration','F1.23c','name',canonical.role_name,'permissions',canonical.permission_ids),'success');
   END IF;
  END LOOP;
 END LOOP;
END $repair$;
COMMIT;
