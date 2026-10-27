BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.ccee_service_sync_policies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),authorization_id uuid NOT NULL REFERENCES public.ccee_unit_authorizations(id),
 kind text NOT NULL CHECK(kind IN('UNIT_BASIS','MEASUREMENTS','DRI')),created_by text NOT NULL,source_job_id uuid REFERENCES public.ccee_integration_jobs(id),
 month_mode text NOT NULL CHECK(month_mode IN('FIXED','PREVIOUS_CLOSED')),month date NOT NULL,source_selector jsonb NOT NULL DEFAULT '{}',cursor jsonb NOT NULL DEFAULT '{}',
 enabled boolean NOT NULL DEFAULT false,state text NOT NULL DEFAULT 'PAUSED',revision integer NOT NULL DEFAULT 1,request_id uuid NOT NULL,
 current_job_id uuid REFERENCES public.ccee_integration_jobs(id),last_monthly_date date,last_attempt_at timestamptz,last_success_at timestamptz,last_source_at timestamptz,source_month text,
 next_run_at timestamptz,last_error text,lease_id uuid,lease_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,authorization_id,kind),UNIQUE(organization_id,request_id),CHECK(jsonb_typeof(source_selector)='object' AND octet_length(source_selector::text)<=4000),CHECK(jsonb_typeof(cursor)='object' AND octet_length(cursor::text)<=4000),CHECK(kind<>'UNIT_BASIS' OR NOT enabled)
);
ALTER TABLE public.ccee_service_sync_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_service_sync_policies FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ccee_auto_due ON public.ccee_service_sync_policies(organization_id,next_run_at) WHERE enabled;

CREATE FUNCTION public.ccee_auto_policy_action(p_org text,p_actor text,p_action text,p_id uuid,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.ccee_service_sync_policies;j public.ccee_integration_jobs;parent public.ccee_integration_jobs;events public.ccee_integration_jobs;b jsonb;selector jsonb;prior public.ccee_integration_events;action_result jsonb;req uuid;binding_id uuid;target date;entry jsonb;frame jsonb;event_name text;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,CASE WHEN p_action IN('list','unit_context') THEN 'view' ELSE 'manage' END);
 IF p_org<>'org_default' OR p_action NOT IN('list','unit_context','configure','configure_unit','toggle') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>6000 THEN RAISE EXCEPTION 'Automatic policy unavailable' USING ERRCODE='42501';END IF;
 IF p_action='list' THEN
  RETURN jsonb_build_object('organizationId',p_org,'dailyLimit',200,'policies',(SELECT coalesce(jsonb_agg(to_jsonb(x)-ARRAY['lease_id','lease_until'] ORDER BY x.updated_at DESC),'[]') FROM public.ccee_service_sync_policies x WHERE organization_id=p_org),
   'sources',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT id,kind,month,authorization_id,finished_at FROM public.ccee_integration_jobs WHERE organization_id=p_org AND state='SUCCEEDED' AND result->'complete'='true'::jsonb AND(kind='DRI_RESULTS' OR kind='MEASUREMENTS' AND measurement_kind='FINAL' AND result#>>'{data,timeSemantics}'='CCEE_HOUR_LABEL_V2') ORDER BY finished_at DESC LIMIT 50)x));
 END IF;
 IF p_action='unit_context' THEN
  SELECT * INTO p FROM public.ccee_service_sync_policies WHERE organization_id=p_org AND authorization_id=p_id AND kind='UNIT_BASIS';
  IF NOT FOUND THEN RETURN jsonb_build_object('organizationId',p_org,'unitBasis',NULL);END IF;
  b:=public.assert_ccee_data_binding(p_org,p_id,p.month,'MEASUREMENTS');
  RETURN jsonb_build_object('organizationId',p_org,'unitBasis',CASE WHEN p.source_selector->>'bindingRevision'=b->>'revision' THEN p.source_selector ELSE NULL END);
 END IF;
 IF p_body-ARRAY['requestId','reason','revision','authorizationId','sourceJobId','monthMode','calendarCode','unit','sourceReference','confirmed','enabled']<>'{}'::jsonb OR length(coalesce(p_body->>'reason','')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Invalid automatic policy command' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-policy:'||p_org,0));
 SELECT * INTO prior FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=req;
 IF FOUND THEN IF prior.details->'command' IS DISTINCT FROM jsonb_build_object('actor',p_actor,'action',p_action,'id',p_id,'body',p_body) THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001';END IF;RETURN prior.details->'result';END IF;
 IF p_id IS NOT NULL THEN SELECT * INTO p FROM public.ccee_service_sync_policies WHERE id=p_id AND organization_id=p_org FOR UPDATE;IF NOT FOUND OR (p_body->>'revision')::integer IS DISTINCT FROM p.revision OR p.lease_until>now() OR p.current_job_id IS NOT NULL THEN RAISE EXCEPTION 'Policy changed or in progress' USING ERRCODE='40001';END IF;END IF;
 IF p_action='configure_unit' THEN
  binding_id:=(p_body->>'authorizationId')::uuid;target:=(date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')-interval '1 month')::date;b:=public.assert_ccee_data_binding(p_org,binding_id,target,'MEASUREMENTS');
  IF p_body->>'unit' NOT IN('kWh','MWh') OR p_body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR length(coalesce(p_body->>'sourceReference','')) NOT BETWEEN 10 AND 1000 OR p.id IS NOT NULL AND(p.authorization_id<>binding_id OR p.kind<>'UNIT_BASIS') THEN RAISE EXCEPTION 'Confirmed unit source required' USING ERRCODE='22023';END IF;
  selector:=jsonb_build_object('unit',p_body->>'unit','sourceReference',p_body->>'sourceReference','confirmedBy',p_actor,'confirmedAt',now(),'bindingRevision',(b->>'revision')::integer);
  IF p.id IS NULL THEN INSERT INTO public.ccee_service_sync_policies(organization_id,authorization_id,kind,created_by,month_mode,month,source_selector,request_id) VALUES(p_org,binding_id,'UNIT_BASIS',p_actor,'FIXED',target,selector,req) RETURNING * INTO p;
  ELSE UPDATE public.ccee_service_sync_policies SET source_selector=selector,revision=revision+1,updated_at=now() WHERE id=p.id RETURNING * INTO p;END IF;
 ELSE
  IF p_action='configure' THEN
   SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=(p_body->>'sourceJobId')::uuid AND organization_id=p_org AND state='SUCCEEDED' AND result->'complete'='true'::jsonb;
   IF j.id IS NULL OR j.kind NOT IN('MEASUREMENTS','DRI_RESULTS') OR j.kind='MEASUREMENTS' AND(j.measurement_kind<>'FINAL' OR j.result#>>'{data,timeSemantics}' IS DISTINCT FROM 'CCEE_HOUR_LABEL_V2') OR p.id IS NOT NULL AND(p.authorization_id<>j.authorization_id OR p.kind IS DISTINCT FROM CASE WHEN j.kind='MEASUREMENTS' THEN 'MEASUREMENTS' ELSE 'DRI' END) THEN RAISE EXCEPTION 'Homologated source required' USING ERRCODE='22023';END IF;
   b:=public.assert_ccee_data_binding(p_org,j.authorization_id,j.month,CASE WHEN j.kind='MEASUREMENTS' THEN 'MEASUREMENTS' ELSE 'DRI_READ' END);
   IF p_body->>'monthMode' NOT IN('FIXED','PREVIOUS_CLOSED') THEN RAISE EXCEPTION 'Month strategy required' USING ERRCODE='22023';END IF;
   selector:=jsonb_build_object('bindingRevision',(b->>'revision')::integer,'calendarCode',nullif(p_body->>'calendarCode',''));
   IF j.kind='DRI_RESULTS' THEN
    SELECT * INTO parent FROM public.ccee_integration_jobs WHERE id=(j.request_payload->>'parentJobId')::uuid AND organization_id=p_org AND authorization_id=j.authorization_id AND month=j.month AND state='SUCCEEDED' AND kind='DRI_REPORTS';
    SELECT r,f INTO entry,frame FROM jsonb_array_elements(parent.result#>'{data,rows}') r CROSS JOIN LATERAL jsonb_array_elements(r->'frames') f WHERE r->>'id'=j.request_payload->>'reportId' AND f->>'id'=j.request_payload->>'frameId';
    SELECT * INTO events FROM public.ccee_integration_jobs WHERE id=(parent.request_payload->>'parentJobId')::uuid AND organization_id=p_org AND authorization_id=j.authorization_id AND month=j.month AND state='SUCCEEDED' AND kind='DRI_EVENTS';
    SELECT e->>'name' INTO event_name FROM jsonb_array_elements(events.result#>'{data,rows}') e WHERE e->>'code'=j.request_payload->>'eventCode';
    IF event_name IS NULL OR entry->>'name' IS NULL OR frame->>'name' IS NULL THEN RAISE EXCEPTION 'Source chain required' USING ERRCODE='22023';END IF;
    selector:=selector||jsonb_build_object('eventName',event_name,'reportName',entry->>'name','frameName',frame->>'name');
   END IF;
   IF p.id IS NULL THEN INSERT INTO public.ccee_service_sync_policies(organization_id,authorization_id,kind,created_by,source_job_id,month_mode,month,source_selector,request_id,last_success_at,last_monthly_date,cursor) VALUES(p_org,j.authorization_id,CASE WHEN j.kind='MEASUREMENTS' THEN 'MEASUREMENTS' ELSE 'DRI' END,p_actor,j.id,p_body->>'monthMode',j.month,selector,req,j.finished_at,CASE WHEN j.kind='MEASUREMENTS' THEN (j.finished_at AT TIME ZONE 'America/Sao_Paulo')::date END,jsonb_build_object('month',to_char(j.month,'YYYY-MM'))) RETURNING * INTO p;
   ELSE UPDATE public.ccee_service_sync_policies SET created_by=p_actor,source_job_id=j.id,month_mode=p_body->>'monthMode',month=j.month,source_selector=selector,revision=revision+1,last_error=NULL,state='PAUSED',enabled=false,cursor=jsonb_build_object('month',to_char(j.month,'YYYY-MM')),updated_at=now() WHERE id=p.id RETURNING * INTO p;END IF;
  ELSIF p_action='toggle' THEN
   IF p.id IS NULL OR p.kind='UNIT_BASIS' OR jsonb_typeof(p_body->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Select policy state' USING ERRCODE='22023';END IF;
   b:=public.assert_ccee_data_binding(p_org,p.authorization_id,p.month,CASE WHEN p.kind='MEASUREMENTS' THEN 'MEASUREMENTS' ELSE 'DRI_READ' END);
   SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=p.source_job_id AND organization_id=p_org AND authorization_id=p.authorization_id AND state='SUCCEEDED' AND result->'complete'='true'::jsonb;
   IF (p_body->>'enabled')::boolean AND(j.id IS NULL OR p.source_selector->>'bindingRevision' IS DISTINCT FROM b->>'revision' OR p.last_error IS NOT NULL AND j.finished_at<=p.last_attempt_at) THEN RAISE EXCEPTION 'Rehomologation required' USING ERRCODE='22023';END IF;
   UPDATE public.ccee_service_sync_policies SET enabled=(p_body->>'enabled')::boolean,state=CASE WHEN(p_body->>'enabled')::boolean THEN 'READY' ELSE 'PAUSED' END,next_run_at=CASE WHEN(p_body->>'enabled')::boolean THEN date_trunc('hour',now())+interval '1 hour' END,revision=revision+1,updated_at=now() WHERE id=p.id RETURNING * INTO p;
  END IF;
 END IF;
 action_result:=jsonb_build_object('organizationId',p_org,'policy',to_jsonb(p)-ARRAY['lease_id','lease_until']);
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details) VALUES(p_org,p_actor,'AUTOMATIC_POLICY_'||upper(p_action),req,jsonb_build_object('command',jsonb_build_object('actor',p_actor,'action',p_action,'id',p_id,'body',p_body),'result',action_result));RETURN action_result;
END$$;

CREATE FUNCTION public.ccee_auto_claim(p_org text,p_private boolean DEFAULT false,p_dri boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.ccee_service_sync_policies;b jsonb;j jsonb;target date;agenda boolean;
BEGIN
 IF p_org<>'org_default' THEN RETURN NULL;END IF;
 SELECT * INTO p FROM public.ccee_service_sync_policies WHERE organization_id=p_org AND enabled AND next_run_at<=now() AND(lease_until IS NULL OR lease_until<=now()) AND(kind='MEASUREMENTS' AND p_private OR kind='DRI' AND p_dri) ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF p.id IS NULL THEN RETURN NULL;END IF;
 target:=CASE WHEN p.month_mode='FIXED' THEN p.month ELSE(date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')-interval '1 month')::date END;
 BEGIN
  PERFORM public.assert_ccee_data_actor(p_org,p.created_by,'manage');b:=public.assert_ccee_data_binding(p_org,p.authorization_id,target,CASE WHEN p.kind='MEASUREMENTS' THEN 'MEASUREMENTS' ELSE 'DRI_READ' END);
  IF p.source_selector->>'bindingRevision' IS DISTINCT FROM b->>'revision' THEN RAISE EXCEPTION 'Binding changed' USING ERRCODE='42501';END IF;
 EXCEPTION WHEN insufficient_privilege THEN UPDATE public.ccee_service_sync_policies SET enabled=false,state='REVIEW_REQUIRED',last_error='ACCESS_CHANGED',next_run_at=NULL,updated_at=now() WHERE id=p.id;RETURN NULL;END;
 IF p.current_job_id IS NOT NULL THEN SELECT to_jsonb(x) INTO j FROM public.ccee_integration_jobs x WHERE id=p.current_job_id AND organization_id=p_org AND authorization_id=p.authorization_id;IF j IS NULL THEN RAISE EXCEPTION 'Policy source changed' USING ERRCODE='42501';END IF;END IF;
 SELECT EXISTS(SELECT 1 FROM public.ccee_calendar_items i JOIN public.ccee_calendar_versions v ON v.id=i.version_id WHERE i.code=p.source_selector->>'calendarCode' AND i.month=target AND i.due_at<=now() AND v.state='APPROVED' AND v.id=(SELECT id FROM public.ccee_calendar_versions WHERE year=extract(year FROM target)::integer AND state='APPROVED' ORDER BY reviewed_at DESC,id DESC LIMIT 1)) INTO agenda;
 UPDATE public.ccee_service_sync_policies SET lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes' WHERE id=p.id RETURNING * INTO p;
 RETURN jsonb_build_object('organizationId',p_org,'policy',to_jsonb(p),'job',j,'targetMonth',to_char(target,'YYYY-MM'),'today',to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD'),'agendaReady',agenda);
END$$;

CREATE FUNCTION public.ccee_auto_advance(p_id uuid,p_lease uuid,p_plan jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.ccee_service_sync_policies;r jsonb;j public.ccee_integration_jobs;body jsonb;
BEGIN
 SELECT * INTO p FROM public.ccee_service_sync_policies WHERE id=p_id AND lease_id=p_lease AND lease_until>now() AND enabled FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Policy lease changed' USING ERRCODE='40001';END IF;
 PERFORM public.assert_ccee_data_actor(p.organization_id,p.created_by,'manage');
 IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR octet_length(p_plan::text)>6000 OR p_plan-ARRAY['action','state','nextRunAt','cursor','kind','body','enabled','error','success','sourceAt','sourceMonth','lastMonthlyDate','keepJob']<>'{}'::jsonb OR p_plan->>'action' NOT IN('enqueue','finish') OR p_plan->>'state' NOT IN('READY','RUNNING','WAITING_FOR_SOURCE','WAITING_FOR_AGENDA','REVIEW_REQUIRED','BUDGET_PAUSED') OR jsonb_typeof(p_plan->'cursor') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid automatic step' USING ERRCODE='22023';END IF;
 IF p_plan->>'action'='enqueue' THEN
  IF p.current_job_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ccee_integration_jobs WHERE id=p.current_job_id AND state IN('QUEUED','RUNNING')) OR p_plan->'body'->>'authorizationId' IS DISTINCT FROM p.authorization_id::text OR p.kind='MEASUREMENTS' AND p_plan->>'kind'<>'MEASUREMENTS' OR p.kind='DRI' AND p_plan->>'kind' NOT IN('DRI_EVENTS','DRI_REPORTS','DRI_RESULTS') THEN RAISE EXCEPTION 'Read-only policy selection changed' USING ERRCODE='42501';END IF;
  body:=p_plan->'body'||jsonb_build_object('requestId',gen_random_uuid());
  IF p.kind='MEASUREMENTS' THEN
   IF body->>'measurementKind'<>'FINAL' OR p.last_monthly_date=(now() AT TIME ZONE 'America/Sao_Paulo')::date AND p.cursor->>'month'=body->>'month' THEN RAISE EXCEPTION 'One monthly read per day' USING ERRCODE='22023';END IF;
   r:=public.ccee_data_action(p.organization_id,p.created_by,'enqueue',NULL,body);
  ELSE r:=public.ccee_dri_action(p.organization_id,p.created_by,'enqueue',p.authorization_id,body);END IF;
  UPDATE public.ccee_service_sync_policies SET current_job_id=(r->'job'->>'id')::uuid,cursor=p_plan->'cursor',state='RUNNING',last_attempt_at=now(),last_monthly_date=CASE WHEN p.kind='MEASUREMENTS' THEN(now() AT TIME ZONE 'America/Sao_Paulo')::date ELSE last_monthly_date END,next_run_at=now()+interval '30 seconds',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=p.id;
 ELSE
  IF coalesce((p_plan->>'success')::boolean,false) THEN SELECT * INTO j FROM public.ccee_integration_jobs WHERE id=p.current_job_id AND organization_id=p.organization_id AND authorization_id=p.authorization_id AND state='SUCCEEDED' AND result->'complete'='true'::jsonb;IF j.id IS NULL THEN RAISE EXCEPTION 'Complete source required' USING ERRCODE='42501';END IF;END IF;
  UPDATE public.ccee_service_sync_policies SET cursor=p_plan->'cursor',state=p_plan->>'state',enabled=coalesce((p_plan->>'enabled')::boolean,enabled),last_error=nullif(p_plan->>'error',''),current_job_id=CASE WHEN coalesce((p_plan->>'keepJob')::boolean,false) THEN current_job_id END,
   last_success_at=CASE WHEN coalesce((p_plan->>'success')::boolean,false) THEN now() ELSE last_success_at END,last_source_at=coalesce(nullif(p_plan->>'sourceAt','')::timestamptz,last_source_at),source_month=coalesce(p_plan->>'sourceMonth',source_month),
   next_run_at=CASE WHEN NOT coalesce((p_plan->>'enabled')::boolean,enabled) THEN NULL ELSE(p_plan->>'nextRunAt')::timestamptz END,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=p.id;
 END IF;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details) VALUES(p.organization_id,'system:ccee-auto','AUTOMATIC_POLICY_STEP',jsonb_build_object('policyId',p.id,'state',p_plan->>'state','kind',p_plan->>'kind','error',p_plan->>'error','sourceChanged',p.cursor->>'sourceHash' IS DISTINCT FROM p_plan#>>'{cursor,sourceHash}'));
 RETURN jsonb_build_object('recorded',true);
END$$;

CREATE FUNCTION public.ccee_communication_reserve(p_id uuid,p_lease uuid,p_market boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org text;requested_family text;v jsonb;s public.ccee_sync_schedules;total bigint;family_total bigint;day_start timestamptz;
BEGIN
 IF p_market THEN
  v:=public.ccee_market_assert(p_id,p_lease);org:=v->>'organizationId';SELECT * INTO s FROM public.ccee_sync_schedules WHERE id=p_id;requested_family:=CASE WHEN s.kind='PLD_HOURLY' THEN 'PLD' ELSE 'PRIVATE' END;
 ELSE
  v:=public.ccee_assert_reading(p_id,p_lease);org:=v->>'organization_id';requested_family:=CASE WHEN v->>'kind'='PLD' THEN 'PLD' WHEN v->>'kind' LIKE 'DRI_%' THEN 'DRI' ELSE 'PRIVATE' END;
 END IF;
 IF org IS DISTINCT FROM 'org_default' THEN RAISE EXCEPTION 'Automatic budget not configured' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-communication-budget:'||org,0));
 day_start:=date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
 WITH private_counts AS(
  SELECT CASE WHEN j.kind='PLD' THEN 'PLD' WHEN j.kind LIKE 'DRI_%' THEN 'DRI' ELSE 'PRIVATE' END AS family,greatest(CASE WHEN j.finished_at>=day_start THEN j.requests ELSE 0 END,(SELECT count(*) FROM public.ccee_integration_events e WHERE e.job_id=j.id AND e.organization_id=org AND e.event='COMMUNICATION_REQUEST_RESERVED' AND e.recorded_at>=day_start)) AS requests
  FROM public.ccee_integration_jobs j WHERE j.organization_id=org AND(j.finished_at>=day_start OR EXISTS(SELECT 1 FROM public.ccee_integration_events e WHERE e.job_id=j.id AND e.event='COMMUNICATION_REQUEST_RESERVED' AND e.recorded_at>=day_start))),
 market_counts AS(SELECT CASE WHEN sched.kind='PLD_HOURLY' THEN 'PLD' ELSE 'PRIVATE' END AS family,count(*) AS requests FROM public.ccee_integration_events e JOIN public.ccee_sync_schedules sched ON sched.id::text=e.details->>'scheduleId' AND sched.organization_id=e.organization_id WHERE e.organization_id=org AND e.event='MARKET_REQUEST_RESERVED' AND e.recorded_at>=day_start GROUP BY 1),
 counts AS(SELECT * FROM private_counts UNION ALL SELECT * FROM market_counts)
 SELECT coalesce(sum(requests),0),coalesce(sum(requests) FILTER(WHERE counts.family=requested_family),0) INTO total,family_total FROM counts;
 IF total>=200 OR family_total>=(CASE requested_family WHEN 'PLD' THEN 60 WHEN 'DRI' THEN 40 ELSE 100 END) THEN RAISE EXCEPTION 'COMMUNICATION_REQUEST_BUDGET_EXHAUSTED' USING ERRCODE='P0001';END IF;
 IF NOT p_market THEN INSERT INTO public.ccee_integration_events(organization_id,job_id,actor_id,event,details) VALUES(org,p_id,'system:ccee-auto','COMMUNICATION_REQUEST_RESERVED',jsonb_build_object('leaseId',p_lease,'family',requested_family));END IF;
 RETURN jsonb_build_object('reserved',true,'total',total+1,'limit',200);
END$$;

CREATE OR REPLACE FUNCTION public.ccee_market_reserve(p_id uuid,p_lease uuid,p_homologation_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.ccee_sync_schedules;daily integer;global_count integer;run_count integer;
BEGIN
 PERFORM public.ccee_market_assert(p_id,p_lease);SELECT * INTO s FROM public.ccee_sync_schedules WHERE id=p_id;
 IF s.organization_id='org_default' THEN PERFORM public.ccee_communication_reserve(p_id,p_lease,true);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-market-budget:'||s.organization_id,0));
 SELECT count(*) FILTER(WHERE recorded_at>=(date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')),count(*),count(*) FILTER(WHERE details->>'leaseId'=p_lease::text) INTO daily,global_count,run_count FROM public.ccee_integration_events WHERE organization_id=s.organization_id AND event='MARKET_REQUEST_RESERVED' AND(s.organization_id<>'org_default' OR details->>'scheduleId'=s.id::text);
 IF run_count>=s.max_requests OR daily>=s.daily_limit OR p_homologation_limit IS NOT NULL AND (p_homologation_limit NOT BETWEEN 1 AND 20 OR global_count>=p_homologation_limit) THEN RAISE EXCEPTION 'MARKET_REQUEST_BUDGET_EXHAUSTED' USING ERRCODE='P0001';END IF;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details) VALUES(s.organization_id,'system:ccee-hourly','MARKET_REQUEST_RESERVED',jsonb_build_object('scheduleId',s.id,'leaseId',p_lease,'authorizedBy',s.created_by));
 RETURN jsonb_build_object('reserved',true,'requests',run_count+1,'daily',daily+1,'homologationCount',global_count+1);
END$$;
DO $$DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('ccee_auto_policy_action','ccee_auto_claim','ccee_auto_advance','ccee_communication_reserve') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
