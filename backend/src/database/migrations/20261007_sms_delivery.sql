BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.sms_delivery_receipts(
 delivery_id uuid NOT NULL,message_sid text NOT NULL CHECK(message_sid ~ '^SM[0-9a-fA-F]{32}$'),
 status text NOT NULL CHECK(status IN ('queued','sending','sent','delivered','undelivered','failed')),
 error_code text,received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(delivery_id,message_sid,status)
);
ALTER TABLE public.sms_delivery_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_delivery_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_sms_receipt(p_delivery uuid,p_message text,p_status text,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_message !~ '^SM[0-9a-fA-F]{32}$' OR p_status NOT IN ('queued','sending','sent','delivered','undelivered','failed') OR p_error IS NOT NULL AND p_error !~ '^[0-9]{1,8}$' THEN RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='22023';END IF;
 -- Receipts can arrive before the send response. Read endpoints match both delivery and final SID.
 IF EXISTS(SELECT 1 FROM public.report_deliveries WHERE id=p_delivery AND channel='sms' AND state IN ('TRANSMITTING','ACCEPTED','UNKNOWN') AND (provider_id IS NULL OR provider_id=p_message)) THEN
  INSERT INTO public.sms_delivery_receipts(delivery_id,message_sid,status,error_code) VALUES(p_delivery,p_message,p_status,p_error) ON CONFLICT DO NOTHING;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.record_sms_receipt(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_sms_receipt(uuid,text,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.enqueue_report_delivery() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE contact jsonb;channel_name text;
BEGIN
 IF NEW.state='READY' AND OLD.state IS DISTINCT FROM 'READY' THEN
  FOR contact IN SELECT value FROM jsonb_array_elements(NEW.contacts) LOOP
   FOR channel_name IN SELECT jsonb_array_elements_text(NEW.config->'channels') LOOP
    INSERT INTO public.report_deliveries(organization_id,job_id,contact_id,channel,destination)
    VALUES(NEW.organization_id,NEW.id,contact->>'id',channel_name,CASE WHEN channel_name='email' THEN contact->>'email' ELSE contact->>'phone' END) ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
-- Previously blocked SMS are deliberately not reactivated.
CREATE OR REPLACE FUNCTION public.claim_report_delivery(p_channels jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.report_deliveries;result jsonb;
BEGIN
 IF jsonb_typeof(p_channels) IS DISTINCT FROM 'array' OR jsonb_array_length(p_channels)>3 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_channels) c WHERE c NOT IN ('email','whatsapp','sms')) THEN RAISE EXCEPTION 'Invalid channels' USING ERRCODE='22023';END IF;
 -- A crash after network start is ambiguous: do not automatically send a duplicate message.
 UPDATE public.report_deliveries SET state='BLOCKED',reason='EXPIRED',lease_until=NULL,updated_at=now() WHERE state IN ('QUEUED','PREPARING') AND created_at<now()-interval '48 hours';
 UPDATE public.report_deliveries SET state='UNKNOWN',reason='INTERRUPTED_TRANSMISSION',lease_until=NULL,updated_at=now() WHERE state='TRANSMITTING' AND lease_until<now();
 SELECT candidate.* INTO d FROM public.report_deliveries candidate WHERE p_channels ? candidate.channel AND (candidate.state='QUEUED' OR candidate.state='PREPARING' AND candidate.lease_until<now()) AND (candidate.channel<>'sms' OR EXISTS(SELECT 1 FROM public.report_deliveries email WHERE email.job_id=candidate.job_id AND email.contact_id=candidate.contact_id AND email.channel='email' AND email.state='ACCEPTED')) ORDER BY candidate.created_at FOR UPDATE OF candidate SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('report-config:'||d.organization_id,0)) THEN RETURN NULL;END IF;
 BEGIN result:=public.assert_report_delivery_scope(d.id);
 EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE 'P3862' OR SQLSTATE '22023' OR no_data_found THEN
  UPDATE public.report_deliveries SET state='BLOCKED',reason='ACCESS_OR_CONTACT_CHANGED',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=d.id;RETURN NULL;
 END;
 UPDATE public.report_deliveries SET state='PREPARING',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=d.id RETURNING * INTO d;
 RETURN jsonb_set(result,'{delivery}',to_jsonb(d));
END $$;
CREATE OR REPLACE FUNCTION public.read_report_deliveries(p_org text,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.assert_report_configuration_actor(p_org,p_actor);
 SELECT COALESCE(jsonb_agg(item ORDER BY item->>'created_at' DESC),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('id',d.id,'jobId',d.job_id,'contactId',d.contact_id,'channel',d.channel,'state',d.state,'reason',d.reason,'created_at',d.created_at,
   'deliveryStatus',CASE WHEN d.channel='whatsapp' AND d.provider_id IS NOT NULL THEN
    (SELECT s.status FROM public.platform_whatsapp_status_events s WHERE s.message_id=d.provider_id ORDER BY CASE s.status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'failed' THEN 2 ELSE 1 END DESC,s.event_at DESC LIMIT 1) WHEN d.channel='sms' AND d.provider_id IS NOT NULL THEN (SELECT s.status FROM public.sms_delivery_receipts s WHERE s.delivery_id=d.id AND s.message_sid=d.provider_id ORDER BY CASE s.status WHEN 'delivered' THEN 5 WHEN 'undelivered' THEN 4 WHEN 'failed' THEN 4 WHEN 'sent' THEN 3 WHEN 'sending' THEN 2 ELSE 1 END DESC,s.received_at DESC LIMIT 1) ELSE NULL END) item
  FROM public.report_deliveries d WHERE d.organization_id=p_org ORDER BY d.created_at DESC LIMIT 200
 ) q;
 RETURN result;
END $$;
COMMIT;
