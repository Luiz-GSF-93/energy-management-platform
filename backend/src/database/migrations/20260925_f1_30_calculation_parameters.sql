-- F1.30: versioned unit calculation parameters. No calculation engine.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.calculation_parameters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id), customer_id text NOT NULL REFERENCES public.customers(id), consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 kind text NOT NULL CHECK(kind IN ('TARIFF','TAX','COST')), component_code text NOT NULL CHECK(component_code ~ '^[A-Z][A-Z0-9_]{0,39}$'), label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 200), scenario text NOT NULL CHECK(scenario IN ('ACL','ACR')), time_band text NOT NULL CHECK(time_band IN ('ALL','PEAK','OFF_PEAK')),
 measure text NOT NULL CHECK(measure IN ('BRL_KWH','BRL_MWH','BRL_KW','BRL_KVARH','BRL_MONTH','PERCENT')), amount_text text CHECK(amount_text ~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$'), amount numeric(18,6) GENERATED ALWAYS AS (amount_text::numeric) STORED,
 treatment text NOT NULL CHECK(treatment IN ('NET','GROSS','INSIDE','OUTSIDE','INCLUDED','EXEMPT','NOT_APPLICABLE')), included_taxes text NOT NULL DEFAULT '', base_rule text NOT NULL DEFAULT '', direction text NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), source text NOT NULL CHECK(length(btrim(source)) BETWEEN 1 AND 2000), notes text NOT NULL DEFAULT '',
 start_date date NOT NULL, end_date date NOT NULL CHECK(end_date>=start_date), unit_context jsonb NOT NULL CHECK(jsonb_typeof(unit_context)='object'),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','RETIRED')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_by text NOT NULL, updated_by text NOT NULL, approved_by text, approved_at timestamptz, retired_at timestamptz, retirement_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calculation_parameters_scope ON public.calculation_parameters(organization_id,consumer_unit_id,kind,scenario,start_date);
CREATE TABLE IF NOT EXISTS public.calculation_parameter_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parameter_id uuid NOT NULL REFERENCES public.calculation_parameters(id), organization_id text NOT NULL, revision integer NOT NULL, actor_id text NOT NULL, action text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL, UNIQUE(parameter_id,revision));
ALTER TABLE public.calculation_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calculation_parameter_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calculation_parameters,public.calculation_parameter_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.calculation_parameters TO service_role;
GRANT SELECT ON public.calculation_parameter_events TO service_role;
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
 IF NEW.kind='TAX' THEN
  IF NEW.measure<>'PERCENT' OR NEW.direction<>'DEBIT' OR NEW.time_band<>'ALL' OR NEW.treatment NOT IN ('INSIDE','OUTSIDE','INCLUDED','EXEMPT','NOT_APPLICABLE') OR length(btrim(NEW.base_rule))=0 OR NEW.included_taxes<>'' THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Specify tax base and treatment'; END IF;
  IF NEW.component_code NOT IN ('ICMS','PIS','COFINS','IOF') AND NEW.component_code !~ '^OTHER_[A-Z0-9_]+$' THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Invalid tax code'; END IF;
  IF NEW.treatment IN ('EXEMPT','NOT_APPLICABLE') THEN
   IF NEW.amount_text IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='No rate for non-applicable tax'; END IF;
  ELSIF NEW.amount_text IS NULL OR NEW.amount_text::numeric>100 OR (NEW.treatment='INSIDE' AND NEW.amount_text::numeric>=100) THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Invalid tax rate'; END IF;
 ELSE
  IF NEW.amount_text IS NULL OR NEW.measure='PERCENT' OR NEW.treatment NOT IN ('NET','GROSS') OR (NEW.kind='TARIFF' AND (NEW.measure='BRL_MONTH' OR NEW.direction<>'DEBIT')) OR (NEW.kind='COST' AND length(btrim(NEW.base_rule))=0) THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Invalid tariff or cost'; END IF;
  IF (NEW.treatment='GROSS' AND length(btrim(NEW.included_taxes))=0) OR (NEW.treatment='NET' AND NEW.included_taxes<>'') THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Declare embedded taxes'; END IF;
 END IF;
 NEW.updated_at:=now();
 IF NEW.status='APPROVED' AND (TG_OP='INSERT' OR OLD.status='DRAFT') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id||':'||NEW.consumer_unit_id::text||':'||NEW.kind||':'||NEW.component_code||':'||NEW.scenario,0));
  IF EXISTS(SELECT 1 FROM public.calculation_parameters p WHERE p.id<>NEW.id AND p.organization_id=NEW.organization_id AND p.consumer_unit_id=NEW.consumer_unit_id AND p.kind=NEW.kind AND p.component_code=NEW.component_code AND p.scenario=NEW.scenario AND (p.time_band=NEW.time_band OR p.time_band='ALL' OR NEW.time_band='ALL') AND p.status='APPROVED' AND p.start_date<=NEW.end_date AND p.end_date>=NEW.start_date) THEN RAISE EXCEPTION USING ERRCODE='P3304',MESSAGE='Approved validity overlaps'; END IF;
  NEW.approved_by:=NEW.updated_by;NEW.approved_at:=now();
 END IF;
 IF NEW.status='DRAFT' THEN NEW.approved_by:=NULL;NEW.approved_at:=NULL;END IF;
 IF NEW.status='RETIRED' THEN
  IF nullif(btrim(NEW.retirement_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3301',MESSAGE='Retirement reason required';END IF;
  NEW.retired_at:=now();
 ELSE NEW.retired_at:=NULL;NEW.retirement_reason:=NULL;END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.audit_calculation_parameter() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.calculation_parameter_events(parameter_id,organization_id,revision,actor_id,action,snapshot) VALUES (NEW.id,NEW.organization_id,NEW.revision,NEW.updated_by,CASE WHEN TG_OP='INSERT' THEN 'CREATED' WHEN NEW.status='APPROVED' THEN 'APPROVED' WHEN NEW.status='RETIRED' THEN 'RETIRED' ELSE 'UPDATED' END,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.preserve_calculation_parameter_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P3302',MESSAGE='Immutable audit event';END $$;
REVOKE ALL ON FUNCTION public.guard_calculation_parameter(),public.audit_calculation_parameter(),public.preserve_calculation_parameter_event() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER calculation_parameter_guard BEFORE INSERT OR UPDATE OR DELETE ON public.calculation_parameters FOR EACH ROW EXECUTE FUNCTION public.guard_calculation_parameter();
CREATE OR REPLACE TRIGGER calculation_parameter_audit AFTER INSERT OR UPDATE ON public.calculation_parameters FOR EACH ROW EXECUTE FUNCTION public.audit_calculation_parameter();
CREATE OR REPLACE TRIGGER calculation_parameter_event_guard BEFORE UPDATE OR DELETE ON public.calculation_parameter_events FOR EACH ROW EXECUTE FUNCTION public.preserve_calculation_parameter_event();
NOTIFY pgrst,'reload schema';
COMMIT;
