BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Keep the exact source rows/JSON/order. Apply relational predicates before
-- converting large OCR results, so unrelated private documents are never
-- expanded merely to test their organization and document identifiers.
CREATE INDEX IF NOT EXISTS document_ocr_results_scope_document ON public.document_ocr_results(organization_id,document_id);
DO $$DECLARE ns text;definition text;needle text;replacement text;table_ns text;BEGIN
 FOREACH ns IN ARRAY ARRAY['public','portal_scope'] LOOP
  IF to_regprocedure(ns||'.capture_financial_sources(text,text,text)') IS NULL THEN CONTINUE;END IF;
  definition:=pg_get_functiondef(to_regprocedure(ns||'.capture_financial_sources(text,text,text)'));
  FOREACH table_ns IN ARRAY ARRAY['public','portal_scope'] LOOP
   needle:='FROM (SELECT to_jsonb(t) j FROM '||table_ns||'.%I t) q WHERE j->>''''organization_id''''=$1 AND j->>''''document_id''''=ANY($2)';
   replacement:='FROM (SELECT to_jsonb(t) j FROM '||table_ns||'.%I t WHERE t.organization_id=$1 AND t.document_id=ANY($2)) q';
   IF position(needle IN definition)>0 OR position(replacement IN definition)>0 THEN EXIT;END IF;
  END LOOP;
  IF position(replacement IN definition)>0 THEN CONTINUE;END IF;
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Review financial OCR capture baseline for %',ns;END IF;
  EXECUTE replace(definition,needle,replacement);
 END LOOP;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN
  UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid)
  WHERE original_oid='public.capture_financial_sources(text,text,text)'::regprocedure;
 END IF;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
