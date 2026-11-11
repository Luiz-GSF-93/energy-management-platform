BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- A failed preflight with no commercial reservation and no closing version
-- has no uncertain financial effect to replay. The existing reconciliation
-- still verifies actor, license, original, OCR, current unit and approvals.
CREATE OR REPLACE FUNCTION public.eva_intake_unstarted_closing(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.eva_automatic_intakes i WHERE i.id=p_id AND i.state='UNKNOWN'
  AND NOT EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=i.organization_id AND r.consumer_unit_id=i.unit_id AND r.month=i.month)
  AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.organization_id=i.organization_id AND v.customer_id=i.customer_id AND v.month=i.month)
  AND (SELECT e.body#>>'{diagnostic,stage}'='CLOSING_PREPARATION' AND e.body#>>'{diagnostic,cause}'='HTTP_409' FROM public.eva_automatic_intake_events e WHERE e.organization_id=i.organization_id AND e.intake_id=i.id AND e.event='unknown' ORDER BY e.sequence DESC LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.eva_intake_unstarted_closing(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE d text;old text;replacement text;
BEGIN
 d:=pg_get_functiondef('public.eva_intake_administration(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 old:=$old$OR (NOT i.ai_attempted AND NOT EXISTS($old$;
 replacement:=$new$OR (NOT i.ai_attempted AND NOT public.eva_intake_unstarted_closing(i.id) AND NOT EXISTS($new$;
 IF strpos(d,old)>0 THEN d:=replace(d,old,replacement);ELSIF strpos(d,replacement)=0 THEN RAISE EXCEPTION 'Review reconciliation inference baseline';END IF;
 old:=$old$IF NOT EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=p_org AND r.consumer_unit_id=i.unit_id AND r.month=i.month AND r.document_id=i.document_id AND r.source_hash=i.file_hash)$old$;
 replacement:=$new$IF (NOT public.eva_intake_unstarted_closing(i.id) AND NOT EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=p_org AND r.consumer_unit_id=i.unit_id AND r.month=i.month AND r.document_id=i.document_id AND r.source_hash=i.file_hash))$new$;
 IF strpos(d,old)>0 THEN d:=replace(d,old,replacement);ELSIF strpos(d,replacement)=0 THEN RAISE EXCEPTION 'Review reconciliation effect baseline';END IF;EXECUTE d;
END$patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
