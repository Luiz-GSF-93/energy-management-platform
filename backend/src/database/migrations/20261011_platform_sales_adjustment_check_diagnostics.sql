BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.platform_sales_adjustment_check_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE req public.platform_sales_adjustment_requests;rev public.platform_sales_adjustment_events;c public.platform_sales_adjustment_checks;
 e public.platform_sales_adjustment_check_events;prior public.platform_sales_adjustment_check_events;entity uuid;request_id uuid;cmd uuid;
 s jsonb;result jsonb;reasons jsonb:='[]';new_state text;name text;page integer;can_write boolean:=false;item jsonb;done_cents bigint:=0;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501';END IF;
 IF p_action='read' THEN
  PERFORM public.read_platform_sales_finance(p_actor,0,'','',NULL,NULL,NULL);
  BEGIN PERFORM public.platform_team_owner(p_actor);can_write:=true;EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_column THEN can_write:=false;END;
 ELSE PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));PERFORM public.platform_team_owner(p_actor);END IF;
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>131072 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023';END IF;
 name:=public.platform_sales_finance_name(p_actor);
 IF p_action='read' THEN
  IF p_body-ARRAY['requestId','page']<>'{}' OR NOT p_body ?& ARRAY['requestId','page'] OR coalesce(p_body->>'page','') !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 THEN RAISE EXCEPTION 'Invalid read' USING ERRCODE='22023';END IF;
  request_id:=(p_body->>'requestId')::uuid;page:=(p_body->>'page')::integer;
  SELECT * INTO req FROM public.platform_sales_adjustment_requests WHERE id=request_id;IF req.id IS NULL THEN RAISE EXCEPTION 'Missing request' USING ERRCODE='P3710';END IF;
  RETURN jsonb_build_object('canWrite',can_write,'total',(SELECT count(*) FROM public.platform_sales_adjustment_checks WHERE request_id=req.id),'checks',
   (SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT c.*,public.platform_sales_finance_name(c.actor_id) current_actor_name,
    (SELECT to_jsonb(e) FROM public.platform_sales_adjustment_check_events e WHERE check_id=c.id ORDER BY version DESC LIMIT 1) latest,
    (SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('current_actor_name',public.platform_sales_finance_name(e.actor_id)) ORDER BY version DESC) FROM public.platform_sales_adjustment_check_events e WHERE check_id=c.id) events
    FROM public.platform_sales_adjustment_checks c WHERE request_id=req.id ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET page*25)x));
 END IF;
 IF p_action NOT IN ('prepare','claim','finish') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 entity:=(p_body->>'id')::uuid;IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-adjustment-check:'||entity::text,0));
 IF p_action='prepare' THEN
  IF p_body-ARRAY['id','requestId','expectedVersion','justification']<>'{}' OR NOT p_body ?& ARRAY['id','requestId','expectedVersion','justification'] OR jsonb_typeof(p_body->'expectedVersion')<>'number' OR coalesce(p_body->>'expectedVersion','') !~ '^[1-9][0-9]{0,5}$' OR jsonb_typeof(p_body->'justification')<>'string' OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 500 THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  request_id:=(p_body->>'requestId')::uuid;
  SELECT * INTO c FROM public.platform_sales_adjustment_checks WHERE id=entity;
  IF FOUND THEN
   IF c.request_id IS DISTINCT FROM request_id OR c.request_version IS DISTINCT FROM (p_body->>'expectedVersion')::integer OR c.actor_id IS DISTINCT FROM p_actor OR c.justification IS DISTINCT FROM p_body->>'justification' THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='P3711';END IF;
   RETURN jsonb_build_object('id',entity,'replayed',true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-adjustment-request:'||request_id::text,0));
  SELECT * INTO req FROM public.platform_sales_adjustment_requests WHERE id=request_id;
  SELECT * INTO rev FROM public.platform_sales_adjustment_events WHERE request_id=req.id ORDER BY version DESC LIMIT 1;
  IF req.id IS NULL THEN RAISE EXCEPTION 'Missing request' USING ERRCODE='P3710';END IF;
  IF rev.version IS DISTINCT FROM (p_body->>'expectedVersion')::integer OR rev.state IN ('REJECTED','WITHDRAWN') THEN RAISE EXCEPTION 'Stale or closed request' USING ERRCODE='P3711';END IF;
  IF EXISTS(SELECT 1 FROM public.platform_sales_adjustment_checks a JOIN LATERAL(SELECT state,created_at FROM public.platform_sales_adjustment_check_events WHERE check_id=a.id ORDER BY version DESC LIMIT 1)x ON true WHERE a.request_id=req.id AND x.state IN ('PREPARED','CHECKING') AND x.created_at>clock_timestamp()-interval '2 minutes') THEN RAISE EXCEPTION 'Check already prepared' USING ERRCODE='P3711';END IF;
  s:=public.platform_sales_adjustment_source(p_actor,req.origin_kind,req.source_id)||jsonb_build_object('kind',req.kind);
  INSERT INTO public.platform_sales_adjustment_checks(id,request_id,request_version,source,parameters,actor_id,actor_name,justification) VALUES(entity,req.id,rev.version,s,rev.parameters,p_actor,name,p_body->>'justification');
  INSERT INTO public.platform_sales_adjustment_check_events(check_id,version,command_id,phase,state,actor_id,actor_name) VALUES(entity,1,entity,'PREPARE','PREPARED',p_actor,name);
  RETURN jsonb_build_object('id',entity,'replayed',false);
 END IF;
 IF p_body-(CASE WHEN p_action='finish' THEN ARRAY['id','commandId','evidence','diagnostic'] ELSE ARRAY['id','commandId'] END)<>'{}' OR NOT p_body ?& ARRAY['id','commandId'] THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 IF p_body ? 'diagnostic' AND (p_action<>'finish' OR p_body->'evidence'<>'null'::jsonb OR NOT p_body ? 'evidence' OR jsonb_typeof(p_body->'diagnostic')<>'string' OR coalesce(p_body->>'diagnostic','') NOT IN ('QUERY_FAILED','QUERY_CONFIG_INVALID','QUERY_TIMEOUT','QUERY_NETWORK_ERROR','QUERY_HTTP_ERROR','QUERY_RESPONSE_LIMIT','QUERY_SCHEMA_INVALID','QUERY_BINDING_MISMATCH','EXECUTED_EVIDENCE_MISSING')) THEN RAISE EXCEPTION 'Invalid diagnostic' USING ERRCODE='22023';END IF;
 cmd:=(p_body->>'commandId')::uuid;IF cmd IS NULL THEN RAISE EXCEPTION 'Command required' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.platform_sales_adjustment_checks WHERE id=entity;IF c.id IS NULL THEN RAISE EXCEPTION 'Missing check' USING ERRCODE='P3710';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-adjustment-request:'||c.request_id::text,0));
 SELECT * INTO req FROM public.platform_sales_adjustment_requests WHERE id=c.request_id;
 SELECT * INTO rev FROM public.platform_sales_adjustment_events WHERE request_id=req.id ORDER BY version DESC LIMIT 1;
 SELECT * INTO e FROM public.platform_sales_adjustment_check_events WHERE check_id=entity ORDER BY version DESC LIMIT 1;
 SELECT * INTO prior FROM public.platform_sales_adjustment_check_events WHERE command_id=cmd AND phase=(CASE p_action WHEN 'claim' THEN 'CLAIM' ELSE 'FINISH' END);
 IF FOUND THEN
  IF prior.check_id IS DISTINCT FROM entity OR prior.actor_id IS DISTINCT FROM p_actor OR p_action='finish' AND prior.evidence IS DISTINCT FROM nullif(p_body->'evidence','null'::jsonb) THEN RAISE EXCEPTION 'Changed command replay' USING ERRCODE='P3711';END IF;
  IF p_action='finish' AND prior.evidence IS NULL AND (SELECT coalesce(jsonb_agg(x),'[]') FROM jsonb_array_elements(prior.blockers)x WHERE x#>>'{}' IN ('QUERY_FAILED','QUERY_CONFIG_INVALID','QUERY_TIMEOUT','QUERY_NETWORK_ERROR','QUERY_HTTP_ERROR','QUERY_RESPONSE_LIMIT','QUERY_SCHEMA_INVALID','QUERY_BINDING_MISMATCH','EXECUTED_EVIDENCE_MISSING')) IS DISTINCT FROM (CASE WHEN p_body ? 'diagnostic' THEN jsonb_build_array(p_body->>'diagnostic') ELSE '[]'::jsonb END) THEN RAISE EXCEPTION 'Changed diagnostic replay' USING ERRCODE='P3711';END IF;
  RETURN jsonb_build_object('id',entity,'replayed',true,'execute',false,'state',prior.state);
 END IF;
 s:=public.platform_sales_adjustment_source(p_actor,req.origin_kind,req.source_id)||jsonb_build_object('kind',req.kind);
 IF s IS DISTINCT FROM c.source OR rev.version<>c.request_version OR rev.state IN ('REJECTED','WITHDRAWN') THEN reasons:=reasons||'"SOURCE_CHANGED"'::jsonb;END IF;
 IF s->>'verified' IS DISTINCT FROM 'true' THEN reasons:=reasons||'"SOURCE_UNVERIFIED"'::jsonb;END IF;
 IF p_action='claim' THEN
  IF e.state<>'PREPARED' THEN RAISE EXCEPTION 'Check already claimed' USING ERRCODE='P3711';END IF;
  new_state:=CASE WHEN reasons='[]' THEN 'CHECKING' ELSE 'BLOCKED' END;
  INSERT INTO public.platform_sales_adjustment_check_events(check_id,version,command_id,phase,state,blockers,actor_id,actor_name) VALUES(entity,2,cmd,'CLAIM',new_state,reasons,p_actor,name);
  RETURN jsonb_build_object('id',entity,'execute',new_state='CHECKING','state',new_state,'source',c.source,'parameters',c.parameters);
 END IF;
 IF NOT p_body ? 'evidence' OR e.state<>'CHECKING' OR e.command_id<>cmd OR e.actor_id<>p_actor THEN RAISE EXCEPTION 'Claim mismatch' USING ERRCODE='P3711';END IF;
 result:=nullif(p_body->'evidence','null'::jsonb);
 IF result IS NULL THEN new_state:='INCOMPLETE';reasons:=reasons||'"QUERY_INCOMPLETE"'::jsonb;IF p_body ? 'diagnostic' THEN reasons:=reasons||jsonb_build_array(p_body->>'diagnostic');END IF;
 ELSE
  IF jsonb_typeof(result)<>'object' OR result-ARRAY['complete','blockers','payment','refunds','subscription','payments','refundedCents','remainingCents']<>'{}' OR NOT result ?& ARRAY['complete','blockers'] OR jsonb_typeof(result->'complete')<>'boolean' OR jsonb_typeof(result->'blockers')<>'array' OR jsonb_array_length(result->'blockers')>20 THEN RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='22023';END IF;
  IF req.kind='REFUND_PAYMENT' AND (result->'payment'->>'id' IS DISTINCT FROM c.source->>'remoteId' OR result->'payment'->>'customer' IS DISTINCT FROM c.source->'binding'->>'customer' OR result->'payment'->>'reference' IS DISTINCT FROM c.source->'binding'->>'reference' OR result->'payment'->'grossCents' IS DISTINCT FROM c.source->'binding'->'grossCents') THEN RAISE EXCEPTION 'Evidence binding mismatch' USING ERRCODE='P3711';END IF;
  IF req.kind='CANCEL_SUBSCRIPTION' AND (result->'subscription'->>'id' IS DISTINCT FROM c.source->>'remoteId' OR result->'subscription'->>'customer' IS DISTINCT FROM c.source->'parameters'->>'customer' OR result->'subscription'->>'reference' IS DISTINCT FROM c.source->'parameters'->>'externalReference') THEN RAISE EXCEPTION 'Subscription mismatch' USING ERRCODE='P3711';END IF;
  reasons:=reasons||(result->'blockers');
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'blockers')x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ '^[A-Z_]{1,60}$') THEN RAISE EXCEPTION 'Invalid blocker' USING ERRCODE='22023';END IF;
  IF result->>'complete'='true' AND req.kind='REFUND_PAYMENT' THEN
   IF jsonb_typeof(result->'refunds') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'refunds')>100 THEN RAISE EXCEPTION 'Incomplete refunds' USING ERRCODE='22023';END IF;
   IF (SELECT count(*) FROM jsonb_array_elements(result->'refunds'))<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(result->'refunds')x) THEN RAISE EXCEPTION 'Duplicate refunds' USING ERRCODE='22023';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(result->'refunds') LOOP
    IF coalesce(item->>'id','') !~ '^[a-zA-Z0-9_-]{1,120}$' OR coalesce(item->>'status','') NOT IN ('DONE','PENDING','CANCELLED') OR jsonb_typeof(item->'valueCents') IS DISTINCT FROM 'number' OR coalesce(item->>'valueCents','') !~ '^[0-9]{1,11}$' THEN RAISE EXCEPTION 'Invalid refund' USING ERRCODE='22023';END IF;
    IF item->>'status'='DONE' THEN done_cents:=done_cents+(item->>'valueCents')::bigint;END IF;
    IF item->>'status'='PENDING' THEN reasons:=reasons||'"REFUND_PENDING"'::jsonb;END IF;
   END LOOP;
   IF result->'refundedCents' IS DISTINCT FROM to_jsonb(done_cents) OR result->'remainingCents' IS DISTINCT FROM to_jsonb(greatest(0,(c.source->'binding'->>'grossCents')::bigint-done_cents)) THEN RAISE EXCEPTION 'Invalid refund totals' USING ERRCODE='22023';END IF;
   IF result->'payment'->>'status' IS DISTINCT FROM 'RECEIVED' OR result->'payment'->>'deleted' IS DISTINCT FROM 'false' THEN reasons:=reasons||'"PAYMENT_NOT_RECEIVED"'::jsonb;END IF;
   IF coalesce(result->'payment'->>'billingType','') NOT IN ('PIX','CREDIT_CARD') THEN reasons:=reasons||'"METHOD_UNSUPPORTED"'::jsonb;END IF;
   IF result->'payment'->>'splitPresent' IS DISTINCT FROM 'false' THEN reasons:=reasons||'"SPLIT_REVIEW_REQUIRED"'::jsonb;END IF;
   IF done_cents+(c.parameters->>'amountCents')::bigint>(c.source->'binding'->>'grossCents')::bigint THEN reasons:=reasons||'"REFUND_EXCEEDS_EVIDENCE"'::jsonb;END IF;
  END IF;
  IF result->>'complete'='true' AND req.kind='CANCEL_SUBSCRIPTION' THEN
   IF jsonb_typeof(result->'payments') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'payments')>100 THEN RAISE EXCEPTION 'Incomplete payments' USING ERRCODE='22023';END IF;
   IF (SELECT count(*) FROM jsonb_array_elements(result->'payments'))<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(result->'payments')x) THEN RAISE EXCEPTION 'Duplicate payments' USING ERRCODE='22023';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(result->'payments') LOOP
    IF coalesce(item->>'id','') !~ '^pay_[a-zA-Z0-9_-]{1,120}$' OR item->>'subscription' IS DISTINCT FROM c.source->>'remoteId' OR item->>'customer' IS DISTINCT FROM c.source->'parameters'->>'customer' OR jsonb_typeof(item->'deleted') IS DISTINCT FROM 'boolean' OR item->'affectedByRemoval' IS DISTINCT FROM to_jsonb(item->>'deleted'='false' AND item->>'status' IN ('PENDING','OVERDUE')) THEN RAISE EXCEPTION 'Affected payment mismatch' USING ERRCODE='P3711';END IF;
   END LOOP;
   IF result->'subscription'->>'status' IS DISTINCT FROM 'ACTIVE' OR result->'subscription'->>'deleted' IS DISTINCT FROM 'false' THEN reasons:=reasons||'"SUBSCRIPTION_NOT_ACTIVE"'::jsonb;END IF;
  END IF;
  IF req.kind='CANCEL_SUBSCRIPTION' THEN
   reasons:=reasons||public.platform_sales_adjustment_blockers(req.kind,s,c.parameters,(req.created_at AT TIME ZONE 'America/Sao_Paulo')::date);
   IF (c.parameters->>'requestedDate')::date>(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN reasons:=reasons||'"REQUESTED_DATE_NOT_REACHED"'::jsonb;END IF;
  END IF;
  new_state:=CASE WHEN result->>'complete'<>'true' THEN 'INCOMPLETE' WHEN reasons<>'[]' THEN 'BLOCKED' ELSE 'COMPATIBLE' END;
 END IF;
 INSERT INTO public.platform_sales_adjustment_check_events(check_id,version,command_id,phase,state,evidence,blockers,actor_id,actor_name) VALUES(entity,3,cmd,'FINISH',new_state,result,reasons,p_actor,name);
 RETURN jsonb_build_object('id',entity,'state',new_state,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_adjustment_check_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_adjustment_check_action(uuid,text,jsonb) TO service_role;
COMMIT;
