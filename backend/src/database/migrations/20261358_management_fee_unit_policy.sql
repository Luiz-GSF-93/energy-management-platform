BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $baseline$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.ensure_management_fee_default(text,text,text,text)') AND md5(replace(prosrc,E'\r\n',E'\n')) IN ('1f87b30e866283b5ec0e624becee1d28','cf8c606ea0a874dd12ead68c77f107d4')) THEN
  RAISE EXCEPTION 'Review current fee default function before applying unit policy';
 END IF;
END $baseline$;

-- Standard calculation basis: contract amounts remain dynamic, not product constants.
-- Monthly history is appended only on preparation; approved periods remain untouched.
CREATE OR REPLACE FUNCTION public.ensure_management_fee_default(p_org text,p_actor text,p_unit text,p_month text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' SET lock_timeout='2s' AS $$
DECLARE c public.management_contracts; prior public.management_fee_allocations; saved public.management_fee_allocations; customer text; first_day date; last_day date; count_contracts integer; basis text;
BEGIN
 IF nullif(btrim(p_org),'') IS NULL OR nullif(btrim(p_actor),'') IS NULL OR p_month IS NULL OR p_month !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' THEN
  RAISE EXCEPTION 'Invalid fee default scope' USING ERRCODE='22023';
 END IF;
 SELECT u.customer_id INTO customer FROM public.consumer_units u JOIN public.customers x ON x.organization_id=u.organization_id AND x.id=u.customer_id AND x.status='ACTIVE' AND x.deleted_at IS NULL WHERE u.id=p_unit AND u.organization_id=p_org AND u.status='ACTIVE';
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable fee unit' USING ERRCODE='42501'; END IF;
 first_day:=(p_month||'-01')::date;
 last_day:=(first_day+interval '1 month - 1 day')::date;
 SELECT count(*) INTO count_contracts FROM public.management_contracts m WHERE m.organization_id=p_org AND m.customer_id=customer AND m.status='ACTIVE' AND m.start_date::date<=last_day AND coalesce(m.end_date::date,'9999-12-31')>=first_day;
 IF count_contracts<>1 THEN RETURN jsonb_build_object('created',false,'reason','CONTRACT_SCOPE_REVIEW'); END IF;
 SELECT * INTO c FROM public.management_contracts m WHERE m.organization_id=p_org AND m.customer_id=customer AND m.status='ACTIVE' AND m.start_date::date<=first_day AND coalesce(m.end_date::date,'9999-12-31')>=last_day FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('created',false,'reason','PARTIAL_CONTRACT_PERIOD'); END IF;
 IF c.remuneration_model NOT IN ('FIXED','HYBRID') THEN RETURN jsonb_build_object('created',false,'reason','CONTRACT_MODEL_REVIEW'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.id::text||':'||p_month,0));
 SELECT * INTO prior FROM public.management_fee_allocations a WHERE a.organization_id=p_org AND a.contract_id=c.id AND a.month=p_month ORDER BY a.version DESC LIMIT 1;
 -- Preserve any previous human approval, including later superseded publications.
 IF EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v JOIN public.eva_assisted_closing_events e ON e.organization_id=v.organization_id AND e.closing_id=v.id WHERE v.organization_id=p_org AND v.customer_id=customer AND v.month=p_month AND e.state='APPROVED') THEN
  RETURN jsonb_build_object('created',false,'ruleId',prior.id,'reason','PRESERVED_APPROVAL');
 END IF;
 basis:=CASE WHEN c.remuneration_model='HYBRID' THEN 'PER_UNIT' ELSE 'CONSOLIDATED' END;
 IF prior.id IS NOT NULL AND prior.fixed_fee_basis='PER_UNIT' AND prior.variable_fee_basis=basis AND prior.allocations='[]'::jsonb AND nullif(btrim(prior.source),'') IS NOT NULL THEN
  RETURN jsonb_build_object('created',false,'ruleId',prior.id,'reason','UNIT_POLICY_ALREADY_CAPTURED');
 END IF;
 INSERT INTO public.management_fee_allocations(organization_id,customer_id,contract_id,month,fixed_fee_basis,variable_fee_basis,allocations,source,reason,previous_id,created_by,is_default,inherited_from)
 VALUES(p_org,customer,c.id,p_month,'PER_UNIT',basis,'[]'::jsonb,
  'Regra geral EnergyOS GLOBAL_PER_UNIT_V1 · contrato vigente '||c.id::text||' · fixo integral por unidade; percentual contratual sobre a economia positiva de cada unidade, antes dos honorários, sem rateio entre unidades.',
  'Aplicação automática da regra por unidade. Valores e reajustes vêm do cadastro vigente. Histórico anterior preservado; não aprova, publica ou emite cobrança.',prior.id,p_actor,false,NULL)
 RETURNING * INTO saved;
 RETURN jsonb_build_object('created',true,'ruleId',saved.id,'sourceRuleId',NULL,'policy','GLOBAL_PER_UNIT_V1');
END$$;
REVOKE ALL ON FUNCTION public.ensure_management_fee_default(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_management_fee_default(text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
