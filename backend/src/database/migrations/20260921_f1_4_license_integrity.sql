-- F1.4g — License integrity foundation
-- Additive only. No extension installation, grants, or RLS policies.

BEGIN;

ALTER TABLE public.licenses
  ADD CONSTRAINT licenses_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES public.organizations(id);

ALTER TABLE public.licenses
  ADD CONSTRAINT licenses_status_check
  CHECK (
    status IS NULL
    OR lower(status::text) IN (
      'active',
      'suspended',
      'expired',
      'cancelled'
    )
  );

ALTER TABLE public.licenses
  ADD CONSTRAINT licenses_status_active_check
  CHECK (
    status IS NULL
    OR active IS NULL
    OR (
      lower(status::text) = 'active'
      AND active IS TRUE
    )
    OR (
      lower(status::text) IN (
        'suspended',
        'expired',
        'cancelled'
      )
      AND active IS FALSE
    )
  );

ALTER TABLE public.licenses
  ADD CONSTRAINT licenses_validity_dates_check
  CHECK (
    start_date IS NULL
    OR end_date IS NULL
    OR end_date >= start_date
  );

COMMIT;
