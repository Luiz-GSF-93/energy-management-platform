-- Bounded header names only. No participant-proof or financial validation changes.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE definition text;old_text text;new_text text;
BEGIN
 SELECT pg_get_functiondef('public.ccee_finish_dri_reading(uuid,uuid,jsonb,text)'::regprocedure) INTO definition;
 definition:=replace(definition,E'\r\n',E'\n');
 IF strpos(definition,'Invalid bounded DRI header diagnostic')=0 THEN
 old_text:=$old$ IF d IS NOT NULL THEN
  IF p_error IS DISTINCT FROM 'DRI_EVENT_IDENTITY_CONFLICT'$old$;
 new_text:=$new$ IF d IS NOT NULL THEN
  IF d->>'stage'='RESULT_HEADERS' THEN
   SELECT * INTO STRICT j FROM public.ccee_integration_jobs WHERE id=p_id;
   IF p_error IS DISTINCT FROM 'DRI_PARTICIPANT_PROOF_REQUIRED' OR j.kind<>'DRI_RESULTS' OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR octet_length(d::text)>5000 OR d-ARRAY['version','stage','eventCode','reportId','frameId','sourceHashes','headers','truncated']<>'{}'::jsonb OR d->>'version' IS DISTINCT FROM '1' OR d->>'eventCode' IS DISTINCT FROM j.request_payload->>'eventCode' OR d->>'reportId' IS DISTINCT FROM j.request_payload->>'reportId' OR d->>'frameId' IS DISTINCT FROM j.request_payload->>'frameId' OR jsonb_typeof(d->'sourceHashes') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'sourceHashes')<>1 OR NOT coalesce(d#>>'{sourceHashes,0}'~'^[a-f0-9]{64}$',false) OR NOT coalesce((p_result->'hashes') @> (d->'sourceHashes'),false) OR jsonb_typeof(d->'headers') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'headers') NOT BETWEEN 1 AND 24 OR jsonb_typeof(d->'truncated') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid bounded DRI header diagnostic' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(d->'headers') h WHERE jsonb_typeof(h)<>'string') THEN RAISE EXCEPTION 'Invalid header type' USING ERRCODE='22023';END IF;
   FOR v IN SELECT jsonb_array_elements_text(d->'headers') LOOP
    IF length(v) NOT BETWEEN 1 AND 160 OR v!~'^[A-Z0-9 _().,/%:+&#;$=-]+$' OR v~*'(password|senha|secret|token|pfx|private|credential|username|usuario|authorization|https?:|www\.)' OR v~'[0-9]{7,}' THEN RAISE EXCEPTION 'Unsafe DRI header' USING ERRCODE='22023';END IF;
   END LOOP;
  ELSE
  IF p_error IS DISTINCT FROM 'DRI_EVENT_IDENTITY_CONFLICT'$new$;
 IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'DRI diagnostic guard changed';END IF;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$ END IF;
 -- Strip additive metadata$old$;
 new_text:=$new$  END IF;
 END IF;
 -- Strip additive metadata$new$;
 IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'DRI diagnostic completion changed';END IF;
 EXECUTE replace(definition,old_text,new_text);
 END IF;
END$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
