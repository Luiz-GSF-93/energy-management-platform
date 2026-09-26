-- Durable OCR transport queue. No financial writes or auto-approval.
BEGIN;
CREATE TABLE public.document_ocr_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL,
 document_id text NOT NULL REFERENCES public.documents(id),
 file_hash text NOT NULL CHECK (file_hash ~ '^[a-f0-9]{64}$'),
 requested_by text NOT NULL CHECK (length(trim(requested_by))>0),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','SUBMITTING','POLLING','SUCCEEDED','FAILED','SUBMISSION_UNKNOWN')),
 operation_url text,
 lease_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,document_id),
 CHECK ((lease_token IS NULL)=(lease_until IS NULL)),
 CHECK (state<>'POLLING' OR operation_url IS NOT NULL)
);
CREATE INDEX document_ocr_jobs_ready ON public.document_ocr_jobs(next_attempt_at,created_at) WHERE state IN ('QUEUED','POLLING');
CREATE TABLE public.document_ocr_results (
 job_id uuid PRIMARY KEY REFERENCES public.document_ocr_jobs(id),
 organization_id text NOT NULL,
 document_id text NOT NULL REFERENCES public.documents(id),
 file_hash text NOT NULL,
 provider text NOT NULL DEFAULT 'AZURE_DOCUMENT_INTELLIGENCE',
 extraction_version text NOT NULL DEFAULT 'azure-invoice-evidence-v1',
 raw_result jsonb NOT NULL,
 evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.document_ocr_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_ocr_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_ocr_jobs,public.document_ocr_results FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.document_ocr_jobs,public.document_ocr_results TO service_role;
CREATE FUNCTION public.ocr_result_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'OCR_RESULT_IMMUTABLE'; END $$;
CREATE TRIGGER ocr_result_immutable BEFORE UPDATE OR DELETE ON public.document_ocr_results FOR EACH ROW EXECUTE FUNCTION public.ocr_result_immutable();
CREATE FUNCTION public.enqueue_document_ocr(p_org text,p_document text,p_actor text) RETURNS public.document_ocr_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.documents; j public.document_ocr_jobs;
BEGIN
 SELECT * INTO d FROM public.documents WHERE id=p_document AND organization_id=p_org FOR SHARE;
 IF NOT FOUND OR d.document_type<>'INVOICE_DISTRIBUTOR' OR d.file_verified IS DISTINCT FROM true OR d.storage_bucket IS DISTINCT FROM 'energy-documents-private' OR d.file_hash IS NULL OR d.file_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'OCR_DOCUMENT_NOT_ELIGIBLE'; END IF;
 IF p_actor IS NULL OR length(trim(p_actor))=0 THEN RAISE EXCEPTION 'OCR_ACTOR_REQUIRED'; END IF;
 INSERT INTO public.document_ocr_jobs(organization_id,document_id,file_hash,requested_by) VALUES(p_org,p_document,d.file_hash,p_actor) ON CONFLICT(organization_id,document_id) DO NOTHING;
 SELECT * INTO STRICT j FROM public.document_ocr_jobs WHERE organization_id=p_org AND document_id=p_document;
 IF j.file_hash<>d.file_hash THEN RAISE EXCEPTION 'OCR_SOURCE_CHANGED'; END IF;
 RETURN j;
END $$;
CREATE FUNCTION public.claim_document_ocr() RETURNS SETOF public.document_ocr_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.document_ocr_jobs;
BEGIN
 -- A process may have died after POST. Never resubmit an expired SUBMITTING job.
 UPDATE public.document_ocr_jobs SET state='SUBMISSION_UNKNOWN',error_code='SUBMISSION_UNKNOWN',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE state='SUBMITTING' AND lease_until<now();
 SELECT * INTO j FROM public.document_ocr_jobs WHERE state IN ('QUEUED','POLLING') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.document_ocr_jobs SET lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=attempts+1,updated_at=now() WHERE id=j.id RETURNING * INTO j;
 RETURN NEXT j;
END $$;
CREATE FUNCTION public.transition_document_ocr(p_id uuid,p_token uuid,p_action text,p_operation text DEFAULT NULL,p_delay integer DEFAULT 5,p_error text DEFAULT NULL,p_result jsonb DEFAULT NULL,p_evidence jsonb DEFAULT NULL) RETURNS public.document_ocr_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.document_ocr_jobs;
BEGIN
 SELECT * INTO j FROM public.document_ocr_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.lease_token IS DISTINCT FROM p_token OR p_token IS NULL OR j.lease_until<=now() THEN RAISE EXCEPTION 'OCR_LEASE_LOST'; END IF;
 IF j.state NOT IN ('QUEUED','SUBMITTING','POLLING') THEN RAISE EXCEPTION 'OCR_TERMINAL_JOB'; END IF;
 IF p_action='BEGIN_SUBMISSION' AND j.state='QUEUED' THEN
  UPDATE public.document_ocr_jobs SET state='SUBMITTING',updated_at=now() WHERE id=j.id RETURNING * INTO j; RETURN j;
 ELSIF p_action='ACCEPTED' AND j.state='SUBMITTING' AND p_operation IS NOT NULL AND length(p_operation)<=2000 THEN
  j.state='POLLING';j.operation_url=p_operation;
 ELSIF p_action='WAIT' AND j.state='POLLING' THEN NULL;
 ELSIF p_action='RETRY_SUBMISSION' AND j.state='SUBMITTING' AND p_error='RATE_LIMITED' THEN
  j.state='QUEUED';
 ELSIF p_action='UNKNOWN' AND j.state='SUBMITTING' THEN j.state='SUBMISSION_UNKNOWN';
 ELSIF p_action='FAIL' THEN j.state='FAILED';
 ELSIF p_action='COMPLETE' AND j.state='POLLING' AND jsonb_typeof(p_result)='object' AND jsonb_typeof(p_evidence)='object' THEN
  INSERT INTO public.document_ocr_results(job_id,organization_id,document_id,file_hash,raw_result,evidence) VALUES(j.id,j.organization_id,j.document_id,j.file_hash,p_result,p_evidence);
  j.state='SUCCEEDED';
 ELSE RAISE EXCEPTION 'OCR_INVALID_TRANSITION'; END IF;
 UPDATE public.document_ocr_jobs SET state=j.state,operation_url=j.operation_url,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+make_interval(secs=>greatest(1,least(coalesce(p_delay,5),3600))),error_code=left(p_error,80),updated_at=now() WHERE id=j.id RETURNING * INTO j;
 RETURN j;
END $$;
REVOKE ALL ON FUNCTION public.ocr_result_immutable(),public.enqueue_document_ocr(text,text,text),public.claim_document_ocr(),public.transition_document_ocr(uuid,uuid,text,text,integer,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_document_ocr(text,text,text),public.claim_document_ocr(),public.transition_document_ocr(uuid,uuid,text,text,integer,text,jsonb,jsonb) TO service_role;
COMMIT;
