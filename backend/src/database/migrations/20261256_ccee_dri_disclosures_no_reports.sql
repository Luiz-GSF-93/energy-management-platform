-- CCEE ticket 00460253. Additive selection/diagnostic metadata; no permission grants.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE definition text;old_text text;new_text text;
BEGIN
 SELECT pg_get_functiondef('public.ccee_dri_action(text,text,text,uuid,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,'Select one exact disclosure')=0 THEN
 old_text:=$old0$'parentJobId','eventCode','reportId','frameId']$old0$;new_text:=$new0$'parentJobId','eventCode','reportId','frameId','eventKey']$new0$;
 IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>2 THEN RAISE EXCEPTION 'DRI selection guard 0 changed; review migration';END IF;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old1$result jsonb;f jsonb;$old1$;new_text:=$new1$result jsonb;f jsonb;disclosure jsonb;disclosure_count integer;$new1$;
 IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'DRI selection guard 1 changed; review migration';END IF;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old2$  ELSE
   IF parent.kind<>'DRI_REPORTS'$old2$;new_text:=$new2$   SELECT count(*),min(x::text)::jsonb INTO disclosure_count,disclosure FROM jsonb_array_elements(parent.result->'data'->'rows') x WHERE x->>'code'=p_body->>'eventCode' AND (NOT(p_body?'eventKey') OR x->>'eventKey'=p_body->>'eventKey');
   IF disclosure_count<>1 THEN RAISE EXCEPTION 'Select one exact disclosure' USING ERRCODE='22023';END IF;
   IF disclosure?'eventKey' THEN p_body:=p_body||jsonb_build_object('eventKey',disclosure->>'eventKey');ELSIF p_body?'eventKey' THEN RAISE EXCEPTION 'Unknown disclosure identity' USING ERRCODE='22023';END IF;
  ELSE
   IF parent.kind<>'DRI_REPORTS'$new2$;
 IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'DRI selection guard 2 changed; review migration';END IF;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old3$   SELECT frame INTO f$old3$;new_text:=$new3$   IF parent.request_payload?'eventKey' THEN
    IF p_body?'eventKey' AND p_body->>'eventKey' IS DISTINCT FROM parent.request_payload->>'eventKey' THEN RAISE EXCEPTION 'Disclosure selection mismatch' USING ERRCODE='22023';END IF;
    p_body:=p_body||jsonb_build_object('eventKey',parent.request_payload->>'eventKey');
   ELSIF p_body?'eventKey' THEN RAISE EXCEPTION 'Unknown disclosure identity' USING ERRCODE='22023';END IF;
   SELECT frame INTO f$new3$;
 IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'DRI selection guard 3 changed; review migration';END IF;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old4$ req:=(p_body->>'requestId')::uuid;$old4$;new_text:=$new4$ IF p_body?'eventKey' AND NOT coalesce(jsonb_typeof(p_body->'eventKey')='string' AND p_body->>'eventKey'~'^[a-f0-9]{64}$',false) THEN RAISE EXCEPTION 'Invalid disclosure identity' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;$new4$;
 IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'DRI selection guard 4 changed; review migration';END IF;
 definition:=replace(definition,old_text,new_text);
 EXECUTE definition;
 END IF;
 SELECT pg_get_functiondef('public.ccee_finish_dri_reading(uuid,uuid,jsonb,text)'::regprocedure) INTO definition;
 IF strpos(definition,'Disclosure result mismatch')=0 THEN
 old_text:=$old$ d:=p_result->'diagnostic';$old$;
 new_text:=$new$ IF p_error IS NULL THEN
  SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=p_id FOR UPDATE;
  IF p_result#>>'{data,eventKey}' IS DISTINCT FROM j.request_payload->>'eventKey' THEN RAISE EXCEPTION 'Disclosure result mismatch' USING ERRCODE='42501';END IF;
  IF p_result#>>'{data,availability}'='NO_REPORTS' AND (j.kind<>'DRI_REPORTS' OR p_result#>>'{data,providerFaultCode}' IS DISTINCT FROM 'Server.3001' OR p_result#>>'{data,providerHttpStatus}' IS DISTINCT FROM '500' OR jsonb_array_length(p_result#>'{data,rows}')<>0) THEN RAISE EXCEPTION 'Invalid no-report evidence' USING ERRCODE='22023';END IF;
 END IF;
 d:=p_result->'diagnostic';$new$;
 IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'DRI completion guard changed';END IF;
 EXECUTE replace(definition,old_text,new_text);
 END IF;
 SELECT pg_get_functiondef('public.ccee_dri_diagnostic_read(text,text,uuid,boolean)'::regprocedure) INTO definition;
 IF strpos(definition,'''availability''')=0 THEN
 old_text:=$old$'request_payload',j.request_payload-ARRAY['requestId','authorizationId','parentJobId'])$old$;
 new_text:=$new$'request_payload',j.request_payload-ARRAY['requestId','authorizationId','parentJobId'],'availability',j.result#>'{data,availability}','providerHttpStatus',j.result#>'{data,providerHttpStatus}','providerFaultCode',j.result#>'{data,providerFaultCode}')$new$;
 IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'DRI diagnostic projection changed';END IF;
 EXECUTE replace(definition,old_text,new_text);
 END IF;
END$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
