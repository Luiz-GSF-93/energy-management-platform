BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE INDEX IF NOT EXISTS eva_intakes_operations_scope ON public.eva_automatic_intakes(organization_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS eva_intakes_worker_due ON public.eva_automatic_intakes(next_attempt_at,organization_id) WHERE stored AND consent AND state IN('RECOGNIZING','OCR_QUEUED','OCR_POLLING','LINKING','WAITING_OCR','AWAITING_SOURCES','PROPOSAL_READY','OCR_SUBMITTING','PREPARING');

-- Service-only discovery. No wildcard ever reaches a claim or source read.
-- Order due tenants by oldest pending work, including expired leases.
CREATE FUNCTION public.eva_intake_worker_organizations(p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF p_kind NOT IN('INTAKE','EXPLANATION') OR p_kind IS NULL THEN RAISE EXCEPTION 'Invalid worker kind' USING ERRCODE='22023';END IF;
 WITH due AS (
  SELECT i.organization_id,min(i.next_attempt_at) due FROM public.eva_automatic_intakes i
  WHERE p_kind='INTAKE' AND i.stored AND i.consent AND i.state IN('RECOGNIZING','OCR_QUEUED','OCR_POLLING','LINKING','WAITING_OCR','AWAITING_SOURCES','PROPOSAL_READY','OCR_SUBMITTING','PREPARING')
  AND i.next_attempt_at<=clock_timestamp() AND(i.lease_until IS NULL OR i.lease_until<clock_timestamp()) GROUP BY i.organization_id
  UNION ALL
  SELECT j.organization_id,min(j.created_at) FROM public.eva_intake_explanations j WHERE p_kind='EXPLANATION' AND(j.state='QUEUED' OR j.state='RUNNING' AND j.lease_until<clock_timestamp()) GROUP BY j.organization_id
 ), eligible AS (
  SELECT d.organization_id,min(d.due) due FROM due d
  WHERE (SELECT count(*) FROM public.licenses l WHERE l.organization_id=d.organization_id AND l.active AND lower(l.status)='active' AND l.start_date<=current_date AND(l.end_date IS NULL OR l.end_date>=current_date) AND l.document_management)=1
  AND (SELECT p.body->>'enabled'='true' AND p.body->>'automationEnabled'='true' FROM public.portal_service_routing p WHERE p.organization_id=d.organization_id AND p.kind='ROUTING' AND p.owner_user_id='organization' ORDER BY p.revision DESC LIMIT 1)
  GROUP BY d.organization_id ORDER BY min(d.due),d.organization_id LIMIT 100
 ) SELECT coalesce(jsonb_agg(organization_id ORDER BY due,organization_id),'[]') INTO result FROM eligible;
 RETURN result;
END$$;

CREATE FUNCTION public.eva_intake_operational_dashboard(p_org text,p_actor text,p_role text,p_platform boolean,p_group text DEFAULT 'ALL',p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='10s' AS $$
DECLARE actor jsonb;result jsonb;
BEGIN
 actor:=public.eva_intake_actor(p_org,p_actor,p_role,p_platform,NULL);
 IF actor->>'external' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Internal team required' USING ERRCODE='42501';END IF;
 IF p_group IS NULL OR p_group NOT IN('ALL','TECHNICAL','HUMAN','SOURCES','PROCESSING','DONE') OR p_offset IS NULL OR p_offset<0 OR p_offset>249975 OR p_offset%25<>0 THEN RAISE EXCEPTION 'Invalid dashboard filter' USING ERRCODE='22023';END IF;
 WITH base AS MATERIALIZED (
  SELECT i.id,i.organization_id,i.customer_id,i.unit_id,i.filename,i.state,i.note,i.month,i.document_id,i.closing_id,i.created_at,i.updated_at,i.next_attempt_at,i.attempts,i.lease_until,
   CASE WHEN i.state='UNKNOWN' OR i.state IN('OCR_SUBMITTING','PREPARING') AND i.lease_until<clock_timestamp() THEN 'TECHNICAL'
    WHEN i.state='REVIEW_REQUIRED' THEN 'HUMAN' WHEN i.state='AWAITING_SOURCES' THEN 'SOURCES'
    WHEN i.state IN('PROPOSAL_READY','SOURCE_READY','PUBLISHED','DISMISSED') THEN 'DONE' ELSE 'PROCESSING' END AS category
  FROM public.eva_automatic_intakes i WHERE i.organization_id=p_org
  AND(i.created_at>=clock_timestamp()-interval '30 days' OR i.state NOT IN('PUBLISHED','SOURCE_READY','DISMISSED'))
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
REVOKE ALL ON FUNCTION public.eva_intake_worker_organizations(text),public.eva_intake_operational_dashboard(text,text,text,boolean,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_worker_organizations(text),public.eva_intake_operational_dashboard(text,text,text,boolean,text,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
