BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Immutable aggregate revisions provide history without a third table.
CREATE TABLE public.eva_official_document_part_sets(
 id uuid PRIMARY KEY,chain_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 parent_id uuid REFERENCES public.eva_official_document_part_sets(id),
 document_id uuid NOT NULL,original_revision_id uuid NOT NULL,operation_id uuid NOT NULL,
 source_event_id uuid NOT NULL REFERENCES public.eva_official_source_events(id),
 original_file_hash text NOT NULL CHECK(original_file_hash ~ '^[a-f0-9]{64}$'),
 original_page_count integer NOT NULL CHECK(original_page_count BETWEEN 101 AND 500),
 manifest jsonb NOT NULL,manifest_hash text NOT NULL CHECK(manifest_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('DRAFT','REVIEWED_PRIVATE','QUARANTINED')),
 action text NOT NULL CHECK(action IN ('prepare','link','review','quarantine')),
 actor_id uuid NOT NULL,justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 1000 AND justification !~ '[[:cntrl:]]'),
 input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(chain_id,revision),FOREIGN KEY(original_revision_id,document_id) REFERENCES public.eva_official_document_revisions(id,document_id),
 FOREIGN KEY(operation_id,original_revision_id,document_id) REFERENCES public.eva_official_storage_operations(id,revision_id,document_id));
CREATE TABLE public.eva_official_document_parts(
 set_id uuid NOT NULL REFERENCES public.eva_official_document_part_sets(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 25),
 start_page integer NOT NULL CHECK(start_page>0),end_page integer NOT NULL CHECK(end_page>=start_page AND end_page-start_page<40),
 file_hash text NOT NULL CHECK(file_hash ~ '^[a-f0-9]{64}$'),size integer NOT NULL CHECK(size BETWEEN 20 AND 26214400),
 page_text_hashes jsonb NOT NULL CHECK(jsonb_typeof(page_text_hashes)='array' AND jsonb_array_length(page_text_hashes)=end_page-start_page+1),
 derived_revision_id uuid REFERENCES public.eva_official_document_revisions(id),
 job_id uuid REFERENCES public.eva_official_extraction_jobs(id),
 curation_version_id uuid,PRIMARY KEY(set_id,ordinal),UNIQUE(set_id,file_hash),
 FOREIGN KEY(curation_version_id,job_id) REFERENCES public.eva_official_extraction_versions(id,job_id),
 CHECK((derived_revision_id IS NULL AND job_id IS NULL AND curation_version_id IS NULL) OR
       (derived_revision_id IS NOT NULL AND job_id IS NOT NULL AND curation_version_id IS NOT NULL)));
CREATE INDEX eva_document_parts_hash ON public.eva_official_document_parts(file_hash);
CREATE INDEX eva_document_parts_latest ON public.eva_official_document_part_sets(chain_id,revision DESC);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['eva_official_document_part_sets','eva_official_document_parts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER eva_parts_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable()',t);
 END LOOP;
END$$;

CREATE FUNCTION public.eva_document_parts_origin(p_set uuid,p_lock boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.eva_official_document_part_sets;d public.eva_official_document_events;se public.eva_official_source_events;dr public.eva_official_document_revisions;
BEGIN
 SELECT * INTO s FROM public.eva_official_document_part_sets WHERE id=p_set;IF s.id IS NULL THEN RETURN false;END IF;
 IF p_lock THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-document:'||s.document_id::text,0));
  SELECT * INTO dr FROM public.eva_official_document_revisions WHERE id=s.original_revision_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-source:'||(SELECT source_id::text FROM public.eva_official_documents WHERE id=s.document_id),0));
 END IF;
 SELECT * INTO d FROM public.eva_official_document_events WHERE document_id=s.document_id ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO se FROM public.eva_official_source_events WHERE source_id=(SELECT source_id FROM public.eva_official_documents WHERE id=s.document_id) ORDER BY sequence DESC LIMIT 1;
 RETURN coalesce(d.state='PRESERVED' AND d.diagnostic='VERIFIED' AND d.revision_id=s.original_revision_id AND d.operation_id=s.operation_id AND se.state='REGISTERED' AND se.id=s.source_event_id,false);
END$$;
REVOKE ALL ON FUNCTION public.eva_document_parts_origin(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_document_parts_action(p_actor uuid,p_action text,p_set uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.eva_official_document_part_sets;latest public.eva_official_document_part_sets;prior public.eva_official_document_part_sets;
 d public.eva_official_document_events;r public.eva_official_document_revisions;op public.eva_official_storage_operations;se public.eva_official_source_events;
 part public.eva_official_document_parts;j public.eva_official_extraction_jobs;v public.eva_official_extraction_versions;ce public.eva_official_curation_events;
 req uuid;doc uuid;pg integer;hp integer;n integer;next_page integer;obj jsonb;m jsonb;mh text;new_state text;locked_id uuid;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=p_actor::text FOR SHARE OF ur,rr,tm;
 PERFORM public.platform_team_owner(p_actor);
 IF p_action IS NULL OR p_action NOT IN ('list','detail','original','prepare','download','link','review','quarantine') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>160000 THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 IF p_action='list' THEN
  IF p_set IS NOT NULL OR NOT p_body ?& ARRAY['page','search','state'] OR p_body-ARRAY['page','search','state']<>'{}'::jsonb OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 OR jsonb_typeof(p_body->'search') IS DISTINCT FROM 'string' OR length(p_body->>'search')>100 OR coalesce(p_body->>'state','!') NOT IN ('','DRAFT','REVIEWED_PRIVATE','QUARANTINED') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;
  RETURN (WITH current AS(SELECT DISTINCT ON(chain_id) * FROM public.eva_official_document_part_sets ORDER BY chain_id,revision DESC),
   filtered AS(SELECT c.*,dr_list.metadata->>'title' AS title FROM current c JOIN public.eva_official_document_revisions dr_list ON dr_list.id=c.original_revision_id WHERE (p_body->>'state'='' OR c.state=p_body->>'state') AND (p_body->>'search'='' OR strpos(lower(dr_list.metadata->>'title'),lower(p_body->>'search'))>0)),
   paged AS(SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 10 OFFSET pg*10)
   SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'chainId',chain_id,'revision',revision,'title',title,'state',state,'pages',original_page_count,'partCount',jsonb_array_length(manifest->'parts'),'createdAt',created_at) ORDER BY created_at DESC,id) FROM paged),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',pg,'pageSize',10));
 END IF;
 IF p_action IN ('original','prepare') THEN
  IF p_set IS NOT NULL OR NOT p_body ?& ARRAY['requestId','documentId','expectedEventId','expectedRevisionHash','operationId','justification'] OR p_body-ARRAY['requestId','documentId','expectedEventId','expectedRevisionHash','operationId','justification','manifest']<>'{}'::jsonb OR (p_action='original' AND p_body ? 'manifest') OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid original' USING ERRCODE='22023';END IF;
  req:=(p_body->>'requestId')::uuid;doc:=(p_body->>'documentId')::uuid;
  IF req IS NULL OR doc IS NULL OR p_body->>'justification' IS NULL THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-document-parts-request:'||req::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-document:'||doc::text,0));
  SELECT * INTO d FROM public.eva_official_document_events WHERE document_id=doc ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO r FROM public.eva_official_document_revisions WHERE id=d.revision_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-source:'||(SELECT source_id::text FROM public.eva_official_documents WHERE id=doc),0));
  SELECT * INTO se FROM public.eva_official_source_events WHERE source_id=(SELECT source_id FROM public.eva_official_documents WHERE id=doc) ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO op FROM public.eva_official_storage_operations WHERE id=d.operation_id;
  IF d.id IS NULL OR d.state<>'PRESERVED' OR d.diagnostic<>'VERIFIED' OR d.id IS DISTINCT FROM (p_body->>'expectedEventId')::uuid OR r.metadata_hash IS DISTINCT FROM p_body->>'expectedRevisionHash' OR op.id IS DISTINCT FROM (p_body->>'operationId')::uuid OR se.id IS DISTINCT FROM r.source_event_id OR se.state<>'REGISTERED' THEN RAISE EXCEPTION 'Original changed' USING ERRCODE='23505';END IF;
  IF p_action='original' THEN RETURN jsonb_build_object('fileHash',op.file_hash,'size',op.size);END IF;
  m:=p_body->'manifest';
  IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR NOT m ?& ARRAY['version','originalFileHash','originalPageCount','parts'] OR m-ARRAY['version','originalFileHash','originalPageCount','parts']<>'{}'::jsonb OR m->>'version' IS DISTINCT FROM 'pdf-lib-1.17.1-parts-v1' OR m->>'originalFileHash' IS DISTINCT FROM op.file_hash OR jsonb_typeof(m->'originalPageCount') IS DISTINCT FROM 'number' OR m->>'originalPageCount' !~ '^\d{3}$' OR (m->>'originalPageCount')::integer NOT BETWEEN 101 AND 500 OR jsonb_typeof(m->'parts') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'parts') NOT BETWEEN 2 AND 25 THEN RAISE EXCEPTION 'Invalid manifest' USING ERRCODE='22023';END IF;
  n:=0;next_page:=1;
  FOR obj IN SELECT value FROM jsonb_array_elements(m->'parts') LOOP
   n:=n+1;
   IF jsonb_typeof(obj) IS DISTINCT FROM 'object' OR NOT obj ?& ARRAY['ordinal','startPage','endPage','pageCount','fileHash','size','pageTextHashes'] OR obj-ARRAY['ordinal','startPage','endPage','pageCount','fileHash','size','pageTextHashes']<>'{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_each(obj) e WHERE e.key IN ('ordinal','startPage','endPage','pageCount','size') AND (jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^\d+$')) OR (obj->>'ordinal')::integer<>n OR (obj->>'startPage')::integer<>next_page OR (obj->>'endPage')::integer<(obj->>'startPage')::integer OR (obj->>'pageCount')::integer<>(obj->>'endPage')::integer-next_page+1 OR (obj->>'pageCount')::integer NOT BETWEEN 1 AND 40 OR coalesce(obj->>'fileHash','!') !~ '^[a-f0-9]{64}$' OR obj->>'fileHash'=op.file_hash OR (obj->>'size')::bigint NOT BETWEEN 20 AND 26214400 OR jsonb_typeof(obj->'pageTextHashes') IS DISTINCT FROM 'array' OR jsonb_array_length(obj->'pageTextHashes')<>(obj->>'pageCount')::integer OR EXISTS(SELECT 1 FROM jsonb_array_elements(obj->'pageTextHashes') h WHERE jsonb_typeof(h)<>'string' OR h#>>'{}' !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Invalid part' USING ERRCODE='22023';END IF;
   next_page:=(obj->>'endPage')::integer+1;
   PERFORM pg_advisory_xact_lock(hashtextextended('eva-document-part-file:'||(obj->>'fileHash'),0));
   IF EXISTS(SELECT 1 FROM public.eva_search_releases sr JOIN public.eva_official_extraction_jobs ej ON ej.id=sr.job_id WHERE ej.file_hash=obj->>'fileHash') THEN RAISE EXCEPTION 'Existing release must be preserved' USING ERRCODE='23505';END IF;
  END LOOP;
  IF next_page<>(m->>'originalPageCount')::integer+1 THEN RAISE EXCEPTION 'Incomplete coverage' USING ERRCODE='22023';END IF;
  mh:=encode(sha256(convert_to(m::text,'UTF8')),'hex');
  SELECT * INTO prior FROM public.eva_official_document_part_sets WHERE id=req;
  IF prior.id IS NOT NULL THEN IF prior.actor_id IS DISTINCT FROM p_actor OR prior.input IS DISTINCT FROM p_body OR prior.action<>'prepare' THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('id',prior.id,'state',prior.state,'replayed',true);END IF;
  IF EXISTS(SELECT 1 FROM public.eva_official_document_part_sets WHERE original_revision_id=r.id AND manifest_hash=mh) THEN RAISE EXCEPTION 'Already prepared' USING ERRCODE='23505';END IF;
  INSERT INTO public.eva_official_document_part_sets(id,chain_id,revision,document_id,original_revision_id,operation_id,source_event_id,original_file_hash,original_page_count,manifest,manifest_hash,state,action,actor_id,justification,input) VALUES(req,req,1,doc,r.id,op.id,se.id,op.file_hash,(m->>'originalPageCount')::integer,m,mh,'DRAFT','prepare',p_actor,p_body->>'justification',p_body);
  INSERT INTO public.eva_official_document_parts(set_id,ordinal,start_page,end_page,file_hash,size,page_text_hashes) SELECT req,(x->>'ordinal')::integer,(x->>'startPage')::integer,(x->>'endPage')::integer,x->>'fileHash',(x->>'size')::integer,x->'pageTextHashes' FROM jsonb_array_elements(m->'parts') x;
  RETURN jsonb_build_object('id',req,'state','DRAFT','readyForSearch',false);
 END IF;
 SELECT * INTO s FROM public.eva_official_document_part_sets WHERE id=p_set;IF s.id IS NULL THEN RAISE EXCEPTION 'Set unavailable' USING ERRCODE='23505';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-document-parts-chain:'||s.chain_id::text,0));
 SELECT * INTO latest FROM public.eva_official_document_part_sets WHERE chain_id=s.chain_id ORDER BY revision DESC LIMIT 1;
 IF p_action='detail' THEN
  IF NOT p_body ?& ARRAY['page'] OR p_body-ARRAY['page']<>'{}'::jsonb OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;hp:=(p_body->>'page')::integer;
  RETURN jsonb_build_object('id',s.id,'chainId',s.chain_id,'latestId',latest.id,'revision',s.revision,'state',s.state,'title',(SELECT metadata->>'title' FROM public.eva_official_document_revisions WHERE id=s.original_revision_id),'originalFileHash',s.original_file_hash,'originalPages',s.original_page_count,'manifestHash',s.manifest_hash,'originCurrent',public.eva_document_parts_origin(s.id),'readyForSearch',false,
   'parts',(SELECT jsonb_agg(jsonb_build_object('ordinal',p.ordinal,'startPage',p.start_page,'endPage',p.end_page,'fileHash',p.file_hash,'size',p.size,'derivedRevisionId',p.derived_revision_id,'jobId',p.job_id,'curationVersionId',p.curation_version_id,'curationCurrent',coalesce(public.eva_extraction_origin(p.job_id,false) AND p.curation_version_id=(SELECT ev.id FROM public.eva_official_extraction_versions ev WHERE ev.job_id=p.job_id ORDER BY ev.version DESC LIMIT 1) AND (SELECT ec.state='REVIEWED' AND ec.version_id=p.curation_version_id FROM public.eva_official_curation_events ec WHERE ec.job_id=p.job_id ORDER BY ec.sequence DESC LIMIT 1),false)) ORDER BY p.ordinal) FROM public.eva_official_document_parts p WHERE p.set_id=s.id),
   'history',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.revision DESC),'[]'::jsonb) FROM (SELECT id,revision,action,state,actor_id,justification,created_at FROM public.eva_official_document_part_sets WHERE chain_id=s.chain_id ORDER BY revision DESC LIMIT 10 OFFSET hp*10) h),'historyTotal',(SELECT count(*) FROM public.eva_official_document_part_sets WHERE chain_id=s.chain_id));
 END IF;
 IF p_action='download' THEN
  IF p_body<>'{}'::jsonb OR s.id<>latest.id OR s.state='QUARANTINED' OR NOT public.eva_document_parts_origin(s.id,true) THEN RAISE EXCEPTION 'Set changed' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('originalFileHash',s.original_file_hash,'manifest',s.manifest);
 END IF;
 IF NOT p_body ?& ARRAY['requestId','expectedSetId','justification'] OR p_body-ARRAY['requestId','expectedSetId','justification','ordinal','jobId','expectedVersionId','expectedContentHash']<>'{}'::jsonb OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' OR p_body->>'justification' IS NULL THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-document-parts-request:'||req::text,0));
 SELECT * INTO prior FROM public.eva_official_document_part_sets WHERE id=req;
 IF prior.id IS NOT NULL THEN IF prior.parent_id IS DISTINCT FROM s.id OR prior.actor_id IS DISTINCT FROM p_actor OR prior.action IS DISTINCT FROM p_action OR prior.input IS DISTINCT FROM p_body THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('id',prior.id,'state',prior.state,'replayed',true);END IF;
 IF s.id<>latest.id OR s.id IS DISTINCT FROM (p_body->>'expectedSetId')::uuid OR s.state='QUARANTINED' THEN RAISE EXCEPTION 'Set changed' USING ERRCODE='23505';END IF;
 -- Match the extraction lock order: jobs, documents, source. Lock the complete
 -- aggregate in stable order before checking live origin/curation references.
 IF p_action IN ('link','review') THEN
  FOR locked_id IN SELECT DISTINCT x FROM (SELECT job_id AS x FROM public.eva_official_document_parts WHERE set_id=s.id AND job_id IS NOT NULL UNION SELECT (p_body->>'jobId')::uuid WHERE p_action='link') refs ORDER BY x LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-job:'||locked_id::text,0));
  END LOOP;
  FOR locked_id IN SELECT DISTINCT x FROM (SELECT s.document_id AS x UNION SELECT ej.document_id FROM public.eva_official_extraction_jobs ej WHERE ej.id IN (SELECT job_id FROM public.eva_official_document_parts WHERE set_id=s.id) OR (p_action='link' AND ej.id=(p_body->>'jobId')::uuid)) refs ORDER BY x LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-document:'||locked_id::text,0));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-source:'||(SELECT source_id::text FROM public.eva_official_documents WHERE id=s.document_id),0));
 END IF;
 IF p_action<>'quarantine' AND NOT public.eva_document_parts_origin(s.id,false) THEN RAISE EXCEPTION 'Origin changed' USING ERRCODE='23505';END IF;
 IF p_action='link' THEN
  IF NOT p_body ?& ARRAY['ordinal','jobId','expectedVersionId','expectedContentHash'] OR jsonb_typeof(p_body->'ordinal') IS DISTINCT FROM 'number' OR p_body->>'ordinal' !~ '^\d{1,2}$' THEN RAISE EXCEPTION 'Invalid linkage' USING ERRCODE='22023';END IF;
  SELECT * INTO part FROM public.eva_official_document_parts WHERE set_id=s.id AND ordinal=(p_body->>'ordinal')::integer;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-job:'||(p_body->>'jobId'),0));
  SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=(p_body->>'jobId')::uuid;
  SELECT * INTO v FROM public.eva_official_extraction_versions WHERE job_id=j.id ORDER BY version DESC LIMIT 1;
  IF part.set_id IS NULL OR j.id IS NULL OR j.test_only OR j.file_hash IS DISTINCT FROM part.file_hash OR j.document_id=s.document_id OR j.source_id IS DISTINCT FROM (SELECT source_id FROM public.eva_official_documents WHERE id=s.document_id) OR NOT public.eva_extraction_origin(j.id,true) OR v.id IS DISTINCT FROM (p_body->>'expectedVersionId')::uuid OR v.content_hash IS DISTINCT FROM p_body->>'expectedContentHash' OR v.page_count IS DISTINCT FROM part.end_page-part.start_page+1 THEN RAISE EXCEPTION 'Derived evidence changed' USING ERRCODE='23505';END IF;
 ELSIF p_body-ARRAY['requestId','expectedSetId','justification']<>'{}'::jsonb THEN RAISE EXCEPTION 'Unexpected decision fields' USING ERRCODE='22023';END IF;
 IF p_action='review' THEN
  IF EXISTS(SELECT 1 FROM public.eva_official_document_part_sets WHERE chain_id=s.chain_id AND action IN ('prepare','link') AND actor_id=p_actor) THEN RAISE EXCEPTION 'Independent Owner required' USING ERRCODE='42501';END IF;
  FOR part IN SELECT * FROM public.eva_official_document_parts WHERE set_id=s.id ORDER BY ordinal LOOP
   IF part.job_id IS NULL OR NOT public.eva_extraction_origin(part.job_id,true) THEN RAISE EXCEPTION 'Complete curation required' USING ERRCODE='23505';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-job:'||part.job_id::text,0));
   SELECT * INTO v FROM public.eva_official_extraction_versions WHERE job_id=part.job_id ORDER BY version DESC LIMIT 1;
   SELECT * INTO ce FROM public.eva_official_curation_events WHERE job_id=part.job_id ORDER BY sequence DESC LIMIT 1;
   IF v.id IS DISTINCT FROM part.curation_version_id OR ce.version_id IS DISTINCT FROM v.id OR ce.state IS DISTINCT FROM 'REVIEWED' OR ce.actor_id=p_actor OR EXISTS(SELECT 1 FROM public.eva_official_extraction_sections WHERE version_id=v.id AND issues<>'[]'::jsonb) THEN RAISE EXCEPTION 'Independent current curation required' USING ERRCODE='23505';END IF;
  END LOOP;
 END IF;
 new_state:=CASE p_action WHEN 'review' THEN 'REVIEWED_PRIVATE' WHEN 'quarantine' THEN 'QUARANTINED' ELSE 'DRAFT' END;
 INSERT INTO public.eva_official_document_part_sets(id,chain_id,revision,parent_id,document_id,original_revision_id,operation_id,source_event_id,original_file_hash,original_page_count,manifest,manifest_hash,state,action,actor_id,justification,input) VALUES(req,s.chain_id,s.revision+1,s.id,s.document_id,s.original_revision_id,s.operation_id,s.source_event_id,s.original_file_hash,s.original_page_count,s.manifest,s.manifest_hash,new_state,p_action,p_actor,p_body->>'justification',p_body);
 INSERT INTO public.eva_official_document_parts SELECT req,ordinal,start_page,end_page,file_hash,size,page_text_hashes,CASE WHEN p_action='link' AND ordinal=part.ordinal THEN j.document_revision_id ELSE derived_revision_id END,CASE WHEN p_action='link' AND ordinal=part.ordinal THEN j.id ELSE job_id END,CASE WHEN p_action='link' AND ordinal=part.ordinal THEN v.id ELSE curation_version_id END FROM public.eva_official_document_parts WHERE set_id=s.id;
 RETURN jsonb_build_object('id',req,'state',new_state,'readyForSearch',false);
END$$;
REVOKE ALL ON FUNCTION public.eva_document_parts_action(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_document_parts_action(uuid,text,uuid,jsonb) TO service_role;

-- No long-document part can enter the current single-document publication chain.
CREATE FUNCTION public.eva_document_parts_search_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h text;BEGIN
 SELECT file_hash INTO h FROM public.eva_official_extraction_jobs WHERE id=NEW.job_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-document-part-file:'||h,0));
 IF EXISTS(SELECT 1 FROM public.eva_official_document_parts WHERE file_hash=h) THEN RAISE EXCEPTION 'Composite publication not enabled' USING ERRCODE='23505';END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.eva_document_parts_search_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER eva_document_parts_search_guard BEFORE INSERT ON public.eva_search_releases FOR EACH ROW EXECUTE FUNCTION public.eva_document_parts_search_guard();
COMMIT;
