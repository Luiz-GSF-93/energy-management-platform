BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
-- Additive, versioned supply scope. Existing sent quotations retain their original periods.
CREATE OR REPLACE FUNCTION public.trading_supply_periods(d jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE a date;b date;y integer;lo date;hi date;months integer;answer jsonb='[]';
BEGIN
 IF coalesce(d->>'supplyStartDate','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' OR coalesce(d->>'supplyEndDate','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Supply dates required' USING ERRCODE='22023';END IF;
 a:=(d->>'supplyStartDate')::date;b:=(d->>'supplyEndDate')::date;
 months:=(extract(year FROM b)::integer-extract(year FROM a)::integer)*12+extract(month FROM b)::integer-extract(month FROM a)::integer+1;
 IF b<a OR months NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Supply period invalid' USING ERRCODE='22023';END IF;
 FOR y IN extract(year FROM a)::integer..extract(year FROM b)::integer LOOP
  lo:=greatest(a,make_date(y,1,1));hi:=least(b,make_date(y,12,31));
  answer:=answer||jsonb_build_array(jsonb_build_object('year',y,'startDate',to_char(lo,'YYYY-MM-DD'),'endDate',to_char(hi,'YYYY-MM-DD'),'months',extract(month FROM hi)::integer-extract(month FROM lo)::integer+1));
 END LOOP;RETURN answer;
END$$;
CREATE OR REPLACE FUNCTION public.trading_proposal_deadline(d jsonb) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE v text=d->>'validUntil';
BEGIN
 IF v~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN ((v::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo');END IF;
 IF v~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RETURN v::timestamptz;END IF;
 RETURN NULL;
END$$;
CREATE OR REPLACE FUNCTION public.assert_trading_reference_prices(d jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;y integer;n integer;seen integer[]='{}';first_year integer;
BEGIN
 IF jsonb_typeof(d->'annualReferencePrices') IS DISTINCT FROM 'array' OR coalesce(d->>'startMonth','')!~'^[0-9]{4}-(0[1-9]|1[0-2])$' OR coalesce((d->>'months')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Annual references required' USING ERRCODE='22023';END IF;
 first_year:=left(d->>'startMonth',4)::integer;
 n:=CASE WHEN d->>'supplyVersion'='3' THEN jsonb_array_length(public.trading_supply_periods(d)) ELSE ceil((d->>'months')::numeric/12)::integer END;
 IF jsonb_array_length(d->'annualReferencePrices')<>n THEN RAISE EXCEPTION 'Reference required for each calendar supply year' USING ERRCODE='22023';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(d->'annualReferencePrices') LOOP
  IF jsonb_typeof(r->'year') IS DISTINCT FROM 'number' OR jsonb_typeof(r->'priceBrlMwh') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid reference' USING ERRCODE='22023';END IF;
  y:=(r->>'year')::integer;
  IF (r->>'year')::numeric<>y OR y<first_year OR y>=first_year+n OR y=ANY(seen) OR (r->>'priceBrlMwh')::numeric NOT BETWEEN 0.0001 AND 10000000 THEN RAISE EXCEPTION 'Invalid reference year or price' USING ERRCODE='22023';END IF;seen:=array_append(seen,y);
 END LOOP;
END$$;
CREATE OR REPLACE FUNCTION public.guard_trading_supply_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o public.trading_records;periods jsonb;offer jsonb;p jsonb;u jsonb;ids text[];seen text[]='{}';years integer[];expected integer[];expiry timestamptz;
BEGIN
 IF NEW.kind='opportunity' AND NEW.data->>'supplyVersion'='3' THEN
  IF TG_OP='UPDATE' AND OLD.data->>'supplyVersion'='3' AND OLD.status<>'DRAFT' AND (NEW.data-ARRAY['expiresAt']) IS DISTINCT FROM (OLD.data-ARRAY['expiresAt']) THEN RAISE EXCEPTION 'Create a new round to change a sent supply scope' USING ERRCODE='42501';END IF;
  periods:=public.trading_supply_periods(NEW.data);
  IF jsonb_typeof(NEW.data->'unitIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Units required' USING ERRCODE='22023';END IF;
  SELECT array_agg(value) INTO ids FROM jsonb_array_elements_text(NEW.data->'unitIds');
  IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 50 OR cardinality(ids)*jsonb_array_length(periods)>500 OR cardinality(ids)<>(SELECT count(DISTINCT v) FROM unnest(ids) v)
  OR NEW.data->>'unitId' IS DISTINCT FROM ids[1] OR NEW.data->'supplyPeriods' IS DISTINCT FROM periods
  OR NEW.data->>'startMonth' IS DISTINCT FROM left(NEW.data->>'supplyStartDate',7)
  OR (NEW.data->>'months')::integer<>(SELECT sum((value->>'months')::integer) FROM jsonb_array_elements(periods))
  OR (SELECT count(*) FROM public.consumer_units c WHERE c.organization_id=NEW.organization_id AND c.customer_id=NEW.data->>'customerId' AND c.id=ANY(ids) AND c.status='ACTIVE')<>cardinality(ids)
  THEN RAISE EXCEPTION 'Units, customer or periods invalid' USING ERRCODE='22023';END IF;
  IF jsonb_typeof(NEW.data->'discloseUnitCnpj') IS DISTINCT FROM 'boolean' OR jsonb_typeof(NEW.data->'unitSnapshots') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.data->'unitSnapshots')<>cardinality(ids) THEN RAISE EXCEPTION 'Invalid unit projection' USING ERRCODE='22023';END IF;
  FOR u IN SELECT value FROM jsonb_array_elements(NEW.data->'unitSnapshots') LOOP
   IF NOT(u->>'id'=ANY(ids)) OR u->>'id'=ANY(seen) OR NOT EXISTS(SELECT 1 FROM public.consumer_units c WHERE c.organization_id=NEW.organization_id AND c.id=u->>'id' AND c.customer_id=NEW.data->>'customerId' AND c.name=u->>'name') THEN RAISE EXCEPTION 'Unit projection changed' USING ERRCODE='22023';END IF;
   seen:=array_append(seen,u->>'id');
   IF NEW.data->>'discloseUnitCnpj'='true' THEN
    IF coalesce(u->>'cnpj','')!~'^[0-9]{14}$' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.data->'unitCnpjs') x WHERE x->>'unitId'=u->>'id' AND x->>'cnpj'=u->>'cnpj') THEN RAISE EXCEPTION 'Confirm unit CNPJ' USING ERRCODE='22023';END IF;
   ELSIF u ? 'cnpj' OR NEW.data->'unitCnpjs' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'CNPJ disclosure disabled' USING ERRCODE='22023';END IF;
  END LOOP;
 ELSIF NEW.kind='proposal' THEN
  IF NEW.status IN('CANCELLED','REJECTED','DECLINED') THEN RETURN NEW;END IF;
  SELECT * INTO o FROM public.trading_records WHERE organization_id=NEW.organization_id AND id=NEW.parent_id AND kind='opportunity';
  IF o.data->>'supplyVersion'='3' THEN
   periods:=public.trading_supply_periods(o.data);SELECT array_agg((value->>'year')::integer ORDER BY (value->>'year')::integer) INTO expected FROM jsonb_array_elements(periods);
   IF NEW.data->>'proposalVersion' IS DISTINCT FROM '3' OR jsonb_typeof(NEW.data->'unitOffers') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.data->'unitOffers')<>jsonb_array_length(o.data->'unitIds') THEN RAISE EXCEPTION 'Complete each unit offer' USING ERRCODE='22023';END IF;
   FOR offer IN SELECT value FROM jsonb_array_elements(NEW.data->'unitOffers') LOOP
    IF NOT(o.data->'unitIds' ? (offer->>'unitId')) OR offer->>'unitId'=ANY(seen) OR jsonb_typeof(offer->'periodPrices') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Offer unit mismatch' USING ERRCODE='22023';END IF;seen:=array_append(seen,offer->>'unitId');
    IF NOT coalesce((offer->>'guaranteeType') IN('NONE','LETTER_GUARANTEE','SURETY_INSURANCE','CASH_COLLATERAL','OTHER') AND (offer->>'billingMethod') IN('BOLETO','TRANSFER','OTHER') AND jsonb_typeof(offer->'billingBusinessDaysAfterInvoice')='number' AND (offer->>'billingBusinessDaysAfterInvoice')::numeric BETWEEN 0 AND 365 AND (offer->>'billingBusinessDaysAfterInvoice')::numeric=trunc((offer->>'billingBusinessDaysAfterInvoice')::numeric) AND length(btrim(offer->>'seasonality')) BETWEEN 1 AND 1000 AND length(btrim(offer->>'correctionIndex')) BETWEEN 1 AND 1000 AND length(btrim(offer->>'modulation')) BETWEEN 1 AND 1000,false)
    OR offer->>'guaranteeType'='OTHER' AND coalesce(length(btrim(offer->>'guaranteeOther')),0)=0 OR offer->>'billingMethod'='OTHER' AND coalesce(length(btrim(offer->>'billingMethodOther')),0)=0 THEN RAISE EXCEPTION 'Complete guarantee and billing conditions for each unit' USING ERRCODE='22023';END IF;
    SELECT array_agg((value->>'year')::integer ORDER BY (value->>'year')::integer) INTO years FROM jsonb_array_elements(offer->'periodPrices');
    IF years IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Offer periods mismatch' USING ERRCODE='22023';END IF;
    FOR p IN SELECT value FROM jsonb_array_elements(offer->'periodPrices') LOOP IF jsonb_typeof(p->'priceBrlMwh') IS DISTINCT FROM 'number' OR (p->>'priceBrlMwh')::numeric NOT BETWEEN 0.0001 AND 10000000 THEN RAISE EXCEPTION 'Invalid offer price' USING ERRCODE='22023';END IF;END LOOP;
   END LOOP;
  ELSIF NEW.data->>'proposalVersion'='3' THEN RAISE EXCEPTION 'Legacy quote cannot accept matrix offers' USING ERRCODE='22023';END IF;
  expiry:=public.trading_proposal_deadline(NEW.data);
  IF expiry IS NULL OR expiry<=clock_timestamp() THEN
   IF TG_OP='INSERT' OR NEW.data IS DISTINCT FROM OLD.data OR NEW.status IN('MANAGER_APPROVED','CLIENT_APPROVED','CONTRACTED') THEN RAISE EXCEPTION 'Proposal price expired: request an updated offer' USING ERRCODE='22023';END IF;
  END IF;
 END IF;RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trading_supply_scope ON public.trading_records;
CREATE TRIGGER trading_supply_scope BEFORE INSERT OR UPDATE ON public.trading_records FOR EACH ROW EXECUTE FUNCTION public.guard_trading_supply_scope();
CREATE OR REPLACE FUNCTION public.guard_trading_proposal_workflow_deadline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expiry timestamptz;
BEGIN
 expiry:=public.trading_proposal_deadline(NEW.proposal_data);
 IF NEW.state NOT IN('REJECTED','REVOKED','STALE') AND (expiry IS NULL OR expiry<=clock_timestamp()) THEN RAISE EXCEPTION 'Proposal price expired' USING ERRCODE='22023';END IF;
 IF NEW.deadline IS NOT NULL THEN NEW.deadline:=least(NEW.deadline,expiry);END IF;RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trading_proposal_workflow_deadline ON public.trading_approval_workflows;
CREATE TRIGGER trading_proposal_workflow_deadline BEFORE INSERT OR UPDATE ON public.trading_approval_workflows FOR EACH ROW EXECUTE FUNCTION public.guard_trading_proposal_workflow_deadline();
REVOKE ALL ON FUNCTION public.trading_supply_periods(jsonb),public.trading_proposal_deadline(jsonb),public.assert_trading_reference_prices(jsonb),public.guard_trading_supply_scope(),public.guard_trading_proposal_workflow_deadline() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.trading_workflow_all_units_allowed(p_org text,p_actor text,p_role text,p_op uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT CASE WHEN o.data->>'supplyVersion'='3' THEN (SELECT coalesce(bool_and(public.trading_workflow_portal_allowed(p_org,p_actor,p_role,o.data->>'customerId',uid)),false) FROM jsonb_array_elements_text(o.data->'unitIds') uid) ELSE true END FROM public.trading_records o WHERE o.organization_id=p_org AND o.id=p_op AND o.kind='opportunity'),false)
$$;
-- Extend the existing exact authorization checks; retain the original RPC signatures, grants and all prior rules.
DO $patch$ DECLARE f regprocedure;definition text;needle text;replacement text;
BEGIN
 FOREACH f IN ARRAY ARRAY['public.trading_workflow_read(text,text,text,boolean,text,integer,uuid)'::regprocedure,'public.trading_workflow_action(text,text,text,boolean,uuid,integer,uuid,text,text,jsonb)'::regprocedure] LOOP
  definition:=pg_get_functiondef(f);
  IF position('trading_workflow_all_units_allowed' IN definition)=0 THEN
   FOREACH needle IN ARRAY ARRAY['public.trading_workflow_portal_allowed(p_org,p_actor,p_role,w.customer_id,w.unit_id)', 'public.trading_workflow_portal_allowed(p_org,m.user_id::text,m.role_id::text,w.customer_id,w.unit_id)', 'public.trading_workflow_portal_allowed(p_org,p_body->>''recipientId'',(SELECT m.role_id::text FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id::text=p_body->>''recipientId''),w.customer_id,w.unit_id)'] LOOP
    replacement:=CASE WHEN position('m.user_id::text' IN needle)>0 AND position('recipientId' IN needle)=0 THEN '(public.trading_workflow_all_units_allowed(p_org,m.user_id::text,m.role_id::text,w.opportunity_id) AND '||needle||')' WHEN position('recipientId' IN needle)>0 THEN '(public.trading_workflow_all_units_allowed(p_org,p_body->>''recipientId'',(SELECT m.role_id::text FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id::text=p_body->>''recipientId''),w.opportunity_id) AND '||needle||')' ELSE '(public.trading_workflow_all_units_allowed(p_org,p_actor,p_role,w.opportunity_id) AND '||needle||')' END;
    definition:=replace(definition,needle,replacement);
   END LOOP;
   IF position('trading_workflow_all_units_allowed' IN definition)=0 THEN RAISE EXCEPTION 'Review workflow authorization before migration';END IF;
   EXECUTE definition;
  END IF;
 END LOOP;
END $patch$;
DO $formalization$ DECLARE definition text;needle text='IF NOT public.trading_quote_is_live(w.organization_id,w.opportunity_id)';
BEGIN
 definition:=pg_get_functiondef('public.trading_formalization_assert(text,boolean)'::regprocedure);
 IF position('trading_proposal_deadline' IN definition)=0 THEN
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Review formalization lifetime before migration';END IF;
  EXECUTE replace(definition,needle,'IF coalesce(public.trading_proposal_deadline(w.proposal_data)<=clock_timestamp(),true) OR NOT public.trading_quote_is_live(w.organization_id,w.opportunity_id)');
 END IF;
END $formalization$;
REVOKE ALL ON FUNCTION public.trading_workflow_all_units_allowed(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.guard_trading_supply_scope() IS 'trading:20261341:v1';
COMMIT;
