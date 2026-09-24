-- Preserve metadata already accepted by the consumer-unit API.
-- Installed capacity and contracted demand are intentionally separate quantities.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.consumer_units
  ADD COLUMN IF NOT EXISTS name varchar(255),
  ADD COLUMN IF NOT EXISTS address varchar(1000),
  ADD COLUMN IF NOT EXISTS city varchar(255),
  ADD COLUMN IF NOT EXISTS state varchar(50),
  ADD COLUMN IF NOT EXISTS installed_capacity double precision;
-- Refuse incompatible pre-existing columns rather than silently accepting drift.
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='consumer_units'
      AND ((column_name='name' AND data_type='character varying' AND character_maximum_length=255)
        OR (column_name='address' AND data_type='character varying' AND character_maximum_length=1000)
        OR (column_name='city' AND data_type='character varying' AND character_maximum_length=255)
        OR (column_name='state' AND data_type='character varying' AND character_maximum_length=50)
        OR (column_name='installed_capacity' AND data_type='double precision'))
      AND is_nullable='YES') <> 5 THEN
    RAISE EXCEPTION 'Unexpected consumer unit metadata schema';
  END IF;
END $$;
COMMIT;
