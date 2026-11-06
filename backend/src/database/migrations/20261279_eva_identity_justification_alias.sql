BEGIN;
-- Distinguish the table alias from the PL/pgSQL intake record in the private query.
DO $patch$
DECLARE definition text; original text; corrected text; start_at integer;
BEGIN
 definition:=pg_get_functiondef('public.eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 start_at:=strpos(definition,'ELSIF p_action=''justifications'' THEN');
 IF start_at=0 THEN RAISE EXCEPTION 'Expected justification branch unavailable';END IF;
 original:=substr(definition,start_at);
 IF strpos(original,'JOIN public.eva_automatic_intakes i ON')=0 THEN RAISE EXCEPTION 'Expected scoped query unavailable';END IF;
 corrected:=replace(original,'JOIN public.eva_automatic_intakes i ON','JOIN public.eva_automatic_intakes source_intake ON');
 corrected:=regexp_replace(corrected,'\mi\.','source_intake.','g');
 EXECUTE substr(definition,1,start_at-1)||corrected;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
