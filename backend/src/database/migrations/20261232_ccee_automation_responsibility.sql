BEGIN;
ALTER TABLE public.ccee_sync_schedules ADD COLUMN execution_actor_id text;
ALTER TABLE public.ccee_service_sync_policies ADD COLUMN execution_actor_id text;
CREATE FUNCTION public.ccee_permanent_automation_actor(p_org text,p_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND r.name IN('admin_org','gestor','operacional') AND r.permissions?'f5364101-4486-42c2-a90f-807937ac3011' AND r.permissions?'f5364101-4486-42c2-a90f-807937ac3012') THEN RAISE EXCEPTION 'Active organization operator required; a temporary platform session cannot own automation' USING ERRCODE='42501';END IF;
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'manage');
END$$;
CREATE FUNCTION public.ccee_automation_takeover(p_org text,p_actor text,p_reason text,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;fingerprint text;
BEGIN
 PERFORM public.ccee_permanent_automation_actor(p_org,p_actor);
 IF p_org<>'org_default' OR p_request IS NULL OR length(coalesce(p_reason,'')) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Invalid automation responsibility' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-owner:'||p_org,0));fingerprint:=md5(p_org||p_actor||p_reason);
 SELECT details INTO r FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF r->>'fingerprint' IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Changed request' USING ERRCODE='40001';END IF;RETURN r;END IF;
 IF EXISTS(SELECT 1 FROM public.ccee_sync_schedules WHERE organization_id=p_org AND state='RUNNING') OR EXISTS(SELECT 1 FROM public.ccee_service_sync_policies WHERE organization_id=p_org AND (lease_until>now() OR current_job_id IS NOT NULL)) THEN RAISE EXCEPTION 'Wait for current collection to finish' USING ERRCODE='40001';END IF;
 UPDATE public.ccee_sync_schedules SET execution_actor_id=p_actor,updated_at=now() WHERE organization_id=p_org;
 UPDATE public.ccee_service_sync_policies SET execution_actor_id=p_actor,revision=revision+1,updated_at=now() WHERE organization_id=p_org AND kind<>'UNIT_BASIS';
 r:=jsonb_build_object('organizationId',p_org,'actorId',p_actor,'fingerprint',fingerprint,'reason',p_reason,'enabledChanged',false);
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details)VALUES(p_org,p_actor,'AUTOMATION_RESPONSIBILITY_CONFIRMED',p_request,r);RETURN r;
END$$;
CREATE OR REPLACE FUNCTION public.ccee_market_assert(p_id uuid,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.ccee_sync_schedules;a jsonb;
BEGIN
 SELECT * INTO s FROM public.ccee_sync_schedules WHERE id=p_id AND lease_id=p_lease AND lease_until>now() AND state='RUNNING';IF NOT FOUND THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='42501';END IF;
 IF s.execution_actor_id IS NOT NULL THEN PERFORM public.ccee_permanent_automation_actor(s.organization_id,s.execution_actor_id);END IF;
 PERFORM public.assert_ccee_data_actor(s.organization_id,coalesce(s.execution_actor_id,s.created_by),'manage');
 IF s.kind='MEASUREMENTS_5M' THEN a:=public.assert_ccee_data_binding(s.organization_id,s.authorization_id,date_trunc('month',s.current_day)::date,'MEASUREMENTS');IF nullif(a->>'meter_code','') IS NULL THEN RAISE EXCEPTION 'Meter required' USING ERRCODE='42501';END IF;END IF;
 RETURN jsonb_build_object('organizationId',s.organization_id,'id',s.id,'leaseId',s.lease_id,'kind',s.kind,'day',s.current_day,'binding',a,'maxRequests',s.max_requests);
END$$;
CREATE OR REPLACE FUNCTION public.ccee_auto_claim(p_org text,p_private boolean DEFAULT false,p_dri boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.ccee_service_sync_policies;b jsonb;j jsonb;target date;agenda boolean;
BEGIN
 IF p_org<>'org_default' THEN RETURN NULL;END IF;
 SELECT * INTO p FROM public.ccee_service_sync_policies WHERE organization_id=p_org AND enabled AND next_run_at<=now() AND(lease_until IS NULL OR lease_until<=now()) AND(kind='MEASUREMENTS' AND p_private OR kind='DRI' AND p_dri) ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF p.id IS NULL THEN RETURN NULL;END IF;
 target:=CASE WHEN p.month_mode='FIXED' THEN p.month ELSE(date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')-interval '1 month')::date END;
 BEGIN
  IF p.execution_actor_id IS NOT NULL THEN PERFORM public.ccee_permanent_automation_actor(p_org,p.execution_actor_id);END IF;
  PERFORM public.assert_ccee_data_actor(p_org,coalesce(p.execution_actor_id,p.created_by),'manage');b:=public.assert_ccee_data_binding(p_org,p.authorization_id,target,CASE WHEN p.kind='MEASUREMENTS' THEN 'MEASUREMENTS' ELSE 'DRI_READ' END);
  IF p.source_selector->>'bindingRevision' IS DISTINCT FROM b->>'revision' THEN RAISE EXCEPTION 'Binding changed' USING ERRCODE='42501';END IF;
 EXCEPTION WHEN insufficient_privilege THEN UPDATE public.ccee_service_sync_policies SET enabled=false,state='REVIEW_REQUIRED',last_error='ACCESS_CHANGED',next_run_at=NULL,updated_at=now() WHERE id=p.id;RETURN NULL;END;
 IF p.current_job_id IS NOT NULL THEN SELECT to_jsonb(x) INTO j FROM public.ccee_integration_jobs x WHERE id=p.current_job_id AND organization_id=p_org AND authorization_id=p.authorization_id;IF j IS NULL THEN RAISE EXCEPTION 'Policy source changed' USING ERRCODE='42501';END IF;END IF;
 SELECT EXISTS(SELECT 1 FROM public.ccee_calendar_items i JOIN public.ccee_calendar_versions v ON v.id=i.version_id WHERE i.code=p.source_selector->>'calendarCode' AND i.month=target AND i.due_at<=now() AND v.state='APPROVED' AND v.id=(SELECT id FROM public.ccee_calendar_versions WHERE year=extract(year FROM target)::integer AND state='APPROVED' ORDER BY reviewed_at DESC,id DESC LIMIT 1)) INTO agenda;
 UPDATE public.ccee_service_sync_policies SET lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes' WHERE id=p.id RETURNING * INTO p;
 RETURN jsonb_build_object('organizationId',p_org,'policy',to_jsonb(p),'job',j,'targetMonth',to_char(target,'YYYY-MM'),'today',to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD'),'agendaReady',agenda);
END$$;
CREATE OR REPLACE FUNCTION public.ccee_auto_advance(p_id uuid,p_lease uuid,p_plan jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.ccee_service_sync_policies;r jsonb;j public.ccee_integration_jobs;body jsonb;
BEGIN
 SELECT * INTO p FROM public.ccee_service_sync_policies WHERE id=p_id AND lease_id=p_lease AND lease_until>now() AND enabled FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Policy lease changed' USING ERRCODE='40001';END IF;
 IF p.execution_actor_id IS NOT NULL THEN PERFORM public.ccee_permanent_automation_actor(p.organization_id,p.execution_actor_id);END IF;
 PERFORM public.assert_ccee_data_actor(p.organization_id,coalesce(p.execution_actor_id,p.created_by),'manage');
 IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR octet_length(p_plan::text)>6000 OR p_plan-ARRAY['action','state','nextRunAt','cursor','kind','body','enabled','error','success','sourceAt','sourceMonth','lastMonthlyDate','keepJob']<>'{}'::jsonb OR p_plan->>'action' NOT IN('enqueue','finish') OR p_plan->>'state' NOT IN('READY','RUNNING','WAITING_FOR_SOURCE','WAITING_FOR_AGENDA','REVIEW_REQUIRED','BUDGET_PAUSED') OR jsonb_typeof(p_plan->'cursor') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid automatic step' USING ERRCODE='22023';END IF;
 IF p_plan->>'action'='enqueue' THEN
  IF p.current_job_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ccee_integration_jobs WHERE id=p.current_job_id AND state IN('QUEUED','RUNNING')) OR p_plan->'body'->>'authorizationId' IS DISTINCT FROM p.authorization_id::text OR p.kind='MEASUREMENTS' AND p_plan->>'kind'<>'MEASUREMENTS' OR p.kind='DRI' AND p_plan->>'kind' NOT IN('DRI_EVENTS','DRI_REPORTS','DRI_RESULTS') THEN RAISE EXCEPTION 'Read-only policy selection changed' USING ERRCODE='42501';END IF;
  body:=p_plan->'body'||jsonb_build_object('requestId',gen_random_uuid());
  IF p.kind='MEASUREMENTS' THEN
   IF body->>'measurementKind'<>'FINAL' OR p.last_monthly_date=(now() AT TIME ZONE 'America/Sao_Paulo')::date AND p.cursor->>'month'=body->>'month' THEN RAISE EXCEPTION 'One monthly read per day' USING ERRCODE='22023';END IF;
   r:=public.ccee_data_action(p.organization_id,coalesce(p.execution_actor_id,p.created_by),'enqueue',NULL,body);
  ELSE r:=public.ccee_dri_action(p.organization_id,coalesce(p.execution_actor_id,p.created_by),'enqueue',p.authorization_id,body);END IF;
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
REVOKE ALL ON FUNCTION public.ccee_permanent_automation_actor(text,text),public.ccee_automation_takeover(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ccee_automation_takeover(text,text,text,uuid) TO service_role;
COMMIT;
