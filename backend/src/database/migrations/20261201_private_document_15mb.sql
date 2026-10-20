BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='energy-documents-private' AND public=false AND file_size_limit IN(10485760,15728640)) THEN RAISE EXCEPTION 'Review private document bucket configuration';END IF;
END$$;
UPDATE storage.buckets SET file_size_limit=15728640 WHERE id='energy-documents-private' AND public=false AND file_size_limit=10485760;
COMMIT;
