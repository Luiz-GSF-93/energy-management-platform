-- F1.27: additive contract configurations. Existing rows are retained.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.management_contracts ADD COLUMN IF NOT EXISTS application_rules text;
CREATE TABLE IF NOT EXISTS public.service_agreements (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),
 consumer_unit_id text REFERENCES public.consumer_units(id),
 agreement_type text NOT NULL CHECK(agreement_type IN ('INTERMEDIATION','OTHER')),
 contract_number varchar(100) NOT NULL,
 counterparty varchar(255) NOT NULL,
 description text NOT NULL,
 billing_basis text NOT NULL CHECK(billing_basis IN ('FIXED_MONTHLY','PER_MWH','PERCENTAGE','CUSTOM')),
 agreed_value numeric(18,6),
 application_rules text NOT NULL,
 start_date date NOT NULL,
 end_date date NOT NULL CHECK(end_date>=start_date),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,contract_number),
 CHECK(agreed_value IS NULL OR (agreed_value>=0 AND agreed_value<'Infinity'::numeric)),
 CHECK(billing_basis='CUSTOM' OR agreed_value IS NOT NULL),
 CHECK(billing_basis<>'PERCENTAGE' OR agreed_value<=100)
);
ALTER TABLE public.service_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.management_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_agreements,public.management_contracts,public.contract_price_history FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.service_agreements,public.management_contracts,public.contract_price_history TO service_role;

CREATE OR REPLACE FUNCTION public.guard_contract_configuration() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE parent_contract record;
BEGIN
 IF TG_OP<>'INSERT' THEN
   RAISE EXCEPTION USING ERRCODE='P3271',MESSAGE='Contract configuration history is immutable';
 END IF;
 IF TG_TABLE_NAME='management_contracts' THEN
   IF NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.id=NEW.customer_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL) THEN
     RAISE EXCEPTION USING ERRCODE='P3272',MESSAGE='Customer outside organization';
   END IF;
   IF NEW.remuneration_model NOT IN ('FIXED','HYBRID') OR NEW.status<>'ACTIVE' OR NEW.end_date IS NULL OR NEW.end_date<NEW.start_date
     OR NEW.fixed_fee_monthly IS NULL OR NOT(NEW.fixed_fee_monthly>=0 AND NEW.fixed_fee_monthly<'Infinity'::float8)
     OR NEW.savings_percentage IS NULL OR NOT(NEW.savings_percentage>=0 AND NEW.savings_percentage<=100)
     OR (NEW.remuneration_model='FIXED' AND NEW.savings_percentage<>0)
     OR nullif(btrim(NEW.application_rules),'') IS NULL THEN
     RAISE EXCEPTION USING ERRCODE='P3273',MESSAGE='Invalid management configuration';
   END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('management:'||NEW.organization_id||':'||NEW.customer_id,0));
   IF EXISTS(SELECT 1 FROM public.management_contracts m WHERE m.organization_id=NEW.organization_id AND m.customer_id=NEW.customer_id AND m.status IN ('ACTIVE','APPROVED') AND m.start_date::date<=NEW.end_date::date AND coalesce(m.end_date::date,'infinity'::date)>=NEW.start_date::date) THEN
     RAISE EXCEPTION USING ERRCODE='P3274',MESSAGE='Overlapping management period';
   END IF;
 ELSIF TG_TABLE_NAME='contract_price_history' THEN
   SELECT * INTO parent_contract FROM public.energy_contracts WHERE id=NEW.contract_id FOR UPDATE;
   IF NOT FOUND OR parent_contract.status NOT IN ('ACTIVE','APPROVED') OR parent_contract.contract_type NOT IN ('ENERGY_PURCHASE','ENERGY_SALE') THEN
     RAISE EXCEPTION USING ERRCODE='P3272',MESSAGE='Active energy contract required';
   END IF;
   IF NEW.end_date IS NULL OR NEW.start_date::date<parent_contract.start_date::date OR NEW.end_date::date>parent_contract.end_date::date OR NEW.end_date<NEW.start_date
     OR NOT(NEW.price_per_mwh>=0 AND NEW.price_per_mwh<'Infinity'::float8) OR nullif(btrim(NEW.reason),'') IS NULL THEN
     RAISE EXCEPTION USING ERRCODE='P3273',MESSAGE='Invalid price period';
   END IF;
   IF EXISTS(SELECT 1 FROM public.contract_price_history h WHERE h.contract_id=NEW.contract_id AND h.start_date::date<=NEW.end_date::date AND coalesce(h.end_date::date,'infinity'::date)>=NEW.start_date::date) THEN
     RAISE EXCEPTION USING ERRCODE='P3274',MESSAGE='Overlapping price period';
   END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.id=NEW.customer_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL)
      OR (NEW.consumer_unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.consumer_units u WHERE u.id=NEW.consumer_unit_id AND u.customer_id=NEW.customer_id AND u.organization_id=NEW.organization_id)) THEN
     RAISE EXCEPTION USING ERRCODE='P3272',MESSAGE='Invalid agreement parent';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_contract_configuration() FROM PUBLIC,anon,authenticated;
-- Replace only this migration's triggers when reapplying.
CREATE OR REPLACE TRIGGER contract_configuration_history BEFORE INSERT OR UPDATE OR DELETE ON public.management_contracts FOR EACH ROW EXECUTE FUNCTION public.guard_contract_configuration();
CREATE OR REPLACE TRIGGER contract_configuration_history BEFORE INSERT OR UPDATE OR DELETE ON public.contract_price_history FOR EACH ROW EXECUTE FUNCTION public.guard_contract_configuration();
CREATE OR REPLACE TRIGGER contract_configuration_history BEFORE INSERT OR UPDATE OR DELETE ON public.service_agreements FOR EACH ROW EXECUTE FUNCTION public.guard_contract_configuration();
CREATE INDEX IF NOT EXISTS service_agreements_tenant_customer ON public.service_agreements(organization_id,customer_id);
NOTIFY pgrst,'reload schema';
COMMIT;
