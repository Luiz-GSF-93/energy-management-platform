BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.report_deliveries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 job_id uuid NOT NULL REFERENCES public.report_jobs(id),contact_id text NOT NULL,channel text NOT NULL CHECK(channel IN ('email','whatsapp','sms')),
 destination text NOT NULL,state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','PREPARING','TRANSMITTING','ACCEPTED','FAILED','UNKNOWN','BLOCKED')),
 lease_id uuid,lease_until timestamptz,provider_id text,reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,contact_id,channel),UNIQUE(job_id,channel,destination),UNIQUE(channel,provider_id)
);
ALTER TABLE public.report_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_deliveries FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX report_delivery_due ON public.report_deliveries(created_at) WHERE state IN ('QUEUED','PREPARING','TRANSMITTING');
CREATE FUNCTION public.enqueue_report_delivery() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE contact jsonb;channel_name text;
BEGIN
 IF NEW.state='READY' AND OLD.state IS DISTINCT FROM 'READY' THEN
  FOR contact IN SELECT value FROM jsonb_array_elements(NEW.contacts) LOOP
   FOR channel_name IN SELECT jsonb_array_elements_text(NEW.config->'channels') LOOP
    INSERT INTO public.report_deliveries(organization_id,job_id,contact_id,channel,destination,state,reason)
    VALUES(NEW.organization_id,NEW.id,contact->>'id',channel_name,CASE WHEN channel_name='email' THEN contact->>'email' ELSE contact->>'phone' END,
     CASE WHEN channel_name='sms' THEN 'BLOCKED' ELSE 'QUEUED' END,CASE WHEN channel_name='sms' THEN 'SMS_NOT_READY' ELSE NULL END)
    ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_delivery_enqueue AFTER UPDATE OF state ON public.report_jobs FOR EACH ROW EXECUTE FUNCTION public.enqueue_report_delivery();

CREATE FUNCTION public.assert_report_delivery_scope(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.report_deliveries;j public.report_jobs;p public.report_policies;ctx jsonb;
BEGIN
 SELECT * INTO STRICT d FROM public.report_deliveries WHERE id=p_id;
 SELECT * INTO STRICT j FROM public.report_jobs WHERE id=d.job_id AND organization_id=d.organization_id;
 SELECT * INTO STRICT p FROM public.report_policies WHERE id=j.policy_id AND organization_id=d.organization_id;
 IF j.state<>'READY' OR p.state<>'ACTIVE' OR p.version<>j.policy_version THEN RAISE EXCEPTION 'Policy changed' USING ERRCODE='42501';END IF;
 ctx:=public.assert_report_configuration_actor(d.organization_id,j.owner_id);
 IF public.report_policy_contacts(d.organization_id,j.config)<>j.contacts THEN RAISE EXCEPTION 'Contacts changed' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.contacts) c WHERE c->>'id'=d.contact_id AND c->'active'='true'::jsonb AND c->'channels' ? d.channel AND d.destination=CASE WHEN d.channel='email' THEN c->>'email' ELSE c->>'phone' END) THEN RAISE EXCEPTION 'Destination revoked' USING ERRCODE='42501';END IF;
 IF jsonb_array_length(j.report_ids)<>jsonb_array_length(j.config->'kinds') OR NOT j.config->'channels' ? d.channel THEN RAISE EXCEPTION 'Reports changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('delivery',to_jsonb(d),'job',to_jsonb(j),'context',ctx);
END $$;

CREATE FUNCTION public.claim_report_delivery(p_channels jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.report_deliveries;result jsonb;
BEGIN
 IF jsonb_typeof(p_channels) IS DISTINCT FROM 'array' OR jsonb_array_length(p_channels)>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_channels) c WHERE c NOT IN ('email','whatsapp')) THEN RAISE EXCEPTION 'Invalid channels' USING ERRCODE='22023';END IF;
 -- A crash after network start is ambiguous: do not automatically send a duplicate message.
 UPDATE public.report_deliveries SET state='UNKNOWN',reason='INTERRUPTED_TRANSMISSION',lease_until=NULL,updated_at=now() WHERE state='TRANSMITTING' AND lease_until<now();
 SELECT * INTO d FROM public.report_deliveries WHERE p_channels ? channel AND (state='QUEUED' OR state='PREPARING' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('report-config:'||d.organization_id,0)) THEN RETURN NULL;END IF;
 BEGIN result:=public.assert_report_delivery_scope(d.id);
 EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE 'P3862' OR SQLSTATE '22023' OR no_data_found THEN
  UPDATE public.report_deliveries SET state='BLOCKED',reason='ACCESS_OR_CONTACT_CHANGED',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=d.id;RETURN NULL;
 END;
 UPDATE public.report_deliveries SET state='PREPARING',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=d.id RETURNING * INTO d;
 RETURN jsonb_set(result,'{delivery}',to_jsonb(d));
END $$;

CREATE FUNCTION public.start_report_delivery(p_org text,p_id uuid,p_lease uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.report_deliveries;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('report-config:'||p_org,0));
 SELECT * INTO d FROM public.report_deliveries WHERE organization_id=p_org AND id=p_id AND lease_id=p_lease AND state='PREPARING' AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease changed' USING ERRCODE='40001';END IF;
 BEGIN PERFORM public.assert_report_delivery_scope(d.id);
 EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE 'P3862' OR SQLSTATE '22023' OR no_data_found THEN
  UPDATE public.report_deliveries SET state='BLOCKED',reason='ACCESS_OR_CONTACT_CHANGED',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=d.id;RETURN false;
 END;
 UPDATE public.report_deliveries SET state='TRANSMITTING',lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=d.id;
 RETURN true;
END $$;

CREATE FUNCTION public.finish_report_delivery(p_org text,p_id uuid,p_lease uuid,p_state text,p_provider_id text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_state NOT IN ('ACCEPTED','FAILED','UNKNOWN') OR p_state='ACCEPTED' AND (p_provider_id IS NULL OR length(p_provider_id) NOT BETWEEN 1 AND 512) OR p_reason IS NOT NULL AND p_reason NOT IN ('REPORT_UNAVAILABLE','PROVIDER_NOT_READY','INVALID_DESTINATION','ATTACHMENT_LIMIT','PROVIDER_UNCERTAIN','PROVIDER_REJECTED','MISSING_RECEIPT') THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023';END IF;
 UPDATE public.report_deliveries SET state=p_state,provider_id=p_provider_id,reason=p_reason,lease_until=NULL,updated_at=now()
 WHERE organization_id=p_org AND id=p_id AND lease_id=p_lease AND lease_until>now() AND (state='TRANSMITTING' OR state='PREPARING' AND p_state='FAILED' AND p_reason='REPORT_UNAVAILABLE');
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease changed' USING ERRCODE='40001';END IF;
END $$;

CREATE FUNCTION public.read_report_deliveries(p_org text,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.assert_report_configuration_actor(p_org,p_actor);
 SELECT COALESCE(jsonb_agg(item ORDER BY item->>'created_at' DESC),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('id',d.id,'jobId',d.job_id,'contactId',d.contact_id,'channel',d.channel,'state',d.state,'reason',d.reason,'created_at',d.created_at,
   'deliveryStatus',CASE WHEN d.channel='whatsapp' AND d.provider_id IS NOT NULL THEN
    (SELECT s.status FROM public.platform_whatsapp_status_events s WHERE s.message_id=d.provider_id ORDER BY CASE s.status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'failed' THEN 2 ELSE 1 END DESC,s.event_at DESC LIMIT 1) ELSE NULL END) item
  FROM public.report_deliveries d WHERE d.organization_id=p_org ORDER BY d.created_at DESC LIMIT 200
 ) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_report_delivery(),public.assert_report_delivery_scope(uuid),public.claim_report_delivery(jsonb),public.start_report_delivery(text,uuid,uuid),public.finish_report_delivery(text,uuid,uuid,text,text,text),public.read_report_deliveries(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_report_delivery(jsonb),public.start_report_delivery(text,uuid,uuid),public.finish_report_delivery(text,uuid,uuid,text,text,text),public.read_report_deliveries(text,text) TO service_role;
COMMIT;
