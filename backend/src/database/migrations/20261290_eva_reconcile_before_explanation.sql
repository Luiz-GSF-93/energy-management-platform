-- An optional model call is not proof of a committed financial preparation.
-- Keep every existing source/effect/approval guard. Before inference, resume
-- only the latest overlapping closing with this exact document and hash.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE d text;needle text:='OR NOT i.ai_attempted OR i.lease_token IS NOT NULL';replacement text;
BEGIN
 d:=pg_get_functiondef('public.eva_intake_administration(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 replacement:=$guard$OR (NOT i.ai_attempted AND NOT EXISTS(
   SELECT 1 FROM public.eva_assisted_closing_versions v
   WHERE v.organization_id=i.organization_id AND v.customer_id=i.customer_id AND v.month=i.month
   AND v.id=(SELECT latest.id FROM public.eva_assisted_closing_versions latest
     WHERE latest.organization_id=i.organization_id AND latest.customer_id=i.customer_id AND latest.month=i.month
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(latest.report->'units')u WHERE u->>'id'=i.unit_id)
     ORDER BY latest.version DESC,latest.created_at DESC,latest.id DESC LIMIT 1)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units')u WHERE u->>'id'=i.unit_id AND u->>'documentId'=i.document_id AND u->>'sourceHash'=i.file_hash)
   AND (SELECT e.state FROM public.eva_assisted_closing_events e WHERE e.organization_id=i.organization_id AND e.closing_id=v.id ORDER BY e.sequence DESC LIMIT 1) IN('INCOMPLETE','READY_FOR_REVIEW')
  )) OR i.lease_token IS NOT NULL$guard$;
 IF position(needle IN d)=0 THEN
  IF position(replacement IN d)>0 THEN RETURN;END IF;
  RAISE EXCEPTION 'Review preparation reconciliation guard before rollout';
 END IF;
 EXECUTE replace(d,needle,replacement);
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
