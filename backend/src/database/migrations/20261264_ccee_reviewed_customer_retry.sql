BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.ccee_customer_discovery_retry(p_org text,p_actor text,p_id uuid,p_reason text,p_request uuid,p_confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_customer_discovery;n public.ccee_customer_discovery;prior public.ccee_integration_events;c public.customers;answer jsonb;
BEGIN
 PERFORM public.ccee_permanent_automation_actor(p_org,p_actor);
 IF NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND r.name='admin_org') THEN RAISE EXCEPTION 'Organization administrator required for reviewed retry' USING ERRCODE='42501'; END IF;
 IF p_org<>'org_default' OR p_id IS NULL OR p_request IS NULL OR p_confirmed IS DISTINCT FROM true OR length(coalesce(p_reason,'')) NOT BETWEEN 30 AND 500 THEN RAISE EXCEPTION 'Invalid reviewed customer retry' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-reviewed-retry:'||p_org||':'||p_request::text,0));
 SELECT * INTO prior FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF prior.actor_id IS DISTINCT FROM p_actor OR prior.event<>'CUSTOMER_DISCOVERY_MANUAL_RETRY' OR prior.details->>'previousId' IS DISTINCT FROM p_id::text OR prior.details->>'reason' IS DISTINCT FROM p_reason THEN RAISE EXCEPTION 'Changed retry request' USING ERRCODE='40001'; END IF;
  RETURN prior.details->'response';
 END IF;
 SELECT * INTO j FROM public.ccee_customer_discovery WHERE organization_id=p_org AND id=p_id;
 IF j.id IS NULL THEN RAISE EXCEPTION 'Customer retry not available' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.customers WHERE organization_id=p_org AND id=j.customer_id FOR UPDATE;
 SELECT * INTO j FROM public.ccee_customer_discovery WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF j.state<>'FAILED' OR j.result->'diagnostic'->>'code' IS DISTINCT FROM 'PROVIDER_REJECTED' OR j.lease_id IS NOT NULL OR j.lease_until IS NOT NULL
 OR j.id IS DISTINCT FROM(SELECT q.id FROM public.ccee_customer_discovery q WHERE q.organization_id=p_org AND q.customer_id=j.customer_id ORDER BY q.created_at DESC,q.id DESC LIMIT 1)
 OR c.id IS NULL OR c.deleted_at IS NOT NULL OR c.status IS DISTINCT FROM 'ACTIVE' OR regexp_replace(coalesce(c.document,''),'[^0-9A-Za-z]','','g')<>j.tax_id
 OR NOT EXISTS(SELECT 1 FROM public.consumer_units u WHERE u.organization_id=p_org AND u.customer_id=c.id AND u.status='ACTIVE') THEN RAISE EXCEPTION 'Customer source changed or retry not eligible' USING ERRCODE='42501'; END IF;
 IF(SELECT count(*) FROM public.ccee_integration_events WHERE organization_id=p_org AND event='CUSTOMER_DISCOVERY_REQUEST_RESERVED')>=23 THEN RAISE EXCEPTION 'CUSTOMER_BUDGET_EXHAUSTED' USING ERRCODE='P0001'; END IF;
 INSERT INTO public.ccee_customer_discovery(organization_id,customer_id,tax_id,input_hash,state,reason,result)
 VALUES(p_org,j.customer_id,j.tax_id,j.input_hash,'QUEUED','Reconsulta do mesmo CNPJ autorizada após revisão administrativa.',jsonb_build_object('previousId',j.id,'reviewRequestId',p_request)) RETURNING * INTO n;
 answer:=jsonb_build_object('organizationId',p_org,'id',n.id,'previousId',j.id,'state',n.state);
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details)
 VALUES(p_org,p_actor,'CUSTOMER_DISCOVERY_MANUAL_RETRY',p_request,jsonb_build_object('previousId',j.id,'newId',n.id,'reason',p_reason,'response',answer));
 RETURN answer;
END$$;
REVOKE ALL ON FUNCTION public.ccee_customer_discovery_retry(text,text,uuid,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ccee_customer_discovery_retry(text,text,uuid,text,uuid,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
