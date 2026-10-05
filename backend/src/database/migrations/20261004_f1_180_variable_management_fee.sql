-- Explicit variable-only registration and a narrow audited correction of erroneous fixed fees.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.management_variable_corrections (
 id uuid PRIMARY KEY, organization_id text NOT NULL REFERENCES public.organizations(id),
 contract_id text NOT NULL REFERENCES public.management_contracts(id), actor text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 4096),
 before_row jsonb NOT NULL, after_row jsonb NOT NULL, transaction_id bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.management_variable_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.management_variable_corrections FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.management_variable_corrections TO service_role;
CREATE OR REPLACE FUNCTION public.guard_variable_correction_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN RAISE EXCEPTION 'Correction audit history is immutable';END $$;
CREATE OR REPLACE TRIGGER immutable_variable_correction BEFORE UPDATE OR DELETE ON public.management_variable_corrections FOR EACH ROW EXECUTE FUNCTION public.guard_variable_correction_history();
CREATE OR REPLACE FUNCTION public.guard_contract_configuration() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE parent_contract record;
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='management_contracts' AND OLD.remuneration_model='HYBRID'
  AND NEW.remuneration_model='HYBRID' AND NEW.fixed_fee_monthly=0 AND NEW.savings_percentage>0 AND NEW.savings_percentage<=100
  AND to_jsonb(NEW)-ARRAY['fixed_fee_monthly','savings_percentage'] = to_jsonb(OLD)-ARRAY['fixed_fee_monthly','savings_percentage']
  AND EXISTS(SELECT 1 FROM public.management_variable_corrections a WHERE a.contract_id=OLD.id AND a.organization_id=OLD.organization_id AND a.transaction_id=txid_current() AND a.before_row=to_jsonb(OLD) AND a.after_row=to_jsonb(NEW)) THEN RETURN NEW;END IF;
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

CREATE OR REPLACE FUNCTION public.correct_variable_management_fee(p_organization text,p_contract text,p_actor text,p_expected_fixed numeric,p_expected_percentage numeric,p_percentage numeric,p_reason text,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_row public.management_contracts%ROWTYPE; next_row public.management_contracts%ROWTYPE; prior public.management_variable_corrections%ROWTYPE;
BEGIN
 IF nullif(btrim(p_actor),'') IS NULL OR p_request IS NULL OR p_expected_fixed IS NULL OR p_expected_percentage IS NULL OR p_percentage IS NULL OR NOT(p_percentage>0 AND p_percentage<=100) OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 4096 THEN RAISE EXCEPTION USING ERRCODE='P3180',MESSAGE='Confirmed percentage, actor and reason required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('variable-correction:'||p_request::text,0));
 SELECT * INTO prior FROM public.management_variable_corrections WHERE id=p_request;
 IF FOUND THEN
  IF prior.organization_id<>p_organization OR prior.contract_id<>p_contract OR prior.actor<>p_actor OR prior.reason<>p_reason OR (prior.before_row->>'fixed_fee_monthly')::numeric<>p_expected_fixed OR (prior.before_row->>'savings_percentage')::numeric<>p_expected_percentage OR (prior.after_row->>'savings_percentage')::numeric<>p_percentage THEN RAISE EXCEPTION USING ERRCODE='P3180',MESSAGE='Request identity changed';END IF;
  RETURN prior.after_row;
 END IF;
 SELECT * INTO old_row FROM public.management_contracts WHERE id=p_contract AND organization_id=p_organization FOR UPDATE;
 IF NOT FOUND OR old_row.status NOT IN ('ACTIVE','APPROVED') OR old_row.remuneration_model<>'HYBRID' OR old_row.fixed_fee_monthly IS DISTINCT FROM p_expected_fixed::float8 OR old_row.savings_percentage IS DISTINCT FROM p_expected_percentage::float8 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Current contract changed';END IF;
 next_row=old_row;next_row.fixed_fee_monthly=0;next_row.savings_percentage=p_percentage;
 INSERT INTO public.management_variable_corrections(id,organization_id,contract_id,actor,reason,before_row,after_row,transaction_id) VALUES(p_request,p_organization,p_contract,p_actor,p_reason,to_jsonb(old_row),to_jsonb(next_row),txid_current());
 UPDATE public.management_contracts SET fixed_fee_monthly=0,savings_percentage=p_percentage WHERE id=p_contract AND organization_id=p_organization RETURNING * INTO next_row;
 RETURN to_jsonb(next_row);
END $$;
REVOKE ALL ON FUNCTION public.correct_variable_management_fee(text,text,text,numeric,numeric,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.correct_variable_management_fee(text,text,text,numeric,numeric,numeric,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.guard_variable_correction_history() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
