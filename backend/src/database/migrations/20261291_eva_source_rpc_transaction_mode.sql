-- PostgREST runs STABLE RPCs in READ ONLY transactions. The existing actor
-- checks deliberately acquire FOR SHARE locks; preserve them and use the
-- normal transaction mode required by the complete call graph.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
ALTER FUNCTION public.eva_intake_source_fingerprint(uuid,uuid) VOLATILE;
ALTER FUNCTION public.eva_intake_alias_catalog(uuid,uuid) VOLATILE;
NOTIFY pgrst,'reload schema';
COMMIT;
