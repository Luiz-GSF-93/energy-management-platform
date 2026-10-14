BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.platform_team_password_requests ADD COLUMN reservation_deadline timestamptz, ADD COLUMN provider_started_at timestamptz, ADD COLUMN resolution_reason text;
ALTER TABLE public.platform_team_password_requests DROP CONSTRAINT platform_team_password_requests_state_check;
ALTER TABLE public.platform_team_password_requests ADD CONSTRAINT platform_team_password_requests_state_check CHECK(state IN('RESERVED','ACCEPTED','FAILED','UNKNOWN','NOT_SENT'));
ALTER TABLE public.platform_team_password_events DROP CONSTRAINT platform_team_password_events_state_check;
ALTER TABLE public.platform_team_password_events ADD CONSTRAINT platform_team_password_events_state_check CHECK(state IN('RESERVED','PROVIDER_STARTED','ACCEPTED','FAILED','UNKNOWN','NOT_SENT'));
CREATE OR REPLACE FUNCTION public.reserve_platform_team_password(p_actor uuid,p_user uuid,p_key uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.platform_team_members%ROWTYPE; u auth.users%ROWTYPE; old public.platform_team_password_requests%ROWTYPE; mail text; n uuid; purpose text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
 PERFORM public.platform_team_owner(p_actor);
 IF p_key IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM public.platform_team_members WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND OR NOT t.active THEN RAISE EXCEPTION 'Active team identity required' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.platform_team_password_requests WHERE request_key=p_key;
 IF FOUND THEN
  IF old.actor_id<>p_actor OR old.user_id<>p_user THEN RAISE EXCEPTION 'Request mismatch' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('id',old.id,'created',false,'state',old.state);
 END IF;
 IF EXISTS(SELECT 1 FROM public.platform_team_password_requests WHERE user_id=p_user AND (state IN('RESERVED','UNKNOWN') OR created_at>now()-interval '10 minutes')) THEN
  RAISE EXCEPTION 'Pending request or cooldown' USING ERRCODE='PT409'; END IF;
 SELECT * INTO u FROM auth.users WHERE id=p_user;
 SELECT lower(email) INTO mail FROM public.user_profiles WHERE user_id=p_user;
 IF u.id IS NULL OR lower(u.email) IS DISTINCT FROM mail THEN RAISE EXCEPTION 'Identity mismatch' USING ERRCODE='22023'; END IF;
 purpose:=CASE WHEN u.email_confirmed_at IS NOT NULL THEN 'RECOVERY' WHEN u.invited_at IS NOT NULL THEN 'INVITE' ELSE NULL END;
 IF purpose IS NULL THEN RAISE EXCEPTION 'Existing invited identity required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.platform_team_password_requests(actor_id,user_id,request_key,purpose,recipient,revision,reason)
 VALUES(p_actor,p_user,p_key,purpose,mail,t.revision,btrim(p_reason)) RETURNING id INTO n;
 INSERT INTO public.platform_team_password_events(request_id,actor_id,state) VALUES(n,p_actor,'RESERVED');
 RETURN jsonb_build_object('id',n,'created',true,'state','RESERVED','purpose',purpose,'email',mail);
END $$;
CREATE OR REPLACE FUNCTION public.read_platform_team_password(p_actor uuid,p_user uuid,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.platform_team_members%ROWTYPE; u auth.users%ROWTYPE; mail text; rows jsonb; total bigint;
BEGIN
 PERFORM public.platform_team_owner(p_actor);
 IF p_offset<0 OR p_offset>25000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM public.platform_team_members WHERE user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'Team identity required' USING ERRCODE='22023'; END IF;
 SELECT * INTO u FROM auth.users WHERE id=p_user;
 SELECT lower(email) INTO mail FROM public.user_profiles WHERE user_id=p_user;
 IF u.id IS NULL OR lower(u.email) IS DISTINCT FROM mail THEN RAISE EXCEPTION 'Identity mismatch' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO total FROM public.platform_team_password_requests WHERE user_id=p_user;
 SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC),'[]') INTO rows FROM(
 SELECT r.id,r.purpose,r.reason,r.actor_id,r.created_at,r.finished_at,r.reservation_deadline,r.provider_started_at,r.resolution_reason,
 CASE WHEN r.state='RESERVED' AND r.created_at<now()-interval '5 minutes' THEN 'UNKNOWN' ELSE r.state END AS state,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('state',e.state,'at',e.created_at) ORDER BY e.created_at,e.id),'[]') FROM public.platform_team_password_events e WHERE e.request_id=r.id) AS events
 FROM public.platform_team_password_requests r WHERE r.user_id=p_user ORDER BY r.created_at DESC,r.id DESC LIMIT 25 OFFSET p_offset) x;
 RETURN jsonb_build_object('email',mail,'active',t.active,'confirmedAt',u.email_confirmed_at,'invitedAt',u.invited_at,'lastSignInAt',u.last_sign_in_at,
 'purpose',CASE WHEN u.email_confirmed_at IS NOT NULL THEN 'RECOVERY' WHEN u.invited_at IS NOT NULL THEN 'INVITE' ELSE NULL END,'rows',rows,'total',total);
END $$;
CREATE OR REPLACE FUNCTION public.finish_platform_team_password(p_actor uuid,p_id uuid,p_state text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.platform_team_password_requests%ROWTYPE;
BEGIN
 IF p_state NOT IN('ACCEPTED','FAILED','UNKNOWN','NOT_SENT') THEN RAISE EXCEPTION 'Invalid state' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.platform_team_password_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.actor_id<>p_actor THEN RAISE EXCEPTION 'Request mismatch' USING ERRCODE='42501'; END IF;
 IF p_state='NOT_SENT' AND (r.provider_started_at IS NOT NULL OR r.reservation_deadline IS NULL) THEN RAISE EXCEPTION 'Uncertain provider state' USING ERRCODE='PT409'; END IF;
 IF p_state IN('ACCEPTED','FAILED') AND r.reservation_deadline IS NOT NULL AND r.provider_started_at IS NULL THEN RAISE EXCEPTION 'Provider checkpoint required' USING ERRCODE='PT409'; END IF;
 -- Recording a reserved result remains possible if the actor lost Owner access during the call.
 IF r.state<>'RESERVED' THEN RETURN jsonb_build_object('id',r.id,'state',r.state); END IF;
 UPDATE public.platform_team_password_requests SET state=p_state,finished_at=now() WHERE id=p_id;
 INSERT INTO public.platform_team_password_events(request_id,actor_id,state) VALUES(p_id,p_actor,p_state);
 RETURN jsonb_build_object('id',p_id,'state',p_state);
END $$;

CREATE FUNCTION public.reserve_platform_team_password_expiring(p_actor uuid,p_user uuid,p_key uuid,p_reason text,p_deadline timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='3s' SET statement_timeout='8s' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
 PERFORM public.platform_team_owner(p_actor);
 IF p_deadline IS NULL OR p_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Expired reservation' USING ERRCODE='PT408'; END IF;
 IF p_deadline>clock_timestamp()+interval '60 seconds' THEN RAISE EXCEPTION 'Invalid deadline' USING ERRCODE='22023'; END IF;
 result:=public.reserve_platform_team_password(p_actor,p_user,p_key,p_reason);
 IF coalesce((result->>'created')::boolean,false) THEN
  IF p_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Expired reservation' USING ERRCODE='PT408'; END IF;
  UPDATE public.platform_team_password_requests SET reservation_deadline=p_deadline WHERE id=(result->>'id')::uuid;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.start_platform_team_password(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='3s' SET statement_timeout='8s' AS $$
DECLARE r public.platform_team_password_requests%ROWTYPE; t public.platform_team_members%ROWTYPE; u auth.users%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
 PERFORM public.platform_team_owner(p_actor);
 SELECT * INTO r FROM public.platform_team_password_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.actor_id<>p_actor THEN RAISE EXCEPTION 'Request mismatch' USING ERRCODE='42501'; END IF;
 IF r.state<>'RESERVED' OR r.provider_started_at IS NOT NULL THEN RETURN jsonb_build_object('started',false); END IF;
 IF r.reservation_deadline IS NULL OR r.reservation_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Expired call' USING ERRCODE='PT408'; END IF;
 SELECT * INTO t FROM public.platform_team_members WHERE user_id=r.user_id;
 SELECT * INTO u FROM auth.users WHERE id=r.user_id;
 IF NOT coalesce(t.active,false) OR t.revision<>r.revision OR lower(u.email) IS DISTINCT FROM r.recipient OR (CASE WHEN u.email_confirmed_at IS NOT NULL THEN 'RECOVERY' WHEN u.invited_at IS NOT NULL THEN 'INVITE' ELSE '' END)<>r.purpose THEN RAISE EXCEPTION 'Identity changed' USING ERRCODE='22023'; END IF;
 UPDATE public.platform_team_password_requests SET provider_started_at=clock_timestamp() WHERE id=p_id;
 INSERT INTO public.platform_team_password_events(request_id,actor_id,state) VALUES(p_id,p_actor,'PROVIDER_STARTED');
 RETURN jsonb_build_object('started',true);
END $$;
ALTER FUNCTION public.reserve_platform_team_password(uuid,uuid,uuid,text) SET lock_timeout='3s';
ALTER FUNCTION public.reserve_platform_team_password(uuid,uuid,uuid,text) SET statement_timeout='8s';
ALTER FUNCTION public.read_platform_team_password(uuid,uuid,integer) SET lock_timeout='3s';
ALTER FUNCTION public.read_platform_team_password(uuid,uuid,integer) SET statement_timeout='8s';
ALTER FUNCTION public.finish_platform_team_password(uuid,uuid,text) SET lock_timeout='3s';
ALTER FUNCTION public.finish_platform_team_password(uuid,uuid,text) SET statement_timeout='8s';
REVOKE ALL ON FUNCTION public.reserve_platform_team_password_expiring(uuid,uuid,uuid,text,timestamptz),public.start_platform_team_password(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_platform_team_password_expiring(uuid,uuid,uuid,text,timestamptz),public.start_platform_team_password(uuid,uuid) TO service_role;
COMMIT;
