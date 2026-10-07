BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Preserve version-2 bodies and privileges; accept version-3 server calculations.
CREATE OR REPLACE FUNCTION public.acl_economic_study_command(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_request uuid,p_revision integer,
 p_action text,p_checked boolean,p_snapshot jsonb DEFAULT NULL,p_study uuid DEFAULT NULL,p_reason text DEFAULT NULL,p_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;r record;old_event record;study record;source jsonb;payload jsonb;v jsonb;ev jsonb;new_id uuid;instant timestamptz;now_ms bigint;digest text;next_version integer;stage jsonb;
BEGIN
 IF p_id IS NULL OR p_request IS NULL OR p_revision IS NULL OR p_revision<1 OR p_checked IS DISTINCT FROM true OR p_action IS NULL OR p_action NOT IN ('SAVE','REVIEW','REJECT')
 OR (p_action='SAVE' AND (p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'object' OR octet_length(p_snapshot::text)>60000 OR p_study IS NOT NULL OR p_hash IS NOT NULL OR p_reason IS NOT NULL))
 OR (p_action<>'SAVE' AND (p_snapshot IS NOT NULL OR p_study IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 20 AND 1000 OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$'))
 THEN RAISE EXCEPTION 'Invalid scenario command' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('acl-work:'||p_org,0));
 access:=public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,true,p_action<>'SAVE');
 payload:=jsonb_build_object('admissionId',p_id,'actorId',p_actor,'revision',p_revision,'action',p_action,'snapshot',p_snapshot,'studyId',p_study,'reason',p_reason,'hash',p_hash,'checked',p_checked);
 SELECT * INTO old_event FROM public.acl_admission_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF old_event.request_payload<>payload THEN RAISE EXCEPTION 'Scenario request changed' USING ERRCODE='40001';END IF;
  SELECT state INTO v FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id;
  RETURN jsonb_build_object('ok',true,'admission',v,'studyId',old_event.snapshot->'studyId','replayed',true);
 END IF;
 instant:=date_trunc('milliseconds',clock_timestamp());now_ms:=floor(extract(epoch FROM instant)*1000)::bigint;
 PERFORM public.acl_expire_work(p_org,instant);
 SELECT * INTO STRICT r FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF r.revision<>p_revision THEN RETURN jsonb_build_object('ok',false,'code','CONFLICT');END IF;
 IF r.status='COMPLETED' THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
 IF now_ms<(r.state->>'createdAt')::bigint OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.state->'events') x WHERE (x->>'at')::bigint>now_ms)
 THEN RAISE EXCEPTION 'Clock moved backwards' USING ERRCODE='23514';END IF;
 SELECT value INTO stage FROM jsonb_array_elements(r.state->'stages') WHERE value->>'key'='feasibility';
 IF stage->>'status'<>'RUNNING' THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
 IF p_action='SAVE' THEN
  IF stage->'active'->>'actorId' IS DISTINCT FROM p_actor THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
  IF NOT coalesce(p_snapshot-ARRAY['schemaVersion','source','result']='{}'::jsonb AND p_snapshot->>'schemaVersion'='acl-economic-study/1'
   AND p_snapshot->'result'->>'formulaVersion' IN ('acl-supplier-preview/2','acl-supplier-preview/3') AND p_snapshot->'result'->'partial'='true'::jsonb
   AND p_snapshot->'result'->'totalAclCost'='null'::jsonb AND p_snapshot->'result'->'savings'='null'::jsonb AND p_snapshot->'result'->'roi'='null'::jsonb
   AND p_snapshot->'result'->'payback'='null'::jsonb AND p_snapshot->'result'->'variableFee'='null'::jsonb
   AND jsonb_array_length(p_snapshot->'result'->'pending')>0,false)
   THEN RAISE EXCEPTION 'Only partial server scenario versions are supported' USING ERRCODE='22023';END IF;
  source:=public.acl_history_simulation_source(p_org,p_actor,p_role,p_platform,p_id,(p_snapshot->'source'->>'evidenceId')::uuid);
  -- History and document hashes are re-read under the evidence/document locks at commit time.
  IF source IS DISTINCT FROM p_snapshot->'source' OR p_snapshot->'result'->>'evidenceId' IS DISTINCT FROM source->>'evidenceId'
   OR p_snapshot->'result'->'documents' IS DISTINCT FROM source->'documents'
   THEN RAISE EXCEPTION 'Scenario source changed' USING ERRCODE='22023';END IF;
  new_id:=gen_random_uuid();digest:=encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
  SELECT coalesce(max(version),0)+1 INTO next_version FROM public.acl_economic_studies WHERE organization_id=p_org AND admission_id=p_id;
  INSERT INTO public.acl_economic_studies(id,organization_id,admission_id,customer_id,consumer_unit_id,evidence_id,version,body,payload_hash,created_by,actor_name,created_at)
   VALUES(new_id,p_org,p_id,r.customer_id,r.consumer_unit_id,(source->>'evidenceId')::uuid,next_version,p_snapshot,digest,p_actor,access->>'actorName',instant);
 ELSE
  SELECT * INTO study FROM public.acl_economic_studies WHERE organization_id=p_org AND admission_id=p_id AND id=p_study;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scenario unavailable in process' USING ERRCODE='P4102';END IF;
  IF study.created_by=p_actor THEN RAISE EXCEPTION 'Independent reviewer required' USING ERRCODE='42501';END IF;
  IF EXISTS(SELECT 1 FROM public.acl_economic_study_reviews WHERE organization_id=p_org AND study_id=p_study) THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
  IF study.payload_hash<>p_hash OR study.payload_hash<>encode(sha256(convert_to(study.body::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Scenario hash changed' USING ERRCODE='22023';END IF;
  IF p_action='REVIEW' THEN
   source:=public.acl_history_simulation_source(p_org,p_actor,p_role,p_platform,p_id,study.evidence_id);
   IF source IS DISTINCT FROM study.body->'source' THEN RAISE EXCEPTION 'Scenario source no longer current' USING ERRCODE='22023';END IF;
  END IF;
  new_id:=study.id;digest:=study.payload_hash;
  INSERT INTO public.acl_economic_study_reviews(organization_id,study_id,decision,reason,payload_hash,reviewed_by,actor_name,reviewed_at)
   VALUES(p_org,new_id,CASE p_action WHEN 'REVIEW' THEN 'REVIEWED' ELSE 'REJECTED' END,btrim(p_reason),digest,p_actor,access->>'actorName',instant);
 END IF;
 ev:=jsonb_build_object('revision',r.revision+1,'requestId',p_request,'action','STUDY_'||p_action,'actorId',p_actor,'actorName',access->>'actorName','at',now_ms,'stageKey','feasibility','studyId',new_id,'hash',digest);
 v:=r.state||jsonb_build_object('revision',r.revision+1,'events',(r.state->'events')||jsonb_build_array(ev));
 UPDATE public.acl_admissions SET state=v,revision=r.revision+1,updated_at=instant WHERE organization_id=p_org AND id=p_id;
 INSERT INTO public.acl_admission_events(organization_id,admission_id,revision,request_id,request_payload,action,actor_id,snapshot,recorded_at)
  VALUES(p_org,p_id,r.revision+1,p_request,payload,'STUDY_'||p_action,p_actor,ev,instant);
 RETURN jsonb_build_object('ok',true,'admission',v,'studyId',new_id,'replayed',false);
END $$;
NOTIFY pgrst,'reload schema';COMMIT;
