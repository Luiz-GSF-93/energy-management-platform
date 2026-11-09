BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.eva_intake_operational_dashboard(p_org text,p_actor text,p_role text,p_platform boolean,p_group text DEFAULT 'ALL',p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='10s' AS $$
DECLARE actor jsonb;result jsonb;completions jsonb:='[]';batch uuid[];
BEGIN
 actor:=public.eva_intake_actor(p_org,p_actor,p_role,p_platform,NULL);
 IF actor->>'external' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Internal team required' USING ERRCODE='42501';END IF;
 IF p_group IS NULL OR p_group NOT IN('ALL','TECHNICAL','HUMAN','SOURCES','PROCESSING','DONE') OR p_offset IS NULL OR p_offset<0 OR p_offset>249975 OR p_offset%25<>0 THEN RAISE EXCEPTION 'Invalid dashboard filter' USING ERRCODE='22023';END IF;
 -- Reuse the established exact-source publication proof in bounded batches.
 -- Never infer publication from an OCR status, receipt flag or partial total.
 FOR batch IN SELECT array_agg(q.id ORDER BY q.id) FROM(
  SELECT i.id,(row_number() OVER(ORDER BY i.id)-1)/100 bucket FROM public.eva_automatic_intakes i
  WHERE i.organization_id=p_org AND i.state IN('UNKNOWN','AWAITING_SOURCES','PROPOSAL_READY') AND i.lease_token IS NULL AND i.document_id IS NOT NULL
 )q GROUP BY q.bucket LOOP
  completions:=completions||public.eva_intake_published_completions(p_org,batch);
 END LOOP;
 IF (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(completions)x)<>jsonb_array_length(completions) THEN RAISE EXCEPTION 'Ambiguous publication proof' USING ERRCODE='PT409';END IF;
 WITH base AS MATERIALIZED (
  SELECT i.id,i.organization_id,i.customer_id,i.unit_id,i.filename,CASE WHEN completion.value IS NOT NULL THEN 'PUBLISHED' ELSE i.state END state,CASE WHEN completion.value IS NOT NULL THEN 'Fechamento confirmado pela versão aprovada e publicada. Histórico de processamento preservado.' ELSE i.note END note,i.month,i.document_id,coalesce((completion.value->>'closingId')::uuid,i.closing_id) closing_id,i.created_at,coalesce((completion.value->>'publishedAt')::timestamptz,i.updated_at) updated_at,i.next_attempt_at,i.attempts,i.lease_until,
   CASE WHEN completion.value IS NOT NULL THEN 'DONE' WHEN i.state='UNKNOWN' OR i.state IN('OCR_SUBMITTING','PREPARING') AND i.lease_until<clock_timestamp() THEN 'TECHNICAL'
    WHEN i.state='REVIEW_REQUIRED' THEN 'HUMAN' WHEN i.state='AWAITING_SOURCES' THEN 'SOURCES'
    WHEN i.state IN('PROPOSAL_READY','SOURCE_READY','PUBLISHED','DISMISSED') THEN 'DONE' ELSE 'PROCESSING' END AS category
  FROM public.eva_automatic_intakes i LEFT JOIN LATERAL(SELECT x value FROM jsonb_array_elements(completions)x WHERE x->>'id'=i.id::text)completion ON true WHERE i.organization_id=p_org
  AND(i.created_at>=clock_timestamp()-interval '30 days' OR completion.value IS NULL AND i.state NOT IN('PUBLISHED','SOURCE_READY','DISMISSED'))
 ), page AS (
  SELECT * FROM base WHERE p_group='ALL' OR category=p_group
  ORDER BY CASE category WHEN 'TECHNICAL' THEN 0 WHEN 'HUMAN' THEN 1 WHEN 'SOURCES' THEN 2 WHEN 'PROCESSING' THEN 3 ELSE 4 END,updated_at,id LIMIT 25 OFFSET p_offset
 ), items AS (
  SELECT jsonb_build_object('id',i.id,'filename',i.filename,'state',i.state,'group',i.category,'note',i.note,'month',i.month,'documentId',i.document_id,'closingId',i.closing_id,
   'customer',c.company_name,'unit',u.name,'createdAt',i.created_at,'updatedAt',i.updated_at,'nextAttemptAt',CASE WHEN isfinite(i.next_attempt_at) THEN i.next_attempt_at ELSE NULL END,'attempts',i.attempts,
   'idleSeconds',greatest(0,extract(epoch FROM clock_timestamp()-i.updated_at)::bigint),'leaseExpired',coalesce(i.lease_until<clock_timestamp(),false),
   'stage',e.body#>>'{diagnostic,stage}','code',e.body#>>'{diagnostic,code}',
   'requiredInputs',CASE WHEN i.category='SOURCES' AND v.report#>>'{preparationPolicy,financialComplete}'='false' THEN coalesce(v.report#>'{preparationPolicy,requiredInputs}','[]') ELSE '[]'::jsonb END,
   'identityDecision',(SELECT jsonb_build_object('decision',r.kind,'at',r.created_at) FROM public.eva_intake_identity_reviews r WHERE r.organization_id=p_org AND r.intake_id=i.id AND r.kind IN('CONTINUE','STOP','ADDRESS') ORDER BY r.created_at DESC LIMIT 1),
   'explanationState',x.state) item,i.category,i.updated_at,i.id
  FROM page i LEFT JOIN public.customers c ON c.organization_id=p_org AND c.id=i.customer_id
  LEFT JOIN public.consumer_units u ON u.organization_id=p_org AND u.customer_id=i.customer_id AND u.id=i.unit_id
  LEFT JOIN public.eva_assisted_closing_versions v ON v.organization_id=p_org AND v.customer_id=i.customer_id AND v.month=i.month AND v.id=i.closing_id
  LEFT JOIN public.eva_intake_explanations x ON x.organization_id=p_org AND x.intake_id=i.id
  LEFT JOIN LATERAL(SELECT body FROM public.eva_automatic_intake_events WHERE organization_id=p_org AND intake_id=i.id ORDER BY sequence DESC LIMIT 1)e ON true
 )
 SELECT jsonb_build_object('generatedAt',clock_timestamp(),'windowDays',30,'pageSize',25,'offset',p_offset,
  'total',(SELECT count(*) FROM base WHERE p_group='ALL' OR category=p_group),
  'summary',jsonb_build_object('received30d',(SELECT count(*) FROM base WHERE created_at>=clock_timestamp()-interval '30 days'),
   'prepared30d',(SELECT count(*) FROM base WHERE created_at>=clock_timestamp()-interval '30 days' AND closing_id IS NOT NULL AND state IN('AWAITING_SOURCES','PROPOSAL_READY','PUBLISHED')),
   'technical',(SELECT count(*) FROM base WHERE category='TECHNICAL'),'human',(SELECT count(*) FROM base WHERE category='HUMAN'),'sources',(SELECT count(*) FROM base WHERE category='SOURCES'),'processing',(SELECT count(*) FROM base WHERE category='PROCESSING')),
  'automationConfigured',coalesce((SELECT p.body->>'enabled'='true' AND p.body->>'automationEnabled'='true' FROM public.portal_service_routing p WHERE p.organization_id=p_org AND p.kind='ROUTING' AND p.owner_user_id='organization' ORDER BY p.revision DESC LIMIT 1),false),
  'rows',(SELECT coalesce(jsonb_agg(item ORDER BY CASE category WHEN 'TECHNICAL' THEN 0 WHEN 'HUMAN' THEN 1 WHEN 'SOURCES' THEN 2 WHEN 'PROCESSING' THEN 3 ELSE 4 END,updated_at,id),'[]') FROM items)) INTO result;
 RETURN result;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
