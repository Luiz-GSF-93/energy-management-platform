BEGIN;
-- Machine extraction is never recorded as a person's CONFIRMED/checkedPdf decision.
CREATE TABLE public.bot_energy_ocr_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL CHECK(length(btrim(organization_id))>0),
 document_id text NOT NULL REFERENCES public.documents(id),actor_id text NOT NULL CHECK(length(btrim(actor_id))>0),
 source_basis text NOT NULL CHECK(source_basis ~ '^[a-f0-9]{64}$'),
 fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='array'),
 fields_hash text NOT NULL CHECK(fields_hash=encode(sha256(convert_to(fields::text,'UTF8')),'hex')),
 state text NOT NULL DEFAULT 'MACHINE_DRAFT' CHECK(state='MACHINE_DRAFT'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX bot_energy_ocr_drafts_idempotency ON public.bot_energy_ocr_drafts(organization_id,document_id,source_basis,fields_hash);
CREATE FUNCTION public.save_bot_energy_ocr_draft(p_organization text,p_actor text,p_document text,p_basis text,p_fields jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_actor IS NULL OR p_basis IS NULL OR p_basis !~ '^[a-f0-9]{64}$' OR p_fields IS NULL OR jsonb_typeof(p_fields)<>'array' OR jsonb_array_length(p_fields) NOT BETWEEN 1 AND 80 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=p_document AND organization_id=p_organization) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields) f WHERE jsonb_typeof(f)<>'object' OR jsonb_typeof(f->'key') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'value') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'source') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'sourceHash') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'quality') IS DISTINCT FROM 'string' OR NOT(f ?& ARRAY['key','value','source','sourceHash','quality','interpreted','doubts']) OR length(f->>'key') NOT BETWEEN 1 AND 100 OR length(f->>'value') NOT BETWEEN 1 AND 1000 OR length(f->>'source') NOT BETWEEN 1 AND 2000 OR f->>'sourceHash' !~ '^[a-f0-9]{64}$' OR f->>'quality' NOT IN ('REVIEW_REQUIRED','EXTRACTED_DRAFT') OR jsonb_typeof(f->'doubts')<>'array' OR jsonb_typeof(f->'interpreted')<>'boolean') THEN RETURN false; END IF;
 IF (SELECT count(*)<>count(DISTINCT f->>'key') FROM jsonb_array_elements(p_fields) f) THEN RETURN false; END IF;
 INSERT INTO public.bot_energy_ocr_drafts(organization_id,document_id,actor_id,source_basis,fields,fields_hash) VALUES(p_organization,p_document,p_actor,p_basis,p_fields,encode(sha256(convert_to(p_fields::text,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
 RETURN true;
END $$;
ALTER TABLE public.bot_energy_ocr_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_energy_ocr_drafts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.bot_energy_ocr_drafts TO service_role;
REVOKE ALL ON FUNCTION public.save_bot_energy_ocr_draft(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_bot_energy_ocr_draft(text,text,text,text,jsonb) TO service_role;
COMMIT;
