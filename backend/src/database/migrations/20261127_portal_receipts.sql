BEGIN;
SET LOCAL lock_timeout='5s';
-- Called only after the existing Twilio signature/account/SID validation.
CREATE FUNCTION public.record_portal_sms_receipt(p_delivery uuid,p_message text,p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.portal_notification_deliveries; confirmed text; seq integer;
BEGIN
 IF p_message!~'^SM[a-fA-F0-9]{32}$' OR p_status NOT IN('queued','sending','sent','delivered','undelivered','failed') THEN RAISE EXCEPTION 'Invalid SMS receipt' USING ERRCODE='22023';END IF;
 SELECT * INTO d FROM public.portal_notification_deliveries WHERE id=p_delivery AND channel='SMS' AND sequence=1 AND state='RESERVED';IF NOT FOUND THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-delivery:'||p_delivery,0));
 IF NOT EXISTS(SELECT 1 FROM public.portal_notification_deliveries WHERE notification_id=d.notification_id AND channel=d.channel AND sequence=2) THEN RETURN;END IF;
 SELECT provider_id INTO confirmed FROM public.portal_notification_deliveries WHERE notification_id=d.notification_id AND channel=d.channel AND provider_id IS NOT NULL LIMIT 1;
 IF confirmed IS NOT NULL AND confirmed<>p_message THEN RAISE EXCEPTION 'Provider mismatch' USING ERRCODE='42501';END IF;
 seq:=CASE p_status WHEN 'delivered' THEN 4 WHEN 'failed' THEN 5 WHEN 'undelivered' THEN 6 ELSE 7 END;
 INSERT INTO public.portal_notification_deliveries(organization_id,notification_id,channel,attempt,sequence,state,provider_id,reason) VALUES(d.organization_id,d.notification_id,d.channel,1,seq,CASE WHEN p_status='delivered' THEN 'DELIVERED' WHEN p_status IN('failed','undelivered') THEN 'FAILED' ELSE 'ACCEPTED' END,p_message,p_status) ON CONFLICT DO NOTHING;
END$$;
REVOKE ALL ON FUNCTION public.record_portal_sms_receipt(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_portal_sms_receipt(uuid,text,text) TO service_role;
COMMIT;
