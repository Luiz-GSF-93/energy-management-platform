-- Private atomic work commands. Completion remains unavailable until the
-- evidence adapter is installed. No roles, customers or units are changed.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE INDEX acl_expired_work ON public.acl_admission_work_sessions(organization_id,heartbeat_at) WHERE ended_at IS NULL;

-- Authorization must be unambiguous even for malformed legacy role data.
CREATE FUNCTION public.acl_work_authority(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;r record;
BEGIN
 access:=public.acl_assert_actor(p_org,p_actor,p_role,p_platform,true);
 IF NOT p_platform AND ((SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND user_id::text=p_actor AND upper(status)='ACTIVE')<>1
 OR NOT EXISTS(SELECT 1 FROM public.roles WHERE id::text=p_role AND organization_id=p_org AND jsonb_typeof(permissions)='array'))
 THEN RAISE EXCEPTION 'Ambiguous ACL membership' USING ERRCODE='42501';END IF;
 SELECT a.customer_id INTO r FROM public.acl_admissions a
 JOIN public.customers c ON c.id=a.customer_id AND c.organization_id=a.organization_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 JOIN public.consumer_units u ON u.id=a.consumer_unit_id AND u.customer_id=a.customer_id AND u.organization_id=a.organization_id AND u.status='ACTIVE'
 WHERE a.organization_id=p_org AND a.id=p_id AND (access->>'customerId' IS NULL OR a.customer_id=access->>'customerId');
 IF NOT FOUND THEN RAISE EXCEPTION 'ACL process unavailable' USING ERRCODE='P4102';END IF;
 RETURN access;
END $$;

-- This system-only reconciler runs under the organization work lock. It may
-- stop stale leases in that organization; it never exposes their contents.
CREATE FUNCTION public.acl_expire_work(p_org text,p_now timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s record;r record;v jsonb;stage jsonb;pos integer;ms bigint;ev jsonb;req uuid;
BEGIN
 FOR s IN SELECT * FROM public.acl_admission_work_sessions WHERE organization_id=p_org AND ended_at IS NULL
   AND heartbeat_at<=p_now-interval '90 seconds' ORDER BY admission_id,stage_key FOR UPDATE LOOP
  SELECT * INTO STRICT r FROM public.acl_admissions WHERE organization_id=p_org AND id=s.admission_id FOR UPDATE;
  SELECT value,(ordinality-1)::integer INTO stage,pos FROM jsonb_array_elements(r.state->'stages') WITH ORDINALITY WHERE value->>'key'=s.stage_key;
  IF stage->>'status'<>'RUNNING' OR stage->'active'->>'actorId' IS DISTINCT FROM s.actor_id OR r.status='COMPLETED'
  THEN RAISE EXCEPTION 'ACL session invariant violated' USING ERRCODE='23514';END IF;
  ms:=floor(extract(epoch FROM s.heartbeat_at-s.started_at)*1000)::bigint;
  stage:=(stage-'active')||jsonb_build_object('status','PAUSED','elapsedMs',(stage->>'elapsedMs')::bigint+ms);
  req:=gen_random_uuid();
  ev:=jsonb_build_object('revision',r.revision+1,'requestId',req,'action','INTERRUPTED','actorId',s.actor_id,
   'actorName',r.state->'stages'->pos->'active'->>'actorName','at',(extract(epoch FROM p_now)*1000)::bigint,
   'stageKey',s.stage_key,'reason','Conexão interrompida; retome a atividade.','elapsedMs',stage->'elapsedMs');
  v:=jsonb_set(r.state,ARRAY['stages',pos::text],stage)||jsonb_build_object('revision',r.revision+1,'events',(r.state->'events')||jsonb_build_array(ev));
  UPDATE public.acl_admission_work_sessions SET ended_at=heartbeat_at,reason='INTERRUPTED' WHERE id=s.id;
  UPDATE public.acl_admissions SET state=v,revision=r.revision+1,updated_at=p_now WHERE id=r.id AND organization_id=p_org;
  INSERT INTO public.acl_admission_events(organization_id,admission_id,revision,request_id,request_payload,action,actor_id,snapshot,recorded_at)
   VALUES(p_org,r.id,r.revision+1,req,jsonb_build_object('system','lease-expiry','sessionId',s.id),'INTERRUPTED',s.actor_id,ev,p_now);
 END LOOP;
END $$;

CREATE FUNCTION public.acl_work_command(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_request uuid,p_revision integer,
 p_stage text,p_action text,p_pause text DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;r record;old_event record;session_row record;stage jsonb;pos integer;payload jsonb;v jsonb;ev jsonb;instant timestamptz;now_ms bigint;
BEGIN
 IF p_id IS NULL OR p_request IS NULL OR p_revision IS NULL OR p_revision<1 OR p_stage IS NULL
 OR p_stage NOT IN ('registration','invoices','feasibility','modality','contracts','termination','metering','custody','technical','contract-registration','validation','supply')
 OR p_action IS NULL OR p_action NOT IN ('START','PAUSE','RESUME') OR p_reason IS NOT NULL AND length(p_reason)>500
 OR (p_action='PAUSE' AND (p_pause IS NULL OR p_pause NOT IN ('AWAITING_CUSTOMER','ENDING_ACTIVITY','OTHER')
   OR p_pause='OTHER' AND (p_reason IS NULL OR length(btrim(p_reason))<10)))
 OR (p_action<>'PAUSE' AND (p_pause IS NOT NULL OR p_reason IS NOT NULL))
 THEN RAISE EXCEPTION 'Invalid ACL work command' USING ERRCODE='22023';END IF;
 -- Shared with evidence/closure adapters: acquire this lock before process locks.
 PERFORM pg_advisory_xact_lock(hashtextextended('acl-work:'||p_org,0));
 access:=public.acl_work_authority(p_org,p_actor,p_role,p_platform,p_id);
 instant:=date_trunc('milliseconds',clock_timestamp());now_ms:=floor(extract(epoch FROM instant)*1000)::bigint;
 payload:=jsonb_build_object('admissionId',p_id,'actorId',p_actor,'revision',p_revision,'stageKey',p_stage,'action',p_action,'pauseReason',p_pause,'reason',p_reason);
 SELECT * INTO old_event FROM public.acl_admission_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF old_event.request_payload<>payload THEN RAISE EXCEPTION 'ACL request already used' USING ERRCODE='40001';END IF;
  SELECT state INTO v FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id;
  RETURN jsonb_build_object('ok',true,'admission',v,'replayed',true);
 END IF;
 PERFORM public.acl_expire_work(p_org,instant);
 SELECT * INTO STRICT r FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF now_ms<(r.state->>'createdAt')::bigint OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.state->'events') e WHERE (e->>'at')::bigint>now_ms)
 THEN RAISE EXCEPTION 'ACL server clock moved backwards' USING ERRCODE='23514';END IF;
 -- Return conflicts instead of raising: expiry must commit even when a stale
 -- revision is rejected. The API maps this envelope to HTTP 409 afterwards.
 IF r.revision<>p_revision THEN RETURN jsonb_build_object('ok',false,'code','CONFLICT','admission',r.state);END IF;
 IF r.status='COMPLETED' THEN RETURN jsonb_build_object('ok',false,'code','LOCKED','admission',r.state);END IF;
 SELECT value,(ordinality-1)::integer INTO stage,pos FROM jsonb_array_elements(r.state->'stages') WITH ORDINALITY WHERE value->>'key'=p_stage;
 IF stage IS NULL THEN RAISE EXCEPTION 'ACL stage invariant violated' USING ERRCODE='23514';END IF;
 IF p_action IN ('START','RESUME') THEN
  IF stage->>'status'<>(CASE p_action WHEN 'START' THEN 'NOT_STARTED' ELSE 'PAUSED' END)
   OR EXISTS(SELECT 1 FROM public.acl_admission_work_sessions WHERE organization_id=p_org AND actor_id=p_actor AND ended_at IS NULL)
   OR EXISTS(SELECT 1 FROM public.acl_admission_work_sessions WHERE admission_id=p_id AND stage_key=p_stage AND ended_at IS NULL)
  THEN RETURN jsonb_build_object('ok',false,'code','LOCKED','admission',r.state);END IF;
  INSERT INTO public.acl_admission_work_sessions(organization_id,admission_id,stage_key,actor_id,started_at,heartbeat_at)
   VALUES(p_org,p_id,p_stage,p_actor,instant,instant);
  stage:=stage||jsonb_build_object('status','RUNNING','active',jsonb_build_object('actorId',p_actor,'actorName',access->>'actorName','startedAt',now_ms,'heartbeatAt',now_ms));
 ELSE
  SELECT * INTO session_row FROM public.acl_admission_work_sessions WHERE organization_id=p_org AND admission_id=p_id AND stage_key=p_stage AND ended_at IS NULL FOR UPDATE;
  IF NOT FOUND OR stage->>'status'<>'RUNNING' OR session_row.actor_id<>p_actor THEN RETURN jsonb_build_object('ok',false,'code','LOCKED','admission',r.state);END IF;
  IF instant<session_row.heartbeat_at THEN RAISE EXCEPTION 'ACL server clock moved backwards' USING ERRCODE='23514';END IF;
  stage:=(stage-'active')||jsonb_build_object('status','PAUSED','elapsedMs',(stage->>'elapsedMs')::bigint+floor(extract(epoch FROM instant-session_row.started_at)*1000)::bigint);
  UPDATE public.acl_admission_work_sessions SET ended_at=instant,reason=p_pause WHERE id=session_row.id;
 END IF;
 ev:=jsonb_build_object('revision',r.revision+1,'requestId',p_request,'action',p_action,'actorId',p_actor,'actorName',access->>'actorName',
   'at',now_ms,'stageKey',p_stage,'elapsedMs',stage->'elapsedMs','pauseReason',p_pause,'reason',p_reason);
 v:=jsonb_set(r.state,ARRAY['stages',pos::text],stage)||jsonb_build_object('status','IN_PROGRESS','revision',r.revision+1,'events',(r.state->'events')||jsonb_build_array(ev));
 UPDATE public.acl_admissions SET state=v,revision=r.revision+1,status='IN_PROGRESS',updated_at=instant WHERE organization_id=p_org AND id=p_id;
 INSERT INTO public.acl_admission_events(organization_id,admission_id,revision,request_id,request_payload,action,actor_id,snapshot,recorded_at)
 VALUES(p_org,p_id,r.revision+1,p_request,payload,p_action,p_actor,ev,instant);
 RETURN jsonb_build_object('ok',true,'admission',v,'replayed',false);
END $$;

CREATE FUNCTION public.acl_work_heartbeat(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_stage text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r record;s record;instant timestamptz;
BEGIN
 IF p_id IS NULL OR p_stage IS NULL THEN RAISE EXCEPTION 'Invalid ACL heartbeat' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('acl-work:'||p_org,0));
 PERFORM public.acl_work_authority(p_org,p_actor,p_role,p_platform,p_id);
 instant:=date_trunc('milliseconds',clock_timestamp());
 PERFORM public.acl_expire_work(p_org,instant);
 SELECT * INTO STRICT r FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 SELECT * INTO s FROM public.acl_admission_work_sessions WHERE organization_id=p_org AND admission_id=p_id AND stage_key=p_stage AND ended_at IS NULL FOR UPDATE;
 IF NOT FOUND OR s.actor_id<>p_actor OR r.status='COMPLETED' THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
 IF instant<s.heartbeat_at THEN RAISE EXCEPTION 'ACL server clock moved backwards' USING ERRCODE='23514';END IF;
 UPDATE public.acl_admission_work_sessions SET heartbeat_at=instant WHERE id=s.id;
 -- Heartbeats never increment workflow revision, duplicate the event history,
 -- rewrite the admission JSON, or appear as work-performance events.
 RETURN jsonb_build_object('ok',true,'confirmedAt',instant,'revision',r.revision);
END $$;
REVOKE ALL ON FUNCTION public.acl_work_authority(text,text,text,boolean,uuid),public.acl_expire_work(text,timestamptz),
 public.acl_work_command(text,text,text,boolean,uuid,uuid,integer,text,text,text,text),public.acl_work_heartbeat(text,text,text,boolean,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_work_command(text,text,text,boolean,uuid,uuid,integer,text,text,text,text),public.acl_work_heartbeat(text,text,text,boolean,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
