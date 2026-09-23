-- P2.3a.5 — Initial Organization Administrator Bootstrap
--
-- Establishes:
--   1. dedicated Platform Administration bootstrap permission;
--   2. admin_platform ownership of that permission;
--   3. service-role-only atomic first-admin membership bootstrap.
--
-- Verified production schema:
--   permissions.id                        text
--   permissions.code                      varchar
--   permissions.name                      varchar
--   permissions.description               text
--   permissions.module                    varchar
--   permissions.resource                  varchar
--   permissions.action                    varchar
--
--   organizations.id                      text
--   organizations.deleted_at              timestamptz
--
--   roles.id                              text
--   roles.organization_id                 text
--   roles.name                            text
--   roles.permissions                     jsonb
--   roles.scope                           varchar
--
--   organization_members.id               text
--   organization_members.user_id          uuid
--   organization_members.organization_id  text
--   organization_members.role_id          text
--   organization_members.status           varchar
--
-- Existing complementary constraint:
--   UNIQUE (user_id, organization_id)
--
-- Verified PostgreSQL primitives:
--   hashtextextended(text, bigint) -> bigint
--   pg_advisory_xact_lock(bigint)  -> void
--
-- Normal organization User Management remains organization-scoped.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.permissions
    WHERE code =
      'platform.organizations.bootstrap_admin'
      AND id <> 'd092e9bc-fbe6-4525-9f36-4a29a674515b'
  ) THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE =
          'bootstrap_permission_code_conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.permissions
    WHERE id = 'd092e9bc-fbe6-4525-9f36-4a29a674515b'
      AND (
        code <>
          'platform.organizations.bootstrap_admin'
        OR name <>
          'platform.organizations.bootstrap_admin'
      )
  ) THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE =
          'bootstrap_permission_id_conflict';
  END IF;

  INSERT INTO public.permissions (
    id,
    code,
    name,
    description,
    module,
    resource,
    action
  )
  VALUES (
    'd092e9bc-fbe6-4525-9f36-4a29a674515b',
    'platform.organizations.bootstrap_admin',
    'platform.organizations.bootstrap_admin',
    'Bootstrap do primeiro administrador da organização',
    'gestao',
    'organizations',
    'bootstrap_admin'
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM public.permissions
    WHERE id = 'd092e9bc-fbe6-4525-9f36-4a29a674515b'
      AND code =
        'platform.organizations.bootstrap_admin'
      AND name =
        'platform.organizations.bootstrap_admin'
      AND module = 'gestao'
      AND resource = 'organizations'
      AND action = 'bootstrap_admin'
  ) THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE =
          'bootstrap_permission_postflight_failed';
  END IF;
END
$$;

DO $$
DECLARE
  platform_role_id text;
  platform_role_count integer;
  current_permissions jsonb;
BEGIN
  SELECT COUNT(*)
  INTO platform_role_count
  FROM public.roles
  WHERE name = 'admin_platform'
    AND scope = 'global';

  IF platform_role_count <> 1 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE =
          'bootstrap_admin_platform_role_integrity';
  END IF;

  SELECT
    id,
    COALESCE(
      permissions,
      '[]'::jsonb
    )
  INTO
    platform_role_id,
    current_permissions
  FROM public.roles
  WHERE name = 'admin_platform'
    AND scope = 'global';

  IF jsonb_typeof(
    current_permissions
  ) <> 'array' THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P0001',
        MESSAGE =
          'bootstrap_admin_platform_permissions_integrity';
  END IF;

  IF NOT (
    current_permissions
    @> jsonb_build_array(
      'd092e9bc-fbe6-4525-9f36-4a29a674515b'
    )
  ) THEN
    UPDATE public.roles
    SET
      permissions =
        current_permissions
        || jsonb_build_array(
          'd092e9bc-fbe6-4525-9f36-4a29a674515b'
        ),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = platform_role_id;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION
public.bootstrap_initial_organization_admin(
  target_organization_id text,
  target_user_id uuid
)
RETURNS TABLE (
  membership_id text,
  organization_id text,
  user_id uuid,
  role_id text,
  membership_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  organization_count integer;
  admin_role_count integer;
  admin_role_id text;
  active_admin_exists boolean;
  target_membership_exists boolean;

  created_membership_id text;
  created_organization_id text;
  created_user_id uuid;
  created_role_id text;
  created_status text;
BEGIN
  IF target_organization_id IS NULL
     OR btrim(
       target_organization_id
     ) = ''
     OR target_user_id IS NULL THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3001',
        MESSAGE =
          'bootstrap_invalid_argument';
  END IF;

  -- Serialize bootstrap attempts independently
  -- for each Organization.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id,
      0
    )
  );

  SELECT COUNT(*)
  INTO organization_count
  FROM public.organizations
  WHERE id = target_organization_id
    AND deleted_at IS NULL;

  IF organization_count = 0 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3002',
        MESSAGE =
          'bootstrap_organization_not_found';
  END IF;

  IF organization_count <> 1 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3003',
        MESSAGE =
          'bootstrap_organization_integrity';
  END IF;

  SELECT COUNT(*)
  INTO admin_role_count
  FROM public.roles
  WHERE organization_id =
        target_organization_id
    AND scope = 'organization'
    AND name = 'admin_org';

  IF admin_role_count <> 1 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3004',
        MESSAGE =
          'bootstrap_admin_role_integrity';
  END IF;

  SELECT id
  INTO admin_role_id
  FROM public.roles
  WHERE organization_id =
        target_organization_id
    AND scope = 'organization'
    AND name = 'admin_org';

  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.roles r
      ON r.id = om.role_id
     AND r.organization_id =
         om.organization_id
    WHERE om.organization_id =
          target_organization_id
      AND om.status = 'active'
      AND r.scope = 'organization'
      AND r.name IN (
        'admin_org',
        'gestor'
      )
  )
  INTO active_admin_exists;

  IF active_admin_exists THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3010',
        MESSAGE =
          'bootstrap_admin_already_exists';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id =
          target_organization_id
      AND user_id =
          target_user_id
  )
  INTO target_membership_exists;

  IF target_membership_exists THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3011',
        MESSAGE =
          'bootstrap_membership_already_exists';
  END IF;

  INSERT INTO public.organization_members (
    organization_id,
    user_id,
    role_id,
    status
  )
  VALUES (
    target_organization_id,
    target_user_id,
    admin_role_id,
    'active'
  )
  RETURNING
    id,
    organization_members.organization_id,
    organization_members.user_id,
    organization_members.role_id,
    organization_members.status
  INTO
    created_membership_id,
    created_organization_id,
    created_user_id,
    created_role_id,
    created_status;

  IF created_membership_id IS NULL
     OR created_organization_id
        <> target_organization_id
     OR created_user_id
        <> target_user_id
     OR created_role_id
        <> admin_role_id
     OR created_status
        <> 'active' THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3005',
        MESSAGE =
          'bootstrap_membership_confirmation_failed';
  END IF;

  RETURN QUERY
  SELECT
    created_membership_id,
    created_organization_id,
    created_user_id,
    created_role_id,
    created_status;

EXCEPTION
  WHEN unique_violation THEN
    -- Complementary protection for the verified:
    -- UNIQUE(user_id, organization_id).
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3012',
        MESSAGE =
          'bootstrap_membership_concurrent_conflict';
END;
$$;

REVOKE ALL
ON FUNCTION
  public.bootstrap_initial_organization_admin(
    text,
    uuid
  )
FROM PUBLIC;

REVOKE ALL
ON FUNCTION
  public.bootstrap_initial_organization_admin(
    text,
    uuid
  )
FROM anon;

REVOKE ALL
ON FUNCTION
  public.bootstrap_initial_organization_admin(
    text,
    uuid
  )
FROM authenticated;

GRANT EXECUTE
ON FUNCTION
  public.bootstrap_initial_organization_admin(
    text,
    uuid
  )
TO service_role;

DO $$
DECLARE
  permission_count integer;
  platform_grant_count integer;
  non_platform_grant_count integer;
  function_count integer;
  function_security_definer boolean;
  function_config text[];
  function_public_execute boolean;
  function_anon_execute boolean;
  function_authenticated_execute boolean;
  function_service_role_execute boolean;
BEGIN
  SELECT COUNT(*)
  INTO permission_count
  FROM public.permissions
  WHERE id = 'd092e9bc-fbe6-4525-9f36-4a29a674515b'
    AND code =
      'platform.organizations.bootstrap_admin'
    AND name =
      'platform.organizations.bootstrap_admin'
    AND module = 'gestao'
    AND resource = 'organizations'
    AND action = 'bootstrap_admin';

  IF permission_count <> 1 THEN
    RAISE EXCEPTION
      'bootstrap permission postflight failed';
  END IF;

  SELECT COUNT(*)
  INTO platform_grant_count
  FROM public.roles
  WHERE name = 'admin_platform'
    AND scope = 'global'
    AND COALESCE(
      permissions,
      '[]'::jsonb
    ) @> jsonb_build_array(
      'd092e9bc-fbe6-4525-9f36-4a29a674515b'
    );

  IF platform_grant_count <> 1 THEN
    RAISE EXCEPTION
      'bootstrap admin_platform grant postflight failed';
  END IF;

  SELECT COUNT(*)
  INTO non_platform_grant_count
  FROM public.roles
  WHERE NOT (
    name = 'admin_platform'
    AND scope = 'global'
  )
  AND COALESCE(
    permissions,
    '[]'::jsonb
  ) @> jsonb_build_array(
    'd092e9bc-fbe6-4525-9f36-4a29a674515b'
  );

  IF non_platform_grant_count <> 0 THEN
    RAISE EXCEPTION
      'bootstrap permission leaked to non-platform role';
  END IF;

  SELECT COUNT(*)
  INTO function_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname =
      'bootstrap_initial_organization_admin'
    AND pg_catalog.pg_get_function_identity_arguments(
      p.oid
    ) =
      'target_organization_id text, target_user_id uuid';

  IF function_count <> 1 THEN
    RAISE EXCEPTION
      'bootstrap function postflight failed';
  END IF;

  SELECT
    p.prosecdef,
    p.proconfig,
    pg_catalog.has_function_privilege(
      'public',
      'public.bootstrap_initial_organization_admin(text,uuid)',
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'anon',
      'public.bootstrap_initial_organization_admin(text,uuid)',
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'authenticated',
      'public.bootstrap_initial_organization_admin(text,uuid)',
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'service_role',
      'public.bootstrap_initial_organization_admin(text,uuid)',
      'EXECUTE'
    )
  INTO
    function_security_definer,
    function_config,
    function_public_execute,
    function_anon_execute,
    function_authenticated_execute,
    function_service_role_execute
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname =
      'bootstrap_initial_organization_admin'
    AND pg_catalog.pg_get_function_identity_arguments(
      p.oid
    ) =
      'target_organization_id text, target_user_id uuid';

  IF function_security_definer
     IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'bootstrap function is not SECURITY DEFINER';
  END IF;

  IF function_config IS NULL
     OR NOT (
       function_config
       @> ARRAY[
         'search_path=pg_catalog'
       ]::text[]
     ) THEN
    RAISE EXCEPTION
      'bootstrap function search_path postflight failed';
  END IF;

  IF function_public_execute THEN
    RAISE EXCEPTION
      'PUBLIC can execute bootstrap function';
  END IF;

  IF function_anon_execute THEN
    RAISE EXCEPTION
      'anon can execute bootstrap function';
  END IF;

  IF function_authenticated_execute THEN
    RAISE EXCEPTION
      'authenticated can execute bootstrap function';
  END IF;

  IF function_service_role_execute
     IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'service_role cannot execute bootstrap function';
  END IF;
END
$$;
