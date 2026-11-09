-- XML is a bounded deterministic source, never an OCR provider request.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
ALTER TABLE public.eva_automatic_intakes DROP CONSTRAINT eva_automatic_intakes_mime_check;
ALTER TABLE public.eva_automatic_intakes ADD CONSTRAINT eva_automatic_intakes_mime_check CHECK(mime IN('application/pdf','image/png','image/jpeg','application/xml'));
ALTER TABLE public.eva_automatic_intakes ADD CONSTRAINT eva_intake_xml_size CHECK(mime<>'application/xml' OR size_bytes<=2097152);
ALTER TABLE public.document_ocr_jobs ADD COLUMN source_kind text NOT NULL DEFAULT 'OCR' CHECK(source_kind IN('OCR','XML'));
ALTER TABLE public.document_ocr_jobs ADD CONSTRAINT xml_read_is_local CHECK(source_kind<>'XML' OR state='SUCCEEDED' AND operation_url IS NULL);
-- Preserve all existing scope wrappers and financial guards. Fail atomically if
-- their audited implementation no longer contains these exact admission points.
DO $migration$
DECLARE d text;n text;fn record;admissions int:=0;transitions int:=0;
BEGIN
 FOR fn IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname IN('public','portal_scope') AND p.proname IN('eva_intake_action','transition_eva_automatic_intake') LOOP
  d:=pg_get_functiondef(fn.oid);
  IF fn.proname='eva_intake_action' THEN
   IF position('Invalid intake metadata' IN d)=0 THEN CONTINUE;END IF;
   IF position($a$NOT IN('application/pdf','image/png','image/jpeg')$a$ IN d)=0 THEN RAISE EXCEPTION 'Review intake MIME admission before XML migration';END IF;
   n:=replace(d,$a$NOT IN('application/pdf','image/png','image/jpeg')$a$,$a$NOT IN('application/pdf','image/png','image/jpeg','application/xml')$a$);EXECUTE n;admissions:=admissions+1;
  ELSE
   IF position($a$CASE i.mime WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' ELSE '.jpg' END$a$ IN d)=0 OR position($a$IF i.document_type='INVOICE_DISTRIBUTOR' AND i.raw_result IS NOT NULL THEN$a$ IN d)=0 THEN RAISE EXCEPTION 'Review intake transition before XML migration';END IF;
   n:=replace(d,$a$CASE i.mime WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' ELSE '.jpg' END$a$,$a$CASE i.mime WHEN 'application/xml' THEN '.xml' WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' ELSE '.jpg' END$a$);
   n:=replace(n,$a$IF i.document_type='INVOICE_DISTRIBUTOR' AND i.raw_result IS NOT NULL THEN$a$,$a$IF i.document_type='INVOICE_DISTRIBUTOR' AND i.raw_result IS NOT NULL AND i.mime<>'application/xml' THEN$a$);EXECUTE n;transitions:=transitions+1;
  END IF;
 END LOOP;
 IF admissions<1 OR transitions<1 THEN RAISE EXCEPTION 'Intake implementation unavailable';END IF;
END $migration$;
-- Bucket stays private; preserve any broader pre-existing MIME allow-list.
UPDATE storage.buckets SET allowed_mime_types=array_append(allowed_mime_types,'application/xml')
 WHERE id='energy-documents-private' AND NOT public AND allowed_mime_types IS NOT NULL AND NOT('application/xml'=ANY(allowed_mime_types));
CREATE FUNCTION public.eva_intake_xml_source(p_id uuid,p_token uuid,p_raw jsonb) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb;i public.eva_automatic_intakes;
BEGIN
 c:=public.portal_intake_work_context_scoped(p_id,p_token);
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 IF i.mime<>'application/xml' OR i.state NOT IN('RECOGNIZING','LINKING') OR i.operation_url IS NOT NULL OR p_raw#>>'{xml,version}' IS DISTINCT FROM 'fiscal-xml-1' OR p_raw#>>'{xml,sourceHash}' IS DISTINCT FROM i.file_hash OR p_raw->>'contentUnit' IS DISTINCT FROM 'XML_FIELDS' OR octet_length(p_raw::text)>4194304 THEN RAISE EXCEPTION 'XML source scope mismatch' USING ERRCODE='42501';END IF;
 IF i.raw_result IS NOT NULL AND i.raw_result IS DISTINCT FROM p_raw THEN RAISE EXCEPTION 'XML source changed' USING ERRCODE='PT409';END IF;
 IF i.raw_result IS NULL THEN UPDATE public.eva_automatic_intakes SET raw_result=p_raw WHERE id=i.id;PERFORM public.eva_intake_event(i.id,'XML_FIELDS_READ',jsonb_build_object('sourceHash',i.file_hash,'providerRequest',false),c#>>'{delegate,userId}');END IF;
 RETURN true;
END$$;
CREATE FUNCTION public.eva_intake_xml_complete(p_id uuid,p_token uuid,p_assessment jsonb) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb;i public.eva_automatic_intakes;j public.document_ocr_jobs;d public.documents;
BEGIN
 c:=public.portal_intake_work_context_scoped(p_id,p_token);
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 SELECT * INTO STRICT d FROM public.documents WHERE organization_id=i.organization_id AND id=i.document_id AND customer_id=i.customer_id AND consumer_unit_id=i.unit_id AND file_hash=i.file_hash AND file_verified AND mime_type='application/xml';
 IF i.mime<>'application/xml' OR i.state<>'WAITING_OCR' OR i.document_type<>'INVOICE_DISTRIBUTOR' OR i.proof->>'state' IS DISTINCT FROM 'MATCH' OR i.raw_result#>>'{xml,sourceHash}' IS DISTINCT FROM i.file_hash OR i.operation_url IS NOT NULL OR p_assessment->>'version' IS DISTINCT FROM 'intake-assessment-v1' OR p_assessment#>>'{source,organizationId}' IS DISTINCT FROM i.organization_id OR p_assessment#>>'{source,documentId}' IS DISTINCT FROM i.document_id OR p_assessment#>>'{source,fileHash}' IS DISTINCT FROM i.file_hash OR p_assessment#>>'{source,customerId}' IS DISTINCT FROM i.customer_id OR p_assessment#>>'{source,unitId}' IS DISTINCT FROM i.unit_id OR p_assessment#>>'{source,referenceMonth}' IS DISTINCT FROM i.month OR octet_length(p_assessment::text)>262144 THEN RAISE EXCEPTION 'XML extraction scope mismatch' USING ERRCODE='42501';END IF;
 PERFORM public.assert_invoice_month_ocr(i.organization_id,i.document_id);
 SELECT * INTO j FROM public.document_ocr_jobs WHERE organization_id=i.organization_id AND document_id=i.document_id FOR UPDATE;
 IF FOUND THEN
  IF j.source_kind<>'XML' OR j.state<>'SUCCEEDED' OR j.file_hash<>i.file_hash OR NOT EXISTS(SELECT 1 FROM public.document_ocr_results WHERE job_id=j.id AND provider='DETERMINISTIC_XML' AND file_hash=i.file_hash) THEN RAISE EXCEPTION 'Existing extraction requires reconciliation' USING ERRCODE='PT409';END IF;
  RETURN true;
 END IF;
 INSERT INTO public.document_ocr_jobs(organization_id,document_id,file_hash,requested_by,state,source_kind) VALUES(i.organization_id,i.document_id,i.file_hash,c#>>'{delegate,userId}','SUCCEEDED','XML') RETURNING * INTO j;
 INSERT INTO public.document_ocr_results(job_id,organization_id,document_id,file_hash,provider,extraction_version,raw_result,evidence)
 VALUES(j.id,i.organization_id,i.document_id,i.file_hash,'DETERMINISTIC_XML','fiscal-xml-1',i.raw_result,jsonb_build_object('assessment',p_assessment,'sourceKind','XML','providerRequest',false,'signatureVerified',false));
 UPDATE public.documents SET ocr_status='COMPLETED',updated_at=clock_timestamp() WHERE id=d.id AND organization_id=i.organization_id;
 PERFORM public.eva_intake_event(i.id,'XML_EXTRACTION_COMPLETED',jsonb_build_object('jobId',j.id,'sourceHash',i.file_hash,'providerRequest',false),c#>>'{delegate,userId}');
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_xml_source(uuid,uuid,jsonb),public.eva_intake_xml_complete(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_xml_source(uuid,uuid,jsonb),public.eva_intake_xml_complete(uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
