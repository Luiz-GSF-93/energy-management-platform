-- F1.111: exact demand tariffs and explicit split billing quantities.
-- No financial approval, historical rewrite or change to row-level permissions.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.calculation_parameters DROP CONSTRAINT IF EXISTS calculation_parameters_amount_text_check;
ALTER TABLE public.calculation_parameters ADD CONSTRAINT calculation_parameters_amount_text_check CHECK (
 amount_text ~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$'
 OR (kind='TARIFF' AND measure='BRL_KW' AND amount_text ~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,9})?$')
);
ALTER TABLE public.calculation_parameters ALTER COLUMN amount TYPE numeric(21,9);
CREATE OR REPLACE FUNCTION public.guard_billed_demand() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE scenario text; d jsonb; k text; v jsonb;
BEGIN
 IF NEW.billed_demand IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.billed_demand) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Invalid billed demand';END IF;
 FOR scenario,d IN SELECT * FROM jsonb_each(NEW.billed_demand) LOOP
  IF scenario NOT IN ('ACL','ACR') OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR jsonb_typeof(d->'source') IS DISTINCT FROM 'string' OR length(btrim(d->>'source')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Billed demand scope and source required';END IF;
  FOR k,v IN SELECT * FROM jsonb_each(d) LOOP
   IF k NOT IN ('single','peak','offPeak','used','unused','source') OR (k<>'source' AND v<>'null'::jsonb AND (jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$')) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Invalid billed demand quantity';END IF;
  END LOOP;
  IF d->>'single' IS NOT NULL AND (d->>'peak' IS NOT NULL OR d->>'offPeak' IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Do not mix billing bands';END IF;
  IF d->>'used' IS NOT NULL OR d->>'unused' IS NOT NULL THEN
   IF scenario<>'ACL' OR NEW.unit_context->>'tariff_group' IS DISTINCT FROM 'A' OR NEW.unit_context->>'tariff_modality' IS DISTINCT FROM 'GREEN' OR d->>'single' IS NULL OR d->>'used' IS NULL OR d->>'unused' IS NULL OR d->>'peak' IS NOT NULL OR d->>'offPeak' IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Complete ACL green split billed demand';END IF;
   IF (d->>'used')::numeric+(d->>'unused')::numeric<>(d->>'single')::numeric THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Split demand must equal total billed demand';END IF;
  END IF;
  IF NEW.status='VALIDATED' THEN
   IF NEW.unit_context->>'tariff_group' IS DISTINCT FROM 'A' OR coalesce(NEW.unit_context->>'tariff_modality','') NOT IN ('BLUE','GREEN') THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Unsupported billed demand modality';END IF;
   IF NEW.unit_context->>'tariff_modality'='BLUE' AND (d->>'single' IS NOT NULL OR d->>'peak' IS NULL OR d->>'offPeak' IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Complete blue billing bands';END IF;
   IF NEW.unit_context->>'tariff_modality'='GREEN' AND (d->>'single' IS NULL OR d->>'peak' IS NOT NULL OR d->>'offPeak' IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Complete green billing band';END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_billed_demand() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER billed_demand_guard BEFORE INSERT OR UPDATE ON public.calculation_monthly_inputs FOR EACH ROW EXECUTE FUNCTION public.guard_billed_demand();
NOTIFY pgrst,'reload schema';
COMMIT;
