-- F1.12: install missing atomic organization creation; resolver is reentrant.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- P2.3a.5 — Organization RBAC Provisioning
--
-- Canonical Organization RBAC database boundary.
--
-- Installs:
--   1. canonical permission-code resolver;
--   2. atomic Organization + four-role Create primitive.
-- Existing-organization backfill is not installed or executed here.
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
  mapping jsonb;
  expected_mapping_count integer := 130;
  actual_mapping_count integer;
  unresolved_count integer;
  canonical_role_count integer;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('role_name',v.role_name,'permission_code',v.permission_code))
  INTO mapping FROM (
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
    ('consulta', 'settings.profile.view')
  ) AS v(role_name,permission_code);

  SELECT count(*)
  INTO actual_mapping_count
  FROM pg_catalog.jsonb_array_elements(mapping);

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
  FROM pg_catalog.jsonb_to_recordset(mapping) AS m(role_name text,permission_code text)
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
    FROM pg_catalog.jsonb_to_recordset(mapping) AS m(role_name text,permission_code text)
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
  FROM pg_catalog.jsonb_to_recordset(mapping) AS m(role_name text,permission_code text)
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



NOTIFY pgrst, 'reload schema';
COMMIT;
