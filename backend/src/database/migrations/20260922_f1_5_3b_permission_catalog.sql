-- F1.5.3b — authorization permission catalog
-- Adds missing Documents UPDATE and Consumer Units CRUD permissions.
-- roles.permissions JSONB remains the effective grant authority.
-- role_permissions is intentionally untouched.

BEGIN;

-- ------------------------------------------------------------
-- Permission catalog
-- ------------------------------------------------------------

INSERT INTO public.permissions
  (code, name, description, module, resource, action)
VALUES
  (
    'documents.documents.update',
    'documents.documents.update',
    'Atualizar documento',
    'documents',
    'documents',
    'update'
  ),
  (
    'organization.consumer_units.view',
    'organization.consumer_units.view',
    'Visualizar unidades consumidoras',
    'organization',
    'consumer_units',
    'view'
  ),
  (
    'organization.consumer_units.create',
    'organization.consumer_units.create',
    'Criar unidade consumidora',
    'organization',
    'consumer_units',
    'create'
  ),
  (
    'organization.consumer_units.update',
    'organization.consumer_units.update',
    'Atualizar unidade consumidora',
    'organization',
    'consumer_units',
    'update'
  ),
  (
    'organization.consumer_units.delete',
    'organization.consumer_units.delete',
    'Deletar unidade consumidora',
    'organization',
    'consumer_units',
    'delete'
  )
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------
-- Structural guards
-- ------------------------------------------------------------

DO $$
DECLARE
  permission_count integer;
  role_count integer;
BEGIN
  SELECT count(*)
  INTO permission_count
  FROM public.permissions
  WHERE code IN (
    'documents.documents.update',
    'organization.consumer_units.view',
    'organization.consumer_units.create',
    'organization.consumer_units.update',
    'organization.consumer_units.delete'
  );

  IF permission_count <> 5 THEN
    RAISE EXCEPTION
      'F1.5.3b guard failed: expected 5 permission records, found %',
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
      'F1.5.3b guard failed: expected 5 target roles, found %',
      role_count;
  END IF;
END
$$;

-- ------------------------------------------------------------
-- Grants
-- Append only. Existing role permissions are preserved.
-- ------------------------------------------------------------

WITH grants(role_name, permission_code) AS (
  VALUES
    ('admin_platform', 'documents.documents.update'),
    ('admin_org',      'documents.documents.update'),
    ('gestor',         'documents.documents.update'),

    ('admin_platform', 'organization.consumer_units.view'),
    ('admin_org',      'organization.consumer_units.view'),
    ('gestor',         'organization.consumer_units.view'),
    ('operacional',    'organization.consumer_units.view'),
    ('consulta',       'organization.consumer_units.view'),

    ('admin_platform', 'organization.consumer_units.create'),
    ('admin_org',      'organization.consumer_units.create'),
    ('gestor',         'organization.consumer_units.create'),
    ('operacional',    'organization.consumer_units.create'),

    ('admin_platform', 'organization.consumer_units.update'),
    ('admin_org',      'organization.consumer_units.update'),
    ('gestor',         'organization.consumer_units.update'),
    ('operacional',    'organization.consumer_units.update'),

    ('admin_platform', 'organization.consumer_units.delete'),
    ('admin_org',      'organization.consumer_units.delete'),
    ('gestor',         'organization.consumer_units.delete')
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
