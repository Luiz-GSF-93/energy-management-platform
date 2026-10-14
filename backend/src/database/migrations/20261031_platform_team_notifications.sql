BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
-- No backfill: previous assignments and invitations remain untouched.
CREATE TABLE public.platform_team_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), audit_id uuid NOT NULL UNIQUE REFERENCES public.platform_team_audit(id),
 user_id uuid NOT NULL REFERENCES auth.users(id), revision integer NOT NULL CHECK(revision>0),
 profile text NOT NULL CHECK(profile IN ('OWNER','ADMINISTRATOR','FINANCE','SUPPORT')),
 recipient text NOT NULL, display_name text NOT NULL, validated_at timestamptz NOT NULL,
 template_id text NOT NULL DEFAULT '84f37309-be6f-4c5f-aed2-499d562124cb',
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SENDING','ACCEPTED','DELIVERED','DELAYED','FAILED','BOUNCED','COMPLAINED','UNKNOWN')),
 provider_id text UNIQUE, lease_id uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 payload jsonb, template_version text, template_hash text, last_provider_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,revision), CHECK(length(recipient) BETWEEN 3 AND 254), CHECK(length(display_name) BETWEEN 1 AND 201)
);
CREATE TABLE public.platform_team_notification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notification_id uuid NOT NULL REFERENCES public.platform_team_notifications(id),
 event_key text NOT NULL UNIQUE, state text NOT NULL, source text NOT NULL CHECK(source IN ('GRANT','WORKER','WEBHOOK','OWNER')),
 actor_id uuid REFERENCES auth.users(id), reason text, provider_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(state IN ('PENDING','SENDING','ACCEPTED','DELIVERED','DELAYED','FAILED','BOUNCED','COMPLAINED','UNKNOWN')),
 CHECK(reason IS NULL OR length(reason)<=1000)
);
CREATE INDEX platform_team_notifications_queue ON public.platform_team_notifications(state,created_at,id);
CREATE INDEX platform_team_notification_events_history ON public.platform_team_notification_events(notification_id,created_at,id);
ALTER TABLE public.platform_team_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_team_notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_team_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.platform_team_notification_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_team_notifications,public.platform_team_notification_events FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.platform_team_notification_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'Immutable notification history' USING ERRCODE='42501';
END $$;
CREATE TRIGGER platform_team_notification_events_immutable BEFORE UPDATE OR DELETE ON public.platform_team_notification_events
FOR EACH ROW EXECUTE FUNCTION public.platform_team_notification_immutable();

CREATE FUNCTION public.platform_team_notification_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n uuid; t public.platform_team_members%ROWTYPE; mail text; label text;
BEGIN
 -- The AFTER audit insert participates in the grant transaction, including deferred Owner bounds.
 IF NEW.changes#>>'{after,active}' IS DISTINCT FROM 'true' OR
 (NEW.changes#>>'{before,active}'='true' AND NEW.changes#>>'{before,profile}'=NEW.changes#>>'{after,profile}') THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.platform_team_members WHERE user_id=NEW.target_id;
 IF NOT FOUND OR NOT t.active OR t.revision IS DISTINCT FROM (NEW.changes#>>'{after,revision}')::integer
 OR t.profile IS DISTINCT FROM NEW.changes#>>'{after,profile}' THEN RAISE EXCEPTION 'Grant notification integrity'; END IF;
 SELECT lower(p.email),btrim(coalesce(t.first_name,'')||' '||coalesce(t.last_name,'')) INTO mail,label
 FROM public.user_profiles p JOIN auth.users a ON a.id=p.user_id AND lower(a.email)=lower(p.email) WHERE p.user_id=t.user_id;
 IF mail IS NULL OR label='' THEN RAISE EXCEPTION 'Notification identity unavailable' USING ERRCODE='P4004'; END IF;
 INSERT INTO public.platform_team_notifications(audit_id,user_id,revision,profile,recipient,display_name,validated_at)
 VALUES(NEW.id,t.user_id,t.revision,t.profile,mail,label,NEW.created_at) RETURNING id INTO n;
 INSERT INTO public.platform_team_notification_events(notification_id,event_key,state,source,actor_id,reason)
 VALUES(n,'grant:'||NEW.id,'PENDING','GRANT',NEW.actor_id,'Acesso validado; aviso enfileirado na mesma transação.');
 RETURN NEW;
END $$;
CREATE TRIGGER platform_team_notification_grant AFTER INSERT ON public.platform_team_audit
FOR EACH ROW EXECUTE FUNCTION public.platform_team_notification_enqueue();

CREATE FUNCTION public.read_platform_team_notifications(p_actor uuid,p_id uuid DEFAULT NULL,p_offset integer DEFAULT 0,p_state text DEFAULT NULL,p_profile text DEFAULT NULL,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_user uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows jsonb; total bigint; events jsonb; history_total bigint;
BEGIN
 PERFORM public.platform_team_owner(p_actor);
 IF p_offset IS NULL OR p_offset<0 OR p_offset>250000 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to) THEN RAISE EXCEPTION 'Invalid page/period' USING ERRCODE='22023'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT (to_jsonb(n)-'lease_id'-'lease_until')||jsonb_build_object('state',CASE WHEN state='SENDING' AND lease_until<now() THEN 'UNKNOWN' ELSE state END) INTO rows FROM public.platform_team_notifications n WHERE id=p_id;
  IF rows IS NULL THEN RAISE EXCEPTION 'Notification unavailable' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(j),'[]'::jsonb) INTO events FROM (SELECT to_jsonb(e) j FROM public.platform_team_notification_events e WHERE notification_id=p_id ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET p_offset) s;
  SELECT count(*) INTO history_total FROM public.platform_team_notification_events WHERE notification_id=p_id;
  RETURN jsonb_build_object('notification',rows,'history',events,'historyTotal',history_total);
 END IF;
 SELECT count(*) INTO total FROM public.platform_team_notifications n WHERE (p_user IS NULL OR user_id=p_user) AND (p_state IS NULL OR (CASE WHEN state='SENDING' AND lease_until<now() THEN 'UNKNOWN' ELSE state END)=p_state) AND (p_profile IS NULL OR profile=p_profile) AND (p_from IS NULL OR created_at>=p_from) AND (p_to IS NULL OR created_at<=p_to);
 SELECT coalesce(jsonb_agg(j),'[]'::jsonb) INTO rows FROM (SELECT jsonb_build_object('id',n.id,'user_id',n.user_id,'revision',n.revision,'profile',n.profile,'recipient',n.recipient,'display_name',n.display_name,'state',CASE WHEN n.state='SENDING' AND n.lease_until<now() THEN 'UNKNOWN' ELSE n.state END,'created_at',n.created_at,'provider_id',n.provider_id) j FROM public.platform_team_notifications n WHERE (p_user IS NULL OR user_id=p_user) AND (p_state IS NULL OR (CASE WHEN state='SENDING' AND lease_until<now() THEN 'UNKNOWN' ELSE state END)=p_state) AND (p_profile IS NULL OR profile=p_profile) AND (p_from IS NULL OR created_at>=p_from) AND (p_to IS NULL OR created_at<=p_to) ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET p_offset) s;
 RETURN jsonb_build_object('rows',rows,'total',total);
END $$;

CREATE FUNCTION public.claim_platform_team_notification(p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n public.platform_team_notifications%ROWTYPE;
BEGIN
 IF p_lease IS NULL THEN RAISE EXCEPTION 'Lease required' USING ERRCODE='22023'; END IF;
 -- Expiry records uncertainty; it never makes a possibly sent message pending again.
 FOR n IN SELECT * FROM public.platform_team_notifications WHERE state='SENDING' AND lease_until<now() FOR UPDATE SKIP LOCKED LOOP
  UPDATE public.platform_team_notifications SET state='UNKNOWN',updated_at=now() WHERE id=n.id;
  INSERT INTO public.platform_team_notification_events(notification_id,event_key,state,source,reason) VALUES(n.id,'expired:'||n.lease_id,'UNKNOWN','WORKER','Reserva expirou; reconferência obrigatória, sem reenvio automático.');
 END LOOP;
 SELECT * INTO n FROM public.platform_team_notifications WHERE state='PENDING' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Old queued profile notices must not describe access that has since changed.
 IF NOT EXISTS(SELECT 1 FROM public.platform_team_members t JOIN public.user_profiles p ON p.user_id=t.user_id JOIN auth.users a ON a.id=t.user_id WHERE t.user_id=n.user_id AND t.active AND t.profile=n.profile AND lower(p.email)=n.recipient AND lower(a.email)=n.recipient) THEN
  UPDATE public.platform_team_notifications SET state='FAILED',updated_at=now() WHERE id=n.id;
  INSERT INTO public.platform_team_notification_events(notification_id,event_key,state,source,reason) VALUES(n.id,'obsolete:'||n.id,'FAILED','WORKER','Acesso ou identidade mudou; envio bloqueado.');
  RETURN NULL;
 END IF;
 UPDATE public.platform_team_notifications SET state='SENDING',lease_id=p_lease,lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() WHERE id=n.id;
 INSERT INTO public.platform_team_notification_events(notification_id,event_key,state,source,reason) VALUES(n.id,'claim:'||p_lease,'SENDING','WORKER','Reserva persistida antes do provedor.');
 RETURN to_jsonb(n)||jsonb_build_object('lease_id',p_lease);
END $$;

CREATE FUNCTION public.stage_platform_team_notification(p_id uuid,p_lease uuid,p_payload jsonb,p_version text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n public.platform_team_notifications%ROWTYPE;
BEGIN
 SELECT * INTO n FROM public.platform_team_notifications WHERE id=p_id FOR UPDATE;
 IF n.id IS NULL OR n.state<>'SENDING' OR n.lease_id IS DISTINCT FROM p_lease OR n.lease_until<=now() OR n.payload IS NOT NULL THEN RAISE EXCEPTION 'Stale stage' USING ERRCODE='40001'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>150000 OR p_version IS NULL OR length(p_version) NOT BETWEEN 1 AND 100 OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
 OR p_payload->>'from' IS DISTINCT FROM 'EnergyOS <nao-responda@notificacoes.expertenergy.com.br>' OR p_payload->>'subject' IS DISTINCT FROM 'Seu acesso à equipe da plataforma — EnergyOS'
 OR p_payload->'to' IS DISTINCT FROM jsonb_build_array(n.recipient) OR length(coalesce(p_payload->>'html',''))=0 THEN RAISE EXCEPTION 'Invalid preserved payload' USING ERRCODE='22023'; END IF;
 UPDATE public.platform_team_notifications SET payload=p_payload,template_version=p_version,template_hash=p_hash,updated_at=now() WHERE id=p_id;
 RETURN jsonb_build_object('recorded',true);
END $$;

CREATE FUNCTION public.finish_platform_team_notification(p_id uuid,p_lease uuid,p_state text,p_provider text,p_payload jsonb,p_version text,p_hash text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n public.platform_team_notifications%ROWTYPE;
BEGIN
 IF p_state IS NULL OR p_state NOT IN ('ACCEPTED','FAILED','UNKNOWN') OR length(coalesce(p_reason,''))>1000 OR (p_provider IS NOT NULL AND p_provider !~ '^[0-9a-f-]{36}$')
 OR (p_payload IS NOT NULL AND octet_length(p_payload::text)>150000) OR (p_hash IS NOT NULL AND p_hash !~ '^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='22023'; END IF;
 SELECT * INTO n FROM public.platform_team_notifications WHERE id=p_id FOR UPDATE;
 IF n.id IS NULL OR n.lease_id IS DISTINCT FROM p_lease THEN RAISE EXCEPTION 'Stale reservation' USING ERRCODE='40001'; END IF;
 IF n.state NOT IN ('SENDING','UNKNOWN') THEN
  -- An authenticated webhook can arrive before the synchronous POST receipt.
  IF p_state='ACCEPTED' AND n.provider_id=p_provider AND n.payload=p_payload AND n.template_version=p_version AND n.template_hash=p_hash THEN
   INSERT INTO public.platform_team_notification_events(notification_id,event_key,state,source,reason) VALUES(p_id,'finish:'||p_lease,'ACCEPTED','WORKER',p_reason) ON CONFLICT(event_key) DO NOTHING;
   RETURN jsonb_build_object('recorded',true,'deliveryPreserved',true);
  END IF;
  RAISE EXCEPTION 'Stale reservation' USING ERRCODE='40001';
 END IF;
 IF n.state='UNKNOWN' AND p_state='FAILED' THEN RAISE EXCEPTION 'Uncertain result cannot become safe retry' USING ERRCODE='40001'; END IF;
 IF n.payload IS NOT NULL AND (p_payload IS DISTINCT FROM n.payload OR p_version IS DISTINCT FROM n.template_version OR p_hash IS DISTINCT FROM n.template_hash) THEN RAISE EXCEPTION 'Preserved payload changed' USING ERRCODE='40001'; END IF;
 IF p_state='ACCEPTED' AND (p_provider IS NULL OR p_payload IS NULL OR p_version IS NULL OR p_hash IS NULL) THEN RAISE EXCEPTION 'Receipt incomplete' USING ERRCODE='22023'; END IF;
 UPDATE public.platform_team_notifications SET state=p_state,provider_id=p_provider,payload=p_payload,template_version=p_version,template_hash=p_hash,updated_at=now() WHERE id=p_id;
 INSERT INTO public.platform_team_notification_events(notification_id,event_key,state,source,reason) VALUES(p_id,'finish:'||p_lease,p_state,'WORKER',p_reason);
 RETURN jsonb_build_object('recorded',true);
END $$;

CREATE FUNCTION public.record_platform_team_notification_delivery(p_key text,p_provider text,p_state text,p_at timestamptz,p_notification uuid DEFAULT NULL,p_recipient text DEFAULT NULL,p_from text DEFAULT NULL,p_subject text DEFAULT NULL) RETURNS jsonb
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
  IF EXISTS(SELECT 1 FROM public.platform_team_notifications WHERE state='SENDING' AND provider_id IS NULL) THEN RETURN jsonb_build_object('retry',true); END IF;
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

CREATE FUNCTION public.retry_platform_team_notification(p_actor uuid,p_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n public.platform_team_notifications%ROWTYPE;
BEGIN
 PERFORM public.platform_team_owner(p_actor);
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023'; END IF;
 SELECT * INTO n FROM public.platform_team_notifications WHERE id=p_id FOR UPDATE;
 -- Only a definitive pre-send/provider rejection, never a delivered/unknown/bounced message.
 IF n.id IS NULL OR n.state<>'FAILED' OR n.provider_id IS NOT NULL OR n.payload IS NOT NULL OR n.attempts>=3 THEN RAISE EXCEPTION 'Retry blocked; verify evidence' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_team_members t JOIN public.user_profiles p ON p.user_id=t.user_id JOIN auth.users a ON a.id=t.user_id WHERE t.user_id=n.user_id AND t.active AND t.profile=n.profile AND lower(p.email)=n.recipient AND lower(a.email)=n.recipient) THEN RAISE EXCEPTION 'Access changed; retry blocked' USING ERRCODE='40001'; END IF;
 UPDATE public.platform_team_notifications SET state='PENDING',updated_at=now() WHERE id=p_id;
 INSERT INTO public.platform_team_notification_events(notification_id,event_key,state,source,actor_id,reason) VALUES(p_id,'retry:'||gen_random_uuid(),'PENDING','OWNER',p_actor,btrim(p_reason));
 RETURN jsonb_build_object('recorded',true);
END $$;

CREATE FUNCTION public.platform_team_notification_metrics(p_actor uuid,p_month text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE profile text; states jsonb; total bigint; reservations bigint;
BEGIN
 SELECT t.profile INTO profile FROM public.platform_team_members t WHERE user_id=p_actor AND active;
 IF profile='OWNER' THEN PERFORM public.platform_team_owner(p_actor);
 ELSIF profile='FINANCE' THEN
  IF (SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE u.user_id::text=p_actor::text AND r.scope='global')<>1 OR NOT EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.user_profiles p ON p.user_id::text=u.user_id::text WHERE u.user_id::text=p_actor::text AND r.scope='global' AND r.name='platform_finance' AND r.permissions ? '699703af-10ba-43a3-8eb8-9f0d9e477498') THEN RAISE EXCEPTION 'Cost access denied' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Cost access denied' USING ERRCODE='42501'; END IF;
 IF p_month IS NULL OR p_month !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023'; END IF;
 SELECT count(*),coalesce(sum(attempts),0) INTO total,reservations FROM public.platform_team_notifications WHERE to_char(created_at AT TIME ZONE 'UTC','YYYY-MM')=p_month;
 SELECT coalesce(jsonb_object_agg(state,n),'{}'::jsonb) INTO states FROM (SELECT CASE WHEN state='SENDING' AND lease_until<now() THEN 'UNKNOWN' ELSE state END AS state,count(*) n FROM public.platform_team_notifications WHERE to_char(created_at AT TIME ZONE 'UTC','YYYY-MM')=p_month GROUP BY 1) x;
 RETURN jsonb_build_object('month',p_month,'notifications',total,'reservations',reservations,'states',states,'actualCostBrlCents',null,'costSource','NOT_CONNECTED');
END $$;

REVOKE ALL ON FUNCTION public.platform_team_notification_immutable(),public.platform_team_notification_enqueue(),public.read_platform_team_notifications(uuid,uuid,integer,text,text,timestamptz,timestamptz,uuid),public.claim_platform_team_notification(uuid),public.stage_platform_team_notification(uuid,uuid,jsonb,text,text),public.finish_platform_team_notification(uuid,uuid,text,text,jsonb,text,text,text),public.record_platform_team_notification_delivery(text,text,text,timestamptz,uuid,text,text,text),public.retry_platform_team_notification(uuid,uuid,text),public.platform_team_notification_metrics(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_platform_team_notifications(uuid,uuid,integer,text,text,timestamptz,timestamptz,uuid),public.claim_platform_team_notification(uuid),public.stage_platform_team_notification(uuid,uuid,jsonb,text,text),public.finish_platform_team_notification(uuid,uuid,text,text,jsonb,text,text,text),public.record_platform_team_notification_delivery(text,text,text,timestamptz,uuid,text,text,text),public.retry_platform_team_notification(uuid,uuid,text),public.platform_team_notification_metrics(uuid,text) TO service_role;
COMMIT;
