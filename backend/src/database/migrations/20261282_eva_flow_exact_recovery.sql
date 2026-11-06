BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- A deployment can interrupt the acknowledgement after a guarded service call.
-- Reconcile evidence; never repeat an uncertain financial write on elapsed time alone.
CREATE FUNCTION public.eva_flow_recover_receipts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.eva_operational_runs;v public.eva_assisted_closing_versions;d public.documents;
 h text;expected uuid;event_state text;proof_id uuid;proof_run uuid;recovered integer:=0;
BEGIN
 FOR r IN SELECT q.* FROM public.eva_operational_runs q JOIN public.eva_operational_policies p ON p.organization_id=q.organization_id AND p.enabled
  WHERE q.organization_id='org_default' AND q.kind='CLOSING' AND q.state='UNKNOWN' AND q.last_error='WRITE_ACKNOWLEDGEMENT_PENDING' AND q.claimed_generation IS NOT NULL
  ORDER BY q.created_at LIMIT 10 FOR UPDATE OF q SKIP LOCKED
 LOOP
  BEGIN
   PERFORM public.ccee_permanent_automation_actor(r.organization_id,(SELECT actor_id FROM public.eva_operational_policies WHERE organization_id=r.organization_id));
   PERFORM public.eva_flow_actor(r.organization_id,(SELECT actor_id FROM public.eva_operational_policies WHERE organization_id=r.organization_id),true);
  EXCEPTION WHEN insufficient_privilege THEN CONTINUE;END;
  IF (SELECT count(*) FROM public.documents WHERE organization_id=r.organization_id AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id AND document_type='INVOICE_DISTRIBUTOR' AND to_char(reference_month,'YYYY-MM')=r.month AND file_verified)<>1 THEN CONTINUE;END IF;
  SELECT * INTO d FROM public.documents WHERE organization_id=r.organization_id AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id AND document_type='INVOICE_DISTRIBUTOR' AND to_char(reference_month,'YYYY-MM')=r.month AND file_verified;
  h:=encode(sha256(convert_to('["bot-resolution-1","eva-flow-unit-1","org_default","'||r.id::text||'","'||r.claimed_generation::text||'"]','UTF8')),'hex');
  expected:=(substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid;
  SELECT * INTO v FROM public.eva_assisted_closing_versions WHERE id=expected AND organization_id=r.organization_id AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id AND month=r.month AND report#>>'{scope,kind}'='UNIT' AND jsonb_array_length(report->'unitIds')=1 AND report->'unitIds'?r.consumer_unit_id
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(report->'units') u WHERE u->>'id'=r.consumer_unit_id AND u->>'documentId'=d.id AND u->>'sourceHash'=d.file_hash);
  event_state:=NULL;IF FOUND THEN SELECT state INTO event_state FROM public.eva_assisted_closing_events WHERE closing_id=v.id AND organization_id=r.organization_id ORDER BY sequence DESC LIMIT 1;END IF;
  IF event_state IN('READY_FOR_REVIEW','INCOMPLETE','APPROVED') AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions n WHERE n.organization_id=r.organization_id AND n.customer_id=r.customer_id AND n.consumer_unit_id=r.consumer_unit_id AND n.month=r.month AND n.version>v.version) THEN
   UPDATE public.eva_operational_runs SET state=CASE WHEN generation>claimed_generation THEN 'QUEUED' ELSE 'SUCCEEDED' END,last_error=NULL,lease_id=NULL,lease_until=NULL,write_started=false,
    result=result||jsonb_build_object('closingId',v.id,'reconciledExactReceipt',true,'needsReview',v.report->'approvalEligible' IS DISTINCT FROM 'true'::jsonb,'notice','Gravação confirmada pelo recibo exato. Nenhuma preparação foi repetida.'),next_run_at=CASE WHEN generation>claimed_generation THEN now() ELSE now()+interval '1 hour' END,updated_at=now() WHERE id=r.id;
   INSERT INTO public.eva_operational_reviews(organization_id,customer_id,consumer_unit_id,month,closing_id,closing_hash,state) VALUES(r.organization_id,r.customer_id,r.consumer_unit_id,r.month,v.id,v.payload_hash,CASE WHEN event_state='APPROVED' THEN 'APPROVED' WHEN v.report->'approvalEligible'='true'::jsonb THEN 'READY_OPERATOR' ELSE 'REQUIRES_INPUT' END)
    ON CONFLICT(organization_id,consumer_unit_id,month) DO UPDATE SET closing_id=excluded.closing_id,closing_hash=excluded.closing_hash,state=excluded.state,revision=eva_operational_reviews.revision+1,updated_at=now() WHERE eva_operational_reviews.closing_id IS DISTINCT FROM excluded.closing_id;
   INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details) VALUES(r.organization_id,'system:eva-flow-recovery','EVA_FLOW_EXACT_RECEIPT_RECONCILED',gen_random_uuid(),jsonb_build_object('runId',r.id,'generation',r.claimed_generation,'closingId',v.id,'hash',v.payload_hash,'previousError',r.last_error,'financialApproval',false));
   recovered:=recovered+1;CONTINUE;
  END IF;
  -- An administrator may already have reconciled the underlying preparation
  -- through its existing no-financial-writes proof. Reuse that immutable proof.
  proof_id:=NULL;proof_run:=NULL;
  IF (SELECT count(*) FROM public.calculation_preparation_runs p WHERE p.organization_id=r.organization_id AND p.customer_id=r.customer_id AND p.consumer_unit_id=r.consumer_unit_id AND p.month=r.month AND p.created_at>=r.created_at)=1 THEN
   SELECT a.run_id,a.run_id INTO proof_id,proof_run FROM public.calculation_preparation_reconciliations a JOIN public.calculation_preparation_runs p ON p.id=a.run_id AND p.organization_id=a.organization_id
    WHERE p.organization_id=r.organization_id AND p.customer_id=r.customer_id AND p.consumer_unit_id=r.consumer_unit_id AND p.month=r.month AND p.created_at>=r.created_at
    AND a.organization_id=r.organization_id AND a.consumer_unit_id=r.consumer_unit_id AND a.month=r.month AND a.source_hash=d.file_hash AND a.original_state='UNKNOWN' AND a.effective_state='PARTIAL' AND a.proof->>'method'='NO_FINANCIAL_WRITES_AFTER_RESERVATION';
  END IF;
  IF proof_id IS NULL AND (SELECT count(*) FROM public.calculation_preparation_runs p WHERE p.organization_id=r.organization_id AND p.customer_id=r.customer_id AND p.consumer_unit_id=r.consumer_unit_id AND p.month=r.month AND p.created_at>=r.created_at)=1 THEN
   SELECT e.id,p.id INTO proof_id,proof_run FROM public.calculation_preparation_runs p JOIN public.calculation_preparation_run_events e ON e.run_id=p.id AND e.organization_id=p.organization_id AND e.sequence=2 AND e.state='PARTIAL'
    WHERE p.organization_id=r.organization_id AND p.customer_id=r.customer_id AND p.consumer_unit_id=r.consumer_unit_id AND p.month=r.month AND p.created_at>=r.created_at
    AND jsonb_array_length(e.receipts)=1 AND e.receipts#>>'{0,kind}'='ADMIN_INTERRUPTED' AND e.receipts#>>'{0,sourceHash}'=d.file_hash
    AND NOT EXISTS(SELECT 1 FROM public.calculation_parameters z WHERE z.organization_id=r.organization_id AND z.consumer_unit_id=r.consumer_unit_id AND coalesce((to_jsonb(z)->>'updated_at')::timestamptz,(to_jsonb(z)->>'created_at')::timestamptz,now())>=p.created_at)
    AND NOT EXISTS(SELECT 1 FROM public.calculation_monthly_inputs z WHERE z.organization_id=r.organization_id AND z.consumer_unit_id=r.consumer_unit_id AND z.month=r.month AND coalesce((to_jsonb(z)->>'updated_at')::timestamptz,(to_jsonb(z)->>'created_at')::timestamptz,now())>=p.created_at)
    AND NOT EXISTS(SELECT 1 FROM public.calculation_monthly_costs z WHERE z.organization_id=r.organization_id AND z.consumer_unit_id=r.consumer_unit_id AND z.month=r.month AND coalesce((to_jsonb(z)->>'updated_at')::timestamptz,(to_jsonb(z)->>'created_at')::timestamptz,now())>=p.created_at)
    AND NOT EXISTS(SELECT 1 FROM public.documents z WHERE z.organization_id=r.organization_id AND z.consumer_unit_id=r.consumer_unit_id AND to_char(z.reference_month,'YYYY-MM')=r.month AND coalesce((to_jsonb(z)->>'updated_at')::timestamptz,(to_jsonb(z)->>'created_at')::timestamptz,now())>=p.created_at);
  END IF;
  IF proof_id IS NOT NULL THEN
   UPDATE public.eva_operational_runs SET state='QUEUED',generation=generation+1,last_error=NULL,lease_id=NULL,lease_until=NULL,write_started=false,result=result||jsonb_build_object('reconciliationId',proof_id,'sourcePreparationId',proof_run,'notice','Retomada com reconciliação administrativa já comprovada; leitura original preservada.'),next_run_at=now(),updated_at=now() WHERE id=r.id;
   INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details) VALUES(r.organization_id,'system:eva-flow-recovery','EVA_FLOW_ADMIN_PROOF_REUSED',gen_random_uuid(),jsonb_build_object('runId',r.id,'reconciliationId',proof_id,'sourcePreparationId',proof_run,'previousError',r.last_error,'financialApproval',false));recovered:=recovered+1;
  END IF;
 END LOOP;RETURN recovered;
END$$;
REVOKE ALL ON FUNCTION public.eva_flow_recover_receipts() FROM PUBLIC,anon,authenticated,service_role;
DO $patch$ DECLARE source text;anchor text:='SELECT q.* INTO r FROM public.eva_operational_runs q JOIN public.eva_operational_policies a';BEGIN
 SELECT pg_get_functiondef('public.eva_flow_worker(text,uuid,uuid,jsonb)'::regprocedure) INTO source;
 IF length(source)-length(replace(source,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'Operational claim baseline changed';END IF;
 source:=replace(source,anchor,'PERFORM public.eva_flow_recover_receipts();'||chr(10)||'  '||anchor);
 anchor:='SELECT * INTO p FROM public.eva_operational_policies WHERE organization_id=r.organization_id AND enabled;'||chr(10)||'  BEGIN';
 IF length(source)-length(replace(source,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'Operational policy baseline changed';END IF;
 EXECUTE replace(source,anchor,'SELECT * INTO p FROM public.eva_operational_policies WHERE organization_id=r.organization_id AND enabled;'||chr(10)||'  IF NOT FOUND THEN RETURN NULL;END IF;'||chr(10)||'  BEGIN');
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
