-- CCEE's official catalog example has inicio without fim. Preserve that as
-- explicit JSON null; missing/invalid starts and expired versions remain denied.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$
DECLARE definition text; old_clause text := $old$(r->'period'->>'end')::date>=(target+interval '1 month'-interval '1 day')::date$old$;
new_clause text := $new$((r->'period'->'end')='null'::jsonb OR (r->'period'->>'end')::date>=(target+interval '1 month'-interval '1 day')::date)$new$;
BEGIN
 SELECT pg_get_functiondef('public.ccee_dri_action(text,text,text,uuid,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,new_clause)>0 THEN RETURN; END IF;
 IF (length(definition)-length(replace(definition,old_clause,'')))/length(old_clause)<>1 THEN
  RAISE EXCEPTION 'DRI catalog period guard changed; review before migration';
 END IF;
 EXECUTE replace(definition,old_clause,new_clause);
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
