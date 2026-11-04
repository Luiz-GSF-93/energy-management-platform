-- Keep the database finalizer aligned with the approved VCA119/470 parser.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE definition text; old_text text; new_text text;
BEGIN
 SELECT pg_get_functiondef('public.ccee_finish_dri_reading_before_diagnostic(uuid,uuid,jsonb,text)'::regprocedure) INTO definition;
 IF strpos(definition,'VCA119470_SCOPE')=0 THEN
  old_text:=$old$j.request_payload->>'reportId'='119' AND j.request_payload->>'frameId'='469' AND upper(value)='CNPJ AGENTE'$old$;
  new_text:=$new$/* VCA119470_SCOPE */ j.request_payload->>'reportId'='119' AND j.request_payload->>'frameId' IN('469','470') AND upper(value)='CNPJ AGENTE'$new$;
  IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'VCA fiscal persistence guard changed'; END IF;
  EXECUTE replace(definition,old_text,new_text);
 END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
