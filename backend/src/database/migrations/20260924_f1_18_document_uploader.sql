BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE target_table regclass;
BEGIN
 SELECT confrelid INTO target_table FROM pg_constraint WHERE conrelid='public.documents'::regclass AND conname='documents_uploaded_by_auth_user_id_fkey' AND contype='f';
 IF target_table IS NULL OR target_table NOT IN ('public.users'::regclass,'auth.users'::regclass) THEN RAISE EXCEPTION 'Unexpected document uploader foreign key; review schema drift'; END IF;
 IF EXISTS(SELECT 1 FROM public.documents d WHERE d.uploaded_by_auth_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=d.uploaded_by_auth_user_id)) THEN RAISE EXCEPTION 'Document uploader lacks canonical auth identity'; END IF;
END $$;
ALTER TABLE public.documents DROP CONSTRAINT documents_uploaded_by_auth_user_id_fkey;
ALTER TABLE public.documents ADD CONSTRAINT documents_uploaded_by_auth_user_id_fkey FOREIGN KEY(uploaded_by_auth_user_id) REFERENCES auth.users(id);
COMMIT;