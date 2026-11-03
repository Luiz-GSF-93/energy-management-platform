-- CCEE VCA001/119/469: observed exact column CNPJ AGENTE, still bound to authorized tax ID.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE definition text;old_text text;new_text text;
BEGIN
 SELECT pg_get_functiondef('public.ccee_finish_dri_reading_before_diagnostic(uuid,uuid,jsonb,text)'::regprocedure) INTO definition;
 IF strpos(definition,'VCA119469_SCOPE')=0 THEN
  old_text:=$old$WHERE upper(value)='CNPJ DO AGENTE';$old$;
  new_text:=$new$WHERE /* VCA119469_SCOPE */ upper(value)='CNPJ DO AGENTE' OR (j.request_payload->>'reportId'='119' AND j.request_payload->>'frameId'='469' AND upper(value)='CNPJ AGENTE');$new$;
  IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'DRI participant column guard changed';END IF;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$tax_column IS NULL OR regexp_replace($old$;
  new_text:=$new$tax_column IS NULL OR NOT coalesce((r->'cells'->>tax_column)~'^[0-9]{14}$|^[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2}$',false) OR regexp_replace($new$;
  IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'DRI participant value guard changed';END IF;
  EXECUTE replace(definition,old_text,new_text);
 END IF;
END$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
