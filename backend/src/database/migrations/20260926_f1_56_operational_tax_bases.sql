-- Explicit operational base source; existing parameters remain manual and immutable.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.calculation_parameters ADD COLUMN IF NOT EXISTS monetary_source text;
CREATE OR REPLACE FUNCTION public.guard_calculation_parameter() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='P3302',MESSAGE='Preserve parameter history'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=NEW.consumer_unit_id AND u.organization_id=NEW.organization_id AND c.id=NEW.customer_id AND c.deleted_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P3303',MESSAGE='Invalid organization scope'; END IF;
 IF nullif(btrim(NEW.created_by),'') IS NULL OR nullif(btrim(NEW.updated_by),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Actor required'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' THEN RAISE EXCEPTION USING ERRCODE='P3302',MESSAGE='Create a draft first'; END IF;
  NEW.revision:=1;NEW.created_at:=now();NEW.approved_by:=NULL;NEW.approved_at:=NULL;NEW.retired_at:=NULL;NEW.retirement_reason:=NULL;
 ELSE
  IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.customer_id<>OLD.customer_id OR NEW.consumer_unit_id<>OLD.consumer_unit_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION USING ERRCODE='P3302',MESSAGE='Immutable scope'; END IF;
  IF OLD.status='RETIRED' OR (OLD.status='APPROVED' AND (NEW.status<>'RETIRED' OR (to_jsonb(NEW)-ARRAY['status','revision','updated_at','updated_by','retired_at','retirement_reason','amount']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','updated_at','updated_by','retired_at','retirement_reason','amount']))) THEN RAISE EXCEPTION USING ERRCODE='P3302',MESSAGE='Approved parameters are immutable'; END IF;
  IF OLD.status='DRAFT' AND NEW.status NOT IN ('DRAFT','APPROVED','RETIRED') THEN RAISE EXCEPTION USING ERRCODE='P3302',MESSAGE='Invalid transition'; END IF;
  NEW.revision:=OLD.revision+1;
 END IF;
 IF NEW.component_code IN ('OTHER','OTHER_') THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Specify a unique additional component code'; END IF;
 IF NEW.monetary_source IS NOT NULL AND (NEW.monetary_source NOT IN ('SUPPLIER_ENERGY','SUPPLIER_MINIMUM','SUPPLIER_EXTRA','MONTHLY_CCEE','MONTHLY_EXPOSURE','MONTHLY_CHARGE','MONTHLY_OTHER') OR NEW.kind<>'COST' OR NEW.measure<>'BRL_MONTH' OR NEW.time_band<>'ALL' OR NEW.direction<>'DEBIT' OR NEW.amount_text IS NOT NULL OR (NEW.monetary_source LIKE 'SUPPLIER_%' AND NEW.scenario<>'ACL')) THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Invalid automatic monetary source'; END IF;
 IF NEW.kind='TAX' THEN
  IF NEW.measure<>'PERCENT' OR NEW.direction<>'DEBIT' OR NEW.time_band<>'ALL' OR NEW.treatment NOT IN ('INSIDE','OUTSIDE','INCLUDED','EXEMPT','NOT_APPLICABLE') OR length(btrim(NEW.base_rule))=0 OR NEW.included_taxes<>'' THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Specify tax base and treatment'; END IF;
  IF NEW.component_code NOT IN ('ICMS','PIS','COFINS','IOF') AND NEW.component_code !~ '^OTHER_[A-Z0-9_]+$' THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Invalid tax code'; END IF;
  IF NEW.treatment IN ('EXEMPT','NOT_APPLICABLE') THEN
   IF NEW.amount_text IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='No rate for non-applicable tax'; END IF;
  ELSIF NEW.amount_text IS NULL OR NEW.amount_text::numeric>100 OR (NEW.treatment='INSIDE' AND NEW.amount_text::numeric>=100) THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Invalid tax rate'; END IF;
 ELSE
  IF (NEW.amount_text IS NULL AND NEW.monetary_source IS NULL) OR NEW.measure='PERCENT' OR NEW.treatment NOT IN ('NET','GROSS') OR (NEW.kind='TARIFF' AND (NEW.measure='BRL_MONTH' OR NEW.direction<>'DEBIT')) OR (NEW.kind='COST' AND length(btrim(NEW.base_rule))=0) THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Invalid tariff or cost'; END IF;
  IF (NEW.treatment='GROSS' AND length(btrim(NEW.included_taxes))=0) OR (NEW.treatment='NET' AND NEW.included_taxes<>'') THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Declare embedded taxes'; END IF;
 END IF;
 NEW.updated_at:=now();
 IF NEW.status='APPROVED' AND (TG_OP='INSERT' OR OLD.status='DRAFT') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id||':'||NEW.consumer_unit_id::text||':'||NEW.kind||':'||NEW.component_code||':'||NEW.scenario,0));
  IF EXISTS(SELECT 1 FROM public.calculation_parameters p WHERE p.id<>NEW.id AND p.organization_id=NEW.organization_id AND p.consumer_unit_id=NEW.consumer_unit_id AND p.kind=NEW.kind AND p.component_code=NEW.component_code AND p.scenario=NEW.scenario AND (p.time_band=NEW.time_band OR p.time_band='ALL' OR NEW.time_band='ALL') AND p.status='APPROVED' AND p.start_date<=NEW.end_date AND p.end_date>=NEW.start_date) THEN RAISE EXCEPTION USING ERRCODE='P3304',MESSAGE='Approved validity overlaps'; END IF;
  IF NEW.monetary_source IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id||':'||NEW.consumer_unit_id::text||':SOURCE:'||NEW.monetary_source||':'||NEW.scenario,0));
   IF EXISTS(SELECT 1 FROM public.calculation_parameters p WHERE p.id<>NEW.id AND p.organization_id=NEW.organization_id AND p.consumer_unit_id=NEW.consumer_unit_id AND p.scenario=NEW.scenario AND p.monetary_source=NEW.monetary_source AND p.status='APPROVED' AND p.start_date<=NEW.end_date AND p.end_date>=NEW.start_date) THEN RAISE EXCEPTION USING ERRCODE='P3304',MESSAGE='Automatic source validity overlaps'; END IF;
  END IF;
  NEW.approved_by:=NEW.updated_by;NEW.approved_at:=now();
 END IF;
 IF NEW.status='DRAFT' THEN NEW.approved_by:=NULL;NEW.approved_at:=NULL;END IF;
 IF NEW.status='RETIRED' THEN
  IF nullif(btrim(NEW.retirement_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Retirement reason required';END IF;
  NEW.retired_at:=now();
 ELSE NEW.retired_at:=NULL;NEW.retirement_reason:=NULL;END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_calculation_parameter() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
