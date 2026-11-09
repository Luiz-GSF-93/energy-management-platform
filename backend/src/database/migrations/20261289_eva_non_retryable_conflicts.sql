-- Business conflicts are HTTP 409, not engine serialization failures.
-- PostgREST 14 can retry an application-raised 40001 indefinitely.
-- https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE f record;d text;n text;changed integer:=0;
BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE ns.nspname IN('public','portal_scope') AND l.lanname='plpgsql' AND p.proname~'^(eva_intake_|transition_eva_automatic_intake$)' LOOP
  d:=pg_get_functiondef(f.oid);
  n:=regexp_replace(d,$pattern$ERRCODE[[:space:]]*=[[:space:]]*'40001'$pattern$,$replacement$ERRCODE='PT409'$replacement$,'gi');
  -- Preserve handlers for real engine failures as well as domain conflicts.
  IF position($a$SQLSTATE 'PT409'$a$ IN n)=0 THEN n:=replace(n,$a$SQLSTATE '40001'$a$,$a$SQLSTATE '40001' OR SQLSTATE 'PT409'$a$);END IF;
  IF n IS DISTINCT FROM d THEN EXECUTE n;changed:=changed+1;END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='eva_intake_action' AND position('Original request changed' IN pg_get_functiondef(p.oid))>0 AND position($a$ERRCODE='PT409'$a$ IN pg_get_functiondef(p.oid))>0) THEN RAISE EXCEPTION 'Review intake conflict before rollout';END IF;
 RAISE NOTICE 'EVA non-retryable conflict definitions updated: %',changed;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
