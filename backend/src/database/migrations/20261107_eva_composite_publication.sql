BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE public.eva_composite_releases(
 id uuid PRIMARY KEY,set_id uuid NOT NULL UNIQUE REFERENCES public.eva_official_document_part_sets(id),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL,input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.eva_composite_release_batches(
 id uuid PRIMARY KEY,release_id uuid NOT NULL REFERENCES public.eva_composite_releases(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
 chunks jsonb NOT NULL CHECK(jsonb_typeof(chunks)='array' AND jsonb_array_length(chunks) BETWEEN 1 AND 100),
 chunks_hash text NOT NULL CHECK(chunks_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'PREPARED' CHECK(state IN ('PREPARED','INDEXING','INDEXED','PUBLISHING','PUBLISHED','UNKNOWN')),
 phase text CHECK(phase IN ('INDEX','PUBLISH')),lease_id uuid,lease_until timestamptz,
 vectors jsonb NOT NULL DEFAULT '{}',receipts jsonb NOT NULL DEFAULT '{}',
 token_limit integer CHECK(token_limit BETWEEN 1 AND 1000000),reserved_tokens integer NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),
 input_tokens integer NOT NULL DEFAULT 0 CHECK(input_tokens>=0),elapsed_ms integer NOT NULL DEFAULT 0 CHECK(elapsed_ms BETWEEN 0 AND 3600000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(release_id,ordinal),UNIQUE(id,release_id));
CREATE TABLE public.eva_composite_release_events(
 id uuid PRIMARY KEY,release_id uuid REFERENCES public.eva_composite_releases(id),batch_id uuid,sequence integer NOT NULL CHECK(sequence>0),
 action text NOT NULL CHECK(action IN ('prepare','review','quarantine','claim','reconcile','send','embedded','verified','finish','query_begin','query_finish')),
 state text NOT NULL CHECK(state IN ('DRAFT','APPROVED_PRIVATE','INDEXING','INDEXED_PRIVATE','PUBLISHING','ACTIVE','UNKNOWN','QUARANTINED','QUERY_REQUESTED','QUERY_READY','QUERY_NO_EVIDENCE','QUERY_FAILED')),
 actor_id uuid NOT NULL,actor_name text NOT NULL,organization_id text,payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=4000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(release_id,sequence),
 FOREIGN KEY(batch_id,release_id) REFERENCES public.eva_composite_release_batches(id,release_id));
CREATE INDEX eva_composite_events_latest ON public.eva_composite_release_events(release_id,sequence DESC);
CREATE UNIQUE INDEX eva_composite_query_finish_once ON public.eva_composite_release_events((payload->>'requestId'),organization_id,actor_id) WHERE action='query_finish';
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['eva_composite_releases','eva_composite_release_batches','eva_composite_release_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END$$;
CREATE TRIGGER eva_composite_release_immutable BEFORE UPDATE OR DELETE ON public.eva_composite_releases FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable();
CREATE TRIGGER eva_composite_event_immutable BEFORE UPDATE OR DELETE ON public.eva_composite_release_events FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable();
CREATE FUNCTION public.eva_composite_batch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','phase','lease_id','lease_until','vectors','receipts','token_limit','reserved_tokens','input_tokens','elapsed_ms']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['state','phase','lease_id','lease_until','vectors','receipts','token_limit','reserved_tokens','input_tokens','elapsed_ms']) THEN RAISE EXCEPTION 'Immutable composite manifest' USING ERRCODE='42501';END IF;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.eva_composite_batch_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER eva_composite_batch_manifest_immutable BEFORE UPDATE OR DELETE ON public.eva_composite_release_batches FOR EACH ROW EXECUTE FUNCTION public.eva_composite_batch_guard();

-- Same complete lock order as document-parts review: jobs, documents, source.
CREATE FUNCTION public.eva_composite_candidate(p_set uuid,p_lock boolean DEFAULT false,p_sections boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.eva_official_document_part_sets;p public.eva_official_document_parts;j public.eva_official_extraction_jobs;
 v public.eva_official_extraction_versions;ce public.eva_official_curation_events;d public.eva_official_document_revisions;
 src public.eva_official_source_revisions;locked uuid;parts jsonb:='[]';next_page integer:=1;meta jsonb;
BEGIN
 SELECT * INTO s FROM public.eva_official_document_part_sets WHERE id=p_set;
 IF s.id IS NULL OR s.state<>'REVIEWED_PRIVATE' OR s.id IS DISTINCT FROM (SELECT id FROM public.eva_official_document_part_sets WHERE chain_id=s.chain_id ORDER BY revision DESC LIMIT 1)
 THEN RAISE EXCEPTION 'Current independent review required' USING ERRCODE='23505';END IF;
 IF p_lock THEN
  FOR locked IN SELECT job_id FROM public.eva_official_document_parts WHERE set_id=s.id ORDER BY job_id LOOP
   IF locked IS NULL THEN RAISE EXCEPTION 'Incomplete linkage' USING ERRCODE='23505';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-job:'||locked::text,0));
  END LOOP;
  FOR locked IN SELECT DISTINCT x FROM(SELECT s.document_id AS x UNION SELECT ej.document_id FROM public.eva_official_extraction_jobs ej JOIN public.eva_official_document_parts dp ON dp.job_id=ej.id WHERE dp.set_id=s.id)refs ORDER BY x LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-document:'||locked::text,0));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-source:'||(SELECT source_id::text FROM public.eva_official_documents WHERE id=s.document_id),0));
 END IF;
 PERFORM public.platform_team_owner(s.actor_id);
 IF NOT public.eva_document_parts_origin(s.id,false) THEN RAISE EXCEPTION 'Original changed' USING ERRCODE='23505';END IF;
 SELECT * INTO d FROM public.eva_official_document_revisions WHERE id=s.original_revision_id;
 SELECT r.* INTO src FROM public.eva_official_source_revisions r JOIN public.eva_official_source_events e ON e.revision_id=r.id WHERE e.id=s.source_event_id;
 FOR p IN SELECT * FROM public.eva_official_document_parts WHERE set_id=s.id ORDER BY ordinal LOOP
  IF p.ordinal<>jsonb_array_length(parts)+1 OR p.start_page<>next_page OR p.end_page-p.start_page>=40 OR p.job_id IS NULL OR NOT public.eva_extraction_origin(p.job_id,false) THEN RAISE EXCEPTION 'Coverage or origin changed' USING ERRCODE='23505';END IF;
  SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=p.job_id;
  SELECT * INTO v FROM public.eva_official_extraction_versions WHERE job_id=p.job_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO ce FROM public.eva_official_curation_events WHERE job_id=p.job_id ORDER BY sequence DESC LIMIT 1;
  IF j.test_only OR j.file_hash IS DISTINCT FROM p.file_hash OR v.id IS DISTINCT FROM p.curation_version_id OR v.kind<>'CURATED' OR v.page_count<>p.end_page-p.start_page+1 OR
   ce.version_id IS DISTINCT FROM v.id OR ce.state IS DISTINCT FROM 'REVIEWED' OR ce.actor_id=s.actor_id OR
   p_sections AND (EXISTS(SELECT 1 FROM public.eva_official_extraction_sections WHERE version_id=v.id AND issues<>'[]') OR
   (SELECT count(DISTINCT page) FROM public.eva_official_extraction_sections WHERE version_id=v.id)<>v.page_count) THEN RAISE EXCEPTION 'Current complete curation required' USING ERRCODE='23505';END IF;
  PERFORM public.platform_team_owner(ce.actor_id);
  IF v.metadata->'publishedOn'='null'::jsonb OR v.metadata->'validFrom'='null'::jsonb OR coalesce(v.metadata->>'topic','')='' OR jsonb_array_length(v.metadata->'references')<1 THEN RAISE EXCEPTION 'Applicability incomplete' USING ERRCODE='23505';END IF;
  IF meta IS NOT NULL AND (v.metadata-ARRAY['references']) IS DISTINCT FROM (meta-ARRAY['references']) THEN RAISE EXCEPTION 'Mixed applicability' USING ERRCODE='23505';END IF;meta:=v.metadata;
  parts:=parts||jsonb_build_array(jsonb_build_object('ordinal',p.ordinal,'startPage',p.start_page,'endPage',p.end_page,'jobId',j.id,'versionId',v.id,'reviewEventId',ce.id,'fileHash',j.file_hash,'contentHash',v.content_hash,'pageCount',v.page_count,'metadata',v.metadata,
   'sections',CASE WHEN p_sections THEN (SELECT jsonb_agg(jsonb_build_object('id',es.id,'page',es.page,'position',es.position,'heading',es.heading,'content',es.content,'content_hash',es.content_hash,'issues',es.issues) ORDER BY es.position) FROM public.eva_official_extraction_sections es WHERE es.version_id=v.id) ELSE '[]'::jsonb END));
  next_page:=p.end_page+1;
 END LOOP;
 IF next_page<>s.original_page_count+1 OR jsonb_array_length(parts) NOT BETWEEN 2 AND 25 THEN RAISE EXCEPTION 'Composite incomplete' USING ERRCODE='23505';END IF;
 RETURN jsonb_build_object('setId',s.id,'chainId',s.chain_id,'manifestHash',s.manifest_hash,'originalHash',s.original_file_hash,'pages',s.original_page_count,'documentId',s.document_id,
  'title',d.metadata->>'title','edition',d.metadata->>'edition','url',d.metadata->>'url','authority',src.metadata->>'authority','family',src.metadata->>'family','markets',src.metadata->'markets','parts',parts);
END$$;
REVOKE ALL ON FUNCTION public.eva_composite_candidate(uuid,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_composite_event(p_id uuid,p_actor uuid,p_release uuid,p_batch uuid,p_action text,p_state text,p_body jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE seq integer;
BEGIN
 SELECT coalesce(max(sequence),0)+1 INTO seq FROM public.eva_composite_release_events WHERE release_id=p_release;
 INSERT INTO public.eva_composite_release_events(id,release_id,batch_id,sequence,action,state,actor_id,actor_name,payload)
 VALUES(p_id,p_release,p_batch,seq,p_action,p_state,p_actor,public.platform_workflow_name(p_actor),p_body);
END$$;
REVOKE ALL ON FUNCTION public.eva_composite_event(uuid,uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_composite_live(p_release uuid,p_lock boolean DEFAULT false,p_review boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.eva_composite_releases;src jsonb;review public.eva_composite_release_events;parts jsonb;
BEGIN
 SELECT * INTO r FROM public.eva_composite_releases WHERE id=p_release;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Composite unavailable' USING ERRCODE='23505';END IF;
 src:=public.eva_composite_candidate(r.set_id,p_lock,false);
 PERFORM public.platform_team_owner(r.actor_id);
 IF p_review THEN
  SELECT * INTO review FROM public.eva_composite_release_events WHERE release_id=r.id AND action='review' ORDER BY sequence DESC LIMIT 1;
  IF review.id IS NULL OR review.actor_id=r.actor_id THEN RAISE EXCEPTION 'Independent composite review required' USING ERRCODE='23505';END IF;
  PERFORM public.platform_team_owner(review.actor_id);
 END IF;
 SELECT jsonb_agg(value-ARRAY['metadata','sections','pageCount'] ORDER BY (value->>'ordinal')::integer) INTO parts FROM jsonb_array_elements(src->'parts');
 IF r.manifest->'parts' IS DISTINCT FROM parts OR r.manifest->>'sourceManifestHash' IS DISTINCT FROM src->>'manifestHash' OR
  r.manifest->>'originalFileHash' IS DISTINCT FROM src->>'originalHash' OR r.manifest->>'url' IS DISTINCT FROM src->>'url' THEN RAISE EXCEPTION 'Composite evidence changed' USING ERRCODE='23505';END IF;
 RETURN src;
END$$;
REVOKE ALL ON FUNCTION public.eva_composite_live(uuid,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_composite_action(p_actor uuid,p_action text,p_release uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.eva_composite_releases;e public.eva_composite_release_events;prior public.eva_composite_release_events;
 b public.eva_composite_release_batches;src jsonb;m jsonb;batch jsonb;x jsonb;part jsonb;expected_parts jsonb;expected_meta jsonb;
 es public.eva_official_extraction_sections;req uuid;target_set uuid;selected_batch uuid;pg integer;hp integer;ord integer;total integer;seq integer;lo integer;hi integer;
 next_state text;batch_phase text;lease uuid;profile text;read_only boolean;vector jsonb;tokens integer;reserved integer;key text;refs jsonb;result jsonb;expected_chunk text;live boolean;
 previous_part integer:=0;previous_position integer:=-1;previous_start integer:=-1;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501';END IF;
 IF p_action='metrics' THEN
  SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
  IF profile NOT IN ('OWNER','FINANCE') OR profile IS NULL THEN RAISE EXCEPTION 'Financial access denied' USING ERRCODE='42501';END IF;
  PERFORM public.platform_workflow_actor(p_actor,CASE profile WHEN 'OWNER' THEN 'e23a5c98-8b68-4ed2-aef8-70a7166407e4' ELSE '699703af-10ba-43a3-8eb8-9f0d9e477498' END);
  IF p_release IS NOT NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR p_body-'month'<>'{}' OR coalesce(p_body->>'month','') !~ '^(20|21)\d{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('releases',(SELECT count(*) FROM public.eva_composite_releases WHERE to_char(created_at,'YYYY-MM')=p_body->>'month'),
   'embeddingTokens',(SELECT coalesce(sum((payload->>'tokens')::bigint),0) FROM public.eva_composite_release_events WHERE action='embedded' AND to_char(created_at,'YYYY-MM')=p_body->>'month'),
   'providerRequests',(SELECT count(*) FROM public.eva_composite_release_events WHERE action='send' AND to_char(created_at,'YYYY-MM')=p_body->>'month'),
   'unknownBatches',(SELECT count(*) FROM public.eva_composite_release_batches WHERE state='UNKNOWN'),'measuredCostMicroUsd',null,'costState','AWAITING_PROVIDER_BILLING',
   'queryRequests',(SELECT count(*) FROM public.eva_composite_release_events WHERE action='query_begin' AND to_char(created_at,'YYYY-MM')=p_body->>'month'),
   'queryCompleted',(SELECT count(*) FROM public.eva_composite_release_events WHERE action='query_finish' AND to_char(created_at,'YYYY-MM')=p_body->>'month'),
   'queryTokens',(SELECT coalesce(sum((payload->>'inputTokens')::bigint),0) FROM public.eva_composite_release_events WHERE action='query_finish' AND to_char(created_at,'YYYY-MM')=p_body->>'month'),
   'querySearchRequests',(SELECT coalesce(sum((payload->>'searchRequests')::bigint),0) FROM public.eva_composite_release_events WHERE action='query_finish' AND to_char(created_at,'YYYY-MM')=p_body->>'month'));
 END IF;
 PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=p_actor::text FOR SHARE OF ur,rr,tm;
 PERFORM public.platform_team_owner(p_actor);
 IF p_action IS NULL OR p_action NOT IN ('list','candidates','candidate','detail','preview','prepare','review','quarantine','claim','reconcile','send','embedded','verified','finish') OR
  jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>4000000 THEN RAISE EXCEPTION 'Invalid composite action' USING ERRCODE='22023';END IF;
 IF p_action IN ('list','candidates') THEN
  IF p_release IS NOT NULL OR NOT p_body ?& ARRAY['page','search','state'] OR p_body-ARRAY['page','search','state']<>'{}' OR coalesce(p_body->>'page','') !~ '^\d{1,3}$' OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR jsonb_typeof(p_body->'search') IS DISTINCT FROM 'string' OR length(p_body->>'search')>100 OR coalesce(p_body->>'state','!') NOT IN ('','DRAFT','APPROVED_PRIVATE','INDEXING','INDEXED_PRIVATE','PUBLISHING','ACTIVE','UNKNOWN','QUARANTINED') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;pg:=(p_body->>'page')::integer;
  IF p_action='candidates' THEN
   RETURN(WITH current AS(SELECT DISTINCT ON(chain_id) * FROM public.eva_official_document_part_sets ORDER BY chain_id,revision DESC),
    filtered AS(SELECT s.id,d.metadata->>'title' title,s.original_page_count pages,s.manifest_hash FROM current s JOIN public.eva_official_document_revisions d ON d.id=s.original_revision_id WHERE s.state='REVIEWED_PRIVATE' AND public.eva_document_parts_origin(s.id,false) AND NOT EXISTS(SELECT 1 FROM public.eva_composite_releases cr WHERE cr.set_id=s.id) AND strpos(lower(d.metadata->>'title'),lower(p_body->>'search'))>0),
    paged AS(SELECT * FROM filtered ORDER BY title,id LIMIT 10 OFFSET pg*10)
    SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(pg_row) ORDER BY title,id) FROM paged pg_row),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',pg));
  END IF;
  RETURN(WITH current AS(SELECT cr.*,ev.state FROM public.eva_composite_releases cr JOIN LATERAL(SELECT state FROM public.eva_composite_release_events WHERE release_id=cr.id ORDER BY sequence DESC LIMIT 1)ev ON true),
   filtered AS(SELECT * FROM current WHERE (p_body->>'state'='' OR state=p_body->>'state') AND strpos(lower(manifest->>'title'),lower(p_body->>'search'))>0),
   paged AS(SELECT id,set_id,manifest->>'title' title,manifest->>'edition' edition,state,(manifest->>'chunkTotal')::integer chunks,created_at FROM filtered ORDER BY created_at DESC,id LIMIT 10 OFFSET pg*10)
   SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(pg_row) ORDER BY created_at DESC,id) FROM paged pg_row),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',pg));
 END IF;
 IF p_action='candidate' THEN IF p_body<>'{}' THEN RAISE EXCEPTION 'Unexpected candidate fields' USING ERRCODE='22023';END IF;RETURN public.eva_composite_candidate(p_release,false);END IF;
 IF p_action='prepare' THEN
  IF p_release IS NOT NULL OR NOT p_body ?& ARRAY['requestId','setId','expectedManifestHash','justification','manifest','batches'] OR p_body-ARRAY['requestId','setId','expectedManifestHash','justification','manifest','batches']<>'{}' OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  req:=(p_body->>'requestId')::uuid;target_set:=(p_body->>'setId')::uuid;IF req IS NULL OR target_set IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-composite-set:'||target_set::text,0));
  SELECT * INTO r FROM public.eva_composite_releases WHERE id=req;
  IF r.id IS NOT NULL THEN IF r.actor_id<>p_actor OR r.input IS DISTINCT FROM p_body THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('id',r.id,'replayed',true);END IF;
  src:=public.eva_composite_candidate(target_set,true);
  IF src->>'manifestHash' IS DISTINCT FROM p_body->>'expectedManifestHash' OR EXISTS(SELECT 1 FROM public.eva_composite_releases WHERE eva_composite_releases.set_id=target_set) THEN RAISE EXCEPTION 'Set changed or already prepared' USING ERRCODE='23505';END IF;
  SELECT jsonb_agg(value-ARRAY['metadata','sections','pageCount'] ORDER BY (value->>'ordinal')::integer) INTO expected_parts FROM jsonb_array_elements(src->'parts');
  SELECT jsonb_agg(ref ORDER BY ref) INTO refs FROM(SELECT DISTINCT jsonb_array_elements_text(value->'metadata'->'references') ref FROM jsonb_array_elements(src->'parts'))u;
  expected_meta:=(src->'parts'->0->'metadata')||jsonb_build_object('references',refs);
  m:=p_body->'manifest';
  IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR NOT m ?& ARRAY['version','setId','chainId','sourceManifestHash','originalFileHash','originalPageCount','documentId','title','edition','url','authority','family','markets','metadata','parts','chunkTotal'] OR m-ARRAY['version','setId','chainId','sourceManifestHash','originalFileHash','originalPageCount','documentId','title','edition','url','authority','family','markets','metadata','parts','chunkTotal']<>'{}' OR
   m-'chunkTotal' IS DISTINCT FROM jsonb_build_object('version','eva-composite-v1','setId',target_set,'chainId',src->'chainId','sourceManifestHash',src->'manifestHash','originalFileHash',src->'originalHash','originalPageCount',src->'pages','documentId',src->'documentId','title',src->'title','edition',src->'edition','url',src->'url','authority',src->'authority','family',src->'family','markets',src->'markets','metadata',expected_meta,'parts',expected_parts) OR
   coalesce(m->>'chunkTotal','') !~ '^\d{1,4}$' OR (m->>'chunkTotal')::integer NOT BETWEEN 1 AND 2000 OR jsonb_typeof(p_body->'batches') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'batches')<>(ceil((m->>'chunkTotal')::numeric/100))::integer THEN RAISE EXCEPTION 'Composite manifest changed' USING ERRCODE='22023';END IF;
  INSERT INTO public.eva_composite_releases VALUES(req,target_set,m,encode(sha256(convert_to(m::text||(p_body->'batches')::text,'UTF8')),'hex'),p_actor,p_body,clock_timestamp());
  ord:=0;total:=0;
  FOR batch IN SELECT value FROM jsonb_array_elements(p_body->'batches') LOOP
   ord:=ord+1;
   IF batch-ARRAY['ordinal','chunks']<>'{}' OR (batch->>'ordinal')::integer<>ord OR jsonb_typeof(batch->'chunks') IS DISTINCT FROM 'array' OR jsonb_array_length(batch->'chunks')<>least(100,(m->>'chunkTotal')::integer-total) THEN RAISE EXCEPTION 'Invalid bounded batch' USING ERRCODE='22023';END IF;
   FOR x IN SELECT value FROM jsonb_array_elements(batch->'chunks') LOOP
    IF NOT x ?& ARRAY['id','partOrdinal','jobId','versionId','sectionId','ordinal','page','partPage','start','end','heading','context','text','textHash','parentHash'] OR x-ARRAY['id','partOrdinal','jobId','versionId','sectionId','ordinal','page','partPage','start','end','heading','context','text','textHash','parentHash']<>'{}' THEN RAISE EXCEPTION 'Invalid chunk shape' USING ERRCODE='22023';END IF;
    SELECT value INTO part FROM jsonb_array_elements(src->'parts') WHERE value->>'ordinal'=x->>'partOrdinal';
    SELECT * INTO es FROM public.eva_official_extraction_sections WHERE id=(x->>'sectionId')::uuid;
    lo:=(x->>'start')::integer;hi:=(x->>'end')::integer;
    expected_chunk:=encode(sha256(convert_to('eva-semantic-v1|'||(x->>'versionId')||'|'||(x->>'sectionId')||'|'||(x->>'ordinal')||'|'||(x->>'textHash'),'UTF8')),'hex');
    expected_chunk:=encode(sha256(convert_to('eva-composite-v1|'||target_set::text||'|'||(x->>'partOrdinal')||'|'||expected_chunk,'UTF8')),'hex');
    IF part IS NULL OR es.id IS NULL OR es.version_id::text IS DISTINCT FROM part->>'versionId' OR x->>'versionId' IS DISTINCT FROM part->>'versionId' OR x->>'jobId' IS DISTINCT FROM part->>'jobId' OR
     (x->>'partPage')::integer<>es.page OR (x->>'page')::integer<>(part->>'startPage')::integer+es.page-1 OR x->>'parentHash' IS DISTINCT FROM es.content_hash OR x->>'heading' IS DISTINCT FROM es.heading OR x->>'context' IS DISTINCT FROM es.heading OR
     lo<0 OR hi<=lo OR hi>length(es.content) OR jsonb_typeof(x->'text') IS DISTINCT FROM 'string' OR length(x->>'text')>6000 OR octet_length(x->>'text')>16000 OR x->>'text' IS DISTINCT FROM substring(es.content FROM lo+1 FOR hi-lo) OR
     x->>'textHash' IS DISTINCT FROM encode(sha256(convert_to(x->>'text','UTF8')),'hex') OR x->>'id' IS DISTINCT FROM expected_chunk OR (x->>'ordinal')::integer NOT BETWEEN 0 AND 1999 THEN RAISE EXCEPTION 'Chunk evidence mismatch' USING ERRCODE='23505';END IF;
    IF (x->>'partOrdinal')::integer<previous_part OR (x->>'partOrdinal')::integer=previous_part AND (es.position<previous_position OR es.position=previous_position AND lo<=previous_start) THEN RAISE EXCEPTION 'Document order changed' USING ERRCODE='23505';END IF;
    IF (x->>'partOrdinal')::integer<>previous_part THEN previous_position:=-1;previous_start:=-1;END IF;
    previous_part:=(x->>'partOrdinal')::integer;previous_position:=es.position;previous_start:=lo;
   END LOOP;
   INSERT INTO public.eva_composite_release_batches(id,release_id,ordinal,chunks,chunks_hash) VALUES(gen_random_uuid(),req,ord,batch->'chunks',encode(sha256(convert_to((batch->'chunks')::text,'UTF8')),'hex'));
   total:=total+jsonb_array_length(batch->'chunks');
  END LOOP;
  -- Exact section/text coverage, including internal boundaries. No truncated first 100.
  IF (SELECT count(DISTINCT c->>'id') FROM public.eva_composite_release_batches cb CROSS JOIN LATERAL jsonb_array_elements(cb.chunks)c WHERE cb.release_id=req)<>total OR
   EXISTS(WITH chunks AS(SELECT c FROM public.eva_composite_release_batches cb CROSS JOIN LATERAL jsonb_array_elements(cb.chunks)c WHERE cb.release_id=req),
    bounds AS(SELECT c,(c->>'start')::integer lo,(c->>'end')::integer hi,lag((c->>'end')::integer,1,0) OVER(PARTITION BY c->>'sectionId' ORDER BY (c->>'start')::integer) prev FROM chunks)
    SELECT 1 FROM bounds WHERE bounds.lo<>bounds.prev) OR
   EXISTS(SELECT 1 FROM public.eva_official_document_parts p JOIN public.eva_official_extraction_sections sect ON sect.version_id=p.curation_version_id LEFT JOIN LATERAL(
    SELECT min((c->>'start')::integer)lo,max((c->>'end')::integer)hi,sum((c->>'end')::integer-(c->>'start')::integer)covered FROM public.eva_composite_release_batches cb CROSS JOIN LATERAL jsonb_array_elements(cb.chunks)c WHERE cb.release_id=req AND c->>'sectionId'=sect.id::text)t ON true
    WHERE p.set_id=target_set AND (t.lo IS DISTINCT FROM 0 OR t.hi IS DISTINCT FROM length(sect.content) OR t.covered IS DISTINCT FROM length(sect.content)::bigint)) THEN RAISE EXCEPTION 'Incomplete section coverage' USING ERRCODE='23505';END IF;
  PERFORM public.eva_composite_event(req,p_actor,req,null,'prepare','DRAFT',p_body-ARRAY['manifest','batches']);
  RETURN jsonb_build_object('id',req,'state','DRAFT','chunks',total,'batches',ord,'published',false);
 END IF;
 IF p_release IS NULL THEN RAISE EXCEPTION 'Release required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-composite-release:'||p_release::text,0));
 SELECT * INTO r FROM public.eva_composite_releases WHERE id=p_release;
 SELECT * INTO e FROM public.eva_composite_release_events WHERE release_id=p_release ORDER BY sequence DESC LIMIT 1;
 IF r.id IS NULL OR e.id IS NULL THEN RAISE EXCEPTION 'Release unavailable' USING ERRCODE='22023';END IF;
 IF p_action='preview' THEN
  IF p_body-'page'<>'{}' OR NOT p_body ? 'page' OR coalesce(p_body->>'page','') !~ '^\d{1,3}$' THEN RAISE EXCEPTION 'Invalid preview page' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;
  RETURN(WITH items AS(SELECT c.value,cb.ordinal batch_ordinal,c.pos FROM public.eva_composite_release_batches cb CROSS JOIN LATERAL jsonb_array_elements(cb.chunks) WITH ORDINALITY c(value,pos) WHERE cb.release_id=r.id),
   paged AS(SELECT * FROM items ORDER BY batch_ordinal,pos LIMIT 10 OFFSET pg*10)
   SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(value ORDER BY batch_ordinal,pos) FROM paged),'[]'::jsonb),'total',(SELECT count(*) FROM items),'page',pg,'manifestHash',r.manifest_hash));
 END IF;
 IF p_action='detail' THEN
  IF NOT p_body ?& ARRAY['page','batchPage'] OR p_body-ARRAY['page','batchPage']<>'{}' OR coalesce(p_body->>'page','') !~ '^\d{1,3}$' OR coalesce(p_body->>'batchPage','') !~ '^\d{1,3}$' THEN RAISE EXCEPTION 'Invalid detail page' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;hp:=(p_body->>'batchPage')::integer;live:=false;
  BEGIN PERFORM public.eva_composite_live(r.id,false,e.state<>'DRAFT');live:=true;EXCEPTION WHEN check_violation OR unique_violation OR insufficient_privilege THEN live:=false;END;
  RETURN jsonb_build_object('id',r.id,'state',e.state,'eventId',e.id,'manifest',r.manifest,'manifestHash',r.manifest_hash,'originCurrent',live,'published',e.state='ACTIVE' AND live,
   'batches',(SELECT coalesce(jsonb_agg(to_jsonb(br) ORDER BY br.ordinal),'[]'::jsonb) FROM(SELECT cb.id,cb.ordinal,cb.state,cb.phase,cb.lease_until,cb.token_limit,cb.reserved_tokens,cb.input_tokens,cb.elapsed_ms,jsonb_array_length(cb.chunks) AS chunks FROM public.eva_composite_release_batches cb WHERE cb.release_id=r.id ORDER BY cb.ordinal LIMIT 10 OFFSET hp*10)br),
   'batchTotal',(SELECT count(*) FROM public.eva_composite_release_batches WHERE release_id=r.id),
   'history',(SELECT coalesce(jsonb_agg(to_jsonb(hr) ORDER BY hr.sequence DESC),'[]'::jsonb) FROM(SELECT ev.id,ev.sequence,ev.action,ev.state,ev.actor_name,ev.created_at,ev.batch_id,ev.payload-ARRAY['vector','manifest','batches'] AS payload FROM public.eva_composite_release_events ev WHERE ev.release_id=r.id ORDER BY ev.sequence DESC LIMIT 10 OFFSET pg*10)hr),
   'historyTotal',(SELECT count(*) FROM public.eva_composite_release_events WHERE release_id=r.id));
 END IF;
 req:=(p_body->>'requestId')::uuid;
 IF req IS NULL THEN RAISE EXCEPTION 'Request identifier required' USING ERRCODE='22023';END IF;
 SELECT * INTO prior FROM public.eva_composite_release_events WHERE id=req;
 IF prior.id IS NOT NULL THEN
  IF prior.actor_id<>p_actor OR prior.release_id IS DISTINCT FROM r.id OR prior.action<>p_action OR prior.payload IS DISTINCT FROM p_body THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('id',r.id,'state',e.state,'replayed',true);
 END IF;
 IF p_action IN ('review','quarantine','claim','reconcile') THEN
  IF NOT p_body ?& ARRAY['requestId','expectedEventId','justification'] OR (p_body->>'expectedEventId')::uuid IS DISTINCT FROM e.id OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Decision or revision changed' USING ERRCODE='23505';END IF;
  IF p_action IN ('review','quarantine') THEN
   IF p_body-ARRAY['requestId','expectedEventId','justification']<>'{}' THEN RAISE EXCEPTION 'Unexpected decision fields' USING ERRCODE='22023';END IF;
   IF p_action='review' THEN
    IF e.state<>'DRAFT' OR r.actor_id=p_actor THEN RAISE EXCEPTION 'Independent Owner required' USING ERRCODE='42501';END IF;
    PERFORM public.eva_composite_live(r.id,true,false);next_state:='APPROVED_PRIVATE';
   ELSE next_state:='QUARANTINED';END IF;
   PERFORM public.eva_composite_event(req,p_actor,r.id,null,p_action,next_state,p_body);
   RETURN jsonb_build_object('id',r.id,'state',next_state,'published',false);
  END IF;
  PERFORM public.eva_composite_live(r.id,true,true);
  IF e.state IN ('DRAFT','QUARANTINED','ACTIVE') THEN RAISE EXCEPTION 'Composite command blocked' USING ERRCODE='23505';END IF;
  selected_batch:=(p_body->>'batchId')::uuid;SELECT * INTO b FROM public.eva_composite_release_batches WHERE id=selected_batch AND release_id=r.id FOR UPDATE;
  IF b.id IS NULL OR EXISTS(SELECT 1 FROM public.eva_composite_release_batches cb WHERE cb.release_id=r.id AND cb.id<>b.id AND cb.state IN ('INDEXING','PUBLISHING')) THEN RAISE EXCEPTION 'Batch unavailable or active elsewhere' USING ERRCODE='23505';END IF;
  read_only:=p_action='reconcile';
  IF read_only THEN
   IF p_body-ARRAY['requestId','expectedEventId','justification','batchId']<>'{}' OR NOT p_body ? 'batchId' OR b.state NOT IN ('UNKNOWN','INDEXING','PUBLISHING') OR b.state<>'UNKNOWN' AND b.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'Read-only recovery unavailable' USING ERRCODE='23505';END IF;
   batch_phase:=b.phase;
  ELSE
   IF NOT p_body ?& ARRAY['batchId','phase','tokenLimit'] OR p_body-ARRAY['requestId','expectedEventId','justification','batchId','phase','tokenLimit']<>'{}' OR coalesce(p_body->>'phase','') NOT IN ('INDEX','PUBLISH') THEN RAISE EXCEPTION 'Invalid execution plan' USING ERRCODE='22023';END IF;
   batch_phase:=p_body->>'phase';
   IF batch_phase='INDEX' THEN
    IF b.state<>'PREPARED' OR e.state NOT IN ('APPROVED_PRIVATE','INDEXED_PRIVATE') OR jsonb_typeof(p_body->'tokenLimit') IS DISTINCT FROM 'number' OR coalesce(p_body->>'tokenLimit','') !~ '^\d{1,7}$' OR (p_body->>'tokenLimit')::integer NOT BETWEEN 1 AND 1000000 OR
     (p_body->>'tokenLimit')::integer<(SELECT sum(octet_length(value->>'text')) FROM jsonb_array_elements(b.chunks)) THEN RAISE EXCEPTION 'Token plan incomplete or batch already used' USING ERRCODE='23505';END IF;
    b.token_limit:=(p_body->>'tokenLimit')::integer;
   ELSE
    IF p_body->'tokenLimit' IS DISTINCT FROM 'null'::jsonb OR b.state<>'INDEXED' OR e.state NOT IN ('INDEXED_PRIVATE','PUBLISHING') OR
     EXISTS(SELECT 1 FROM public.eva_composite_release_batches cb WHERE cb.release_id=r.id AND cb.state NOT IN ('INDEXED','PUBLISHED')) THEN RAISE EXCEPTION 'All private batches must be verified' USING ERRCODE='23505';END IF;
   END IF;
  END IF;
  lease:=gen_random_uuid();next_state:=CASE batch_phase WHEN 'INDEX' THEN 'INDEXING' ELSE 'PUBLISHING' END;
  UPDATE public.eva_composite_release_batches SET state=next_state,phase=batch_phase,lease_id=lease,lease_until=clock_timestamp()+interval '30 minutes',receipts='{}',token_limit=b.token_limit WHERE id=b.id;
  PERFORM public.eva_composite_event(req,p_actor,r.id,b.id,p_action,next_state,p_body);
  RETURN jsonb_build_object('id',r.id,'batchId',b.id,'leaseId',lease,'releaseId',r.id,'revisionId',r.set_id,'phase',batch_phase,'readOnly',read_only,
   'chunks',(SELECT jsonb_agg(item.value||jsonb_build_object('vector',b.vectors->(item.value->>'id')) ORDER BY item.position) FROM jsonb_array_elements(b.chunks) WITH ORDINALITY item(value,position)));
 END IF;
 IF NOT p_body ?& ARRAY['requestId','batchId','leaseId'] THEN RAISE EXCEPTION 'Lease fields required' USING ERRCODE='22023';END IF;
 selected_batch:=(p_body->>'batchId')::uuid;SELECT * INTO b FROM public.eva_composite_release_batches WHERE id=selected_batch AND release_id=r.id FOR UPDATE;
 IF b.id IS NULL OR b.state NOT IN ('INDEXING','PUBLISHING') OR b.lease_id IS DISTINCT FROM (p_body->>'leaseId')::uuid OR b.lease_until<clock_timestamp() OR e.state='QUARANTINED' THEN RAISE EXCEPTION 'Lease changed or revoked' USING ERRCODE='23505';END IF;
 SELECT * INTO prior FROM public.eva_composite_release_events WHERE batch_id=b.id AND action IN ('claim','reconcile') ORDER BY sequence DESC LIMIT 1;
 IF prior.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Lease actor changed' USING ERRCODE='42501';END IF;
 PERFORM public.eva_composite_live(r.id,true,true);
 next_state:=CASE b.phase WHEN 'INDEX' THEN 'INDEXING' ELSE 'PUBLISHING' END;
 IF p_action IN ('send','embedded','verified') THEN
  key:=p_body->>'chunkId';SELECT value INTO x FROM jsonb_array_elements(b.chunks) WHERE value->>'id'=key;
  IF x IS NULL THEN RAISE EXCEPTION 'Chunk outside batch' USING ERRCODE='42501';END IF;
 END IF;
 IF p_action='send' THEN
  IF p_body-ARRAY['requestId','batchId','leaseId','chunkId','kind']<>'{}' OR NOT p_body ? 'kind' OR coalesce(p_body->>'kind','') NOT IN ('EMBEDDING','INDEX','LOOKUP_BEFORE','MERGE','LOOKUP_AFTER') THEN RAISE EXCEPTION 'Invalid provider reservation' USING ERRCODE='22023';END IF;
  SELECT * INTO prior FROM public.eva_composite_release_events WHERE batch_id=b.id AND action IN ('claim','reconcile') ORDER BY sequence DESC LIMIT 1;
  IF (prior.action='reconcile' AND p_body->>'kind'<>'LOOKUP_AFTER') OR (b.phase='PUBLISH' AND p_body->>'kind' IN ('EMBEDDING','INDEX')) OR (b.phase='INDEX' AND p_body->>'kind' IN ('LOOKUP_BEFORE','MERGE')) OR
   EXISTS(SELECT 1 FROM public.eva_composite_release_events ev WHERE ev.batch_id=b.id AND ev.action='send' AND ev.payload->>'leaseId'=b.lease_id::text AND ev.payload->>'chunkId'=key AND ev.payload->>'kind'=p_body->>'kind') THEN RAISE EXCEPTION 'Provider call already reserved or not allowed' USING ERRCODE='23505';END IF;
  IF p_body->>'kind'='EMBEDDING' THEN
   reserved:=octet_length(x->>'text');IF b.vectors ? key OR b.reserved_tokens+reserved>b.token_limit THEN RAISE EXCEPTION 'Token quota or vector already consumed' USING ERRCODE='23505';END IF;
   UPDATE public.eva_composite_release_batches SET reserved_tokens=reserved_tokens+reserved WHERE id=b.id;
  ELSIF p_body->>'kind' IN ('INDEX','MERGE') AND NOT b.vectors ? key THEN RAISE EXCEPTION 'Persisted vector required' USING ERRCODE='23505';END IF;
  PERFORM public.eva_composite_event(req,p_actor,r.id,b.id,p_action,next_state,p_body);RETURN jsonb_build_object('recorded',true);
 END IF;
 IF p_action='embedded' THEN
  vector:=p_body->'vector';
  IF NOT p_body ?& ARRAY['chunkId','vector','tokens'] OR p_body-ARRAY['requestId','batchId','leaseId','chunkId','vector','tokens']<>'{}' OR b.phase<>'INDEX' OR b.vectors ? key OR jsonb_typeof(vector) IS DISTINCT FROM 'array' OR jsonb_array_length(vector)<>1536 OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(vector) v WHERE jsonb_typeof(v)<>'number' OR abs(v::text::numeric)>1) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(vector) v WHERE v::text::numeric<>0) OR jsonb_typeof(p_body->'tokens') IS DISTINCT FROM 'number' OR coalesce(p_body->>'tokens','') !~ '^\d{1,7}$' OR (p_body->>'tokens')::integer NOT BETWEEN 1 AND octet_length(x->>'text') OR
   NOT EXISTS(SELECT 1 FROM public.eva_composite_release_events ev WHERE ev.batch_id=b.id AND ev.action='send' AND ev.payload->>'leaseId'=b.lease_id::text AND ev.payload->>'chunkId'=key AND ev.payload->>'kind'='EMBEDDING') THEN RAISE EXCEPTION 'Embedding proof or reservation invalid' USING ERRCODE='23505';END IF;
  UPDATE public.eva_composite_release_batches SET vectors=vectors||jsonb_build_object(key,vector),input_tokens=input_tokens+(p_body->>'tokens')::integer WHERE id=b.id;
  PERFORM public.eva_composite_event(req,p_actor,r.id,b.id,p_action,next_state,p_body);RETURN jsonb_build_object('recorded',true);
 END IF;
 IF p_action='verified' THEN
  IF p_body-ARRAY['requestId','batchId','leaseId','chunkId']<>'{}' OR NOT b.vectors ? key OR b.receipts ? key OR
   NOT EXISTS(SELECT 1 FROM public.eva_composite_release_events ev WHERE ev.batch_id=b.id AND ev.action='send' AND ev.payload->>'leaseId'=b.lease_id::text AND ev.payload->>'chunkId'=key AND ev.payload->>'kind'='LOOKUP_AFTER') THEN RAISE EXCEPTION 'Remote receipt invalid or repeated' USING ERRCODE='23505';END IF;
  UPDATE public.eva_composite_release_batches SET receipts=receipts||jsonb_build_object(key,jsonb_build_object('phase',b.phase,'hash',x->>'textHash','verifiedAt',clock_timestamp())) WHERE id=b.id;
  PERFORM public.eva_composite_event(req,p_actor,r.id,b.id,p_action,next_state,p_body);RETURN jsonb_build_object('recorded',true);
 END IF;
 IF p_action='finish' THEN
  IF NOT p_body ?& ARRAY['confirmed','elapsedMs'] OR p_body-ARRAY['requestId','batchId','leaseId','confirmed','elapsedMs']<>'{}' OR jsonb_typeof(p_body->'confirmed') IS DISTINCT FROM 'boolean' OR coalesce(p_body->>'elapsedMs','') !~ '^\d{1,7}$' OR (p_body->>'elapsedMs')::integer>3600000 THEN RAISE EXCEPTION 'Invalid finish evidence' USING ERRCODE='22023';END IF;
  live:=(p_body->>'confirmed')::boolean AND (SELECT count(*) FROM jsonb_object_keys(b.receipts))=jsonb_array_length(b.chunks) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.chunks) c WHERE b.receipts->(c->>'id')->>'phase' IS DISTINCT FROM b.phase OR b.receipts->(c->>'id')->>'hash' IS DISTINCT FROM c->>'textHash');
  UPDATE public.eva_composite_release_batches SET state=CASE WHEN NOT live THEN 'UNKNOWN' WHEN b.phase='INDEX' THEN 'INDEXED' ELSE 'PUBLISHED' END,lease_until=null,elapsed_ms=(p_body->>'elapsedMs')::integer WHERE id=b.id;
  next_state:=CASE WHEN NOT live THEN 'UNKNOWN' WHEN b.phase='INDEX' AND NOT EXISTS(SELECT 1 FROM public.eva_composite_release_batches cb WHERE cb.release_id=r.id AND cb.state<>'INDEXED') THEN 'INDEXED_PRIVATE'
   WHEN b.phase='INDEX' THEN 'APPROVED_PRIVATE' WHEN NOT EXISTS(SELECT 1 FROM public.eva_composite_release_batches cb WHERE cb.release_id=r.id AND cb.state<>'PUBLISHED') THEN 'ACTIVE' ELSE 'PUBLISHING' END;
  PERFORM public.eva_composite_event(req,p_actor,r.id,b.id,p_action,next_state,p_body);RETURN jsonb_build_object('id',r.id,'state',next_state,'published',next_state='ACTIVE');
 END IF;
 RAISE EXCEPTION 'Unsupported command' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.eva_composite_action(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_composite_action(uuid,text,uuid,jsonb) TO service_role;

CREATE INDEX eva_composite_batch_chunk_lookup ON public.eva_composite_release_batches USING gin(chunks jsonb_path_ops);
CREATE FUNCTION public.eva_composite_public_source(p_release uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.eva_composite_releases;e public.eva_composite_release_events;review public.eva_composite_release_events;m jsonb;
BEGIN
 SELECT * INTO r FROM public.eva_composite_releases WHERE id=p_release;
 SELECT * INTO e FROM public.eva_composite_release_events WHERE release_id=p_release ORDER BY sequence DESC LIMIT 1;
 IF r.id IS NULL OR e.state IS DISTINCT FROM 'ACTIVE' OR NOT EXISTS(SELECT 1 FROM public.eva_composite_release_batches WHERE release_id=r.id) OR
  EXISTS(SELECT 1 FROM public.eva_composite_release_batches WHERE release_id=r.id AND state<>'PUBLISHED') THEN RAISE EXCEPTION 'Complete publication required' USING ERRCODE='23505';END IF;
 PERFORM public.eva_composite_live(r.id,false,true);
 SELECT * INTO review FROM public.eva_composite_release_events WHERE release_id=r.id AND action='review' ORDER BY sequence DESC LIMIT 1;m:=r.manifest;
 RETURN jsonb_build_object('publicationId',r.id,'publicationEventId',e.id,'releaseId',r.id,'revisionId',r.set_id,'documentId',m->'documentId','title',m->'title','version',m->'edition','url',m->'url',
  'family',m->'family','authority',m->'authority','markets',m->'markets','validFrom',m->'metadata'->'validFrom','validTo',m->'metadata'->'validTo','topic',m->'metadata'->'topic',
  'fileHash',m->'originalFileHash','reviewedAt',review.created_at,'reviewedBy',review.actor_id,'chunkTotal',m->'chunkTotal','kind','COMPOSITE','compositeManifestHash',r.manifest_hash,
  'originalPages',m->'originalPageCount','partCount',jsonb_array_length(m->'parts'));
END$$;
REVOKE ALL ON FUNCTION public.eva_composite_public_source(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_composite_rag(p_actor uuid,p_org text,p_role text,p_operation boolean,p_action text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.eva_composite_releases;e public.eva_composite_release_events;started public.eva_composite_release_events;
 item jsonb;hit jsonb;src jsonb;chunk jsonb;result jsonb:='[]';group_sources jsonb:='{}';legacy_proofs jsonb:='[]';legacy_hits jsonb:='[]';legacy_rows jsonb:='[]';pub uuid;
BEGIN
 -- Delegate to the existing access gate: active tenant, license, membership/role,
 -- Owner operation session and permission. No parallel weaker authorization path.
 PERFORM public.eva_corpus_rag(p_actor,p_org,p_role,p_operation,'sources',jsonb_build_object('from',to_char(current_date,'YYYY-MM-DD'),'to',to_char(current_date,'YYYY-MM-DD'),'market','COMMON'));
 IF p_action IS NULL OR p_action NOT IN ('sources','revalidate','begin','hydrate','finish') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>30000 THEN RAISE EXCEPTION 'Invalid composite retrieval' USING ERRCODE='22023';END IF;
 IF p_action='sources' THEN
  result:=public.eva_corpus_rag(p_actor,p_org,p_role,p_operation,'sources',p_body);
  FOR r IN SELECT cr.* FROM public.eva_composite_releases cr JOIN LATERAL(SELECT state FROM public.eva_composite_release_events WHERE release_id=cr.id ORDER BY sequence DESC LIMIT 1)ev ON true WHERE ev.state='ACTIVE' ORDER BY cr.created_at,cr.id LOOP
   src:=public.eva_composite_public_source(r.id);
   IF (src->>'validFrom')::date<=(p_body->>'to')::date AND (src->'validTo'='null'::jsonb OR (src->>'validTo')::date>(p_body->>'from')::date) AND ((src->'markets') ? 'COMMON' OR (src->'markets') ? (p_body->>'market')) THEN result:=result||jsonb_build_array(src);END IF;
  END LOOP;
  IF jsonb_array_length(result)>8 THEN RAISE EXCEPTION 'Corpus bound exceeded' USING ERRCODE='22023';END IF;RETURN result;
 END IF;
 IF p_action IN ('revalidate','begin','hydrate') THEN
  IF NOT p_body ? 'proofs' OR jsonb_typeof(p_body->'proofs') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'proofs') NOT BETWEEN 1 AND 8 OR p_body-ARRAY['proofs','requestId','hits']<>'{}' OR
   (SELECT count(DISTINCT value->>'publicationId') FROM jsonb_array_elements(p_body->'proofs'))<>jsonb_array_length(p_body->'proofs') THEN RAISE EXCEPTION 'Invalid publication proofs' USING ERRCODE='22023';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_body->'proofs') LOOP
   IF NOT item ?& ARRAY['publicationId','eventId'] THEN RAISE EXCEPTION 'Proof identifiers required' USING ERRCODE='22023';END IF;
   IF item ? 'kind' THEN
    IF item-ARRAY['publicationId','eventId','kind']<>'{}' OR item->>'kind' IS DISTINCT FROM 'COMPOSITE' THEN RAISE EXCEPTION 'Invalid proof kind' USING ERRCODE='22023';END IF;
    src:=public.eva_composite_public_source((item->>'publicationId')::uuid);
    IF src->>'publicationEventId' IS DISTINCT FROM item->>'eventId' THEN RAISE EXCEPTION 'Composite changed or revoked' USING ERRCODE='23505';END IF;
    group_sources:=group_sources||jsonb_build_object(src->>'releaseId',src);
   ELSE
    IF item-ARRAY['publicationId','eventId']<>'{}' THEN RAISE EXCEPTION 'Unexpected legacy proof fields' USING ERRCODE='22023';END IF;
    legacy_proofs:=legacy_proofs||jsonb_build_array(item);
   END IF;
  END LOOP;
  IF jsonb_array_length(legacy_proofs)>0 THEN PERFORM public.eva_corpus_rag(p_actor,p_org,p_role,p_operation,'revalidate',jsonb_build_object('proofs',legacy_proofs));END IF;
  IF p_action='revalidate' THEN IF p_body-'proofs'<>'{}' THEN RAISE EXCEPTION 'Unexpected revalidation fields' USING ERRCODE='22023';END IF;RETURN jsonb_build_object('valid',true);END IF;
  IF p_action='begin' THEN
   IF NOT p_body ? 'requestId' OR p_body-ARRAY['requestId','proofs']<>'{}' OR (p_body->>'requestId')::uuid IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
   INSERT INTO public.eva_composite_release_events(id,sequence,action,state,actor_id,actor_name,organization_id,payload)
   VALUES((p_body->>'requestId')::uuid,1,'query_begin','QUERY_REQUESTED',p_actor,coalesce(public.platform_workflow_name(p_actor),'Authorized user'),p_org,p_body);
   RETURN jsonb_build_object('recorded',true);
  END IF;
  IF NOT p_body ? 'hits' OR p_body-ARRAY['proofs','hits']<>'{}' OR jsonb_typeof(p_body->'hits') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'hits')>80 OR
   (SELECT count(DISTINCT ((value->>'releaseId')||'|'||(value->>'chunkId'))) FROM jsonb_array_elements(p_body->'hits'))<>jsonb_array_length(p_body->'hits') THEN RAISE EXCEPTION 'Invalid bounded hits' USING ERRCODE='22023';END IF;
  FOR hit IN SELECT value FROM jsonb_array_elements(p_body->'hits') LOOP
   IF NOT hit ?& ARRAY['releaseId','chunkId','revisionId','contentHash'] OR hit-ARRAY['releaseId','chunkId','revisionId','contentHash']<>'{}' THEN RAISE EXCEPTION 'Invalid hit shape' USING ERRCODE='22023';END IF;
   IF NOT group_sources ? (hit->>'releaseId') THEN legacy_hits:=legacy_hits||jsonb_build_array(hit);END IF;
  END LOOP;
  IF jsonb_array_length(legacy_hits)>0 THEN
   IF jsonb_array_length(legacy_proofs)=0 THEN RAISE EXCEPTION 'Hit outside authorized publications' USING ERRCODE='42501';END IF;
   legacy_rows:=public.eva_corpus_rag(p_actor,p_org,p_role,p_operation,'hydrate',jsonb_build_object('proofs',legacy_proofs,'hits',legacy_hits));
  END IF;
  FOR hit IN SELECT value FROM jsonb_array_elements(p_body->'hits') LOOP
   src:=group_sources->(hit->>'releaseId');
   IF src IS NULL THEN
    SELECT value INTO item FROM jsonb_array_elements(legacy_rows) WHERE value->>'releaseId'=hit->>'releaseId' AND value->>'chunkId'=hit->>'chunkId';
    IF item IS NULL THEN RAISE EXCEPTION 'Unauthorized legacy hit' USING ERRCODE='42501';END IF;result:=result||jsonb_build_array(item);
   ELSE
    SELECT c.value INTO chunk FROM public.eva_composite_release_batches cb CROSS JOIN LATERAL jsonb_array_elements(cb.chunks)c(value)
     WHERE cb.release_id=(hit->>'releaseId')::uuid AND cb.state='PUBLISHED' AND cb.chunks @> jsonb_build_array(jsonb_build_object('id',hit->>'chunkId')) AND c.value->>'id'=hit->>'chunkId';
    IF chunk IS NULL OR src->>'revisionId' IS DISTINCT FROM hit->>'revisionId' OR chunk->>'textHash' IS DISTINCT FROM hit->>'contentHash' OR
     chunk->>'textHash' IS DISTINCT FROM encode(sha256(convert_to(chunk->>'text','UTF8')),'hex') OR (chunk->>'page')::integer NOT BETWEEN 1 AND (src->>'originalPages')::integer THEN RAISE EXCEPTION 'Composite hit integrity failed' USING ERRCODE='23505';END IF;
    result:=result||jsonb_build_array(src||jsonb_build_object('chunkId',chunk->'id','text',chunk->'text','textHash',chunk->'textHash','page',chunk->'page','heading',chunk->'heading','context',chunk->'context'));
   END IF;
  END LOOP;
  RETURN result;
 END IF;
 IF NOT p_body ?& ARRAY['requestId','eventId','state','elapsedMs','inputTokens','searchRequests','embeddingCostMicroUsd'] OR p_body-ARRAY['requestId','eventId','state','elapsedMs','inputTokens','searchRequests','embeddingCostMicroUsd']<>'{}' OR coalesce(p_body->>'state','') NOT IN ('READY','NO_EVIDENCE','FAILED') OR coalesce(p_body->>'elapsedMs','') !~ '^\d{1,7}$' OR (p_body->>'elapsedMs')::integer>3600000 OR coalesce(p_body->>'inputTokens','') !~ '^\d{1,4}$' OR (p_body->>'inputTokens')::integer>2000 OR coalesce(p_body->>'searchRequests','') !~ '^[0-8]$' OR
  (p_body->'embeddingCostMicroUsd'<>'null'::jsonb AND coalesce(p_body->>'embeddingCostMicroUsd','') !~ '^\d{1,12}$') THEN RAISE EXCEPTION 'Invalid retrieval metrics' USING ERRCODE='22023';END IF;
 SELECT * INTO started FROM public.eva_composite_release_events WHERE id=(p_body->>'requestId')::uuid AND action='query_begin' AND actor_id=p_actor AND organization_id=p_org;
 IF started.id IS NULL OR (p_body->>'eventId')::uuid IS NULL OR (p_body->>'eventId')::uuid=started.id THEN RAISE EXCEPTION 'Audited request required' USING ERRCODE='23505';END IF;
 INSERT INTO public.eva_composite_release_events(id,sequence,action,state,actor_id,actor_name,organization_id,payload)
 VALUES((p_body->>'eventId')::uuid,2,'query_finish','QUERY_'||(p_body->>'state'),p_actor,coalesce(public.platform_workflow_name(p_actor),'Authorized user'),p_org,p_body-'eventId');
 RETURN jsonb_build_object('recorded',true);
END$$;
REVOKE ALL ON FUNCTION public.eva_composite_rag(uuid,text,text,boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_composite_rag(uuid,text,text,boolean,text,jsonb) TO service_role;
COMMIT;
