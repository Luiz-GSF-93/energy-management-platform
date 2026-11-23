BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Financial preparation reads OCR only for documents in its competence.
-- Original documents, other months and immutable OCR results remain untouched.
-- Keep document metadata, historical costs, contracts and demand reviews intact.
DO $patch$
DECLARE ns text;definition text;needle text;replacement text;
BEGIN
 FOREACH ns IN ARRAY ARRAY['public','portal_scope'] LOOP
  IF to_regprocedure(ns||'.capture_financial_sources(text,text,text)') IS NULL THEN CONTINUE;END IF;
  definition:=pg_get_functiondef(to_regprocedure(ns||'.capture_financial_sources(text,text,text)'));
  IF strpos(definition,'financial OCR competence scope v1')>0 THEN CONTINUE;END IF;
  needle:='name text; rows jsonb;';replacement:='ocr_docs text[]; name text; rows jsonb;';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Financial capture declaration baseline changed';END IF;
  definition:=replace(definition,needle,replacement);
  needle:=' FOREACH name IN ARRAY names LOOP';
  replacement:=$sql$ -- financial OCR competence scope v1
 SELECT array_agg(id ORDER BY id) INTO ocr_docs FROM public.documents
 WHERE organization_id=p_org AND customer_id=p_customer AND consumer_unit_id=ANY(ids)
 AND reference_month>=to_date(p_month||'-01','YYYY-MM-DD')
 AND reference_month<(to_date(p_month||'-01','YYYY-MM-DD')+interval '1 month');
 FOREACH name IN ARRAY names LOOP$sql$;
  IF ns='portal_scope' THEN replacement:=replace(replacement,'FROM public.documents','FROM portal_scope.documents');END IF;
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Financial capture loop baseline changed';END IF;
  definition:=replace(definition,needle,replacement);
  -- Only OCR result rows are narrowed. Demand reviews retain their full history.
  needle:='INTO rows USING p_org,docs;';
  replacement:='INTO rows USING p_org,CASE WHEN name=''document_ocr_results'' THEN ocr_docs ELSE docs END;';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Financial OCR scope baseline changed';END IF;
  definition:=replace(definition,needle,replacement);
  EXECUTE definition;
 END LOOP;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN
  UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid)
  WHERE original_oid='public.capture_financial_sources(text,text,text)'::regprocedure;
 END IF;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
