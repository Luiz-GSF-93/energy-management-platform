BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';

-- Append-only administrative evidence. Original runs and their final events remain immutable.
CREATE TABLE IF NOT EXISTS public.calculation_preparation_reconciliations(
 run_id uuid PRIMARY KEY REFERENCES public.calculation_preparation_runs(id),
 organization_id text NOT NULL,customer_id text NOT NULL,consumer_unit_id text NOT NULL,month text NOT NULL,
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 original_basis text NOT NULL CHECK(original_basis ~ '^[a-f0-9]{64}$'),
 current_basis text NOT NULL CHECK(current_basis ~ '^[a-f0-9]{64}$'),
 original_state text NOT NULL CHECK(original_state='UNKNOWN'),
 effective_state text NOT NULL CHECK(effective_state='PARTIAL'),
 manual_snapshot jsonb NOT NULL CHECK(jsonb_typeof(manual_snapshot)='object'),
 actor_id text NOT NULL,note text NOT NULL CHECK(length(btrim(note)) BETWEEN 30 AND 1000),
 proof jsonb NOT NULL CHECK(jsonb_typeof(proof)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,run_id) REFERENCES public.calculation_preparation_runs(organization_id,id));
ALTER TABLE public.calculation_preparation_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calculation_preparation_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.calculation_preparation_reconciliations FROM PUBLIC,anon,authenticated,service_role;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.calculation_preparation_reconciliations'::regclass AND tgname='preparation_reconciliation_immutable') THEN
  CREATE TRIGGER preparation_reconciliation_immutable BEFORE UPDATE OR DELETE ON public.calculation_preparation_reconciliations FOR EACH ROW EXECUTE FUNCTION public.preserve_calculation_autofill();
 END IF;
END$$;

CREATE OR REPLACE FUNCTION public.calculation_preparation_effective_state(p_org text,p_run uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN e.state='UNKNOWN' AND EXISTS(
  SELECT 1 FROM public.calculation_preparation_reconciliations a WHERE a.run_id=r.id AND a.organization_id=r.organization_id
   AND a.source_hash=r.source_hash AND a.original_basis=r.source_basis AND a.manual_snapshot=coalesce(r.plan->'manualOverrides','{}'::jsonb)
 ) THEN 'PARTIAL' ELSE e.state END
 FROM public.calculation_preparation_runs r JOIN LATERAL(
  SELECT state FROM public.calculation_preparation_run_events WHERE run_id=r.id AND organization_id=r.organization_id ORDER BY sequence DESC LIMIT 1
 )e ON true WHERE r.organization_id=p_org AND r.id=p_run
$$;
REVOKE ALL ON FUNCTION public.calculation_preparation_effective_state(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the complete existing RPCs and their permission checks. Replace only state projection.
DO $$DECLARE sig text;definition text;before_r text:='(SELECT state FROM public.calculation_preparation_run_events WHERE run_id=r.id ORDER BY sequence DESC LIMIT 1)';before_x text:='(SELECT state FROM public.calculation_preparation_run_events WHERE run_id=x.id ORDER BY sequence DESC LIMIT 1)';BEGIN
 FOREACH sig IN ARRAY ARRAY['public.calculation_autofill_action(text,text,text,boolean,text,text,text,uuid,jsonb)','public.capture_eva_assisted_closing_sources(text,text,text)'] LOOP
  definition:=pg_get_functiondef(sig::regprocedure);
  IF position('public.calculation_preparation_effective_state(p_org,' in definition)>0 THEN CONTINUE;END IF;
  IF position(before_r in definition)=0 THEN RAISE EXCEPTION 'Unexpected preparation RPC definition: %',sig;END IF;
  definition:=replace(definition,before_r,'public.calculation_preparation_effective_state(p_org,r.id)');
  IF sig LIKE '%calculation_autofill_action%' THEN
   IF position(before_x in definition)=0 THEN RAISE EXCEPTION 'Unexpected history projection';END IF;
   definition:=replace(definition,before_x,'public.calculation_preparation_effective_state(p_org,x.id)');
  END IF;
  EXECUTE definition;
 END LOOP;
END$$;

DO $$BEGIN
 IF to_regprocedure('public.calculation_autofill_reconcile_running(text,text,text,boolean,text,text,uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION public.calculation_autofill_reconcile(text,text,text,boolean,text,text,uuid,jsonb) RENAME TO calculation_autofill_reconcile_running;
 END IF;
END$$;
REVOKE ALL ON FUNCTION public.calculation_autofill_reconcile_running(text,text,text,boolean,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.calculation_autofill_reconcile(p_org text,p_actor text,p_role text,p_platform boolean,p_unit text,p_month text,p_run uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.calculation_preparation_runs;e public.calculation_preparation_run_events;a public.calculation_preparation_reconciliations;latest uuid;BEGIN
 PERFORM public.calculation_autofill_action(p_org,p_actor,p_role,p_platform,'access',p_unit,p_month,null,'{}');
 SELECT * INTO r FROM public.calculation_preparation_runs WHERE organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month AND id=p_run FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO e FROM public.calculation_preparation_run_events WHERE run_id=r.id AND organization_id=p_org AND sequence=2;
 IF NOT FOUND OR e.state<>'UNKNOWN' THEN RETURN public.calculation_autofill_reconcile_running(p_org,p_actor,p_role,p_platform,p_unit,p_month,p_run,p_body);END IF;
 IF NOT p_platform AND NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles rr ON rr.id=m.role_id AND rr.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND rr.scope='organization' AND rr.name='admin_org' AND rr.permissions ? '92e1b670-ab10-483a-b825-c6e16799496d' AND rr.permissions ? 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;
 IF p_run IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['basis','currentBasis','note','sourceHash'] OR EXISTS(SELECT 1 FROM unnest(ARRAY['basis','currentBasis','sourceHash'])k WHERE jsonb_typeof(p_body->k) IS DISTINCT FROM 'string' OR p_body->>k !~ '^[a-f0-9]{64}$') OR jsonb_typeof(p_body->'note') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'note')) NOT BETWEEN 30 AND 1000 THEN RAISE EXCEPTION 'Invalid reconciliation proof' USING ERRCODE='22023';END IF;
 IF r.source_basis<>p_body->>'basis' OR r.source_hash<>p_body->>'sourceHash' THEN RAISE EXCEPTION 'Reconciliation source changed' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('calculation-autofill:'||p_org||':'||p_unit||':'||p_month,0));
 SELECT * INTO a FROM public.calculation_preparation_reconciliations WHERE run_id=r.id AND organization_id=p_org;
 IF FOUND THEN
  IF a.actor_id<>p_actor OR a.current_basis<>p_body->>'currentBasis' OR a.note<>btrim(p_body->>'note') THEN RAISE EXCEPTION 'Reconciliation already recorded' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('id',r.id,'state','PARTIAL','originalState','UNKNOWN','canPublish',false,'replayed',true);
 END IF;
 SELECT id INTO latest FROM public.calculation_preparation_runs WHERE organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month ORDER BY created_at DESC,id DESC LIMIT 1;
 IF latest IS DISTINCT FROM r.id OR jsonb_array_length(e.receipts)<>1 OR jsonb_typeof(e.receipts->0) IS DISTINCT FROM 'object' OR e.receipts->0->>'state' IS DISTINCT FROM 'VERIFY_REQUIRED' OR jsonb_typeof(e.receipts->0->'label') IS DISTINCT FROM 'string' OR (e.receipts->0)-'label'-'state'<>'{}'::jsonb THEN RAISE EXCEPTION 'Execution effects require separate review' USING ERRCODE='40001';END IF;
 IF (SELECT count(*) FROM public.documents WHERE organization_id=p_org AND customer_id=r.customer_id AND consumer_unit_id=p_unit AND document_type='INVOICE_DISTRIBUTOR' AND to_char(reference_month,'YYYY-MM')=p_month)<>1 OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=r.document_id AND organization_id=p_org AND customer_id=r.customer_id AND consumer_unit_id=p_unit AND file_verified AND file_hash=r.source_hash) THEN RAISE EXCEPTION 'Invoice changed' USING ERRCODE='40001';END IF;
 IF r.plan->'manualOverrides'->'supplierSettlement' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=r.plan->'manualOverrides'->'supplierSettlement'->>'documentId' AND d.organization_id=p_org AND d.customer_id=r.customer_id AND d.consumer_unit_id=p_unit AND d.document_type='INVOICE_SUPPLIER' AND to_char(d.reference_month,'YYYY-MM')=p_month AND d.file_verified AND d.file_hash=r.plan->'manualOverrides'->'supplierSettlement'->>'fileHash') THEN RAISE EXCEPTION 'Supplier invoice changed' USING ERRCODE='40001';END IF;
 IF r.plan->'manualOverrides'->'supplierSettlement'->'regularInvoice' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.organization_id=p_org AND d.customer_id=r.customer_id AND d.consumer_unit_id=p_unit AND d.document_type='INVOICE_SUPPLIER' AND to_char(d.reference_month,'YYYY-MM')=p_month AND d.file_verified AND position(d.id in (r.plan->'manualOverrides'->'supplierSettlement'->'regularInvoice'->>'source'))>0 AND position(d.file_hash in (r.plan->'manualOverrides'->'supplierSettlement'->'regularInvoice'->>'source'))>0) THEN RAISE EXCEPTION 'Regular invoice proof changed' USING ERRCODE='40001';END IF;
 -- Fail closed if any financial source was created/changed after reservation, even if a response was lost.
 IF EXISTS(SELECT 1 FROM public.calculation_parameters WHERE organization_id=p_org AND consumer_unit_id=p_unit AND greatest(created_at,updated_at)>=r.created_at)
 OR EXISTS(SELECT 1 FROM public.calculation_monthly_inputs WHERE organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month AND greatest(created_at,updated_at)>=r.created_at)
 OR EXISTS(SELECT 1 FROM public.calculation_monthly_costs WHERE organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month AND greatest(created_at,updated_at)>=r.created_at)
 OR EXISTS(SELECT 1 FROM public.documents WHERE organization_id=p_org AND customer_id=r.customer_id AND consumer_unit_id=p_unit AND to_char(reference_month,'YYYY-MM')=p_month AND greatest(created_at,updated_at)>=r.created_at)
 THEN RAISE EXCEPTION 'Financial writes or document changes need reconciliation' USING ERRCODE='40001';END IF;
 INSERT INTO public.calculation_preparation_reconciliations(run_id,organization_id,customer_id,consumer_unit_id,month,source_hash,original_basis,current_basis,original_state,effective_state,manual_snapshot,actor_id,note,proof)
 VALUES(r.id,p_org,r.customer_id,p_unit,p_month,r.source_hash,r.source_basis,p_body->>'currentBasis','UNKNOWN','PARTIAL',coalesce(r.plan->'manualOverrides','{}'::jsonb),p_actor,btrim(p_body->>'note'),jsonb_build_object('method','NO_FINANCIAL_WRITES_AFTER_RESERVATION','originalActor',r.actor_id,'originalReceipts',e.receipts,'checkedAt',clock_timestamp(),'financialApproval',false,'requiresNewPreparation',true));
 RETURN jsonb_build_object('id',r.id,'state','PARTIAL','originalState','UNKNOWN','canPublish',false,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.calculation_autofill_reconcile(text,text,text,boolean,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.calculation_autofill_reconcile(text,text,text,boolean,text,text,uuid,jsonb) TO service_role;
COMMIT;
