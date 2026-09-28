BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.supplier_spot_reconciliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,customer_id text NOT NULL,consumer_unit_id text NOT NULL,contract_id text NOT NULL,month text NOT NULL,
 version integer NOT NULL,previous_id uuid,status text NOT NULL,document_id text NOT NULL,document_sha256 text NOT NULL,source_hash text NOT NULL,source_snapshot jsonb NOT NULL,
 reason text NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(contract_id,month,version)
);
ALTER TABLE public.supplier_spot_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_spot_reconciliations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.supplier_spot_reconciliations TO service_role;
CREATE OR REPLACE FUNCTION public.guard_supplier_spot_reconciliation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c record; d record; latest record;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Immutable reconciliation' USING ERRCODE='P1222';END IF;
 IF NEW.month !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR NEW.status NOT IN ('PENDING','APPROVED_NO_COST') OR length(btrim(NEW.reason))<20 OR length(NEW.reason)>2000 OR nullif(btrim(NEW.created_by),'') IS NULL OR NEW.source_hash !~ '^[a-f0-9]{64}$' OR NEW.document_sha256 !~ '^[a-f0-9]{64}$' OR jsonb_typeof(NEW.source_snapshot)<>'object' THEN RAISE EXCEPTION 'Invalid reconciliation' USING ERRCODE='P1221';END IF;
 SELECT e.* INTO c FROM energy_contracts e JOIN customers u ON u.id=e.customer_id AND u.organization_id=e.organization_id AND u.deleted_at IS NULL JOIN consumer_units cu ON cu.id=e.consumer_unit_id AND cu.organization_id=e.organization_id AND cu.customer_id=e.customer_id WHERE e.id=NEW.contract_id AND e.organization_id=NEW.organization_id AND e.customer_id=NEW.customer_id AND e.consumer_unit_id=NEW.consumer_unit_id;
 IF NOT FOUND OR c.contract_type<>'ENERGY_PURCHASE' OR c.status NOT IN ('ACTIVE','APPROVED') OR (NEW.month||'-01')::date<c.start_date::date OR (date_trunc('month',(NEW.month||'-01')::date)+interval '1 month - 1 day')::date>c.end_date::date THEN RAISE EXCEPTION 'Invalid contract scope' USING ERRCODE='P1221';END IF;
 SELECT * INTO d FROM documents WHERE id::text=NEW.document_id AND organization_id=NEW.organization_id AND customer_id=NEW.customer_id AND consumer_unit_id=NEW.consumer_unit_id AND file_verified=true AND left(reference_month::text,7)=NEW.month AND (energy_contract_id IS NULL OR energy_contract_id=NEW.contract_id) AND file_hash=NEW.document_sha256;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid evidence scope' USING ERRCODE='P1221';END IF;
 IF NEW.source_snapshot->>'organizationId' IS DISTINCT FROM NEW.organization_id OR NEW.source_snapshot->>'customerId' IS DISTINCT FROM NEW.customer_id OR NEW.source_snapshot->>'unitId' IS DISTINCT FROM NEW.consumer_unit_id OR NEW.source_snapshot->>'month' IS DISTINCT FROM NEW.month OR NEW.source_snapshot->'contract'->>'id' IS DISTINCT FROM NEW.contract_id THEN RAISE EXCEPTION 'Invalid source scope' USING ERRCODE='P1221';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.contract_id||':'||NEW.month,0));
 SELECT * INTO latest FROM supplier_spot_reconciliations WHERE contract_id=NEW.contract_id AND month=NEW.month ORDER BY version DESC LIMIT 1;
 IF FOUND THEN
  IF NEW.previous_id IS DISTINCT FROM latest.id THEN RAISE EXCEPTION 'Stale predecessor' USING ERRCODE='P1222';END IF;NEW.version:=latest.version+1;
 ELSE
  IF NEW.previous_id IS NOT NULL THEN RAISE EXCEPTION 'Unexpected predecessor' USING ERRCODE='P1222';END IF;NEW.version:=1;
 END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_supplier_spot_reconciliation() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER preserve_supplier_spot_reconciliation BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_spot_reconciliations FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_spot_reconciliation();
NOTIFY pgrst,'reload schema';
COMMIT;
