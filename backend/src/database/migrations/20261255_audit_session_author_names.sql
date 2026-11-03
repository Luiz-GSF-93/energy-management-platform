-- Presentation only: preserve session identifiers, history and the authorized query scope.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE body text;
 old_projection constant text:=$old$jsonb_agg(to_jsonb(x)-'session_id'-'scope_key')$old$;
 new_projection constant text:=$new$jsonb_agg((to_jsonb(x)-'session_id'-'scope_key')||jsonb_build_object('actor_name_current',(SELECT coalesce(nullif(btrim(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name')),''),nullif(btrim(to_jsonb(p)->>'full_name'),''),nullif(btrim(to_jsonb(p)->>'display_name'),''),nullif(btrim(to_jsonb(p)->>'name'),'')) FROM public.user_profiles p WHERE p.user_id::text=x.actor_id LIMIT 1)))$new$;
BEGIN
 body:=pg_get_functiondef('public.energy_audit_read(text,uuid,boolean,jsonb)'::regprocedure);
 IF (length(body)-length(replace(body,old_projection,'')))/length(old_projection)<>1 THEN RAISE EXCEPTION 'Audit session projection changed; inspect compatibility';END IF;
 EXECUTE replace(body,old_projection,new_projection);
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
