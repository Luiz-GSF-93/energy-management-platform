BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Unknown provider IDs cannot delay unrelated organization/invitation events.
CREATE OR REPLACE FUNCTION public.record_platform_team_notification_delivery(p_key text,p_provider text,p_state text,p_at timestamptz,p_notification uuid DEFAULT NULL,p_recipient text DEFAULT NULL,p_from text DEFAULT NULL,p_subject text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n public.platform_team_notifications%ROWTYPE; event_id uuid;
BEGIN
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_at IS NULL OR p_at>now()+interval '5 minutes' OR p_state IS NULL OR p_state NOT IN ('ACCEPTED','DELIVERED','DELAYED','FAILED','BOUNCED','COMPLAINED') THEN RAISE EXCEPTION 'Invalid delivery evidence' USING ERRCODE='22023'; END IF;
 SELECT * INTO n FROM public.platform_team_notifications WHERE provider_id=p_provider FOR UPDATE;
 IF NOT FOUND AND p_notification IS NOT NULL THEN
  SELECT * INTO n FROM public.platform_team_notifications WHERE id=p_notification AND state IN ('SENDING','UNKNOWN') AND provider_id IS NULL AND payload IS NOT NULL FOR UPDATE;
  IF FOUND THEN
   IF n.recipient IS DISTINCT FROM p_recipient OR n.payload->>'from' IS DISTINCT FROM p_from OR n.payload->>'subject' IS DISTINCT FROM p_subject OR p_at<n.created_at-interval '5 minutes' THEN RAISE EXCEPTION 'Delivery correlation mismatch' USING ERRCODE='22023'; END IF;
   UPDATE public.platform_team_notifications SET provider_id=p_provider WHERE id=n.id;
  END IF;
 END IF;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ignored',true);
 END IF;
 IF p_notification IS NOT NULL AND (n.id IS DISTINCT FROM p_notification OR n.recipient IS DISTINCT FROM p_recipient OR n.payload->>'from' IS DISTINCT FROM p_from OR n.payload->>'subject' IS DISTINCT FROM p_subject) THEN RAISE EXCEPTION 'Delivery correlation mismatch' USING ERRCODE='22023'; END IF;
 INSERT INTO public.platform_team_notification_events(notification_id,event_key,state,source,provider_at,reason)
 VALUES(n.id,'webhook:'||p_key,p_state,'WEBHOOK',p_at,'Evento autenticado do provedor; não altera acesso.') ON CONFLICT(event_key) DO NOTHING RETURNING id INTO event_id;
 IF event_id IS NULL THEN RETURN jsonb_build_object('duplicate',true); END IF;
 -- Preserve every event, but do not regress a terminal delivery or overwrite newer evidence.
 IF (n.last_provider_at IS NULL OR p_at>=n.last_provider_at) AND n.state<>'COMPLAINED'
 AND (n.state NOT IN ('DELIVERED','BOUNCED','FAILED') OR p_state='COMPLAINED') THEN
  UPDATE public.platform_team_notifications SET state=p_state,last_provider_at=p_at,updated_at=now() WHERE id=n.id;
 END IF;
 RETURN jsonb_build_object('recorded',true);
END $$;
COMMIT;
