BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
ALTER FUNCTION public.correct_document_type(text,text,text,integer,text,text,boolean) RENAME TO correct_document_type_before_portal_recovery;
REVOKE ALL ON FUNCTION public.correct_document_type_before_portal_recovery(text,text,text,integer,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- A narrowly scoped administrative recovery: the provider never accepted this
-- wrong-type document. Financial/relational derivatives still stop the action.
CREATE FUNCTION public.correct_document_type(p_org text,p_actor text,p_document text,p_revision integer,p_type text,p_reason text,p_checked boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.documents;c public.document_catalog;p public.portal_document_intakes;j public.document_ocr_jobs;i public.eva_automatic_intakes;ref record;used boolean;
BEGIN
 SELECT * INTO p FROM public.portal_document_intakes WHERE organization_id=p_org AND document_id=p_document AND kind='INVOICE' FOR UPDATE;
 IF p.id IS NULL OR p_type IS DISTINCT FROM 'INVOICE_SUPPLIER' THEN
  RETURN public.correct_document_type_before_portal_recovery(p_org,p_actor,p_document,p_revision,p_type,p_reason,p_checked);
 END IF;
 PERFORM public.assert_document_catalog_actor(p_org,p_actor,true,false);
 IF p_checked IS DISTINCT FROM true OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 20 AND 1000 OR NOT EXISTS(
  SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id
  WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND r.name IN('admin_org','gestor')
 ) THEN RAISE EXCEPTION 'Administrative original review required' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_document AND organization_id=p_org FOR UPDATE;
 SELECT * INTO c FROM public.document_catalog WHERE document_id=p_document AND organization_id=p_org FOR UPDATE;
 SELECT * INTO j FROM public.document_ocr_jobs WHERE document_id=p_document AND organization_id=p_org FOR UPDATE;
 IF d.id IS NULL OR c.document_id IS NULL OR j.id IS NULL OR c.revision IS DISTINCT FROM p_revision OR c.tag<>'DRAFT'
 OR NOT d.file_verified OR d.document_type<>'INVOICE_DISTRIBUTOR' OR d.invoice_id IS NOT NULL OR d.energy_contract_id IS NOT NULL
 OR d.processing_status<>'PENDING' OR d.ocr_status<>'PENDING' OR d.catalog_previous_id IS NOT NULL
 OR j.state<>'FAILED' OR j.error_code<>'IDENTITY_REVIEW_REQUIRED' OR j.operation_url IS NOT NULL OR j.submission_started_at IS NOT NULL
 OR j.file_hash<>d.file_hash OR p.file_hash<>d.file_hash OR p.record_id IS NOT NULL
 OR p.customer_id<>d.customer_id OR p.consumer_unit_id<>d.consumer_unit_id OR p.month<>to_char(d.reference_month,'YYYY-MM')
 OR EXISTS(SELECT 1 FROM public.document_ocr_results WHERE document_id=p_document)
 OR EXISTS(SELECT 1 FROM public.document_catalog WHERE series_id=c.series_id AND document_id<>p_document)
 OR EXISTS(SELECT 1 FROM public.operation_client_messages WHERE p_document=ANY(document_ids))
 OR EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.organization_id=p_org AND v.customer_id=d.customer_id AND v.month=p.month AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1) IN('APPROVED','REJECTED'))
 OR (SELECT state FROM public.portal_document_events WHERE intake_id=p.id ORDER BY created_at DESC,id DESC LIMIT 1) IN('AUTOMATION_RESERVED','VALIDATING','PUBLISHED')
 OR EXISTS(SELECT 1 FROM public.eva_automatic_intakes WHERE document_id=p_document AND (state<>'REVIEW_REQUIRED' OR closing_id IS NOT NULL OR lease_until>clock_timestamp()))
 THEN RAISE EXCEPTION 'Original has processing effects; administrative reconciliation required' USING ERRCODE='P2072';END IF;
 -- Do not silently ignore a newly introduced dependency.
 FOR ref IN SELECT n.nspname AS schema_name,t.relname AS table_name,a.attname AS column_name FROM pg_constraint fk JOIN pg_class t ON t.oid=fk.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=fk.conkey[1] JOIN pg_attribute target ON target.attrelid=fk.confrelid AND target.attnum=fk.confkey[1] WHERE fk.contype='f' AND fk.confrelid='public.documents'::regclass AND target.attname='id' AND cardinality(fk.conkey)=1 AND t.relname NOT IN('document_ocr_jobs','document_ocr_results','document_catalog','document_catalog_events','document_favorites','portal_document_intakes','eva_automatic_intakes') LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I::text=$1)',ref.schema_name,ref.table_name,ref.column_name) INTO used USING p_document;
  IF used THEN RAISE EXCEPTION 'Document has derived records in %; review required',ref.table_name USING ERRCODE='P2072';END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('invoice-month:'||jsonb_build_array(p_org,d.customer_id,d.consumer_unit_id,p.month)::text,0));
 PERFORM set_config('app.document_type_correction',jsonb_build_object('document_id',p_document,'organization_id',p_org,'before',d.document_type,'after',p_type)::text,true);
 UPDATE public.documents SET document_type=p_type WHERE id=p_document AND organization_id=p_org;
 UPDATE public.document_catalog SET reason=btrim(p_reason),actor_id=p_actor WHERE document_id=p_document AND organization_id=p_org RETURNING * INTO c;
 PERFORM set_config('app.document_type_correction','',true);
 UPDATE public.portal_document_intakes SET kind='FISCAL' WHERE id=p.id;
 INSERT INTO public.portal_document_events(organization_id,intake_id,event_key,state,source_id,note)
 VALUES(p_org,p.id,'supplier-type-recovery:'||c.revision,'REJECTED',p_document,'Tipo corrigido após conferência administrativa do original: NF do fornecedor, não fatura da distribuidora. Histórico e leitura anterior preservados.');
 FOR i IN SELECT * FROM public.eva_automatic_intakes WHERE organization_id=p_org AND document_id=p_document FOR UPDATE LOOP
  UPDATE public.eva_automatic_intakes SET customer_id=d.customer_id,unit_id=d.consumer_unit_id,month=p.month,document_type=p_type,hints=jsonb_build_object('unitId',d.consumer_unit_id,'month',p.month),state='RECOGNIZING',next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),note='Classificação corrigida após conferência do original; reconhecimento local sem repetir OCR.' WHERE id=i.id;
  PERFORM public.eva_intake_event(i.id,'SUPPLIER_TYPE_RECOVERED',jsonb_build_object('sourceHash',d.file_hash,'previousType',d.document_type,'documentType',p_type,'reason',p_reason,'actor',p_actor),p_actor);
 END LOOP;
 -- Resume only a proven distributor original blocked by the corrected receipt.
 -- Require the completed provider operation so recovery cannot cause a new POST.
 FOR i IN SELECT * FROM public.eva_automatic_intakes WHERE organization_id=p_org AND customer_id=d.customer_id AND unit_id=d.consumer_unit_id AND month=p.month AND state='REVIEW_REQUIRED' AND document_id IS NULL AND closing_id IS NULL AND document_type='INVOICE_DISTRIBUTOR' AND proof->>'state'='MATCH' AND proof->>'fileHash'=file_hash AND raw_result IS NOT NULL AND operation_url IS NOT NULL AND (lease_until IS NULL OR lease_until<clock_timestamp()) FOR UPDATE LOOP
  IF EXISTS(SELECT 1 FROM public.eva_automatic_intake_events e WHERE e.intake_id=i.id AND e.body#>>'{diagnostic,code}'='EXISTING_DOCUMENT') THEN
   UPDATE public.eva_automatic_intakes SET state='RECOGNIZING',ai_attempted=true,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),note='Conflito de classificação reconciliado. Retomada da leitura já concluída, sem novo OCR ou interpretação paga.' WHERE id=i.id;
   PERFORM public.eva_intake_event(i.id,'DUPLICATE_TYPE_RECONCILED',jsonb_build_object('correctedDocumentId',p_document,'sourceHash',i.file_hash,'reason',p_reason,'paidInterpretationSkipped',true),p_actor);
  END IF;
 END LOOP;
 RETURN to_jsonb(c)||jsonb_build_object('document_type',p_type,'recoveredPortalReceipt',p.id);
END$$;
REVOKE ALL ON FUNCTION public.correct_document_type(text,text,text,integer,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.correct_document_type(text,text,text,integer,text,text,boolean) TO service_role;
COMMIT;
