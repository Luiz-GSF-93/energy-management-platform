BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Preserve the existing takeover model: the permanent execution actor owns automation.
DO $$DECLARE source text;BEGIN
 source:=pg_get_functiondef('public.ccee_monthly_reference_claim(text)'::regprocedure);
 IF position('public.assert_ccee_data_actor(p_org,sched.created_by,' in source)=0 THEN RAISE EXCEPTION 'Monthly actor source changed'; END IF;
 source:=replace(source,' PERFORM public.assert_ccee_data_actor(p_org,sched.created_by,''manage'');',' IF sched.execution_actor_id IS NOT NULL THEN PERFORM public.ccee_permanent_automation_actor(p_org,sched.execution_actor_id); END IF; PERFORM public.assert_ccee_data_actor(p_org,coalesce(sched.execution_actor_id,sched.created_by),''manage'');');
 source:=replace(source,'VALUES(p_org,sched.created_by,''PLD_MONTHLY''','VALUES(p_org,coalesce(sched.execution_actor_id,sched.created_by),''PLD_MONTHLY''');
 source:=replace(source,'date_trunc(''year'',now() AT TIME ZONE ''America/Sao_Paulo'')','date_trunc(''year'',(now() AT TIME ZONE ''America/Sao_Paulo'')-interval ''1 month'')');
 EXECUTE source;
 source:=pg_get_functiondef('public.ccee_reference_task(text,text,text,uuid,uuid,jsonb)'::regprocedure);
 IF position('s.created_by=p_actor' in source)=0 THEN RAISE EXCEPTION 'Monthly policy source changed'; END IF;
 source:=replace(source,'s.created_by=p_actor','coalesce(s.execution_actor_id,s.created_by)=p_actor');
 source:=replace(source,'  IF NOT EXISTS(SELECT 1 FROM public.ccee_sync_schedules s','  IF EXISTS(SELECT 1 FROM public.ccee_sync_schedules s WHERE s.organization_id=p_org AND s.kind=''PLD_HOURLY'' AND s.execution_actor_id=p_actor) THEN PERFORM public.ccee_permanent_automation_actor(p_org,p_actor); END IF; IF NOT EXISTS(SELECT 1 FROM public.ccee_sync_schedules s');
 EXECUTE source;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
