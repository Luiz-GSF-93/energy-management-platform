-- Explicit closure and separately approved public summary. Never overwrite a
-- closed process or infer a market migration from completing this workflow.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.acl_closure_read(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE performance jsonb;summary jsonb;
BEGIN
 PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,false,false);
 SELECT jsonb_build_object('id',v.id,'version',v.version,'body',v.body,'hash',v.payload_hash,'createdAt',v.created_at)
 INTO performance FROM public.acl_admission_performance_versions v WHERE v.organization_id=p_org AND v.admission_id=p_id ORDER BY v.version DESC LIMIT 1;
 SELECT jsonb_build_object('modality',s.modality,'supplyDate',s.supply_date,'conclusion',s.conclusion,'publishedAt',s.published_at)
 INTO summary FROM public.acl_admission_public_summaries s WHERE s.organization_id=p_org AND s.admission_id=p_id;
 RETURN jsonb_build_object('performance',performance,'summary',summary);
END $$;
CREATE FUNCTION public.acl_closure_command(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_request uuid,p_revision integer,
 p_action text,p_checked boolean,p_conclusion text DEFAULT NULL,p_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;r record;old_event record;perf record;e record;stage jsonb;instant timestamptz;payload jsonb;v jsonb;ev jsonb;body jsonb;digest text;perf_id uuid;mode text;supply date;
BEGIN
 IF p_id IS NULL OR p_request IS NULL OR p_revision IS NULL OR p_revision<1 OR p_checked IS DISTINCT FROM true OR p_action IS NULL OR p_action NOT IN ('CLOSE','PUBLISH')
 OR (p_action='CLOSE' AND (p_conclusion IS NOT NULL OR p_hash IS NOT NULL))
 OR (p_action='PUBLISH' AND (p_conclusion IS NULL OR length(btrim(p_conclusion)) NOT BETWEEN 10 AND 1000 OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$'))
 THEN RAISE EXCEPTION 'Explicit ACL closure review required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('acl-work:'||p_org,0));
 access:=public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,true,true);
 payload:=jsonb_build_object('admissionId',p_id,'actorId',p_actor,'revision',p_revision,'action',p_action,'checked',p_checked,'conclusion',p_conclusion,'hash',p_hash);
 SELECT * INTO old_event FROM public.acl_admission_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF old_event.request_payload<>payload THEN RAISE EXCEPTION 'ACL request already used' USING ERRCODE='40001';END IF;
  SELECT state INTO v FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id;
  RETURN jsonb_build_object('ok',true,'admission',v,'closure',public.acl_closure_read(p_org,p_actor,p_role,p_platform,p_id),'replayed',true);
 END IF;
 instant:=date_trunc('milliseconds',clock_timestamp());
 PERFORM public.acl_expire_work(p_org,instant);
 SELECT * INTO r FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF r.revision<>p_revision THEN RETURN jsonb_build_object('ok',false,'code','CONFLICT');END IF;
 IF instant<r.created_at OR EXISTS(SELECT 1 FROM public.acl_admission_events WHERE organization_id=p_org AND admission_id=p_id AND recorded_at>instant)
 THEN RAISE EXCEPTION 'ACL clock moved backwards' USING ERRCODE='23514';END IF;
 IF p_action='CLOSE' THEN
  IF r.status='COMPLETED' THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
  IF EXISTS(SELECT 1 FROM public.acl_admission_work_sessions WHERE organization_id=p_org AND admission_id=p_id AND ended_at IS NULL)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.state->'stages') x WHERE x->>'status' NOT IN ('COMPLETED','SKIPPED') OR x ? 'active')
  THEN RETURN jsonb_build_object('ok',false,'code','DEPENDENCIES');END IF;
  FOR stage IN SELECT x FROM jsonb_array_elements(r.state->'stages') x LOOP
   SELECT evidence.*,review.decision INTO e FROM public.acl_admission_evidence evidence
    JOIN public.acl_admission_evidence_reviews review ON review.organization_id=evidence.organization_id AND review.evidence_id=evidence.id
    WHERE evidence.organization_id=p_org AND evidence.admission_id=p_id AND evidence.id::text=stage->>'evidenceRef'
      AND evidence.stage_key=stage->>'key' AND review.decision='APPROVED'
      AND evidence.kind=CASE WHEN stage->>'status'='SKIPPED' THEN 'SKIP' ELSE 'COMPLETE' END;
   IF NOT FOUND THEN RAISE EXCEPTION 'Approved stage evidence required for closure' USING ERRCODE='22023';END IF;
   PERFORM public.acl_check_evidence_sources(p_org,e.id);
   IF stage->>'key'='modality' THEN
    mode:=e.facts->>'modality';IF stage->>'modality' IS DISTINCT FROM mode THEN RAISE EXCEPTION 'Modality evidence mismatch' USING ERRCODE='23514';END IF;
   END IF;
   IF stage->>'key'='supply' THEN
    supply:=(e.facts->>'supplyDate')::date;IF stage->>'supplyDate' IS DISTINCT FROM supply::text THEN RAISE EXCEPTION 'Supply evidence mismatch' USING ERRCODE='23514';END IF;
   END IF;
  END LOOP;
  IF mode IS NULL OR mode NOT IN ('RETAIL','OWN_AGENT') OR supply IS NULL THEN RAISE EXCEPTION 'Confirmed modality and supply required' USING ERRCODE='22023';END IF;
  ev:=jsonb_build_object('revision',r.revision+1,'requestId',p_request,'action','CLOSE','actorId',p_actor,'actorName',access->>'actorName','at',floor(extract(epoch FROM instant)*1000)::bigint);
  v:=r.state||jsonb_build_object('status','COMPLETED','revision',r.revision+1,'closedAt',instant,'events',(r.state->'events')||jsonb_build_array(ev));
  body:=jsonb_build_object('schemaVersion','acl-performance/1','hashFormat','postgres-jsonb-text-utf8-sha256','organizationId',p_org,'admissionId',p_id,
   'customerId',r.customer_id,'unitId',r.consumer_unit_id,'processRevision',r.revision+1,'closedAt',instant,'closedBy',p_actor,'closedByName',access->>'actorName',
   'modality',mode,'supplyDate',supply,'stages',r.state->'stages','events',v->'events',
   'sessions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'stageKey',s.stage_key,'actorId',s.actor_id,'startedAt',s.started_at,'endedAt',s.ended_at,'reason',s.reason) ORDER BY s.started_at,s.id),'[]'::jsonb) FROM public.acl_admission_work_sessions s WHERE s.organization_id=p_org AND s.admission_id=p_id),
   'evidence',(SELECT jsonb_agg(jsonb_build_object('id',a.id,'stageKey',a.stage_key,'kind',a.kind,'facts',a.facts,'actorId',a.created_by,'actorName',a.actor_name,'reviewerId',review.reviewed_by,'reviewerName',review.actor_name,'reviewedAt',review.reviewed_at,
     'documents',(SELECT jsonb_agg(jsonb_build_object('id',d.document_id,'hash',d.file_hash,'version',d.catalog_version,'catalogRevision',d.catalog_revision,'type',d.document_type,'month',d.reference_month) ORDER BY d.document_id) FROM public.acl_admission_evidence_documents d WHERE d.organization_id=p_org AND d.evidence_id=a.id)) ORDER BY a.stage_key,a.id)
     FROM public.acl_admission_evidence a JOIN public.acl_admission_evidence_reviews review ON review.organization_id=a.organization_id AND review.evidence_id=a.id
     WHERE a.organization_id=p_org AND a.admission_id=p_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.state->'stages') x WHERE x->>'evidenceRef'=a.id::text)));
  digest:=encode(sha256(convert_to(body::text,'UTF8')),'hex');
  INSERT INTO public.acl_admission_performance_versions(organization_id,admission_id,version,body,payload_hash,created_by,created_at)
   VALUES(p_org,p_id,1,body,digest,p_actor,instant) RETURNING id INTO perf_id;
  UPDATE public.acl_admissions SET state=v,status='COMPLETED',revision=r.revision+1,updated_at=instant WHERE organization_id=p_org AND id=p_id;
 ELSE
  IF r.status<>'COMPLETED' OR EXISTS(SELECT 1 FROM public.acl_admission_public_summaries WHERE organization_id=p_org AND admission_id=p_id)
  THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
  SELECT * INTO perf FROM public.acl_admission_performance_versions WHERE organization_id=p_org AND admission_id=p_id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR perf.payload_hash<>p_hash OR perf.payload_hash<>encode(sha256(convert_to(perf.body::text,'UTF8')),'hex')
   OR (perf.body->>'processRevision')::integer<>r.revision THEN RAISE EXCEPTION 'Reviewed performance hash mismatch' USING ERRCODE='22023';END IF;
  INSERT INTO public.acl_admission_public_summaries(organization_id,admission_id,performance_id,modality,supply_date,conclusion,published_by,published_at)
   VALUES(p_org,p_id,perf.id,perf.body->>'modality',(perf.body->>'supplyDate')::date,btrim(p_conclusion),p_actor,instant);
  v:=r.state;
  ev:=jsonb_build_object('revision',r.revision+1,'requestId',p_request,'action','PUBLISH','actorId',p_actor,'actorName',access->>'actorName','performanceId',perf.id,'hash',perf.payload_hash,'at',floor(extract(epoch FROM instant)*1000)::bigint);
 END IF;
 INSERT INTO public.acl_admission_events(organization_id,admission_id,revision,request_id,request_payload,action,actor_id,snapshot,recorded_at)
  VALUES(p_org,p_id,r.revision+1,p_request,payload,p_action,p_actor,ev,instant);
 RETURN jsonb_build_object('ok',true,'admission',v,'closure',public.acl_closure_read(p_org,p_actor,p_role,p_platform,p_id),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.acl_closure_read(text,text,text,boolean,uuid),public.acl_closure_command(text,text,text,boolean,uuid,uuid,integer,text,boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_closure_read(text,text,text,boolean,uuid),public.acl_closure_command(text,text,text,boolean,uuid,uuid,integer,text,boolean,text,text) TO service_role;
NOTIFY pgrst,'reload schema';COMMIT;
