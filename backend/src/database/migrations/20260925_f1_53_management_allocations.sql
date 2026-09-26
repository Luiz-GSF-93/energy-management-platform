BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.management_fee_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL,
 customer_id text NOT NULL, contract_id text NOT NULL, month text NOT NULL,
 version integer NOT NULL, previous_id uuid, fixed_fee_basis text NOT NULL, allocations jsonb NOT NULL,
 source text NOT NULL, reason text NOT NULL DEFAULT '', created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(contract_id,month,version)
);
ALTER TABLE public.management_fee_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.management_fee_allocations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.management_fee_allocations TO service_role;
CREATE OR REPLACE FUNCTION public.guard_management_allocation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c record; latest record; i jsonb; total numeric:=0; n integer:=0; seen text[]:=ARRAY[]::text[]; uid uuid; first_day date; last_day date;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Immutable allocation history' USING ERRCODE='P5302'; END IF;
 IF NEW.fixed_fee_basis<>'PER_UNIT' OR NEW.month !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR nullif(btrim(NEW.source),'') IS NULL OR length(NEW.source)>2000 OR length(NEW.reason)>2000 OR nullif(btrim(NEW.created_by),'') IS NULL THEN RAISE EXCEPTION 'Invalid allocation fields' USING ERRCODE='P5301'; END IF;
 first_day:=(NEW.month||'-01')::date;last_day:=(first_day+interval '1 month - 1 day')::date;
 SELECT m.* INTO c FROM management_contracts m JOIN customers u ON u.id=m.customer_id AND u.organization_id=m.organization_id AND u.deleted_at IS NULL WHERE m.id=NEW.contract_id AND m.organization_id=NEW.organization_id AND m.customer_id=NEW.customer_id;
 IF NOT FOUND OR c.remuneration_model NOT IN ('FIXED','HYBRID') OR c.status<>'ACTIVE' OR c.start_date::date>first_day OR c.end_date IS NULL OR c.end_date::date<last_day THEN RAISE EXCEPTION 'Invalid scoped contract or period' USING ERRCODE='P5301'; END IF;
 IF jsonb_typeof(NEW.allocations)<>'array' OR (c.remuneration_model='HYBRID' AND jsonb_array_length(NEW.allocations)<1) OR (c.remuneration_model='FIXED' AND jsonb_array_length(NEW.allocations)<>0) OR jsonb_array_length(NEW.allocations)>500 THEN RAISE EXCEPTION 'Invalid allocation list' USING ERRCODE='P5301'; END IF;
 FOR i IN SELECT value FROM jsonb_array_elements(NEW.allocations) LOOP
  IF jsonb_typeof(i)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(i))<>2 OR NOT(i ? 'consumerUnitId' AND i ? 'percentage') OR jsonb_typeof(i->'consumerUnitId')<>'string' OR jsonb_typeof(i->'percentage')<>'string' OR (i->>'consumerUnitId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR (i->>'percentage') !~ '^(100([.]0{1,4})?|[0-9]{1,2}([.][0-9]{1,4})?)$' THEN RAISE EXCEPTION 'Invalid allocation item' USING ERRCODE='P5301'; END IF;
  uid:=(i->>'consumerUnitId')::uuid;
  IF uid::text=ANY(seen) OR NOT EXISTS(SELECT 1 FROM consumer_units u WHERE u.id=uid::text AND u.organization_id=NEW.organization_id AND u.customer_id=NEW.customer_id) THEN RAISE EXCEPTION 'Invalid or duplicate scoped unit' USING ERRCODE='P5301'; END IF;
  seen:=array_append(seen,uid::text);total:=total+(i->>'percentage')::numeric;n:=n+1;
 END LOOP;
 IF c.remuneration_model='HYBRID' AND (total<>100 OR n<>(SELECT count(*) FROM consumer_units WHERE organization_id=NEW.organization_id AND customer_id=NEW.customer_id)) THEN RAISE EXCEPTION 'Allocation must total 100 percent' USING ERRCODE='P5301'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.contract_id::text||':'||NEW.month,0));
 SELECT * INTO latest FROM management_fee_allocations WHERE contract_id=NEW.contract_id AND month=NEW.month ORDER BY version DESC LIMIT 1;
 IF FOUND THEN
  IF NEW.previous_id IS DISTINCT FROM latest.id OR nullif(btrim(NEW.reason),'') IS NULL THEN RAISE EXCEPTION 'Stale predecessor or missing correction reason' USING ERRCODE='P5302'; END IF;NEW.version:=latest.version+1;
 ELSE
  IF NEW.previous_id IS NOT NULL THEN RAISE EXCEPTION 'Unexpected predecessor' USING ERRCODE='P5302'; END IF;NEW.version:=1;
 END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_management_allocation() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER preserve_management_allocation BEFORE INSERT OR UPDATE OR DELETE ON public.management_fee_allocations FOR EACH ROW EXECUTE FUNCTION public.guard_management_allocation();
NOTIFY pgrst,'reload schema';
COMMIT;
