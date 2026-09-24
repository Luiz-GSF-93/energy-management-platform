-- F1.6: public business writes are owned by the NestJS backend.
-- Apply as database owner after staging validation. No business rows are changed.
-- The current Next.js app uses NestJS, not direct PostgREST CRUD.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'customers', 'consumer_units', 'energy_contracts', 'documents', 'invoices',
    'roles', 'role_permissions', 'user_roles', 'organization_members', 'user_profiles'
  ] LOOP
    IF to_regclass('public.' || relation_name) IS NULL THEN
      RAISE EXCEPTION 'Missing expected relation public.%', relation_name;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.' || relation_name)) THEN
      RAISE EXCEPTION 'RLS must already be enabled on public.%', relation_name;
    END IF;
  END LOOP;
  IF to_regclass('public.v_expiring_contracts') IS NULL THEN
    RAISE EXCEPTION 'Missing expected contracts view';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='insert_calculation_validation') THEN
    RAISE EXCEPTION 'Missing expected validation routine';
  END IF;
END;
$preflight$;

-- These domains already expose permission-protected NestJS endpoints. Browser
-- access must not bypass RBAC, licensing, audit or future publication checks.
DO $privileges$
DECLARE relation_name text; columns_sql text; target_role text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'customers', 'consumer_units', 'energy_contracts', 'documents', 'invoices'
  ] LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO columns_sql
      FROM pg_attribute WHERE attrelid=to_regclass('public.' || relation_name)
      AND attnum>0 AND NOT attisdropped;
    FOREACH target_role IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated'] LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %s', relation_name, target_role);
      EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM %s', columns_sql, relation_name, target_role);
    END LOOP;
  END LOOP;

  -- Preserve reads required by existing policies, but no direct privilege edits.
  FOREACH relation_name IN ARRAY ARRAY[
    'roles', 'role_permissions', 'user_roles', 'organization_members', 'user_profiles'
  ] LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO columns_sql
      FROM pg_attribute WHERE attrelid=to_regclass('public.' || relation_name)
      AND attnum>0 AND NOT attisdropped;
    FOREACH target_role IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated'] LOOP
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM %s', relation_name, target_role);
      EXECUTE format('REVOKE INSERT (%s), UPDATE (%s), REFERENCES (%s) ON TABLE public.%I FROM %s', columns_sql, columns_sql, columns_sql, relation_name, target_role);
    END LOOP;
  END LOOP;
END;
$privileges$;

-- Remove the self-referencing profile policy. Deny drift rather than silently
-- combine a new rule with an unknown permissive policy.
DO $profile_policies$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_profiles'
      AND policyname NOT IN ('Users can update own profile', 'Users can view profiles in their org',
                             'f1_6_profile_select_self', 'f1_6_profile_update_presentation')) THEN
    RAISE EXCEPTION 'Unexpected user_profiles policy; review schema drift before applying F1.6';
  END IF;
END;
$profile_policies$;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view profiles in their org" ON public.user_profiles;
DROP POLICY IF EXISTS f1_6_profile_select_self ON public.user_profiles;
DROP POLICY IF EXISTS f1_6_profile_update_presentation ON public.user_profiles;
CREATE POLICY f1_6_profile_select_self ON public.user_profiles
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY f1_6_profile_update_presentation ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
GRANT UPDATE (name, avatar_url) ON public.user_profiles TO authenticated;

ALTER VIEW public.v_expiring_contracts SET (security_invoker = true);
REVOKE ALL PRIVILEGES ON public.v_expiring_contracts FROM PUBLIC, anon, authenticated;

-- This legacy function trusts financial values and author supplied by callers.
-- No browser caller may use it as an alternative to the validation workflow.
DO $rpc$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='insert_calculation_validation'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
  END LOOP;
END;
$rpc$;

DO $postflight$
DECLARE relation_name text; target_role text; fn record;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['customers','consumer_units','energy_contracts','documents','invoices'] LOOP
    FOREACH target_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_any_column_privilege(target_role, 'public.' || relation_name, 'SELECT,INSERT,UPDATE,REFERENCES')
         OR has_table_privilege(target_role, 'public.' || relation_name, 'DELETE,TRUNCATE,TRIGGER') THEN
        RAISE EXCEPTION 'Unexpected inherited business access for % on %', target_role, relation_name;
      END IF;
    END LOOP;
  END LOOP;
  IF has_column_privilege('authenticated','public.user_profiles','organization_id','UPDATE')
     OR has_column_privilege('authenticated','public.user_profiles','role_id','UPDATE')
     OR has_column_privilege('authenticated','public.roles','permissions','UPDATE') THEN
    RAISE EXCEPTION 'Privilege-changing browser write still allowed';
  END IF;
  FOR fn IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='insert_calculation_validation' LOOP
    IF has_function_privilege('anon',fn.oid,'EXECUTE') OR has_function_privilege('authenticated',fn.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected inherited validation RPC execution';
    END IF;
  END LOOP;
END;
$postflight$;
COMMIT;
