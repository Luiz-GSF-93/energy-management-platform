-- Explicitly reviewed EVA/calculation routines only. No ACL or tenant gate changes.
-- Application-raised conflicts are not PostgreSQL engine serialization failures.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE f record;definition text;updated text;tracked boolean;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND l.lanname='plpgsql' AND p.proname=ANY(ARRAY[
  'calculation_autofill_action','calculation_autofill_reconcile','calculation_autofill_reconcile_running',
  'eva_assisted_closing_action','eva_closing_change_action','eva_closing_publication_action',
  'eva_document_review_queue','eva_flow_action','eva_flow_reconcile_interrupted','eva_flow_worker',
  'eva_intake_identity_action','eva_intake_restore','eva_invoice_attention','eva_tariff_workbench_action'])
 LOOP
  definition:=pg_get_functiondef(f.oid);
  updated:=regexp_replace(definition,$pattern$ERRCODE[[:space:]]*=[[:space:]]*'40001'$pattern$,$replacement$ERRCODE='PT409'$replacement$,'gi');
  IF updated IS DISTINCT FROM definition AND definition ~* $pattern$SQLSTATE[[:space:]]+'40001'|serialization_failure$pattern$ THEN RAISE EXCEPTION 'Serialization handler requires separate review: %',f.proname USING ERRCODE='55000';END IF;
  IF updated IS NOT DISTINCT FROM definition THEN CONTINUE;END IF;
  tracked:=false;
  IF to_regclass('portal_scope.routines') IS NOT NULL THEN EXECUTE 'SELECT EXISTS(SELECT 1 FROM portal_scope.routines WHERE original_oid=$1)' INTO tracked USING f.oid;END IF;
  IF tracked THEN RAISE EXCEPTION 'Private scoped routine requires separate review: %',f.proname USING ERRCODE='55000';END IF;
  EXECUTE updated;
 END LOOP;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
