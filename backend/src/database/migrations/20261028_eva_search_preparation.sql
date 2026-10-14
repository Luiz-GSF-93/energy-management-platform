BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_search_releases(
 id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES public.eva_official_extraction_jobs(id),
 version_id uuid NOT NULL,review_event_id uuid NOT NULL REFERENCES public.eva_official_curation_events(id),
 manifest jsonb NOT NULL,manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL,input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(version_id,job_id) REFERENCES public.eva_official_extraction_versions(id,job_id));
CREATE TABLE public.eva_search_chunks(
 release_id uuid NOT NULL REFERENCES public.eva_search_releases(id),id text NOT NULL CHECK(id ~ '^[a-f0-9]{64}$'),
 section_id uuid NOT NULL REFERENCES public.eva_official_extraction_sections(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 1999),
 page integer NOT NULL CHECK(page BETWEEN 1 AND 100),start_offset integer NOT NULL CHECK(start_offset>=0),end_offset integer NOT NULL CHECK(end_offset>start_offset),
 heading text NOT NULL,content text NOT NULL CHECK(octet_length(content)<=16000),content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 parent_hash text NOT NULL CHECK(parent_hash ~ '^[a-f0-9]{64}$'),context text NOT NULL,kind text NOT NULL CHECK(kind IN ('TEXT','FLOW','TABLE')),
 PRIMARY KEY(release_id,id),UNIQUE(release_id,section_id,ordinal));
CREATE TABLE public.eva_search_jobs(
 id uuid PRIMARY KEY REFERENCES public.eva_search_releases(id),release_id uuid NOT NULL UNIQUE REFERENCES public.eva_search_releases(id),
 state text NOT NULL CHECK(state='PREPARED_PRIVATE'),external_requests integer NOT NULL CHECK(external_requests=0),
 estimated_tokens bigint,actual_tokens bigint,actual_cost_micro_usd bigint,index_name text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.eva_search_events(
 id uuid PRIMARY KEY,release_id uuid NOT NULL REFERENCES public.eva_search_releases(id),sequence integer NOT NULL CHECK(sequence>0),
 action text NOT NULL CHECK(action IN ('prepare','approve','withdraw')),state text NOT NULL CHECK(state IN ('DRAFT','APPROVED_PRIVATE','WITHDRAWN')),
 actor_id uuid NOT NULL,actor_name text NOT NULL,justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 1000 AND justification !~ '[[:cntrl:]]'),
 input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(release_id,sequence));
CREATE TABLE public.eva_search_evaluations(
 id uuid PRIMARY KEY,release_id uuid NOT NULL REFERENCES public.eva_search_releases(id),case_version text NOT NULL,
 case_hash text NOT NULL CHECK(case_hash ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL,
 actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX eva_search_event_latest ON public.eva_search_events(release_id,sequence DESC);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['eva_search_releases','eva_search_chunks','eva_search_jobs','eva_search_events','eva_search_evaluations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER eva_search_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable()',t);
 END LOOP;
END$$;

CREATE FUNCTION public.eva_search_candidate(p_job uuid,p_lock boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.eva_official_extraction_jobs;v public.eva_official_extraction_versions;ce public.eva_official_curation_events;je public.eva_official_extraction_job_events;result jsonb;
BEGIN
 IF p_lock THEN PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-job:'||p_job::text,0));END IF;
 SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=p_job;
 IF j.id IS NULL OR j.test_only OR NOT public.eva_extraction_origin(p_job,p_lock) THEN RAISE EXCEPTION 'Source unavailable' USING ERRCODE='23505';END IF;
 SELECT * INTO v FROM public.eva_official_extraction_versions WHERE job_id=p_job ORDER BY version DESC LIMIT 1;
 SELECT * INTO ce FROM public.eva_official_curation_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO je FROM public.eva_official_extraction_job_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 1;
 IF ce.state IS DISTINCT FROM 'REVIEWED' OR ce.version_id IS DISTINCT FROM v.id OR je.state IS DISTINCT FROM 'SUCCEEDED' OR v.metadata->>'publishedOn' IS NULL OR v.metadata->>'validFrom' IS NULL OR v.metadata->>'topic' IS NULL OR jsonb_array_length(v.metadata->'references')=0
  OR EXISTS(SELECT 1 FROM public.eva_official_extraction_sections WHERE version_id=v.id AND issues<>'[]'::jsonb)
 THEN RAISE EXCEPTION 'Review required' USING ERRCODE='23505';END IF;
 SELECT jsonb_build_object('jobId',j.id,'versionId',v.id,'reviewEventId',ce.id,'contentHash',v.content_hash,'fileHash',j.file_hash,'pageCount',v.page_count,'metadata',v.metadata,
 'sections',coalesce(jsonb_agg(jsonb_build_object('id',s.id,'page',s.page,'position',s.position,'heading',s.heading,'content',s.content,'content_hash',s.content_hash,'issues',s.issues) ORDER BY s.position),'[]'::jsonb)) INTO result
 FROM public.eva_official_extraction_sections s WHERE s.version_id=v.id;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.eva_search_candidate(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_search_action(p_actor uuid,p_action text,p_release uuid,p_body jsonb) RETURNS jsonb
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
   'chunkTotal',(SELECT count(*) FROM public.eva_search_chunks WHERE release_id=r.id),'chunks',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM(SELECT id,page,heading,kind,content,content_hash,section_id,start_offset,end_offset FROM public.eva_search_chunks WHERE release_id=r.id ORDER BY page,section_id,ordinal LIMIT 10 OFFSET pg*10)q),'[]'::jsonb),
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
REVOKE ALL ON FUNCTION public.eva_search_action(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_search_action(uuid,text,uuid,jsonb) TO service_role;

CREATE FUNCTION public.eva_search_metrics(p_actor uuid,p_month text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE profile text;month_start date;result jsonb;
BEGIN
 SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
 IF profile IS NULL OR profile NOT IN ('OWNER','FINANCE') THEN RAISE EXCEPTION 'Cost access denied' USING ERRCODE='42501';END IF;
 PERFORM public.platform_workflow_actor(p_actor,CASE WHEN profile='OWNER' THEN 'e23a5c98-8b68-4ed2-aef8-70a7166407e4' ELSE '699703af-10ba-43a3-8eb8-9f0d9e477498' END);
 IF p_month IS NULL OR p_month !~ '^(20|21)\d{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';END IF;month_start:=(p_month||'-01')::date;
 SELECT jsonb_build_object('month',p_month,'preparedReleases',count(*),'preparedChunks',coalesce(sum((SELECT count(*) FROM public.eva_search_chunks c WHERE c.release_id=r.id)),0),'externalRequests',0,'actualCostMicroUsd',null,'estimatedCostBrlCents',null,'costSource','NOT_CONNECTED','organizationAiQuotaConsumed',false,'services',jsonb_build_array('azure-ai-search','azure-embeddings','azure-openai'),'costBasis','Preparação privada; Search, embeddings e geração não executados. Cotação/fatura não conectada; orçamento Blob não cobre esses serviços.') INTO result FROM public.eva_search_releases r WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date>=month_start AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date<month_start+interval '1 month';
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.eva_search_metrics(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_search_metrics(uuid,text) TO service_role;
COMMIT;
