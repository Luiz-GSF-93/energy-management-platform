-- Asaas legitimately emits IDs such as pay_0_abc123. Preserve all financial data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$
DECLARE f record;constraint_row record;definition text;
BEGIN
 IF to_regprocedure('public.platform_sales_asaas_action(uuid,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'Asaas foundation required'; END IF;
 -- Reuse the installed definitions, including subsequent authorization/recovery fixes.
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('platform_sales_asaas_action','platform_sales_creation_action') LOOP
  definition:=pg_get_functiondef(f.oid);
  IF strpos(definition,'^pay_[a-zA-Z0-9]{1,100}$')>0 THEN
   EXECUTE replace(definition,'^pay_[a-zA-Z0-9]{1,100}$','^pay_[a-zA-Z0-9_]{1,100}$');
  END IF;
 END LOOP;
 FOR constraint_row IN SELECT t.relname,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('platform_sales_asaas_bindings','platform_sales_creation_events','platform_sales_cycle_bindings') AND c.contype='c' AND c.conname IN ('platform_sales_asaas_bindings_payment_id_check','platform_sales_creation_events_payment_id_check','platform_sales_cycle_bindings_payment_id_check') AND strpos(pg_get_constraintdef(c.oid),'^pay_[a-zA-Z0-9]{1,100}$')>0 LOOP
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',constraint_row.relname,constraint_row.conname);
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',constraint_row.relname,constraint_row.conname,replace(constraint_row.definition,'^pay_[a-zA-Z0-9]{1,100}$','^pay_[a-zA-Z0-9_]{1,100}$'));
 END LOOP;
END $$;
COMMIT;

