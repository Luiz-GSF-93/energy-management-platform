BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';

CREATE TABLE public.ccee_reference_tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 actor_id text NOT NULL,kind text NOT NULL CHECK(kind IN('BINDING_LOOKUP','PLD_MONTHLY')),unit_id text,
 month date,request_id uuid NOT NULL,context jsonb NOT NULL,input_hash text NOT NULL,
 state text NOT NULL DEFAULT 'RUNNING' CHECK(state IN('RUNNING','SUCCEEDED','FAILED','BUDGET_PAUSED','REVIEW_REQUIRED')),
 lease_id uuid NOT NULL DEFAULT gen_random_uuid(),lease_until timestamptz NOT NULL DEFAULT now()+interval '3 minutes',
 requests integer NOT NULL DEFAULT 0 CHECK(requests BETWEEN 0 AND 12),result jsonb,error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,retry_at timestamptz,
 UNIQUE(organization_id,request_id),CHECK(octet_length(context::text)<=64000),CHECK(result IS NULL OR octet_length(result::text)<=64000)
);
CREATE UNIQUE INDEX ccee_monthly_reference_unique ON public.ccee_reference_tasks(organization_id,month) WHERE kind='PLD_MONTHLY';
ALTER TABLE public.ccee_reference_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_reference_tasks FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ccee_binding_context(p_org text,p_actor text,p_unit text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb; prior jsonb; discovery jsonb; fingerprint text;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'manage');
 SELECT jsonb_build_object('organizationId',p_org,'unit',jsonb_build_object('id',u.id,'name',u.name,'installation',u.consumer_unit_number,'address',u.address),
 'customer',jsonb_build_object('id',c.id,'name',c.company_name,'document',c.document)) INTO ctx
 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id
 WHERE u.organization_id=p_org AND u.id=p_unit AND upper(u.status)='ACTIVE' AND c.deleted_at IS NULL;
 IF ctx IS NULL THEN RAISE EXCEPTION 'Unit outside active organization' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(a) INTO prior FROM public.ccee_unit_authorizations a WHERE a.organization_id=p_org AND a.customer_id=ctx#>>'{customer,id}' AND a.consumer_unit_id=p_unit ORDER BY a.revision DESC,a.id DESC LIMIT 1;
 SELECT jsonb_build_object('id',d.id,'state',d.state,'reason',d.reason,'updatedAt',d.updated_at,'participant',CASE WHEN d.state='REPRESENTATION_PENDING' AND d.result#>>'{participant,taxId}'=regexp_replace(ctx#>>'{customer,document}','[^0-9]','','g') AND d.result#>>'{participant,validFrom}' IS NOT NULL AND left(d.result#>>'{participant,validFrom}',10)<=(now() AT TIME ZONE 'America/Sao_Paulo')::date::text AND (d.result#>>'{participant,validTo}' IS NULL OR left(d.result#>>'{participant,validTo}',10)>=(now() AT TIME ZONE 'America/Sao_Paulo')::date::text) THEN d.result->'participant' ELSE NULL END) INTO discovery
 FROM public.ccee_customer_discovery d WHERE d.organization_id=p_org AND d.customer_id=ctx#>>'{customer,id}' AND d.tax_id=regexp_replace(ctx#>>'{customer,document}','[^0-9A-Za-z]','','g') ORDER BY d.created_at DESC,d.id DESC LIMIT 1;
 fingerprint:=md5(jsonb_build_array(ctx,prior,discovery)::text);
 RETURN ctx||jsonb_build_object('previousBinding',prior,'discovery',discovery,'inputHash',fingerprint);
END$$;

-- Uses the same organization/day lock as all existing SOAP consumers.
CREATE FUNCTION public.ccee_reference_usage(p_org text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE usage jsonb;
BEGIN
 usage:=public.ccee_operational_usage(p_org);
 RETURN jsonb_build_object('total',usage->'total','pld',usage->'PLD','private',usage->'PRIVATE');
END$$;

CREATE FUNCTION public.ccee_reference_task(p_org text,p_actor text,p_action text,p_id uuid,p_lease uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE task public.ccee_reference_tasks;ctx jsonb;usage jsonb;next_day timestamptz;item jsonb;expected integer;sourcehash text;
BEGIN
 IF p_action='lookup' THEN
  ctx:=public.ccee_binding_context(p_org,p_actor,p_body->>'unitId');
  IF coalesce(ctx#>>'{discovery,participant,agentCode}','')!~'^[0-9]{1,12}$' AND NOT(ctx#>>'{previousBinding,status}'='APPROVED' AND coalesce(ctx#>>'{previousBinding,dri_agent_code}','')~'^[0-9]{1,12}$') THEN RAISE EXCEPTION 'Participant not confirmed; review customer discovery first' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ccee-binding-lookup:'||p_org||':'||(p_body->>'unitId'),0));
  SELECT * INTO task FROM public.ccee_reference_tasks WHERE organization_id=p_org AND request_id=(p_body->>'requestId')::uuid;
  IF FOUND THEN
   IF task.actor_id<>p_actor OR task.unit_id IS DISTINCT FROM p_body->>'unitId' OR task.input_hash IS DISTINCT FROM ctx->>'inputHash' THEN RAISE EXCEPTION 'Lookup context changed' USING ERRCODE='40001'; END IF;
   IF task.context->>'selectedProfileCode' IS DISTINCT FROM p_body->>'profileCode' THEN RAISE EXCEPTION 'Changed profile selection' USING ERRCODE='40001'; END IF;
   RETURN to_jsonb(task)||jsonb_build_object('replayed',true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.ccee_reference_tasks WHERE organization_id=p_org AND unit_id=p_body->>'unitId' AND kind='BINDING_LOOKUP' AND state='RUNNING' AND lease_until>now()) THEN RAISE EXCEPTION 'Lookup already running' USING ERRCODE='40001'; END IF;
  INSERT INTO public.ccee_reference_tasks(organization_id,actor_id,kind,unit_id,request_id,context,input_hash) VALUES(p_org,p_actor,'BINDING_LOOKUP',p_body->>'unitId',(p_body->>'requestId')::uuid,ctx||jsonb_build_object('selectedProfileCode',p_body->>'profileCode'),ctx->>'inputHash') RETURNING * INTO task;
  RETURN to_jsonb(task);
 END IF;
 SELECT * INTO task FROM public.ccee_reference_tasks WHERE id=p_id AND organization_id=p_org AND lease_id=p_lease AND actor_id=p_actor FOR UPDATE;
 IF task.id IS NULL OR task.state<>'RUNNING' OR task.lease_until<=now() THEN RAISE EXCEPTION 'Reference lease changed' USING ERRCODE='40001'; END IF;
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'manage');
 IF task.kind='BINDING_LOOKUP' THEN
  ctx:=public.ccee_binding_context(p_org,p_actor,task.unit_id);
  IF task.input_hash IS DISTINCT FROM ctx->>'inputHash' THEN RAISE EXCEPTION 'Unit identity changed' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.ccee_sync_schedules s WHERE s.organization_id=p_org AND s.kind='PLD_HOURLY' AND s.enabled AND s.homologated AND s.state<>'BLOCKED' AND s.created_by=p_actor) OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management) THEN RAISE EXCEPTION 'Monthly reference policy changed' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_action='reserve' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('ccee-communication-budget:'||p_org,0));
  usage:=public.ccee_reference_usage(p_org);
  IF (usage->>'total')::bigint>=200 OR task.requests>=(CASE WHEN task.kind='PLD_MONTHLY' THEN 12 ELSE 6 END) OR task.kind='PLD_MONTHLY' AND (usage->>'pld')::bigint>=60 OR task.kind='BINDING_LOOKUP' AND (usage->>'private')::bigint>=100 OR task.kind='BINDING_LOOKUP' AND (SELECT coalesce(sum(requests),0) FROM public.ccee_reference_tasks WHERE organization_id=p_org AND kind='BINDING_LOOKUP' AND created_at>=date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')>=20 THEN RAISE EXCEPTION 'REFERENCE_REQUEST_BUDGET_EXHAUSTED' USING ERRCODE='P0001'; END IF;
  UPDATE public.ccee_reference_tasks SET requests=requests+1 WHERE id=task.id RETURNING * INTO task;
  INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details) VALUES(p_org,p_actor,'REFERENCE_REQUEST_RESERVED',jsonb_build_object('taskId',task.id,'family',CASE WHEN task.kind='PLD_MONTHLY' THEN 'PLD' ELSE 'PRIVATE' END));
  RETURN jsonb_build_object('reserved',true,'requests',task.requests);
 END IF;
 IF p_action<>'finish' OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>64000 THEN RAISE EXCEPTION 'Invalid reference result' USING ERRCODE='22023'; END IF;
 IF p_body->>'error' IS NOT NULL THEN
  IF p_body->>'error' !~ '^[A-Z0-9_]{3,80}$' THEN RAISE EXCEPTION 'Unsafe reference error' USING ERRCODE='22023'; END IF;
  next_day:=(date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo')+interval '1 day') AT TIME ZONE 'America/Sao_Paulo';
  UPDATE public.ccee_reference_tasks SET state=CASE WHEN p_body->>'error' LIKE '%BUDGET%' THEN 'BUDGET_PAUSED' WHEN p_body->>'error' IN('TIMEOUT','TRANSPORT_ERROR','CCEE_PREVIEW_UNAVAILABLE') THEN 'FAILED' ELSE 'REVIEW_REQUIRED' END,error_code=p_body->>'error',retry_at=next_day,finished_at=now() WHERE id=task.id;
 ELSE
  IF task.requests<1 OR jsonb_typeof(p_body->'result') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Reference has no provider source' USING ERRCODE='22023'; END IF;
  IF task.kind='PLD_MONTHLY' THEN
   expected:=extract(day FROM task.month+interval '1 month -1 day')::integer*24;
   IF p_body#>>'{result,organizationId}' IS DISTINCT FROM p_org OR p_body#>>'{result,provider}' IS DISTINCT FROM 'CCEE' OR p_body#>>'{result,source}' IS DISTINCT FROM 'https://servicos.ccee.org.br/ws/prec/PLDBSv1' OR p_body#>>'{result,method}' IS DISTINCT FROM 'HOURLY_ARITHMETIC_MEAN' OR p_body#>'{result,taxesIncluded}' IS DISTINCT FROM 'false'::jsonb OR jsonb_typeof(p_body#>'{result,months}') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body#>'{result,months}')<>4 OR (SELECT count(DISTINCT x->>'submarket') FROM jsonb_array_elements(p_body#>'{result,months}')x)<>4 OR jsonb_typeof(p_body#>'{result,sourceHashes}') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body#>'{result,sourceHashes}') NOT BETWEEN 1 AND 20 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_body#>'{result,sourceHashes}')h WHERE h!~'^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Invalid complete monthly source' USING ERRCODE='22023'; END IF;
   sourcehash:=encode(sha256(convert_to((p_body#>'{result,sourceHashes}')::text,'UTF8')),'hex');
   FOR item IN SELECT * FROM jsonb_array_elements(p_body#>'{result,months}') LOOP
    IF item->>'month' IS DISTINCT FROM to_char(task.month,'YYYY-MM') OR coalesce(item->>'hours','')<>expected::text OR coalesce(item->>'submarket','') NOT IN('SE_CO','S','NE','N') OR coalesce(item->>'meanBrlMwh','')!~'^[0-9]{1,8}(\.[0-9]{1,6})?$' THEN RAISE EXCEPTION 'Monthly coverage not complete' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.energy_price_pld_monthly WHERE organization_id=p_org AND month=task.month AND submarket=item->>'submarket' AND mean_brl_mwh<>(item->>'meanBrlMwh')::numeric) THEN RAISE EXCEPTION 'Published reference changed; explicit revision required' USING ERRCODE='40001'; END IF;
   END LOOP;
   INSERT INTO public.energy_price_pld_monthly(organization_id,month,submarket,mean_brl_mwh,source,source_hash,hours,published_at,provider)
   SELECT p_org,task.month,x->>'submarket',(x->>'meanBrlMwh')::numeric,'https://servicos.ccee.org.br/ws/prec/PLDBSv1',sourcehash,expected,now(),'CCEE' FROM jsonb_array_elements(p_body#>'{result,months}')x ON CONFLICT DO NOTHING;
  ELSE
   IF jsonb_typeof(p_body#>'{result,profiles}') IS DISTINCT FROM 'array' OR jsonb_typeof(p_body#>'{result,points}') IS DISTINCT FROM 'array' OR jsonb_typeof(p_body#>'{result,hashes}') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body#>'{result,hashes}') NOT BETWEEN 1 AND 6 OR jsonb_array_length(p_body#>'{result,profiles}')>20 OR jsonb_array_length(p_body#>'{result,points}')>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_body#>'{result,hashes}')h WHERE h!~'^[a-f0-9]{64}$') OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_body#>'{result,profiles}')p WHERE coalesce(p->>'code','')!~'^[0-9]{1,12}$' OR p->>'agentCode' IS DISTINCT FROM coalesce(task.context#>>'{discovery,participant,agentCode}',task.context#>>'{previousBinding,dri_agent_code}')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_body#>'{result,points}')p WHERE coalesce(p->>'code','')!~'^[-A-Za-z0-9_]{1,100}$' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_body#>'{result,profiles}')f WHERE f->>'code'=p->>'profileCode')) THEN RAISE EXCEPTION 'Invalid binding suggestion source' USING ERRCODE='22023'; END IF;
  END IF;
  UPDATE public.ccee_reference_tasks SET state='SUCCEEDED',result=p_body->'result',finished_at=now() WHERE id=task.id;
 END IF;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details) VALUES(p_org,p_actor,'REFERENCE_TASK_FINISHED',jsonb_build_object('taskId',task.id,'kind',task.kind,'unitId',task.unit_id,'month',task.month,'requests',task.requests,'error',p_body->>'error'));
 RETURN jsonb_build_object('organizationId',p_org,'stored',p_body->>'error' IS NULL,'taskId',task.id);
END$$;

CREATE FUNCTION public.ccee_monthly_reference_claim(p_org text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sched public.ccee_sync_schedules; target date; task public.ccee_reference_tasks;
BEGIN
 IF p_org IS DISTINCT FROM 'org_default' THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-monthly-reference:'||p_org,0));
 SELECT * INTO sched FROM public.ccee_sync_schedules WHERE organization_id=p_org AND kind='PLD_HOURLY' AND enabled AND homologated AND state<>'BLOCKED';
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM public.assert_ccee_data_actor(p_org,sched.created_by,'manage');
 IF NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management) THEN RETURN NULL; END IF;
 UPDATE public.ccee_reference_tasks SET state='REVIEW_REQUIRED',error_code='LEASE_EXPIRED',finished_at=now() WHERE organization_id=p_org AND kind='PLD_MONTHLY' AND state='RUNNING' AND lease_until<=now();
 IF EXISTS(SELECT 1 FROM public.ccee_reference_tasks WHERE organization_id=p_org AND kind='PLD_MONTHLY' AND state='RUNNING') THEN RETURN NULL; END IF;
 IF (public.ccee_reference_usage(p_org)->>'pld')::bigint>=60 THEN RETURN NULL; END IF;
 WITH months AS(SELECT generate_series(date_trunc('year',now() AT TIME ZONE 'America/Sao_Paulo'),date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')-interval '1 month',interval '1 month')::date AS month),candidates AS(
 SELECT m.month,EXISTS(SELECT 1 FROM public.eva_closing_publications p WHERE p.organization_id=p_org AND p.projection->>'month'=to_char(m.month,'YYYY-MM')) AS published FROM months m
 WHERE (SELECT count(*) FROM public.energy_price_pld_monthly WHERE organization_id=p_org AND month=m.month)<4
 AND NOT EXISTS(SELECT 1 FROM public.ccee_reference_tasks t WHERE t.organization_id=p_org AND t.kind='PLD_MONTHLY' AND t.month=m.month AND (t.state NOT IN('FAILED','BUDGET_PAUSED') OR t.retry_at>now())))
 SELECT month INTO target FROM candidates ORDER BY published DESC,month DESC LIMIT 1;
 IF target IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.ccee_reference_tasks(organization_id,actor_id,kind,month,request_id,context,input_hash) VALUES(p_org,sched.created_by,'PLD_MONTHLY',target,gen_random_uuid(),jsonb_build_object('scheduleId',sched.id,'month',to_char(target,'YYYY-MM')),md5(jsonb_build_array(sched.id,target)::text))
 ON CONFLICT(organization_id,month) WHERE kind='PLD_MONTHLY' DO UPDATE SET actor_id=excluded.actor_id,state='RUNNING',lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',requests=0,created_at=now(),finished_at=NULL,error_code=NULL,retry_at=NULL RETURNING * INTO task;
 RETURN to_jsonb(task);
END$$;

-- Make the existing consumers account for these reservations as well.
DO $$DECLARE source text;marker text;replacement text;BEGIN
 source:=pg_get_functiondef('public.ccee_operational_usage(text)'::regprocedure);
 marker:='AND e.event=''CUSTOMER_DISCOVERY_REQUEST_RESERVED'' AND e.recorded_at>=w.start)';
 replacement:='AND e.event=''CUSTOMER_DISCOVERY_REQUEST_RESERVED'' AND e.recorded_at>=w.start UNION ALL SELECT e.details->>''family'',count(*) FROM public.ccee_integration_events e CROSS JOIN usage_window w WHERE e.organization_id=p_org AND e.event=''REFERENCE_REQUEST_RESERVED'' AND e.recorded_at>=w.start GROUP BY e.details->>''family'')';
 IF position(marker in source)=0 THEN RAISE EXCEPTION 'Shared budget source changed'; END IF;
 EXECUTE replace(source,marker,replacement);
END$$;
REVOKE ALL ON FUNCTION public.ccee_binding_context(text,text,text),public.ccee_reference_usage(text),public.ccee_reference_task(text,text,text,uuid,uuid,jsonb),public.ccee_monthly_reference_claim(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ccee_binding_context(text,text,text),public.ccee_reference_task(text,text,text,uuid,uuid,jsonb),public.ccee_monthly_reference_claim(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
