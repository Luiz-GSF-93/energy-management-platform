BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.capture_eva_assisted_closing_sources(p_org text,p_customer text,p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE base jsonb;libraries jsonb;prior jsonb;commercial jsonb;
BEGIN
 base:=public.capture_financial_sources(p_org,p_customer,p_month);
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') INTO libraries FROM public.tariff_library_versions t WHERE organization_id=p_org;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'unit',consumer_unit_id,'month',month,'version',version_number,'hash',financial_hash,'status',status,'validation',validation_status,'approvedAt',approved_at,'publishedAt',published_at) ORDER BY month,id),'[]') INTO prior FROM public.monthly_energy_settlements WHERE organization_id=p_org AND customer_id=p_customer AND month<(p_month||'-01')::date AND financial_format='financial-settlement-1.0' AND status IN('APPROVED','PUBLISHED') AND validation_status='VALIDATED';
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY consumer_unit_id),'[]') INTO commercial FROM(
  SELECT DISTINCT ON(consumer_unit_id) consumer_unit_id,id,source_hash,source_basis,plan->'manualOverrides' manual,plan->'manualAuthor' author,(SELECT state FROM public.calculation_preparation_run_events WHERE run_id=r.id ORDER BY sequence DESC LIMIT 1) state FROM public.calculation_preparation_runs r WHERE organization_id=p_org AND customer_id=p_customer AND month=p_month ORDER BY consumer_unit_id,created_at DESC,id DESC
 )s;
 base:=jsonb_build_object('financial',base,'libraries',libraries,'previous',prior,'commercial',commercial);
 IF current_setting('energyos.contract_closing_drafts',true)='on' THEN
  base:=base||jsonb_build_object('contractMemories',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.contract_id,m.version,m.id),'[]') FROM public.contract_index_memories m WHERE m.organization_id=p_org AND m.customer_id=p_customer AND m.parameters->>'month'=p_month));
 END IF;
 IF octet_length(base::text)>16000000 THEN RAISE EXCEPTION 'Assisted capture too large' USING ERRCODE='22023';END IF;
 RETURN base;
END$$;
-- Only the service-gated path includes index memories. Legacy captures remain byte-compatible.
CREATE FUNCTION public.eva_contract_closing_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_unit text,p_month text,p_id uuid,p_body jsonb,p_disclose boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;previous_setting text:=current_setting('energyos.contract_closing_drafts',true);
BEGIN
 IF p_disclose IS NULL OR p_disclose AND p_action IS DISTINCT FROM 'decide' THEN RAISE EXCEPTION 'Invalid disclosure' USING ERRCODE='22023';END IF;
 PERFORM set_config('energyos.contract_closing_drafts','on',true);
 IF p_disclose THEN
  result:=public.decide_eva_with_publication(p_org,p_actor,p_role,p_platform,p_unit,p_month,p_id,p_body);
 ELSIF p_action IN('publish','withdraw') THEN
  result:=public.eva_closing_publication_action(p_org,p_actor,p_role,p_platform,p_action,p_unit,p_month,p_id,p_body);
 ELSE
  result:=public.eva_assisted_closing_action(p_org,p_actor,p_role,p_platform,p_action,p_unit,p_month,p_id,p_body);
 END IF;
 PERFORM set_config('energyos.contract_closing_drafts',coalesce(previous_setting,''),true);
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('energyos.contract_closing_drafts',coalesce(previous_setting,''),true);
 RAISE;
END$$;
REVOKE ALL ON FUNCTION public.eva_contract_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_contract_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,boolean) TO service_role;
COMMIT;
