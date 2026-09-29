BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.checked_ocr_monthly_source(p_org text,p_document text,p_refs jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.documents; u public.consumer_units; c public.customers; r record; k text; reg jsonb; measures jsonb; evidence jsonb='[]'::jsonb; target text;
BEGIN
 IF jsonb_typeof(p_refs) IS DISTINCT FROM 'object' OR jsonb_typeof(p_refs->'identity') IS DISTINCT FROM 'object' OR jsonb_typeof(p_refs->'consumption') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_refs->'identity'))<>6 OR (SELECT count(*) FROM jsonb_object_keys(p_refs->'consumption'))<>3 THEN RAISE EXCEPTION 'Invalid review references' USING ERRCODE='P4090'; END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_document AND organization_id=p_org FOR SHARE;
 IF NOT FOUND OR d.file_verified IS DISTINCT FROM true OR d.document_type IS DISTINCT FROM 'INVOICE_DISTRIBUTOR' THEN RAISE EXCEPTION 'Invalid OCR document' USING ERRCODE='P4090';END IF;
 SELECT * INTO c FROM public.customers WHERE id=d.customer_id AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR c.status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Inactive customer' USING ERRCODE='P4090';END IF;
 SELECT * INTO u FROM public.consumer_units WHERE id=d.consumer_unit_id AND customer_id=d.customer_id AND organization_id=p_org FOR SHARE;
 IF NOT FOUND OR u.status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Inactive unit' USING ERRCODE='P4090';END IF;
 IF EXISTS(SELECT 1 FROM public.documents other WHERE other.organization_id=p_org AND other.consumer_unit_id=d.consumer_unit_id AND other.reference_month=d.reference_month AND other.document_type='INVOICE_DISTRIBUTOR' AND other.id<>d.id) THEN RAISE EXCEPTION 'Duplicate invoice' USING ERRCODE='P4090';END IF;
 reg:=jsonb_build_object('customer',jsonb_build_object('company_name',c.company_name,'document',c.document),'unit',jsonb_build_object('consumer_unit_number',u.consumer_unit_number,'address',u.address,'free_market',u.free_market));
 FOREACH k IN ARRAY ARRAY['customer','taxId','unit','address','period','market'] LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('ocr-identity-review:'||p_org||':'||p_document||':'||k,0));
  SELECT * INTO r FROM public.document_ocr_identity_reviews WHERE organization_id=p_org AND document_id=p_document AND field_key=k ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR r.id::text IS DISTINCT FROM p_refs#>>ARRAY['identity',k,'id'] OR r.source_hash IS DISTINCT FROM p_refs#>>ARRAY['identity',k,'sourceHash'] OR r.decision<>'CONFIRMED' OR r.source_snapshot->'registration' IS DISTINCT FROM reg OR r.file_hash IS DISTINCT FROM d.file_hash THEN RAISE EXCEPTION 'Identity review changed' USING ERRCODE='P4090';END IF;
  IF r.source_snapshot#>>'{document,customerId}' IS DISTINCT FROM d.customer_id OR r.source_snapshot#>>'{document,unitId}' IS DISTINCT FROM d.consumer_unit_id OR r.source_snapshot#>>'{document,month}' IS DISTINCT FROM left(d.reference_month::text,7) OR r.source_snapshot#>>'{field,state}' IS DISTINCT FROM 'EXTRACTED_REVIEW' OR NOT (r.source_snapshot#>>'{field,check,comparison}' = 'EQUAL' OR coalesce((r.source_snapshot#>>'{field,attestation,policy}' = 'elektro-identity-attestation-v1'
 AND r.source_snapshot#>>'{field,attestation,registeredTaxId}' = regexp_replace(c.document,'[^0-9]','','g')
 AND length(r.source_snapshot#>>'{field,attestation,registeredTaxId}')=14
 AND r.source_snapshot#>>'{field,attestation,visibleSuffix}' = right(regexp_replace(c.document,'[^0-9]','','g'),6)
 AND r.source_snapshot#>>'{field,attestation,unit}' = u.consumer_unit_number
 AND r.source_snapshot#>>'{field,attestation,address}' = u.address
 AND r.source_snapshot#>>'{field,attestation,month}' = left(d.reference_month::text,7)
 AND r.source_snapshot#>>'{field,attestation,registeredName}' = c.company_name
 AND r.source_snapshot#>>'{field,attestation,market}' = CASE WHEN u.free_market THEN 'ACL' WHEN u.free_market IS FALSE THEN 'ACR' ELSE '' END
 AND jsonb_array_length(r.source_snapshot#>'{field,attestation,anchors,tax}')=1
 AND (r.source_snapshot#>>'{field,attestation,anchors,tax,0,text}') ~ '^CNPJ[[:space:]]*[-:]?[[:space:]]*\*{8}[[:space:]]*[0-9]{6}[[:space:]]*$'
 AND regexp_replace(r.source_snapshot#>>'{field,attestation,anchors,tax,0,text}','[^0-9]','','g')=right(regexp_replace(c.document,'[^0-9]','','g'),6)
 AND regexp_replace(r.source_snapshot#>>'{field,attestation,anchors,unit,0,text}','[^0-9]','','g')=regexp_replace(u.consumer_unit_number,'[^0-9]','','g')
 AND length(btrim(r.note))>=20
 AND ((r.field_key='taxId' AND r.source_snapshot#>>'{field,attestation,mode}'='MASKED_TAX_ID' AND r.source_snapshot#>>'{field,check,comparison}'='PARTIAL')
 OR (r.field_key='customer' AND r.source_snapshot#>>'{field,attestation,mode}'='NAME_EQUIVALENCE' AND r.source_snapshot#>>'{field,check,comparison}'='DIFFERENT')
 OR (r.field_key='market' AND r.source_snapshot#>>'{field,attestation,mode}'='REGISTERED_MARKET' AND r.source_snapshot#>>'{field,check,comparison}'='UNKNOWN' AND r.source_snapshot#>>'{field,decimal}'=CASE WHEN u.free_market THEN 'ACL' ELSE 'ACR' END))),false)) THEN RAISE EXCEPTION 'Identity source changed' USING ERRCODE='P4090';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.document_ocr_jobs j JOIN public.document_ocr_results x ON x.job_id=j.id AND x.organization_id=j.organization_id AND x.document_id=j.document_id AND x.file_hash=j.file_hash WHERE j.id=r.job_id AND j.organization_id=p_org AND j.document_id=p_document AND j.file_hash=d.file_hash AND j.state='SUCCEEDED') THEN RAISE EXCEPTION 'OCR source unavailable' USING ERRCODE='P4090';END IF;
  evidence:=evidence||jsonb_build_array(to_jsonb(r));
 END LOOP;
 measures:=jsonb_build_object('consumptionTotal',NULL,'consumptionPeak',NULL,'consumptionOffPeak',NULL,'demandSingle',NULL,'demandPeak',NULL,'demandOffPeak',NULL,'reactiveTotal',NULL);
 FOREACH k IN ARRAY ARRAY['consumptionPeakKwh','consumptionOffPeakKwh','consumptionTotalKwh'] LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('ocr-review:'||p_org||':'||p_document||':'||k,0));
  SELECT * INTO r FROM public.document_ocr_field_reviews WHERE organization_id=p_org AND document_id=p_document AND field_key=k ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR r.id::text IS DISTINCT FROM p_refs#>>ARRAY['consumption',k,'id'] OR r.source_hash IS DISTINCT FROM p_refs#>>ARRAY['consumption',k,'sourceHash'] OR r.decision<>'CONFIRMED' OR r.file_hash IS DISTINCT FROM d.file_hash OR r.source_snapshot#>>'{field,state}' IS DISTINCT FROM 'EXTRACTED_REVIEW' OR r.source_snapshot#>>'{field,unit}' IS DISTINCT FROM 'kWh' OR coalesce(r.source_snapshot#>>'{field,decimal}','') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$' THEN RAISE EXCEPTION 'Consumption review changed' USING ERRCODE='P4090';END IF;
  IF r.source_snapshot#>>'{document,customerId}' IS DISTINCT FROM d.customer_id OR r.source_snapshot#>>'{document,unitId}' IS DISTINCT FROM d.consumer_unit_id OR r.source_snapshot#>>'{document,month}' IS DISTINCT FROM left(d.reference_month::text,7) THEN RAISE EXCEPTION 'Consumption source changed' USING ERRCODE='P4090';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.document_ocr_jobs j JOIN public.document_ocr_results x ON x.job_id=j.id AND x.organization_id=j.organization_id AND x.document_id=j.document_id AND x.file_hash=j.file_hash WHERE j.id=r.job_id AND j.organization_id=p_org AND j.document_id=p_document AND j.file_hash=d.file_hash AND j.state='SUCCEEDED') THEN RAISE EXCEPTION 'OCR source unavailable' USING ERRCODE='P4090';END IF;
  target:=CASE k WHEN 'consumptionPeakKwh' THEN 'consumptionPeak' WHEN 'consumptionOffPeakKwh' THEN 'consumptionOffPeak' ELSE 'consumptionTotal' END;
  measures:=jsonb_set(measures,ARRAY[target],r.source_snapshot#>'{field,decimal}'); evidence:=evidence||jsonb_build_array(to_jsonb(r));
 END LOOP;
 IF (measures->>'consumptionTotal')::numeric<>(measures->>'consumptionPeak')::numeric+(measures->>'consumptionOffPeak')::numeric THEN RAISE EXCEPTION 'Consumption sum differs' USING ERRCODE='P4090';END IF;
 RETURN jsonb_build_object('documentId',d.id,'fileHash',d.file_hash,'customerId',d.customer_id,'unitId',d.consumer_unit_id,'month',left(d.reference_month::text,7),'measurements',measures,'reviews',evidence,'registration',reg,'unitContext',jsonb_build_object('distributor',u.distributor,'tariff_group',u.tariff_group,'tariff_subgroup',u.tariff_subgroup,'tariff_modality',u.tariff_modality,'state',u.state,'free_market',u.free_market));
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
