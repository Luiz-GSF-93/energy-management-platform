-- Immutable diagnostic reviews. Never writes or approves monthly_energy_settlements.
BEGIN;
CREATE TABLE IF NOT EXISTS public.calculation_review_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),
 consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 month text NOT NULL CHECK (month ~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$'),
 version integer NOT NULL CHECK (version > 0),
 status text NOT NULL DEFAULT 'DRAFT' CHECK (status = 'DRAFT'),
 request_id uuid NOT NULL,
 note text NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 500),
 created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=3000000),
 payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
 UNIQUE(organization_id,consumer_unit_id,month,version),
 UNIQUE(organization_id,request_id)
);
CREATE OR REPLACE FUNCTION public.guard_calculation_review_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Review snapshots are immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=NEW.consumer_unit_id AND u.customer_id=NEW.customer_id AND u.organization_id=NEW.organization_id AND c.deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Invalid review scope' USING ERRCODE='23514';
 END IF;
 IF NEW.status IS DISTINCT FROM 'DRAFT' OR NEW.payload->>'formatVersion' IS DISTINCT FROM 'unit-review-snapshot-1.0'
 OR NEW.payload#>>'{sources,unit,id}' IS DISTINCT FROM NEW.consumer_unit_id
 OR NEW.payload#>>'{sources,unit,organization_id}' IS DISTINCT FROM NEW.organization_id
 OR NEW.payload#>>'{sources,unit,customer_id}' IS DISTINCT FROM NEW.customer_id
 OR NEW.payload#>>'{result,unit,id}' IS DISTINCT FROM NEW.consumer_unit_id
 OR NEW.payload#>>'{result,month}' IS DISTINCT FROM NEW.month
 OR jsonb_typeof(NEW.payload->'result') IS DISTINCT FROM 'object'
 OR jsonb_typeof(NEW.payload->'sources') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid review payload' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('review:'||NEW.organization_id||':'||NEW.consumer_unit_id||':'||NEW.month,0));
 SELECT coalesce(max(version),0)+1 INTO NEW.version FROM public.calculation_review_snapshots WHERE organization_id=NEW.organization_id AND consumer_unit_id=NEW.consumer_unit_id AND month=NEW.month;
 NEW.created_at=clock_timestamp();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_calculation_review_snapshot() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_calculation_review_snapshot ON public.calculation_review_snapshots;
CREATE TRIGGER guard_calculation_review_snapshot BEFORE INSERT OR UPDATE OR DELETE ON public.calculation_review_snapshots FOR EACH ROW EXECUTE FUNCTION public.guard_calculation_review_snapshot();
ALTER TABLE public.calculation_review_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calculation_review_snapshots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.calculation_review_snapshots TO service_role;
COMMENT ON TABLE public.calculation_review_snapshots IS 'Append-only preliminary unit reviews with captured inputs; never financial approval, billing or customer publication.';
NOTIFY pgrst,'reload schema';
COMMIT;
