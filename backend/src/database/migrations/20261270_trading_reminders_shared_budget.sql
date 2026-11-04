BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $install_20261270$ BEGIN
 IF to_regprocedure('public.trading_delivery_usage(text,text)') IS NOT NULL THEN
  IF obj_description(to_regprocedure('public.trading_delivery_usage(text,text)'),'pg_proc') IS DISTINCT FROM 'trading-workflow:20261270:1b67ae4e569e8ac92bf82a87b420103816c338efc47b2b3dd21c3d74f6e7ed94' THEN RAISE EXCEPTION 'Review existing Trading workflow schema before migration';END IF;RETURN;
 END IF;
 EXECUTE $schema_20261270$
CREATE FUNCTION public.collect_trading_workflow_reminders() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w public.trading_approval_workflows;n integer:=0;
BEGIN
 FOR w IN SELECT * FROM public.trading_approval_workflows WHERE organization_id='org_default' AND state='CLIENT_PENDING' AND deadline>now() AND deadline<=now()+interval '1 hour' ORDER BY deadline FOR UPDATE SKIP LOCKED LIMIT 20 LOOP
  IF EXISTS(SELECT 1 FROM public.trading_approval_deliveries WHERE workflow_id=w.id AND workflow_revision=w.revision AND sequence=2) THEN CONTINUE;END IF;
  IF public.trading_workflow_portal_allowed(w.organization_id,w.recipient_id,(SELECT role_id::text FROM public.organization_members WHERE organization_id=w.organization_id AND user_id::text=w.recipient_id),w.customer_id,w.unit_id) IS NOT TRUE THEN CONTINUE;END IF;
  INSERT INTO public.trading_approval_deliveries(organization_id,workflow_id,workflow_revision,recipient_id,channel,sequence,state,title,href)
  SELECT w.organization_id,w.id,w.revision,w.recipient_id,c,2,CASE WHEN c='INAPP' THEN 'ACCEPTED' ELSE 'PENDING' END,'Lembrete urgente: proposta aguarda decisão até '||to_char(w.deadline AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'),'https://app.expertenergy.com.br/portal#aprovacoes-trading' FROM unnest(ARRAY['INAPP','EMAIL','WHATSAPP','SMS'])c ON CONFLICT DO NOTHING;
  INSERT INTO public.trading_approval_events(organization_id,workflow_id,actor_id,request_id,input,action,reason,snapshot,response)VALUES(w.organization_id,w.id,'system:trading-reminder',gen_random_uuid(),jsonb_build_object('revision',w.revision),'DEADLINE_REMINDER','Lembrete único antes do prazo de decisão, sujeito aos canais e orçamento.',jsonb_build_object('deadline',w.deadline),'{}');n:=n+1;
 END LOOP;RETURN n;
END$$;
CREATE FUNCTION public.trading_delivery_usage(p_org text,p_period text) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE p_period WHEN 'DAY' THEN count(*) ELSE coalesce(sum(cost_micro_usd),0) END FROM public.trading_approval_deliveries WHERE organization_id=p_org AND channel<>'INAPP' AND state IN('SENDING','ACCEPTED','DELIVERED','UNKNOWN') AND created_at>=date_trunc(CASE p_period WHEN 'DAY' THEN 'day' ELSE 'month' END,now())
$$;
DO $migration$ DECLARE definition text;old_text text;new_text text;BEGIN
 SELECT pg_get_functiondef('public.claim_portal_notification(jsonb,integer,bigint,jsonb)'::regprocedure) INTO definition;
 IF EXISTS(SELECT 1 FROM portal_scope.routines WHERE original_oid='public.claim_portal_notification(jsonb,integer,bigint,jsonb)'::regprocedure) THEN RAISE EXCEPTION 'Review scoped routine dependency before budget integration';END IF;
 old_text:=$old$(SELECT count(*) FROM public.portal_notification_deliveries WHERE organization_id=n.organization_id AND state='RESERVED' AND sequence=1 AND created_at>=date_trunc('day',now()))>=p_daily$old$;
 new_text:=$new$(SELECT count(*) FROM public.portal_notification_deliveries WHERE organization_id=n.organization_id AND state='RESERVED' AND sequence=1 AND created_at>=date_trunc('day',now()))+public.trading_delivery_usage(n.organization_id,'DAY')>=p_daily$new$;
 IF strpos(definition,'trading_delivery_usage')=0 THEN
  IF(length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'Portal daily budget source changed';END IF;definition:=replace(definition,old_text,new_text);
  old_text:=$old$(SELECT coalesce(sum(cost_micro_usd),0) FROM public.portal_notification_deliveries WHERE organization_id=n.organization_id AND state='RESERVED' AND sequence=1 AND created_at>=date_trunc('month',now()))+cost>p_budget$old$;
  new_text:=$new$(SELECT coalesce(sum(cost_micro_usd),0) FROM public.portal_notification_deliveries WHERE organization_id=n.organization_id AND state='RESERVED' AND sequence=1 AND created_at>=date_trunc('month',now()))+public.trading_delivery_usage(n.organization_id,'MONTH')+cost>p_budget$new$;
  IF(length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'Portal monthly budget source changed';END IF;EXECUTE replace(definition,old_text,new_text);
 END IF;
END $migration$;
REVOKE ALL ON FUNCTION public.collect_trading_workflow_reminders(),public.trading_delivery_usage(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.collect_trading_workflow_reminders() TO service_role;
NOTIFY pgrst,'reload schema';
COMMENT ON FUNCTION public.trading_delivery_usage(text,text) IS 'trading-workflow:20261270:1b67ae4e569e8ac92bf82a87b420103816c338efc47b2b3dd21c3d74f6e7ed94';
$schema_20261270$;
END $install_20261270$;
COMMIT;
