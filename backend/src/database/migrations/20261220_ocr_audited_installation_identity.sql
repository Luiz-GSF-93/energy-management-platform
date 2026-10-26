BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Exact immutable installation lineage shared with the local native-PDF preflight.
CREATE FUNCTION public.ocr_identity_unit_lineage(p_org text,p_customer text,p_unit text,p_current text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE codes jsonb:=jsonb_build_array(regexp_replace(upper(coalesce(p_current,'')),'[^A-Z0-9]','','g'));ids jsonb:='[]'::jsonb;e record;b jsonb;a jsonb;old_code text;new_code text;
BEGIN
 FOR e IN SELECT * FROM public.registration_edits WHERE organization_id=p_org AND entity_kind='consumer_units' AND entity_id=p_unit ORDER BY created_at DESC,id DESC LIMIT 100 LOOP
  b:=e.before_record;a:=e.after_record;
  IF nullif(e.created_by::text,'') IS NULL OR nullif(e.id::text,'') IS NULL OR length(btrim(coalesce(e.reason,'')))<3 OR b->>'id' IS DISTINCT FROM p_unit OR a->>'id' IS DISTINCT FROM p_unit OR b->>'organization_id' IS DISTINCT FROM p_org OR a->>'organization_id' IS DISTINCT FROM p_org OR b->>'customer_id' IS DISTINCT FROM p_customer OR a->>'customer_id' IS DISTINCT FROM p_customer THEN CONTINUE;END IF;
  old_code:=regexp_replace(upper(coalesce(b->>'consumer_unit_number','')),'[^A-Z0-9]','','g');new_code:=regexp_replace(upper(coalesce(a->>'consumer_unit_number','')),'[^A-Z0-9]','','g');
  IF length(old_code)>=5 AND length(new_code)>=5 AND old_code<>new_code AND codes @> jsonb_build_array(new_code) THEN
   IF NOT codes @> jsonb_build_array(old_code) THEN codes:=codes||jsonb_build_array(old_code);END IF;
   ids:=ids||jsonb_build_array(e.id::text);
  END IF;
 END LOOP;
 RETURN jsonb_build_object('codes',codes,'editIds',ids);
END$$;
CREATE FUNCTION public.ocr_identity_proof_current(p_org text,p_document text,p_proof jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.documents;reg jsonb;lineage jsonb;
BEGIN
 SELECT * INTO d FROM public.documents WHERE organization_id=p_org AND id=p_document AND file_verified AND document_type='INVOICE_DISTRIBUTOR';
 IF NOT FOUND OR p_proof IS NULL OR jsonb_typeof(p_proof)<>'object' OR p_proof->>'version' IS DISTINCT FROM 'invoice-identity-preflight-v1' OR p_proof->>'fileHash' IS DISTINCT FROM d.file_hash THEN RETURN false;END IF;
 reg:=public.invoice_identity_registration(p_org,p_document);
 IF reg IS NULL THEN RETURN false;END IF;
 IF NOT (p_proof ? 'registrationEditIds') AND NOT ((p_proof->'registration') ? 'auditedUnitNumbers') THEN RETURN coalesce(p_proof->'registration'=reg,false);END IF;
 IF ((p_proof->'registration')-'auditedUnitNumbers') IS DISTINCT FROM reg OR p_proof->>'state' IS DISTINCT FROM 'MATCH' OR EXISTS(SELECT 1 FROM unnest(ARRAY['unit','taxId','address','period']) k WHERE p_proof#>>ARRAY['checks',k] IS DISTINCT FROM 'MATCH') THEN RETURN false;END IF;
 lineage:=public.ocr_identity_unit_lineage(p_org,d.customer_id,d.consumer_unit_id,reg->>'unitNumber');
 RETURN coalesce(jsonb_array_length(lineage->'editIds')>0 AND p_proof->'registrationEditIds'=lineage->'editIds' AND p_proof#>'{registration,auditedUnitNumbers}'=lineage->'codes',false);
END$$;
CREATE OR REPLACE FUNCTION public.record_document_identity_preflight(p_id uuid,p_token uuid,p_hash text,p_proof jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.document_ocr_jobs; expected jsonb;
BEGIN
 SELECT * INTO j FROM public.document_ocr_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'QUEUED' OR p_token IS NULL OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until IS NULL OR j.lease_until<=now() OR j.file_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Identity preflight lease or source changed' USING ERRCODE='40001';END IF;
 expected:=public.invoice_identity_registration(j.organization_id,j.document_id);
 IF expected IS NULL OR jsonb_typeof(p_proof)<>'object' OR p_proof->>'version' IS DISTINCT FROM 'invoice-identity-preflight-v1' OR coalesce(p_proof->>'state','') NOT IN('MATCH','MISMATCH','REVIEW','OCR_REQUIRED') OR NOT public.ocr_identity_proof_current(j.organization_id,j.document_id,p_proof) OR p_proof->>'fileHash' IS DISTINCT FROM p_hash OR octet_length(p_proof::text)>12000 THEN RAISE EXCEPTION 'Identity proof or registration changed' USING ERRCODE='P2093';END IF;
 IF p_proof->>'state'='MATCH' AND EXISTS(SELECT 1 FROM unnest(ARRAY['unit','taxId','address','period']) k WHERE p_proof#>>ARRAY['checks',k] IS DISTINCT FROM 'MATCH') THEN RAISE EXCEPTION 'Incomplete identity proof' USING ERRCODE='P2093';END IF;
 IF j.identity_preflight IS NOT NULL AND j.identity_preflight IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'Preserve original identity preflight' USING ERRCODE='40001';END IF;
 UPDATE public.document_ocr_jobs SET identity_preflight=p_proof WHERE id=p_id;
END$$;
CREATE OR REPLACE FUNCTION public.transition_document_ocr(p_id uuid,p_token uuid,p_action text,p_operation text DEFAULT NULL,p_delay integer DEFAULT 5,p_error text DEFAULT NULL,p_result jsonb DEFAULT NULL,p_evidence jsonb DEFAULT NULL) RETURNS public.document_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.document_ocr_jobs;
BEGIN
 IF p_action='BEGIN_SUBMISSION' THEN
  SELECT * INTO j FROM public.document_ocr_jobs WHERE id=p_id FOR UPDATE;
  PERFORM public.assert_invoice_month_ocr(j.organization_id,j.document_id);
  IF j.identity_preflight IS NULL OR coalesce(j.identity_preflight->>'state','') NOT IN('MATCH','OCR_REQUIRED') OR j.identity_preflight->>'fileHash' IS DISTINCT FROM j.file_hash OR NOT public.ocr_identity_proof_current(j.organization_id,j.document_id,j.identity_preflight) THEN RAISE EXCEPTION 'Invoice identity requires review before OCR' USING ERRCODE='P2093';END IF;
 END IF;
 RETURN public.transition_document_ocr_before_identity_gate(p_id,p_token,p_action,p_operation,p_delay,p_error,p_result,p_evidence);
END$$;
CREATE OR REPLACE FUNCTION public.ocr_identity_resume_action(p_org text,p_document text,p_actor text,p_role text,p_platform boolean,p_action text,p_request uuid DEFAULT NULL,p_reason text DEFAULT NULL,p_proof jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.documents;j public.document_ocr_jobs;reg jsonb;lic public.licenses;prior jsonb;eligible boolean;audited boolean;base_eligible boolean;alias_candidate boolean;legacy_candidate boolean;lineage jsonb;
BEGIN
 IF p_action NOT IN('inspect','resume') OR nullif(p_actor,'') IS NULL OR nullif(p_org,'') IS NULL THEN RAISE EXCEPTION 'Invalid resume scope' USING ERRCODE='22023';END IF;
 IF NOT (p_platform IS TRUE AND EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now())) AND NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND r.scope='organization' AND r.name IN('admin_org','gestor','operacional') AND r.permissions?'8f105b02-4443-49de-b188-847e0284e7ed' AND r.permissions?'92e1b670-ab10-483a-b825-c6e16799496d') THEN RAISE EXCEPTION 'Internal OCR actor required' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM public.documents WHERE organization_id=p_org AND id=p_document AND file_verified AND document_type='INVOICE_DISTRIBUTOR' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Verified source unavailable' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.consumer_units WHERE organization_id=p_org AND id=d.consumer_unit_id AND customer_id=d.customer_id AND upper(status)='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.customers WHERE organization_id=p_org AND id=d.customer_id AND deleted_at IS NULL AND upper(status)='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO lic FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=current_date AND (end_date IS NULL OR end_date>=current_date) FOR SHARE;
 IF NOT FOUND OR lic.document_management IS DISTINCT FROM true OR (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=current_date AND (end_date IS NULL OR end_date>=current_date))<>1 THEN RAISE EXCEPTION 'Document license unavailable' USING ERRCODE='42501';END IF;
 PERFORM public.assert_invoice_month_ocr(p_org,p_document);
 SELECT * INTO j FROM public.document_ocr_jobs WHERE organization_id=p_org AND document_id=p_document FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('eligible',false,'reason','Não há leitura interrompida para retomar.');END IF;
 IF p_action='resume' AND p_request IS NOT NULL THEN
  SELECT value INTO prior FROM jsonb_array_elements(j.identity_resume_history) WHERE value->>'requestId'=p_request::text;
  IF FOUND THEN
   IF prior->>'actor' IS DISTINCT FROM p_actor OR prior->>'reason' IS DISTINCT FROM p_reason OR prior->'newProof' IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'Resume request changed' USING ERRCODE='40001';END IF;
   RETURN jsonb_build_object('jobId',j.id,'state',j.state,'replayed',true);
  END IF;
 END IF;
 reg:=public.invoice_identity_registration(p_org,p_document);
 -- Require a corresponding immutable edit, not just a changed live row.
 SELECT EXISTS(SELECT 1 FROM public.registration_edits e CROSS JOIN LATERAL (VALUES('consumer_units',d.consumer_unit_id,'consumer_unit_number','unitNumber'),('consumer_units',d.consumer_unit_id,'address','address'),('customers',d.customer_id,'document','taxId'),('customers',d.customer_id,'company_name','customerName')) f(kind,id,col,key) WHERE e.organization_id=p_org AND e.entity_kind=f.kind AND e.entity_id=f.id AND e.created_at>=j.created_at AND e.before_record->>f.col=j.identity_preflight#>>ARRAY['registration',f.key] AND e.after_record->>f.col=reg->>f.key AND e.before_record->>f.col IS DISTINCT FROM e.after_record->>f.col) INTO audited;
 base_eligible:=j.state='FAILED' AND ((j.error_code='IDENTITY_MISMATCH' AND j.identity_preflight->>'state'='MISMATCH') OR (j.error_code='IDENTITY_REVIEW_REQUIRED' AND j.identity_preflight->>'state'='REVIEW')) AND j.submission_started_at IS NULL AND j.operation_url IS NULL AND j.lease_token IS NULL AND j.file_hash=d.file_hash AND j.identity_preflight->>'fileHash'=j.file_hash AND j.identity_preflight->>'version'='invoice-identity-preflight-v1' AND jsonb_array_length(j.identity_resume_history)<3 AND j.attempts<120 AND reg IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.document_ocr_results WHERE job_id=j.id OR (organization_id=p_org AND document_id=p_document));
 legacy_candidate:=audited AND j.identity_preflight->'registration' IS DISTINCT FROM reg;
 lineage:=public.ocr_identity_unit_lineage(p_org,d.customer_id,d.consumer_unit_id,reg->>'unitNumber');
 alias_candidate:=j.error_code='IDENTITY_MISMATCH' AND j.identity_preflight->>'state'='MISMATCH' AND j.identity_preflight#>>'{checks,unit}'='MISMATCH' AND j.identity_preflight->'registration'=reg AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['taxId','address','period']) k WHERE j.identity_preflight#>>ARRAY['checks',k] IS DISTINCT FROM 'MATCH') AND jsonb_array_length(lineage->'editIds')>0;
 eligible:=base_eligible AND (legacy_candidate OR (alias_candidate AND p_proof IS NOT NULL AND p_proof->'registrationEditIds'=lineage->'editIds' AND p_proof#>'{registration,auditedUnitNumbers}'=lineage->'codes' AND public.ocr_identity_proof_current(p_org,p_document,p_proof)));
 IF p_action='inspect' THEN RETURN jsonb_build_object('eligible',coalesce(eligible,false),'canRecheck',coalesce(base_eligible AND alias_candidate,false),'job',jsonb_build_object('id',j.id,'fileHash',j.file_hash,'updatedAt',j.updated_at),'registration',reg,'customerId',d.customer_id,'unitId',d.consumer_unit_id,'reason',CASE WHEN eligible THEN 'Identidade e histórico conferidos; a retomada preservará o mesmo documento.' WHEN base_eligible AND alias_candidate THEN 'Correspondência de instalação auditada disponível; reconferir o original antes da decisão.' ELSE 'Esta leitura exige conferência administrativa; nenhum reenvio foi autorizado.' END);END IF;
 IF eligible IS DISTINCT FROM true THEN RAISE EXCEPTION 'Pre-submission identity failure required' USING ERRCODE='40001';END IF;
 IF p_request IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 20 AND 500 OR p_proof IS NULL OR jsonb_typeof(p_proof)<>'object' OR octet_length(p_proof::text)>12000 OR p_proof->>'state' IS DISTINCT FROM 'MATCH' OR p_proof->>'version' IS DISTINCT FROM 'invoice-identity-preflight-v1' OR p_proof->>'fileHash' IS DISTINCT FROM j.file_hash OR NOT public.ocr_identity_proof_current(p_org,p_document,p_proof) OR EXISTS(SELECT 1 FROM unnest(ARRAY['unit','taxId','address','period']) k WHERE p_proof#>>ARRAY['checks',k] IS DISTINCT FROM 'MATCH') THEN RAISE EXCEPTION 'Complete current identity proof required' USING ERRCODE='22023';END IF;
 UPDATE public.document_ocr_jobs SET identity_resume_history=identity_resume_history||jsonb_build_array(jsonb_build_object('requestId',p_request,'actor',p_actor,'reason',p_reason,'at',clock_timestamp(),'previousProof',identity_preflight,'previousError',error_code,'previousAttempts',attempts,'newProof',p_proof,'basis',CASE WHEN alias_candidate THEN 'AUDITED_INSTALLATION_ALIAS' ELSE 'REGISTRATION_EDIT' END)),identity_preflight=NULL,state='QUEUED',error_code=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
 RETURN jsonb_build_object('jobId',j.id,'state',j.state,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.ocr_identity_unit_lineage(text,text,text,text),public.ocr_identity_proof_current(text,text,jsonb),public.record_document_identity_preflight(uuid,uuid,text,jsonb),public.transition_document_ocr(uuid,uuid,text,text,integer,text,jsonb,jsonb),public.ocr_identity_resume_action(text,text,text,text,boolean,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_document_identity_preflight(uuid,uuid,text,jsonb),public.transition_document_ocr(uuid,uuid,text,text,integer,text,jsonb,jsonb),public.ocr_identity_resume_action(text,text,text,text,boolean,text,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
