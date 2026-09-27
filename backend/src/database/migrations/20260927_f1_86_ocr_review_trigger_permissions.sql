-- Lock source rows with the trusted trigger owner's privileges, not API table grants.
-- All existing source, tenant, snapshot, version and immutability guards remain intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER FUNCTION public.guard_document_ocr_field_review() SECURITY DEFINER;
ALTER FUNCTION public.guard_document_ocr_field_review() SET search_path = pg_catalog;
ALTER FUNCTION public.guard_document_ocr_demand_review() SECURITY DEFINER;
ALTER FUNCTION public.guard_document_ocr_demand_review() SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION public.guard_document_ocr_field_review() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_document_ocr_demand_review() FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
