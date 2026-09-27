-- F1.106: preserve OCR provenance while retaining existing locks, validation and audit triggers.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.calculation_monthly_costs DROP CONSTRAINT calculation_monthly_costs_origin_check;
ALTER TABLE public.calculation_monthly_costs ADD CONSTRAINT calculation_monthly_costs_origin_check CHECK(origin IN ('MANUAL','OCR_CIP'));
NOTIFY pgrst,'reload schema';
COMMIT;
