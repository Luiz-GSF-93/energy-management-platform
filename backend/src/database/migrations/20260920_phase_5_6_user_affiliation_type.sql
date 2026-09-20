-- Phase 5.6 — Consultant / External User
--
-- Professional affiliation is identity metadata.
-- It MUST NOT be used as an organization-access authority.
--
-- Authorization remains:
-- identity -> organization_members -> organization role
-- -> permissions -> active organization context.
--
-- Existing users are backfilled as "internal" strictly for backward
-- compatibility. This is a compatibility migration decision and does not
-- assert that every existing user is factually an internal employee.
--
-- This migration does not change memberships, roles, permissions,
-- organization context, JWT claims, or RLS policies.

BEGIN;

ALTER TABLE public.user_profiles
ADD COLUMN affiliation_type text;

UPDATE public.user_profiles
SET affiliation_type = 'internal'
WHERE affiliation_type IS NULL;

ALTER TABLE public.user_profiles
ALTER COLUMN affiliation_type SET DEFAULT 'internal';

ALTER TABLE public.user_profiles
ALTER COLUMN affiliation_type SET NOT NULL;

ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_affiliation_type_check
CHECK (affiliation_type IN ('internal', 'external'))
NOT VALID;

ALTER TABLE public.user_profiles
VALIDATE CONSTRAINT user_profiles_affiliation_type_check;

COMMIT;
