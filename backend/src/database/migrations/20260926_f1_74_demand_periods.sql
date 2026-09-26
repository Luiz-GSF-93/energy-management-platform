BEGIN;
CREATE TABLE public.unit_demand_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id), customer_id text NOT NULL REFERENCES public.customers(id), consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 start_date date NOT NULL,end_date date NOT NULL CHECK(end_date>=start_date),modality text NOT NULL CHECK(modality IN ('GREEN','BLUE')),
 single_kw text,peak_kw text,off_peak_kw text,
 document_id text NOT NULL REFERENCES public.documents(id),document_hash text NOT NULL CHECK(document_hash ~ '^[a-f0-9]{64}$'),document_name text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),supersedes_id uuid REFERENCES public.unit_demand_periods(id),request_id uuid NOT NULL,created_by text NOT NULL CHECK(length(btrim(created_by))>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,request_id),UNIQUE(supersedes_id),
 CHECK((modality='GREEN' AND single_kw IS NOT NULL AND peak_kw IS NULL AND off_peak_kw IS NULL) OR (modality='BLUE' AND single_kw IS NULL AND peak_kw IS NOT NULL AND off_peak_kw IS NOT NULL)),
 CHECK(single_kw IS NULL OR single_kw ~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$'),CHECK(peak_kw IS NULL OR peak_kw ~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$'),CHECK(off_peak_kw IS NULL OR off_peak_kw ~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$')
);
CREATE FUNCTION public.guard_unit_demand_period() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE d public.documents;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'DEMAND_HISTORY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('demand-period:'||NEW.organization_id||':'||NEW.consumer_unit_id,0));
 IF EXISTS(SELECT 1 FROM public.unit_demand_periods WHERE organization_id=NEW.organization_id AND request_id=NEW.request_id) THEN RAISE EXCEPTION 'DEMAND_REQUEST_EXISTS' USING ERRCODE='23505'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=NEW.consumer_unit_id AND u.customer_id=NEW.customer_id AND u.organization_id=NEW.organization_id AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'DEMAND_UNIT_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM public.documents WHERE id=NEW.document_id AND organization_id=NEW.organization_id AND customer_id=NEW.customer_id AND consumer_unit_id=NEW.consumer_unit_id FOR SHARE;
 IF NOT FOUND OR d.file_verified IS DISTINCT FROM true OR d.document_type NOT IN ('CONTRACT_ENERGY','OTHER') OR d.file_hash IS DISTINCT FROM NEW.document_hash THEN RAISE EXCEPTION 'DEMAND_EVIDENCE_INVALID' USING ERRCODE='23514'; END IF;
 NEW.document_name=d.original_filename;
 IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.unit_demand_periods p WHERE p.id=NEW.supersedes_id AND p.organization_id=NEW.organization_id AND p.consumer_unit_id=NEW.consumer_unit_id AND NOT EXISTS(SELECT 1 FROM public.unit_demand_periods n WHERE n.supersedes_id=p.id)) THEN RAISE EXCEPTION 'DEMAND_VERSION_STALE' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.unit_demand_periods p WHERE p.organization_id=NEW.organization_id AND p.consumer_unit_id=NEW.consumer_unit_id AND p.id IS DISTINCT FROM NEW.supersedes_id AND p.start_date<=NEW.end_date AND p.end_date>=NEW.start_date AND NOT EXISTS(SELECT 1 FROM public.unit_demand_periods n WHERE n.supersedes_id=p.id)) THEN RAISE EXCEPTION 'DEMAND_PERIOD_OVERLAP' USING ERRCODE='23P01'; END IF;
 NEW.created_at=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER unit_demand_period_guard BEFORE INSERT OR UPDATE OR DELETE ON public.unit_demand_periods FOR EACH ROW EXECUTE FUNCTION public.guard_unit_demand_period();
ALTER TABLE public.unit_demand_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unit_demand_periods FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.unit_demand_periods TO service_role;
REVOKE ALL ON FUNCTION public.guard_unit_demand_period() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
