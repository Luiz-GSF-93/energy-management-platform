BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $install_20261267$ BEGIN
 IF to_regprocedure('public.trading_workflow_supplier_receipt(text,text,uuid,uuid,jsonb)') IS NOT NULL THEN
  IF obj_description(to_regprocedure('public.trading_workflow_supplier_receipt(text,text,uuid,uuid,jsonb)'),'pg_proc') IS DISTINCT FROM 'trading-workflow:20261267:144775735d1c7257152dbdbc9f4a5213d0a955c6263206e5198056ed3e40e4d4' THEN RAISE EXCEPTION 'Review existing Trading workflow schema before migration';END IF;RETURN;
 END IF;
 EXECUTE $schema_20261267$
ALTER TABLE public.trading_approval_deliveries ADD COLUMN cost_micro_usd bigint NOT NULL DEFAULT 0 CHECK(cost_micro_usd>=0);
CREATE FUNCTION public.trading_workflow_destination(p_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.trading_approval_deliveries;w public.trading_approval_workflows;m record;policy public.customer_notice_policies;contact jsonb;routing jsonb;prefs jsonb;
BEGIN
 SELECT * INTO STRICT d FROM public.trading_approval_deliveries WHERE id=p_id;
 SELECT * INTO STRICT w FROM public.trading_approval_workflows WHERE id=d.workflow_id AND organization_id=d.organization_id AND state='CLIENT_PENDING' AND deadline>now();
 SELECT om.*,u.email,u.email_confirmed_at INTO m FROM public.organization_members om JOIN auth.users u ON u.id=om.user_id WHERE om.organization_id=w.organization_id AND om.user_id::text=d.recipient_id;
 IF m.email_confirmed_at IS NULL OR w.recipient_id IS DISTINCT FROM d.recipient_id OR public.trading_workflow_portal_allowed(w.organization_id,d.recipient_id,m.role_id::text,w.customer_id,w.unit_id) IS NOT TRUE THEN RAISE EXCEPTION 'Recipient authorization changed' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.trading_records p WHERE p.organization_id=w.organization_id AND p.id=w.proposal_id AND p.data=w.proposal_data AND p.revision=w.proposal_revision) THEN RAISE EXCEPTION 'Proposal changed' USING ERRCODE='42501';END IF;
 SELECT body INTO routing FROM public.portal_service_routing WHERE organization_id=w.organization_id AND kind='ROUTING' AND owner_user_id='organization' ORDER BY revision DESC LIMIT 1;
 SELECT body INTO prefs FROM public.portal_service_routing WHERE organization_id=w.organization_id AND kind='PREFERENCES' AND owner_user_id=d.recipient_id ORDER BY revision DESC LIMIT 1;
 IF routing->>'enabled' IS DISTINCT FROM 'true' OR prefs->>d.channel IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Channel consent unavailable' USING ERRCODE='42501';END IF;
 FOR policy IN SELECT p.* FROM public.customer_notice_policies p WHERE p.organization_id=w.organization_id AND p.customer_id=w.customer_id AND p.state='ACTIVE' AND p.activated_at<=d.created_at AND p.config->'channels' ? lower(d.channel) LOOP
  PERFORM public.assert_customer_notice_actor(w.organization_id,policy.owner_id);
  IF public.customer_notice_contacts(w.organization_id,policy.config) IS DISTINCT FROM policy.contacts THEN CONTINUE;END IF;
  FOR contact IN SELECT value FROM jsonb_array_elements(policy.contacts) LOOP
   IF lower(contact->>'email')=lower(m.email) AND contact->>'active'='true' AND contact->'channels' ? lower(d.channel) THEN
    RETURN CASE WHEN d.channel='EMAIL' THEN contact->>'email' ELSE contact->>'phone' END;
   END IF;
  END LOOP;
 END LOOP;
 RAISE EXCEPTION 'Authorized contact or channel unavailable' USING ERRCODE='42501';
END$$;
CREATE FUNCTION public.trading_workflow_delivery(p_action text,p_id uuid,p_lease uuid,p_daily integer,p_budget bigint,p_costs jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.trading_approval_deliveries;address text;cost bigint;
BEGIN
 IF p_action='CLAIM' THEN
  IF p_daily IS NULL OR p_daily NOT BETWEEN 1 AND 100 OR p_budget IS NULL OR p_budget NOT BETWEEN 1 AND 1000000000 OR jsonb_typeof(p_costs) IS DISTINCT FROM 'object' THEN RETURN NULL;END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-notice-budget:org_default',0));
  UPDATE public.trading_approval_deliveries SET state='UNKNOWN',diagnostic='SENDING_INTERRUPTED_INSPECT_PROVIDER',lease_id=NULL,lease_until=NULL WHERE organization_id='org_default' AND state='SENDING' AND lease_until<=now();
  UPDATE public.trading_approval_deliveries dd SET state='CANCELLED',diagnostic='DECISION_CLOSED_OR_CHANGED' FROM public.trading_approval_workflows w WHERE dd.workflow_id=w.id AND dd.organization_id=w.organization_id AND dd.state='PENDING' AND(w.state<>'CLIENT_PENDING' OR w.deadline<=now());
  SELECT * INTO d FROM public.trading_approval_deliveries WHERE organization_id='org_default' AND state='PENDING' AND channel<>'INAPP' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF d.id IS NULL THEN RETURN NULL;END IF;
  cost:=(p_costs->>d.channel)::bigint;
  IF cost IS NULL OR cost<=0 OR cost>999999999 THEN UPDATE public.trading_approval_deliveries SET state='FAILED',diagnostic='CHANNEL_COST_NOT_CONFIGURED' WHERE id=d.id;RETURN NULL;END IF;
  IF(SELECT count(*) FROM public.trading_approval_deliveries WHERE organization_id=d.organization_id AND channel<>'INAPP' AND state IN('SENDING','ACCEPTED','DELIVERED','UNKNOWN') AND created_at>=date_trunc('day',now()))+(SELECT count(*) FROM public.portal_notification_deliveries WHERE organization_id=d.organization_id AND sequence=1 AND created_at>=date_trunc('day',now()))>=p_daily
  OR(SELECT coalesce(sum(cost_micro_usd),0) FROM public.trading_approval_deliveries WHERE organization_id=d.organization_id AND channel<>'INAPP' AND state IN('SENDING','ACCEPTED','DELIVERED','UNKNOWN') AND created_at>=date_trunc('month',now()))+(SELECT coalesce(sum(cost_micro_usd),0) FROM public.portal_notification_deliveries WHERE organization_id=d.organization_id AND created_at>=date_trunc('month',now()))+cost>p_budget THEN RETURN NULL;END IF;
  BEGIN address:=public.trading_workflow_destination(d.id);EXCEPTION WHEN SQLSTATE '42501' OR no_data_found THEN UPDATE public.trading_approval_deliveries SET state='FAILED',diagnostic='RECIPIENT_CONTACT_OR_CONSENT_UNAVAILABLE' WHERE id=d.id;RETURN NULL;END;
  UPDATE public.trading_approval_deliveries SET state='SENDING',lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',cost_micro_usd=cost WHERE id=d.id RETURNING * INTO d;
  RETURN jsonb_build_object('id',d.id,'lease',d.lease_id,'channel',d.channel,'destination',address,'title',d.title,'href',d.href);
 ELSIF p_action='START' THEN
  SELECT * INTO d FROM public.trading_approval_deliveries WHERE id=p_id AND lease_id=p_lease AND state='SENDING' AND lease_until>now() FOR UPDATE;
  IF d.id IS NULL THEN RETURN NULL;END IF;
  BEGIN address:=public.trading_workflow_destination(d.id);EXCEPTION WHEN SQLSTATE '42501' OR no_data_found THEN UPDATE public.trading_approval_deliveries SET state='CANCELLED',diagnostic='ACCESS_OR_PROPOSAL_CHANGED' WHERE id=d.id;RETURN NULL;END;
  RETURN jsonb_build_object('destination',address);
 ELSIF p_action='FINISH' THEN
  IF p_result->>'state' NOT IN('ACCEPTED','FAILED','UNKNOWN') OR length(coalesce(p_result->>'providerId',''))>512 OR length(coalesce(p_result->>'diagnostic',''))>100 THEN RAISE EXCEPTION 'Invalid delivery receipt' USING ERRCODE='22023';END IF;
  UPDATE public.trading_approval_deliveries SET state=p_result->>'state',provider_id=p_result->>'providerId',diagnostic=p_result->>'diagnostic',lease_id=NULL,lease_until=NULL WHERE id=p_id AND lease_id=p_lease AND state='SENDING' RETURNING * INTO d;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Delivery outcome unconfirmed' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('recorded',true);
 END IF;
 RAISE EXCEPTION 'Invalid delivery action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.trading_workflow_destination(uuid),public.trading_workflow_delivery(text,uuid,uuid,integer,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.trading_workflow_delivery(text,uuid,uuid,integer,bigint,jsonb,jsonb) TO service_role;
CREATE FUNCTION public.trading_workflow_supplier_receipt(p_org text,p_actor text,p_workflow uuid,p_request uuid,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w public.trading_approval_workflows;e public.trading_approval_events;
BEGIN
 PERFORM public.assert_trading_actor(p_org,p_actor,true);
 SELECT * INTO w FROM public.trading_approval_workflows WHERE organization_id=p_org AND id=p_workflow FOR UPDATE;
 SELECT * INTO e FROM public.trading_approval_events WHERE organization_id=p_org AND request_id=p_request AND workflow_id=w.id AND actor_id=p_actor AND action='NOTIFY_SUPPLIER';
 IF e.id IS NULL OR p_result->>'state' NOT IN('ACCEPTED','FAILED','UNKNOWN') OR length(coalesce(p_result->>'providerId',''))>512 OR length(coalesce(p_result->>'diagnostic',''))>100 THEN RAISE EXCEPTION 'Receipt outside authorized send' USING ERRCODE='42501';END IF;
 INSERT INTO public.trading_approval_deliveries(organization_id,workflow_id,workflow_revision,recipient_id,channel,state,title,href,provider_id,diagnostic)
 VALUES(p_org,w.id,(e.response->>'revision')::integer,e.input#>>'{body,email}','EMAIL',p_result->>'state','Aviso ao fornecedor para formalização','/backoffice/trading-hub#aprovacoes',p_result->>'providerId',p_result->>'diagnostic') ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('recorded',true);
END$$;
REVOKE ALL ON FUNCTION public.trading_workflow_supplier_receipt(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.trading_workflow_supplier_receipt(text,text,uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMENT ON FUNCTION public.trading_workflow_supplier_receipt(text,text,uuid,uuid,jsonb) IS 'trading-workflow:20261267:144775735d1c7257152dbdbc9f4a5213d0a955c6263206e5198056ed3e40e4d4';
$schema_20261267$;
END $install_20261267$;
COMMIT;
