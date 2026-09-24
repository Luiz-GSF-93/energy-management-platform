-- Metadata only. No existing document is edited or removed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS description text, ADD COLUMN IF NOT EXISTS mime_type varchar(100);
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND is_nullable='YES'
      AND ((column_name='description' AND data_type='text') OR (column_name='mime_type' AND data_type='character varying' AND character_maximum_length=100))) <> 2 THEN
    RAISE EXCEPTION 'Unexpected document metadata schema';
  END IF;
  IF EXISTS(SELECT 1 FROM public.documents GROUP BY organization_id,lower(file_hash) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate document hashes need review before migration';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS documents_org_file_hash_unique ON public.documents (organization_id,lower(file_hash));
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE c.oid='public.documents_org_file_hash_unique'::regclass AND i.indrelid='public.documents'::regclass
      AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
      AND pg_get_indexdef(c.oid)='CREATE UNIQUE INDEX documents_org_file_hash_unique ON public.documents USING btree (organization_id, lower((file_hash)::text))') THEN
    RAISE EXCEPTION 'Unexpected document hash index definition';
  END IF;
END $$;
COMMIT;
