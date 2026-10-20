BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.portal_notice_destination(p_notice uuid,p_channel text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n public.portal_notification_outbox; policy public.customer_notice_policies; preferences jsonb; actor record; address text; contact jsonb; routing jsonb;
BEGIN
 SELECT * INTO STRICT n FROM public.portal_notification_outbox WHERE id=p_notice AND created_at>now()-interval '24 hours';
 IF n.href NOT LIKE '/portal#%' OR p_channel NOT IN('EMAIL','SMS','WHATSAPP') THEN RAISE EXCEPTION 'External portal notification required' USING ERRCODE='42501';END IF;
 SELECT m.role_id::text AS role_id,u.email,u.email_confirmed_at INTO actor FROM public.organization_members m JOIN auth.users u ON u.id::text=m.user_id::text WHERE m.organization_id=n.organization_id AND m.user_id::text=n.recipient_id AND upper(m.status)='ACTIVE' AND m.affiliation_type='external' AND m.exclusive_customer_id=n.customer_id;
 IF NOT FOUND OR actor.email_confirmed_at IS NULL THEN RAISE EXCEPTION 'Confirmed client required' USING ERRCODE='42501';END IF;
 PERFORM public.portal_workspace_actor(n.organization_id,n.recipient_id,actor.role_id,false,'notifications');
 SELECT body INTO routing FROM public.portal_service_routing WHERE organization_id=n.organization_id AND kind='ROUTING' AND owner_user_id='organization' ORDER BY revision DESC LIMIT 1;
 SELECT body INTO preferences FROM public.portal_service_routing WHERE organization_id=n.organization_id AND kind='PREFERENCES' AND owner_user_id=n.recipient_id ORDER BY revision DESC LIMIT 1;
 IF routing->>'enabled' IS DISTINCT FROM 'true' OR preferences->>p_channel IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Channel consent required' USING ERRCODE='42501';END IF;
 IF n.event_key LIKE 'publication:%' AND NOT EXISTS(SELECT 1 FROM public.eva_closing_publications p WHERE p.id=split_part(n.event_key,':',2)::uuid AND p.organization_id=n.organization_id AND p.customer_id=n.customer_id AND (SELECT state FROM public.eva_closing_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 1)='PUBLISHED' AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=p.closing_id ORDER BY sequence DESC LIMIT 1)='APPROVED') THEN RAISE EXCEPTION 'Publication withdrawn' USING ERRCODE='42501';END IF;
 IF n.event_key LIKE 'legacy-publication:%' AND NOT EXISTS(SELECT 1 FROM public.monthly_energy_settlements f WHERE f.organization_id=n.organization_id AND f.customer_id=n.customer_id AND f.financial_group_id=split_part(n.event_key,':',2)::uuid AND f.status='PUBLISHED' AND f.validation_status='VALIDATED' AND f.published_at IS NOT NULL) THEN RAISE EXCEPTION 'Publication withdrawn' USING ERRCODE='42501';END IF;
 IF n.record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.operation_records r WHERE r.id=n.record_id AND r.organization_id=n.organization_id AND r.customer_id=n.customer_id AND r.status NOT IN('CANCELLED','ARCHIVED')) THEN RAISE EXCEPTION 'Request withdrawn' USING ERRCODE='42501';END IF;
 -- Reuse the reviewed organizational contact policy. A login address alone is not channel consent.
 FOR policy IN SELECT p.* FROM public.customer_notice_policies p WHERE p.organization_id=n.organization_id AND p.customer_id=n.customer_id AND p.state='ACTIVE' AND p.activated_at<=n.created_at AND p.config->'channels' ? lower(p_channel) LOOP
  PERFORM public.assert_customer_notice_actor(n.organization_id,policy.owner_id);
  IF public.customer_notice_contacts(n.organization_id,policy.config) IS DISTINCT FROM policy.contacts THEN CONTINUE;END IF;
  FOR contact IN SELECT value FROM jsonb_array_elements(policy.contacts) LOOP
   IF lower(contact->>'email')=lower(actor.email) AND contact->>'active'='true' AND contact->'channels' ? lower(p_channel) THEN
    address:=CASE WHEN p_channel='EMAIL' THEN contact->>'email' ELSE contact->>'phone' END;
    IF address IS NOT NULL THEN RETURN address;END IF;
   END IF;
  END LOOP;
 END LOOP;
 RAISE EXCEPTION 'Reviewed contact unavailable' USING ERRCODE='42501';
END$$;
CREATE FUNCTION public.claim_portal_notification(p_channels jsonb,p_daily integer,p_budget bigint,p_costs jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n public.portal_notification_outbox; channel_name text; destination text; cost bigint; d public.portal_notification_deliveries;
BEGIN
 IF jsonb_typeof(p_channels) IS DISTINCT FROM 'array' OR p_daily NOT BETWEEN 1 AND 100 OR p_budget NOT BETWEEN 1 AND 1000000000 OR jsonb_typeof(p_costs) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Delivery budget required' USING ERRCODE='22023';END IF;
 FOR n IN SELECT * FROM public.portal_notification_outbox o WHERE href LIKE '/portal#%' AND created_at>now()-interval '24 hours' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_channels)c WHERE NOT EXISTS(SELECT 1 FROM public.portal_notification_deliveries existing_delivery WHERE existing_delivery.notification_id=o.id AND existing_delivery.channel=c)) ORDER BY created_at LIMIT 100 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('portal-notice-budget:'||n.organization_id,0)) THEN CONTINUE;END IF;
  FOR channel_name IN SELECT jsonb_array_elements_text(p_channels) LOOP
   IF channel_name NOT IN('EMAIL','SMS','WHATSAPP') OR EXISTS(SELECT 1 FROM public.portal_notification_deliveries WHERE notification_id=n.id AND channel=channel_name) THEN CONTINUE;END IF;
   IF coalesce(p_costs->>channel_name,'')!~'^[0-9]{1,9}$' THEN RAISE EXCEPTION 'Channel price required' USING ERRCODE='22023';END IF;
   cost:=(p_costs->>channel_name)::bigint;
   IF cost<=0 OR (SELECT count(*) FROM public.portal_notification_deliveries WHERE organization_id=n.organization_id AND state='RESERVED' AND sequence=1 AND created_at>=date_trunc('day',now()))>=p_daily OR (SELECT coalesce(sum(cost_micro_usd),0) FROM public.portal_notification_deliveries WHERE organization_id=n.organization_id AND state='RESERVED' AND sequence=1 AND created_at>=date_trunc('month',now()))+cost>p_budget THEN CONTINUE;END IF;
   BEGIN destination:=public.portal_notice_destination(n.id,channel_name);
   EXCEPTION WHEN SQLSTATE '42501' OR no_data_found THEN
    INSERT INTO public.portal_notification_deliveries(organization_id,notification_id,channel,attempt,state,reason) VALUES(n.organization_id,n.id,channel_name,1,'BLOCKED','ACCESS_CONTACT_OR_CONSENT_UNAVAILABLE');CONTINUE;
   END;
   INSERT INTO public.portal_notification_deliveries(organization_id,notification_id,channel,attempt,state,cost_micro_usd) VALUES(n.organization_id,n.id,channel_name,1,'RESERVED',cost) RETURNING * INTO d;
   RETURN jsonb_build_object('id',d.id,'notificationId',n.id,'organizationId',n.organization_id,'channel',channel_name,'destination',destination);
  END LOOP;
 END LOOP;RETURN NULL;
END$$;
CREATE FUNCTION public.start_portal_notification(p_delivery uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.portal_notification_deliveries; destination text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-delivery-start:'||p_delivery,0));
 SELECT * INTO STRICT d FROM public.portal_notification_deliveries WHERE id=p_delivery AND state='RESERVED' AND created_at>now()-interval '2 minutes';
 IF EXISTS(SELECT 1 FROM public.portal_notification_deliveries WHERE notification_id=d.notification_id AND channel=d.channel AND sequence>1) THEN RAISE EXCEPTION 'Delivery already started' USING ERRCODE='40001';END IF;
 destination:=public.portal_notice_destination(d.notification_id,d.channel);
 INSERT INTO public.portal_notification_deliveries(organization_id,notification_id,channel,attempt,sequence,state,reason) VALUES(d.organization_id,d.notification_id,d.channel,1,2,'RESERVED','TRANSMITTING');
 RETURN jsonb_build_object('destination',destination);
END$$;
CREATE FUNCTION public.finish_portal_notification(p_delivery uuid,p_state text,p_provider text,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.portal_notification_deliveries; prior public.portal_notification_deliveries;
BEGIN
 SELECT * INTO STRICT d FROM public.portal_notification_deliveries WHERE id=p_delivery AND state='RESERVED' AND sequence=1;
 IF p_provider IS NOT NULL AND EXISTS(SELECT 1 FROM public.portal_notification_deliveries WHERE notification_id=d.notification_id AND channel=d.channel AND provider_id IS NOT NULL AND provider_id<>p_provider) THEN RAISE EXCEPTION 'Provider mismatch' USING ERRCODE='42501';END IF;
 IF p_state NOT IN('ACCEPTED','FAILED','UNKNOWN') OR length(coalesce(p_provider,''))>512 OR length(coalesce(p_reason,''))>160 THEN RAISE EXCEPTION 'Invalid provider receipt' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-delivery:'||p_delivery,0));
 SELECT * INTO prior FROM public.portal_notification_deliveries WHERE notification_id=d.notification_id AND channel=d.channel AND sequence=3;
 IF FOUND THEN IF prior.state<>p_state OR prior.provider_id IS DISTINCT FROM p_provider THEN RAISE EXCEPTION 'Provider receipt changed' USING ERRCODE='40001';END IF;RETURN;END IF;
 INSERT INTO public.portal_notification_deliveries(organization_id,notification_id,channel,attempt,sequence,state,provider_id,reason) VALUES(d.organization_id,d.notification_id,d.channel,1,3,p_state,p_provider,p_reason);
END$$;
CREATE FUNCTION public.collect_portal_deadline_notices() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.operation_records; m record; binding jsonb;
BEGIN
 FOR r IN SELECT o.* FROM public.operation_records o WHERE o.customer_id IS NOT NULL AND o.status NOT IN('DONE','CANCELLED','ARCHIVED') AND o.due_at BETWEEN now() AND now()+interval '24 hours' AND NOT EXISTS(SELECT 1 FROM public.portal_notification_outbox previous WHERE previous.organization_id=o.organization_id AND previous.event_key='deadline:'||o.id||':'||o.revision) AND EXISTS(SELECT 1 FROM public.operation_client_messages WHERE organization_id=o.organization_id AND record_id=o.id AND direction='OUTBOUND') AND EXISTS(SELECT 1 FROM public.portal_service_routing p WHERE p.organization_id=o.organization_id AND p.kind='ROUTING' AND p.owner_user_id='organization' AND p.body->>'enabled'='true' AND NOT EXISTS(SELECT 1 FROM public.portal_service_routing x WHERE x.organization_id=p.organization_id AND x.kind=p.kind AND x.owner_user_id=p.owner_user_id AND x.revision>p.revision)) ORDER BY o.due_at LIMIT 100 LOOP
  FOR m IN SELECT user_id::text AS id,role_id::text AS role FROM public.organization_members WHERE organization_id=r.organization_id AND upper(status)='ACTIVE' AND affiliation_type='external' AND exclusive_customer_id=r.customer_id LOOP
   BEGIN binding:=public.client_portal_entitlement(r.organization_id,m.id,m.role,'notifications');EXCEPTION WHEN SQLSTATE '42501' THEN CONTINUE;END;
   IF binding->>'enabled'='true' THEN INSERT INTO public.portal_notification_outbox(organization_id,customer_id,recipient_id,event_key,kind,title,href,record_id) VALUES(r.organization_id,r.customer_id,m.id,'deadline:'||r.id||':'||r.revision,'DEADLINE','Solicitação com prazo nas próximas 24 horas','/portal#notificacoes',r.id) ON CONFLICT DO NOTHING;END IF;
  END LOOP;
 END LOOP;
END$$;
REVOKE ALL ON FUNCTION public.portal_notice_destination(uuid,text),public.claim_portal_notification(jsonb,integer,bigint,jsonb),public.start_portal_notification(uuid),public.finish_portal_notification(uuid,text,text,text),public.collect_portal_deadline_notices() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_portal_notification(jsonb,integer,bigint,jsonb),public.start_portal_notification(uuid),public.finish_portal_notification(uuid,text,text,text),public.collect_portal_deadline_notices() TO service_role;
COMMIT;
