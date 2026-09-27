BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.commercial_fee_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id), customer_id text NOT NULL REFERENCES public.customers(id),
 kind text NOT NULL CHECK(kind IN ('management','services')), contract_id text NOT NULL,
 effective_date date NOT NULL, index_name text NOT NULL CHECK(length(btrim(index_name)) BETWEEN 2 AND 80),
 rate_percent numeric(12,6) CHECK(rate_percent BETWEEN -100 AND 1000), index_reference text NOT NULL CHECK(length(btrim(index_reference)) BETWEEN 3 AND 500),
 notice_days integer NOT NULL CHECK(notice_days BETWEEN 1 AND 365), base_value numeric(18,6) NOT NULL CHECK(base_value>=0), next_value numeric(18,6),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000), previous_id uuid REFERENCES public.commercial_fee_adjustments(id), version integer NOT NULL,
 request_id uuid NOT NULL, created_by text NOT NULL CHECK(length(btrim(created_by))>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,request_id), UNIQUE(organization_id,kind,contract_id,version)
);
ALTER TABLE public.commercial_fee_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_fee_adjustments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.commercial_fee_adjustments TO service_role;
CREATE FUNCTION public.guard_commercial_fee_adjustment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb; old public.commercial_fee_adjustments; minimum_date date; decimals integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Immutable adjustment history' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('fee-adjustment:'||NEW.organization_id||':'||NEW.kind||':'||NEW.contract_id,0));
 IF NEW.kind='management' THEN SELECT to_jsonb(m) INTO c FROM public.management_contracts m WHERE id=NEW.contract_id AND organization_id=NEW.organization_id;
 ELSE SELECT to_jsonb(m) INTO c FROM public.service_agreements m WHERE id=NEW.contract_id AND organization_id=NEW.organization_id; END IF;
 IF c IS NULL OR c->>'customer_id'<>NEW.customer_id OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=NEW.customer_id AND organization_id=NEW.organization_id AND deleted_at IS NULL AND status='ACTIVE') THEN RAISE EXCEPTION 'Invalid parent' USING ERRCODE='23514'; END IF;
 IF NEW.kind='services' AND c->>'billing_basis' NOT IN ('FIXED_MONTHLY','PER_MWH') THEN RAISE EXCEPTION 'Monetary basis required' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM public.commercial_fee_adjustments WHERE organization_id=NEW.organization_id AND kind=NEW.kind AND contract_id=NEW.contract_id ORDER BY version DESC LIMIT 1;
 IF NEW.previous_id IS DISTINCT FROM old.id THEN RAISE EXCEPTION 'Adjustment changed' USING ERRCODE='40001'; END IF;
 IF (NEW.effective_date<= (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date AND NOT(old.id IS NOT NULL AND old.next_value IS NULL AND NEW.effective_date=old.effective_date AND NEW.rate_percent IS NOT NULL)) OR extract(day FROM NEW.effective_date)<>1 OR NEW.effective_date>(c->>'end_date')::date THEN RAISE EXCEPTION 'Future complete monthly period required' USING ERRCODE='23514'; END IF;
 minimum_date=date_trunc('month',(c->>'start_date')::date+interval '1 year')::date;
 IF old.id IS NOT NULL THEN
  IF old.effective_date>(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date OR old.next_value IS NULL THEN
   IF NEW.effective_date<>old.effective_date THEN RAISE EXCEPTION 'Preserve scheduled date when correcting' USING ERRCODE='23514'; END IF;
   NEW.base_value=old.base_value;
  ELSE
   IF old.next_value IS NULL THEN RAISE EXCEPTION 'Prior index unresolved' USING ERRCODE='23514'; END IF;
   minimum_date=(old.effective_date+interval '1 year')::date; NEW.base_value=old.next_value;
  END IF;
 ELSE NEW.base_value=CASE NEW.kind WHEN 'management' THEN (c->>'fixed_fee_monthly')::numeric ELSE (c->>'agreed_value')::numeric END;
 END IF;
 IF NEW.effective_date<minimum_date THEN RAISE EXCEPTION 'Annual interval required' USING ERRCODE='23514'; END IF;
 decimals=CASE WHEN NEW.kind='services' AND c->>'billing_basis'='PER_MWH' THEN 6 ELSE 2 END;
 NEW.next_value=CASE WHEN NEW.rate_percent IS NULL THEN NULL ELSE round(NEW.base_value*(1+NEW.rate_percent/100),decimals) END;
 NEW.version=coalesce(old.version,0)+1;NEW.created_at=clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_commercial_fee_adjustment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER commercial_fee_adjustment_guard BEFORE INSERT OR UPDATE OR DELETE ON public.commercial_fee_adjustments FOR EACH ROW EXECUTE FUNCTION public.guard_commercial_fee_adjustment();
CREATE INDEX commercial_fee_adjustment_scope ON public.commercial_fee_adjustments(organization_id,customer_id,kind,contract_id,version DESC);
NOTIFY pgrst,'reload schema';
COMMIT;
