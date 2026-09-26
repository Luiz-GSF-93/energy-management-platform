BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.supplier_billing_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,customer_id text NOT NULL,consumer_unit_id text NOT NULL,contract_id text NOT NULL,
 start_date date NOT NULL,end_date date NOT NULL,version integer NOT NULL,previous_id uuid,
 volume_basis text NOT NULL,min_percent numeric(12,4) NOT NULL,max_tolerance_percent numeric(12,4) NOT NULL,
 price_mode text NOT NULL,index_percent numeric(14,6),index_source text,tax_treatment text NOT NULL,
 source text NOT NULL,reason text NOT NULL DEFAULT '',created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(contract_id,version)
);
ALTER TABLE public.supplier_billing_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_billing_rules FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.supplier_billing_rules TO service_role;
CREATE OR REPLACE FUNCTION public.guard_supplier_billing_rule() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c record; latest record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Immutable supplier billing rules' USING ERRCODE='P5402';END IF;
 SELECT e.* INTO c FROM energy_contracts e JOIN customers u ON u.id=e.customer_id AND u.organization_id=e.organization_id AND u.deleted_at IS NULL JOIN consumer_units cu ON cu.id=e.consumer_unit_id AND cu.organization_id=e.organization_id AND cu.customer_id=e.customer_id WHERE e.id=NEW.contract_id AND e.organization_id=NEW.organization_id AND e.customer_id=NEW.customer_id AND e.consumer_unit_id=NEW.consumer_unit_id;
 IF NOT FOUND OR c.contract_type<>'ENERGY_PURCHASE' OR c.status NOT IN ('ACTIVE','APPROVED') OR NEW.start_date<c.start_date::date OR NEW.end_date>c.end_date::date OR NEW.end_date<NEW.start_date THEN RAISE EXCEPTION 'Invalid contract or billing period' USING ERRCODE='P5401';END IF;
 IF NEW.volume_basis NOT IN ('MONTHLY','SEASONAL') OR NOT(NEW.min_percent>=0 AND NEW.min_percent<=9999 AND NEW.max_tolerance_percent>=0 AND NEW.max_tolerance_percent<=9999 AND NEW.min_percent<=100+NEW.max_tolerance_percent) OR NEW.price_mode NOT IN ('FINAL','BASE_PLUS_INDEX') OR NEW.tax_treatment NOT IN ('NET','GROSS') OR nullif(btrim(NEW.source),'') IS NULL OR length(NEW.source)>2000 OR length(NEW.reason)>2000 OR nullif(btrim(NEW.created_by),'') IS NULL THEN RAISE EXCEPTION 'Invalid billing conditions' USING ERRCODE='P5401';END IF;
 IF (NEW.price_mode='FINAL' AND (NEW.index_percent IS NOT NULL OR NEW.index_source IS NOT NULL)) OR (NEW.price_mode='BASE_PLUS_INDEX' AND (NEW.index_percent IS NULL OR NOT(NEW.index_percent>-100 AND NEW.index_percent<=9999) OR nullif(btrim(NEW.index_source),'') IS NULL OR length(NEW.index_source)>2000)) THEN RAISE EXCEPTION 'Index evidence required; never apply index twice' USING ERRCODE='P5401';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.contract_id,0));
 SELECT * INTO latest FROM supplier_billing_rules WHERE contract_id=NEW.contract_id ORDER BY version DESC LIMIT 1;
 IF FOUND THEN
  IF NEW.previous_id IS DISTINCT FROM latest.id OR nullif(btrim(NEW.reason),'') IS NULL THEN RAISE EXCEPTION 'Stale version or missing reason' USING ERRCODE='P5402';END IF;NEW.version:=latest.version+1;
 ELSE
  IF NEW.previous_id IS NOT NULL THEN RAISE EXCEPTION 'Unexpected predecessor' USING ERRCODE='P5402';END IF;NEW.version:=1;
 END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_supplier_billing_rule() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER preserve_supplier_billing_rule BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_billing_rules FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_billing_rule();
NOTIFY pgrst,'reload schema';
COMMIT;
