BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Preserve all records and authorization; display chunks in curated section order.
CREATE OR REPLACE FUNCTION public.eva_search_action(p_actor uuid,p_action text,p_release uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.eva_search_releases;e public.eva_search_events;prior public.eva_search_events;s public.eva_official_extraction_sections;
 candidate jsonb;chunk jsonb;manifest jsonb;req uuid;pg integer;total bigint;result jsonb;pos integer;len integer;prev_end integer;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=p_actor::text FOR SHARE OF ur,rr,tm;
 PERFORM public.platform_team_owner(p_actor);
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>4500000 OR p_action IS NULL OR p_action NOT IN ('list','detail','candidate','prepare','approve','withdraw') THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 IF p_action='candidate' THEN
  IF p_release IS NOT NULL OR NOT p_body ? 'jobId' OR p_body-'jobId'<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid source' USING ERRCODE='22023';END IF;
  RETURN public.eva_search_candidate((p_body->>'jobId')::uuid,true);
 END IF;
 IF p_action IN ('list','detail') THEN
  IF jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;pg:=(p_body->>'page')::integer;
  IF p_action='list' THEN
   IF p_release IS NOT NULL OR NOT p_body ?& ARRAY['page','search','state'] OR p_body-ARRAY['page','search','state']<>'{}'::jsonb OR jsonb_typeof(p_body->'search') IS DISTINCT FROM 'string' OR length(p_body->>'search')>100 OR coalesce(p_body->>'state','!') NOT IN ('','DRAFT','APPROVED_PRIVATE','WITHDRAWN') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
   WITH rows AS(SELECT x.id,x.created_at,x.manifest_hash,x.manifest->'metadata'->>'topic' AS title,latest_state.state FROM public.eva_search_releases x CROSS JOIN LATERAL(SELECT state FROM public.eva_search_events WHERE release_id=x.id ORDER BY sequence DESC LIMIT 1)latest_state),
   filtered AS(SELECT * FROM rows WHERE (p_body->>'search'='' OR strpos(lower(title),lower(p_body->>'search'))>0) AND (p_body->>'state'='' OR state=p_body->>'state')),
   paged AS(SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 10 OFFSET pg*10)
   SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM paged x),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',pg,'pageSize',10) INTO result;RETURN result;
  END IF;
  IF p_body-'page'<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid detail' USING ERRCODE='22023';END IF;
  SELECT * INTO r FROM public.eva_search_releases WHERE id=p_release;IF r.id IS NULL THEN RAISE EXCEPTION 'Release not found' USING ERRCODE='23505';END IF;
  SELECT * INTO e FROM public.eva_search_events WHERE release_id=r.id ORDER BY sequence DESC LIMIT 1;
  RETURN jsonb_build_object('id',r.id,'manifest',r.manifest,'manifestHash',r.manifest_hash,'state',e.state,'eventId',e.id,'actorId',r.actor_id,'published',false,'externalRequests',0,
   'chunkTotal',(SELECT count(*) FROM public.eva_search_chunks WHERE release_id=r.id),'chunks',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM(SELECT c.id,c.page,c.heading,c.kind,c.content,c.content_hash,c.section_id,c.start_offset,c.end_offset FROM public.eva_search_chunks c JOIN public.eva_official_extraction_sections curated ON curated.id=c.section_id AND curated.version_id=r.version_id WHERE c.release_id=r.id ORDER BY curated.position,c.ordinal LIMIT 10 OFFSET pg*10)q),'[]'::jsonb),
   'historyTotal',(SELECT count(*) FROM public.eva_search_events WHERE release_id=r.id),'history',coalesce((SELECT jsonb_agg(to_jsonb(h)) FROM(SELECT id,sequence,state,action,actor_name,justification,created_at FROM public.eva_search_events WHERE release_id=r.id ORDER BY sequence DESC LIMIT 10)h),'[]'::jsonb));
 END IF;
 IF NOT p_body ?& ARRAY['requestId','justification'] OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-search-request:'||req::text,0));
 SELECT * INTO prior FROM public.eva_search_events WHERE id=req;
 IF prior.id IS NOT NULL THEN
  IF prior.actor_id<>p_actor OR prior.action<>p_action OR prior.input<>p_body OR (p_action<>'prepare' AND prior.release_id IS DISTINCT FROM p_release) THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('id',prior.release_id,'state',prior.state,'eventId',prior.id,'replayed',true,'published',false);
 END IF;
 IF p_action='prepare' THEN
  IF p_release IS NOT NULL OR NOT p_body ?& ARRAY['requestId','jobId','expectedVersionId','expectedReviewEventId','expectedContentHash','justification','manifest','chunks'] OR p_body-ARRAY['requestId','jobId','expectedVersionId','expectedReviewEventId','expectedContentHash','justification','manifest','chunks']<>'{}'::jsonb OR jsonb_typeof(p_body->'chunks') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'chunks') NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  candidate:=public.eva_search_candidate((p_body->>'jobId')::uuid,true);
  IF candidate->>'versionId' IS DISTINCT FROM p_body->>'expectedVersionId' OR candidate->>'reviewEventId' IS DISTINCT FROM p_body->>'expectedReviewEventId' OR candidate->>'contentHash' IS DISTINCT FROM p_body->>'expectedContentHash' THEN RAISE EXCEPTION 'Review changed' USING ERRCODE='23505';END IF;
  manifest:=jsonb_build_object('jobId',candidate->'jobId','versionId',candidate->'versionId','reviewEventId',candidate->'reviewEventId','contentHash',candidate->'contentHash','fileHash',candidate->'fileHash','metadata',candidate->'metadata','parser','eva-semantic-v1','dimensions',1536,'audience','PLATFORM','scope','OFFICIAL_PUBLIC');
  IF p_body->'manifest' IS DISTINCT FROM manifest THEN RAISE EXCEPTION 'Manifest forged' USING ERRCODE='22023';END IF;
  INSERT INTO public.eva_search_releases(id,job_id,version_id,review_event_id,manifest,manifest_hash,actor_id,input) VALUES(req,(candidate->>'jobId')::uuid,(candidate->>'versionId')::uuid,(candidate->>'reviewEventId')::uuid,manifest,encode(sha256(convert_to((manifest::text||(p_body->'chunks')::text),'UTF8')),'hex'),p_actor,p_body);
  FOR chunk IN SELECT value FROM jsonb_array_elements(p_body->'chunks') LOOP
   IF NOT chunk ?& ARRAY['id','sectionId','ordinal','page','start','end','heading','text','textHash','context','kind','parentHash'] OR chunk-ARRAY['id','sectionId','ordinal','page','start','end','heading','text','textHash','context','kind','parentHash']<>'{}'::jsonb OR (chunk->>'id') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid chunk' USING ERRCODE='22023';END IF;
   SELECT * INTO s FROM public.eva_official_extraction_sections WHERE id=(chunk->>'sectionId')::uuid AND version_id=(candidate->>'versionId')::uuid;
   pos:=(chunk->>'start')::integer;len:=(chunk->>'end')::integer-pos;
   IF s.id IS NULL OR pos<0 OR len<=0 OR (chunk->>'end')::integer>length(s.content) OR chunk->>'text' IS DISTINCT FROM substring(s.content FROM pos+1 FOR len) OR chunk->>'textHash' IS DISTINCT FROM encode(sha256(convert_to(chunk->>'text','UTF8')),'hex') OR chunk->>'parentHash' IS DISTINCT FROM s.content_hash OR (chunk->>'page')::integer<>s.page OR chunk->>'heading' IS DISTINCT FROM s.heading OR chunk->>'context' IS DISTINCT FROM s.heading OR chunk->>'id' IS DISTINCT FROM encode(sha256(convert_to('eva-semantic-v1|'||(candidate->>'versionId')||'|'||s.id::text||'|'||(chunk->>'ordinal')||'|'||(chunk->>'textHash'),'UTF8')),'hex') THEN RAISE EXCEPTION 'Chunk integrity' USING ERRCODE='22023';END IF;
   INSERT INTO public.eva_search_chunks VALUES(req,chunk->>'id',s.id,(chunk->>'ordinal')::integer,s.page,pos,pos+len,s.heading,chunk->>'text',chunk->>'textHash',s.content_hash,s.heading,chunk->>'kind');
  END LOOP;
  -- Every curated section must be covered exactly once from offset 0 to its end.
  FOR s IN SELECT * FROM public.eva_official_extraction_sections WHERE version_id=(candidate->>'versionId')::uuid LOOP
   prev_end:=0;pos:=0;
   FOR chunk IN SELECT to_jsonb(c) FROM public.eva_search_chunks c WHERE c.release_id=req AND c.section_id=s.id ORDER BY ordinal LOOP
    IF (chunk->>'ordinal')::integer<>pos OR (chunk->>'start_offset')::integer<>prev_end THEN RAISE EXCEPTION 'Coverage gap' USING ERRCODE='22023';END IF;
    prev_end:=(chunk->>'end_offset')::integer;pos:=pos+1;
   END LOOP;
   IF prev_end<>length(s.content) THEN RAISE EXCEPTION 'Missing section' USING ERRCODE='22023';END IF;
  END LOOP;
  INSERT INTO public.eva_search_jobs(id,release_id,state,external_requests) VALUES(req,req,'PREPARED_PRIVATE',0);
  INSERT INTO public.eva_search_events VALUES(req,req,1,'prepare','DRAFT',p_actor,public.platform_workflow_name(p_actor),p_body->>'justification',p_body,clock_timestamp());
  RETURN jsonb_build_object('id',req,'state','DRAFT','eventId',req,'published',false,'externalRequests',0,'replayed',false);
 END IF;
 IF NOT p_body ? 'expectedEventId' OR p_body-ARRAY['requestId','expectedEventId','justification']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-search-release:'||p_release::text,0));
 SELECT * INTO r FROM public.eva_search_releases WHERE id=p_release;SELECT * INTO e FROM public.eva_search_events WHERE release_id=p_release ORDER BY sequence DESC LIMIT 1;
 IF r.id IS NULL OR e.id::text IS DISTINCT FROM p_body->>'expectedEventId' OR e.state='WITHDRAWN' THEN RAISE EXCEPTION 'Release changed' USING ERRCODE='23505';END IF;
 IF p_action='approve' THEN
  candidate:=public.eva_search_candidate(r.job_id,true);
  IF e.state<>'DRAFT' OR r.actor_id=p_actor OR candidate->>'reviewEventId' IS DISTINCT FROM r.review_event_id::text OR candidate->>'versionId' IS DISTINCT FROM r.version_id::text THEN RAISE EXCEPTION 'Distinct Owner and live review required' USING ERRCODE='23505';END IF;
 END IF;
 INSERT INTO public.eva_search_events VALUES(req,r.id,e.sequence+1,p_action,CASE p_action WHEN 'approve' THEN 'APPROVED_PRIVATE' ELSE 'WITHDRAWN' END,p_actor,public.platform_workflow_name(p_actor),p_body->>'justification',p_body,clock_timestamp());
 RETURN jsonb_build_object('id',r.id,'state',CASE p_action WHEN 'approve' THEN 'APPROVED_PRIVATE' ELSE 'WITHDRAWN' END,'eventId',req,'published',false,'externalRequests',0,'replayed',false);
END$$;

COMMIT;
