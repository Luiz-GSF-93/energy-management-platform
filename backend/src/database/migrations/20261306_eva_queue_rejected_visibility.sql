BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- List financial rejections for correction without reopening approval.
CREATE OR REPLACE FUNCTION public.eva_document_review_rows(p_org text) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',v.id,'hash',v.payload_hash,'customerId',v.customer_id,'customer',c.company_name,
  'unitId',v.consumer_unit_id,'unit',CASE WHEN coalesce(v.report#>>'{scope,kind}','CUSTOMER')='UNIT' THEN u.name ELSE 'Consolidado do cliente' END,
  'unitIds',v.report->'unitIds','units',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'uc',x.consumer_unit_number) ORDER BY x.id),'[]') FROM public.consumer_units x WHERE x.organization_id=p_org AND x.customer_id=v.customer_id AND v.report->'unitIds' ? x.id),
  'month',v.month,'version',v.version,'scopeKind',coalesce(v.report#>>'{scope,kind}','CUSTOMER'),
  'stage',CASE WHEN e.state='APPROVED' THEN 'PUBLICATION' WHEN e.state='READY_FOR_REVIEW' AND v.report->'approvalEligible'='true'::jsonb AND handoff.action='SUBMIT' THEN 'APPROVAL'
   WHEN e.state='REJECTED' OR handoff.action='RETURN' THEN 'RETURNED' WHEN public.eva_review_previously_published(p_org,v.customer_id,v.month,v.report->'unitIds') THEN 'REVISION' WHEN v.report->'approvalEligible'='true'::jsonb OR v.report#>>'{preparation,percent}'='100' THEN 'OPERATOR' ELSE 'INPUT' END,
  'approvalEligible',e.state='READY_FOR_REVIEW' AND v.report->'approvalEligible'='true'::jsonb,
  'pendingCount',jsonb_array_length(coalesce(v.report->'pendingActions','[]')),
  'returnReason',CASE WHEN e.state='REJECTED' THEN e.note WHEN handoff.action='RETURN' THEN handoff.reason END,
  'submittedAt',CASE WHEN handoff.action='SUBMIT' THEN handoff.created_at END,
  'updatedAt',coalesce(handoff.created_at,e.created_at),'handoffId',handoff.id)
 FROM public.eva_assisted_closing_versions v
 JOIN public.customers c ON c.organization_id=v.organization_id AND c.id=v.customer_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 JOIN public.consumer_units u ON u.organization_id=v.organization_id AND u.customer_id=v.customer_id AND u.id=v.consumer_unit_id AND u.status='ACTIVE'
 JOIN LATERAL(SELECT state,note,created_at FROM public.eva_assisted_closing_events WHERE organization_id=p_org AND closing_id=v.id ORDER BY sequence DESC LIMIT 1)e ON true
 LEFT JOIN LATERAL(SELECT action,reason,created_at,id FROM(
  SELECT action,reason,created_at,id,sequence FROM public.eva_closing_review_events WHERE organization_id=p_org AND closing_id=v.id AND closing_hash=v.payload_hash
  UNION ALL SELECT 'SUBMIT','Encaminhamento do protocolo operacional preservado.',coalesce(submitted_at,updated_at),id,0::bigint FROM public.eva_operational_reviews WHERE organization_id=p_org AND closing_id=v.id AND closing_hash=v.payload_hash AND state='SUBMITTED'
 )history ORDER BY sequence DESC LIMIT 1)handoff ON true
 WHERE v.organization_id=p_org AND (e.state IN('INCOMPLETE','READY_FOR_REVIEW','REJECTED') OR e.state='APPROVED' AND NOT EXISTS(SELECT 1 FROM public.eva_closing_publications pub JOIN LATERAL(SELECT state FROM public.eva_closing_publication_events WHERE organization_id=p_org AND publication_id=pub.id ORDER BY sequence DESC LIMIT 1)pe ON true WHERE pub.organization_id=p_org AND pub.closing_id=v.id AND pe.state IN('PUBLISHED','WITHDRAWN')))
 AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions n WHERE n.organization_id=p_org AND n.customer_id=v.customer_id AND n.month=v.month AND n.version>v.version AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(n.report->'unitIds') nu WHERE v.report->'unitIds' ? nu))
$$;
REVOKE ALL ON FUNCTION public.eva_document_review_rows(text) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.eva_document_review_queue(text,text,text,text,jsonb)'::regprocedure);
 d:=replace(d,$old$ORDER BY x->>'updatedAt',x->>'id'$old$,$new$ORDER BY x->>'updatedAt' DESC,x->>'id' DESC$new$);
 IF strpos(d,'''returned''')=0 THEN
  d:=replace(d,$old$'revision',(SELECT count(*) FROM rows WHERE x->>'stage'='REVISION')$old$,$new$'returned',(SELECT count(*) FROM rows WHERE x->>'stage'='RETURNED'),'revision',(SELECT count(*) FROM rows WHERE x->>'stage'='REVISION')$new$);
 END IF;
 IF strpos(d,'''returned''')=0 OR strpos(d,$expected$ORDER BY x->>'updatedAt' DESC,x->>'id' DESC$expected$)=0 THEN RAISE EXCEPTION 'Review queue baseline changed';END IF;
 EXECUTE d;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
