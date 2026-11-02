-- Presentation-only compatibility with the existing user_profiles.name field.
-- No historical event, permission, scope, license or financial rule changes.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE body text; previous_lookup text:=$old$coalesce(nullif(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name'),''),to_jsonb(p)->>'full_name',to_jsonb(p)->>'display_name')$old$; next_lookup text:=$new$coalesce(nullif(btrim(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name')),''),nullif(btrim(to_jsonb(p)->>'full_name'),''),nullif(btrim(to_jsonb(p)->>'display_name'),''),nullif(btrim(to_jsonb(p)->>'name'),''))$new$;
BEGIN
 body:=pg_get_functiondef('public.energy_audit_read(text,uuid,boolean,jsonb)'::regprocedure);
 IF strpos(body,previous_lookup)=0 THEN RAISE EXCEPTION 'Audit author lookup changed; inspect before applying';END IF;
 EXECUTE replace(body,previous_lookup,next_lookup);
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
