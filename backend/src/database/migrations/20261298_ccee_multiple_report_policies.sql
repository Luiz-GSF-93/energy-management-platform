BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Each reviewed report/frame has its own cursor. Preserve all existing
-- policies, responsibility, authorization revisions and communication limits.
DO $migration$
DECLARE r record;d text;needle text;replacement text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.ccee_service_sync_policies WHERE kind='DRI' AND (nullif(source_selector->>'reportName','') IS NULL OR nullif(source_selector->>'frameName','') IS NULL)) THEN RAISE EXCEPTION 'Review existing DRI selectors';END IF;
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='public.ccee_service_sync_policies'::regclass AND contype='u' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.ccee_service_sync_policies'::regclass AND attname='organization_id'),(SELECT attnum FROM pg_attribute WHERE attrelid='public.ccee_service_sync_policies'::regclass AND attname='authorization_id'),(SELECT attnum FROM pg_attribute WHERE attrelid='public.ccee_service_sync_policies'::regclass AND attname='kind')]::smallint[] LOOP
  EXECUTE format('ALTER TABLE public.ccee_service_sync_policies DROP CONSTRAINT %I',r.conname);
 END LOOP;
 d:=pg_get_functiondef('public.ccee_auto_policy_action(text,text,text,uuid,jsonb)'::regprocedure);
 IF strpos(d,'AS report_name')=0 THEN
  needle:='SELECT id,kind,month,authorization_id,finished_at FROM public.ccee_integration_jobs';
  replacement:=$select$SELECT source_job.id,source_job.kind,source_job.month,source_job.authorization_id,source_job.finished_at,
   source_job.request_payload->>'reportId' AS report_id,source_job.request_payload->>'frameId' AS frame_id,
   (SELECT r->>'name' FROM public.ccee_integration_jobs catalog_job CROSS JOIN LATERAL jsonb_array_elements(catalog_job.result#>'{data,rows}') r WHERE catalog_job.id=(source_job.request_payload->>'parentJobId')::uuid AND catalog_job.organization_id=source_job.organization_id AND catalog_job.authorization_id=source_job.authorization_id AND r->>'id'=source_job.request_payload->>'reportId') AS report_name,
   (SELECT f->>'name' FROM public.ccee_integration_jobs catalog_job CROSS JOIN LATERAL jsonb_array_elements(catalog_job.result#>'{data,rows}') r CROSS JOIN LATERAL jsonb_array_elements(r->'frames') f WHERE catalog_job.id=(source_job.request_payload->>'parentJobId')::uuid AND catalog_job.organization_id=source_job.organization_id AND catalog_job.authorization_id=source_job.authorization_id AND r->>'id'=source_job.request_payload->>'reportId' AND f->>'id'=source_job.request_payload->>'frameId') AS frame_name
   FROM public.ccee_integration_jobs source_job$select$;
  IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Review automatic source listing baseline';END IF;
  d:=replace(d,needle,replacement);
 END IF;
 IF strpos(d,'Automatic report stream changed')=0 THEN
  needle:='IF p.id IS NULL THEN INSERT INTO public.ccee_service_sync_policies(organization_id,authorization_id,kind,created_by,source_job_id';
  IF strpos(d,needle)=0 THEN RAISE EXCEPTION 'Review automatic configuration baseline';END IF;
  d:=replace(d,needle,$guard$IF p.id IS NOT NULL AND p.kind='DRI' AND (p.source_selector->>'reportName' IS DISTINCT FROM selector->>'reportName' OR p.source_selector->>'frameName' IS DISTINCT FROM selector->>'frameName') THEN RAISE EXCEPTION 'Automatic report stream changed' USING ERRCODE='40001';END IF;
   $guard$||needle);
 END IF;
 EXECUTE d;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ccee_service_sync_policies'::regclass AND conname='ccee_auto_dri_selector_required') THEN ALTER TABLE public.ccee_service_sync_policies ADD CONSTRAINT ccee_auto_dri_selector_required CHECK(kind<>'DRI' OR (nullif(source_selector->>'reportName','') IS NOT NULL AND nullif(source_selector->>'frameName','') IS NOT NULL));END IF;
END$migration$;
CREATE UNIQUE INDEX IF NOT EXISTS ccee_auto_non_dri_unique ON public.ccee_service_sync_policies(organization_id,authorization_id,kind) WHERE kind<>'DRI';
CREATE UNIQUE INDEX IF NOT EXISTS ccee_auto_dri_report_unique ON public.ccee_service_sync_policies(organization_id,authorization_id,(source_selector->>'reportName'),(source_selector->>'frameName')) WHERE kind='DRI';
NOTIFY pgrst,'reload schema';
COMMIT;
