-- Read-only verification. Every check must return passed = true.
WITH checks AS (
  SELECT 'browser_business_' || r || '_' || t AS check_name,
    NOT has_any_column_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,REFERENCES')
    AND NOT has_table_privilege(r, 'public.' || t, 'DELETE,TRUNCATE,TRIGGER') AS passed
  FROM unnest(ARRAY['anon','authenticated']) r
  CROSS JOIN unnest(ARRAY['customers','consumer_units','energy_contracts','documents','invoices']) t
  UNION ALL
  SELECT 'profile_organization_locked',
    NOT has_column_privilege('authenticated','public.user_profiles','organization_id','UPDATE')
  UNION ALL
  SELECT 'profile_role_locked',
    NOT has_column_privilege('authenticated','public.user_profiles','role_id','UPDATE')
  UNION ALL
  SELECT 'profile_presentation_allowed',
    has_column_privilege('authenticated','public.user_profiles','name','UPDATE')
  UNION ALL
  SELECT 'role_permissions_locked',
    NOT has_column_privilege('authenticated','public.roles','permissions','UPDATE')
  UNION ALL
  SELECT 'view_not_browser_accessible',
    NOT has_any_column_privilege('anon','public.v_expiring_contracts','SELECT')
    AND NOT has_any_column_privilege('authenticated','public.v_expiring_contracts','SELECT')
  UNION ALL
  SELECT 'view_security_invoker', COALESCE('security_invoker=true'=ANY(reloptions),false)
    FROM pg_class WHERE oid='public.v_expiring_contracts'::regclass
  UNION ALL
  SELECT 'rpc_not_browser_callable', count(*)>0 AND bool_and(
    NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='insert_calculation_validation'
)
SELECT * FROM checks ORDER BY check_name;
