BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.supplier_billing_rules ALTER COLUMN min_percent DROP NOT NULL, ALTER COLUMN max_tolerance_percent DROP NOT NULL;
CREATE OR REPLACE FUNCTION public.guard_supplier_billing_rule() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c record; latest record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Immutable supplier billing rules' USING ERRCODE='P5402';END IF;
 SELECT e.* INTO c FROM energy_contracts e JOIN customers u ON u.id=e.customer_id AND u.organization_id=e.organization_id AND u.deleted_at IS NULL JOIN consumer_units cu ON cu.id=e.consumer_unit_id AND cu.organization_id=e.organization_id AND cu.customer_id=e.customer_id WHERE e.id=NEW.contract_id AND e.organization_id=NEW.organization_id AND e.customer_id=NEW.customer_id AND e.consumer_unit_id=NEW.consumer_unit_id;
 IF NOT FOUND OR c.contract_type<>'ENERGY_PURCHASE' OR c.status NOT IN ('ACTIVE','APPROVED') OR NEW.start_date<c.start_date::date OR NEW.end_date>c.end_date::date OR NEW.end_date<NEW.start_date THEN RAISE EXCEPTION 'Invalid contract or billing period' USING ERRCODE='P5401';END IF;
 IF NEW.volume_basis NOT IN ('MONTHLY','SEASONAL','SPOT') OR NEW.price_mode NOT IN ('FINAL','BASE_PLUS_INDEX') OR NEW.tax_treatment NOT IN ('NET','GROSS') OR nullif(btrim(NEW.source),'') IS NULL OR length(NEW.source)>2000 OR length(NEW.reason)>2000 OR nullif(btrim(NEW.created_by),'') IS NULL THEN RAISE EXCEPTION 'Invalid billing conditions' USING ERRCODE='P5401';END IF;
 IF (NEW.price_mode='FINAL' AND (NEW.index_percent IS NOT NULL OR NEW.index_source IS NOT NULL)) OR (NEW.price_mode='BASE_PLUS_INDEX' AND (NEW.index_percent IS NULL OR NOT(NEW.index_percent>-100 AND NEW.index_percent<=9999) OR nullif(btrim(NEW.index_source),'') IS NULL OR length(NEW.index_source)>2000)) THEN RAISE EXCEPTION 'Index evidence required; never apply index twice' USING ERRCODE='P5401';END IF;
 IF NEW.volume_basis='SPOT' THEN
  IF NEW.min_percent IS NOT NULL OR NEW.max_tolerance_percent IS NOT NULL OR NEW.price_mode<>'FINAL' OR NEW.start_date<>date_trunc('month',NEW.start_date)::date OR NEW.end_date<>(date_trunc('month',NEW.start_date)+interval '1 month - 1 day')::date THEN RAISE EXCEPTION 'Spot purchase requires one complete month, final price and no take-or-pay limits' USING ERRCODE='P5401';END IF;
 ELSE
  IF NEW.min_percent IS NULL OR NEW.max_tolerance_percent IS NULL OR NOT(NEW.min_percent>=0 AND NEW.min_percent<=9999 AND NEW.max_tolerance_percent>=0 AND NEW.max_tolerance_percent<=9999 AND NEW.min_percent<=100+NEW.max_tolerance_percent) THEN RAISE EXCEPTION 'Contract limits required' USING ERRCODE='P5401';END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.contract_id,0));
 SELECT * INTO latest FROM supplier_billing_rules WHERE contract_id=NEW.contract_id ORDER BY version DESC LIMIT 1;
 IF FOUND THEN
  IF NEW.previous_id IS DISTINCT FROM latest.id OR nullif(btrim(NEW.reason),'') IS NULL THEN RAISE EXCEPTION 'Stale version or missing reason' USING ERRCODE='P5402';END IF;NEW.version:=latest.version+1;
 ELSE
  IF NEW.previous_id IS NOT NULL THEN RAISE EXCEPTION 'Unexpected predecessor' USING ERRCODE='P5402';END IF;NEW.version:=1;
 END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
