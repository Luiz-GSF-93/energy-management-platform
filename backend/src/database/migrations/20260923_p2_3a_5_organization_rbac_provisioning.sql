-- P2.3a.5 — Organization RBAC Provisioning
--
-- Canonical Organization RBAC database boundary.
--
-- Installs:
--   1. canonical permission-code resolver;
--   2. atomic Organization + four-role Create primitive;
--   3. guarded existing-Organization RBAC backfill primitive.
--
-- Installation performs no Organization backfill.
-- Installation performs no administrator bootstrap.
--
-- Canonical role permission counts:
--   admin_org   53
--   gestor      39
--   operacional 26
--   consulta    12

-- =========================================================
-- PREFLIGHT
-- =========================================================

DO $$
DECLARE
  duplicate_permission_code_count integer;
BEGIN
  SELECT count(*)
  INTO duplicate_permission_code_count
  FROM (
    SELECT p.code
    FROM public.permissions p
    GROUP BY p.code
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_permission_code_count <> 0 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3101',
        MESSAGE =
          'rbac_permission_catalog_duplicate_code';
  END IF;
END;
$$;

-- =========================================================
-- SHARED CANONICAL RESOLVER
-- =========================================================

CREATE OR REPLACE FUNCTION
public.resolve_canonical_organization_rbac()
RETURNS TABLE (
  role_name text,
  permission_ids jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  expected_mapping_count integer := 130;
  actual_mapping_count integer;
  unresolved_count integer;
  canonical_role_count integer;
BEGIN
  CREATE TEMP TABLE canonical_rbac_mapping (
    role_name text NOT NULL,
    permission_code text NOT NULL,
    PRIMARY KEY (
      role_name,
      permission_code
    )
  )
  ON COMMIT DROP;

  INSERT INTO canonical_rbac_mapping (
    role_name,
    permission_code
  )
  VALUES
    ('admin_org', 'documents.archive.manage'),
    ('admin_org', 'documents.archive.view'),
    ('admin_org', 'documents.documents.delete'),
    ('admin_org', 'documents.documents.update'),
    ('admin_org', 'documents.documents.upload'),
    ('admin_org', 'documents.documents.view'),
    ('admin_org', 'documents.reports.create'),
    ('admin_org', 'documents.reports.view'),
    ('admin_org', 'energia.comparison.calculate'),
    ('admin_org', 'energia.comparison.view'),
    ('admin_org', 'energia.indicators.view'),
    ('admin_org', 'energia.invoices.create'),
    ('admin_org', 'energia.invoices.delete'),
    ('admin_org', 'energia.invoices.update'),
    ('admin_org', 'energia.invoices.view'),
    ('admin_org', 'energia.ocr.process'),
    ('admin_org', 'energia.savings.view'),
    ('admin_org', 'intelligence.ai.manage'),
    ('admin_org', 'intelligence.ai.use'),
    ('admin_org', 'operacao.calendar.manage'),
    ('admin_org', 'operacao.calendar.view'),
    ('admin_org', 'operacao.events.manage'),
    ('admin_org', 'operacao.events.view'),
    ('admin_org', 'operacao.pld.manage'),
    ('admin_org', 'operacao.pld.sync'),
    ('admin_org', 'operacao.pld.view'),
    ('admin_org', 'operacao.requests.manage'),
    ('admin_org', 'operacao.requests.view'),
    ('admin_org', 'organization.consumer_units.create'),
    ('admin_org', 'organization.consumer_units.delete'),
    ('admin_org', 'organization.consumer_units.update'),
    ('admin_org', 'organization.consumer_units.view'),
    ('admin_org', 'organization.contracts.create'),
    ('admin_org', 'organization.contracts.delete'),
    ('admin_org', 'organization.contracts.update'),
    ('admin_org', 'organization.contracts.view'),
    ('admin_org', 'organization.customers.create'),
    ('admin_org', 'organization.customers.delete'),
    ('admin_org', 'organization.customers.update'),
    ('admin_org', 'organization.customers.view'),
    ('admin_org', 'organization.licenses.create'),
    ('admin_org', 'organization.licenses.update'),
    ('admin_org', 'organization.licenses.view'),
    ('admin_org', 'organization.users.create'),
    ('admin_org', 'organization.users.delete'),
    ('admin_org', 'organization.users.invite'),
    ('admin_org', 'organization.users.update'),
    ('admin_org', 'organization.users.view'),
    ('admin_org', 'settings.appearance.manage'),
    ('admin_org', 'settings.notifications.manage'),
    ('admin_org', 'settings.profile.update'),
    ('admin_org', 'settings.profile.view'),
    ('admin_org', 'settings.security.manage'),
    ('gestor', 'documents.documents.update'),
    ('gestor', 'documents.documents.upload'),
    ('gestor', 'documents.documents.view'),
    ('gestor', 'documents.reports.create'),
    ('gestor', 'documents.reports.view'),
    ('gestor', 'energia.comparison.calculate'),
    ('gestor', 'energia.comparison.view'),
    ('gestor', 'energia.indicators.view'),
    ('gestor', 'energia.invoices.create'),
    ('gestor', 'energia.invoices.delete'),
    ('gestor', 'energia.invoices.update'),
    ('gestor', 'energia.invoices.view'),
    ('gestor', 'energia.ocr.process'),
    ('gestor', 'energia.savings.view'),
    ('gestor', 'intelligence.ai.use'),
    ('gestor', 'operacao.calendar.manage'),
    ('gestor', 'operacao.calendar.view'),
    ('gestor', 'operacao.events.manage'),
    ('gestor', 'operacao.events.view'),
    ('gestor', 'operacao.pld.view'),
    ('gestor', 'operacao.requests.manage'),
    ('gestor', 'operacao.requests.view'),
    ('gestor', 'organization.consumer_units.create'),
    ('gestor', 'organization.consumer_units.delete'),
    ('gestor', 'organization.consumer_units.update'),
    ('gestor', 'organization.consumer_units.view'),
    ('gestor', 'organization.contracts.create'),
    ('gestor', 'organization.contracts.delete'),
    ('gestor', 'organization.contracts.update'),
    ('gestor', 'organization.contracts.view'),
    ('gestor', 'organization.customers.create'),
    ('gestor', 'organization.customers.delete'),
    ('gestor', 'organization.customers.update'),
    ('gestor', 'organization.customers.view'),
    ('gestor', 'organization.licenses.view'),
    ('gestor', 'organization.users.invite'),
    ('gestor', 'organization.users.view'),
    ('gestor', 'settings.profile.update'),
    ('gestor', 'settings.profile.view'),
    ('operacional', 'documents.documents.view'),
    ('operacional', 'documents.reports.view'),
    ('operacional', 'energia.comparison.calculate'),
    ('operacional', 'energia.comparison.view'),
    ('operacional', 'energia.indicators.view'),
    ('operacional', 'energia.invoices.create'),
    ('operacional', 'energia.invoices.update'),
    ('operacional', 'energia.invoices.view'),
    ('operacional', 'energia.ocr.process'),
    ('operacional', 'energia.savings.view'),
    ('operacional', 'operacao.calendar.manage'),
    ('operacional', 'operacao.calendar.view'),
    ('operacional', 'operacao.events.manage'),
    ('operacional', 'operacao.events.view'),
    ('operacional', 'operacao.pld.sync'),
    ('operacional', 'operacao.pld.view'),
    ('operacional', 'operacao.requests.manage'),
    ('operacional', 'operacao.requests.view'),
    ('operacional', 'organization.consumer_units.create'),
    ('operacional', 'organization.consumer_units.update'),
    ('operacional', 'organization.consumer_units.view'),
    ('operacional', 'organization.contracts.update'),
    ('operacional', 'organization.contracts.view'),
    ('operacional', 'organization.customers.update'),
    ('operacional', 'organization.customers.view'),
    ('operacional', 'settings.profile.view'),
    ('consulta', 'documents.documents.view'),
    ('consulta', 'documents.reports.view'),
    ('consulta', 'energia.indicators.view'),
    ('consulta', 'energia.invoices.view'),
    ('consulta', 'energia.savings.view'),
    ('consulta', 'intelligence.ai.use'),
    ('consulta', 'operacao.calendar.view'),
    ('consulta', 'operacao.pld.view'),
    ('consulta', 'organization.consumer_units.view'),
    ('consulta', 'organization.contracts.view'),
    ('consulta', 'organization.customers.view'),
    ('consulta', 'settings.profile.view');

  SELECT count(*)
  INTO actual_mapping_count
  FROM canonical_rbac_mapping;

  IF actual_mapping_count <>
       expected_mapping_count THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3102',
        MESSAGE =
          'rbac_canonical_mapping_integrity';
  END IF;

  SELECT count(*)
  INTO unresolved_count
  FROM canonical_rbac_mapping m
  LEFT JOIN public.permissions p
    ON p.code = m.permission_code
  WHERE p.id IS NULL;

  IF unresolved_count <> 0 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3103',
        MESSAGE =
          'rbac_permission_catalog_incomplete';
  END IF;

  SELECT count(*)
  INTO canonical_role_count
  FROM (
    SELECT m.role_name
    FROM canonical_rbac_mapping m
    GROUP BY m.role_name
  ) canonical_roles;

  IF canonical_role_count <> 4 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3104',
        MESSAGE =
          'rbac_canonical_role_integrity';
  END IF;

  RETURN QUERY
  SELECT
    m.role_name,
    pg_catalog.jsonb_agg(
      p.id
      ORDER BY p.code
    )
  FROM canonical_rbac_mapping m
  JOIN public.permissions p
    ON p.code = m.permission_code
  GROUP BY m.role_name
  ORDER BY m.role_name;
END;
$$;

REVOKE ALL
ON FUNCTION
  public.resolve_canonical_organization_rbac()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION
  public.resolve_canonical_organization_rbac()
FROM anon;

REVOKE ALL
ON FUNCTION
  public.resolve_canonical_organization_rbac()
FROM authenticated;

REVOKE ALL
ON FUNCTION
  public.resolve_canonical_organization_rbac()
FROM service_role;

-- =========================================================
-- ATOMIC ORGANIZATION CREATE + RBAC
-- =========================================================

CREATE OR REPLACE FUNCTION
public.create_organization_with_canonical_rbac(
  target_organization_id text,
  target_name text,
  target_description text
)
RETURNS TABLE (
  organization_id text,
  organization_name text,
  organization_description text,
  organization_created_at timestamp,
  organization_updated_at timestamp,
  organization_deleted_at timestamptz,
  role_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  now_value timestamp :=
    pg_catalog.now()::timestamp;

  resolved_role record;

  created_role_count integer := 0;
  confirmed_role_count integer;
  canonical_mismatch_count integer;
BEGIN
  IF target_organization_id IS NULL
     OR pg_catalog.btrim(
       target_organization_id
     ) = ''
     OR target_name IS NULL
     OR pg_catalog.btrim(
       target_name
     ) = '' THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3110',
        MESSAGE =
          'rbac_create_invalid_argument';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id =
      target_organization_id
  ) THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3111',
        MESSAGE =
          'rbac_create_organization_id_conflict';
  END IF;

  INSERT INTO public.organizations (
    id,
    name,
    description,
    created_at,
    updated_at,
    deleted_at
  )
  VALUES (
    target_organization_id,
    pg_catalog.btrim(
      target_name
    ),
    NULLIF(
      pg_catalog.btrim(
        target_description
      ),
      ''
    ),
    now_value,
    now_value,
    NULL
  );

  FOR resolved_role IN
    SELECT *
    FROM public
      .resolve_canonical_organization_rbac()
  LOOP
    INSERT INTO public.roles (
      id,
      organization_id,
      name,
      permissions,
      created_at,
      updated_at,
      scope
    )
    VALUES (
      pg_catalog.gen_random_uuid()::text,
      target_organization_id,
      resolved_role.role_name,
      resolved_role.permission_ids,
      now_value,
      now_value,
      'organization'
    );

    created_role_count :=
      created_role_count + 1;
  END LOOP;

  SELECT count(*)
  INTO confirmed_role_count
  FROM public.roles r
  WHERE r.organization_id =
          target_organization_id
    AND r.scope = 'organization'
    AND r.name IN (
      'admin_org',
      'gestor',
      'operacional',
      'consulta'
    );

  SELECT count(*)
  INTO canonical_mismatch_count
  FROM public.resolve_canonical_organization_rbac() expected
  LEFT JOIN public.roles r
    ON r.organization_id = target_organization_id
   AND r.name = expected.role_name
   AND r.scope = 'organization'
   AND r.permissions = expected.permission_ids
  WHERE r.id IS NULL;

  IF created_role_count <> 4
     OR confirmed_role_count <> 4
     OR canonical_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3112',
        MESSAGE =
          'rbac_create_result_integrity';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.description,
    o.created_at,
    o.updated_at,
    o.deleted_at,
    confirmed_role_count
  FROM public.organizations o
  WHERE o.id =
    target_organization_id;
END;
$$;

REVOKE ALL
ON FUNCTION
  public.create_organization_with_canonical_rbac(
    text,
    text,
    text
  )
FROM PUBLIC;

REVOKE ALL
ON FUNCTION
  public.create_organization_with_canonical_rbac(
    text,
    text,
    text
  )
FROM anon;

REVOKE ALL
ON FUNCTION
  public.create_organization_with_canonical_rbac(
    text,
    text,
    text
  )
FROM authenticated;

GRANT EXECUTE
ON FUNCTION
  public.create_organization_with_canonical_rbac(
    text,
    text,
    text
  )
TO service_role;


-- =========================================================
-- GUARDED EXISTING-ORGANIZATION BACKFILL
-- =========================================================

CREATE OR REPLACE FUNCTION
public.backfill_canonical_organization_rbac(
  target_organization_id text
)
RETURNS TABLE (
  organization_id text,
  role_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  target_count integer;
  existing_role_count integer;
  existing_membership_count integer;

  created_role_count integer := 0;
  confirmed_role_count integer;
  canonical_mismatch_count integer;

  resolved_role record;

  now_value timestamp :=
    pg_catalog.now()::timestamp;
BEGIN
  IF target_organization_id IS NULL
     OR pg_catalog.btrim(
       target_organization_id
     ) = '' THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3120',
        MESSAGE =
          'rbac_backfill_invalid_argument';
  END IF;

  /*
   * Eligibility and mutation are serialized for
   * this Organization.
   */
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization-rbac:' ||
        target_organization_id,
      0
    )
  );

  /*
   * Re-evaluate Organization eligibility only
   * after acquiring the transaction lock.
   */
  SELECT count(*)
  INTO target_count
  FROM public.organizations o
  WHERE o.id =
          target_organization_id
    AND o.deleted_at IS NULL;

  IF target_count <> 1 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3121',
        MESSAGE =
          'rbac_backfill_organization_not_found';
  END IF;

  SELECT count(*)
  INTO existing_role_count
  FROM public.roles r
  WHERE r.organization_id =
          target_organization_id;

  SELECT count(*)
  INTO existing_membership_count
  FROM public.organization_members om
  WHERE om.organization_id =
          target_organization_id;

  /*
   * Backfill repairs only the exact zero-role,
   * zero-membership state.
   *
   * Partial RBAC state fails closed.
   */
  IF existing_role_count <> 0 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3122',
        MESSAGE =
          'rbac_backfill_existing_roles';
  END IF;

  IF existing_membership_count <> 0 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3123',
        MESSAGE =
          'rbac_backfill_existing_memberships';
  END IF;

  FOR resolved_role IN
    SELECT *
    FROM public
      .resolve_canonical_organization_rbac()
  LOOP
    INSERT INTO public.roles (
      id,
      organization_id,
      name,
      permissions,
      created_at,
      updated_at,
      scope
    )
    VALUES (
      pg_catalog.gen_random_uuid()::text,
      target_organization_id,
      resolved_role.role_name,
      resolved_role.permission_ids,
      now_value,
      now_value,
      'organization'
    );

    created_role_count :=
      created_role_count + 1;
  END LOOP;

  SELECT count(*)
  INTO confirmed_role_count
  FROM public.roles r
  WHERE r.organization_id =
          target_organization_id
    AND r.scope = 'organization'
    AND r.name IN (
      'admin_org',
      'gestor',
      'operacional',
      'consulta'
    );

  SELECT count(*)
  INTO canonical_mismatch_count
  FROM public.resolve_canonical_organization_rbac() expected
  LEFT JOIN public.roles r
    ON r.organization_id = target_organization_id
   AND r.name = expected.role_name
   AND r.scope = 'organization'
   AND r.permissions = expected.permission_ids
  WHERE r.id IS NULL;

  IF created_role_count <> 4
     OR confirmed_role_count <> 4
     OR canonical_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      USING
        ERRCODE = 'P3124',
        MESSAGE =
          'rbac_backfill_result_integrity';
  END IF;

  RETURN QUERY
  SELECT
    target_organization_id,
    confirmed_role_count;
END;
$$;

REVOKE ALL
ON FUNCTION
  public.backfill_canonical_organization_rbac(
    text
  )
FROM PUBLIC;

REVOKE ALL
ON FUNCTION
  public.backfill_canonical_organization_rbac(
    text
  )
FROM anon;

REVOKE ALL
ON FUNCTION
  public.backfill_canonical_organization_rbac(
    text
  )
FROM authenticated;

GRANT EXECUTE
ON FUNCTION
  public.backfill_canonical_organization_rbac(
    text
  )
TO service_role;


-- =========================================================
-- INSTALLATION POSTFLIGHT
-- =========================================================

DO $$
DECLARE
  resolver_oid oid;
  create_oid oid;
  backfill_oid oid;

  resolver_secdef boolean;
  create_secdef boolean;
  backfill_secdef boolean;

  resolver_config text[];
  create_config text[];
  backfill_config text[];

  resolver_public_execute boolean;
  resolver_anon_execute boolean;
  resolver_authenticated_execute boolean;
  resolver_service_execute boolean;

  create_public_execute boolean;
  create_anon_execute boolean;
  create_authenticated_execute boolean;
  create_service_execute boolean;

  backfill_public_execute boolean;
  backfill_anon_execute boolean;
  backfill_authenticated_execute boolean;
  backfill_service_execute boolean;
BEGIN
  -- -------------------------------------------------------
  -- Resolve exact installed functions.
  -- -------------------------------------------------------

  SELECT p.oid
  INTO resolver_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname =
      'resolve_canonical_organization_rbac'
    AND pg_catalog.pg_get_function_identity_arguments(
      p.oid
    ) = '';

  SELECT p.oid
  INTO create_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname =
      'create_organization_with_canonical_rbac'
    AND pg_catalog.pg_get_function_identity_arguments(
      p.oid
    ) =
      'target_organization_id text, target_name text, target_description text';

  SELECT p.oid
  INTO backfill_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname =
      'backfill_canonical_organization_rbac'
    AND pg_catalog.pg_get_function_identity_arguments(
      p.oid
    ) =
      'target_organization_id text';

  IF resolver_oid IS NULL
     OR create_oid IS NULL
     OR backfill_oid IS NULL THEN
    RAISE EXCEPTION
      'RBAC provisioning function installation postflight failed';
  END IF;

  -- -------------------------------------------------------
  -- SECURITY DEFINER + fixed search_path.
  -- -------------------------------------------------------

  SELECT
    p.prosecdef,
    p.proconfig
  INTO
    resolver_secdef,
    resolver_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = resolver_oid;

  SELECT
    p.prosecdef,
    p.proconfig
  INTO
    create_secdef,
    create_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = create_oid;

  SELECT
    p.prosecdef,
    p.proconfig
  INTO
    backfill_secdef,
    backfill_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = backfill_oid;

  IF NOT resolver_secdef
     OR NOT create_secdef
     OR NOT backfill_secdef THEN
    RAISE EXCEPTION
      'RBAC provisioning SECURITY DEFINER postflight failed';
  END IF;

  IF resolver_config IS NULL
     OR NOT (
       'search_path=pg_catalog'
       = ANY(resolver_config)
     )
     OR create_config IS NULL
     OR NOT (
       'search_path=pg_catalog'
       = ANY(create_config)
     )
     OR backfill_config IS NULL
     OR NOT (
       'search_path=pg_catalog'
       = ANY(backfill_config)
     ) THEN
    RAISE EXCEPTION
      'RBAC provisioning search_path postflight failed';
  END IF;

  -- -------------------------------------------------------
  -- Resolver ACL.
  --
  -- Resolver is internal. It is callable by the two
  -- SECURITY DEFINER functions through function-owner
  -- authority, not directly by application roles.
  -- -------------------------------------------------------

  SELECT
    pg_catalog.has_function_privilege(
      'PUBLIC',
      resolver_oid,
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'anon',
      resolver_oid,
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'authenticated',
      resolver_oid,
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'service_role',
      resolver_oid,
      'EXECUTE'
    )
  INTO
    resolver_public_execute,
    resolver_anon_execute,
    resolver_authenticated_execute,
    resolver_service_execute;

  IF resolver_public_execute
     OR resolver_anon_execute
     OR resolver_authenticated_execute
     OR resolver_service_execute THEN
    RAISE EXCEPTION
      'RBAC resolver execution privilege postflight failed';
  END IF;

  -- -------------------------------------------------------
  -- Create RPC ACL.
  -- -------------------------------------------------------

  SELECT
    pg_catalog.has_function_privilege(
      'PUBLIC',
      create_oid,
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'anon',
      create_oid,
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'authenticated',
      create_oid,
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'service_role',
      create_oid,
      'EXECUTE'
    )
  INTO
    create_public_execute,
    create_anon_execute,
    create_authenticated_execute,
    create_service_execute;

  IF create_public_execute
     OR create_anon_execute
     OR create_authenticated_execute
     OR NOT create_service_execute THEN
    RAISE EXCEPTION
      'RBAC Create execution privilege postflight failed';
  END IF;

  -- -------------------------------------------------------
  -- Backfill RPC ACL.
  -- -------------------------------------------------------

  SELECT
    pg_catalog.has_function_privilege(
      'PUBLIC',
      backfill_oid,
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'anon',
      backfill_oid,
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'authenticated',
      backfill_oid,
      'EXECUTE'
    ),
    pg_catalog.has_function_privilege(
      'service_role',
      backfill_oid,
      'EXECUTE'
    )
  INTO
    backfill_public_execute,
    backfill_anon_execute,
    backfill_authenticated_execute,
    backfill_service_execute;

  IF backfill_public_execute
     OR backfill_anon_execute
     OR backfill_authenticated_execute
     OR NOT backfill_service_execute THEN
    RAISE EXCEPTION
      'RBAC backfill execution privilege postflight failed';
  END IF;
END;
$$;

-- =========================================================
-- INSTALLATION-ONLY INVARIANT
-- =========================================================
--
-- This migration installs primitives only.
--
-- It intentionally does NOT invoke:
--
--   backfill_canonical_organization_rbac(...)
--
-- It intentionally does NOT invoke:
--
--   bootstrap_initial_organization_admin(...)
--
-- Production RBAC backfill and initial administrator
-- bootstrap remain separate controlled checkpoints.
