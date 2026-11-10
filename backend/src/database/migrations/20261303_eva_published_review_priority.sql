BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- This is a display classification, not cancellation of a financial revision.
CREATE OR REPLACE FUNCTION public.eva_review_previously_published(p_org text,p_customer text,p_month text,p_units jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(p_units) IS DISTINCT FROM 'array' THEN false
 WHEN jsonb_array_length(p_units)=0 THEN false ELSE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements_text(p_units)unit_id WHERE NOT EXISTS(
   SELECT 1 FROM public.eva_closing_publications pub
   JOIN public.eva_assisted_closing_versions approved ON approved.organization_id=pub.organization_id AND approved.customer_id=pub.customer_id AND approved.id=pub.closing_id AND approved.payload_hash=pub.source_hash
   WHERE pub.organization_id=p_org AND pub.customer_id=p_customer AND approved.month=p_month AND approved.report->'unitIds' ? unit_id
   AND (SELECT state FROM public.eva_assisted_closing_events e WHERE e.organization_id=p_org AND e.closing_id=approved.id ORDER BY sequence DESC LIMIT 1)='APPROVED'
   AND (SELECT state FROM public.eva_closing_publication_events e WHERE e.organization_id=p_org AND e.publication_id=pub.id ORDER BY sequence DESC LIMIT 1)='PUBLISHED'
   AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions newer WHERE newer.organization_id=p_org AND newer.customer_id=p_customer AND newer.month=p_month AND newer.version>approved.version AND newer.report->'unitIds' ? unit_id AND (SELECT state FROM public.eva_assisted_closing_events e WHERE e.organization_id=p_org AND e.closing_id=newer.id ORDER BY sequence DESC LIMIT 1)='APPROVED')
  )
 ) END
$$;
REVOKE ALL ON FUNCTION public.eva_review_previously_published(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.eva_document_review_rows(p_org text) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',v.id,'hash',v.payload_hash,'customerId',v.customer_id,'customer',c.company_name,
  'unitId',v.consumer_unit_id,'unit',CASE WHEN coalesce(v.report#>>'{scope,kind}','CUSTOMER')='UNIT' THEN u.name ELSE 'Consolidado do cliente' END,
  'unitIds',v.report->'unitIds','units',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'uc',x.consumer_unit_number) ORDER BY x.id),'[]') FROM public.consumer_units x WHERE x.organization_id=p_org AND x.customer_id=v.customer_id AND v.report->'unitIds' ? x.id),
  'month',v.month,'version',v.version,'scopeKind',coalesce(v.report#>>'{scope,kind}','CUSTOMER'),
  'stage',CASE WHEN e.state='APPROVED' THEN 'PUBLICATION' WHEN e.state='READY_FOR_REVIEW' AND v.report->'approvalEligible'='true'::jsonb AND handoff.action='SUBMIT' THEN 'APPROVAL'
   WHEN handoff.action='RETURN' THEN 'RETURNED' WHEN public.eva_review_previously_published(p_org,v.customer_id,v.month,v.report->'unitIds') THEN 'REVISION' WHEN v.report->'approvalEligible'='true'::jsonb OR v.report#>>'{preparation,percent}'='100' THEN 'OPERATOR' ELSE 'INPUT' END,
  'approvalEligible',e.state='READY_FOR_REVIEW' AND v.report->'approvalEligible'='true'::jsonb,
  'pendingCount',jsonb_array_length(coalesce(v.report->'pendingActions','[]')),
  'returnReason',CASE WHEN handoff.action='RETURN' THEN handoff.reason END,
  'submittedAt',CASE WHEN handoff.action='SUBMIT' THEN handoff.created_at END,
  'updatedAt',coalesce(handoff.created_at,e.created_at),'handoffId',handoff.id)
 FROM public.eva_assisted_closing_versions v
 JOIN public.customers c ON c.organization_id=v.organization_id AND c.id=v.customer_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 JOIN public.consumer_units u ON u.organization_id=v.organization_id AND u.customer_id=v.customer_id AND u.id=v.consumer_unit_id AND u.status='ACTIVE'
 JOIN LATERAL(SELECT state,created_at FROM public.eva_assisted_closing_events WHERE organization_id=p_org AND closing_id=v.id ORDER BY sequence DESC LIMIT 1)e ON true
 LEFT JOIN LATERAL(SELECT action,reason,created_at,id FROM(
  SELECT action,reason,created_at,id,sequence FROM public.eva_closing_review_events WHERE organization_id=p_org AND closing_id=v.id AND closing_hash=v.payload_hash
  UNION ALL SELECT 'SUBMIT','Encaminhamento do protocolo operacional preservado.',coalesce(submitted_at,updated_at),id,0::bigint FROM public.eva_operational_reviews WHERE organization_id=p_org AND closing_id=v.id AND closing_hash=v.payload_hash AND state='SUBMITTED'
 )history ORDER BY sequence DESC LIMIT 1)handoff ON true
 WHERE v.organization_id=p_org AND (e.state IN('INCOMPLETE','READY_FOR_REVIEW') OR e.state='APPROVED' AND NOT EXISTS(SELECT 1 FROM public.eva_closing_publications pub JOIN LATERAL(SELECT state FROM public.eva_closing_publication_events WHERE organization_id=p_org AND publication_id=pub.id ORDER BY sequence DESC LIMIT 1)pe ON true WHERE pub.organization_id=p_org AND pub.closing_id=v.id AND pe.state IN('PUBLISHED','WITHDRAWN')))
 AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions n WHERE n.organization_id=p_org AND n.customer_id=v.customer_id AND n.month=v.month AND n.version>v.version AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(n.report->'unitIds') nu WHERE v.report->'unitIds' ? nu))
$$;
REVOKE ALL ON FUNCTION public.eva_document_review_rows(text) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE d text;before_patch text;
BEGIN
 d:=pg_get_functiondef('public.eva_document_review_queue(text,text,text,text,jsonb)'::regprocedure);
 IF strpos(d,'''REVISION''')>0 THEN RETURN;END IF;
 before_patch:=d;
 d:=regexp_replace(d,$pattern$stage\s+NOT\s+IN\s*\(\s*'ALL'\s*,\s*'OPERATOR'\s*,\s*'APPROVAL'\s*,\s*'INPUT'\s*,\s*'RETURNED'\s*,\s*'PUBLICATION'\s*\)$pattern$,$replacement$stage NOT IN('ALL','OPERATOR','APPROVAL','INPUT','RETURNED','PUBLICATION','REVISION')$replacement$);
 IF d=before_patch THEN RAISE EXCEPTION 'Review queue filter baseline changed';END IF;
 before_patch:=d;
 d:=regexp_replace(d,$pattern$r->>'stage'\s+NOT\s+IN\s*\(\s*'OPERATOR'\s*,\s*'RETURNED'\s*\)$pattern$,$replacement$r->>'stage' NOT IN('OPERATOR','RETURNED','REVISION')$replacement$);
 IF d=before_patch THEN RAISE EXCEPTION 'Review submission baseline changed';END IF;
 before_patch:=d;
 d:=regexp_replace(d,$pattern$'input'\s*,$pattern$,$replacement$'revision',(SELECT count(*) FROM rows WHERE x->>'stage'='REVISION'),'input',$replacement$);
 IF d=before_patch THEN RAISE EXCEPTION 'Review queue summary baseline changed';END IF;
 EXECUTE d;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
