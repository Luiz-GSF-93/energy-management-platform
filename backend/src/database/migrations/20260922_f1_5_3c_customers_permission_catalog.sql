-- F1.5.3c — Customers authorization permission catalog
-- Introduces dedicated Customers CRUD permissions.
-- Initial grants preserve the effective legacy Contracts authorization matrix.
-- roles.permissions JSONB remains the effective grant authority.
-- role_permissions is intentionally untouched.

BEGIN;

INSERT INTO public.permissions
(code, name, description, module, resource, action)
VALUES
(
  'organization.customers.view',
  'organization.customers.view',
  'Visualizar clientes',
  'organization',
  'customers',
  'view'
),
(
  'organization.customers.create',
  'organization.customers.create',
  'Criar cliente',
  'organization',
  'customers',
  'create'
),
(
  'organization.customers.update',
  'organization.customers.update',
  'Atualizar cliente',
  'organization',
  'customers',
  'update'
),
(
  'organization.customers.delete',
  'organization.customers.delete',
  'Deletar cliente',
  'organization',
  'customers',
  'delete'
)
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  permission_count integer;
  role_count integer;
BEGIN
  SELECT count(*)
  INTO permission_count
  FROM public.permissions
  WHERE code IN (
    'organization.customers.view',
    'organization.customers.create',
    'organization.customers.update',
    'organization.customers.delete'
  );

  IF permission_count <> 4 THEN
    RAISE EXCEPTION
      'F1.5.3c guard failed: expected 4 permission records, found %',
      permission_count;
  END IF;

  SELECT count(*)
  INTO role_count
  FROM public.roles
  WHERE name IN (
    'admin_platform',
    'admin_org',
    'gestor',
    'operacional',
    'consulta'
  );

  IF role_count <> 5 THEN
    RAISE EXCEPTION
      'F1.5.3c guard failed: expected 5 target roles, found %',
      role_count;
  END IF;
END
$$;

WITH grants(role_name, permission_code) AS (
  VALUES
    ('admin_platform', 'organization.customers.view'),
    ('admin_org',      'organization.customers.view'),
    ('gestor',         'organization.customers.view'),
    ('operacional',    'organization.customers.view'),
    ('consulta',       'organization.customers.view'),

    ('admin_platform', 'organization.customers.create'),
    ('admin_org',      'organization.customers.create'),
    ('gestor',         'organization.customers.create'),

    ('admin_platform', 'organization.customers.update'),
    ('admin_org',      'organization.customers.update'),
    ('gestor',         'organization.customers.update'),
    ('operacional',    'organization.customers.update'),

    ('admin_platform', 'organization.customers.delete'),
    ('admin_org',      'organization.customers.delete'),
    ('gestor',         'organization.customers.delete')
),
resolved AS (
  SELECT
    r.id AS role_id,
    p.id AS permission_id
  FROM grants g
  JOIN public.roles r
    ON r.name = g.role_name
  JOIN public.permissions p
    ON p.code = g.permission_code
),
grouped AS (
  SELECT
    role_id,
    jsonb_agg(permission_id ORDER BY permission_id) AS permission_ids
  FROM resolved
  GROUP BY role_id
)
UPDATE public.roles r
SET
  permissions =
    COALESCE(r.permissions, '[]'::jsonb)
    ||
    COALESCE(
      (
        SELECT jsonb_agg(new_permission.value)
        FROM jsonb_array_elements(grouped.permission_ids)
          AS new_permission(value)
        WHERE NOT COALESCE(r.permissions, '[]'::jsonb)
          @> jsonb_build_array(new_permission.value)
      ),
      '[]'::jsonb
    ),
  updated_at = NOW()
FROM grouped
WHERE r.id = grouped.role_id
AND EXISTS (
  SELECT 1
  FROM jsonb_array_elements(grouped.permission_ids)
    AS candidate(value)
  WHERE NOT COALESCE(r.permissions, '[]'::jsonb)
    @> jsonb_build_array(candidate.value)
);

COMMIT;
