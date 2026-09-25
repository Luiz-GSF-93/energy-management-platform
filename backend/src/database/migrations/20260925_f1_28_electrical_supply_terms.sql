-- F1.28 additive electrical fields and preserved supply terms.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS contracted_demand_peak numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS contracted_demand_off_peak numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS demand_tariff numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS demand_tariff_peak numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS demand_tariff_off_peak numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS energy_tariff_peak numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS energy_tariff_off_peak numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS reactive_energy_tariff numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS last_demand_value numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS last_demand_peak numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS last_demand_off_peak numeric(18,6);
ALTER TABLE public.consumer_units ADD COLUMN IF NOT EXISTS tariff_subgroup varchar(4), ADD COLUMN IF NOT EXISTS consumption_class varchar(30), ADD COLUMN IF NOT EXISTS free_market boolean, ADD COLUMN IF NOT EXISTS last_demand_adjustment_date date;
ALTER TABLE public.energy_contracts ADD COLUMN IF NOT EXISTS annual_prices jsonb NOT NULL DEFAULT '[]', ADD COLUMN IF NOT EXISTS pricing_mode varchar(10), ADD COLUMN IF NOT EXISTS adjustment_rule text, ADD COLUMN IF NOT EXISTS guarantee_type varchar(30), ADD COLUMN IF NOT EXISTS guarantee_amount numeric(18,2), ADD COLUMN IF NOT EXISTS guarantee_institution varchar(255), ADD COLUMN IF NOT EXISTS guarantee_description text;
CREATE OR REPLACE FUNCTION public.guard_electrical_supply_terms() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE x jsonb; n text; previous_end date; d1 date; d2 date; amount numeric; rowdata jsonb;
BEGIN
 IF TG_TABLE_NAME='consumer_units' THEN
  rowdata:=to_jsonb(NEW);
  FOREACH n IN ARRAY ARRAY['contracted_demand_peak','contracted_demand_off_peak','demand_tariff','demand_tariff_peak','demand_tariff_off_peak','energy_tariff_peak','energy_tariff_off_peak','reactive_energy_tariff','last_demand_value','last_demand_peak','last_demand_off_peak'] LOOP
   IF rowdata->>n IS NOT NULL AND NOT ((rowdata->>n)::numeric>=0 AND (rowdata->>n)::numeric<'Infinity'::numeric) THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Invalid electrical amount'; END IF;
  END LOOP;
  IF NEW.tariff_subgroup IS NOT NULL AND (NEW.tariff_subgroup NOT IN ('A1','A2','A3','A3a','A4','AS','B1','B2','B3','B4') OR NEW.tariff_group NOT IN ('A','B') OR left(NEW.tariff_subgroup,1)<>NEW.tariff_group) THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Incompatible tariff group and subgroup'; END IF;
  IF NEW.consumption_class IS NOT NULL AND NEW.consumption_class NOT IN ('INDUSTRIAL','COMMERCIAL','RURAL','PUBLIC_AUTHORITY','PUBLIC_SERVICE','RESIDENTIAL') THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Invalid consumption class'; END IF;
  IF NEW.tariff_subgroup IS NOT NULL AND NEW.tariff_modality='BLUE' AND (NEW.tariff_group<>'A' OR NEW.contracted_demand_peak IS NULL OR NEW.contracted_demand_off_peak IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Blue modality requires both demands'; END IF;
  IF NEW.last_demand_adjustment_date IS NOT NULL AND (NEW.last_demand_value IS NULL AND (NEW.last_demand_peak IS NULL OR NEW.last_demand_off_peak IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Last demand adjustment requires contracted values'; END IF;
  IF NEW.last_demand_adjustment_date IS NULL AND (NEW.last_demand_value IS NOT NULL OR NEW.last_demand_peak IS NOT NULL OR NEW.last_demand_off_peak IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Last demand values require date'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND OLD.status<>'DRAFT' AND (NEW.annual_prices IS DISTINCT FROM OLD.annual_prices OR NEW.pricing_mode IS DISTINCT FROM OLD.pricing_mode OR NEW.adjustment_rule IS DISTINCT FROM OLD.adjustment_rule OR NEW.guarantee_type IS DISTINCT FROM OLD.guarantee_type OR NEW.guarantee_amount IS DISTINCT FROM OLD.guarantee_amount OR NEW.guarantee_institution IS DISTINCT FROM OLD.guarantee_institution OR NEW.guarantee_description IS DISTINCT FROM OLD.guarantee_description OR NEW.adjustment_index IS DISTINCT FROM OLD.adjustment_index OR NEW.adjustment_date IS DISTINCT FROM OLD.adjustment_date) THEN RAISE EXCEPTION USING ERRCODE='P3282',MESSAGE='Active supply terms are immutable'; END IF;
  IF NEW.guarantee_type IS NOT NULL THEN
   IF NEW.guarantee_type NOT IN ('BANK_GUARANTEE','INSURANCE','BANK_DEPOSIT','OTHER') OR NEW.guarantee_amount IS NULL OR NOT(NEW.guarantee_amount>=0 AND NEW.guarantee_amount<'Infinity'::numeric) OR nullif(btrim(NEW.guarantee_institution),'') IS NULL OR (NEW.guarantee_type='OTHER' AND nullif(btrim(NEW.guarantee_description),'') IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Incomplete guarantee'; END IF;
  ELSIF NEW.guarantee_amount IS NOT NULL OR NEW.guarantee_institution IS NOT NULL OR NEW.guarantee_description IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Guarantee type required'; END IF;
  IF NEW.pricing_mode IS NOT NULL AND NEW.pricing_mode NOT IN ('FIXED','INDEXED','MIXED') THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Invalid pricing mode'; END IF;
  IF NEW.pricing_mode IN ('INDEXED','MIXED') AND (nullif(btrim(NEW.adjustment_index),'') IS NULL OR NEW.adjustment_date IS NULL OR nullif(btrim(NEW.adjustment_rule),'') IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Index, base date and rule required'; END IF;
  IF jsonb_typeof(NEW.annual_prices)<>'array' OR jsonb_array_length(NEW.annual_prices)>50 THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Invalid annual price table'; END IF;
  previous_end:=NEW.start_date::date-1;
  FOR x IN SELECT value FROM jsonb_array_elements(NEW.annual_prices) LOOP
   IF jsonb_typeof(x)<>'object' OR coalesce(x->>'startDate','')!~'^\d{4}-\d{2}-\d{2}$' OR coalesce(x->>'endDate','')!~'^\d{4}-\d{2}-\d{2}$' OR jsonb_typeof(x->'pricePerMwh') IS DISTINCT FROM 'number' OR coalesce(x->>'priceStatus','') NOT IN ('FINAL','BASE') THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Invalid annual price entry'; END IF;
   BEGIN d1:=(x->>'startDate')::date;d2:=(x->>'endDate')::date; EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Invalid annual dates'; END;
   amount:=(x->>'pricePerMwh')::numeric;
   IF d1<>previous_end+1 OR d2<d1 OR d2>NEW.end_date::date OR d2>=(d1+interval '1 year')::date OR NOT(amount>=0 AND amount<'Infinity'::numeric) OR (x->>'priceStatus'='BASE' AND coalesce(NEW.pricing_mode,'FIXED') NOT IN ('INDEXED','MIXED')) THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Annual prices must cover term in contiguous periods of at most one year'; END IF;
   IF d1=NEW.start_date::date AND amount<>NEW.current_price THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Base price must match first period'; END IF;
   previous_end:=d2;
  END LOOP;
  IF jsonb_array_length(NEW.annual_prices)>0 AND previous_end<>NEW.end_date::date THEN RAISE EXCEPTION USING ERRCODE='P3281',MESSAGE='Annual prices must cover entire contract'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_electrical_supply_terms() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER electrical_supply_terms BEFORE INSERT OR UPDATE ON public.consumer_units FOR EACH ROW EXECUTE FUNCTION public.guard_electrical_supply_terms();
CREATE OR REPLACE TRIGGER electrical_supply_terms BEFORE INSERT OR UPDATE ON public.energy_contracts FOR EACH ROW EXECUTE FUNCTION public.guard_electrical_supply_terms();
NOTIFY pgrst,'reload schema';
COMMIT;
