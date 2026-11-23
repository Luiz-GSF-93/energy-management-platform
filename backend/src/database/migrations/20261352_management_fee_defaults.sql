BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
ALTER TABLE public.management_fee_allocations
 ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS inherited_from uuid REFERENCES public.management_fee_allocations(id);

-- Invoked only by the service after the existing scoped closing permission gate.
-- Materialize an explicit recurring policy into the ordinary immutable monthly
-- history. Never infer a recurring policy from an unmarked monthly exception.
CREATE OR REPLACE FUNCTION public.ensure_management_fee_default(p_org text,p_actor text,p_unit text,p_month text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' SET lock_timeout='2s' AS $$
DECLARE c public.management_contracts; prior public.management_fee_allocations; policy public.management_fee_allocations; saved public.management_fee_allocations; customer text;first_day date;last_day date; count_contracts integer;basis text;shares jsonb;policy_id uuid;
BEGIN
 IF nullif(btrim(p_org),'') IS NULL OR nullif(btrim(p_actor),'') IS NULL OR p_month !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR p_month IS NULL THEN RAISE EXCEPTION 'Invalid fee default scope' USING ERRCODE='22023';END IF;
 SELECT u.customer_id INTO customer FROM public.consumer_units u JOIN public.customers x ON x.organization_id=u.organization_id AND x.id=u.customer_id AND x.status='ACTIVE' AND x.deleted_at IS NULL WHERE u.id=p_unit AND u.organization_id=p_org AND u.status='ACTIVE';
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable fee unit' USING ERRCODE='42501';END IF;
 first_day:=(p_month||'-01')::date;last_day:=(first_day+interval '1 month - 1 day')::date;
 SELECT count(*) INTO count_contracts FROM public.management_contracts m WHERE m.organization_id=p_org AND m.customer_id=customer AND m.status='ACTIVE' AND m.start_date::date<=last_day AND coalesce(m.end_date::date,'9999-12-31')>=first_day;
 IF count_contracts<>1 THEN RETURN jsonb_build_object('created',false,'reason','CONTRACT_SCOPE_REVIEW');END IF;
 SELECT * INTO c FROM public.management_contracts m WHERE m.organization_id=p_org AND m.customer_id=customer AND m.status='ACTIVE' AND m.start_date::date<=first_day AND coalesce(m.end_date::date,'9999-12-31')>=last_day FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('created',false,'reason','PARTIAL_CONTRACT_PERIOD');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.id::text||':'||p_month,0));
 SELECT * INTO prior FROM public.management_fee_allocations a WHERE a.organization_id=p_org AND a.contract_id=c.id AND a.month=p_month ORDER BY a.version DESC LIMIT 1;
 IF prior.id IS NOT NULL AND prior.inherited_from IS NULL THEN RETURN jsonb_build_object('created',false,'ruleId',prior.id,'reason','EXPLICIT_MONTHLY_RULE');END IF;
 -- A financial decision remains bound to its captured sources and fee rule.
 IF EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.organization_id=p_org AND v.customer_id=customer AND v.month=p_month AND (SELECT e.state FROM public.eva_assisted_closing_events e WHERE e.organization_id=p_org AND e.closing_id=v.id ORDER BY e.sequence DESC LIMIT 1)='APPROVED') THEN RETURN jsonb_build_object('created',false,'reason','PRESERVED_APPROVAL');END IF;
 SELECT * INTO policy FROM public.management_fee_allocations a WHERE a.organization_id=p_org AND a.contract_id=c.id AND a.month<=p_month AND a.is_default AND a.inherited_from IS NULL AND NOT EXISTS(SELECT 1 FROM public.management_fee_allocations newer WHERE newer.organization_id=p_org AND newer.contract_id=c.id AND newer.month=a.month AND newer.version>a.version) ORDER BY a.month DESC,a.version DESC LIMIT 1;
 IF policy.id IS NOT NULL THEN
  basis:=policy.variable_fee_basis;shares:=policy.allocations;policy_id:=policy.id;
  IF prior.inherited_from=policy_id THEN RETURN jsonb_build_object('created',false,'ruleId',prior.id,'reason','DEFAULT_ALREADY_CAPTURED');END IF;
 ELSIF c.remuneration_model='FIXED' AND coalesce(c.savings_percentage,0)=0 AND prior.id IS NULL THEN basis:='CONSOLIDATED';shares:='[]';policy_id:=NULL;
 ELSE RETURN jsonb_build_object('created',false,'reason','NO_CONFIRMED_DEFAULT','needsReview',prior.inherited_from IS NOT NULL);END IF;
 INSERT INTO public.management_fee_allocations(organization_id,customer_id,contract_id,month,fixed_fee_basis,variable_fee_basis,allocations,source,reason,previous_id,created_by,is_default,inherited_from)
 VALUES(p_org,customer,c.id,p_month,'PER_UNIT',basis,shares,
  CASE WHEN policy_id IS NULL THEN 'Fixo integral por unidade conforme contrato vigente '||c.id::text ELSE 'Regra recorrente confirmada '||policy_id::text||' · contrato '||c.id::text||' · origem '||policy.month||' v'||policy.version::text||' · '||left(policy.source,1400) END,
  'Aplicação automática da regra vigente nesta competência. Não aprova, publica ou cobra o fechamento.',prior.id,p_actor,false,policy_id) RETURNING * INTO saved;
 RETURN jsonb_build_object('created',true,'ruleId',saved.id,'sourceRuleId',policy_id);
END$$;
REVOKE ALL ON FUNCTION public.ensure_management_fee_default(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_management_fee_default(text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';COMMIT;
