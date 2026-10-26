BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE d text; old text; replacement text;
BEGIN
 d:=pg_get_functiondef('public.transition_eva_automatic_intake(uuid,uuid,text,jsonb)'::regprocedure);
 old:='clock_timestamp(),i.actor_id,true,''PENDING''';
 replacement:='clock_timestamp(),i.actor_id::uuid,true,''PENDING''';
 IF position(replacement IN d)=0 THEN
  IF position(old IN d)=0 THEN RAISE EXCEPTION 'Review intake author insertion before migration'; END IF;
  d:=replace(d,old,replacement);
 END IF;
 old:='''note'',p_body->>''note'')';replacement:='''note'',p_body->>''note'',''diagnostic'',p_body->''diagnostic'')';
 IF position(replacement IN d)=0 THEN
  IF position(old IN d)=0 THEN RAISE EXCEPTION 'Review intake event projection'; END IF;
  d:=replace(d,old,replacement);
 END IF;
 EXECUTE d;
 d:=pg_get_functiondef('public.eva_intake_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 old:='''createdAt'',created_at)x FROM public.eva_automatic_intakes';
 replacement:=$projection$'createdAt',created_at,'status',jsonb_build_object(
 'percent',CASE WHEN state IN('SOURCE_READY','PROPOSAL_READY','PUBLISHED') THEN 100 WHEN state='PREPARING' THEN 85 WHEN state='AWAITING_SOURCES' THEN 80 WHEN document_id IS NOT NULL THEN 70 WHEN proof->>'state'='MATCH' THEN 60 WHEN raw_result IS NOT NULL THEN 45 WHEN state='OCR_POLLING' THEN 25 WHEN state IN('OCR_QUEUED','OCR_SUBMITTING') THEN 20 WHEN stored THEN 15 ELSE 5 END,
 'received',stored,'read',raw_result IS NOT NULL OR coalesce(proof->>'state'='MATCH',false),'identified',coalesce(proof->>'state'='MATCH',false),'archived',document_id IS NOT NULL,
 'prepared',state IN('SOURCE_READY','PROPOSAL_READY','PUBLISHED'),'updatedAt',updated_at,
 'reviewedAt',(SELECT max(e.created_at) FROM public.eva_automatic_intake_events e WHERE e.intake_id=eva_automatic_intakes.id AND e.event='SOURCE_REVIEW'),
 'selection',hints,'canRetry',state='REVIEW_REQUIRED' AND EXISTS(SELECT 1 FROM public.eva_automatic_intake_events e WHERE e.intake_id=eva_automatic_intakes.id AND e.event='SOURCE_REVIEW'),
 'diagnostic',CASE WHEN a->>'external'='true' THEN NULL ELSE (SELECT e.body->'diagnostic' FROM public.eva_automatic_intake_events e WHERE e.intake_id=eva_automatic_intakes.id AND e.event IN('review','unknown') ORDER BY e.sequence DESC LIMIT 1) END))x FROM public.eva_automatic_intakes$projection$;
 IF position(replacement IN d)=0 THEN
  IF position(old IN d)=0 THEN RAISE EXCEPTION 'Review intake status projection'; END IF;
  d:=replace(d,old,replacement);
 END IF;
 old:=' ELSIF p_action=''resolve'' AND a->>''external''=''false'' THEN';
 replacement:=$retry$ ELSIF p_action='retry' AND a->>'external'='false' THEN
  SELECT * INTO i FROM public.eva_automatic_intakes WHERE id=p_id AND organization_id=p_org AND state='REVIEW_REQUIRED' AND stored AND consent FOR UPDATE;
  IF NOT FOUND OR p_body<>'{}' OR NOT EXISTS(SELECT 1 FROM public.eva_automatic_intake_events e WHERE e.intake_id=i.id AND e.event='SOURCE_REVIEW' AND e.body->>'customerId'=i.customer_id AND e.body->>'unitId'=i.hints->>'unitId' AND e.body->>'month'=i.hints->>'month') THEN RAISE EXCEPTION 'Saved source review required' USING ERRCODE='22023'; END IF;
  UPDATE public.eva_automatic_intakes SET state='RECOGNIZING',next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),note='Retomada solicitada com as respostas salvas; leitura existente preservada.' WHERE id=i.id;
  PERFORM public.eva_intake_event(i.id,'SOURCE_REVIEW_RETRY',jsonb_build_object('sourceHash',i.file_hash,'selection',i.hints),p_actor);
  RETURN jsonb_build_object('id',i.id,'state','RECOGNIZING');
 ELSIF p_action='resolve' AND a->>'external'='false' THEN$retry$;
 IF position(replacement IN d)=0 THEN
  IF position(old IN d)=0 THEN RAISE EXCEPTION 'Review source retry branch'; END IF;
  d:=replace(d,old,replacement);
 END IF;
 -- Saved selection timestamps must reflect the actual review, not the preceding failure.
 d:=replace(d,'SET customer_id=p_body->>''customerId'',hints=jsonb_build_object','SET updated_at=clock_timestamp(),customer_id=p_body->>''customerId'',hints=jsonb_build_object');
 old:='RETURN jsonb_build_object(''revision'',(SELECT';
 replacement:=$recent$RETURN jsonb_build_object('completed',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'updatedAt' DESC),'[]') FROM (SELECT jsonb_build_object('id',id,'filename',filename,'state',state,'month',month,'documentId',document_id,'documentType',document_type,'updatedAt',updated_at)x FROM public.eva_automatic_intakes WHERE organization_id=p_org AND (a->>'external'<>'true' OR customer_id=customer) AND (customer IS NULL OR customer_id=customer) AND document_id IS NOT NULL AND state IN('SOURCE_READY','PROPOSAL_READY','PUBLISHED') ORDER BY updated_at DESC LIMIT 5)recent),'revision',(SELECT$recent$;
 IF position(replacement IN d)=0 THEN
  IF position(old IN d)=0 THEN RAISE EXCEPTION 'Review completed receipt projection'; END IF;
  d:=replace(d,old,replacement);
 END IF;
 EXECUTE d;
END$$;
COMMIT;
