-- Verified uploads and atomic license quota. No existing document is changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS file_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS file_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS upload_license_id text;
DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='documents'
   AND ((column_name='file_verified' AND data_type='boolean' AND is_nullable='NO')
    OR (column_name='storage_bucket' AND data_type='text')
    OR (column_name='file_verified_at' AND data_type='timestamp with time zone')
    OR (column_name='upload_license_id' AND data_type='text')))<>4 THEN RAISE EXCEPTION 'Unexpected upload schema'; END IF;
END $$;
-- Restrictive policy keeps this bucket server-only even if another permissive
-- policy grants authenticated users access to other buckets.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='energy_documents_server_only') THEN
   CREATE POLICY energy_documents_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
     USING (bucket_id <> 'energy-documents-private') WITH CHECK (bucket_id <> 'energy-documents-private');
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.enforce_document_upload_quota() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE selected_license public.licenses%ROWTYPE; candidate_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id, 19));
  SELECT count(*) INTO candidate_count FROM public.licenses
    WHERE organization_id=NEW.organization_id AND active=true AND lower(status)='active'
      AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
  IF candidate_count<>1 THEN RAISE EXCEPTION 'DOCUMENT_LICENSE_REQUIRED'; END IF;
  SELECT * INTO selected_license FROM public.licenses
    WHERE organization_id=NEW.organization_id AND active=true AND lower(status)='active'
      AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) FOR UPDATE;
  IF NOT FOUND OR selected_license.document_management IS DISTINCT FROM true THEN RAISE EXCEPTION 'DOCUMENT_LICENSE_REQUIRED'; END IF;
  IF selected_license.documents_limit IS NULL OR COALESCE(selected_license.documents_used,0)>=selected_license.documents_limit THEN
    RAISE EXCEPTION 'DOCUMENT_QUOTA_EXCEEDED';
  END IF;
  UPDATE public.licenses SET documents_used=COALESCE(documents_used,0)+1 WHERE id=selected_license.id;
  NEW.upload_license_id=selected_license.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_document_upload_quota() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_document_upload_quota() TO service_role;
CREATE OR REPLACE TRIGGER enforce_document_upload_quota BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_upload_quota();
COMMIT;
