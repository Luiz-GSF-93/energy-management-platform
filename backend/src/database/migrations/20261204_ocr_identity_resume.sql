BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
ALTER TABLE public.document_ocr_jobs ADD COLUMN identity_resume_history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(identity_resume_history)='array' AND jsonb_array_length(identity_resume_history)<=3);
ALTER TABLE public.document_ocr_jobs ADD COLUMN submission_started_at timestamptz;
-- Only a failed, immutable preflight can prove that a legacy job never reached POST.
UPDATE public.document_ocr_jobs SET submission_started_at=created_at WHERE state IN('SUBMITTING','POLLING','SUCCEEDED','SUBMISSION_UNKNOWN') OR operation_url IS NOT NULL OR identity_preflight->>'state' IN('MATCH','OCR_REQUIRED') OR EXISTS(SELECT 1 FROM public.document_ocr_results r WHERE r.job_id=document_ocr_jobs.id);
CREATE FUNCTION public.preserve_ocr_resume_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.submission_started_at IS NOT NULL AND NEW.submission_started_at IS DISTINCT FROM OLD.submission_started_at THEN RAISE EXCEPTION 'Preserve submission intent' USING ERRCODE='23514';END IF;
 IF NEW.state='SUBMITTING' AND NEW.submission_started_at IS NULL THEN NEW.submission_started_at:=clock_timestamp();END IF;
 IF NEW.identity_resume_history IS DISTINCT FROM OLD.identity_resume_history AND (jsonb_array_length(NEW.identity_resume_history)<>jsonb_array_length(OLD.identity_resume_history)+1 OR NEW.identity_resume_history-(jsonb_array_length(NEW.identity_resume_history)-1) IS DISTINCT FROM OLD.identity_resume_history OR NEW.identity_resume_history->-1->'previousProof' IS DISTINCT FROM OLD.identity_preflight OR NEW.state<>'QUEUED' OR NEW.identity_preflight IS NOT NULL) THEN RAISE EXCEPTION 'Preserve preflight history' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER preserve_ocr_resume_history BEFORE UPDATE ON public.document_ocr_jobs FOR EACH ROW EXECUTE FUNCTION public.preserve_ocr_resume_history();

CREATE FUNCTION public.ocr_identity_resume_action(p_org text,p_document text,p_actor text,p_role text,p_platform boolean,p_action text,p_request uuid DEFAULT NULL,p_reason text DEFAULT NULL,p_proof jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.documents;j public.document_ocr_jobs;reg jsonb;lic public.licenses;prior jsonb;eligible boolean;audited boolean;
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
 eligible:=j.state='FAILED' AND ((j.error_code='IDENTITY_MISMATCH' AND j.identity_preflight->>'state'='MISMATCH') OR (j.error_code='IDENTITY_REVIEW_REQUIRED' AND j.identity_preflight->>'state'='REVIEW')) AND j.submission_started_at IS NULL AND j.operation_url IS NULL AND j.lease_token IS NULL AND j.file_hash=d.file_hash AND j.identity_preflight->>'fileHash'=j.file_hash AND j.identity_preflight->>'version'='invoice-identity-preflight-v1' AND jsonb_array_length(j.identity_resume_history)<3 AND j.attempts<120 AND audited AND reg IS NOT NULL AND j.identity_preflight->'registration' IS DISTINCT FROM reg AND NOT EXISTS(SELECT 1 FROM public.document_ocr_results WHERE job_id=j.id OR (organization_id=p_org AND document_id=p_document));
 IF p_action='inspect' THEN RETURN jsonb_build_object('eligible',coalesce(eligible,false),'job',jsonb_build_object('id',j.id,'fileHash',j.file_hash,'updatedAt',j.updated_at),'registration',reg,'customerId',d.customer_id,'unitId',d.consumer_unit_id,'reason',CASE WHEN eligible THEN 'Cadastro corrigido com auditoria; confira novamente o original antes de retomar.' ELSE 'Esta leitura exige conferência administrativa; nenhum reenvio foi autorizado.' END);END IF;
 IF eligible IS DISTINCT FROM true THEN RAISE EXCEPTION 'Pre-submission identity failure required' USING ERRCODE='40001';END IF;
 IF p_request IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 20 AND 500 OR p_proof IS NULL OR jsonb_typeof(p_proof)<>'object' OR octet_length(p_proof::text)>12000 OR p_proof->>'state' IS DISTINCT FROM 'MATCH' OR p_proof->>'version' IS DISTINCT FROM 'invoice-identity-preflight-v1' OR p_proof->>'fileHash' IS DISTINCT FROM j.file_hash OR p_proof->'registration' IS DISTINCT FROM reg OR EXISTS(SELECT 1 FROM unnest(ARRAY['unit','taxId','address','period']) k WHERE p_proof#>>ARRAY['checks',k] IS DISTINCT FROM 'MATCH') THEN RAISE EXCEPTION 'Complete current identity proof required' USING ERRCODE='22023';END IF;
 UPDATE public.document_ocr_jobs SET identity_resume_history=identity_resume_history||jsonb_build_array(jsonb_build_object('requestId',p_request,'actor',p_actor,'reason',p_reason,'at',clock_timestamp(),'previousProof',identity_preflight,'previousError',error_code,'previousAttempts',attempts,'newProof',p_proof)),identity_preflight=NULL,state='QUEUED',error_code=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
 RETURN jsonb_build_object('jobId',j.id,'state',j.state,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.preserve_ocr_resume_history(),public.ocr_identity_resume_action(text,text,text,text,boolean,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ocr_identity_resume_action(text,text,text,text,boolean,text,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
