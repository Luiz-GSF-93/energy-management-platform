-- F1.48: additive explicit billing quantity, no historical/business data rewrite.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.calculation_monthly_inputs ADD COLUMN IF NOT EXISTS billed_demand jsonb;
CREATE OR REPLACE FUNCTION public.guard_monthly_input() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prior public.calculation_monthly_inputs%ROWTYPE; k text; v jsonb; total numeric; peak numeric; offpeak numeric;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Preserve monthly input history';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=NEW.consumer_unit_id AND u.organization_id=NEW.organization_id AND c.id=NEW.customer_id AND c.deleted_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P3403',MESSAGE='Invalid organization scope';END IF;
 IF nullif(btrim(NEW.created_by),'') IS NULL OR nullif(btrim(NEW.updated_by),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Actor required';END IF;
 IF jsonb_typeof(NEW.measurements) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW.measurements))<>7 THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Invalid measurement structure';END IF;
 FOR k,v IN SELECT * FROM jsonb_each(NEW.measurements) LOOP
  IF k NOT IN ('consumptionTotal','consumptionPeak','consumptionOffPeak','demandSingle','demandPeak','demandOffPeak','reactiveTotal') OR (v<>'null'::jsonb AND (jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$')) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Use explicit decimal strings or null';END IF;
 END LOOP;
 total:=(NEW.measurements->>'consumptionTotal')::numeric;peak:=(NEW.measurements->>'consumptionPeak')::numeric;offpeak:=(NEW.measurements->>'consumptionOffPeak')::numeric;
 IF total IS NOT NULL AND peak IS NOT NULL AND offpeak IS NOT NULL AND total<>peak+offpeak THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Consumption sum differs';END IF;
 IF NEW.measurements->>'demandSingle' IS NOT NULL AND (NEW.measurements->>'demandPeak' IS NOT NULL OR NEW.measurements->>'demandOffPeak' IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Do not mix single and time-band demand';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Create draft before validation';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id||':'||NEW.consumer_unit_id||':'||NEW.month,134));
  SELECT * INTO prior FROM public.calculation_monthly_inputs WHERE organization_id=NEW.organization_id AND consumer_unit_id=NEW.consumer_unit_id AND month=NEW.month ORDER BY version DESC LIMIT 1;
  IF FOUND THEN
   IF prior.status<>'VALIDATED' OR NEW.previous_id IS DISTINCT FROM prior.id THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Use current version; only one draft';END IF;
   IF nullif(btrim(NEW.correction_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Correction reason required';END IF;
   NEW.version:=prior.version+1;
  ELSE
   IF NEW.previous_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Invalid prior version';END IF;
   NEW.version:=1;
  END IF;
  NEW.revision:=1;NEW.created_at:=now();NEW.validated_by:=NULL;NEW.validated_at:=NULL;
 ELSE
  IF OLD.status='VALIDATED' THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Validated input is immutable';END IF;
  IF (to_jsonb(NEW)-ARRAY['billed_demand','measurements','source_reference','notes','correction_reason','status','revision','updated_at','updated_by','validated_by','validated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['billed_demand','measurements','source_reference','notes','correction_reason','status','revision','updated_at','updated_by','validated_by','validated_at']) THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Immutable scope and version';END IF;
  IF NEW.status='VALIDATED' AND (NEW.billed_demand IS DISTINCT FROM OLD.billed_demand OR NEW.measurements IS DISTINCT FROM OLD.measurements OR NEW.source_reference<>OLD.source_reference OR NEW.notes<>OLD.notes OR NEW.correction_reason<>OLD.correction_reason) THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Save changes before validating';END IF;
  NEW.revision:=OLD.revision+1;
 END IF;
 IF NEW.previous_id IS NOT NULL AND nullif(btrim(NEW.correction_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Correction reason required';END IF;
 IF NEW.status='VALIDATED' THEN
  IF (total IS NULL AND (peak IS NULL OR offpeak IS NULL)) OR ((peak IS NULL)<>(offpeak IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Complete consumption measurement';END IF;
  NEW.validated_by:=NEW.updated_by;NEW.validated_at:=now();
 ELSE NEW.validated_by:=NULL;NEW.validated_at:=NULL;END IF;
 NEW.updated_at:=now();RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_billed_demand() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE scenario text; d jsonb; k text; v jsonb;
BEGIN
 IF NEW.billed_demand IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.billed_demand) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Invalid billed demand';END IF;
 FOR scenario,d IN SELECT * FROM jsonb_each(NEW.billed_demand) LOOP
  IF scenario NOT IN ('ACL','ACR') OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR jsonb_typeof(d->'source') IS DISTINCT FROM 'string' OR length(btrim(d->>'source')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Billed demand scope and source required';END IF;
  FOR k,v IN SELECT * FROM jsonb_each(d) LOOP
   IF k NOT IN ('single','peak','offPeak','source') OR (k<>'source' AND v<>'null'::jsonb AND (jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$')) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Invalid billed demand quantity';END IF;
  END LOOP;
  IF d->>'single' IS NOT NULL AND (d->>'peak' IS NOT NULL OR d->>'offPeak' IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Do not mix billing bands';END IF;
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
