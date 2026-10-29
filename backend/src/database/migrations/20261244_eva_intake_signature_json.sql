BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- The unscoped continuation returns a text fingerprint. Encode it as a JSON
-- string instead of asking PostgreSQL to parse the hexadecimal text as JSON.
-- Scoped external calls already use SELECT to_jsonb(...) in portal_scoped_rpc.
DO $$DECLARE definition text;needle text;replacement text;BEGIN
 definition:=pg_get_functiondef('public.portal_intake_scoped_rpc(text,jsonb)'::regprocedure);
 needle:='RETURN public.eva_intake_reference_signature(i.id,i.lease_token);';
 replacement:='RETURN to_jsonb(public.eva_intake_reference_signature(i.id,i.lease_token));';
 IF position(replacement IN definition)>0 THEN RETURN;END IF;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Review intake fingerprint serialization baseline';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
