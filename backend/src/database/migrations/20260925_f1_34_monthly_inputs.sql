-- F1.34: normalized monthly measurements, independent of financial settlements.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.calculation_monthly_inputs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id), customer_id text NOT NULL REFERENCES public.customers(id), consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 month text NOT NULL CHECK(month ~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$'), version integer NOT NULL DEFAULT 1 CHECK(version>0), previous_id uuid REFERENCES public.calculation_monthly_inputs(id),
 measurements jsonb NOT NULL CHECK(jsonb_typeof(measurements)='object'), source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 2000), origin text NOT NULL DEFAULT 'MANUAL' CHECK(origin='MANUAL'),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000), correction_reason text NOT NULL DEFAULT '' CHECK(length(correction_reason)<=2000), unit_context jsonb NOT NULL CHECK(jsonb_typeof(unit_context)='object'),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','VALIDATED')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_by text NOT NULL, updated_by text NOT NULL, validated_by text, validated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,consumer_unit_id,month,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS monthly_inputs_one_draft ON public.calculation_monthly_inputs(organization_id,consumer_unit_id,month) WHERE status='DRAFT';
CREATE TABLE IF NOT EXISTS public.calculation_monthly_input_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),input_id uuid NOT NULL REFERENCES public.calculation_monthly_inputs(id),organization_id text NOT NULL,revision integer NOT NULL,actor_id text NOT NULL,action text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),snapshot jsonb NOT NULL,UNIQUE(input_id,revision));
ALTER TABLE public.calculation_monthly_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calculation_monthly_input_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calculation_monthly_inputs,public.calculation_monthly_input_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.calculation_monthly_inputs TO service_role;
GRANT SELECT ON public.calculation_monthly_input_events TO service_role;
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
  IF (to_jsonb(NEW)-ARRAY['measurements','source_reference','notes','correction_reason','status','revision','updated_at','updated_by','validated_by','validated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['measurements','source_reference','notes','correction_reason','status','revision','updated_at','updated_by','validated_by','validated_at']) THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Immutable scope and version';END IF;
  IF NEW.status='VALIDATED' AND (NEW.measurements IS DISTINCT FROM OLD.measurements OR NEW.source_reference<>OLD.source_reference OR NEW.notes<>OLD.notes OR NEW.correction_reason<>OLD.correction_reason) THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Save changes before validating';END IF;
  NEW.revision:=OLD.revision+1;
 END IF;
 IF NEW.previous_id IS NOT NULL AND nullif(btrim(NEW.correction_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Correction reason required';END IF;
 IF NEW.status='VALIDATED' THEN
  IF (total IS NULL AND (peak IS NULL OR offpeak IS NULL)) OR ((peak IS NULL)<>(offpeak IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Complete consumption measurement';END IF;
  NEW.validated_by:=NEW.updated_by;NEW.validated_at:=now();
 ELSE NEW.validated_by:=NULL;NEW.validated_at:=NULL;END IF;
 NEW.updated_at:=now();RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.audit_monthly_input() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.calculation_monthly_input_events(input_id,organization_id,revision,actor_id,action,snapshot) VALUES(NEW.id,NEW.organization_id,NEW.revision,NEW.updated_by,CASE WHEN TG_OP='INSERT' THEN 'CREATED' WHEN NEW.status='VALIDATED' THEN 'VALIDATED' ELSE 'UPDATED' END,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.preserve_monthly_input_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Immutable event';END $$;
REVOKE ALL ON FUNCTION public.guard_monthly_input(),public.audit_monthly_input(),public.preserve_monthly_input_event() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER monthly_input_guard BEFORE INSERT OR UPDATE OR DELETE ON public.calculation_monthly_inputs FOR EACH ROW EXECUTE FUNCTION public.guard_monthly_input();
CREATE OR REPLACE TRIGGER monthly_input_audit AFTER INSERT OR UPDATE ON public.calculation_monthly_inputs FOR EACH ROW EXECUTE FUNCTION public.audit_monthly_input();
CREATE OR REPLACE TRIGGER monthly_input_event_guard BEFORE UPDATE OR DELETE ON public.calculation_monthly_input_events FOR EACH ROW EXECUTE FUNCTION public.preserve_monthly_input_event();
NOTIFY pgrst,'reload schema';
COMMIT;
