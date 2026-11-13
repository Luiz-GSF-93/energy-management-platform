BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE INDEX IF NOT EXISTS eva_intake_org_operations ON public.eva_automatic_intakes(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS eva_closing_org_operations ON public.eva_assisted_closing_versions(organization_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.platform_eva_stability(p_actor uuid,p_search text DEFAULT '',p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' AS $$
DECLARE result jsonb;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<statement_timestamp())) THEN RAISE EXCEPTION 'Active Owner required' USING ERRCODE='42501';END IF;
 PERFORM public.platform_team_owner(p_actor);
 IF p_search IS NULL OR length(p_search)>150 OR p_offset IS NULL OR p_offset<0 OR p_offset>25000 OR p_offset%25<>0 THEN RAISE EXCEPTION 'Invalid stability filter' USING ERRCODE='22023';END IF;
 WITH licensed AS MATERIALIZED(
  SELECT o.id,o.name,(SELECT count(*) FROM public.licenses l WHERE l.organization_id=o.id AND l.active AND lower(l.status)='active' AND l.start_date<=CURRENT_DATE AND(l.end_date IS NULL OR l.end_date>=CURRENT_DATE)) AS license_count
  FROM public.organizations o WHERE o.deleted_at IS NULL AND EXISTS(SELECT 1 FROM public.licenses l WHERE l.organization_id=o.id AND l.active AND lower(l.status)='active' AND l.start_date<=CURRENT_DATE AND(l.end_date IS NULL OR l.end_date>=CURRENT_DATE))
 ),selected AS MATERIALIZED(
  SELECT * FROM licensed WHERE p_search='' OR name ILIKE '%'||p_search||'%' OR id=p_search ORDER BY lower(name),id LIMIT 25 OFFSET p_offset
 ),counts AS(
  SELECT o.*,m.manual,i.intakes,c.closing_receipts FROM selected o
  CROSS JOIN LATERAL(
   SELECT jsonb_build_object('queued',count(*) FILTER(WHERE effective='QUEUED'),'running',count(*) FILTER(WHERE effective='RUNNING'),'uncertain',count(*) FILTER(WHERE effective='UNKNOWN'),'failed30d',count(*) FILTER(WHERE effective='FAILED' AND created_at>=statement_timestamp()-interval '30 days'),'succeeded30d',count(*) FILTER(WHERE effective='SUCCEEDED' AND created_at>=statement_timestamp()-interval '30 days'),'oldestQueueSeconds',coalesce(extract(epoch FROM(statement_timestamp()-min(created_at) FILTER(WHERE effective='QUEUED')))::bigint,0)) AS manual
   FROM(SELECT created_at,CASE WHEN state='RUNNING' AND lease_until<statement_timestamp() THEN CASE WHEN write_started THEN 'UNKNOWN' ELSE 'QUEUED' END ELSE state END AS effective FROM public.eva_manual_preparations WHERE organization_id=o.id AND(created_at>=statement_timestamp()-interval '30 days' OR state IN('QUEUED','RUNNING','UNKNOWN')))j
  )m
  CROSS JOIN LATERAL(
   SELECT jsonb_build_object('technical',count(*) FILTER(WHERE state='UNKNOWN' OR state='PREPARING' AND(lease_until IS NULL OR lease_until<statement_timestamp())),'human',count(*) FILTER(WHERE state='REVIEW_REQUIRED'),'sources',count(*) FILTER(WHERE state='AWAITING_SOURCES'),'processing',count(*) FILTER(WHERE state IN('RECEIVING','RECOGNIZING','OCR_QUEUED','OCR_SUBMITTING','OCR_POLLING','LINKING','WAITING_OCR') OR state='PREPARING' AND lease_until>=statement_timestamp()),'proposals30d',count(*) FILTER(WHERE state='PROPOSAL_READY' AND created_at>=statement_timestamp()-interval '30 days')) AS intakes
   FROM public.eva_automatic_intakes WHERE organization_id=o.id AND(created_at>=statement_timestamp()-interval '30 days' OR state IN('UNKNOWN','PREPARING','REVIEW_REQUIRED','AWAITING_SOURCES','RECEIVING','RECOGNIZING','OCR_QUEUED','OCR_SUBMITTING','OCR_POLLING','LINKING','WAITING_OCR'))
  )i
  CROSS JOIN LATERAL(
   SELECT count(*) AS closing_receipts FROM public.eva_assisted_closing_versions v
   WHERE v.organization_id=o.id AND v.created_at<statement_timestamp()-interval '5 minutes'
   AND (SELECT e.state FROM public.eva_assisted_closing_events e WHERE e.closing_id=v.id ORDER BY e.sequence DESC LIMIT 1) IN('PREPARING','UNKNOWN')
   AND NOT EXISTS(SELECT 1 FROM public.eva_manual_preparations j WHERE j.organization_id=o.id AND j.execution_id=v.id AND j.state='RUNNING' AND j.lease_until>=statement_timestamp())
   AND NOT EXISTS(SELECT 1 FROM public.eva_automatic_intakes a WHERE a.organization_id=o.id AND a.closing_id=v.id AND a.state='PREPARING' AND a.lease_until>=statement_timestamp())
  )c
 ) SELECT jsonb_build_object('generatedAt',statement_timestamp(),'pageSize',25,'windowDays',30,'responsible','OWNER','total',(SELECT count(*) FROM licensed WHERE p_search='' OR name ILIKE '%'||p_search||'%' OR id=p_search),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('organizationId',id,'organizationName',name,'activeLicenses',license_count,'manual',manual,'intakes',intakes,'closingReceipts',closing_receipts,'attention',closing_receipts>0 OR license_count<>1 OR (manual->>'uncertain')::bigint>0 OR (manual->>'failed30d')::bigint>0 OR (manual->>'oldestQueueSeconds')::bigint>300 OR (intakes->>'technical')::bigint>0) ORDER BY lower(name),id) FROM counts),'[]')) INTO result;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.platform_eva_stability(uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.platform_eva_stability(uuid,text,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
