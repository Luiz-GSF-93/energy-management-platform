BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $$DECLARE b storage.buckets;BEGIN
 SELECT * INTO b FROM storage.buckets WHERE id='energy-documents-private' FOR UPDATE;
 IF b.id IS NULL OR b.public IS DISTINCT FROM false OR b.file_size_limit IS NULL OR b.file_size_limit<10485760 THEN RAISE EXCEPTION 'Review the existing private document bucket before Trading activation';END IF;
 IF b.file_size_limit<20971520 THEN UPDATE storage.buckets SET file_size_limit=20971520 WHERE id=b.id;END IF;
END$$;
-- Existing 15 MB intake limits remain at their authenticated endpoints. No public storage access is added.
COMMIT;
