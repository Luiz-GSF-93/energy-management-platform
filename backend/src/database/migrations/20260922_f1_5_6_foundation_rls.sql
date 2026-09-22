-- F1.5.6 — Foundation RLS / ADR-009 compatibility hardening
-- REVIEW ONLY until explicitly approved for execution.

BEGIN;

-- Preflight: fail closed if the reviewed RLS snapshot has drifted.

DO $$
DECLARE
  target_rls_enabled_count integer;
  target_policy_count integer;
  expected_policy_count integer;
  semantic_policy_count integer;
  licenses_policy_count integer;
BEGIN
  SELECT count(*)
  INTO target_rls_enabled_count
  FROM pg_class c
  JOIN pg_namespace n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'organizations',
      'organization_members',
      'audit_logs',
      'licenses'
    )
    AND c.relkind = 'r'
    AND c.relrowsecurity = true;

  IF target_rls_enabled_count <> 4 THEN
    RAISE EXCEPTION
      'F1.5.6 preflight failed: expected RLS enabled on 4 target tables, found %',
      target_rls_enabled_count;
  END IF;

  SELECT count(*)
  INTO target_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'organizations',
      'organization_members',
      'audit_logs',
      'licenses'
    );

  IF target_policy_count <> 5 THEN
    RAISE EXCEPTION
      'F1.5.6 preflight failed: expected exactly 5 target policies, found %',
      target_policy_count;
  END IF;

  SELECT count(*)
  INTO expected_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'audit_logs'
        AND policyname = 'Users can view audit logs of their org')
      OR
      (tablename = 'organization_members'
        AND policyname = 'organization_members_insert')
      OR
      (tablename = 'organization_members'
        AND policyname = 'organization_members_select')
      OR
      (tablename = 'organizations'
        AND policyname = 'Only org admins can update')
      OR
      (tablename = 'organizations'
        AND policyname = 'Users can view their organization')
    );

  IF expected_policy_count <> 5 THEN
    RAISE EXCEPTION
      'F1.5.6 preflight failed: reviewed legacy policy set is incomplete; found % of 5',
      expected_policy_count;
  END IF;

  -- Freeze security-relevant semantics of the reviewed legacy snapshot.
  -- Expression text for legacy membership subqueries is intentionally not
  -- compared byte-for-byte; command and USING/WITH CHECK shape are enforced.
  SELECT count(*)
  INTO semantic_policy_count
  FROM pg_policy p
  JOIN pg_class c
    ON c.oid = p.polrelid
  JOIN pg_namespace n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND p.polpermissive = true
    AND (
      (
        c.relname = 'audit_logs'
        AND p.polname = 'Users can view audit logs of their org'
        AND p.polcmd = 'r'
        AND p.polqual IS NOT NULL
        AND p.polwithcheck IS NULL
      )
      OR
      (
        c.relname = 'organization_members'
        AND p.polname = 'organization_members_insert'
        AND p.polcmd = 'a'
        AND p.polqual IS NULL
        AND p.polwithcheck IS NOT NULL
      )
      OR
      (
        c.relname = 'organization_members'
        AND p.polname = 'organization_members_select'
        AND p.polcmd = 'r'
        AND p.polqual IS NOT NULL
        AND p.polwithcheck IS NULL
      )
      OR
      (
        c.relname = 'organizations'
        AND p.polname = 'Only org admins can update'
        AND p.polcmd = 'w'
        AND pg_get_expr(p.polqual, p.polrelid) = 'true'
        AND pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
      )
      OR
      (
        c.relname = 'organizations'
        AND p.polname = 'Users can view their organization'
        AND p.polcmd = 'r'
        AND pg_get_expr(p.polqual, p.polrelid) = 'true'
        AND p.polwithcheck IS NULL
      )
    );

  IF semantic_policy_count <> 5 THEN
    RAISE EXCEPTION
      'F1.5.6 preflight failed: legacy policy semantics drifted; matched % of 5',
      semantic_policy_count;
  END IF;

  SELECT count(*)
  INTO licenses_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'licenses';

  IF licenses_policy_count <> 0 THEN
    RAISE EXCEPTION
      'F1.5.6 preflight failed: expected licenses to have zero policies, found %',
      licenses_policy_count;
  END IF;
END
$$;


CREATE OR REPLACE FUNCTION public.is_active_org_member(
  target_organization_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND target_organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS om
      WHERE om.user_id = auth.uid()
        AND om.organization_id = target_organization_id
        AND lower(om.status::text) = 'active'
    );
$$;

REVOKE ALL
ON FUNCTION public.is_active_org_member(text)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.is_active_org_member(text)
FROM anon;

GRANT EXECUTE
ON FUNCTION public.is_active_org_member(text)
TO authenticated;

DROP POLICY IF EXISTS
  "Users can view audit logs of their org"
ON public.audit_logs;

DROP POLICY IF EXISTS
  "organization_members_insert"
ON public.organization_members;

DROP POLICY IF EXISTS
  "organization_members_select"
ON public.organization_members;

DROP POLICY IF EXISTS
  "Only org admins can update"
ON public.organizations;

DROP POLICY IF EXISTS
  "Users can view their organization"
ON public.organizations;

CREATE POLICY "foundation_audit_logs_select"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
  public.is_active_org_member(organization_id)
);

CREATE POLICY "foundation_organization_members_select"
ON public.organization_members
FOR SELECT
TO authenticated
USING (
  public.is_active_org_member(organization_id)
);

CREATE POLICY "foundation_organizations_select"
ON public.organizations
FOR SELECT
TO authenticated
USING (
  public.is_active_org_member(id)
);

CREATE POLICY "foundation_licenses_select"
ON public.licenses
FOR SELECT
TO authenticated
USING (
  public.is_active_org_member(organization_id)
);


-- Postflight: abort the transaction unless the hardened state is exact.

DO $$
DECLARE
  target_rls_enabled_count integer;
  hardened_policy_count integer;
  target_policy_count integer;
  hardened_select_count integer;
  target_write_policy_count integer;
  legacy_policy_count integer;
  helper_security_definer boolean;
  helper_config text[];
  helper_public_execute boolean;
  helper_anon_execute boolean;
  helper_authenticated_execute boolean;
BEGIN
  SELECT count(*)
  INTO target_rls_enabled_count
  FROM pg_class c
  JOIN pg_namespace n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'organizations',
      'organization_members',
      'audit_logs',
      'licenses'
    )
    AND c.relkind = 'r'
    AND c.relrowsecurity = true;

  IF target_rls_enabled_count <> 4 THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: expected RLS enabled on 4 target tables, found %',
      target_rls_enabled_count;
  END IF;

  SELECT count(*)
  INTO hardened_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'audit_logs'
        AND policyname = 'foundation_audit_logs_select')
      OR
      (tablename = 'organization_members'
        AND policyname = 'foundation_organization_members_select')
      OR
      (tablename = 'organizations'
        AND policyname = 'foundation_organizations_select')
      OR
      (tablename = 'licenses'
        AND policyname = 'foundation_licenses_select')
    );

  IF hardened_policy_count <> 4 THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: expected 4 hardened policies, found %',
      hardened_policy_count;
  END IF;

  SELECT count(*)
  INTO target_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'organizations',
      'organization_members',
      'audit_logs',
      'licenses'
    );

  IF target_policy_count <> 4 THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: expected exactly 4 total target policies, found %',
      target_policy_count;
  END IF;

  SELECT count(*)
  INTO hardened_select_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'organizations',
      'organization_members',
      'audit_logs',
      'licenses'
    )
    AND policyname LIKE 'foundation\_%\_select' ESCAPE '\'
    AND cmd = 'SELECT'
    AND roles = ARRAY['authenticated']::name[];

  IF hardened_select_count <> 4 THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: expected 4 authenticated SELECT policies, found %',
      hardened_select_count;
  END IF;

  SELECT count(*)
  INTO target_write_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'organizations',
      'organization_members',
      'audit_logs',
      'licenses'
    )
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  IF target_write_policy_count <> 0 THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: expected zero target write policies, found %',
      target_write_policy_count;
  END IF;

  SELECT count(*)
  INTO legacy_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'audit_logs'
        AND policyname = 'Users can view audit logs of their org')
      OR
      (tablename = 'organization_members'
        AND policyname IN (
          'organization_members_insert',
          'organization_members_select'
        ))
      OR
      (tablename = 'organizations'
        AND policyname IN (
          'Only org admins can update',
          'Users can view their organization'
        ))
    );

  IF legacy_policy_count <> 0 THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: expected zero legacy target policies, found %',
      legacy_policy_count;
  END IF;

  SELECT
    p.prosecdef,
    p.proconfig,
    EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(
          p.proacl,
          acldefault('f', p.proowner)
        )
      ) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ),
    has_function_privilege(
      'anon',
      'public.is_active_org_member(text)',
      'EXECUTE'
    ),
    has_function_privilege(
      'authenticated',
      'public.is_active_org_member(text)',
      'EXECUTE'
    )
  INTO
    helper_security_definer,
    helper_config,
    helper_public_execute,
    helper_anon_execute,
    helper_authenticated_execute
  FROM pg_proc p
  JOIN pg_namespace n
    ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'is_active_org_member'
    AND pg_get_function_identity_arguments(p.oid) =
      'target_organization_id text';

  IF helper_security_definer IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: helper is not SECURITY DEFINER';
  END IF;

  IF helper_config IS NULL
     OR NOT (helper_config @> ARRAY['search_path=pg_catalog']::text[]) THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: helper search_path is not fixed to pg_catalog';
  END IF;

  IF helper_public_execute THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: PUBLIC can execute membership helper';
  END IF;

  IF helper_anon_execute THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: anon can execute membership helper';
  END IF;

  IF helper_authenticated_execute IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'F1.5.6 postflight failed: authenticated cannot execute membership helper';
  END IF;
END
$$;

COMMIT;
