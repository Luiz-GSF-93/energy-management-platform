BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
-- Explicit Owner preparation for an existing, audited grant. No automatic backfill.
CREATE FUNCTION public.prepare_platform_team_notification(p_actor uuid,p_user uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.platform_team_members%ROWTYPE; a public.platform_team_audit%ROWTYPE;
 n uuid; mail text; label text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
 PERFORM public.platform_team_owner(p_actor);
 IF p_user IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 20 AND 1000 THEN
  RAISE EXCEPTION 'Identity and justification required' USING ERRCODE='22023';
 END IF;
 SELECT * INTO t FROM public.platform_team_members WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND OR NOT t.active THEN RAISE EXCEPTION 'Active assignment required' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.platform_team_audit WHERE target_id=t.user_id
 AND changes#>>'{after,active}'='true' AND changes#>>'{after,profile}'=t.profile
 AND (changes#>>'{before,active}' IS DISTINCT FROM 'true' OR changes#>>'{before,profile}' IS DISTINCT FROM changes#>>'{after,profile}')
 AND (changes#>>'{after,revision}')::integer BETWEEN 1 AND t.revision
 ORDER BY created_at DESC,id DESC LIMIT 1;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Audited grant required' USING ERRCODE='22023'; END IF;
 SELECT id INTO n FROM public.platform_team_notifications WHERE audit_id=a.id;
 IF n IS NOT NULL THEN RETURN jsonb_build_object('id',n,'created',false); END IF;
 SELECT lower(p.email),btrim(coalesce(t.first_name,'')||' '||coalesce(t.last_name,'')) INTO mail,label
 FROM public.user_profiles p JOIN auth.users u ON u.id=p.user_id AND lower(u.email)=lower(p.email) WHERE p.user_id=t.user_id;
 IF mail IS NULL OR label='' THEN RAISE EXCEPTION 'Identity not confirmed' USING ERRCODE='22023'; END IF;
 INSERT INTO public.platform_team_notifications(audit_id,user_id,revision,profile,recipient,display_name,validated_at)
 VALUES(a.id,t.user_id,(a.changes#>>'{after,revision}')::integer,t.profile,mail,label,a.created_at) RETURNING id INTO n;
 INSERT INTO public.platform_team_notification_events(notification_id,event_key,state,source,actor_id,reason)
 VALUES(n,'owner-prepare:'||a.id,'PENDING','OWNER',p_actor,btrim(p_reason));
 RETURN jsonb_build_object('id',n,'created',true);
END $$;
REVOKE ALL ON FUNCTION public.prepare_platform_team_notification(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_platform_team_notification(uuid,uuid,text) TO service_role;
COMMIT;
