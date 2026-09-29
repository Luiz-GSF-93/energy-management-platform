-- Explicit, append-only attestation for masked Elektro identity.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.guard_document_ocr_identity_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.documents; j public.document_ocr_jobs; last_id uuid; last_version integer; review_customer public.customers; review_unit public.consumer_units; reg jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'OCR_REVIEW_IMMUTABLE' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ocr-identity-review:'||NEW.organization_id||':'||NEW.document_id||':'||NEW.field_key,0));
 IF EXISTS(SELECT 1 FROM public.document_ocr_identity_reviews WHERE organization_id=NEW.organization_id AND request_id=NEW.request_id) THEN RAISE EXCEPTION 'OCR_REVIEW_REQUEST_EXISTS' USING ERRCODE='23505'; END IF;
 SELECT * INTO d FROM public.documents WHERE id=NEW.document_id AND organization_id=NEW.organization_id FOR SHARE;
 IF NOT FOUND OR d.file_verified IS DISTINCT FROM true OR d.document_type IS DISTINCT FROM 'INVOICE_DISTRIBUTOR' OR d.file_hash IS DISTINCT FROM NEW.file_hash THEN RAISE EXCEPTION 'OCR_REVIEW_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO j FROM public.document_ocr_jobs WHERE id=NEW.job_id AND organization_id=NEW.organization_id AND document_id=NEW.document_id AND file_hash=NEW.file_hash AND state='SUCCEEDED' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.document_ocr_results r WHERE r.job_id=NEW.job_id AND r.organization_id=NEW.organization_id AND r.document_id=NEW.document_id AND r.file_hash=NEW.file_hash) THEN RAISE EXCEPTION 'OCR_REVIEW_RESULT_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=d.consumer_unit_id AND u.customer_id=d.customer_id AND u.organization_id=d.organization_id AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'OCR_REVIEW_REGISTRATION_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW.source_snapshot->>'format' IS DISTINCT FROM 'ocr-identity-review-v1' OR NEW.source_snapshot#>>'{document,id}' IS DISTINCT FROM d.id OR NEW.source_snapshot#>>'{document,organizationId}' IS DISTINCT FROM d.organization_id OR NEW.source_snapshot#>>'{document,fileHash}' IS DISTINCT FROM d.file_hash OR NEW.source_snapshot#>>'{document,customerId}' IS DISTINCT FROM d.customer_id OR NEW.source_snapshot#>>'{document,unitId}' IS DISTINCT FROM d.consumer_unit_id OR NEW.source_snapshot#>>'{document,month}' IS DISTINCT FROM left(d.reference_month::text,7) OR NEW.source_snapshot->>'jobId' IS DISTINCT FROM NEW.job_id::text OR NEW.source_snapshot#>>'{field,key}' IS DISTINCT FROM NEW.field_key THEN RAISE EXCEPTION 'OCR_REVIEW_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW.decision='CONFIRMED' AND (NEW.source_snapshot#>>'{field,state}' IS DISTINCT FROM 'EXTRACTED_REVIEW' OR NEW.source_snapshot#>>'{field,decimal}' IS NULL) THEN RAISE EXCEPTION 'OCR_REVIEW_NOT_CONFIRMABLE' USING ERRCODE='23514'; END IF;
 SELECT * INTO review_customer FROM public.customers WHERE id=d.customer_id AND organization_id=d.organization_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OCR_REVIEW_REGISTRATION_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO review_unit FROM public.consumer_units WHERE id=d.consumer_unit_id AND customer_id=d.customer_id AND organization_id=d.organization_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OCR_REVIEW_REGISTRATION_INVALID' USING ERRCODE='23514'; END IF;
 reg:=jsonb_build_object('customer',jsonb_build_object('company_name',review_customer.company_name,'document',review_customer.document),'unit',jsonb_build_object('consumer_unit_number',review_unit.consumer_unit_number,'address',review_unit.address,'free_market',review_unit.free_market));
 IF NEW.source_snapshot->'registration' IS DISTINCT FROM reg THEN RAISE EXCEPTION 'OCR_REVIEW_REGISTRATION_CHANGED' USING ERRCODE='23514'; END IF;
 IF NEW.decision='CONFIRMED' AND ((NEW.source_snapshot#>>'{field,check,comparison}' IS DISTINCT FROM 'EQUAL' AND NOT coalesce((NEW.source_snapshot#>>'{field,attestation,policy}' = 'elektro-identity-attestation-v1'
 AND NEW.source_snapshot#>>'{field,attestation,registeredTaxId}' = regexp_replace(review_customer.document,'[^0-9]','','g')
 AND length(NEW.source_snapshot#>>'{field,attestation,registeredTaxId}')=14
 AND NEW.source_snapshot#>>'{field,attestation,visibleSuffix}' = right(regexp_replace(review_customer.document,'[^0-9]','','g'),6)
 AND NEW.source_snapshot#>>'{field,attestation,unit}' = review_unit.consumer_unit_number
 AND NEW.source_snapshot#>>'{field,attestation,address}' = review_unit.address
 AND NEW.source_snapshot#>>'{field,attestation,month}' = left(d.reference_month::text,7)
 AND NEW.source_snapshot#>>'{field,attestation,registeredName}' = review_customer.company_name
 AND NEW.source_snapshot#>>'{field,attestation,market}' = CASE WHEN review_unit.free_market THEN 'ACL' WHEN review_unit.free_market IS FALSE THEN 'ACR' ELSE '' END
 AND jsonb_array_length(NEW.source_snapshot#>'{field,attestation,anchors,tax}')=1
 AND (NEW.source_snapshot#>>'{field,attestation,anchors,tax,0,text}') ~ '^CNPJ[[:space:]]*[-:]?[[:space:]]*\*{8}[[:space:]]*[0-9]{6}[[:space:]]*$'
 AND regexp_replace(NEW.source_snapshot#>>'{field,attestation,anchors,tax,0,text}','[^0-9]','','g')=right(regexp_replace(review_customer.document,'[^0-9]','','g'),6)
 AND regexp_replace(NEW.source_snapshot#>>'{field,attestation,anchors,unit,0,text}','[^0-9]','','g')=regexp_replace(review_unit.consumer_unit_number,'[^0-9]','','g')
 AND length(btrim(NEW.note))>=20
 AND ((NEW.field_key='taxId' AND NEW.source_snapshot#>>'{field,attestation,mode}'='MASKED_TAX_ID' AND NEW.source_snapshot#>>'{field,check,comparison}'='PARTIAL')
 OR (NEW.field_key='customer' AND NEW.source_snapshot#>>'{field,attestation,mode}'='NAME_EQUIVALENCE' AND NEW.source_snapshot#>>'{field,check,comparison}'='DIFFERENT')
 OR (NEW.field_key='market' AND NEW.source_snapshot#>>'{field,attestation,mode}'='REGISTERED_MARKET' AND NEW.source_snapshot#>>'{field,check,comparison}'='UNKNOWN' AND NEW.source_snapshot#>>'{field,decimal}'=CASE WHEN review_unit.free_market THEN 'ACL' ELSE 'ACR' END))),false)) OR EXISTS(SELECT 1 FROM public.documents other WHERE other.organization_id=d.organization_id AND other.consumer_unit_id=d.consumer_unit_id AND other.reference_month=d.reference_month AND other.document_type='INVOICE_DISTRIBUTOR' AND other.id<>d.id)) THEN RAISE EXCEPTION 'OCR_REVIEW_IDENTITY_NOT_CONFIRMABLE' USING ERRCODE='23514'; END IF;
 SELECT id,version INTO last_id,last_version FROM public.document_ocr_identity_reviews WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id AND field_key=NEW.field_key ORDER BY version DESC LIMIT 1;
 IF last_id IS DISTINCT FROM NEW.expected_review_id THEN RAISE EXCEPTION 'OCR_REVIEW_STALE' USING ERRCODE='40001'; END IF;
 NEW.version=coalesce(last_version,0)+1;NEW.created_at=clock_timestamp();RETURN NEW;
END $$;


NOTIFY pgrst,'reload schema';
COMMIT;
