BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';

-- Operational bookkeeping only. Published reports, originals and receipts stay
-- immutable; no financial value, approval or historical snapshot is rewritten.
ALTER TABLE public.eva_automatic_intakes ADD COLUMN IF NOT EXISTS source_revision bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.eva_intake_source_fingerprint(p_id uuid,p_token uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;i public.eva_automatic_intakes;name text;predicate text;digest text;row_count bigint;parts jsonb:='[]';
BEGIN
 ctx:=public.portal_intake_work_context_scoped(p_id,p_token);
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp();
 IF i.unit_id IS NULL OR i.customer_id IS NULL THEN RAISE EXCEPTION 'Identified source required' USING ERRCODE='42501';END IF;
 FOREACH name IN ARRAY ARRAY['consumer_units','customers','documents','energy_contracts','calculation_parameters','calculation_monthly_inputs','calculation_monthly_costs','supplier_billing_rules','supplier_spot_reconciliations','calculation_cost_absences','management_contracts','management_fee_allocations','commercial_fee_adjustments','unit_demand_periods','unit_demand_approvals','tariff_library_versions'] LOOP
  predicate:='organization_id=$1';
  IF name='customers' THEN predicate:=predicate||' AND id=$2';
  ELSE
   -- A shared closing depends on sibling units as well. Otherwise the first
   -- receipt could sleep forever when a missing sibling source arrives.
   IF name<>'tariff_library_versions' THEN predicate:=predicate||' AND customer_id=$2';END IF;
  END IF;
  IF name IN('calculation_monthly_inputs','calculation_monthly_costs','management_fee_allocations','supplier_spot_reconciliations','calculation_cost_absences') THEN predicate:=predicate||' AND month=$4';END IF;
  IF name='documents' THEN predicate:=predicate||' AND (document_type NOT IN(''INVOICE_DISTRIBUTOR'',''INVOICE_SUPPLIER'') OR reference_month>=($4||''-01'')::date AND reference_month<(($4||''-01'')::date+interval ''1 month''))';END IF;
  -- Hash ordered rows without materializing a large JSON array or silently
  -- truncating the history at the 501st record.
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(md5(to_jsonb(x)::text),'''' ORDER BY x.id),'''')) FROM public.%I x WHERE %s',name,predicate)
   INTO row_count,digest USING i.organization_id,i.customer_id,i.unit_id,i.month;
  IF name='customers' AND row_count<>1 OR name='consumer_units' AND row_count=0 THEN RAISE EXCEPTION 'Source signature unavailable' USING ERRCODE='22023';END IF;
  parts:=parts||jsonb_build_array(jsonb_build_array(name,row_count,digest));
 END LOOP;
 RETURN encode(sha256(convert_to(jsonb_build_array('intake-fingerprint-3',parts,public.portal_intake_scoped_rpc('eva_intake_reference_signature',jsonb_build_object('p_id',p_id,'p_token',p_token)))::text,'UTF8')),'hex');
END$$;

CREATE OR REPLACE FUNCTION public.eva_intake_source_state(p_id uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;fingerprint text;
BEGIN
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 fingerprint:=public.eva_intake_source_fingerprint(p_id,p_token);
 RETURN jsonb_build_object('revision',i.source_revision,'fingerprint',fingerprint);
END$$;

CREATE OR REPLACE FUNCTION public.eva_intake_revision_transition(p_id uuid,p_token uuid,p_action text,p_body jsonb,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;result jsonb;
BEGIN
 IF p_action NOT IN('wait','prepared') OR p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'Invalid source acknowledgment' USING ERRCODE='22023';END IF;
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 IF p_revision>i.source_revision THEN RAISE EXCEPTION 'Source revision not observed' USING ERRCODE='22023';END IF;
 result:=public.portal_intake_scoped_rpc('transition_eva_automatic_intake',jsonb_build_object('p_id',p_id,'p_token',p_token,'p_action',p_action,'p_body',p_body));
 -- A change after the final read cannot be lost when the lease is released.
 IF i.source_revision>p_revision OR coalesce((p_body->>'sourcesChanged')::boolean,false) THEN
  UPDATE public.eva_automatic_intakes SET next_attempt_at=clock_timestamp()+interval '5 seconds'
  WHERE id=p_id AND state IN('AWAITING_SOURCES','PROPOSAL_READY');
 END IF;
 RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.wake_eva_intake_sources() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows_json jsonb;r jsonb;org text;customer text;unit text;source_month text;historical boolean;closing public.eva_assisted_closing_versions;
BEGIN
 rows_json:=CASE TG_OP WHEN 'INSERT' THEN jsonb_build_array(to_jsonb(NEW)) WHEN 'DELETE' THEN jsonb_build_array(to_jsonb(OLD)) ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END;
 FOR r IN SELECT DISTINCT value FROM jsonb_array_elements(rows_json) LOOP
  org:=r->>'organization_id';customer:=r->>'customer_id';unit:=r->>'consumer_unit_id';source_month:=NULL;historical:=false;
  IF TG_TABLE_NAME='customers' THEN customer:=r->>'id';END IF;
  IF TG_TABLE_NAME='consumer_units' THEN unit:=r->>'id';END IF;
  IF TG_TABLE_NAME='eva_intake_unit_aliases_audit' THEN unit:=r->>'unit_id';END IF;
  IF TG_TABLE_NAME='contract_price_history' THEN SELECT organization_id,customer_id,consumer_unit_id INTO org,customer,unit FROM public.energy_contracts WHERE id=r->>'contract_id';END IF;
  IF TG_TABLE_NAME='eva_assisted_closing_events' THEN
   SELECT * INTO closing FROM public.eva_assisted_closing_versions WHERE id=(r->>'closing_id')::uuid;
   org:=closing.organization_id;customer:=closing.customer_id;source_month:=closing.month;historical:=true;
  ELSIF TG_TABLE_NAME='monthly_energy_settlements' THEN source_month:=left(r->>'month',7);historical:=true;
  ELSIF TG_TABLE_NAME IN('calculation_monthly_inputs','calculation_monthly_costs','management_fee_allocations','supplier_spot_reconciliations','calculation_cost_absences') THEN source_month:=left(r->>'month',7);
  ELSIF TG_TABLE_NAME='documents' AND r->>'document_type' IN('INVOICE_DISTRIBUTOR','INVOICE_SUPPLIER') THEN source_month:=left(r->>'reference_month',7);
  END IF;
  UPDATE public.eva_automatic_intakes SET source_revision=source_revision+1,
   next_attempt_at=CASE WHEN lease_token IS NULL THEN clock_timestamp() ELSE next_attempt_at END
  WHERE organization_id=org AND(customer IS NULL OR customer_id=customer)
   AND state IN('AWAITING_SOURCES','PROPOSAL_READY','PREPARING')
   AND(source_month IS NULL OR CASE WHEN historical THEN month>=source_month ELSE month=source_month END);
 END LOOP;
 RETURN NULL;
END$$;

DO $$DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['customers','unit_demand_periods','unit_demand_approvals','eva_intake_unit_aliases_audit'] LOOP
  IF to_regclass('public.'||name) IS NOT NULL THEN
   EXECUTE format('DROP TRIGGER IF EXISTS wake_eva_automatic_intake ON public.%I',name);
   EXECUTE format('CREATE TRIGGER wake_eva_automatic_intake AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.wake_eva_intake_sources()',name);
  END IF;
 END LOOP;
END$$;

CREATE OR REPLACE FUNCTION public.eva_supplier_identity_lineage(p_org text,p_customer text,p_unit text,p_document text,p_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.ocr_identity_unit_lineage(p_org,p_customer,p_unit,u.consumer_unit_number)
 FROM public.documents d JOIN public.consumer_units u ON u.organization_id=d.organization_id AND u.customer_id=d.customer_id AND u.id=d.consumer_unit_id
 WHERE d.organization_id=p_org AND d.customer_id=p_customer AND d.consumer_unit_id=p_unit AND d.id=p_document
  AND d.file_hash=p_hash AND d.file_verified AND d.document_type='INVOICE_SUPPLIER' AND u.status='ACTIVE'
$$;

REVOKE ALL ON FUNCTION public.eva_intake_source_state(uuid,uuid),public.eva_intake_revision_transition(uuid,uuid,text,jsonb,bigint),public.eva_supplier_identity_lineage(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_source_state(uuid,uuid),public.eva_intake_revision_transition(uuid,uuid,text,jsonb,bigint),public.eva_supplier_identity_lineage(text,text,text,text,text) TO service_role;
-- Wake only pending, unpublished receipts for the new signature version.
UPDATE public.eva_automatic_intakes i SET source_revision=source_revision+1,next_attempt_at=clock_timestamp()
WHERE i.state IN('AWAITING_SOURCES','PROPOSAL_READY') AND i.lease_token IS NULL
AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_events e WHERE e.closing_id=i.closing_id AND e.state='APPROVED');
-- Align the SQL publication guard with the service's applicable terms. All
-- existing tenant, approval and fresh-source guards remain in the function.
DO $fee$ DECLARE definition text;baseline text;replacement text;BEGIN
 baseline:=$old$WHERE coalesce(nullif(m->>'savings_percentage',''),'0')::numeric>0$old$;
 replacement:=$new$WHERE m->>'status'='ACTIVE' AND coalesce(m->>'start_date','')<=to_char((p_month||'-01')::date+interval '1 month'-interval '1 day','YYYY-MM-DD') AND coalesce(m->>'end_date','9999-12-31')>=p_month||'-01' AND coalesce(nullif(m->>'savings_percentage',''),'0')::numeric>0$new$;
 SELECT pg_get_functiondef('public.eva_scoped_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,text,text,boolean)'::regprocedure) INTO definition;
 IF strpos(definition,baseline)>0 THEN EXECUTE replace(definition,baseline,replacement);
 ELSIF strpos(definition,replacement)=0 THEN RAISE EXCEPTION 'Shared closing guard baseline changed';END IF;
END $fee$;
NOTIFY pgrst,'reload schema';
COMMIT;
