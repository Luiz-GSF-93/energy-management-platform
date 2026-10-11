BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.platform_sales_adjustment_commands (
 id uuid PRIMARY KEY, environment text NOT NULL DEFAULT 'SANDBOX' CHECK(environment='SANDBOX'),
 request_id uuid NOT NULL REFERENCES public.platform_sales_adjustment_requests(id),request_version integer NOT NULL,
 check_id uuid NOT NULL REFERENCES public.platform_sales_adjustment_checks(id),kind text NOT NULL CHECK(kind IN ('CANCEL_SUBSCRIPTION','REFUND_PAYMENT')),
 remote_id text NOT NULL,source jsonb NOT NULL,parameters jsonb NOT NULL,evidence jsonb NOT NULL,
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 500),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.platform_sales_adjustment_command_events (
 command_id uuid NOT NULL REFERENCES public.platform_sales_adjustment_commands(id),version integer NOT NULL CHECK(version>0),
 operation_id uuid NOT NULL UNIQUE,phase text NOT NULL CHECK(phase IN ('PREPARE','AUTHORIZE','CLAIM','DISPATCH','FINISH','RECOVER','WITHDRAW')),
 state text NOT NULL CHECK(state IN ('PREPARED','AUTHORIZED','PRECHECK','DISPATCHED','PENDING_VERIFICATION','INDETERMINATE','BLOCKED','CONFIRMED_EXTERNAL','WITHDRAWN')),
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 500),
 evidence jsonb,diagnostic text CHECK(diagnostic IS NULL OR diagnostic IN ('PRECHECK_CHANGED','QUERY_FAILED','QUERY_CONFIG_INVALID','QUERY_TIMEOUT','QUERY_NETWORK_ERROR','QUERY_HTTP_ERROR','QUERY_RESPONSE_LIMIT','QUERY_SCHEMA_INVALID','QUERY_BINDING_MISMATCH','EXECUTED_EVIDENCE_MISSING','RESULT_UNPROVEN')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(command_id,version)
);
CREATE INDEX IF NOT EXISTS platform_sales_adjustment_commands_target ON public.platform_sales_adjustment_commands(remote_id,kind,created_at DESC);
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['platform_sales_adjustment_commands','platform_sales_adjustment_command_events'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
 EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
END LOOP;END$$;
-- Eligibility is re-evaluated under the request/target lock; browser evidence is never trusted.
CREATE OR REPLACE FUNCTION public.platform_sales_adjustment_command_guard(p_actor uuid,p_request uuid,p_version integer,p_check uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.platform_sales_adjustment_requests;v public.platform_sales_adjustment_events;c public.platform_sales_adjustment_checks;e public.platform_sales_adjustment_check_events;s jsonb;
BEGIN
 SELECT * INTO r FROM public.platform_sales_adjustment_requests WHERE id=p_request;
 SELECT * INTO v FROM public.platform_sales_adjustment_events WHERE request_id=p_request ORDER BY version DESC LIMIT 1;
 SELECT * INTO c FROM public.platform_sales_adjustment_checks WHERE id=p_check AND request_id=p_request;
 SELECT * INTO e FROM public.platform_sales_adjustment_check_events WHERE check_id=p_check ORDER BY version DESC LIMIT 1;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Missing request' USING ERRCODE='P3720';END IF;
 IF v.version IS DISTINCT FROM p_version OR v.state IS DISTINCT FROM 'CONFIRMED_INTERNAL' OR v.blockers IS DISTINCT FROM '[]'::jsonb OR c.request_version IS DISTINCT FROM p_version OR e.state IS DISTINCT FROM 'COMPATIBLE' OR e.blockers IS DISTINCT FROM '[]'::jsonb OR e.evidence->>'complete' IS DISTINCT FROM 'true' OR e.evidence->'blockers' IS DISTINCT FROM '[]'::jsonb OR e.created_at<clock_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'Request or check not eligible' USING ERRCODE='P3721';END IF;
 s:=public.platform_sales_adjustment_source(p_actor,r.origin_kind,r.source_id)||jsonb_build_object('kind',r.kind);
 IF s IS DISTINCT FROM c.source OR v.parameters IS DISTINCT FROM c.parameters OR v.source IS DISTINCT FROM s-'kind' THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='P3721';END IF;
 IF r.kind='CANCEL_SUBSCRIPTION' AND (public.platform_sales_adjustment_blockers(r.kind,s,c.parameters,(r.created_at AT TIME ZONE 'America/Sao_Paulo')::date)<>'[]' OR (c.parameters->>'requestedDate')::date>(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date) THEN RAISE EXCEPTION 'Cancellation not due' USING ERRCODE='P3721';END IF;
 RETURN jsonb_build_object('request',to_jsonb(r),'source',s,'parameters',c.parameters,'evidence',e.evidence);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_adjustment_command_guard(uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.platform_sales_adjustment_command_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE c public.platform_sales_adjustment_commands;e public.platform_sales_adjustment_command_events;prior public.platform_sales_adjustment_command_events;
 req public.platform_sales_adjustment_requests;entity uuid;op uuid;g jsonb;payload jsonb;state text;author text;page integer;can_write boolean:=false;proof jsonb;expected integer;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501';END IF;
 IF p_action='read' THEN
  PERFORM public.read_platform_sales_finance(p_actor,0,'','',NULL,NULL,NULL);
  BEGIN PERFORM public.platform_team_owner(p_actor);can_write:=true;EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_column THEN can_write:=false;END;
 ELSE PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));PERFORM public.platform_team_owner(p_actor);END IF;
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>131072 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023';END IF;
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action='read' THEN
  IF p_body-ARRAY['requestId','page']<>'{}' OR NOT p_body ?& ARRAY['requestId','page'] OR coalesce(p_body->>'page','') !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 THEN RAISE EXCEPTION 'Invalid read' USING ERRCODE='22023';END IF;
  entity:=(p_body->>'requestId')::uuid;page:=(p_body->>'page')::integer;
  IF NOT EXISTS(SELECT 1 FROM public.platform_sales_adjustment_requests WHERE id=entity) THEN RAISE EXCEPTION 'Missing request' USING ERRCODE='P3720';END IF;
  RETURN jsonb_build_object('canWrite',can_write,'total',(SELECT count(*) FROM public.platform_sales_adjustment_commands WHERE request_id=entity),'commands',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT c.*,public.platform_sales_finance_name(c.actor_id) current_actor_name,
   (SELECT to_jsonb(e) FROM public.platform_sales_adjustment_command_events e WHERE command_id=c.id ORDER BY version DESC LIMIT 1) latest,
   (SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('current_actor_name',public.platform_sales_finance_name(e.actor_id)) ORDER BY version DESC) FROM public.platform_sales_adjustment_command_events e WHERE command_id=c.id) events
   FROM public.platform_sales_adjustment_commands c WHERE request_id=entity ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET page*25)x));
 END IF;
 IF p_action NOT IN ('prepare','authorize','claim','dispatch','finish','recover','recover_finish','withdraw') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 entity:=(p_body->>'id')::uuid;op:=(p_body->>'operationId')::uuid;
 IF entity IS NULL OR op IS NULL OR jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 500 THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-adjustment-command:'||entity::text,0));
 SELECT * INTO c FROM public.platform_sales_adjustment_commands WHERE id=entity;
 IF p_action='prepare' THEN
  IF p_body-ARRAY['id','operationId','requestId','expectedVersion','checkId','justification']<>'{}' OR NOT p_body ?& ARRAY['id','operationId','requestId','expectedVersion','checkId','justification'] OR coalesce(p_body->>'expectedVersion','') !~ '^[1-9][0-9]{0,5}$' THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  IF c.id IS NOT NULL THEN
   SELECT * INTO prior FROM public.platform_sales_adjustment_command_events WHERE operation_id=op;
   IF c.request_id IS DISTINCT FROM (p_body->>'requestId')::uuid OR c.request_version IS DISTINCT FROM (p_body->>'expectedVersion')::integer OR c.check_id IS DISTINCT FROM (p_body->>'checkId')::uuid OR c.actor_id IS DISTINCT FROM p_actor OR c.justification IS DISTINCT FROM p_body->>'justification' OR prior.command_id IS DISTINCT FROM c.id OR prior.phase<>'PREPARE' THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='P3721';END IF;
   RETURN jsonb_build_object('id',c.id,'replayed',true);
  END IF;
  SELECT * INTO req FROM public.platform_sales_adjustment_requests WHERE id=(p_body->>'requestId')::uuid;
  IF req.id IS NULL THEN RAISE EXCEPTION 'Missing request' USING ERRCODE='P3720';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-adjustment-request:'||req.id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-adjustment-target:'||req.remote_id,0));
  -- One unresolved command per target, including indeterminate attempts and stale claims.
  IF EXISTS(SELECT 1 FROM public.platform_sales_adjustment_commands x JOIN LATERAL(SELECT state FROM public.platform_sales_adjustment_command_events WHERE command_id=x.id ORDER BY version DESC LIMIT 1)v ON true WHERE x.remote_id=req.remote_id AND v.state NOT IN ('WITHDRAWN','CONFIRMED_EXTERNAL')) THEN RAISE EXCEPTION 'Target reserved' USING ERRCODE='P3721';END IF;
  IF EXISTS(SELECT 1 FROM public.platform_sales_adjustment_commands x JOIN LATERAL(SELECT state,created_at FROM public.platform_sales_adjustment_command_events WHERE command_id=x.id ORDER BY version DESC LIMIT 1)v ON true WHERE x.remote_id=req.remote_id AND v.state='CONFIRMED_EXTERNAL' AND v.created_at >= (SELECT created_at FROM public.platform_sales_adjustment_check_events WHERE check_id=(p_body->>'checkId')::uuid ORDER BY version DESC LIMIT 1)) THEN RAISE EXCEPTION 'Fresh post-result evidence required' USING ERRCODE='P3721';END IF;
  g:=public.platform_sales_adjustment_command_guard(p_actor,req.id,(p_body->>'expectedVersion')::integer,(p_body->>'checkId')::uuid);
  INSERT INTO public.platform_sales_adjustment_commands(id,request_id,request_version,check_id,kind,remote_id,source,parameters,evidence,actor_id,actor_name,justification) VALUES(entity,req.id,(p_body->>'expectedVersion')::integer,(p_body->>'checkId')::uuid,req.kind,req.remote_id,g->'source',g->'parameters',g->'evidence',p_actor,author,p_body->>'justification');
  INSERT INTO public.platform_sales_adjustment_command_events(command_id,version,operation_id,phase,state,actor_id,actor_name,justification) VALUES(entity,1,op,'PREPARE','PREPARED',p_actor,author,p_body->>'justification');
  RETURN jsonb_build_object('id',entity,'state','PREPARED');
 END IF;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Missing command' USING ERRCODE='P3720';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-adjustment-request:'||c.request_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-adjustment-target:'||c.remote_id,0));
 SELECT * INTO e FROM public.platform_sales_adjustment_command_events WHERE command_id=c.id ORDER BY version DESC LIMIT 1;
 IF p_action='recover' THEN
  IF p_body-ARRAY['id','operationId','justification']<>'{}' THEN RAISE EXCEPTION 'Invalid recovery' USING ERRCODE='22023';END IF;
  IF e.state NOT IN ('DISPATCHED','PENDING_VERIFICATION','INDETERMINATE') THEN RAISE EXCEPTION 'No external attempt to recover' USING ERRCODE='P3721';END IF;
  RETURN jsonb_build_object('execute',true,'source',c.source,'parameters',c.parameters,'baseline',c.evidence,'receipt',(SELECT evidence FROM public.platform_sales_adjustment_command_events WHERE command_id=c.id AND phase='FINISH' ORDER BY version DESC LIMIT 1),'command',to_jsonb(c));
 END IF;
 IF jsonb_typeof(p_body->'expectedVersion') IS DISTINCT FROM 'number' OR coalesce(p_body->>'expectedVersion','') !~ '^[1-9][0-9]{0,5}$' THEN RAISE EXCEPTION 'Invalid version' USING ERRCODE='22023';END IF;expected:=(p_body->>'expectedVersion')::integer;
 IF p_body-ARRAY['id','operationId','expectedVersion','justification','impactsAccepted','evidence','diagnostic']<>'{}' OR p_action='authorize' AND p_body->>'impactsAccepted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Invalid replay shape' USING ERRCODE='22023';END IF;
 IF p_action IN ('authorize','claim','withdraw') THEN
  IF p_body-ARRAY['id','operationId','expectedVersion','justification','impactsAccepted']<>'{}' OR (p_action='authorize' AND p_body->>'impactsAccepted' IS DISTINCT FROM 'true') OR (p_action<>'authorize' AND p_body ? 'impactsAccepted') THEN RAISE EXCEPTION 'Impacts must be explicitly accepted' USING ERRCODE='22023';END IF;
 ELSE
  IF p_body-ARRAY['id','operationId','expectedVersion','justification','evidence','diagnostic']<>'{}' OR NOT p_body ? 'evidence' THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023';END IF;
  IF p_body ? 'diagnostic' AND p_body->>'diagnostic' NOT IN ('PRECHECK_CHANGED','QUERY_FAILED','QUERY_CONFIG_INVALID','QUERY_TIMEOUT','QUERY_NETWORK_ERROR','QUERY_HTTP_ERROR','QUERY_RESPONSE_LIMIT','QUERY_SCHEMA_INVALID','QUERY_BINDING_MISMATCH','EXECUTED_EVIDENCE_MISSING','RESULT_UNPROVEN') THEN RAISE EXCEPTION 'Unsafe diagnostic' USING ERRCODE='22023';END IF;
 END IF;
 SELECT * INTO prior FROM public.platform_sales_adjustment_command_events WHERE operation_id=op;
 IF FOUND THEN
  IF prior.command_id IS DISTINCT FROM c.id OR prior.actor_id IS DISTINCT FROM p_actor OR prior.justification IS DISTINCT FROM p_body->>'justification' OR prior.phase IS DISTINCT FROM (CASE p_action WHEN 'authorize' THEN 'AUTHORIZE' WHEN 'claim' THEN 'CLAIM' WHEN 'dispatch' THEN 'DISPATCH' WHEN 'finish' THEN 'FINISH' WHEN 'recover_finish' THEN 'RECOVER' ELSE 'WITHDRAW' END) OR prior.version<>expected+1 OR prior.evidence IS DISTINCT FROM p_body->'evidence' OR prior.diagnostic IS DISTINCT FROM p_body->>'diagnostic' THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='P3721';END IF;
  RETURN jsonb_build_object('id',c.id,'state',prior.state,'execute',false,'replayed',true);
 END IF;
 IF e.version<>expected THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='P3721';END IF;
 IF p_action IN ('authorize','claim','dispatch') THEN
  g:=public.platform_sales_adjustment_command_guard(p_actor,c.request_id,c.request_version,c.check_id);
  IF g->'source' IS DISTINCT FROM c.source OR g->'parameters' IS DISTINCT FROM c.parameters OR g->'evidence' IS DISTINCT FROM c.evidence THEN RAISE EXCEPTION 'Preserved source changed' USING ERRCODE='P3721';END IF;
 END IF;
 IF p_action='authorize' THEN
  IF e.state<>'PREPARED' THEN RAISE EXCEPTION 'Not prepared' USING ERRCODE='P3721';END IF;state:='AUTHORIZED';
 ELSIF p_action='claim' THEN
  IF e.state<>'AUTHORIZED' OR e.created_at<clock_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'Authorization expired' USING ERRCODE='P3721';END IF;state:='PRECHECK';
 ELSIF p_action='dispatch' THEN
  IF e.state<>'PRECHECK' OR e.created_at<clock_timestamp()-interval '30 seconds' THEN RAISE EXCEPTION 'Precheck expired' USING ERRCODE='P3721';END IF;
  state:=CASE WHEN p_body->'evidence'=c.evidence AND NOT p_body ? 'diagnostic' THEN 'DISPATCHED' ELSE 'BLOCKED' END;
 ELSIF p_action='finish' THEN
  IF e.state<>'DISPATCHED' THEN RAISE EXCEPTION 'Not dispatched' USING ERRCODE='P3721';END IF;
  IF p_body->'evidence'='null' THEN state:='INDETERMINATE';
  ELSIF jsonb_typeof(p_body->'evidence')='object' AND (p_body->'evidence')-ARRAY['accepted','refundId']='{}' AND p_body->'evidence'->>'accepted'='true' AND (c.kind='CANCEL_SUBSCRIPTION' AND NOT (p_body->'evidence') ? 'refundId' OR c.kind='REFUND_PAYMENT' AND coalesce(p_body->'evidence'->>'refundId','') ~ '^[a-zA-Z0-9_-]{1,120}$') AND NOT p_body ? 'diagnostic' THEN state:='PENDING_VERIFICATION';
  ELSE RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='22023';END IF;
 ELSIF p_action='withdraw' THEN
  IF e.state NOT IN ('PREPARED','AUTHORIZED','PRECHECK','BLOCKED') THEN RAISE EXCEPTION 'Cannot release an attempted target' USING ERRCODE='P3721';END IF;state:='WITHDRAWN';
 ELSE
  IF e.state NOT IN ('DISPATCHED','PENDING_VERIFICATION','INDETERMINATE') THEN RAISE EXCEPTION 'No attempt to recover' USING ERRCODE='P3721';END IF;
  proof:=p_body->'evidence';state:='INDETERMINATE';
  IF proof IS DISTINCT FROM 'null'::jsonb THEN
   IF jsonb_typeof(proof)<>'object' OR proof-ARRAY['kind','remoteId','verified','subscription','refund','payments']<>'{}' OR proof->>'remoteId' IS DISTINCT FROM c.remote_id OR proof->>'kind' IS DISTINCT FROM c.kind OR jsonb_typeof(proof->'verified') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid verification' USING ERRCODE='22023';END IF;
   IF proof->>'verified'='true' THEN
    IF c.kind='CANCEL_SUBSCRIPTION' AND (proof->'subscription'->>'id' IS DISTINCT FROM c.remote_id OR proof->'subscription'->>'customer' IS DISTINCT FROM c.source->'parameters'->>'customer' OR proof->'subscription'->>'reference' IS DISTINCT FROM c.source->'parameters'->>'externalReference' OR proof->'subscription'->>'deleted' IS DISTINCT FROM 'true' OR jsonb_typeof(proof->'payments') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.evidence->'payments') old WHERE old->>'affectedByRemoval'='true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'payments') x WHERE x->>'id'=old->>'id' AND x->>'customer'=old->>'customer' AND x->>'subscription'=c.remote_id AND x->>'deleted'='true'))) THEN RAISE EXCEPTION 'Deletion not proven' USING ERRCODE='P3721';END IF;
    IF c.kind='REFUND_PAYMENT' AND (proof->'refund'->>'id' IS DISTINCT FROM (SELECT evidence->>'refundId' FROM public.platform_sales_adjustment_command_events WHERE command_id=c.id AND phase='FINISH' ORDER BY version DESC LIMIT 1) OR proof->'refund'->>'status' IS DISTINCT FROM 'DONE' OR proof->'refund'->'valueCents' IS DISTINCT FROM c.parameters->'amountCents' OR coalesce(proof->'refund'->>'id','') !~ '^[a-zA-Z0-9_-]{1,120}$' OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.evidence->'refunds')x WHERE x->>'id'=proof->'refund'->>'id')) THEN RAISE EXCEPTION 'Refund not proven' USING ERRCODE='P3721';END IF;
    state:='CONFIRMED_EXTERNAL';
   ELSE state:='PENDING_VERIFICATION';END IF;
  END IF;
 END IF;
 INSERT INTO public.platform_sales_adjustment_command_events(command_id,version,operation_id,phase,state,actor_id,actor_name,justification,evidence,diagnostic) VALUES(c.id,e.version+1,op,CASE p_action WHEN 'authorize' THEN 'AUTHORIZE' WHEN 'claim' THEN 'CLAIM' WHEN 'dispatch' THEN 'DISPATCH' WHEN 'finish' THEN 'FINISH' WHEN 'recover_finish' THEN 'RECOVER' ELSE 'WITHDRAW' END,state,p_actor,author,p_body->>'justification',p_body->'evidence',p_body->>'diagnostic');
 RETURN jsonb_build_object('id',c.id,'state',state,'version',e.version+1,'execute',p_action='claim' OR p_action='dispatch' AND state='DISPATCHED','source',CASE WHEN p_action='claim' THEN c.source ELSE NULL END,'parameters',CASE WHEN p_action='claim' THEN c.parameters ELSE NULL END,'baseline',CASE WHEN p_action='claim' THEN c.evidence ELSE NULL END);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_adjustment_command_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_adjustment_command_action(uuid,text,jsonb) TO service_role;
COMMIT;
