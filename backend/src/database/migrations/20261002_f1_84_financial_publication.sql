-- Financial publication reuses the reviewed backend engine and the existing settlement table.
-- Precondition: inspected production catalog, RLS enabled, one legacy DRAFT in a test tenant.
-- No management_billings, payments or invoices are written by this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.capture_financial_sources(p_org text,p_customer text,p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE
 names text[]:=ARRAY['customers','consumer_units','calculation_parameters','energy_contracts','management_contracts','service_agreements','calculation_monthly_inputs','calculation_monthly_costs','management_fee_allocations','supplier_billing_rules','commercial_fee_adjustments','calculation_cost_absences','supplier_spot_reconciliations','documents','contract_price_history','document_ocr_results','document_ocr_demand_reviews','unit_demand_periods','unit_demand_approvals'];
 name text; rows jsonb; tables jsonb:='{}'; ids text[]; contracts text[]; docs text[];
BEGIN
 IF p_month IS NULL OR p_month !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND organization_id=p_org AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Invalid financial scope' USING ERRCODE='P8401';
 END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM public.consumer_units WHERE organization_id=p_org AND customer_id=p_customer;
 IF coalesce(cardinality(ids),0)=0 OR cardinality(ids)>100 THEN RAISE EXCEPTION 'Invalid financial units' USING ERRCODE='P8401'; END IF;
 SELECT array_agg(id) INTO contracts FROM public.energy_contracts WHERE organization_id=p_org AND consumer_unit_id=ANY(ids);
 SELECT array_agg(id) INTO docs FROM public.documents WHERE organization_id=p_org AND customer_id=p_customer AND consumer_unit_id=ANY(ids);
 FOREACH name IN ARRAY names LOOP
  IF name='contract_price_history' THEN
   EXECUTE format('SELECT coalesce(jsonb_agg(j ORDER BY j->>''id''),''[]''::jsonb) FROM (SELECT to_jsonb(t) j FROM public.%I t) q WHERE j->>''contract_id''=ANY($1)',name) INTO rows USING contracts;
  ELSIF name IN ('document_ocr_results','document_ocr_demand_reviews') THEN
   EXECUTE format('SELECT coalesce(jsonb_agg(j ORDER BY j->>''id'',j->>''document_id''),''[]''::jsonb) FROM (SELECT to_jsonb(t) j FROM public.%I t) q WHERE j->>''organization_id''=$1 AND j->>''document_id''=ANY($2)',name) INTO rows USING p_org,docs;
  ELSE
   EXECUTE format('SELECT coalesce(jsonb_agg(j ORDER BY j->>''id''),''[]''::jsonb) FROM (SELECT to_jsonb(t) j FROM public.%I t) q WHERE j->>''organization_id''=$1 AND (j->>''customer_id''=$2 OR j->>''consumer_unit_id''=ANY($3) OR ($4=''consumer_units'' AND j->>''id''=ANY($3)) OR ($4=''customers'' AND j->>''id''=$2))',name) INTO rows USING p_org,p_customer,ids,name;
  END IF;
  IF jsonb_array_length(rows)>20000 THEN RAISE EXCEPTION 'Capture too large' USING ERRCODE='P8401'; END IF;
  tables:=tables||jsonb_build_object(name,rows);
 END LOOP;
 -- Display-name lookups cannot change a financial calculation or cause false source drift.
 tables:=tables||jsonb_build_object('organization_members','[]'::jsonb,'user_profiles','[]'::jsonb);
 IF octet_length(tables::text)>12000000 THEN RAISE EXCEPTION 'Capture too large' USING ERRCODE='P8401'; END IF;
 RETURN jsonb_build_object('formatVersion','financial-sources-1.0','organizationId',p_org,'customerId',p_customer,'month',p_month,'tables',tables);
END $$;
REVOKE ALL ON FUNCTION public.capture_financial_sources(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_financial_sources(text,text,text) TO service_role;
ALTER TABLE public.monthly_energy_settlements
 ADD COLUMN IF NOT EXISTS organization_id text REFERENCES public.organizations(id),
 ADD COLUMN IF NOT EXISTS customer_id text REFERENCES public.customers(id),
 ADD COLUMN IF NOT EXISTS financial_group_id uuid,
 ADD COLUMN IF NOT EXISTS financial_request_id uuid,
 ADD COLUMN IF NOT EXISTS financial_format text,
 ADD COLUMN IF NOT EXISTS financial_payload jsonb,
 ADD COLUMN IF NOT EXISTS financial_hash text,
 ADD COLUMN IF NOT EXISTS preparation_note text,
 ADD COLUMN IF NOT EXISTS approval_note text,
 ADD COLUMN IF NOT EXISTS publication_note text,
 ADD COLUMN IF NOT EXISTS published_by text,
 ADD COLUMN IF NOT EXISTS financial_reservations jsonb;
-- Keep the legacy row untouched; new versions append instead of replacing prior publications.
ALTER TABLE public.monthly_energy_settlements DROP CONSTRAINT IF EXISTS monthly_energy_settlements_energy_contract_id_month_key;
CREATE UNIQUE INDEX IF NOT EXISTS settlements_contract_month_version ON public.monthly_energy_settlements(energy_contract_id,month,version_number);
CREATE UNIQUE INDEX IF NOT EXISTS settlements_financial_request ON public.monthly_energy_settlements(organization_id,consumer_unit_id,financial_request_id) WHERE financial_format IS NOT NULL;
CREATE INDEX IF NOT EXISTS settlements_financial_scope ON public.monthly_energy_settlements(organization_id,customer_id,month,version_number DESC) WHERE financial_format IS NOT NULL;
CREATE OR REPLACE FUNCTION public.guard_financial_settlement() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.financial_format IS NOT NULL OR OLD.published_at IS NOT NULL THEN RAISE EXCEPTION 'Immutable settlement' USING ERRCODE='P8402'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.published_at IS NOT NULL THEN RAISE EXCEPTION 'Immutable publication' USING ERRCODE='P8402'; END IF;
  IF OLD.financial_format IS NULL THEN IF NEW.financial_format IS NOT NULL THEN RAISE EXCEPTION 'Legacy versions must not be overwritten' USING ERRCODE='P8402'; END IF; RETURN NEW; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at','approval_note','published_at','published_by','publication_note','updated_at','validation_status','validation_date']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at','approval_note','published_at','published_by','publication_note','updated_at','validation_status','validation_date']) THEN RAISE EXCEPTION 'Immutable financial sources' USING ERRCODE='P8402'; END IF;
  IF OLD.status='DRAFT' AND NEW.status='APPROVED' THEN
   IF NEW.validation_status IS DISTINCT FROM 'VALIDATED' OR NEW.validation_date IS NULL OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL OR coalesce(length(btrim(NEW.approval_note)),0)<20 OR NEW.published_at IS NOT NULL THEN RAISE EXCEPTION 'Invalid approval' USING ERRCODE='P8401'; END IF;
  ELSIF OLD.status='APPROVED' AND NEW.status='PUBLISHED' THEN
   IF NEW.validation_status IS DISTINCT FROM OLD.validation_status OR NEW.validation_date IS DISTINCT FROM OLD.validation_date OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approval_note IS DISTINCT FROM OLD.approval_note OR NEW.published_at IS NULL OR NEW.published_by IS NULL OR coalesce(length(btrim(NEW.publication_note)),0)<20 THEN RAISE EXCEPTION 'Invalid publication' USING ERRCODE='P8401'; END IF;
  ELSE RAISE EXCEPTION 'Invalid financial transition' USING ERRCODE='P8402'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.financial_format IS NULL THEN RETURN NEW; END IF;
 IF NEW.financial_format IS DISTINCT FROM 'financial-settlement-1.0' OR NEW.status IS DISTINCT FROM 'DRAFT' OR NEW.financial_group_id IS NULL OR NEW.financial_request_id IS NULL
 OR NEW.financial_hash !~ '^[0-9a-f]{64}$' OR NEW.financial_hash IS NULL OR NEW.financial_payload IS NULL OR octet_length(NEW.financial_payload::text)>16000000
 OR NEW.financial_payload->>'formatVersion' IS DISTINCT FROM NEW.financial_format
 OR NEW.financial_payload#>>'{sources,organizationId}' IS DISTINCT FROM NEW.organization_id
 OR NEW.financial_payload#>>'{sources,customerId}' IS DISTINCT FROM NEW.customer_id
 OR NEW.financial_payload#>>'{sources,month}' IS DISTINCT FROM to_char(NEW.month,'YYYY-MM')
 OR jsonb_typeof(NEW.financial_reservations) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.financial_reservations)=0
 OR coalesce(length(btrim(NEW.created_by)),0)=0 OR coalesce(length(btrim(NEW.preparation_note)),0)<20
 OR NEW.consumption_kwh IS NULL OR NEW.regulated_cost IS NULL OR NEW.acl_cost IS NULL OR NEW.gross_savings IS NULL OR NEW.deductions IS NULL OR NEW.net_savings IS NULL OR NEW.honorarie IS NULL
 OR NEW.financial_payload->'reservations' IS DISTINCT FROM NEW.financial_reservations
 OR NEW.financial_payload#>>'{financial,status}' IS DISTINCT FROM 'AVAILABLE'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.financial_payload#>'{financial,units}') f WHERE f->>'id'=NEW.consumer_unit_id AND (f->>'acr')::numeric=NEW.regulated_cost AND (f->>'aclBeforeFees')::numeric=NEW.acl_cost AND (f->>'totalFees')::numeric=NEW.honorarie AND (f->>'savingsAfterFees')::numeric=NEW.net_savings)
 OR NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.energy_contracts c ON c.consumer_unit_id=u.id AND c.organization_id=u.organization_id WHERE u.id=NEW.consumer_unit_id AND u.organization_id=NEW.organization_id AND u.customer_id=NEW.customer_id AND c.id=NEW.energy_contract_id)
 THEN RAISE EXCEPTION 'Invalid financial settlement' USING ERRCODE='P8401'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_financial_settlement() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_financial_settlement ON public.monthly_energy_settlements;
CREATE TRIGGER guard_financial_settlement BEFORE INSERT OR UPDATE OR DELETE ON public.monthly_energy_settlements FOR EACH ROW EXECUTE FUNCTION public.guard_financial_settlement();
CREATE OR REPLACE FUNCTION public.prepare_financial_settlement(p_org text,p_customer text,p_month text,p_actor text,p_request uuid,p_note text,p_payload jsonb,p_hash text,p_reservations jsonb,p_units jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE group_id uuid; existing public.monthly_energy_settlements; unit jsonb; next_version integer; expected integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:'||p_org||':'||p_customer||':'||p_month,0));
 SELECT * INTO existing FROM public.monthly_energy_settlements WHERE organization_id=p_org AND financial_request_id=p_request LIMIT 1;
 IF FOUND THEN
  IF existing.customer_id IS DISTINCT FROM p_customer OR to_char(existing.month,'YYYY-MM') IS DISTINCT FROM p_month OR existing.created_by IS DISTINCT FROM p_actor OR existing.preparation_note IS DISTINCT FROM p_note THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='P8402'; END IF;
  RETURN existing.financial_group_id;
 END IF;
 IF p_payload->'sources' IS DISTINCT FROM public.capture_financial_sources(p_org,p_customer,p_month) THEN RAISE EXCEPTION 'Sources changed' USING ERRCODE='P8403'; END IF;
 SELECT count(*) INTO expected FROM public.consumer_units WHERE organization_id=p_org AND customer_id=p_customer;
 IF jsonb_typeof(p_units) IS DISTINCT FROM 'array' OR jsonb_array_length(p_units)<>expected OR (SELECT count(DISTINCT x->>'unitId') FROM jsonb_array_elements(p_units)x)<>expected
 OR p_payload#>>'{financial,status}' IS DISTINCT FROM 'AVAILABLE' THEN RAISE EXCEPTION 'Invalid financial units' USING ERRCODE='P8401'; END IF;
 group_id:=gen_random_uuid();
 SELECT coalesce(max(s.version_number),0)+1 INTO next_version FROM public.monthly_energy_settlements s JOIN public.consumer_units u ON u.id=s.consumer_unit_id WHERE u.organization_id=p_org AND u.customer_id=p_customer AND s.month=(p_month||'-01')::date;
 FOR unit IN SELECT value FROM jsonb_array_elements(p_units) LOOP
  INSERT INTO public.monthly_energy_settlements(energy_contract_id,consumer_unit_id,month,status,consumption_kwh,regulated_cost,acl_cost,gross_savings,deductions,net_savings,honorarie,version_number,created_by,organization_id,customer_id,financial_group_id,financial_request_id,financial_format,financial_payload,financial_hash,preparation_note,financial_reservations)
  VALUES(unit->>'contractId',unit->>'unitId',(p_month||'-01')::date,'DRAFT',(unit->>'consumptionKwh')::numeric,(unit->>'acr')::numeric,(unit->>'aclBeforeFees')::numeric,(unit->>'savingsBeforeFees')::numeric,(unit->>'totalFees')::numeric,(unit->>'savingsAfterFees')::numeric,(unit->>'totalFees')::numeric,next_version,p_actor,p_org,p_customer,group_id,p_request,'financial-settlement-1.0',p_payload,p_hash,p_note,p_reservations);
 END LOOP;
 RETURN group_id;
END $$;
CREATE OR REPLACE FUNCTION public.transition_financial_settlement(p_org text,p_group uuid,p_actor text,p_hash text,p_action text,p_note text,p_ack boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.monthly_energy_settlements; desired text; actual integer; expected integer;
BEGIN
 SELECT * INTO s FROM public.monthly_energy_settlements WHERE organization_id=p_org AND financial_group_id=p_group LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial version not found' USING ERRCODE='P8404'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('financial:'||p_org||':'||s.customer_id||':'||to_char(s.month,'YYYY-MM'),0));
 SELECT * INTO s FROM public.monthly_energy_settlements WHERE organization_id=p_org AND financial_group_id=p_group ORDER BY id LIMIT 1 FOR UPDATE;
 IF p_action NOT IN ('APPROVE','PUBLISH') OR p_action IS NULL OR coalesce(length(btrim(p_actor)),0)=0 OR NOT coalesce(p_ack,false) OR coalesce(length(btrim(p_note)),0) NOT BETWEEN 20 AND 2000 OR s.financial_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Invalid financial acknowledgement' USING ERRCODE='P8401'; END IF;
 desired:=CASE p_action WHEN 'APPROVE' THEN 'APPROVED' ELSE 'PUBLISHED' END;
 IF s.status=desired THEN RETURN p_group; END IF;
 IF s.status IS DISTINCT FROM (CASE p_action WHEN 'APPROVE' THEN 'DRAFT' ELSE 'APPROVED' END) THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='P8402'; END IF;
 IF s.financial_payload->'sources' IS DISTINCT FROM public.capture_financial_sources(p_org,s.customer_id,to_char(s.month,'YYYY-MM')) THEN RAISE EXCEPTION 'Sources changed' USING ERRCODE='P8403'; END IF;
 SELECT count(*) INTO expected FROM public.consumer_units WHERE organization_id=p_org AND customer_id=s.customer_id;
 SELECT count(*) INTO actual FROM public.monthly_energy_settlements WHERE organization_id=p_org AND financial_group_id=p_group AND financial_hash=p_hash AND status=s.status;
 IF actual<>expected THEN RAISE EXCEPTION 'Incomplete financial group' USING ERRCODE='P8402'; END IF;
 IF EXISTS(SELECT 1 FROM public.monthly_energy_settlements WHERE organization_id=p_org AND customer_id=s.customer_id AND month=s.month AND financial_format IS NOT NULL AND version_number>s.version_number) THEN RAISE EXCEPTION 'Newer version exists' USING ERRCODE='P8402'; END IF;
 IF p_action='APPROVE' THEN
  UPDATE public.monthly_energy_settlements SET status='APPROVED',validation_status='VALIDATED',validation_date=clock_timestamp() AT TIME ZONE 'UTC',approved_by=p_actor,approved_at=clock_timestamp() AT TIME ZONE 'UTC',approval_note=p_note,updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE organization_id=p_org AND financial_group_id=p_group;
 ELSE
  UPDATE public.monthly_energy_settlements SET status='PUBLISHED',published_by=p_actor,published_at=clock_timestamp() AT TIME ZONE 'UTC',publication_note=p_note,updated_at=clock_timestamp() AT TIME ZONE 'UTC' WHERE organization_id=p_org AND financial_group_id=p_group;
 END IF;
 RETURN p_group;
END $$;
REVOKE ALL ON FUNCTION public.prepare_financial_settlement(text,text,text,text,uuid,text,jsonb,text,jsonb,jsonb), public.transition_financial_settlement(text,uuid,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_financial_settlement(text,text,text,text,uuid,text,jsonb,text,jsonb,jsonb),public.transition_financial_settlement(text,uuid,text,text,text,text,boolean) TO service_role;
ALTER TABLE public.monthly_energy_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monthly_energy_settlements FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.monthly_energy_settlements TO service_role;
COMMENT ON COLUMN public.monthly_energy_settlements.financial_payload IS 'Immutable customer-wide source capture and backend calculation. Subsequent CCEE evidence requires a new version.';
NOTIFY pgrst,'reload schema';
COMMIT;
