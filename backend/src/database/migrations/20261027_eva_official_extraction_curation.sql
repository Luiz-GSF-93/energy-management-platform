BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_official_extraction_jobs(
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES public.eva_official_documents(id),
 document_revision_id uuid NOT NULL, operation_id uuid NOT NULL UNIQUE,
 source_id uuid NOT NULL REFERENCES public.eva_official_sources(id),source_event_id uuid NOT NULL REFERENCES public.eva_official_source_events(id),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),file_hash text NOT NULL CHECK(file_hash ~ '^[a-f0-9]{64}$'),
 extractor text NOT NULL CHECK(extractor='pdfjs-6.4.299-text-v1'),test_only boolean NOT NULL,
 actor_id uuid NOT NULL,input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(operation_id,document_revision_id,document_id) REFERENCES public.eva_official_storage_operations(id,revision_id,document_id));
CREATE TABLE public.eva_official_extraction_job_events(
 id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES public.eva_official_extraction_jobs(id),sequence integer NOT NULL CHECK(sequence>0),
 state text NOT NULL CHECK(state IN ('QUEUED','RUNNING','SUCCEEDED','OCR_REQUIRED','BLOCKED','FAILED','WITHDRAWN')),
 token uuid,lease_until timestamptz,attempt integer NOT NULL CHECK(attempt BETWEEN 0 AND 3),
 diagnostic text NOT NULL CHECK(diagnostic IN ('NONE','VERIFIED','OCR_REQUIRED','SOURCE_CHANGED','OWNER_REVOKED','INTEGRITY','LIMIT','PDF_INVALID','NETWORK','EXTRACTION_FAILED','LEASE_EXPIRED','WITHDRAWN')),
 duration_ms integer NOT NULL DEFAULT 0 CHECK(duration_ms BETWEEN 0 AND 600000),actor_id uuid,input jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(job_id,sequence));
CREATE TABLE public.eva_official_extraction_versions(
 id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES public.eva_official_extraction_jobs(id),version integer NOT NULL CHECK(version>0),
 kind text NOT NULL CHECK(kind IN ('EXTRACTED','CURATED')),parent_id uuid REFERENCES public.eva_official_extraction_versions(id),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),page_count integer NOT NULL CHECK(page_count BETWEEN 1 AND 100),
 metadata jsonb NOT NULL,actor_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(job_id,version),UNIQUE(id,job_id));
CREATE TABLE public.eva_official_extraction_sections(
 id uuid PRIMARY KEY,version_id uuid NOT NULL REFERENCES public.eva_official_extraction_versions(id),position integer NOT NULL CHECK(position BETWEEN 0 AND 1999),
 page integer NOT NULL CHECK(page BETWEEN 1 AND 100),start_offset integer NOT NULL CHECK(start_offset>=0),end_offset integer NOT NULL CHECK(end_offset>=start_offset),
 heading text NOT NULL CHECK(length(heading)<=200),content text NOT NULL CHECK(octet_length(content)<=16000),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),issues jsonb NOT NULL CHECK(jsonb_typeof(issues)='array'),
 origin_section_id uuid REFERENCES public.eva_official_extraction_sections(id),UNIQUE(version_id,position));
CREATE TABLE public.eva_official_curation_events(
 id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES public.eva_official_extraction_jobs(id),version_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0),state text NOT NULL CHECK(state IN ('DRAFT','REVIEWED','QUARANTINED')),
 action text NOT NULL CHECK(action IN ('extract','correct','review','quarantine')),actor_id uuid,
 justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 1000 AND justification !~ '[[:cntrl:]]'),
 input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(job_id,sequence),
 FOREIGN KEY(version_id,job_id) REFERENCES public.eva_official_extraction_versions(id,job_id));
CREATE INDEX eva_extraction_job_latest ON public.eva_official_extraction_job_events(job_id,sequence DESC);
CREATE INDEX eva_curation_latest ON public.eva_official_curation_events(job_id,sequence DESC);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['eva_official_extraction_jobs','eva_official_extraction_job_events','eva_official_extraction_versions','eva_official_extraction_sections','eva_official_curation_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER eva_extraction_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable()',t);
 END LOOP;
END$$;

-- Private helper: no direct execution granted to clients or service_role.
CREATE FUNCTION public.eva_extraction_origin(p_job uuid,p_lock boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.eva_official_extraction_jobs;e public.eva_official_document_events;s public.eva_official_source_events;r public.eva_official_source_revisions;
BEGIN
 SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=p_job;IF j.id IS NULL THEN RETURN false;END IF;
 IF p_lock THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-document:'||j.document_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-source:'||j.source_id::text,0));
 END IF;
 SELECT * INTO e FROM public.eva_official_document_events WHERE document_id=j.document_id ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO s FROM public.eva_official_source_events WHERE source_id=j.source_id ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO r FROM public.eva_official_source_revisions WHERE id=s.revision_id;
 RETURN coalesce(e.state='PRESERVED' AND e.diagnostic='VERIFIED' AND e.revision_id=j.document_revision_id AND e.operation_id=j.operation_id
  AND s.state='REGISTERED' AND s.id=j.source_event_id AND r.metadata_hash=j.source_hash,false);
END$$;
REVOKE ALL ON FUNCTION public.eva_extraction_origin(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_official_extraction_action(p_actor uuid,p_action text,p_job uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.eva_official_extraction_jobs;je public.eva_official_extraction_job_events;prior_job_event public.eva_official_extraction_job_events;ce public.eva_official_curation_events;
 v public.eva_official_extraction_versions;de public.eva_official_document_events;dr public.eva_official_document_revisions;
 op public.eva_official_storage_operations;src public.eva_official_source_events;sr public.eva_official_source_revisions;
 req uuid;pg integer;hp integer;sp integer;meta jsonb;patch jsonb;ack jsonb;new_version uuid;result jsonb;
 row_section public.eva_official_extraction_sections;changed text; new_hash text;pos integer;synthetic boolean;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=p_actor::text FOR SHARE OF ur,rr,tm;
 PERFORM public.platform_team_owner(p_actor);
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>80000 OR p_action IS NULL OR p_action NOT IN ('list','detail','original','prepare','withdraw','retry','correct','review','quarantine') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 IF p_action='original' THEN
  IF p_job IS NULL OR p_body<>'{}'::jsonb OR NOT public.eva_extraction_origin(p_job,true) THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='23505';END IF;
  SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=p_job;SELECT * INTO op FROM public.eva_official_storage_operations WHERE id=j.operation_id;
  RETURN jsonb_build_object('objectKey',op.object_key,'fileHash',op.file_hash,'size',op.size);
 END IF;
 IF p_action IN ('list','detail') THEN
  IF jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;pg:=(p_body->>'page')::integer;
  IF p_action='list' THEN
   IF p_job IS NOT NULL OR NOT p_body ?& ARRAY['page','search','state'] OR p_body-ARRAY['page','search','state']<>'{}'::jsonb OR jsonb_typeof(p_body->'search') IS DISTINCT FROM 'string' OR length(p_body->>'search')>100 OR coalesce(p_body->>'state','!') NOT IN ('','QUEUED','RUNNING','SUCCEEDED','OCR_REQUIRED','BLOCKED','FAILED','WITHDRAWN','DRAFT','REVIEWED','QUARANTINED') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
   WITH current_jobs AS(SELECT x.id,x.document_id,x.test_only,r.metadata->>'title' AS title,e.state AS processing,coalesce(c.state,'DRAFT') AS curation FROM public.eva_official_extraction_jobs x JOIN public.eva_official_document_revisions r ON r.id=x.document_revision_id
    CROSS JOIN LATERAL(SELECT * FROM public.eva_official_extraction_job_events WHERE job_id=x.id ORDER BY sequence DESC LIMIT 1)e
    LEFT JOIN LATERAL(SELECT * FROM public.eva_official_curation_events WHERE job_id=x.id ORDER BY sequence DESC LIMIT 1)c ON true),
    filtered AS(SELECT * FROM current_jobs WHERE (p_body->>'search'='' OR strpos(lower(title),lower(p_body->>'search'))>0) AND (p_body->>'state'='' OR processing=p_body->>'state' OR curation=p_body->>'state')),
    paged AS(SELECT * FROM filtered ORDER BY title,id LIMIT 10 OFFSET pg*10)
   SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x)||jsonb_build_object('origin_current',public.eva_extraction_origin(x.id,false)) ORDER BY title,id) FROM paged x),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',pg,'pageSize',10) INTO result;RETURN result;
  END IF;
  IF p_job IS NULL OR NOT p_body ?& ARRAY['page','sectionPage'] OR p_body-ARRAY['page','sectionPage']<>'{}'::jsonb OR jsonb_typeof(p_body->'sectionPage') IS DISTINCT FROM 'number' OR p_body->>'sectionPage' !~ '^\d{1,4}$' OR (p_body->>'sectionPage')::integer>1000 THEN RAISE EXCEPTION 'Invalid detail' USING ERRCODE='22023';END IF;sp:=(p_body->>'sectionPage')::integer;
  SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=p_job;IF j.id IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='22023';END IF;
  SELECT * INTO je FROM public.eva_official_extraction_job_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO ce FROM public.eva_official_curation_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO v FROM public.eva_official_extraction_versions WHERE job_id=p_job ORDER BY version DESC LIMIT 1;
  SELECT * INTO dr FROM public.eva_official_document_revisions WHERE id=j.document_revision_id;
  RETURN jsonb_build_object('id',j.id,'documentId',j.document_id,'title',dr.metadata->>'title','testOnly',j.test_only,'originCurrent',public.eva_extraction_origin(j.id,false),
   'processing',je.state,'processingEventId',je.id,'diagnostic',je.diagnostic,'attempt',je.attempt,'durationMs',je.duration_ms,'curation',coalesce(ce.state,'DRAFT'),'curationEventId',ce.id,
   'versionId',v.id,'version',v.version,'contentHash',v.content_hash,'pageCount',v.page_count,'metadata',v.metadata,'sectionTotal',(SELECT count(*) FROM public.eva_official_extraction_sections WHERE version_id=v.id),
   'sections',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY position) FROM(SELECT id,position,page,start_offset,end_offset,heading,content,content_hash,issues,origin_section_id FROM public.eva_official_extraction_sections WHERE version_id=v.id ORDER BY position LIMIT 10 OFFSET sp*10)x),'[]'::jsonb),
   'historyTotal',(SELECT count(*) FROM public.eva_official_curation_events WHERE job_id=p_job),
   'history',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY sequence DESC) FROM(SELECT id,version_id,sequence,state,action,actor_id,justification,created_at FROM public.eva_official_curation_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 10 OFFSET pg*10)x),'[]'::jsonb),
   'processingHistory',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY sequence DESC) FROM(SELECT id,sequence,state,attempt,diagnostic,duration_ms,created_at FROM public.eva_official_extraction_job_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 10 OFFSET pg*10)x),'[]'::jsonb),
   'processingHistoryTotal',(SELECT count(*) FROM public.eva_official_extraction_job_events WHERE job_id=p_job),'readyForFutureIndex',false);
 END IF;
 IF NOT p_body ?& ARRAY['requestId','justification'] OR jsonb_typeof(p_body->'requestId') IS DISTINCT FROM 'string' OR p_body->>'requestId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-request:'||req::text,0));
 IF p_action='prepare' THEN
  IF p_job IS NOT NULL OR NOT p_body ?& ARRAY['requestId','justification','documentId','expectedEventId','expectedRevisionHash','operationId','testOnly'] OR p_body-ARRAY['requestId','justification','documentId','expectedEventId','expectedRevisionHash','operationId','testOnly']<>'{}'::jsonb OR jsonb_typeof(p_body->'testOnly') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=req;
  IF j.id IS NOT NULL THEN IF j.actor_id<>p_actor OR j.input<>p_body THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('id',j.id,'replayed',true);END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-document:'||(p_body->>'documentId'),0));
  SELECT * INTO de FROM public.eva_official_document_events WHERE document_id=(p_body->>'documentId')::uuid ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO dr FROM public.eva_official_document_revisions WHERE id=de.revision_id;
  SELECT * INTO op FROM public.eva_official_storage_operations WHERE id=de.operation_id;
  SELECT source_id INTO j.source_id FROM public.eva_official_documents WHERE id=de.document_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-source:'||j.source_id::text,0));
  SELECT * INTO src FROM public.eva_official_source_events WHERE source_id=j.source_id ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO sr FROM public.eva_official_source_revisions WHERE id=src.revision_id;
  IF de.id IS NULL OR de.state<>'PRESERVED' OR de.diagnostic<>'VERIFIED' OR de.id::text IS DISTINCT FROM p_body->>'expectedEventId' OR dr.metadata_hash IS DISTINCT FROM p_body->>'expectedRevisionHash' OR op.id::text IS DISTINCT FROM p_body->>'operationId' OR src.state IS DISTINCT FROM 'REGISTERED' OR src.id IS DISTINCT FROM dr.source_event_id OR sr.metadata_hash IS DISTINCT FROM dr.source_revision_hash THEN RAISE EXCEPTION 'Source or original changed' USING ERRCODE='23505';END IF;
  synthetic:=(p_body->>'testOnly')::boolean OR (dr.metadata->>'title') ~* '(HOMOLOG|SINT[EÉ]T|TEST|N[ÃA]O [ÉE] NORMA)' OR (dr.metadata->>'provenance') ~* '(sint[eé]tic|synthetic|homologa)';
  INSERT INTO public.eva_official_extraction_jobs(id,document_id,document_revision_id,operation_id,source_id,source_event_id,source_hash,file_hash,extractor,test_only,actor_id,input) VALUES(req,de.document_id,dr.id,op.id,j.source_id,src.id,sr.metadata_hash,op.file_hash,'pdfjs-6.4.299-text-v1',synthetic,p_actor,p_body);
  INSERT INTO public.eva_official_extraction_job_events(id,job_id,sequence,state,attempt,diagnostic,actor_id) VALUES(req,req,1,'QUEUED',0,'NONE',p_actor);
  RETURN jsonb_build_object('id',req,'state','QUEUED','testOnly',synthetic,'replayed',false);
 END IF;
 IF p_job IS NULL THEN RAISE EXCEPTION 'Job required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-job:'||p_job::text,0));
 SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=p_job;IF j.id IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO ce FROM public.eva_official_curation_events WHERE id=req;
 IF ce.id IS NOT NULL THEN IF ce.job_id<>p_job OR ce.actor_id<>p_actor OR ce.action<>p_action OR ce.input<>p_body THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('id',p_job,'replayed',true,'state',ce.state);END IF;
 SELECT * INTO je FROM public.eva_official_extraction_job_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 1;
 IF p_action IN ('withdraw','retry') THEN
  SELECT * INTO prior_job_event FROM public.eva_official_extraction_job_events WHERE id=req;
  IF prior_job_event.id IS NOT NULL THEN IF prior_job_event.job_id<>p_job OR prior_job_event.actor_id<>p_actor OR prior_job_event.input<>jsonb_build_object('action',p_action,'body',p_body) THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('id',p_job,'state',je.state,'replayed',true);END IF;
  IF p_body-ARRAY['requestId','justification','expectedProcessingEventId']<>'{}'::jsonb OR je.id::text IS DISTINCT FROM p_body->>'expectedProcessingEventId' THEN RAISE EXCEPTION 'Processing changed' USING ERRCODE='23505';END IF;
  IF p_action='withdraw' AND je.state<>'QUEUED' THEN RAISE EXCEPTION 'Withdrawal blocked' USING ERRCODE='23505';END IF;
  IF p_action='retry' AND (je.state<>'FAILED' OR je.diagnostic NOT IN ('NETWORK','EXTRACTION_FAILED') OR je.attempt>=3 OR NOT public.eva_extraction_origin(p_job,true)) THEN RAISE EXCEPTION 'Retry blocked' USING ERRCODE='23505';END IF;
  INSERT INTO public.eva_official_extraction_job_events(id,job_id,sequence,state,attempt,diagnostic,actor_id,input) VALUES(req,p_job,je.sequence+1,CASE WHEN p_action='retry' THEN 'QUEUED' ELSE 'WITHDRAWN' END,je.attempt,CASE WHEN p_action='retry' THEN 'NONE' ELSE 'WITHDRAWN' END,p_actor,jsonb_build_object('action',p_action,'body',p_body));RETURN jsonb_build_object('id',p_job,'state',CASE WHEN p_action='retry' THEN 'QUEUED' ELSE 'WITHDRAWN' END);
 END IF;
 SELECT * INTO ce FROM public.eva_official_curation_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 1;
 SELECT * INTO v FROM public.eva_official_extraction_versions WHERE job_id=p_job ORDER BY version DESC LIMIT 1;
 IF NOT p_body ?& ARRAY['expectedCurationEventId','expectedVersionId','expectedContentHash'] OR v.id IS NULL OR ce.id::text IS DISTINCT FROM p_body->>'expectedCurationEventId' OR v.id::text IS DISTINCT FROM p_body->>'expectedVersionId' OR v.content_hash IS DISTINCT FROM p_body->>'expectedContentHash' THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='23505';END IF;
 IF p_action='quarantine' THEN
  IF p_body-ARRAY['requestId','justification','expectedCurationEventId','expectedVersionId','expectedContentHash']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid quarantine' USING ERRCODE='22023';END IF;
  new_version:=v.id;
 ELSE
  IF NOT public.eva_extraction_origin(p_job,true) OR je.state NOT IN ('SUCCEEDED','OCR_REQUIRED') THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='23505';END IF;
  IF p_action='correct' THEN
   IF NOT p_body ?& ARRAY['patches','metadata','contentHash'] OR p_body-ARRAY['requestId','justification','expectedCurationEventId','expectedVersionId','expectedContentHash','patches','metadata','contentHash']<>'{}'::jsonb OR jsonb_typeof(p_body->'patches') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'patches')>10 OR octet_length((p_body->'patches')::text)>60000 OR jsonb_typeof(p_body->'metadata') IS DISTINCT FROM 'object' OR p_body->>'contentHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid correction' USING ERRCODE='22023';END IF;
   meta:=p_body->'metadata';
   IF NOT meta ?& ARRAY['publishedOn','validFrom','validTo','topic','references'] OR meta-ARRAY['publishedOn','validFrom','validTo','topic','references']<>'{}'::jsonb OR jsonb_typeof(meta->'topic') IS DISTINCT FROM 'string' OR length(meta->>'topic') NOT BETWEEN 2 AND 200 OR jsonb_typeof(meta->'references') IS DISTINCT FROM 'array' OR jsonb_array_length(meta->'references')>10 THEN RAISE EXCEPTION 'Invalid metadata' USING ERRCODE='22023';END IF;
   FOREACH changed IN ARRAY ARRAY['publishedOn','validFrom','validTo'] LOOP IF meta->changed<>'null'::jsonb AND (jsonb_typeof(meta->changed)<>'string' OR meta->>changed !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((meta->>changed)::date,'YYYY-MM-DD')<>meta->>changed) THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='22023';END IF;END LOOP;
   IF meta->'validTo'<>'null'::jsonb AND (meta->'validFrom'='null'::jsonb OR meta->>'validTo'<=meta->>'validFrom') THEN RAISE EXCEPTION 'Invalid validity' USING ERRCODE='22023';END IF;
   FOR patch IN SELECT value FROM jsonb_array_elements(meta->'references') LOOP IF jsonb_typeof(patch) IS DISTINCT FROM 'string' OR length(patch#>>'{}')>1024 OR (patch#>>'{}') !~ '^https://(www\.gov\.br/(aneel|mme)|www2?\.aneel\.gov\.br|biblioteca\.aneel\.gov\.br|git\.aneel\.gov\.br|(?:www\.)?planalto\.gov\.br|(?:www\.)?ccee\.org\.br|(?:www\.)?ons\.org\.br|ecmservice\.ons\.org\.br|proxyportais\.ons\.org\.br)/[^[:space:]?#]*$' THEN RAISE EXCEPTION 'Reference not official' USING ERRCODE='22023';END IF;END LOOP;
   FOR patch IN SELECT value FROM jsonb_array_elements(p_body->'patches') LOOP
    IF jsonb_typeof(patch) IS DISTINCT FROM 'object' OR NOT patch ?& ARRAY['id','text','heading','hash','resolvedIssues'] OR patch-ARRAY['id','text','heading','hash','resolvedIssues']<>'{}'::jsonb OR jsonb_typeof(patch->'text') IS DISTINCT FROM 'string' OR length(btrim(patch->>'text'))=0 OR octet_length(patch->>'text')>16000 OR jsonb_typeof(patch->'heading') IS DISTINCT FROM 'string' OR length(patch->>'heading')>200 OR patch->>'hash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(patch->'resolvedIssues') IS DISTINCT FROM 'array' OR NOT patch->'resolvedIssues' <@ '["LAYOUT_REVIEW","IMAGE_PRESENT"]'::jsonb OR NOT EXISTS(SELECT 1 FROM public.eva_official_extraction_sections WHERE id=(patch->>'id')::uuid AND version_id=v.id AND patch->'resolvedIssues' <@ issues) THEN RAISE EXCEPTION 'Invalid section correction' USING ERRCODE='22023';END IF;
   END LOOP;
   IF (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_body->'patches')x)<>jsonb_array_length(p_body->'patches') THEN RAISE EXCEPTION 'Duplicate patch' USING ERRCODE='22023';END IF;
   new_version:=req;INSERT INTO public.eva_official_extraction_versions(id,job_id,version,kind,parent_id,content_hash,page_count,metadata,actor_id) VALUES(req,p_job,v.version+1,'CURATED',v.id,p_body->>'contentHash',v.page_count,meta,p_actor);
   FOR row_section IN SELECT * FROM public.eva_official_extraction_sections WHERE version_id=v.id ORDER BY position LOOP
    SELECT value INTO patch FROM jsonb_array_elements(p_body->'patches') WHERE value->>'id'=row_section.id::text;
    INSERT INTO public.eva_official_extraction_sections(id,version_id,position,page,start_offset,end_offset,heading,content,content_hash,issues,origin_section_id) VALUES(gen_random_uuid(),req,row_section.position,row_section.page,row_section.start_offset,row_section.end_offset,coalesce(patch->>'heading',row_section.heading),coalesce(patch->>'text',row_section.content),coalesce(patch->>'hash',row_section.content_hash),coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(row_section.issues)x WHERE NOT coalesce(patch->'resolvedIssues','[]'::jsonb) @> jsonb_build_array(x)),'[]'::jsonb),row_section.id);
   END LOOP;
  ELSE
   IF NOT p_body ? 'acknowledgedPages' OR p_body-ARRAY['requestId','justification','expectedCurationEventId','expectedVersionId','expectedContentHash','acknowledgedPages']<>'{}'::jsonb OR v.kind<>'CURATED' OR ce.state<>'DRAFT' OR jsonb_typeof(p_body->'acknowledgedPages') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'acknowledgedPages')<>v.page_count THEN RAISE EXCEPTION 'Review incomplete' USING ERRCODE='22023';END IF;
   ack:=p_body->'acknowledgedPages';FOR pos IN 1..v.page_count LOOP IF NOT ack @> jsonb_build_array(pos) THEN RAISE EXCEPTION 'Page not checked' USING ERRCODE='22023';END IF;END LOOP;
   IF NOT j.test_only AND (v.metadata->'publishedOn'='null'::jsonb OR v.metadata->'validFrom'='null'::jsonb OR jsonb_array_length(v.metadata->'references')=0 OR je.state='OCR_REQUIRED' OR EXISTS(SELECT 1 FROM public.eva_official_extraction_sections WHERE version_id=v.id AND issues<>'[]'::jsonb)) THEN RAISE EXCEPTION 'Normative evidence incomplete' USING ERRCODE='23505';END IF;
   new_version:=v.id;
  END IF;
 END IF;
 INSERT INTO public.eva_official_curation_events(id,job_id,version_id,sequence,state,action,actor_id,justification,input) VALUES(req,p_job,new_version,ce.sequence+1,CASE p_action WHEN 'review' THEN 'REVIEWED' WHEN 'quarantine' THEN 'QUARANTINED' ELSE 'DRAFT' END,p_action,p_actor,p_body->>'justification',p_body);
 RETURN jsonb_build_object('id',p_job,'state',CASE p_action WHEN 'review' THEN 'REVIEWED' WHEN 'quarantine' THEN 'QUARANTINED' ELSE 'DRAFT' END,'versionId',new_version,'readyForFutureIndex',false,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.eva_official_extraction_action(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_official_extraction_action(uuid,text,uuid,jsonb) TO service_role;

CREATE FUNCTION public.eva_official_extraction_worker(p_action text,p_job uuid,p_token uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.eva_official_extraction_jobs;e public.eva_official_extraction_job_events;op public.eva_official_storage_operations;section jsonb;
 token uuid;vid uuid;page_count integer;state text;diag text;section_position integer:=0;total_bytes integer:=0;ce_seq integer;duration integer;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('claim','complete','fail') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>4000000 THEN RAISE EXCEPTION 'Invalid worker command' USING ERRCODE='22023';END IF;
 IF p_action='claim' THEN
  IF p_job IS NOT NULL OR p_token IS NOT NULL OR p_body<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='22023';END IF;
  SELECT x.* INTO j FROM public.eva_official_extraction_jobs x CROSS JOIN LATERAL(SELECT * FROM public.eva_official_extraction_job_events WHERE job_id=x.id ORDER BY sequence DESC LIMIT 1)y WHERE y.state='QUEUED' OR y.state='RUNNING' AND y.lease_until<clock_timestamp() ORDER BY x.created_at,x.id LIMIT 1 FOR NO KEY UPDATE OF x SKIP LOCKED;
  IF j.id IS NULL THEN RETURN NULL;END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-job:'||j.id::text,0));
  SELECT * INTO e FROM public.eva_official_extraction_job_events WHERE job_id=j.id ORDER BY sequence DESC LIMIT 1;
  IF e.state NOT IN ('QUEUED','RUNNING') OR e.state='RUNNING' AND e.lease_until>=clock_timestamp() THEN RETURN NULL;END IF;
  BEGIN
   PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=j.actor_id::text FOR SHARE OF ur,rr,tm;
   PERFORM public.platform_team_owner(j.actor_id);
  EXCEPTION WHEN insufficient_privilege THEN
   INSERT INTO public.eva_official_extraction_job_events(id,job_id,sequence,state,attempt,diagnostic) VALUES(gen_random_uuid(),j.id,e.sequence+1,'BLOCKED',e.attempt,'OWNER_REVOKED');RETURN NULL;
  END;
  IF e.attempt>=3 OR NOT public.eva_extraction_origin(j.id,true) THEN
   INSERT INTO public.eva_official_extraction_job_events(id,job_id,sequence,state,attempt,diagnostic) VALUES(gen_random_uuid(),j.id,e.sequence+1,'BLOCKED',e.attempt,CASE WHEN e.attempt>=3 THEN 'LEASE_EXPIRED' ELSE 'SOURCE_CHANGED' END);RETURN NULL;
  END IF;
  token:=gen_random_uuid();INSERT INTO public.eva_official_extraction_job_events(id,job_id,sequence,state,token,lease_until,attempt,diagnostic) VALUES(gen_random_uuid(),j.id,e.sequence+1,'RUNNING',token,clock_timestamp()+interval '180 seconds',e.attempt+1,'NONE');
  SELECT * INTO op FROM public.eva_official_storage_operations WHERE id=j.operation_id;
  RETURN jsonb_build_object('id',j.id,'token',token,'fileHash',j.file_hash,'size',op.size,'objectKey',op.object_key,'extractor',j.extractor,'testOnly',j.test_only);
 END IF;
 IF p_job IS NULL OR p_token IS NULL THEN RAISE EXCEPTION 'Lease required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-job:'||p_job::text,0));
 SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=p_job;SELECT * INTO e FROM public.eva_official_extraction_job_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 1;
 IF j.id IS NULL OR e.token IS DISTINCT FROM p_token OR e.lease_until<clock_timestamp() OR e.state<>'RUNNING' THEN RAISE EXCEPTION 'Stale lease' USING ERRCODE='23505';END IF;
 BEGIN
  PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=j.actor_id::text FOR SHARE OF ur,rr,tm;
  PERFORM public.platform_team_owner(j.actor_id);
 EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO public.eva_official_extraction_job_events(id,job_id,sequence,state,token,attempt,diagnostic) VALUES(gen_random_uuid(),j.id,e.sequence+1,'BLOCKED',p_token,e.attempt,'OWNER_REVOKED');RETURN jsonb_build_object('state','BLOCKED');
 END;
 IF NOT public.eva_extraction_origin(j.id,true) THEN
  INSERT INTO public.eva_official_extraction_job_events(id,job_id,sequence,state,token,attempt,diagnostic) VALUES(gen_random_uuid(),j.id,e.sequence+1,'BLOCKED',p_token,e.attempt,'SOURCE_CHANGED');RETURN jsonb_build_object('state','BLOCKED');
 END IF;
 IF jsonb_typeof(p_body->'durationMs') IS DISTINCT FROM 'number' OR p_body->>'durationMs' !~ '^\d{1,6}$' OR (p_body->>'durationMs')::integer>600000 THEN RAISE EXCEPTION 'Invalid duration' USING ERRCODE='22023';END IF;duration:=(p_body->>'durationMs')::integer;
 IF p_action='fail' THEN
  IF p_body-ARRAY['durationMs','diagnostic']<>'{}'::jsonb OR coalesce(p_body->>'diagnostic','!') NOT IN ('INTEGRITY','LIMIT','PDF_INVALID','NETWORK','EXTRACTION_FAILED') THEN RAISE EXCEPTION 'Invalid diagnostic' USING ERRCODE='22023';END IF;state:='FAILED';diag:=p_body->>'diagnostic';
 ELSE
  IF NOT p_body ?& ARRAY['durationMs','pageCount','sections','contentHash','ocrRequired'] OR p_body-ARRAY['durationMs','pageCount','sections','contentHash','ocrRequired']<>'{}'::jsonb OR jsonb_typeof(p_body->'pageCount') IS DISTINCT FROM 'number' OR p_body->>'pageCount' !~ '^\d{1,3}$' OR (p_body->>'pageCount')::integer NOT BETWEEN 1 AND 100 OR jsonb_typeof(p_body->'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'sections') NOT BETWEEN 1 AND 2000 OR p_body->>'contentHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_body->'ocrRequired') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid extraction' USING ERRCODE='22023';END IF;
  page_count:=(p_body->>'pageCount')::integer;vid:=gen_random_uuid();
  INSERT INTO public.eva_official_extraction_versions(id,job_id,version,kind,content_hash,page_count,metadata) VALUES(vid,j.id,1,'EXTRACTED',p_body->>'contentHash',page_count,'{}'::jsonb);
  FOR section IN SELECT value FROM jsonb_array_elements(p_body->'sections') LOOP
   IF jsonb_typeof(section) IS DISTINCT FROM 'object' OR NOT section ?& ARRAY['page','start','end','heading','text','hash','issues'] OR section-ARRAY['page','start','end','heading','text','hash','issues']<>'{}'::jsonb OR jsonb_typeof(section->'page') IS DISTINCT FROM 'number' OR section->>'page' !~ '^\d{1,3}$' OR (section->>'page')::integer NOT BETWEEN 1 AND page_count OR jsonb_typeof(section->'start') IS DISTINCT FROM 'number' OR section->>'start' !~ '^\d{1,7}$' OR jsonb_typeof(section->'end') IS DISTINCT FROM 'number' OR section->>'end' !~ '^\d{1,7}$' OR (section->>'end')::integer<(section->>'start')::integer OR jsonb_typeof(section->'text') IS DISTINCT FROM 'string' OR octet_length(section->>'text')>16000 OR jsonb_typeof(section->'heading') IS DISTINCT FROM 'string' OR length(section->>'heading')>200 OR section->>'hash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(section->'issues') IS DISTINCT FROM 'array' OR NOT section->'issues' <@ '["EMPTY_PAGE","LAYOUT_REVIEW","IMAGE_PRESENT"]'::jsonb THEN RAISE EXCEPTION 'Invalid section' USING ERRCODE='22023';END IF;
   total_bytes:=total_bytes+octet_length(section->>'text');IF total_bytes>2097152 THEN RAISE EXCEPTION 'Text limit' USING ERRCODE='22023';END IF;
   INSERT INTO public.eva_official_extraction_sections(id,version_id,position,page,start_offset,end_offset,heading,content,content_hash,issues) VALUES(gen_random_uuid(),vid,section_position,(section->>'page')::integer,(section->>'start')::integer,(section->>'end')::integer,section->>'heading',section->>'text',section->>'hash',section->'issues');section_position:=section_position+1;
  END LOOP;
  FOR section_position IN 1..page_count LOOP IF NOT EXISTS(SELECT 1 FROM public.eva_official_extraction_sections WHERE version_id=vid AND page=section_position) THEN RAISE EXCEPTION 'Page missing' USING ERRCODE='22023';END IF;END LOOP;
  IF NOT (p_body->>'ocrRequired')::boolean AND EXISTS(SELECT 1 FROM public.eva_official_extraction_sections WHERE version_id=vid AND issues @> '["EMPTY_PAGE"]'::jsonb) THEN RAISE EXCEPTION 'Coverage missing' USING ERRCODE='22023';END IF;
  state:=CASE WHEN (p_body->>'ocrRequired')::boolean THEN 'OCR_REQUIRED' ELSE 'SUCCEEDED' END;diag:=CASE WHEN state='OCR_REQUIRED' THEN 'OCR_REQUIRED' ELSE 'VERIFIED' END;
  INSERT INTO public.eva_official_curation_events(id,job_id,version_id,sequence,state,action,justification,input) VALUES(gen_random_uuid(),j.id,vid,1,'DRAFT','extract','Extração técnica preservada; não corresponde a conferência normativa ou publicação.','{}'::jsonb);
 END IF;
 INSERT INTO public.eva_official_extraction_job_events(id,job_id,sequence,state,token,attempt,diagnostic,duration_ms) VALUES(gen_random_uuid(),j.id,e.sequence+1,state,p_token,e.attempt,diag,duration);
 RETURN jsonb_build_object('state',state,'versionId',vid);
END$$;
REVOKE ALL ON FUNCTION public.eva_official_extraction_worker(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_official_extraction_worker(text,uuid,uuid,jsonb) TO service_role;
CREATE FUNCTION public.eva_official_extraction_metrics(p_actor uuid,p_month text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE profile text;month_start date;result jsonb;
BEGIN
 SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
 IF profile IS NULL OR profile NOT IN ('OWNER','FINANCE') THEN RAISE EXCEPTION 'Cost access denied' USING ERRCODE='42501';END IF;
 profile:=public.platform_workflow_actor(p_actor,CASE WHEN profile='OWNER' THEN 'e23a5c98-8b68-4ed2-aef8-70a7166407e4' ELSE '699703af-10ba-43a3-8eb8-9f0d9e477498' END);
 IF p_month IS NULL OR p_month !~ '^(20|21)\d{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';END IF;month_start:=(p_month||'-01')::date;
 WITH jobs AS(SELECT * FROM public.eva_official_extraction_jobs WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date>=month_start AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date<month_start+interval '1 month'),
 events AS(SELECT * FROM public.eva_official_extraction_job_events WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date>=month_start AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date<month_start+interval '1 month')
 SELECT jsonb_build_object('month',p_month,'preparedJobs',(SELECT count(*) FROM jobs),'testJobs',(SELECT count(*) FROM jobs WHERE test_only),
 'processingAttempts',(SELECT count(*) FROM events WHERE state='RUNNING'),'completedRuns',(SELECT count(*) FROM events WHERE state IN ('SUCCEEDED','OCR_REQUIRED')),
 'failedRuns',(SELECT count(*) FROM events WHERE state IN ('FAILED','BLOCKED')),'recordedDurationMs',(SELECT coalesce(sum(duration_ms),0) FROM events),
 'extractedPages',(SELECT coalesce(sum(page_count),0) FROM public.eva_official_extraction_versions WHERE kind='EXTRACTED' AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date>=month_start AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date<month_start+interval '1 month'),
 'actualCostBrlCents',null,'costBasis','CPU/memória Railway e leitura/transferência Blob. Custo monetário por tarefa ainda não apurado; consultar catálogo e faturas. Não somar estimativa, orçamento ou duração como despesa.',
 'organizationAiQuotaConsumed',false) INTO result;RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.eva_official_extraction_metrics(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_official_extraction_metrics(uuid,text) TO service_role;
COMMIT;
