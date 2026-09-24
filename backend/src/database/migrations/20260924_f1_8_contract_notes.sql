-- Add observations without modifying existing contracts or access grants.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.energy_contracts ADD COLUMN IF NOT EXISTS notes text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='energy_contracts'
      AND column_name='notes' AND data_type='text' AND is_nullable='YES') THEN
    RAISE EXCEPTION 'Unexpected contract notes schema';
  END IF;
END $$;
COMMIT;
