-- Append-only human identity review; never automatic OCR confidence or financial approval.
BEGIN;
CREATE TABLE public.document_ocr_identity_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES public.organizations(id),
 document_id text NOT NULL REFERENCES public.documents(id),
 job_id uuid NOT NULL REFERENCES public.document_ocr_jobs(id),
 file_hash text NOT NULL CHECK(file_hash ~ '^[a-f0-9]{64}$'),
 field_key text NOT NULL CHECK(field_key IN ('customer','taxId','unit','address','period','market')),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object' AND octet_length(source_snapshot::text)<50000),
 decision text NOT NULL CHECK(decision IN ('CONFIRMED','NEEDS_CORRECTION')),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=500 AND length(btrim(note))>=3),
 checked_pdf boolean NOT NULL CHECK(checked_pdf IS TRUE),
 expected_review_id uuid,
 version integer NOT NULL,
 request_id uuid NOT NULL,
 created_by text NOT NULL CHECK(length(btrim(created_by))>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,request_id), UNIQUE(organization_id,document_id,field_key,version)
);
CREATE FUNCTION public.guard_document_ocr_identity_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 IF NEW.decision='CONFIRMED' AND (NEW.source_snapshot#>>'{field,check,comparison}' IS DISTINCT FROM 'EQUAL' OR EXISTS(SELECT 1 FROM public.documents other WHERE other.organization_id=d.organization_id AND other.consumer_unit_id=d.consumer_unit_id AND other.reference_month=d.reference_month AND other.document_type='INVOICE_DISTRIBUTOR' AND other.id<>d.id)) THEN RAISE EXCEPTION 'OCR_REVIEW_IDENTITY_NOT_CONFIRMABLE' USING ERRCODE='23514'; END IF;
 SELECT id,version INTO last_id,last_version FROM public.document_ocr_identity_reviews WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id AND field_key=NEW.field_key ORDER BY version DESC LIMIT 1;
 IF last_id IS DISTINCT FROM NEW.expected_review_id THEN RAISE EXCEPTION 'OCR_REVIEW_STALE' USING ERRCODE='40001'; END IF;
 NEW.version=coalesce(last_version,0)+1;NEW.created_at=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER guard_document_ocr_identity_review BEFORE INSERT OR UPDATE OR DELETE ON public.document_ocr_identity_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_document_ocr_identity_review();
ALTER TABLE public.document_ocr_identity_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_ocr_identity_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.document_ocr_identity_reviews TO service_role;
REVOKE ALL ON FUNCTION public.guard_document_ocr_identity_review() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.document_ocr_identity_reviews IS 'Human identity and period review tied to current registration and OCR source; no financial approval.';
NOTIFY pgrst,'reload schema';
COMMIT;
