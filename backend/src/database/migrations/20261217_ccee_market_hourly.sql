BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.ccee_price_observations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,submarket text NOT NULL CHECK(submarket IN('SE_CO','S','NE','N')),
 value_brl_mwh numeric(14,6) NOT NULL CHECK(value_brl_mwh>=0),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 source text NOT NULL DEFAULT 'https://servicos.ccee.org.br/ws/prec/PLDBSv1',retrieved_at timestamptz NOT NULL DEFAULT now(),
 CHECK(period_end-period_start=interval '1 hour'),UNIQUE(organization_id,period_start,submarket,source_hash)
);
CREATE INDEX ccee_price_scope_time ON public.ccee_price_observations(organization_id,period_start,submarket,retrieved_at DESC);
CREATE TABLE public.ccee_measurement_intervals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),authorization_id uuid NOT NULL REFERENCES public.ccee_unit_authorizations(id),
 customer_id text NOT NULL,consumer_unit_id text NOT NULL,meter text NOT NULL,ends_at timestamptz NOT NULL,energy_type text NOT NULL,
 active_consumption_kwh numeric(24,6),active_generation_kwh numeric(24,6),reactive_consumption_kvarh numeric(24,6),reactive_generation_kvarh numeric(24,6),
 collection text,source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),retrieved_at timestamptz NOT NULL DEFAULT now(),
 CHECK(coalesce(active_consumption_kwh,0)>=0 AND coalesce(active_generation_kwh,0)>=0 AND coalesce(reactive_consumption_kvarh,0)>=0 AND coalesce(reactive_generation_kvarh,0)>=0),
 UNIQUE(organization_id,authorization_id,meter,ends_at,energy_type,source_hash)
);
CREATE INDEX ccee_intervals_scope_time ON public.ccee_measurement_intervals(organization_id,authorization_id,ends_at,retrieved_at DESC);
CREATE TABLE public.ccee_sync_schedules(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),created_by text NOT NULL,
 kind text NOT NULL CHECK(kind IN('PLD_HOURLY','MEASUREMENTS_5M')),authorization_id uuid REFERENCES public.ccee_unit_authorizations(id),
 enabled boolean NOT NULL DEFAULT false,state text NOT NULL DEFAULT 'PAUSED' CHECK(state IN('PAUSED','READY','RUNNING','SUCCEEDED','PARTIAL','FAILED','BLOCKED')),
 frequency_seconds integer NOT NULL DEFAULT 3600 CHECK(frequency_seconds=3600),day_offset integer NOT NULL DEFAULT 0 CHECK(day_offset BETWEEN -3 AND 0),
 max_requests integer NOT NULL DEFAULT 6 CHECK(max_requests BETWEEN 2 AND 10),daily_limit integer NOT NULL DEFAULT 60 CHECK(daily_limit BETWEEN 2 AND 1000),
 manual_day date,next_run_at timestamptz,last_attempt_at timestamptz,last_success_at timestamptz,last_source_at timestamptz,
 last_error text,failure_count integer NOT NULL DEFAULT 0,homologated boolean NOT NULL DEFAULT false,lease_id uuid,lease_until timestamptz,current_day date,
 last_result jsonb,updated_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,
 UNIQUE(organization_id,request_id),CHECK((kind='PLD_HOURLY' AND authorization_id IS NULL) OR(kind='MEASUREMENTS_5M' AND authorization_id IS NOT NULL))
);
CREATE INDEX ccee_schedule_due ON public.ccee_sync_schedules(organization_id,next_run_at) WHERE enabled OR manual_day IS NOT NULL;
CREATE UNIQUE INDEX ccee_schedule_pld_unique ON public.ccee_sync_schedules(organization_id,kind) WHERE kind='PLD_HOURLY';
CREATE UNIQUE INDEX ccee_schedule_meter_unique ON public.ccee_sync_schedules(organization_id,authorization_id,kind) WHERE kind='MEASUREMENTS_5M';
ALTER TABLE public.ccee_price_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ccee_measurement_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ccee_sync_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_price_observations,public.ccee_measurement_intervals,public.ccee_sync_schedules FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ccee_prices_preserve BEFORE UPDATE OR DELETE ON public.ccee_price_observations FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER ccee_intervals_preserve BEFORE UPDATE OR DELETE ON public.ccee_measurement_intervals FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();

CREATE FUNCTION public.ccee_market_read(p_org text,p_actor text,p_query jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE first_day date;last_day date;grain text;filter_origin text;pg integer;rows jsonb;trend jsonb;total bigint;series jsonb;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'view');
 IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR p_query-ARRAY['from','to','granularity','origin','submarkets','page']<>'{}' THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023';END IF;
 first_day:=(p_query->>'from')::date;last_day:=(p_query->>'to')::date;grain:=p_query->>'granularity';filter_origin:=p_query->>'origin';pg:=(p_query->>'page')::integer;
 IF first_day IS NULL OR last_day IS NULL OR first_day<'2021-01-01' OR first_day>last_day OR last_day-first_day>731 OR grain NOT IN('MONTH','DAY','HOUR') OR grain='HOUR' AND last_day-first_day>31 OR filter_origin NOT IN('ALL','SOAP','OFFICIAL_MONTHLY') OR pg IS NULL OR pg<0 OR pg>10000
 OR jsonb_typeof(p_query->'submarkets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_query->'submarkets') NOT BETWEEN 1 AND 4 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_query->'submarkets')x WHERE x NOT IN('SE_CO','S','NE','N')) THEN RAISE EXCEPTION 'Invalid range' USING ERRCODE='22023';END IF;
 WITH latest AS(SELECT DISTINCT ON(period_start,submarket) * FROM public.ccee_price_observations WHERE organization_id=p_org AND period_start>=first_day::timestamp AT TIME ZONE 'America/Sao_Paulo' AND period_start<(last_day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo' ORDER BY period_start,submarket,retrieved_at DESC,id DESC),
 normalized AS(
 SELECT date_trunc(lower(grain),period_start AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS at,submarket,avg(value_brl_mwh) AS value,count(*) AS hours,max(retrieved_at) AS updated,'SOAP' AS origin,
 'https://servicos.ccee.org.br/ws/prec/PLDBSv1' AS source,encode(sha256(convert_to(string_agg(source_hash,'' ORDER BY period_start),'UTF8')),'hex') AS hash
 FROM latest WHERE filter_origin<>'OFFICIAL_MONTHLY' AND p_query->'submarkets'?submarket GROUP BY 1,2
 UNION ALL SELECT month::timestamp AT TIME ZONE 'America/Sao_Paulo',submarket,mean_brl_mwh,hours,published_at,'OFFICIAL_MONTHLY',source,source_hash FROM public.energy_price_pld_monthly WHERE organization_id=p_org AND grain='MONTH' AND filter_origin<>'SOAP' AND month BETWEEN date_trunc('month',first_day)::date AND date_trunc('month',last_day)::date AND p_query->'submarkets'?submarket),
 preferred AS(SELECT DISTINCT ON(at,submarket) * FROM normalized ORDER BY at,submarket,CASE WHEN origin='OFFICIAL_MONTHLY' THEN 0 ELSE 1 END)
 SELECT count(*),coalesce(jsonb_agg(jsonb_build_object('at',at,'submarket',submarket,'value',value::numeric(14,6)::text,'hours',hours,'updatedAt',updated,'origin',origin,'source',source,'hash',hash) ORDER BY at,submarket),'[]') INTO total,series FROM preferred;
 SELECT coalesce(jsonb_agg(x),'[]') INTO rows FROM(SELECT value AS x FROM jsonb_array_elements(series) WITH ORDINALITY r(value,n) WHERE n>pg*100 AND n<=pg*100+100 ORDER BY n)t;
 WITH latest AS(SELECT DISTINCT ON(period_start,submarket) period_start,submarket,value_brl_mwh FROM public.ccee_price_observations WHERE organization_id=p_org AND period_start>=(last_day-730)::timestamp AT TIME ZONE 'America/Sao_Paulo' AND period_start<(last_day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo' ORDER BY period_start,submarket,retrieved_at DESC,id DESC)
 SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'submarket',submarket,'value',value::numeric(14,6)::text,'hours',hours) ORDER BY day,submarket),'[]') INTO trend FROM(SELECT (period_start AT TIME ZONE 'America/Sao_Paulo')::date AS day,submarket,avg(value_brl_mwh) AS value,count(*) AS hours FROM latest GROUP BY 1,2)t;
 RETURN jsonb_build_object('organizationId',p_org,'query',p_query,'rows',rows,'series',series,'total',total,'page',pg,'dailyHistory',trend,
 'schedules',(SELECT coalesce(jsonb_agg(to_jsonb(s)-ARRAY['lease_id','lease_until','request_id','created_by','last_result'] ORDER BY s.updated_at DESC),'[]') FROM public.ccee_sync_schedules s WHERE organization_id=p_org),
 'lastReferenceAt',(SELECT max(published_at) FROM public.energy_price_pld_monthly WHERE organization_id=p_org),
 'requestUsage',(SELECT jsonb_build_object('total',count(*),'today',count(*) FILTER(WHERE recorded_at>=(date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'))) FROM public.ccee_integration_events WHERE organization_id=p_org AND event='MARKET_REQUEST_RESERVED'),
 'latestJobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'state',state,'month',month,'finishedAt',finished_at,'error',error_code)),'[]') FROM(SELECT * FROM public.ccee_integration_jobs WHERE organization_id=p_org ORDER BY created_at DESC LIMIT 20)j));
END$$;

CREATE FUNCTION public.ccee_market_schedule(p_org text,p_actor text,p_id uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.ccee_sync_schedules;a jsonb;action text;target date;next_enabled boolean;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'manage');action:=p_body->>'action';
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR p_body-ARRAY['action','requestId','kind','authorizationId','maxRequests','dailyLimit','dayOffset','reason','day','enabled']<>'{}' OR action NOT IN('configure','collect','toggle') OR length(coalesce(p_body->>'reason','')) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Invalid schedule command' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-market:'||p_org,0));
 IF action='configure' THEN
  IF p_id IS NOT NULL OR p_body->>'kind' NOT IN('PLD_HOURLY','MEASUREMENTS_5M') OR nullif(p_body->>'requestId','') IS NULL OR coalesce((p_body->>'enabled')::boolean,false) THEN RAISE EXCEPTION 'Initial schedule must remain paused' USING ERRCODE='22023';END IF;
  IF p_body->>'kind'='MEASUREMENTS_5M' THEN a:=public.assert_ccee_data_binding(p_org,(p_body->>'authorizationId')::uuid,date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')::date,'MEASUREMENTS');IF nullif(a->>'meter_code','') IS NULL THEN RAISE EXCEPTION 'Meter required' USING ERRCODE='22023';END IF;END IF;
  SELECT * INTO s FROM public.ccee_sync_schedules WHERE organization_id=p_org AND (request_id=(p_body->>'requestId')::uuid OR kind=p_body->>'kind' AND (kind='PLD_HOURLY' OR authorization_id=(p_body->>'authorizationId')::uuid));
  IF FOUND THEN IF s.max_requests IS DISTINCT FROM (p_body->>'maxRequests')::integer OR s.daily_limit IS DISTINCT FROM (p_body->>'dailyLimit')::integer OR s.day_offset IS DISTINCT FROM (p_body->>'dayOffset')::integer THEN RAISE EXCEPTION 'Existing configuration differs; preserve its audit trail' USING ERRCODE='22023';END IF;RETURN jsonb_build_object('organizationId',p_org,'id',s.id,'replayed',true);END IF;
  INSERT INTO public.ccee_sync_schedules(organization_id,created_by,kind,authorization_id,max_requests,daily_limit,day_offset,request_id) VALUES(p_org,p_actor,p_body->>'kind',(p_body->>'authorizationId')::uuid,(p_body->>'maxRequests')::integer,(p_body->>'dailyLimit')::integer,(p_body->>'dayOffset')::integer,(p_body->>'requestId')::uuid) RETURNING * INTO s;
 ELSE
  SELECT * INTO s FROM public.ccee_sync_schedules WHERE organization_id=p_org AND id=p_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Schedule unavailable' USING ERRCODE='42501';END IF;
  IF s.state='RUNNING' THEN RAISE EXCEPTION 'Reading in progress; reconcile before retry' USING ERRCODE='40001';END IF;
  IF action='collect' THEN
   target:=(p_body->>'day')::date;IF target<'2021-01-01' OR target>(now() AT TIME ZONE 'America/Sao_Paulo')::date OR target IS NULL THEN RAISE EXCEPTION 'Invalid day' USING ERRCODE='22023';END IF;
   IF s.kind='MEASUREMENTS_5M' THEN PERFORM public.assert_ccee_data_binding(p_org,s.authorization_id,date_trunc('month',target)::date,'MEASUREMENTS');END IF;
   UPDATE public.ccee_sync_schedules SET manual_day=target,state='READY',last_error=NULL,updated_at=now() WHERE id=s.id;
  ELSE
   next_enabled:=(p_body->>'enabled')::boolean;IF next_enabled IS NULL OR next_enabled AND NOT s.homologated THEN RAISE EXCEPTION 'A complete observed response is required before hourly activation' USING ERRCODE='22023';END IF;
   UPDATE public.ccee_sync_schedules SET enabled=next_enabled,state=CASE WHEN next_enabled THEN 'READY' ELSE 'PAUSED' END,next_run_at=CASE WHEN next_enabled THEN date_trunc('hour',now())+interval '1 hour' ELSE NULL END,manual_day=NULL,updated_at=now() WHERE id=s.id;
  END IF;
 END IF;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details) VALUES(p_org,p_actor,'MARKET_SCHEDULE_'||upper(action),NULL,jsonb_build_object('scheduleId',s.id,'reason',p_body->>'reason','frequencySeconds',3600));
 RETURN jsonb_build_object('organizationId',p_org,'id',s.id);
END$$;

CREATE FUNCTION public.ccee_market_assert(p_id uuid,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.ccee_sync_schedules;a jsonb;
BEGIN
 SELECT * INTO s FROM public.ccee_sync_schedules WHERE id=p_id AND lease_id=p_lease AND lease_until>now() AND state='RUNNING';IF NOT FOUND THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='42501';END IF;
 PERFORM public.assert_ccee_data_actor(s.organization_id,s.created_by,'manage');
 IF s.kind='MEASUREMENTS_5M' THEN a:=public.assert_ccee_data_binding(s.organization_id,s.authorization_id,date_trunc('month',s.current_day)::date,'MEASUREMENTS');IF nullif(a->>'meter_code','') IS NULL THEN RAISE EXCEPTION 'Meter required' USING ERRCODE='42501';END IF;END IF;
 RETURN jsonb_build_object('organizationId',s.organization_id,'id',s.id,'leaseId',s.lease_id,'kind',s.kind,'day',s.current_day,'binding',a,'maxRequests',s.max_requests);
END$$;

CREATE FUNCTION public.ccee_market_claim(p_org text,p_private boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.ccee_sync_schedules;
BEGIN
 UPDATE public.ccee_sync_schedules SET state='BLOCKED',enabled=false,next_run_at=NULL,last_error='LEASE_EXPIRED_REQUIRES_REVIEW',lease_id=NULL,lease_until=NULL WHERE organization_id=p_org AND state='RUNNING' AND lease_until<=now();
 SELECT * INTO s FROM public.ccee_sync_schedules WHERE organization_id=p_org AND state<>'RUNNING' AND (kind='PLD_HOURLY' OR p_private) AND (manual_day IS NOT NULL OR enabled AND next_run_at<=now()) ORDER BY coalesce(next_run_at,updated_at),id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE public.ccee_sync_schedules SET state='RUNNING',lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',current_day=coalesce(manual_day,(now() AT TIME ZONE 'America/Sao_Paulo')::date+day_offset),manual_day=NULL,last_attempt_at=now(),updated_at=now() WHERE id=s.id RETURNING * INTO s;
 BEGIN RETURN public.ccee_market_assert(s.id,s.lease_id);EXCEPTION WHEN insufficient_privilege THEN UPDATE public.ccee_sync_schedules SET state='BLOCKED',enabled=false,next_run_at=NULL,lease_id=NULL,lease_until=NULL,last_error='ACCESS_CHANGED' WHERE id=s.id;RETURN NULL;END;
END$$;

CREATE FUNCTION public.ccee_market_reserve(p_id uuid,p_lease uuid,p_homologation_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.ccee_sync_schedules;daily integer;global_count integer;run_count integer;
BEGIN
 PERFORM public.ccee_market_assert(p_id,p_lease);SELECT * INTO s FROM public.ccee_sync_schedules WHERE id=p_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-market-budget:'||s.organization_id,0));
 SELECT count(*) FILTER(WHERE recorded_at>=(date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')),count(*),count(*) FILTER(WHERE details->>'leaseId'=p_lease::text) INTO daily,global_count,run_count FROM public.ccee_integration_events WHERE organization_id=s.organization_id AND event='MARKET_REQUEST_RESERVED';
 IF run_count>=s.max_requests OR daily>=s.daily_limit OR p_homologation_limit IS NOT NULL AND (p_homologation_limit NOT BETWEEN 1 AND 20 OR global_count>=p_homologation_limit) THEN RAISE EXCEPTION 'MARKET_REQUEST_BUDGET_EXHAUSTED' USING ERRCODE='P0001';END IF;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details) VALUES(s.organization_id,'system:ccee-hourly','MARKET_REQUEST_RESERVED',jsonb_build_object('scheduleId',s.id,'leaseId',p_lease,'authorizedBy',s.created_by));
 RETURN jsonb_build_object('reserved',true,'requests',run_count+1,'daily',daily+1,'homologationCount',global_count+1);
END$$;

CREATE FUNCTION public.ccee_market_finish(p_id uuid,p_lease uuid,p_result jsonb,p_error text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.ccee_sync_schedules;a jsonb;r jsonb;fingerprint text;source_at timestamptz;count_rows integer;run_count integer;safe_error text;
BEGIN
 SELECT * INTO s FROM public.ccee_sync_schedules WHERE id=p_id AND lease_id=p_lease AND state='RUNNING' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Lease changed' USING ERRCODE='40001';END IF;
 safe_error:=CASE WHEN p_error~'^[A-Z0-9_]{3,80}$' THEN p_error WHEN p_error IS NULL THEN NULL ELSE 'READ_NOT_CONFIRMED' END;
 BEGIN a:=public.ccee_market_assert(p_id,p_lease);EXCEPTION WHEN insufficient_privilege THEN safe_error:='ACCESS_CHANGED';END;
 SELECT count(*) INTO run_count FROM public.ccee_integration_events WHERE organization_id=s.organization_id AND event='MARKET_REQUEST_RESERVED' AND details->>'leaseId'=p_lease::text;
 IF safe_error IS NULL THEN
  IF p_result IS NULL OR octet_length(p_result::text)>2097152 OR p_result->>'kind' IS DISTINCT FROM s.kind OR p_result->>'day' IS DISTINCT FROM s.current_day::text OR coalesce(p_result->>'sourceHash','')!~'^[a-f0-9]{64}$' OR jsonb_typeof(p_result->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'rows')>2000 THEN RAISE EXCEPTION 'Invalid normalized reading' USING ERRCODE='22023';END IF;
  fingerprint:=p_result->>'sourceHash';count_rows:=jsonb_array_length(p_result->'rows');
  FOR r IN SELECT value FROM jsonb_array_elements(p_result->'rows') LOOP
   IF s.kind='PLD_HOURLY' THEN
    IF r->>'submarket' NOT IN('SE_CO','S','NE','N') OR coalesce(r->>'value','')!~'^[0-9]{1,8}(\.[0-9]{1,6})?$' OR (r->>'start')::timestamptz<s.current_day::timestamp AT TIME ZONE 'America/Sao_Paulo' OR (r->>'start')::timestamptz>=(s.current_day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo' THEN RAISE EXCEPTION 'Invalid price interval' USING ERRCODE='22023';END IF;
    INSERT INTO public.ccee_price_observations(organization_id,period_start,period_end,submarket,value_brl_mwh,source_hash) VALUES(s.organization_id,(r->>'start')::timestamptz,(r->>'end')::timestamptz,r->>'submarket',(r->>'value')::numeric,fingerprint) ON CONFLICT DO NOTHING;
    source_at:=greatest(source_at,(r->>'end')::timestamptz);
   ELSE
    IF r->>'meter' IS DISTINCT FROM a#>>'{binding,meter_code}' OR (r->>'at')::timestamptz<=s.current_day::timestamp AT TIME ZONE 'America/Sao_Paulo' OR (r->>'at')::timestamptz>(s.current_day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo' OR mod(extract(epoch FROM (r->>'at')::timestamptz)::bigint,300)<>0 THEN RAISE EXCEPTION 'Invalid measurement interval' USING ERRCODE='22023';END IF;
    INSERT INTO public.ccee_measurement_intervals(organization_id,authorization_id,customer_id,consumer_unit_id,meter,ends_at,energy_type,active_consumption_kwh,active_generation_kwh,reactive_consumption_kvarh,reactive_generation_kvarh,collection,source_hash) VALUES(s.organization_id,s.authorization_id,a#>>'{binding,customer_id}',a#>>'{binding,consumer_unit_id}',r->>'meter',(r->>'at')::timestamptz,r->>'energyType',(r->>'activeConsumptionKwh')::numeric,(r->>'activeGenerationKwh')::numeric,(r->>'reactiveConsumptionKvarh')::numeric,(r->>'reactiveGenerationKvarh')::numeric,r->>'collection',fingerprint) ON CONFLICT DO NOTHING;
    source_at:=greatest(source_at,(r->>'at')::timestamptz);
   END IF;
  END LOOP;
  -- Only a closed month with every actual hourly observation can supply a new
  -- dashboard reference. Existing published references are never overwritten.
  IF s.kind='PLD_HOURLY' AND date_trunc('month',s.current_day)<date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') THEN
   WITH latest AS(SELECT DISTINCT ON(period_start,submarket) * FROM public.ccee_price_observations WHERE organization_id=s.organization_id AND period_start>=date_trunc('month',s.current_day::timestamp) AT TIME ZONE 'America/Sao_Paulo' AND period_start<(date_trunc('month',s.current_day::timestamp)+interval '1 month') AT TIME ZONE 'America/Sao_Paulo' ORDER BY period_start,submarket,retrieved_at DESC,id DESC),
   full_month AS(SELECT submarket,avg(value_brl_mwh) AS mean,count(*) AS hours,encode(sha256(convert_to(string_agg(source_hash,'' ORDER BY period_start),'UTF8')),'hex') AS hash FROM latest GROUP BY submarket HAVING count(*)=extract(day FROM date_trunc('month',s.current_day::timestamp)+interval '1 month -1 day')*24)
   INSERT INTO public.energy_price_pld_monthly(organization_id,month,submarket,mean_brl_mwh,source,source_hash,hours,published_at,provider)
   SELECT s.organization_id,date_trunc('month',s.current_day)::date,submarket,mean,'https://servicos.ccee.org.br/ws/prec/PLDBSv1',hash,hours,now(),'CCEE' FROM full_month ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 UPDATE public.ccee_sync_schedules SET state=CASE WHEN safe_error IN('ACCESS_CHANGED','BUDGET_EXHAUSTED','FUNCTION_DISABLED') OR safe_error IS NOT NULL AND failure_count>=2 THEN 'BLOCKED' WHEN safe_error IS NOT NULL THEN 'FAILED' WHEN coalesce((p_result->>'complete')::boolean,false) THEN 'SUCCEEDED' ELSE 'PARTIAL' END,
 enabled=CASE WHEN safe_error IN('ACCESS_CHANGED','BUDGET_EXHAUSTED','FUNCTION_DISABLED') OR safe_error IS NOT NULL AND failure_count>=2 THEN false ELSE enabled END,
 next_run_at=CASE WHEN enabled AND (safe_error IS NULL OR safe_error NOT IN('ACCESS_CHANGED','BUDGET_EXHAUSTED','FUNCTION_DISABLED') AND failure_count<2) THEN date_trunc('hour',now())+interval '1 hour' ELSE NULL END,
 failure_count=CASE WHEN safe_error IS NULL THEN 0 ELSE failure_count+1 END,
 last_success_at=CASE WHEN safe_error IS NULL THEN now() ELSE last_success_at END,last_source_at=CASE WHEN safe_error IS NULL THEN source_at ELSE last_source_at END,last_error=safe_error,
 homologated=homologated OR safe_error IS NULL AND count_rows>0 AND coalesce((p_result->>'complete')::boolean,false),last_result=jsonb_build_object('requests',run_count,'rows',count_rows,'hash',fingerprint,'sourceHashes',p_result->'hashes','transactions',p_result->'transactions'),lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=s.id;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details) VALUES(s.organization_id,'system:ccee-hourly',CASE WHEN safe_error IS NULL THEN 'MARKET_COLLECTED' ELSE 'MARKET_FAILED' END,jsonb_build_object('scheduleId',s.id,'requests',run_count,'rows',count_rows,'hash',fingerprint,'error',safe_error,'authorizedBy',s.created_by));
 RETURN jsonb_build_object('organizationId',s.organization_id,'stored',safe_error IS NULL,'requests',run_count);
END$$;

CREATE FUNCTION public.ccee_market_measurements(p_org text,p_actor text,p_binding uuid,p_from date,p_to date,p_page integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows jsonb;total bigint;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'view');IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>7 OR p_page IS NULL OR p_page<0 OR p_page>10000 THEN RAISE EXCEPTION 'Bounded measurement range required' USING ERRCODE='22023';END IF;
 PERFORM public.assert_ccee_data_binding(p_org,p_binding,date_trunc('month',p_from)::date,'MEASUREMENTS');PERFORM public.assert_ccee_data_binding(p_org,p_binding,date_trunc('month',p_to)::date,'MEASUREMENTS');
 WITH current AS(SELECT DISTINCT ON(ends_at,meter,energy_type) * FROM public.ccee_measurement_intervals WHERE organization_id=p_org AND authorization_id=p_binding AND ends_at>p_from::timestamp AT TIME ZONE 'America/Sao_Paulo' AND ends_at<=(p_to+1)::timestamp AT TIME ZONE 'America/Sao_Paulo' ORDER BY ends_at,meter,energy_type,retrieved_at DESC,id DESC)
 SELECT count(*),coalesce(jsonb_agg(to_jsonb(current)-ARRAY['organization_id','customer_id','consumer_unit_id'] ORDER BY ends_at,meter,energy_type),'[]') INTO total,rows FROM current;
 SELECT coalesce(jsonb_agg(value ORDER BY n),'[]') INTO rows FROM jsonb_array_elements(rows) WITH ORDINALITY t(value,n) WHERE n>p_page*100 AND n<=p_page*100+100;
 RETURN jsonb_build_object('organizationId',p_org,'rows',rows,'total',total,'page',p_page);
END$$;

REVOKE ALL ON FUNCTION public.ccee_market_read(text,text,jsonb),public.ccee_market_schedule(text,text,uuid,jsonb),public.ccee_market_assert(uuid,uuid),public.ccee_market_claim(text,boolean),public.ccee_market_reserve(uuid,uuid,integer),public.ccee_market_finish(uuid,uuid,jsonb,text),public.ccee_market_measurements(text,text,uuid,date,date,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ccee_market_read(text,text,jsonb),public.ccee_market_schedule(text,text,uuid,jsonb),public.ccee_market_assert(uuid,uuid),public.ccee_market_claim(text,boolean),public.ccee_market_reserve(uuid,uuid,integer),public.ccee_market_finish(uuid,uuid,jsonb,text),public.ccee_market_measurements(text,text,uuid,date,date,integer) TO service_role;
COMMIT;
