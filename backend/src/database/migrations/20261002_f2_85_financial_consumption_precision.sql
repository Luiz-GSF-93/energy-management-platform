-- Preserve twelve-decimal validated consumption for future financial versions.
-- Previously published values and source snapshots are retained unchanged.
BEGIN;
ALTER TABLE public.monthly_energy_settlements
 ALTER COLUMN consumption_kwh TYPE numeric(30,12);
COMMIT;
