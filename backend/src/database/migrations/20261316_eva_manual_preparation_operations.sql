BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE INDEX IF NOT EXISTS eva_manual_org_operations ON public.eva_manual_preparations(organization_id,created_at DESC,id);
CREATE OR REPLACE FUNCTION public.eva_manual_preparation_operations(p_org text,p_actor text,p_role text,p_platform boolean,p_filter text DEFAULT 'ALL',p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' AS $$
DECLARE actor jsonb;result jsonb;permissions jsonb;member record;
BEGIN
 IF p_platform IS NULL THEN RAISE EXCEPTION 'Explicit access context required' USING ERRCODE='42501';END IF;
 actor:=public.eva_intake_actor(p_org,p_actor,p_role,p_platform,NULL);
 IF actor->>'external' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Internal team required' USING ERRCODE='42501';END IF;
 IF NOT p_platform THEN
  SELECT r.name,r.permissions,m.permission_limit INTO member FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
  WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL;
  IF NOT FOUND OR member.name NOT IN('admin_org','gestor','operacional') THEN RAISE EXCEPTION 'Internal operations actor required' USING ERRCODE='42501';END IF;
  SELECT coalesce(jsonb_agg(x),'[]') INTO permissions FROM jsonb_array_elements(member.permissions)x WHERE member.permission_limit IS NULL OR member.permission_limit @> jsonb_build_array(x);
  IF NOT(permissions ?& ARRAY['8f105b02-4443-49de-b188-847e0284e7ed','8f3ff5eb-157a-468a-91af-6f89d92e23a7']) THEN RAISE EXCEPTION 'Effective document permissions required' USING ERRCODE='42501';END IF;
 END IF;
 IF p_filter IS NULL OR p_filter NOT IN('ALL','ACTIVE','ATTENTION','SUCCEEDED') OR p_offset IS NULL OR p_offset<0 OR p_offset>249975 OR p_offset%25<>0 THEN RAISE EXCEPTION 'Invalid operations filter' USING ERRCODE='22023';END IF;
 -- Read-only projection. An expired lease is displayed honestly, never recovered here.
 WITH base AS MATERIALIZED(
  SELECT j.*,CASE WHEN state='RUNNING' AND lease_until<statement_timestamp() THEN CASE WHEN write_started THEN 'UNKNOWN' ELSE 'QUEUED' END ELSE state END AS effective_state,
   state='RUNNING' AND lease_until<statement_timestamp() AS lease_expired
  FROM public.eva_manual_preparations j WHERE organization_id=p_org AND(created_at>=statement_timestamp()-interval '30 days' OR state IN('QUEUED','RUNNING','UNKNOWN'))
 ),classified AS MATERIALIZED(
  SELECT b.*,(effective_state IN('UNKNOWN','FAILED') OR lease_expired OR effective_state='QUEUED' AND created_at<statement_timestamp()-interval '5 minutes') AS attention,
   effective_state='QUEUED' AND created_at<statement_timestamp()-interval '5 minutes' AS delayed
  FROM base b
 ),page AS(
  SELECT * FROM classified WHERE p_filter='ALL' OR p_filter='ACTIVE' AND effective_state IN('QUEUED','RUNNING') OR p_filter='ATTENTION' AND attention OR p_filter='SUCCEEDED' AND effective_state='SUCCEEDED'
  ORDER BY attention DESC,CASE WHEN effective_state IN('QUEUED','RUNNING') THEN 0 ELSE 1 END,created_at DESC,id LIMIT 25 OFFSET p_offset
 )
 SELECT jsonb_build_object('organizationId',p_org,'generatedAt',statement_timestamp(),'windowDays',30,'pageSize',25,
 'attentionThresholdSeconds',300,'total',(SELECT count(*) FROM classified WHERE p_filter='ALL' OR p_filter='ACTIVE' AND effective_state IN('QUEUED','RUNNING') OR p_filter='ATTENTION' AND attention OR p_filter='SUCCEEDED' AND effective_state='SUCCEEDED'),
 'summary',jsonb_build_object('queued',(SELECT count(*) FROM classified WHERE effective_state='QUEUED'),'running',(SELECT count(*) FROM classified WHERE effective_state='RUNNING'),'uncertain',(SELECT count(*) FROM classified WHERE effective_state='UNKNOWN'),'failed',(SELECT count(*) FROM classified WHERE effective_state='FAILED'),'succeeded',(SELECT count(*) FROM classified WHERE effective_state='SUCCEEDED'),'attention',(SELECT count(*) FROM classified WHERE attention),'delayed',(SELECT count(*) FROM classified WHERE delayed)),
 'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'customerId',p.customer_id,'consumerUnitId',p.consumer_unit_id,'customer',c.company_name,'unit',u.name,'month',p.month,'scopeKind',p.scope_kind,'state',p.effective_state,'recordedState',p.state,'attempts',p.attempts,'attention',p.attention,'delayed',p.delayed,'leaseExpired',coalesce(p.lease_expired,false),'errorCode',p.error_code,'createdAt',p.created_at,'updatedAt',p.updated_at,'heartbeatAt',CASE WHEN p.state='RUNNING' THEN p.lease_until-interval '5 minutes' END,'nextAttemptAt',CASE WHEN p.effective_state='QUEUED' THEN p.next_attempt_at END,'elapsedSeconds',greatest(0,extract(epoch FROM(CASE WHEN p.effective_state IN('SUCCEEDED','FAILED') THEN p.updated_at ELSE statement_timestamp() END-p.created_at)))::integer,'closingId',p.closing_id)
 ORDER BY p.attention DESC,CASE WHEN p.effective_state IN('QUEUED','RUNNING') THEN 0 ELSE 1 END,p.created_at DESC,p.id),'[]') FROM page p LEFT JOIN public.customers c ON c.organization_id=p_org AND c.id=p.customer_id LEFT JOIN public.consumer_units u ON u.organization_id=p_org AND u.id=p.consumer_unit_id AND u.customer_id=p.customer_id)) INTO result;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.eva_manual_preparation_operations(text,text,text,boolean,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_manual_preparation_operations(text,text,text,boolean,text,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
