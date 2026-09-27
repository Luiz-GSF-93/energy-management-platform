BEGIN;
CREATE TABLE public.unit_demand_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_id uuid NOT NULL UNIQUE REFERENCES public.unit_demand_periods(id),
 organization_id text NOT NULL, customer_id text NOT NULL, consumer_unit_id text NOT NULL,
 created_by text NOT NULL CHECK(length(btrim(created_by))>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 1000),request_id uuid NOT NULL,
 UNIQUE(organization_id,request_id)
);
CREATE FUNCTION public.guard_unit_demand_approval() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE p public.unit_demand_periods; d public.documents;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'DEMAND_APPROVAL_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('demand-period:'||NEW.organization_id||':'||NEW.consumer_unit_id,0));
 SELECT * INTO p FROM public.unit_demand_periods WHERE id=NEW.period_id AND organization_id=NEW.organization_id AND customer_id=NEW.customer_id AND consumer_unit_id=NEW.consumer_unit_id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.unit_demand_periods WHERE supersedes_id=p.id) THEN RAISE EXCEPTION 'DEMAND_VERSION_STALE' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=p.consumer_unit_id AND u.organization_id=p.organization_id AND u.customer_id=p.customer_id AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'DEMAND_UNIT_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM public.documents WHERE id=p.document_id AND organization_id=p.organization_id AND customer_id=p.customer_id AND consumer_unit_id=p.consumer_unit_id FOR SHARE;
 IF NOT FOUND OR d.file_verified IS DISTINCT FROM true OR d.document_type NOT IN ('CONTRACT_ENERGY','OTHER') OR d.file_hash IS DISTINCT FROM p.document_hash THEN RAISE EXCEPTION 'DEMAND_EVIDENCE_INVALID' USING ERRCODE='23514'; END IF;
 NEW.created_at=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER unit_demand_approval_guard BEFORE INSERT OR UPDATE OR DELETE ON public.unit_demand_approvals FOR EACH ROW EXECUTE FUNCTION public.guard_unit_demand_approval();
ALTER TABLE public.unit_demand_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unit_demand_approvals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.unit_demand_approvals TO service_role;
REVOKE ALL ON FUNCTION public.guard_unit_demand_approval() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
