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
 IF current_setting('energyos.documented_settlements',true)='on' THEN
  base:=base||jsonb_build_object('documentedSupplierDocuments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'organization_id',d.organization_id,'customer_id',d.customer_id,'consumer_unit_id',d.consumer_unit_id,'document_type',d.document_type,'reference_month',d.reference_month,'file_hash',d.file_hash,'file_verified',d.file_verified,'file_size_bytes',d.file_size_bytes,'storage_bucket',d.storage_bucket,'file_path',d.file_path) ORDER BY d.id),'[]') FROM public.documents d WHERE d.organization_id=p_org AND d.customer_id=p_customer AND d.document_type='INVOICE_SUPPLIER' AND d.reference_month>=(p_month||'-01')::date AND d.reference_month<((p_month||'-01')::date+interval '1 month')));
 END IF;
 IF octet_length(base::text)>16000000 THEN RAISE EXCEPTION 'Assisted capture too large' USING ERRCODE='22023';END IF;
 RETURN base;
END$$;

CREATE FUNCTION public.eva_documented_closing_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_unit text,p_month text,p_id uuid,p_body jsonb,p_disclose boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; previous_setting text:=current_setting('energyos.documented_settlements',true);
BEGIN
 PERFORM set_config('energyos.documented_settlements','on',true);
 result:=public.eva_contract_closing_action(p_org,p_actor,p_role,p_platform,p_action,p_unit,p_month,p_id,p_body,p_disclose);
 PERFORM set_config('energyos.documented_settlements',coalesce(previous_setting,''),true);
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('energyos.documented_settlements',coalesce(previous_setting,''),true);
 RAISE;
END$$;
REVOKE ALL ON FUNCTION public.eva_documented_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_documented_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,boolean) TO service_role;
COMMIT;
