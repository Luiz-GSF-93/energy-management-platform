-- F1.29: supplier operating terms; no financial calculation is introduced.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.energy_contracts
 ADD COLUMN IF NOT EXISTS flexibility_min_percent numeric(12,4),
 ADD COLUMN IF NOT EXISTS flexibility_max_percent numeric(12,4),
 ADD COLUMN IF NOT EXISTS modulation varchar(20),
 ADD COLUMN IF NOT EXISTS submarket varchar(10),
 ADD COLUMN IF NOT EXISTS seasonality_mode varchar(10),
 ADD COLUMN IF NOT EXISTS seasonality_rule text,
 ADD COLUMN IF NOT EXISTS seasonal_volumes jsonb NOT NULL DEFAULT '[]';
CREATE OR REPLACE FUNCTION public.guard_supplier_operating_terms() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; pct jsonb; total numeric; month_index integer; yr integer; years_seen integer[]:='{}'; v numeric;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status<>'DRAFT' AND (NEW.flexibility_min_percent IS DISTINCT FROM OLD.flexibility_min_percent OR NEW.flexibility_max_percent IS DISTINCT FROM OLD.flexibility_max_percent OR NEW.modulation IS DISTINCT FROM OLD.modulation OR NEW.submarket IS DISTINCT FROM OLD.submarket OR NEW.seasonality_mode IS DISTINCT FROM OLD.seasonality_mode OR NEW.seasonality_rule IS DISTINCT FROM OLD.seasonality_rule OR NEW.seasonal_volumes IS DISTINCT FROM OLD.seasonal_volumes) THEN RAISE EXCEPTION USING ERRCODE='P3292',MESSAGE='Historical operating terms are immutable'; END IF;
 IF (NEW.flexibility_min_percent IS NULL)<>(NEW.flexibility_max_percent IS NULL) OR (NEW.flexibility_min_percent IS NOT NULL AND NOT(NEW.flexibility_min_percent>=0 AND NEW.flexibility_max_percent>=NEW.flexibility_min_percent AND NEW.flexibility_max_percent<'Infinity'::numeric)) THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Invalid flexibility interval'; END IF;
 IF NEW.modulation IS NOT NULL AND NEW.modulation NOT IN ('FLEX','LOAD_FOLLOWING') THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Invalid modulation'; END IF;
 IF NEW.submarket IS NOT NULL AND NEW.submarket NOT IN ('S','SE_CO','NE','N') THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Invalid submarket'; END IF;
 IF NEW.seasonality_mode IS NOT NULL AND NEW.seasonality_mode NOT IN ('RULE','MONTHLY','BOTH') THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Invalid seasonality mode'; END IF;
 IF NEW.seasonality_mode IN ('RULE','BOTH') AND nullif(btrim(NEW.seasonality_rule),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Seasonality rule required'; END IF;
 IF jsonb_typeof(NEW.seasonal_volumes)<>'array' OR jsonb_array_length(NEW.seasonal_volumes)>50 THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Invalid seasonal volume table'; END IF;
 IF NEW.seasonality_mode IN ('MONTHLY','BOTH') THEN
  IF jsonb_array_length(NEW.seasonal_volumes)<>extract(year from NEW.end_date)::int-extract(year from NEW.start_date)::int+1 THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Provide distribution for each contract year'; END IF;
 ELSIF jsonb_array_length(NEW.seasonal_volumes)>0 THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Select monthly seasonality'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.seasonal_volumes) LOOP
  IF jsonb_typeof(item)<>'object' OR coalesce(item->>'year','')!~'^[0-9]{4}$' OR jsonb_typeof(item->'annualVolumeMwh') IS DISTINCT FROM 'number' OR jsonb_typeof(item->'monthlyPercentages') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Invalid seasonal year'; END IF;
  yr:=(item->>'year')::int;v:=(item->>'annualVolumeMwh')::numeric;
  IF yr=ANY(years_seen) OR yr<extract(year from NEW.start_date)::int OR yr>extract(year from NEW.end_date)::int OR NOT(v>=0 AND v<'Infinity'::numeric) OR jsonb_array_length(item->'monthlyPercentages')<>12 THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Invalid seasonal year or volume'; END IF;
  years_seen:=array_append(years_seen,yr);total:=0;month_index:=0;
  FOR pct IN SELECT value FROM jsonb_array_elements(item->'monthlyPercentages') LOOP
   month_index:=month_index+1;
   IF jsonb_typeof(pct)<>'number' THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Invalid monthly percentage'; END IF;
   v:=pct::text::numeric;
   IF NOT(v>=0 AND v<=100) OR (v<>0 AND (make_date(yr,month_index,1)>NEW.end_date::date OR (make_date(yr,month_index,1)+interval '1 month')::date<=NEW.start_date::date)) THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Monthly percentage outside contract'; END IF;
   total:=total+v;
  END LOOP;
  IF abs(total-100)>0.0001 THEN RAISE EXCEPTION USING ERRCODE='P3291',MESSAGE='Monthly percentages must total 100'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_supplier_operating_terms() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER supplier_operating_terms BEFORE INSERT OR UPDATE ON public.energy_contracts FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_operating_terms();
NOTIFY pgrst,'reload schema';
COMMIT;
