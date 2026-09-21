-- F1.4 — License Foundation
-- Pre-DDL authoritative catalog guard.
--
-- This migration source classifies the existing public.licenses contract.
-- It MUST fail closed on unknown or incompatible catalog state.
--
-- This checkpoint intentionally performs no license schema mutation.
-- Any additive DDL requires a later reviewed migration.
--
-- Tenant authority remains organization_members + validated TenantContext.
-- License state does not grant RBAC or organization access.

BEGIN;

-- Guard 1: relation identity and compatibility columns.
DO $guard$
DECLARE
  v_kind "char";
  v_missing text;
BEGIN
  SELECT c.relkind
  INTO v_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'licenses';

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'F1.4 guard: public.licenses is missing';
  END IF;

  IF v_kind <> 'r' THEN
    RAISE EXCEPTION 'F1.4 guard: public.licenses has unexpected relation type';
  END IF;

  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'F1.4 guard: public.organizations is missing';
  END IF;

  SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
  INTO v_missing
  FROM (
    VALUES
      ('id'),
      ('organization_id'),
      ('license_type'),
      ('documents_limit'),
      ('documents_used'),
      ('renewal_date'),
      ('active'),
      ('created_at'),
      ('updated_at'),
      ('status'),
      ('max_consumer_units'),
      ('document_management'),
      ('advanced_analytics'),
      ('report_generation'),
      ('free_market_management'),
      ('start_date'),
      ('end_date')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'licenses'
      AND c.column_name = required.column_name
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'F1.4 guard: licenses compatibility columns missing: %',
      v_missing;
  END IF;

  IF (
    SELECT a.atttypid
    FROM pg_attribute a
    WHERE a.attrelid = 'public.licenses'::regclass
      AND a.attname = 'organization_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) IS DISTINCT FROM (
    SELECT a.atttypid
    FROM pg_attribute a
    WHERE a.attrelid = 'public.organizations'::regclass
      AND a.attname = 'id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION
      'F1.4 guard: licenses.organization_id and organizations.id types differ';
  END IF;
END
$guard$;

-- Guard 2: primary key and organization foreign-key classification.
DO $guard$
DECLARE
  v_pk_count integer;
  v_pk_columns text[];
  v_org_fk_count integer;
  v_conflicting_org_fk_count integer;
BEGIN
  SELECT count(*)
  INTO v_pk_count
  FROM pg_constraint c
  WHERE c.conrelid = 'public.licenses'::regclass
    AND c.contype = 'p';

  IF v_pk_count <> 1 THEN
    RAISE EXCEPTION
      'F1.4 guard: public.licenses must have exactly one primary key constraint';
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ordinality)
  INTO v_pk_columns
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey)
    WITH ORDINALITY AS k(attnum, ordinality)
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = k.attnum
  WHERE c.conrelid = 'public.licenses'::regclass
    AND c.contype = 'p';

  IF v_pk_columns IS DISTINCT FROM ARRAY['id']::text[] THEN
    RAISE EXCEPTION
      'F1.4 guard: unexpected public.licenses primary key shape';
  END IF;

  SELECT count(*)
  INTO v_org_fk_count
  FROM pg_constraint c
  WHERE c.conrelid = 'public.licenses'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'public.organizations'::regclass
    AND c.conkey = ARRAY[
      (
        SELECT a.attnum
        FROM pg_attribute a
        WHERE a.attrelid = 'public.licenses'::regclass
          AND a.attname = 'organization_id'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
    ]::smallint[]
    AND c.confkey = ARRAY[
      (
        SELECT a.attnum
        FROM pg_attribute a
        WHERE a.attrelid = 'public.organizations'::regclass
          AND a.attname = 'id'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
    ]::smallint[];

  IF v_org_fk_count > 1 THEN
    RAISE EXCEPTION
      'F1.4 guard: duplicate equivalent organization foreign keys detected';
  END IF;

  SELECT count(*)
  INTO v_conflicting_org_fk_count
  FROM pg_constraint c
  WHERE c.conrelid = 'public.licenses'::regclass
    AND c.contype = 'f'
    AND (
      SELECT a.attnum
      FROM pg_attribute a
      WHERE a.attrelid = 'public.licenses'::regclass
        AND a.attname = 'organization_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) = ANY(c.conkey)
    AND NOT (
      c.confrelid = 'public.organizations'::regclass
      AND c.conkey = ARRAY[
        (
          SELECT a.attnum
          FROM pg_attribute a
          WHERE a.attrelid = 'public.licenses'::regclass
            AND a.attname = 'organization_id'
            AND a.attnum > 0
            AND NOT a.attisdropped
        )
      ]::smallint[]
      AND c.confkey = ARRAY[
        (
          SELECT a.attnum
          FROM pg_attribute a
          WHERE a.attrelid = 'public.organizations'::regclass
            AND a.attname = 'id'
            AND a.attnum > 0
            AND NOT a.attisdropped
        )
      ]::smallint[]
    );

  IF v_conflicting_org_fk_count > 0 THEN
    RAISE EXCEPTION
      'F1.4 guard: conflicting organization_id foreign key detected';
  END IF;

  RAISE NOTICE
    'F1.4 catalog: compatible organization FK count=%',
    v_org_fk_count;
END
$guard$;

-- Guard 3: uniqueness and index classification.
DO $guard$
DECLARE
  v_org_attnum smallint;
  v_global_org_unique_constraints integer;
  v_global_org_unique_indexes integer;
  v_index_count integer;
BEGIN
  SELECT a.attnum
  INTO v_org_attnum
  FROM pg_attribute a
  WHERE a.attrelid = 'public.licenses'::regclass
    AND a.attname = 'organization_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_org_attnum IS NULL THEN
    RAISE EXCEPTION
      'F1.4 guard: licenses.organization_id attribute is unavailable';
  END IF;

  SELECT count(*)
  INTO v_global_org_unique_constraints
  FROM pg_constraint c
  WHERE c.conrelid = 'public.licenses'::regclass
    AND c.contype = 'u'
    AND c.conkey = ARRAY[v_org_attnum]::smallint[];

  IF v_global_org_unique_constraints > 0 THEN
    RAISE EXCEPTION
      'F1.4 guard: global UNIQUE(organization_id) conflicts with license history';
  END IF;

  SELECT count(*)
  INTO v_global_org_unique_indexes
  FROM pg_index i
  WHERE i.indrelid = 'public.licenses'::regclass
    AND i.indisunique
    AND i.indisvalid
    AND i.indisready
    AND i.indpred IS NULL
    AND i.indexprs IS NULL
    AND i.indnkeyatts = 1
    AND i.indkey[0] = v_org_attnum;

  IF v_global_org_unique_indexes > 0 THEN
    RAISE EXCEPTION
      'F1.4 guard: global unique organization_id index conflicts with license history';
  END IF;

  SELECT count(*)
  INTO v_index_count
  FROM pg_index i
  WHERE i.indrelid = 'public.licenses'::regclass;

  RAISE NOTICE
    'F1.4 catalog: licenses index count=%',
    v_index_count;
END
$guard$;

-- Guard 4A: CHECK constraints and lifecycle data classification.
DO $guard$
DECLARE
  v_check_count integer;
  v_null_status_count bigint;
  v_null_active_count bigint;
  v_unknown_status_count bigint;
  v_status_active_mismatch_count bigint;
BEGIN
  SELECT count(*)
  INTO v_check_count
  FROM pg_constraint c
  WHERE c.conrelid = 'public.licenses'::regclass
    AND c.contype = 'c';

  SELECT count(*)
  INTO v_null_status_count
  FROM public.licenses
  WHERE status IS NULL;

  SELECT count(*)
  INTO v_null_active_count
  FROM public.licenses
  WHERE active IS NULL;

  SELECT count(*)
  INTO v_unknown_status_count
  FROM public.licenses
  WHERE status IS NOT NULL
    AND lower(status::text) NOT IN (
      'active',
      'suspended',
      'expired',
      'cancelled'
    );

  SELECT count(*)
  INTO v_status_active_mismatch_count
  FROM public.licenses
  WHERE status IS NOT NULL
    AND active IS NOT NULL
    AND (
      (lower(status::text) = 'active' AND active IS NOT TRUE)
      OR
      (
        lower(status::text) IN ('suspended', 'expired', 'cancelled')
        AND active IS NOT FALSE
      )
    );

  IF v_null_status_count > 0 THEN
    RAISE EXCEPTION
      'F1.4 guard: licenses contains NULL lifecycle status';
  END IF;

  IF v_null_active_count > 0 THEN
    RAISE EXCEPTION
      'F1.4 guard: licenses contains NULL active compatibility state';
  END IF;

  IF v_unknown_status_count > 0 THEN
    RAISE EXCEPTION
      'F1.4 guard: licenses contains unknown lifecycle status values';
  END IF;

  IF v_status_active_mismatch_count > 0 THEN
    RAISE EXCEPTION
      'F1.4 guard: licenses status and active values are inconsistent';
  END IF;

  RAISE NOTICE
    'F1.4 catalog: licenses CHECK constraint count=%',
    v_check_count;
END
$guard$;

-- Guard 4B: temporal integrity and active-period cardinality.
DO $guard$
DECLARE
  v_invalid_date_range_count bigint;
  v_active_overlap_count bigint;
BEGIN
  SELECT count(*)
  INTO v_invalid_date_range_count
  FROM public.licenses
  WHERE start_date IS NOT NULL
    AND end_date IS NOT NULL
    AND end_date < start_date;

  IF v_invalid_date_range_count > 0 THEN
    RAISE EXCEPTION
      'F1.4 guard: licenses contains end_date before start_date';
  END IF;

  SELECT count(*)
  INTO v_active_overlap_count
  FROM public.licenses a
  JOIN public.licenses b
    ON a.organization_id = b.organization_id
   AND a.id < b.id
   AND lower(a.status::text) = 'active'
   AND lower(b.status::text) = 'active'
   AND a.active IS TRUE
   AND b.active IS TRUE
   AND daterange(
         a.start_date,
         COALESCE(a.end_date, 'infinity'::date),
         '[]'
       ) && daterange(
         b.start_date,
         COALESCE(b.end_date, 'infinity'::date),
         '[]'
       );

  IF v_active_overlap_count > 0 THEN
    RAISE EXCEPTION
      'F1.4 guard: overlapping active license periods detected';
  END IF;

  RAISE NOTICE
    'F1.4 catalog: overlapping active license period pairs=%',
    v_active_overlap_count;
END
$guard$;

-- Guard 5: RLS, policies, triggers, defaults and nullability classification.
DO $guard$
DECLARE
  v_rls_enabled boolean;
  v_rls_forced boolean;
  v_policy_count integer;
  v_trigger_count integer;
  v_missing_required_not_null text;
BEGIN
  SELECT c.relrowsecurity, c.relforcerowsecurity
  INTO v_rls_enabled, v_rls_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'licenses'
    AND c.relkind = 'r';

  IF v_rls_enabled IS NULL THEN
    RAISE EXCEPTION
      'F1.4 guard: licenses RLS metadata unavailable';
  END IF;

  SELECT count(*)
  INTO v_policy_count
  FROM pg_policy p
  WHERE p.polrelid = 'public.licenses'::regclass;

  SELECT count(*)
  INTO v_trigger_count
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.licenses'::regclass
    AND NOT t.tgisinternal;

  SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
  INTO v_missing_required_not_null
  FROM (
    VALUES
      ('id'),
      ('organization_id'),
      ('license_type'),
      ('documents_limit'),
      ('renewal_date')
  ) AS required(column_name)
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'licenses'
   AND c.column_name = required.column_name
  WHERE c.is_nullable <> 'NO';

  IF v_missing_required_not_null IS NOT NULL THEN
    RAISE EXCEPTION
      'F1.4 guard: OpenAPI-required columns are nullable: %',
      v_missing_required_not_null;
  END IF;

  RAISE NOTICE
    'F1.4 catalog: RLS enabled=%, forced=%, policies=%, user triggers=%',
    v_rls_enabled,
    v_rls_forced,
    v_policy_count,
    v_trigger_count;
END
$guard$;

-- Guard 5B: authoritative default presence classification.
DO $guard$
DECLARE
  v_missing_defaults text;
  v_default_count integer;
BEGIN
  SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
  INTO v_missing_defaults
  FROM (
    VALUES
      ('id'),
      ('active'),
      ('advanced_analytics'),
      ('created_at'),
      ('document_management'),
      ('documents_used'),
      ('free_market_management'),
      ('max_consumer_units'),
      ('report_generation'),
      ('status'),
      ('updated_at')
  ) AS required(column_name)
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = 'licenses'
   AND c.column_name = required.column_name
  WHERE c.column_default IS NULL;

  IF v_missing_defaults IS NOT NULL THEN
    RAISE EXCEPTION
      'F1.4 guard: expected license defaults are missing: %',
      v_missing_defaults;
  END IF;

  SELECT count(*)
  INTO v_default_count
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'licenses'
    AND c.column_default IS NOT NULL;

  RAISE NOTICE
    'F1.4 catalog: licenses columns with defaults=%',
    v_default_count;
END
$guard$;

-- Diagnostic transaction must never persist changes.
ROLLBACK;
