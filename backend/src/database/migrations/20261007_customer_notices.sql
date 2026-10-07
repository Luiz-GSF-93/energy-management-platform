BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.customer_notice_policies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 version int NOT NULL DEFAULT 1,state text NOT NULL DEFAULT 'PAUSED' CHECK(state IN ('PAUSED','ACTIVE')),
 config jsonb NOT NULL,contacts jsonb NOT NULL,owner_id text NOT NULL,activated_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,customer_id,consumer_unit_id)
);
CREATE TABLE public.customer_notice_history(
 organization_id text NOT NULL,request_id uuid NOT NULL,policy_id uuid NOT NULL REFERENCES public.customer_notice_policies(id),
 actor_id text NOT NULL,command jsonb NOT NULL,before_value jsonb,after_value jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,request_id)
);
CREATE TABLE public.customer_notice_deliveries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,policy_id uuid NOT NULL REFERENCES public.customer_notice_policies(id),policy_version int NOT NULL,
 source_id uuid NOT NULL,source_version int NOT NULL,event text NOT NULL CHECK(event IN ('REQUEST','AGENDA','DEADLINE','ACL_PUBLISHED')),
 contact_id text NOT NULL,channel text NOT NULL CHECK(channel IN ('email','whatsapp','sms')),destination text NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','PREPARING','TRANSMITTING','ACCEPTED','FAILED','UNKNOWN','BLOCKED')),
 lease_id uuid,lease_until timestamptz,provider_id text,reason text,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 UNIQUE(policy_id,source_id,source_version,event,channel,contact_id),UNIQUE(policy_id,source_id,source_version,event,channel,destination),UNIQUE(channel,provider_id)
);
CREATE INDEX customer_notice_queue ON public.customer_notice_deliveries(created_at) WHERE state IN ('QUEUED','PREPARING','TRANSMITTING');
ALTER TABLE public.customer_notice_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notice_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notice_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_notice_policies,public.customer_notice_history,public.customer_notice_deliveries FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER customer_notice_history_immutable BEFORE UPDATE OR DELETE ON public.customer_notice_history FOR EACH ROW EXECUTE FUNCTION public.reject_report_change();

CREATE FUNCTION public.assert_customer_notice_actor(p_org text,p_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.assert_operation_actor(p_org,p_actor,'requests',false);
 PERFORM public.assert_operation_actor(p_org,p_actor,'agenda',false);
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND status='ACTIVE' AND start_date<=current_date AND (end_date IS NULL OR end_date>=current_date) AND free_market_management) THEN RAISE EXCEPTION 'License denied' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now()) THEN
  PERFORM public.assert_license_platform_actor(p_actor::uuid);RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND r.name IN ('admin_org','gestor','operacional') AND r.permissions ?& ARRAY['51da7cca-8196-4135-84ce-f989be5ee594','cbb2e904-0718-4eec-9396-dba899118cdd','b142bd7b-05a3-45ee-befd-e593066c2775']) THEN RAISE EXCEPTION 'Notices denied' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION public.customer_notice_contacts(p_org text,p_config jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_config IS NULL OR jsonb_typeof(p_config)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_config))<>5 OR NOT p_config ?& ARRAY['customerId','unitId','events','channels','contactIds'] OR jsonb_typeof(p_config->'events') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid notice configuration' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_config->'events') NOT BETWEEN 1 AND 4 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_config->'events'))<>jsonb_array_length(p_config->'events') OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_config->'events') e WHERE e NOT IN ('REQUEST','AGENDA','DEADLINE','ACL_PUBLISHED')) THEN RAISE EXCEPTION 'Invalid notice events' USING ERRCODE='22023';END IF;
 RETURN public.report_policy_contacts(p_org,jsonb_build_object('name','Avisos','customerId',p_config->'customerId','unitId',p_config->'unitId','frequency','MONTHLY','days',jsonb_build_array(5),'hour',9,'monthlyLimit',1,'kinds',jsonb_build_array('OPERATIONAL'),'formats',jsonb_build_array('pdf'),'channels',p_config->'channels','contactIds',p_config->'contactIds'));
END $$;
CREATE FUNCTION public.save_customer_notice_policy(p_org text,p_actor text,p_id uuid,p_version int,p_request uuid,p_config jsonb,p_enabled boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.customer_notice_policies;result public.customer_notice_policies;h public.customer_notice_history;selected_contacts jsonb;command jsonb;
BEGIN
 PERFORM public.assert_customer_notice_actor(p_org,p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-notices:'||p_org,0));
 IF p_request IS NULL OR p_enabled IS NULL THEN RAISE EXCEPTION 'Missing command' USING ERRCODE='22023';END IF;
 command:=jsonb_build_object('id',p_id,'version',p_version,'config',p_config,'enabled',p_enabled);
 SELECT * INTO h FROM public.customer_notice_history WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF h.actor_id<>p_actor OR h.command<>command THEN RAISE EXCEPTION 'Command conflict' USING ERRCODE='40001';END IF;RETURN h.after_value;END IF;
 selected_contacts:=public.customer_notice_contacts(p_org,p_config);
 IF p_id IS NULL THEN
  IF p_enabled OR p_version IS NOT NULL THEN RAISE EXCEPTION 'New policies start paused' USING ERRCODE='22023';END IF;
  INSERT INTO public.customer_notice_policies(organization_id,customer_id,consumer_unit_id,config,contacts,owner_id) VALUES(p_org,p_config->>'customerId',p_config->>'unitId',p_config,selected_contacts,p_actor) RETURNING * INTO result;
 ELSE
  SELECT * INTO prior FROM public.customer_notice_policies WHERE id=p_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR prior.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Policy changed' USING ERRCODE='40001';END IF;
  IF prior.customer_id<>p_config->>'customerId' OR prior.consumer_unit_id<>p_config->>'unitId' THEN RAISE EXCEPTION 'Scope immutable' USING ERRCODE='22023';END IF;
  IF p_enabled AND (prior.config<>p_config OR prior.contacts<>selected_contacts) THEN RAISE EXCEPTION 'Save paused and review contacts first' USING ERRCODE='40001';END IF;
  UPDATE public.customer_notice_policies SET version=version+1,config=p_config,contacts=selected_contacts,owner_id=p_actor,state=CASE WHEN p_enabled THEN 'ACTIVE' ELSE 'PAUSED' END,activated_at=CASE WHEN p_enabled THEN now() ELSE NULL END,updated_at=now() WHERE id=p_id RETURNING * INTO result;
 END IF;
 INSERT INTO public.customer_notice_history VALUES(p_org,p_request,result.id,p_actor,command,CASE WHEN prior.id IS NOT NULL THEN to_jsonb(prior) ELSE NULL END,to_jsonb(result),now());
 RETURN to_jsonb(result);
END $$;

CREATE FUNCTION public.enqueue_customer_notice(p_org text,p_customer text,p_unit text,p_source uuid,p_version int,p_event text,p_source_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy public.customer_notice_policies;contact jsonb;channel_name text;
BEGIN
 FOR policy IN SELECT * FROM public.customer_notice_policies WHERE organization_id=p_org AND customer_id=p_customer AND consumer_unit_id=p_unit AND state='ACTIVE' AND activated_at<=p_source_at AND config->'events' ? p_event LOOP
  FOR contact IN SELECT value FROM jsonb_array_elements(policy.contacts) LOOP
   FOR channel_name IN SELECT jsonb_array_elements_text(policy.config->'channels') LOOP
    INSERT INTO public.customer_notice_deliveries(organization_id,policy_id,policy_version,source_id,source_version,event,contact_id,channel,destination)
    VALUES(p_org,policy.id,policy.version,p_source,p_version,p_event,contact->>'id',channel_name,CASE WHEN channel_name='email' THEN contact->>'email' ELSE contact->>'phone' END) ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION public.customer_notice_operation_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.kind IN ('requests','agenda') AND NEW.customer_id IS NOT NULL AND NEW.consumer_unit_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.revision IS DISTINCT FROM OLD.revision) THEN
  PERFORM public.enqueue_customer_notice(NEW.organization_id,NEW.customer_id,NEW.consumer_unit_id,NEW.id,NEW.revision,CASE WHEN NEW.kind='requests' THEN 'REQUEST' ELSE 'AGENDA' END,NEW.updated_at);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER customer_notice_operations AFTER INSERT OR UPDATE ON public.operation_records FOR EACH ROW EXECUTE FUNCTION public.customer_notice_operation_event();
CREATE FUNCTION public.customer_notice_acl_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE admission record;
BEGIN
 SELECT * INTO admission FROM public.acl_admissions WHERE id=NEW.admission_id AND organization_id=NEW.organization_id;
 IF FOUND THEN PERFORM public.enqueue_customer_notice(NEW.organization_id,admission.customer_id,admission.consumer_unit_id,NEW.admission_id,1,'ACL_PUBLISHED',NEW.published_at);END IF;RETURN NEW;
END $$;
CREATE TRIGGER customer_notice_acl AFTER INSERT ON public.acl_admission_public_summaries FOR EACH ROW EXECUTE FUNCTION public.customer_notice_acl_event();

CREATE FUNCTION public.assert_customer_notice_delivery(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.customer_notice_deliveries;p public.customer_notice_policies;r public.operation_records;
BEGIN
 SELECT * INTO STRICT d FROM public.customer_notice_deliveries WHERE id=p_id;
 SELECT * INTO STRICT p FROM public.customer_notice_policies WHERE id=d.policy_id AND organization_id=d.organization_id;
 PERFORM public.assert_customer_notice_actor(d.organization_id,p.owner_id);
 IF d.expires_at<=now() OR p.state<>'ACTIVE' OR p.version<>d.policy_version OR NOT p.config->'events' ? d.event OR public.customer_notice_contacts(d.organization_id,p.config)<>p.contacts THEN RAISE EXCEPTION 'Notice revoked' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.contacts) c WHERE c->>'id'=d.contact_id AND c->'active'='true'::jsonb AND c->'channels' ? d.channel AND p.config->'channels' ? d.channel AND d.destination=CASE WHEN d.channel='email' THEN c->>'email' ELSE c->>'phone' END) THEN RAISE EXCEPTION 'Contact revoked' USING ERRCODE='42501';END IF;
 IF d.event='ACL_PUBLISHED' THEN
  IF NOT EXISTS(SELECT 1 FROM public.acl_admission_public_summaries s JOIN public.acl_admissions a ON a.id=s.admission_id AND a.organization_id=s.organization_id WHERE a.id=d.source_id AND a.organization_id=d.organization_id AND a.customer_id=p.customer_id AND a.consumer_unit_id=p.consumer_unit_id) THEN RAISE EXCEPTION 'Publication revoked' USING ERRCODE='42501';END IF;
 ELSE
  SELECT * INTO r FROM public.operation_records WHERE id=d.source_id AND organization_id=d.organization_id AND customer_id=p.customer_id AND consumer_unit_id=p.consumer_unit_id AND revision=d.source_version;
  IF NOT FOUND OR NOT public.acl_operation_allowed(d.organization_id,p.owner_id,d.source_id,false) OR (d.event='REQUEST' AND r.kind<>'requests') OR (d.event='AGENDA' AND r.kind<>'agenda') OR (d.event='DEADLINE' AND (r.status IN ('DONE','CANCELLED') OR COALESCE(r.due_at,r.starts_at)<now())) THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='42501';END IF;
 END IF;
 RETURN to_jsonb(d);
END $$;
CREATE FUNCTION public.claim_customer_notice(p_channels jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.customer_notice_deliveries;r public.operation_records;
BEGIN
 IF jsonb_typeof(p_channels) IS DISTINCT FROM 'array' OR jsonb_array_length(p_channels)>3 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_channels) c WHERE c NOT IN ('email','whatsapp','sms')) THEN RAISE EXCEPTION 'Invalid channels' USING ERRCODE='22023';END IF;
 -- Only reminders for records created/updated after explicit policy activation; no historical backfill.
 FOR r IN SELECT o.* FROM public.operation_records o WHERE kind IN ('requests','agenda') AND status NOT IN ('DONE','CANCELLED') AND COALESCE(due_at,starts_at) BETWEEN now() AND now()+interval '24 hours' AND EXISTS(SELECT 1 FROM public.customer_notice_policies p WHERE p.organization_id=o.organization_id AND p.customer_id=o.customer_id AND p.consumer_unit_id=o.consumer_unit_id AND p.state='ACTIVE' AND p.config->'events' ? 'DEADLINE' AND p.activated_at<=o.updated_at AND NOT EXISTS(SELECT 1 FROM public.customer_notice_deliveries existing WHERE existing.policy_id=p.id AND existing.policy_version=p.version AND existing.source_id=o.id AND existing.source_version=o.revision AND existing.event='DEADLINE')) ORDER BY COALESCE(due_at,starts_at),o.id LIMIT 100 LOOP
  PERFORM public.enqueue_customer_notice(r.organization_id,r.customer_id,r.consumer_unit_id,r.id,r.revision,'DEADLINE',r.updated_at);
 END LOOP;
 UPDATE public.customer_notice_deliveries SET state='UNKNOWN',reason='INTERRUPTED_TRANSMISSION',lease_until=NULL WHERE state='TRANSMITTING' AND lease_until<now();
 UPDATE public.customer_notice_deliveries SET state='BLOCKED',reason='EXPIRED',lease_until=NULL WHERE state IN ('QUEUED','PREPARING') AND expires_at<=now();
 SELECT candidate.* INTO d FROM public.customer_notice_deliveries candidate WHERE p_channels ? candidate.channel AND (candidate.state='QUEUED' OR candidate.state='PREPARING' AND candidate.lease_until<now()) AND (candidate.channel<>'sms' OR EXISTS(SELECT 1 FROM public.customer_notice_deliveries email WHERE email.policy_id=candidate.policy_id AND email.policy_version=candidate.policy_version AND email.source_id=candidate.source_id AND email.source_version=candidate.source_version AND email.event=candidate.event AND email.contact_id=candidate.contact_id AND email.channel='email' AND email.state='ACCEPTED')) ORDER BY candidate.created_at FOR UPDATE OF candidate SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('customer-notices:'||d.organization_id,0)) THEN RETURN NULL;END IF;
 BEGIN PERFORM public.assert_customer_notice_delivery(d.id);
 EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '22023' OR SQLSTATE 'P3862' OR no_data_found THEN UPDATE public.customer_notice_deliveries SET state='BLOCKED',reason='ACCESS_OR_CONTACT_CHANGED',lease_until=NULL WHERE id=d.id;RETURN NULL;END;
 UPDATE public.customer_notice_deliveries SET state='PREPARING',lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes' WHERE id=d.id RETURNING * INTO d;
 RETURN to_jsonb(d);
END $$;
CREATE FUNCTION public.start_customer_notice(p_org text,p_id uuid,p_lease uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.customer_notice_deliveries;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-notices:'||p_org,0));
 SELECT * INTO d FROM public.customer_notice_deliveries WHERE organization_id=p_org AND id=p_id AND lease_id=p_lease AND state='PREPARING' AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease changed' USING ERRCODE='40001';END IF;
 BEGIN PERFORM public.assert_customer_notice_delivery(d.id);EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '22023' OR SQLSTATE 'P3862' OR no_data_found THEN UPDATE public.customer_notice_deliveries SET state='BLOCKED',reason='ACCESS_OR_CONTACT_CHANGED',lease_until=NULL WHERE id=d.id;RETURN false;END;
 UPDATE public.customer_notice_deliveries SET state='TRANSMITTING',lease_until=now()+interval '2 minutes' WHERE id=d.id;RETURN true;
END $$;
CREATE FUNCTION public.finish_customer_notice(p_org text,p_id uuid,p_lease uuid,p_state text,p_provider text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_state NOT IN ('ACCEPTED','FAILED','UNKNOWN') OR p_state='ACCEPTED' AND (p_provider IS NULL OR length(p_provider) NOT BETWEEN 1 AND 512) OR p_reason IS NOT NULL AND p_reason NOT IN ('PROVIDER_NOT_READY','INVALID_DESTINATION','PROVIDER_UNCERTAIN','PROVIDER_REJECTED','MISSING_RECEIPT') THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023';END IF;
 UPDATE public.customer_notice_deliveries SET state=p_state,provider_id=p_provider,reason=p_reason,lease_until=NULL WHERE organization_id=p_org AND id=p_id AND lease_id=p_lease AND lease_until>now() AND state='TRANSMITTING';
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease changed' USING ERRCODE='40001';END IF;
END $$;
CREATE FUNCTION public.read_customer_notices(p_org text,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.assert_customer_notice_actor(p_org,p_actor);
 SELECT jsonb_build_object(
 'customers',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.company_name,'contacts',c.report_contacts)),'[]') FROM (SELECT * FROM public.customers WHERE organization_id=p_org AND status='ACTIVE' AND deleted_at IS NULL ORDER BY company_name LIMIT 100) c),
 'units',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',u.id,'customerId',u.customer_id,'name',u.name)),'[]') FROM (SELECT * FROM public.consumer_units WHERE organization_id=p_org AND status='ACTIVE' ORDER BY name LIMIT 500) u),
 'policies',(SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]') FROM (SELECT * FROM public.customer_notice_policies WHERE organization_id=p_org ORDER BY updated_at DESC LIMIT 100) p),
 'deliveries',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',d.id,'policyId',d.policy_id,'event',d.event,'channel',d.channel,'state',d.state,'reason',d.reason,'createdAt',d.created_at,'deliveryStatus',CASE WHEN d.channel='sms' THEN (SELECT s.status FROM public.sms_delivery_receipts s WHERE s.delivery_id=d.id AND s.message_sid=d.provider_id ORDER BY CASE s.status WHEN 'delivered' THEN 5 WHEN 'undelivered' THEN 4 WHEN 'failed' THEN 4 WHEN 'sent' THEN 3 WHEN 'sending' THEN 2 ELSE 1 END DESC LIMIT 1) WHEN d.channel='whatsapp' THEN (SELECT s.status FROM public.platform_whatsapp_status_events s WHERE s.message_id=d.provider_id ORDER BY CASE s.status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'failed' THEN 2 ELSE 1 END DESC LIMIT 1) ELSE NULL END)),'[]') FROM (SELECT * FROM public.customer_notice_deliveries WHERE organization_id=p_org ORDER BY created_at DESC LIMIT 100) d)
 ) INTO result;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.record_sms_receipt(p_delivery uuid,p_message text,p_status text,p_error text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_message !~ '^SM[0-9a-fA-F]{32}$' OR p_status NOT IN ('queued','sending','sent','delivered','undelivered','failed') OR p_error IS NOT NULL AND p_error !~ '^[0-9]{1,8}$' THEN RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.report_deliveries WHERE id=p_delivery AND channel='sms' AND state IN ('TRANSMITTING','ACCEPTED','UNKNOWN') AND (provider_id IS NULL OR provider_id=p_message)) OR EXISTS(SELECT 1 FROM public.customer_notice_deliveries WHERE id=p_delivery AND channel='sms' AND state IN ('TRANSMITTING','ACCEPTED','UNKNOWN') AND (provider_id IS NULL OR provider_id=p_message)) THEN
  INSERT INTO public.sms_delivery_receipts(delivery_id,message_sid,status,error_code) VALUES(p_delivery,p_message,p_status,p_error) ON CONFLICT DO NOTHING;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_customer_notice_actor(text,text),public.customer_notice_contacts(text,jsonb),public.save_customer_notice_policy(text,text,uuid,int,uuid,jsonb,boolean),public.enqueue_customer_notice(text,text,text,uuid,int,text,timestamptz),public.customer_notice_operation_event(),public.customer_notice_acl_event(),public.assert_customer_notice_delivery(uuid),public.claim_customer_notice(jsonb),public.start_customer_notice(text,uuid,uuid),public.finish_customer_notice(text,uuid,uuid,text,text,text),public.read_customer_notices(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_customer_notice_policy(text,text,uuid,int,uuid,jsonb,boolean),public.claim_customer_notice(jsonb),public.start_customer_notice(text,uuid,uuid),public.finish_customer_notice(text,uuid,uuid,text,text,text),public.read_customer_notices(text,text) TO service_role;
COMMIT;
