BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Explicit library reconciliation: links existing files only; never consents to OCR.
CREATE FUNCTION public.portal_invoice_library(p_org text,p_actor text,p_role text,p_year text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor jsonb; customer text; d public.documents; receipt uuid; result jsonb; conflicts integer:=0;
BEGIN
 actor:=public.portal_workspace_actor(p_org,p_actor,p_role,false,'documents');customer:=actor->>'customerId';
 IF actor->>'external' IS DISTINCT FROM 'true' OR customer IS NULL THEN RAISE EXCEPTION 'External portal required' USING ERRCODE='42501';END IF;
 IF p_year IS NULL OR p_year!~'^20[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid year' USING ERRCODE='22023';END IF;
 FOR d IN SELECT doc.* FROM public.documents doc JOIN public.consumer_units u ON u.id=doc.consumer_unit_id AND u.organization_id=p_org AND u.customer_id=customer AND u.status='ACTIVE'
 WHERE doc.organization_id=p_org AND doc.customer_id=customer AND doc.document_type='INVOICE_DISTRIBUTOR' AND doc.file_verified=true
 AND doc.file_hash~'^[a-f0-9]{64}$' AND doc.storage_bucket='energy-documents-private' AND doc.file_path LIKE p_org||'/'||doc.consumer_unit_id||'/%'
 AND doc.reference_month>=(p_year||'-01-01')::date AND doc.reference_month<(p_year||'-01-01')::date+interval '1 year'
 AND NOT EXISTS(SELECT 1 FROM public.documents newer WHERE newer.organization_id=p_org AND newer.catalog_previous_id=doc.id AND newer.file_verified=true)
 ORDER BY doc.consumer_unit_id,doc.reference_month,doc.id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('invoice-month:'||jsonb_build_array(p_org,customer,d.consumer_unit_id,to_char(d.reference_month,'YYYY-MM'))::text,0));
  IF EXISTS(SELECT 1 FROM public.portal_document_intakes i WHERE i.organization_id=p_org AND i.customer_id=customer AND i.consumer_unit_id=d.consumer_unit_id AND i.month=to_char(d.reference_month,'YYYY-MM') AND i.kind='INVOICE') THEN CONTINUE;END IF;
  IF (SELECT count(*) FROM public.documents other WHERE other.organization_id=p_org AND other.customer_id=customer AND other.consumer_unit_id=d.consumer_unit_id AND date_trunc('month',other.reference_month)=date_trunc('month',d.reference_month) AND other.document_type='INVOICE_DISTRIBUTOR' AND other.file_verified=true AND NOT EXISTS(SELECT 1 FROM public.documents newer WHERE newer.organization_id=p_org AND newer.catalog_previous_id=other.id AND newer.file_verified=true))<>1 THEN conflicts:=conflicts+1;CONTINUE;END IF;
  INSERT INTO public.portal_document_intakes(organization_id,customer_id,consumer_unit_id,request_id,actor_id,document_id,month,kind,file_hash,filename,consent)
  VALUES(p_org,customer,d.consumer_unit_id,gen_random_uuid(),p_actor,d.id,to_char(d.reference_month,'YYYY-MM'),'INVOICE',d.file_hash,left(coalesce(nullif(d.original_filename,''),'Fatura de energia'),255),false) RETURNING id INTO receipt;
  INSERT INTO public.portal_document_events(organization_id,intake_id,event_key,state,source_id,note)
  VALUES(p_org,receipt,'backoffice-library','RESERVED',d.id,'Fatura existente no backoffice disponibilizada na biblioteca do cliente. Sem novo envio, consentimento OCR ou processamento.');
 END LOOP;
  SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM (SELECT i.id,i.document_id AS "documentId",i.consumer_unit_id AS "unitId",u.name AS "unitName",i.month,i.kind,i.filename,i.created_at AS "createdAt",i.consent,CASE WHEN EXISTS(SELECT 1 FROM public.portal_document_events origin WHERE origin.intake_id=i.id AND origin.event_key='backoffice-library') THEN 'BACKOFFICE' ELSE 'PORTAL' END AS origin,j.error_code AS "ocrErrorCode",j.state AS "ocrState",i.record_id AS "recordId",
   (SELECT e.state FROM public.portal_document_events e WHERE e.intake_id=i.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS "intakeState",
   EXISTS(SELECT 1 FROM public.eva_closing_publications p JOIN public.eva_assisted_closing_versions v ON v.id=p.closing_id AND v.organization_id=p_org WHERE p.organization_id=p_org AND p.customer_id=customer AND v.month=i.month AND p.source_hash=v.payload_hash AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units') j(unit_body) WHERE unit_body->>'id'=i.consumer_unit_id AND unit_body->>'documentId'=i.document_id AND unit_body->>'sourceHash'=i.file_hash) AND (SELECT state FROM public.eva_closing_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 1)='PUBLISHED' AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)='APPROVED') AS published,
   EXISTS(SELECT 1 FROM public.calculation_preparation_runs a WHERE a.organization_id=p_org AND a.document_id=i.document_id AND a.source_hash=i.file_hash AND EXISTS(SELECT 1 FROM public.calculation_preparation_run_events e WHERE e.run_id=a.id AND e.organization_id=p_org AND e.sequence=2 AND e.state IN('PREPARED','PARTIAL'))) AS prepared
   FROM public.portal_document_intakes i JOIN public.consumer_units u ON u.organization_id=p_org AND u.customer_id=customer AND u.id=i.consumer_unit_id AND u.status='ACTIVE' LEFT JOIN public.document_ocr_jobs j ON j.organization_id=p_org AND j.document_id=i.document_id WHERE i.organization_id=p_org AND i.customer_id=customer AND i.kind='INVOICE' AND i.month BETWEEN p_year||'-01' AND p_year||'-12' ORDER BY i.month DESC,u.name,i.id LIMIT 1201)x;

 IF jsonb_array_length(result)>1200 THEN RAISE EXCEPTION 'Annual library too large' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('rows',result,'year',p_year,'conflicts',conflicts);
END$$;
CREATE FUNCTION public.portal_invoice_content_source(p_org text,p_actor text,p_role text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor jsonb; result jsonb;
BEGIN
 actor:=public.portal_workspace_actor(p_org,p_actor,p_role,false,'documents');
 IF actor->>'external' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'External portal required' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('id',d.id,'unitId',d.consumer_unit_id,'bucket',d.storage_bucket,'path',d.file_path,'hash',d.file_hash,'mime',d.mime_type,'size',d.file_size_bytes) INTO result
 FROM public.portal_document_intakes i JOIN public.documents d ON d.id=i.document_id AND d.organization_id=p_org AND d.customer_id=i.customer_id AND d.consumer_unit_id=i.consumer_unit_id AND d.file_hash=i.file_hash AND d.file_verified=true
 JOIN public.consumer_units u ON u.id=i.consumer_unit_id AND u.organization_id=p_org AND u.customer_id=i.customer_id AND u.status='ACTIVE'
 WHERE i.id=p_id AND i.organization_id=p_org AND i.customer_id=actor->>'customerId' AND i.kind='INVOICE';
 IF result IS NULL THEN RAISE EXCEPTION 'Invoice source unavailable' USING ERRCODE='42501';END IF;RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.portal_invoice_library(text,text,text,text),public.portal_invoice_content_source(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.portal_invoice_library(text,text,text,text),public.portal_invoice_content_source(text,text,text,uuid) TO service_role;
COMMIT;
