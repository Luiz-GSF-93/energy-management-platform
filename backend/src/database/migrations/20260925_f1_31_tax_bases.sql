-- F1.31: explicit monetary-rubric bases; existing approvals remain immutable.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.calculation_parameters ADD COLUMN IF NOT EXISTS tax_basis jsonb;
ALTER TABLE public.calculation_parameters ADD COLUMN IF NOT EXISTS embedded_tax_codes jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE OR REPLACE FUNCTION public.guard_calculation_parameter_basis() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; ref public.calculation_parameters%ROWTYPE; seen text[]:=ARRAY[]::text[]; included integer:=0; code text;
BEGIN
 -- A withdrawal must remain possible even when a referenced rubric was retired.
 IF NEW.status='RETIRED' THEN RETURN NEW;END IF;
 IF jsonb_typeof(NEW.embedded_tax_codes)<>'array' OR jsonb_array_length(NEW.embedded_tax_codes)>20 THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Invalid embedded taxes';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.embedded_tax_codes) LOOP
  code:=item#>>'{}';
  IF jsonb_typeof(item)<>'string' OR code !~ '^(ICMS|PIS|COFINS|IOF|OTHER_[A-Z0-9_]+)$' OR code=ANY(seen) THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Invalid embedded tax code';END IF;
  seen:=array_append(seen,code);
 END LOOP;
 IF NEW.treatment<>'GROSS' AND jsonb_array_length(NEW.embedded_tax_codes)>0 THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Only gross values contain embedded taxes';END IF;
 IF NEW.tax_basis IS NOT NULL THEN
  IF NEW.kind<>'TAX' OR NEW.treatment IN ('EXEMPT','NOT_APPLICABLE') OR jsonb_typeof(NEW.tax_basis)<>'object' OR NEW.tax_basis->'version' IS DISTINCT FROM '1'::jsonb OR NEW.tax_basis-ARRAY['version','items']<>'{}'::jsonb OR jsonb_typeof(NEW.tax_basis->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Invalid tax basis';END IF;
  IF jsonb_array_length(NEW.tax_basis->'items')>100 THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Too many basis items';END IF;
  seen:=ARRAY[]::text[];
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.tax_basis->'items') LOOP
   IF jsonb_typeof(item)<>'object' OR item-ARRAY['parameterId','revision','operation']<>'{}'::jsonb OR jsonb_typeof(item->'parameterId') IS DISTINCT FROM 'string' OR coalesce(item->>'parameterId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR jsonb_typeof(item->'revision') IS DISTINCT FROM 'number' OR coalesce(item->>'revision','') !~ '^[1-9][0-9]{0,8}$' OR coalesce(item->>'operation','') NOT IN ('INCLUDE','EXCLUDE') OR lower(item->>'parameterId')=ANY(seen) THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Invalid or duplicated basis item';END IF;
   seen:=array_append(seen,lower(item->>'parameterId'));
   -- Lock the exact approved version while validating, including concurrent retirement.
   SELECT * INTO ref FROM public.calculation_parameters p WHERE p.id=(item->>'parameterId')::uuid AND p.organization_id=NEW.organization_id AND p.consumer_unit_id=NEW.consumer_unit_id AND p.scenario=NEW.scenario AND p.kind<>'TAX' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Basis item unavailable in scope';END IF;
   IF item->>'operation'='INCLUDE' THEN included:=included+1;END IF;
   IF NEW.status='APPROVED' THEN
    IF ref.status<>'APPROVED' OR ref.revision<>(item->>'revision')::integer OR ref.start_date>NEW.start_date OR ref.end_date<NEW.end_date THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Basis requires approved versions covering full validity';END IF;
    IF item->>'operation'='INCLUDE' AND ((NEW.treatment IN ('INSIDE','OUTSIDE') AND ref.treatment<>'NET') OR (NEW.treatment='INCLUDED' AND (ref.treatment<>'GROSS' OR NOT(ref.embedded_tax_codes ? NEW.component_code)))) THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Incompatible tax treatment in basis';END IF;
   END IF;
  END LOOP;
 END IF;
 IF NEW.status='APPROVED' THEN
  IF (NEW.treatment='GROSS' AND jsonb_array_length(NEW.embedded_tax_codes)=0) OR (NEW.kind='TAX' AND NEW.treatment IN ('INSIDE','OUTSIDE','INCLUDED') AND included=0) THEN RAISE EXCEPTION USING ERRCODE='P3311',MESSAGE='Structured tax definition required for approval';END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_calculation_parameter_basis() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER calculation_parameter_zbasis BEFORE INSERT OR UPDATE ON public.calculation_parameters FOR EACH ROW EXECUTE FUNCTION public.guard_calculation_parameter_basis();
NOTIFY pgrst,'reload schema';
COMMIT;
