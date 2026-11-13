-- Owner-operated technical maintenance. All application roles remain denied.
-- Queue only an exact preserved source whose newer preparation is recorded.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.eva_intake_resume_verified_preparation(p_org text,p_id uuid,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET TimeZone='UTC' SET statement_timeout='8s' SET lock_timeout='2s' AS $$
DECLARE i public.eva_automatic_intakes;v public.eva_assisted_closing_versions;closing_state text;runs jsonb;
BEGIN
 IF p_org IS NULL OR p_id IS NULL OR p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'Explicit receipt version required' USING ERRCODE='PT409';END IF;
 SELECT * INTO i FROM public.eva_automatic_intakes WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Receipt unavailable' USING ERRCODE='PT409';END IF;
 IF EXISTS(SELECT 1 FROM public.eva_automatic_intake_events e WHERE e.organization_id=p_org AND e.intake_id=i.id AND e.event='VERIFIED_PREPARATION_RESUMED' AND e.actor_id='system:verified-preparation-receipts' AND e.body->'previousUpdatedAt'=to_jsonb(p_expected_updated_at) AND e.body->>'sourceHash'=i.file_hash AND e.body->>'documentId'=i.document_id AND e.body->>'unitId'=i.unit_id AND e.body->>'customerId'=i.customer_id) THEN
  RETURN jsonb_build_object('id',i.id,'state',i.state,'closingId',i.closing_id,'replayed',true,'financialWrites',false);
 END IF;
 IF i.updated_at IS DISTINCT FROM p_expected_updated_at OR i.state IS DISTINCT FROM 'UNKNOWN' OR i.lease_token IS NOT NULL
  OR i.external IS DISTINCT FROM false OR i.consent IS DISTINCT FROM true OR i.stored IS DISTINCT FROM true
  OR i.document_type IS DISTINCT FROM 'INVOICE_DISTRIBUTOR' OR i.document_id IS NULL OR i.proof->>'state' IS DISTINCT FROM 'MATCH' THEN RAISE EXCEPTION 'Receipt requires separate review' USING ERRCODE='PT409';END IF;
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE))<>1
  OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management AND document_management)
  OR NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.organization_id=u.organization_id AND c.id=u.customer_id JOIN public.organizations o ON o.id=u.organization_id WHERE u.organization_id=p_org AND u.id=i.unit_id AND u.customer_id=i.customer_id AND u.status='ACTIVE' AND c.status='ACTIVE' AND c.deleted_at IS NULL AND o.deleted_at IS NULL)
  OR NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=i.document_id AND d.organization_id=p_org AND d.customer_id=i.customer_id AND d.consumer_unit_id=i.unit_id AND d.document_type='INVOICE_DISTRIBUTOR' AND to_char(d.reference_month,'YYYY-MM')=i.month AND d.file_verified AND d.file_hash=i.file_hash AND EXISTS(SELECT 1 FROM public.document_ocr_jobs j WHERE j.organization_id=p_org AND j.document_id=d.id AND j.file_hash=i.file_hash AND j.state='SUCCEEDED'))
  OR (SELECT count(*) FROM public.documents d WHERE d.organization_id=p_org AND d.customer_id=i.customer_id AND d.consumer_unit_id=i.unit_id AND d.document_type='INVOICE_DISTRIBUTOR' AND to_char(d.reference_month,'YYYY-MM')=i.month)<>1 THEN RAISE EXCEPTION 'Preserved source unavailable' USING ERRCODE='PT409';END IF;
 SELECT * INTO v FROM public.eva_assisted_closing_versions x WHERE x.organization_id=p_org AND x.customer_id=i.customer_id AND x.month=i.month AND EXISTS(SELECT 1 FROM jsonb_array_elements(x.report->'units')u WHERE u->>'id'=i.unit_id) ORDER BY x.version DESC,x.created_at DESC,x.id DESC LIMIT 1;
 IF NOT FOUND OR v.created_at<i.updated_at OR (SELECT count(*) FROM jsonb_array_elements(v.report->'units')u WHERE u->>'id'=i.unit_id)<>1
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units')u WHERE u->>'id'=i.unit_id AND u->>'documentId'=i.document_id AND u->>'sourceHash'=i.file_hash)
  OR coalesce(v.report#>>'{scope,kind}','CUSTOMER') NOT IN('UNIT','CUSTOMER') OR jsonb_typeof(v.report->'unitIds') IS DISTINCT FROM 'array' OR NOT coalesce(v.report->'unitIds'?i.unit_id,false)
  OR v.report#>>'{scope,kind}'='UNIT' AND(v.report#>'{scope,unitIds}' IS DISTINCT FROM jsonb_build_array(i.unit_id) OR v.report->'unitIds' IS DISTINCT FROM jsonb_build_array(i.unit_id)) THEN RAISE EXCEPTION 'Newer exact preparation receipt required' USING ERRCODE='PT409';END IF;
 SELECT e.state INTO closing_state FROM public.eva_assisted_closing_events e WHERE e.organization_id=p_org AND e.closing_id=v.id ORDER BY e.sequence DESC LIMIT 1;
 IF closing_state IS NULL OR closing_state NOT IN('READY_FOR_REVIEW','INCOMPLETE')
  OR EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions x WHERE x.organization_id=p_org AND x.customer_id=i.customer_id AND x.month=i.month AND public.eva_intake_approval_overlaps(x.report,i.unit_id) AND(SELECT state FROM public.eva_assisted_closing_events e WHERE e.organization_id=p_org AND e.closing_id=x.id ORDER BY sequence DESC LIMIT 1) IN('PREPARING','UNKNOWN','APPROVED'))
  OR NOT EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=p_org AND r.consumer_unit_id=i.unit_id AND r.month=i.month AND r.document_id=i.document_id AND r.source_hash=i.file_hash)
  OR EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=p_org AND r.consumer_unit_id=i.unit_id AND r.month=i.month AND(r.customer_id IS DISTINCT FROM i.customer_id OR r.document_id IS DISTINCT FROM i.document_id OR r.source_hash IS DISTINCT FROM i.file_hash OR coalesce(public.calculation_preparation_effective_state(p_org,r.id),'RUNNING') NOT IN('PREPARED','PARTIAL')))
  OR EXISTS(SELECT 1 FROM public.eva_manual_preparations j WHERE j.organization_id=p_org AND j.customer_id=i.customer_id AND j.month=i.month AND(j.state='UNKNOWN' OR j.state='RUNNING' AND j.lease_until>clock_timestamp()))
  OR EXISTS(SELECT 1 FROM public.eva_automatic_intakes j WHERE j.organization_id=p_org AND j.customer_id=i.customer_id AND j.month=i.month AND j.state='PREPARING' AND j.lease_until>clock_timestamp())
  OR EXISTS(SELECT 1 FROM public.eva_operational_runs j WHERE j.organization_id=p_org AND j.customer_id=i.customer_id AND j.month=i.month AND j.kind='CLOSING' AND j.state='RUNNING' AND j.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'Preparation effects require separate reconciliation' USING ERRCODE='PT409';END IF;
 SELECT jsonb_agg(jsonb_build_object('runId',r.id,'sourceHash',r.source_hash,'basis',r.source_basis,'effectiveState',public.calculation_preparation_effective_state(p_org,r.id)) ORDER BY r.created_at,r.id) INTO runs FROM public.calculation_preparation_runs r WHERE r.organization_id=p_org AND r.consumer_unit_id=i.unit_id AND r.month=i.month;
 UPDATE public.eva_automatic_intakes SET state='AWAITING_SOURCES',closing_id=v.id,signature=NULL,source_revision=source_revision+1,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),note='Retomada técnica registrada com leitura e identidade preservadas. Proposta já gravada vinculada; a EVA reconferirá as fontes sem reenviar o original.' WHERE id=i.id;
 PERFORM public.eva_intake_event(i.id,'VERIFIED_PREPARATION_RESUMED',jsonb_build_object('previousUpdatedAt',p_expected_updated_at,'documentId',i.document_id,'unitId',i.unit_id,'customerId',i.customer_id,'sourceHash',i.file_hash,'closingId',v.id,'runs',runs,'financialApproval',false,'financialWrites',false,'repeatOcr',false),'system:verified-preparation-receipts');
 RETURN jsonb_build_object('id',i.id,'state','AWAITING_SOURCES','closingId',v.id,'replayed',false,'financialWrites',false,'financialApproval',false,'repeatOcr',false);
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_resume_verified_preparation(text,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
