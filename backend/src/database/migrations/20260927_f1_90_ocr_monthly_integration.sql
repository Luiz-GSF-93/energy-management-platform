-- F1.90: reviewed OCR consumption -> first monthly draft, never overwrite or auto-validate.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.calculation_monthly_inputs DROP CONSTRAINT calculation_monthly_inputs_origin_check;
ALTER TABLE public.calculation_monthly_inputs ADD CONSTRAINT calculation_monthly_inputs_origin_check CHECK(origin IN ('MANUAL','OCR_REVIEWED'));
ALTER TABLE public.calculation_monthly_inputs ADD COLUMN source_ocr_document_id text REFERENCES public.documents(id);
ALTER TABLE public.calculation_monthly_inputs ADD CONSTRAINT monthly_ocr_origin CHECK((origin='OCR_REVIEWED')=(source_ocr_document_id IS NOT NULL));
CREATE TABLE public.document_ocr_monthly_integrations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 document_id text NOT NULL REFERENCES public.documents(id), input_id uuid NOT NULL REFERENCES public.calculation_monthly_inputs(id) DEFERRABLE INITIALLY DEFERRED,
 review_refs jsonb NOT NULL, source_snapshot jsonb NOT NULL, created_by text NOT NULL CHECK(length(btrim(created_by))>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,document_id), UNIQUE(input_id)
);
ALTER TABLE public.document_ocr_monthly_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_ocr_monthly_integrations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.document_ocr_monthly_integrations TO service_role;
CREATE FUNCTION public.preserve_ocr_monthly_integration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Immutable OCR integration' USING ERRCODE='23514';END $$;
CREATE TRIGGER preserve_ocr_monthly_integration BEFORE UPDATE OR DELETE ON public.document_ocr_monthly_integrations FOR EACH ROW EXECUTE FUNCTION public.preserve_ocr_monthly_integration();
CREATE FUNCTION public.checked_ocr_monthly_source(p_org text,p_document text,p_refs jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
  IF r.source_snapshot#>>'{document,customerId}' IS DISTINCT FROM d.customer_id OR r.source_snapshot#>>'{document,unitId}' IS DISTINCT FROM d.consumer_unit_id OR r.source_snapshot#>>'{document,month}' IS DISTINCT FROM left(d.reference_month::text,7) OR r.source_snapshot#>>'{field,state}' IS DISTINCT FROM 'EXTRACTED_REVIEW' OR r.source_snapshot#>>'{field,check,comparison}' IS DISTINCT FROM 'EQUAL' THEN RAISE EXCEPTION 'Identity source changed' USING ERRCODE='P4090';END IF;
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
CREATE FUNCTION public.integrate_ocr_monthly(p_org text,p_document text,p_actor text,p_refs jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.document_ocr_monthly_integrations; source jsonb; input_id uuid:=gen_random_uuid(); saved public.calculation_monthly_inputs; d public.documents;
BEGIN
 IF nullif(btrim(p_actor),'') IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ocr-monthly:'||p_org||':'||p_document,0));
 SELECT * INTO existing FROM public.document_ocr_monthly_integrations WHERE organization_id=p_org AND document_id=p_document;
 IF FOUND THEN SELECT * INTO saved FROM public.calculation_monthly_inputs WHERE id=existing.input_id AND organization_id=p_org;RETURN jsonb_build_object('inputId',saved.id,'status',saved.status,'alreadyIntegrated',true);END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_document AND organization_id=p_org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='P4090';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||d.consumer_unit_id||':'||left(d.reference_month::text,7),134));
 IF EXISTS(SELECT 1 FROM public.calculation_monthly_inputs WHERE organization_id=p_org AND consumer_unit_id=d.consumer_unit_id AND month=left(d.reference_month::text,7)) THEN RAISE EXCEPTION 'Existing monthly record preserved' USING ERRCODE='P4091';END IF;
 source:=public.checked_ocr_monthly_source(p_org,p_document,p_refs);
 INSERT INTO public.document_ocr_monthly_integrations(organization_id,document_id,input_id,review_refs,source_snapshot,created_by) VALUES(p_org,p_document,input_id,p_refs,source,p_actor);
 INSERT INTO public.calculation_monthly_inputs(id,organization_id,customer_id,consumer_unit_id,month,measurements,source_reference,origin,source_ocr_document_id,notes,unit_context,created_by,updated_by)
 VALUES(input_id,p_org,source->>'customerId',source->>'unitId',source->>'month',source->'measurements','OCR conferido · Documento '||p_document||' · SHA-256 '||(source->>'fileHash'),'OCR_REVIEWED',p_document,'Consumos integrados da fatura conferida. Demanda medida e energia reativa não foram inferidas. Rascunho sujeito à validação.',source->'unitContext',p_actor,p_actor) RETURNING * INTO saved;
 RETURN jsonb_build_object('inputId',saved.id,'status',saved.status,'alreadyIntegrated',false);
END $$;
CREATE FUNCTION public.guard_ocr_monthly_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE integration public.document_ocr_monthly_integrations;
BEGIN
 IF NEW.origin<>'OCR_REVIEWED' THEN RETURN NEW;END IF;
 SELECT * INTO integration FROM public.document_ocr_monthly_integrations WHERE input_id=NEW.id AND organization_id=NEW.organization_id AND document_id=NEW.source_ocr_document_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'OCR integration provenance required' USING ERRCODE='P4090';END IF;
 IF TG_OP='INSERT' AND (NEW.measurements IS DISTINCT FROM integration.source_snapshot->'measurements' OR NEW.created_by IS DISTINCT FROM integration.created_by OR NEW.status<>'DRAFT') THEN RAISE EXCEPTION 'OCR integration snapshot mismatch' USING ERRCODE='P4090';END IF;
 IF NEW.status='VALIDATED' THEN PERFORM public.checked_ocr_monthly_source(NEW.organization_id,NEW.source_ocr_document_id,integration.review_refs);END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ocr_monthly_origin_guard BEFORE INSERT OR UPDATE ON public.calculation_monthly_inputs FOR EACH ROW EXECUTE FUNCTION public.guard_ocr_monthly_origin();
REVOKE ALL ON FUNCTION public.preserve_ocr_monthly_integration(),public.checked_ocr_monthly_source(text,text,jsonb),public.integrate_ocr_monthly(text,text,text,jsonb),public.guard_ocr_monthly_origin() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.integrate_ocr_monthly(text,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
