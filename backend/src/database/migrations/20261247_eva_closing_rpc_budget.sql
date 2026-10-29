BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- PostgREST hoists this function setting before executing the RPC. Keep the
-- default role/database budget unchanged; only these bounded closing calls
-- need time for the same complete source verification and transaction.
DO $$DECLARE fn record; names text[]:=ARRAY['eva_assisted_closing_action','eva_contract_closing_action','eva_documented_closing_action'];BEGIN
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(names))<>3 THEN RAISE EXCEPTION 'Review closing RPC baseline';END IF;
 FOR fn IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','portal_scope') AND p.proname=ANY(names) LOOP
  EXECUTE format('ALTER FUNCTION %s SET statement_timeout TO %L',fn.oid::regprocedure,'30s');
 END LOOP;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN
  UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid)
  WHERE original_oid IN(SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(names));
 END IF;
END$$;
NOTIFY pgrst,'reload schema';
NOTIFY pgrst,'reload config';
COMMIT;
