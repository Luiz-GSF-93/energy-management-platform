-- Domain conflicts must not trigger PostgREST serialization retries.
-- Genuine database serialization failures retain their PostgreSQL SQLSTATE.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE f record;definition text;updated text;tracked boolean;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname='public' AND l.lanname='plpgsql' AND p.proname~'^(eva_manual_preparation_(actor|action|action_context|worker|event)|eva_coordinated_intake_begin|eva_coordinated_flow_begin|eva_intake_retry_read|eva_intake_administration)$'
 LOOP
  definition:=pg_get_functiondef(f.oid);
  updated:=regexp_replace(definition,$pattern$ERRCODE[[:space:]]*=[[:space:]]*'40001'$pattern$,$replacement$ERRCODE='PT409'$replacement$,'gi');
  IF updated IS NOT DISTINCT FROM definition THEN CONTINUE;END IF;
  tracked:=false;
  IF to_regclass('portal_scope.routines') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM portal_scope.routines WHERE original_oid=$1)' INTO tracked USING f.oid;
  END IF;
  IF tracked THEN RAISE EXCEPTION 'Scoped routine requires a separate reviewed migration: %',f.proname USING ERRCODE='55000';END IF;
  IF position($a$SQLSTATE 'PT409'$a$ IN updated)=0 THEN updated:=replace(updated,$a$SQLSTATE '40001'$a$,$a$SQLSTATE '40001' OR SQLSTATE 'PT409'$a$);END IF;
  EXECUTE updated;
 END LOOP;
END $migration$;
DO $scope_guard$
DECLARE tracked boolean:=false;
BEGIN
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM portal_scope.routines WHERE original_oid=$1)' INTO tracked USING 'public.eva_intake_administration(text,text,text,boolean,text,uuid,jsonb)'::regprocedure::oid;
 END IF;
 IF tracked THEN RAISE EXCEPTION 'Scoped administration metadata requires separate review' USING ERRCODE='55000';END IF;
END $scope_guard$;
-- Reconciliation only records the intake transition and audit. It never waits
-- indefinitely for another preparation or performs OCR or a financial write.
ALTER FUNCTION public.eva_intake_administration(text,text,text,boolean,text,uuid,jsonb) SET statement_timeout='8s';
ALTER FUNCTION public.eva_intake_administration(text,text,text,boolean,text,uuid,jsonb) SET lock_timeout='2s';
NOTIFY pgrst,'reload schema';
COMMIT;
