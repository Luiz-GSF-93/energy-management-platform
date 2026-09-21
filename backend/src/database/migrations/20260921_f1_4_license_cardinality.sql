-- F1.4h — Concurrency-safe effective-license cardinality
-- Additive integrity migration.
-- Explicitly installs btree_gist for text equality under GiST.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.licenses
  ADD CONSTRAINT licenses_active_start_date_check
  CHECK (
    NOT (
      (lower(status::text) = 'active') IS TRUE
      AND active IS TRUE
    )
    OR start_date IS NOT NULL
  );

ALTER TABLE public.licenses
  ADD CONSTRAINT licenses_active_validity_excl
  EXCLUDE USING gist (
    organization_id WITH =,
    daterange(
      start_date,
      COALESCE(end_date, 'infinity'::date),
      '[]'
    ) WITH &&
  )
  WHERE (
    (lower(status::text) = 'active') IS TRUE
    AND active IS TRUE
  );

COMMIT;
