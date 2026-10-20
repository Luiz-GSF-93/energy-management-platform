BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
ALTER TABLE public.document_ocr_jobs ADD COLUMN identity_preflight jsonb;
CREATE FUNCTION public.invoice_identity_registration(p_org text,p_document text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('customerName',c.company_name,'taxId',c.document,'unitNumber',u.consumer_unit_number,'address',u.address,'month',to_char(d.reference_month,'YYYY-MM')) FROM public.documents d JOIN public.customers c ON c.id=d.customer_id AND c.organization_id=d.organization_id AND c.deleted_at IS NULL AND upper(c.status)='ACTIVE' JOIN public.consumer_units u ON u.id=d.consumer_unit_id AND u.customer_id=d.customer_id AND u.organization_id=d.organization_id AND upper(u.status)='ACTIVE' WHERE d.organization_id=p_org AND d.id=p_document AND d.document_type='INVOICE_DISTRIBUTOR' AND d.file_verified;
$$;
CREATE FUNCTION public.record_document_identity_preflight(p_id uuid,p_token uuid,p_hash text,p_proof jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.document_ocr_jobs; expected jsonb;
BEGIN
 SELECT * INTO j FROM public.document_ocr_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'QUEUED' OR p_token IS NULL OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until IS NULL OR j.lease_until<=now() OR j.file_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Identity preflight lease or source changed' USING ERRCODE='40001';END IF;
 expected:=public.invoice_identity_registration(j.organization_id,j.document_id);
 IF expected IS NULL OR jsonb_typeof(p_proof)<>'object' OR p_proof->>'version' IS DISTINCT FROM 'invoice-identity-preflight-v1' OR coalesce(p_proof->>'state','') NOT IN('MATCH','MISMATCH','REVIEW','OCR_REQUIRED') OR p_proof->'registration' IS DISTINCT FROM expected OR p_proof->>'fileHash' IS DISTINCT FROM p_hash OR octet_length(p_proof::text)>12000 THEN RAISE EXCEPTION 'Identity proof or registration changed' USING ERRCODE='P2093';END IF;
 IF p_proof->>'state'='MATCH' AND EXISTS(SELECT 1 FROM unnest(ARRAY['unit','taxId','address','period']) k WHERE p_proof#>>ARRAY['checks',k] IS DISTINCT FROM 'MATCH') THEN RAISE EXCEPTION 'Incomplete identity proof' USING ERRCODE='P2093';END IF;
 IF j.identity_preflight IS NOT NULL AND j.identity_preflight IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'Preserve original identity preflight' USING ERRCODE='40001';END IF;
 UPDATE public.document_ocr_jobs SET identity_preflight=p_proof WHERE id=p_id;
END$$;
ALTER FUNCTION public.transition_document_ocr(uuid,uuid,text,text,integer,text,jsonb,jsonb) RENAME TO transition_document_ocr_before_identity_gate;
REVOKE ALL ON FUNCTION public.transition_document_ocr_before_identity_gate(uuid,uuid,text,text,integer,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.transition_document_ocr(p_id uuid,p_token uuid,p_action text,p_operation text DEFAULT NULL,p_delay integer DEFAULT 5,p_error text DEFAULT NULL,p_result jsonb DEFAULT NULL,p_evidence jsonb DEFAULT NULL) RETURNS public.document_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.document_ocr_jobs;
BEGIN
 IF p_action='BEGIN_SUBMISSION' THEN
  SELECT * INTO j FROM public.document_ocr_jobs WHERE id=p_id FOR UPDATE;
  PERFORM public.assert_invoice_month_ocr(j.organization_id,j.document_id);
  IF j.identity_preflight IS NULL OR coalesce(j.identity_preflight->>'state','') NOT IN('MATCH','OCR_REQUIRED') OR j.identity_preflight->>'fileHash' IS DISTINCT FROM j.file_hash OR j.identity_preflight->'registration' IS DISTINCT FROM public.invoice_identity_registration(j.organization_id,j.document_id) THEN RAISE EXCEPTION 'Invoice identity requires review before OCR' USING ERRCODE='P2093';END IF;
 END IF;
 RETURN public.transition_document_ocr_before_identity_gate(p_id,p_token,p_action,p_operation,p_delay,p_error,p_result,p_evidence);
END$$;
REVOKE ALL ON FUNCTION public.invoice_identity_registration(text,text),public.record_document_identity_preflight(uuid,uuid,text,jsonb),public.transition_document_ocr(uuid,uuid,text,text,integer,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.invoice_identity_registration(text,text),public.record_document_identity_preflight(uuid,uuid,text,jsonb),public.transition_document_ocr(uuid,uuid,text,text,integer,text,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
