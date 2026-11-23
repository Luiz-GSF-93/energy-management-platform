BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- An accepted continuation without a closing is queued work, not an archived
-- result. Use upload time so idle polling cannot hide newly uploaded results.
DO $patch$
DECLARE fn record;definition text;needle text;replacement text;
BEGIN
 FOR fn IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','portal_scope') AND p.proname='eva_intake_action' LOOP
  definition:=pg_get_functiondef(fn.oid);
  IF strpos(definition,'closing_id IS NOT NULL OR state<>''AWAITING_SOURCES''')>0 THEN CONTINUE;END IF;
  needle:='AND document_id IS NOT NULL AND state IN(''AWAITING_SOURCES'',''SOURCE_READY'',''PROPOSAL_READY'',''PUBLISHED'') ORDER BY updated_at DESC LIMIT 5)recent)';
  replacement:='AND document_id IS NOT NULL AND (closing_id IS NOT NULL OR state<>''AWAITING_SOURCES'') AND state IN(''AWAITING_SOURCES'',''SOURCE_READY'',''PROPOSAL_READY'',''PUBLISHED'') ORDER BY created_at DESC,id DESC LIMIT 25)recent)';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Review completed intake catalog baseline';END IF;
  definition:=replace(definition,needle,replacement);
  needle:='OR state NOT IN (''AWAITING_SOURCES'',''PROPOSAL_READY'',''SOURCE_READY'',''PUBLISHED''))';
  replacement:='OR state NOT IN (''AWAITING_SOURCES'',''PROPOSAL_READY'',''SOURCE_READY'',''PUBLISHED'') OR (state=''AWAITING_SOURCES'' AND closing_id IS NULL))';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Review pending intake catalog baseline';END IF;
  EXECUTE replace(definition,needle,replacement);
 END LOOP;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN
  UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid)
  WHERE original_oid IN(SELECT oid FROM pg_proc WHERE proname='eva_intake_action');
 END IF;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
