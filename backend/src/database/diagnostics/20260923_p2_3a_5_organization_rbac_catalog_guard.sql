-- P2.3a.5 — Organization RBAC Catalog Guard
--
-- Read-only catalog compatibility diagnostic.
-- This file performs no persistent database mutation.
--
-- It validates prerequisites for Organization RBAC provisioning
-- before the provisioning migration is deployed.

BEGIN;

-- =========================================================
-- RELATION AND COLUMN COMPATIBILITY
-- =========================================================

DO $guard$
DECLARE
  missing_relation text;
  missing_column text;
BEGIN
  SELECT string_agg(required.relation_name, ', ')
  INTO missing_relation
  FROM (
    VALUES
      ('organizations'),
      ('roles'),
      ('organization_members'),
      ('permissions')
  ) AS required(relation_name)
  WHERE to_regclass(
    'public.' || required.relation_name
  ) IS NULL;

  IF missing_relation IS NOT NULL THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: required relations missing: %',
      missing_relation;
  END IF;

  SELECT string_agg(
    required.table_name || '.' || required.column_name,
    ', '
    ORDER BY required.table_name, required.column_name
  )
  INTO missing_column
  FROM (
    VALUES
      ('organizations', 'id'),
      ('organizations', 'name'),
      ('organizations', 'description'),
      ('organizations', 'created_at'),
      ('organizations', 'updated_at'),
      ('organizations', 'deleted_at'),
      ('roles', 'id'),
      ('roles', 'organization_id'),
      ('roles', 'name'),
      ('roles', 'permissions'),
      ('roles', 'created_at'),
      ('roles', 'updated_at'),
      ('roles', 'scope'),
      ('organization_members', 'organization_id'),
      ('permissions', 'id'),
      ('permissions', 'code')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required.table_name
      AND c.column_name = required.column_name
  );

  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: required columns missing: %',
      missing_column;
  END IF;

  RAISE NOTICE
    'P2.3a.5 catalog: required relations and columns present';
END
$guard$;


-- =========================================================
-- ROLE COLUMN CONTRACT
-- =========================================================

DO $guard$
DECLARE
  bad_column_count integer;
BEGIN
  SELECT count(*)
  INTO bad_column_count
  FROM (
    VALUES
      ('id', 'text'),
      ('organization_id', 'text'),
      ('permissions', 'jsonb')
  ) AS expected(column_name, data_type)
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'roles'
   AND c.column_name = expected.column_name
  WHERE c.data_type <> expected.data_type;

  IF bad_column_count <> 0 THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: incompatible verified roles column type';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'roles'
      AND (
        (
          c.column_name IN ('name', 'scope')
          AND c.data_type NOT IN (
            'text',
            'character varying'
          )
        )
        OR (
          c.column_name IN ('created_at', 'updated_at')
          AND c.data_type NOT IN (
            'timestamp without time zone',
            'timestamp with time zone'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: incompatible roles operational column type';
  END IF;

  RAISE NOTICE
    'P2.3a.5 catalog: roles column contract compatible';
END
$guard$;

-- =========================================================
-- ROLE -> ORGANIZATION FOREIGN KEY + CASCADE
-- =========================================================

DO $guard$
DECLARE
  role_org_attnum smallint;
  organization_id_attnum smallint;
  compatible_fk_count integer;
  conflicting_fk_count integer;
BEGIN
  SELECT a.attnum
  INTO role_org_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.roles'::regclass
    AND a.attname = 'organization_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT a.attnum
  INTO organization_id_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.organizations'::regclass
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF role_org_attnum IS NULL
     OR organization_id_attnum IS NULL THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: FK attributes unavailable';
  END IF;

  SELECT count(*)
  INTO compatible_fk_count
  FROM pg_constraint c
  WHERE c.conrelid = 'public.roles'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'public.organizations'::regclass
    AND c.conkey =
      ARRAY[role_org_attnum]::smallint[]
    AND c.confkey =
      ARRAY[organization_id_attnum]::smallint[]
    AND c.confdeltype = 'c';

  IF compatible_fk_count <> 1 THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: expected exactly one roles organization FK with ON DELETE CASCADE';
  END IF;

  SELECT count(*)
  INTO conflicting_fk_count
  FROM pg_constraint c
  WHERE c.conrelid = 'public.roles'::regclass
    AND c.contype = 'f'
    AND role_org_attnum = ANY(c.conkey)
    AND NOT (
      c.confrelid = 'public.organizations'::regclass
      AND c.conkey =
        ARRAY[role_org_attnum]::smallint[]
      AND c.confkey =
        ARRAY[organization_id_attnum]::smallint[]
      AND c.confdeltype = 'c'
    );

  IF conflicting_fk_count <> 0 THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: conflicting roles organization FK detected';
  END IF;

  RAISE NOTICE
    'P2.3a.5 catalog: roles organization FK cascade verified';
END
$guard$;

-- =========================================================
-- CANONICAL ROLE UNIQUENESS
-- =========================================================

DO $guard$
DECLARE
  org_attnum smallint;
  name_attnum smallint;
  unique_constraint_count integer;
  unique_index_count integer;
BEGIN
  SELECT a.attnum
  INTO org_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.roles'::regclass
    AND a.attname = 'organization_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT a.attnum
  INTO name_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.roles'::regclass
    AND a.attname = 'name'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT count(*)
  INTO unique_constraint_count
  FROM pg_constraint c
  WHERE c.conrelid = 'public.roles'::regclass
    AND c.contype = 'u'
    AND c.conkey =
      ARRAY[org_attnum, name_attnum]::smallint[];

  SELECT count(*)
  INTO unique_index_count
  FROM pg_index i
  WHERE i.indrelid = 'public.roles'::regclass
    AND i.indisunique
    AND i.indisvalid
    AND i.indisready
    AND i.indpred IS NULL
    AND i.indexprs IS NULL
    AND i.indnkeyatts = 2
    AND i.indkey[0] = org_attnum
    AND i.indkey[1] = name_attnum;

  IF unique_constraint_count = 0
     AND unique_index_count = 0 THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: UNIQUE(organization_id, name) is unavailable';
  END IF;

  RAISE NOTICE
    'P2.3a.5 catalog: canonical role uniqueness verified';
END
$guard$;

-- =========================================================
-- REQUIRED POSTGRESQL PRIMITIVES AND PRINCIPALS
-- =========================================================

DO $guard$
DECLARE
  missing_principal text;
BEGIN
  IF to_regprocedure(
    'pg_catalog.hashtextextended(text,bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: hashtextextended(text,bigint) unavailable';
  END IF;

  IF to_regprocedure(
    'pg_catalog.pg_advisory_xact_lock(bigint)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: pg_advisory_xact_lock(bigint) unavailable';
  END IF;

  SELECT string_agg(required.role_name, ', ')
  INTO missing_principal
  FROM (
    VALUES
      ('anon'),
      ('authenticated'),
      ('service_role')
  ) AS required(role_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_roles r
    WHERE r.rolname = required.role_name
  );

  IF missing_principal IS NOT NULL THEN
    RAISE EXCEPTION
      'P2.3a.5 guard: required principals missing: %',
      missing_principal;
  END IF;

  RAISE NOTICE
    'P2.3a.5 catalog: primitives and principals verified';
END
$guard$;

-- Diagnostic transaction must never persist changes.
ROLLBACK;
