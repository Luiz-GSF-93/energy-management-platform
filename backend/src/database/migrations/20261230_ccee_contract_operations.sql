BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.ccee_contract_commands(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 authorization_id uuid NOT NULL REFERENCES public.ccee_unit_authorizations(id),binding_revision integer NOT NULL,
 month date NOT NULL CHECK(extract(day from month)=1),operation text NOT NULL CHECK(operation IN('CONTRACTS','AMOUNTS','FILE')),
 role text NOT NULL CHECK(role IN('COMPRADOR','VENDEDOR')),environment text NOT NULL CHECK(environment IN('PRODUCTION','PILOT')),
 state text NOT NULL CHECK(state IN('PREPARED','REVIEWED','QUEUED','RUNNING','SUCCEEDED','FAILED','UNKNOWN')),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=600000),result jsonb,source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 parent_id uuid REFERENCES public.ccee_contract_commands(id),created_by text NOT NULL,reviewed_by text,reason text NOT NULL,
 revision integer NOT NULL DEFAULT 1,requests integer NOT NULL DEFAULT 0,lease_id uuid,lease_until timestamptz,
 last_error text,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 CHECK(operation<>'FILE' OR state IN('PREPARED','REVIEWED')),CHECK(environment='PRODUCTION' OR operation='FILE'),
 CHECK(state<>'REVIEWED' OR reviewed_by IS NOT NULL AND reviewed_by<>created_by)
);
CREATE TABLE public.ccee_contract_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,command_id uuid NOT NULL REFERENCES public.ccee_contract_commands(id),
 request_id uuid,actor_id text NOT NULL,event text NOT NULL,details jsonb NOT NULL CHECK(octet_length(details::text)<=1000000),
 recorded_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,request_id)
);
ALTER TABLE public.ccee_contract_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ccee_contract_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_contract_commands,public.ccee_contract_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ccee_contract_queue ON public.ccee_contract_commands(created_at,id) WHERE state='QUEUED';
CREATE INDEX ccee_contract_history ON public.ccee_contract_receipts(organization_id,command_id,recorded_at);
CREATE TRIGGER ccee_contract_receipts_immutable BEFORE UPDATE OR DELETE ON public.ccee_contract_receipts FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();

CREATE FUNCTION public.ccee_contract_assert(p_org text,p_actor text,p_binding uuid,p_month date,p_manage boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb;
BEGIN
 PERFORM public.assert_ccee_registration_actor(p_org,p_actor,CASE WHEN p_manage THEN 'manage' ELSE 'view' END);
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,CASE WHEN p_manage THEN 'manage' ELSE 'view' END);
 b:=public.assert_ccee_data_binding(p_org,p_binding,p_month,'POINTS');
 IF b->>'representation_kind' IS DISTINCT FROM 'TOTAL' THEN RAISE EXCEPTION 'Contract read needs reviewed total representation' USING ERRCODE='42501';END IF;
 RETURN b;
END$$;

CREATE FUNCTION public.ccee_contract_action(p_org text,p_actor text,p_action text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.ccee_contract_commands;prior public.ccee_contract_receipts;parent public.ccee_contract_commands;b jsonb;result jsonb;fingerprint text;target date;req uuid;
BEGIN
 PERFORM public.assert_ccee_registration_actor(p_org,p_actor,CASE WHEN p_action='review' THEN 'approve' WHEN p_action IN('list','job','history') THEN 'view' ELSE 'manage' END);
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,CASE WHEN p_action IN('list','job','history') THEN 'view' ELSE 'manage' END);
 IF p_org<>'org_default' THEN RAISE EXCEPTION 'Initial contract homologation only' USING ERRCODE='42501';END IF;
 IF p_action='list' THEN RETURN jsonb_build_object('organizationId',p_org,'commands',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id,authorization_id,binding_revision,month,operation,role,environment,state,source_hash,parent_id,created_by,reviewed_by,reason,revision,requests,last_error,created_at,finished_at FROM public.ccee_contract_commands WHERE organization_id=p_org ORDER BY created_at DESC,id LIMIT 50)x));END IF;
 IF p_action IN('job','history') THEN
  SELECT * INTO c FROM public.ccee_contract_commands WHERE id=p_id AND organization_id=p_org;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Command unavailable' USING ERRCODE='42501';END IF;
  PERFORM public.ccee_contract_assert(p_org,p_actor,c.authorization_id,c.month,false);
  IF p_action='job' THEN RETURN jsonb_build_object('organizationId',p_org,'command',to_jsonb(c)-ARRAY['lease_id','lease_until']);END IF;
  RETURN jsonb_build_object('organizationId',p_org,'rows',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT event,actor_id,recorded_at,details-'request' AS details FROM public.ccee_contract_receipts WHERE organization_id=p_org AND command_id=p_id ORDER BY recorded_at DESC,id LIMIT 100)x));
 END IF;
 IF p_action NOT IN('create','review') OR octet_length(p_body::text)>600000 OR length(coalesce(p_body->>'reason','')) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'action',p_action,'id',p_id,'body',p_body)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-contract-request:'||p_org||req::text,0));
 SELECT * INTO prior FROM public.ccee_contract_receipts WHERE organization_id=p_org AND request_id=req;
 IF FOUND THEN IF prior.details->>'fingerprint' IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001';END IF;RETURN prior.details->'result';END IF;
 IF p_action='create' THEN
  IF p_body-ARRAY['requestId','authorizationId','month','operation','role','environment','reason','confirmed','parentId','contractId','amountKind','xml','layoutReference']<>'{}'::jsonb OR p_body->>'operation' NOT IN('CONTRACTS','AMOUNTS','FILE') OR p_body->>'role' NOT IN('COMPRADOR','VENDEDOR') OR p_body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR p_body->>'month'!~'^20\d{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Explicit scope required' USING ERRCODE='22023';END IF;
  target:=((p_body->>'month')||'-01')::date;
  IF target<'2021-01-01' OR target>=date_trunc('month',now())::date THEN RAISE EXCEPTION 'Closed month required' USING ERRCODE='22023';END IF;
  b:=public.ccee_contract_assert(p_org,p_actor,(p_body->>'authorizationId')::uuid,target);
  IF p_body->>'operation'='FILE' THEN
   IF p_body->>'environment' IS DISTINCT FROM 'PILOT' OR length(coalesce(p_body->>'xml','')) NOT BETWEEN 10 AND 524288 OR length(coalesce(p_body->>'layoutReference','')) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Pilot file reference required' USING ERRCODE='22023';END IF;
  ELSE
   IF p_body->>'environment' IS DISTINCT FROM 'PRODUCTION' OR p_body?'xml' OR p_body?'layoutReference' THEN RAISE EXCEPTION 'Read command only' USING ERRCODE='22023';END IF;
   IF p_body->>'operation'='AMOUNTS' THEN
    SELECT * INTO parent FROM public.ccee_contract_commands WHERE id=(p_body->>'parentId')::uuid AND organization_id=p_org AND authorization_id=(p_body->>'authorizationId')::uuid AND month=target AND role=p_body->>'role' AND state='SUCCEEDED' AND operation='CONTRACTS' AND binding_revision=(b->>'revision')::integer;
    IF parent.id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parent.result->'rows') r WHERE r->>'id'=p_body->>'contractId') OR p_body->>'amountKind' NOT IN('MONTANTE_MEDIO','MONTANTE_MODULARIZADO') THEN RAISE EXCEPTION 'Select contract in scoped source' USING ERRCODE='42501';END IF;
   ELSIF p_body?'parentId' OR p_body?'contractId' OR p_body?'amountKind' THEN RAISE EXCEPTION 'Unexpected parent' USING ERRCODE='22023';END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ccee-contract-queue:'||p_org,0));
  IF (SELECT count(*) FROM public.ccee_contract_commands WHERE organization_id=p_org AND state IN('QUEUED','RUNNING'))>=5 THEN RAISE EXCEPTION 'Queue bounded' USING ERRCODE='22023';END IF;
  SELECT * INTO c FROM public.ccee_contract_commands WHERE organization_id=p_org AND authorization_id=(p_body->>'authorizationId')::uuid AND binding_revision=(b->>'revision')::integer AND payload=p_body-ARRAY['requestId','reason'] AND state IN('QUEUED','RUNNING','PREPARED','REVIEWED') ORDER BY created_at LIMIT 1;
  IF c.id IS NULL THEN
  INSERT INTO public.ccee_contract_commands(organization_id,authorization_id,binding_revision,month,operation,role,environment,state,payload,source_hash,parent_id,created_by,reason)
  VALUES(p_org,(p_body->>'authorizationId')::uuid,(b->>'revision')::integer,target,p_body->>'operation',p_body->>'role',p_body->>'environment',CASE WHEN p_body->>'operation'='FILE' THEN 'PREPARED' ELSE 'QUEUED' END,p_body-ARRAY['requestId','reason'],encode(sha256(convert_to(CASE WHEN p_body->>'operation'='FILE' THEN p_body->>'xml' ELSE(p_body-ARRAY['requestId','reason'])::text END,'UTF8')),'hex'),parent.id,p_actor,p_body->>'reason') RETURNING * INTO c;
  END IF;
 ELSE
  SELECT * INTO c FROM public.ccee_contract_commands WHERE id=p_id AND organization_id=p_org FOR UPDATE;
  IF c.id IS NULL OR c.operation<>'FILE' OR c.state<>'PREPARED' OR c.created_by=p_actor OR c.source_hash IS DISTINCT FROM p_body->>'hash' OR c.revision IS DISTINCT FROM (p_body->>'revision')::integer OR p_body-ARRAY['requestId','reason','hash','revision']<>'{}'::jsonb THEN RAISE EXCEPTION 'Independent exact file review required' USING ERRCODE='42501';END IF;
  PERFORM public.ccee_contract_assert(p_org,p_actor,c.authorization_id,c.month);
  UPDATE public.ccee_contract_commands SET state='REVIEWED',reviewed_by=p_actor,revision=revision+1 WHERE id=c.id RETURNING * INTO c;
 END IF;
 result:=jsonb_build_object('organizationId',p_org,'command',to_jsonb(c)-ARRAY['lease_id','lease_until']);
 INSERT INTO public.ccee_contract_receipts(organization_id,command_id,request_id,actor_id,event,details) VALUES(p_org,c.id,req,p_actor,upper(p_action),jsonb_build_object('fingerprint',fingerprint,'result',result));RETURN result;
END$$;

CREATE FUNCTION public.ccee_operational_usage(p_org text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH usage_window AS(SELECT date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS start),counts AS(
  SELECT CASE WHEN j.kind='PLD' THEN 'PLD' WHEN j.kind LIKE 'DRI_%' THEN 'DRI' ELSE 'PRIVATE' END AS family,greatest(CASE WHEN j.finished_at>=w.start THEN j.requests ELSE 0 END,(SELECT count(*) FROM public.ccee_integration_events e WHERE e.job_id=j.id AND e.organization_id=p_org AND e.event='COMMUNICATION_REQUEST_RESERVED' AND e.recorded_at>=w.start)) AS requests FROM public.ccee_integration_jobs j CROSS JOIN usage_window w WHERE j.organization_id=p_org AND(j.finished_at>=w.start OR EXISTS(SELECT 1 FROM public.ccee_integration_events e WHERE e.job_id=j.id AND e.event='COMMUNICATION_REQUEST_RESERVED' AND e.recorded_at>=w.start))
  UNION ALL SELECT CASE WHEN s.kind='PLD_HOURLY' THEN 'PLD' ELSE 'PRIVATE' END,count(*) FROM public.ccee_integration_events e JOIN public.ccee_sync_schedules s ON s.id::text=e.details->>'scheduleId' AND s.organization_id=e.organization_id CROSS JOIN usage_window w WHERE e.organization_id=p_org AND e.event='MARKET_REQUEST_RESERVED' AND e.recorded_at>=w.start GROUP BY 1
  UNION ALL SELECT 'PRIVATE',count(*) FROM public.ccee_contract_receipts e CROSS JOIN usage_window w WHERE e.organization_id=p_org AND e.event='REQUEST_RESERVED' AND e.recorded_at>=w.start)
 SELECT jsonb_build_object('total',coalesce(sum(requests),0),'PLD',coalesce(sum(requests) FILTER(WHERE family='PLD'),0),'DRI',coalesce(sum(requests) FILTER(WHERE family='DRI'),0),'PRIVATE',coalesce(sum(requests) FILTER(WHERE family='PRIVATE'),0)) FROM counts
$$;

CREATE OR REPLACE FUNCTION public.ccee_communication_reserve(p_id uuid,p_lease uuid,p_market boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org text;family text;v jsonb;s public.ccee_sync_schedules;usage jsonb;
BEGIN
 IF p_market THEN v:=public.ccee_market_assert(p_id,p_lease);org:=v->>'organizationId';SELECT * INTO s FROM public.ccee_sync_schedules WHERE id=p_id;family:=CASE WHEN s.kind='PLD_HOURLY' THEN 'PLD' ELSE 'PRIVATE' END;
 ELSE v:=public.ccee_assert_reading(p_id,p_lease);org:=v->>'organization_id';family:=CASE WHEN v->>'kind'='PLD' THEN 'PLD' WHEN v->>'kind' LIKE 'DRI_%' THEN 'DRI' ELSE 'PRIVATE' END;END IF;
 IF org IS DISTINCT FROM 'org_default' THEN RAISE EXCEPTION 'Budget not configured' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-communication-budget:'||org,0));usage:=public.ccee_operational_usage(org);
 IF(usage->>'total')::bigint>=200 OR(usage->>family)::bigint>=(CASE family WHEN 'PLD' THEN 60 WHEN 'DRI' THEN 40 ELSE 100 END) THEN RAISE EXCEPTION 'COMMUNICATION_REQUEST_BUDGET_EXHAUSTED' USING ERRCODE='P0001';END IF;
 IF NOT p_market THEN INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,details) VALUES(org,p_id,'system:ccee-auto','COMMUNICATION_REQUEST_RESERVED',jsonb_build_object('leaseId',p_lease,'family',family));END IF;
 RETURN jsonb_build_object('reserved',true,'total',(usage->>'total')::bigint+1,'limit',200);
END$$;

CREATE FUNCTION public.ccee_contract_worker(p_action text,p_id uuid DEFAULT NULL,p_lease uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.ccee_contract_commands;b jsonb;usage jsonb;detail jsonb;
BEGIN
 IF p_action='claim' THEN
  WITH interrupted AS(UPDATE public.ccee_contract_commands SET state='UNKNOWN',last_error='RESULT_NOT_CONFIRMED',finished_at=now() WHERE state='RUNNING' AND lease_until<=now() RETURNING *) INSERT INTO public.ccee_contract_receipts(organization_id,command_id,actor_id,event,details) SELECT organization_id,id,'system:ccee-contract','UNKNOWN',jsonb_build_object('error','RESULT_NOT_CONFIRMED','automaticRetry',false) FROM interrupted;
  SELECT * INTO c FROM public.ccee_contract_commands WHERE organization_id='org_default' AND operation IN('CONTRACTS','AMOUNTS') AND environment='PRODUCTION' AND state='QUEUED' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF c.id IS NULL THEN RETURN NULL;END IF;
  BEGIN b:=public.ccee_contract_assert(c.organization_id,c.created_by,c.authorization_id,c.month);IF(b->>'revision')::integer<>c.binding_revision THEN RAISE EXCEPTION 'Binding changed' USING ERRCODE='42501';END IF;
  EXCEPTION WHEN insufficient_privilege THEN UPDATE public.ccee_contract_commands SET state='FAILED',last_error='ACCESS_CHANGED',finished_at=now() WHERE id=c.id;RETURN NULL;END;
  UPDATE public.ccee_contract_commands SET state='RUNNING',lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes' WHERE id=c.id RETURNING * INTO c;
  RETURN jsonb_build_object('command',to_jsonb(c),'binding',b);
 END IF;
 SELECT * INTO c FROM public.ccee_contract_commands WHERE id=p_id AND lease_id=p_lease AND lease_until>now() AND state='RUNNING' FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Lease changed' USING ERRCODE='40001';END IF;
 IF p_action IN('assert','reserve') THEN
  b:=public.ccee_contract_assert(c.organization_id,c.created_by,c.authorization_id,c.month);IF(b->>'revision')::integer<>c.binding_revision THEN RAISE EXCEPTION 'Binding changed' USING ERRCODE='42501';END IF;
  IF p_action='assert' THEN RETURN jsonb_build_object('command',to_jsonb(c),'binding',b);END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ccee-communication-budget:'||c.organization_id,0));usage:=public.ccee_operational_usage(c.organization_id);
  IF c.requests>=5 OR(usage->>'total')::bigint>=200 OR(usage->>'PRIVATE')::bigint>=100 OR(SELECT count(*) FROM public.ccee_contract_receipts WHERE organization_id=c.organization_id AND event='REQUEST_RESERVED')>=10 THEN RAISE EXCEPTION 'CONTRACT_HOMOLOGATION_BUDGET_EXHAUSTED' USING ERRCODE='P0001';END IF;
  UPDATE public.ccee_contract_commands SET requests=requests+1 WHERE id=c.id;
  INSERT INTO public.ccee_contract_receipts(organization_id,command_id,actor_id,event,details) VALUES(c.organization_id,c.id,'system:ccee-contract','REQUEST_RESERVED',jsonb_build_object('leaseId',p_lease));RETURN jsonb_build_object('reserved',true);
 END IF;
 IF p_action<>'finish' OR octet_length(p_body::text)>1000000 OR p_body-ARRAY['result','error','diagnostic']<>'{}'::jsonb OR coalesce(length(p_body->>'error'),0)>100 THEN RAISE EXCEPTION 'Invalid finish' USING ERRCODE='22023';END IF;
 IF p_body->>'error' IS NULL THEN
  b:=public.ccee_contract_assert(c.organization_id,c.created_by,c.authorization_id,c.month);
  IF(b->>'revision')::integer<>c.binding_revision OR p_body#>'{result,complete}' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(p_body#>'{result,rows}') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete source' USING ERRCODE='42501';END IF;
 END IF;
 UPDATE public.ccee_contract_commands SET state=CASE WHEN p_body->>'error' IS NULL THEN 'SUCCEEDED' ELSE 'FAILED' END,result=CASE WHEN p_body->>'error' IS NULL THEN p_body->'result' END,last_error=p_body->>'error',finished_at=now(),lease_id=NULL,lease_until=NULL WHERE id=c.id RETURNING * INTO c;
 INSERT INTO public.ccee_contract_receipts(organization_id,command_id,actor_id,event,details) VALUES(c.organization_id,c.id,'system:ccee-contract',c.state,jsonb_build_object('sourceHash',c.result->>'sourceHash','error',c.last_error,'diagnostic',p_body->'diagnostic'));
 RETURN jsonb_build_object('recorded',true);
END$$;

DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('ccee_contract_assert','ccee_contract_action','ccee_contract_worker','ccee_operational_usage','ccee_communication_reserve') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);END LOOP;END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
