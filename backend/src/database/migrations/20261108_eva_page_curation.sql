BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_curation_page_manifests(
 version_id uuid NOT NULL REFERENCES public.eva_official_extraction_versions(id),
 page integer NOT NULL CHECK(page BETWEEN 1 AND 40),
 disposition text NOT NULL CHECK(disposition IN ('INCLUDED','MIXED','EXCLUDED')),
 source_file_hash text NOT NULL CHECK(source_file_hash ~ '^[a-f0-9]{64}$'),
 parent_version_id uuid NOT NULL REFERENCES public.eva_official_extraction_versions(id),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'),
 actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(version_id,page));
CREATE TABLE public.eva_curation_exclusions(
 id uuid PRIMARY KEY,version_id uuid NOT NULL,page integer NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 20 AND 1000 AND reason !~ '[[:cntrl:]]'),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 2048),
 anchor text NOT NULL CHECK(length(btrim(anchor)) BETWEEN 1 AND 1000),
 origin_sections jsonb NOT NULL CHECK(jsonb_typeof(origin_sections)='array' AND jsonb_array_length(origin_sections)>0),
 FOREIGN KEY(version_id,page) REFERENCES public.eva_curation_page_manifests(version_id,page),UNIQUE(version_id,page));
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['eva_curation_page_manifests','eva_curation_exclusions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER eva_page_curation_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable()',t);
 END LOOP;
END$$;

-- Legacy versions retain exact page coverage. New versions additionally account
-- for genuinely excluded pages without creating fake searchable text.
CREATE FUNCTION public.eva_curation_coverage_complete(p_version uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v public.eva_official_extraction_versions;n integer;
BEGIN
 SELECT * INTO v FROM public.eva_official_extraction_versions WHERE id=p_version;
 IF v.id IS NULL OR EXISTS(SELECT 1 FROM public.eva_official_extraction_sections WHERE version_id=v.id AND (issues<>'[]' OR btrim(content)='')) THEN RETURN false;END IF;
 SELECT count(*) INTO n FROM public.eva_curation_page_manifests WHERE version_id=v.id;
 IF n=0 THEN RETURN (SELECT count(DISTINCT page)=v.page_count FROM public.eva_official_extraction_sections WHERE version_id=v.id);END IF;
 BEGIN PERFORM public.platform_team_owner(v.actor_id);EXCEPTION WHEN insufficient_privilege THEN RETURN false;END;
 RETURN n=v.page_count AND NOT EXISTS(SELECT 1 FROM generate_series(1,v.page_count)pg
  LEFT JOIN public.eva_curation_page_manifests m ON m.version_id=v.id AND m.page=pg
  LEFT JOIN public.eva_curation_exclusions e ON e.version_id=m.version_id AND e.page=m.page
  WHERE m.page IS NULL OR m.source_file_hash IS DISTINCT FROM (SELECT file_hash FROM public.eva_official_extraction_jobs WHERE id=v.job_id) OR
   m.actor_id IS DISTINCT FROM v.actor_id OR m.payload_hash<>encode(sha256(convert_to(m.input::text,'UTF8')),'hex') OR
   m.disposition='INCLUDED' AND e.id IS NOT NULL OR m.disposition<>'INCLUDED' AND e.id IS NULL OR
   (m.disposition='EXCLUDED') IS DISTINCT FROM NOT EXISTS(SELECT 1 FROM public.eva_official_extraction_sections s WHERE s.version_id=v.id AND s.page=pg));
END$$;
REVOKE ALL ON FUNCTION public.eva_curation_coverage_complete(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_page_curation_action(p_actor uuid,p_action text,p_job uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.eva_official_extraction_jobs;v public.eva_official_extraction_versions;ce public.eva_official_curation_events;old public.eva_official_curation_events;
 req uuid;pg integer;seq integer;pos integer:=0;off integer;cnt integer:=0;total_bytes integer:=0;meta jsonb;item jsonb;seg jsonb;ex jsonb;origins jsonb;h text;key text;new_hash text;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=p_actor::text FOR SHARE OF ur,rr,tm;
 PERFORM public.platform_team_owner(p_actor);
 IF p_job IS NULL OR p_action IS NULL OR p_action NOT IN ('detail','prepare') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>2200000 THEN RAISE EXCEPTION 'Invalid page curation' USING ERRCODE='22023';END IF;
 IF p_action='prepare' THEN
  IF jsonb_typeof(p_body->'requestId') IS DISTINCT FROM 'string' OR p_body->>'requestId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-request:'||(p_body->>'requestId'),0));
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-job:'||p_job::text,0));
 SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=p_job;
 SELECT * INTO v FROM public.eva_official_extraction_versions WHERE job_id=p_job ORDER BY version DESC LIMIT 1;
 SELECT * INTO ce FROM public.eva_official_curation_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 1;
 IF j.id IS NULL OR v.id IS NULL THEN RAISE EXCEPTION 'Version unavailable' USING ERRCODE='22023';END IF;
 IF p_action='detail' THEN
  IF p_body-ARRAY['page','requestId']<>'{}' OR (p_body ? 'requestId' AND (jsonb_typeof(p_body->'requestId') IS DISTINCT FROM 'string' OR p_body->>'requestId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')) OR NOT p_body ? 'page' OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,3}$' THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;pg:=(p_body->>'page')::integer;
  RETURN jsonb_build_object('enabled',true,'versionId',v.id,'contentHash',v.content_hash,'curationEventId',ce.id,'curation',ce.state,'preparedBy',v.actor_id,
   'request',CASE WHEN p_body ? 'requestId' THEN (SELECT jsonb_build_object('versionId',e.version_id,'state',e.state) FROM public.eva_official_curation_events e WHERE e.id=(p_body->>'requestId')::uuid AND e.job_id=p_job AND e.action='correct') ELSE null END,
   'pageCount',v.page_count,'coveredPages',(SELECT count(*) FROM public.eva_curation_page_manifests WHERE version_id=v.id),'complete',public.eva_curation_coverage_complete(v.id),
   'total',(SELECT count(*) FROM public.eva_curation_page_manifests WHERE version_id=v.id),'page',pg,
   'rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY page) FROM(SELECT m.page,m.disposition,m.payload_hash,e.reason,e.reference,e.anchor,
    (SELECT count(*) FROM public.eva_official_extraction_sections s WHERE s.version_id=m.version_id AND s.page=m.page) AS segments
    FROM public.eva_curation_page_manifests m LEFT JOIN public.eva_curation_exclusions e ON e.version_id=m.version_id AND e.page=m.page
    WHERE m.version_id=v.id ORDER BY m.page LIMIT 10 OFFSET pg*10)x),'[]'));
 END IF;
 IF NOT p_body ?& ARRAY['requestId','justification','expectedVersionId','expectedCurationEventId','expectedContentHash','metadata','pages'] OR p_body-ARRAY['requestId','justification','expectedVersionId','expectedCurationEventId','expectedContentHash','metadata','pages']<>'{}' OR
  jsonb_typeof(p_body->'requestId') IS DISTINCT FROM 'string' OR p_body->>'requestId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-extraction-request:'||req::text,0));
 SELECT * INTO old FROM public.eva_official_curation_events WHERE id=req;
 IF old.id IS NOT NULL THEN IF old.job_id<>p_job OR old.actor_id<>p_actor OR old.action<>'correct' OR old.input IS DISTINCT FROM p_body THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('id',p_job,'versionId',old.version_id,'state',old.state,'replayed',true);END IF;
 IF ce.id::text IS DISTINCT FROM p_body->>'expectedCurationEventId' OR v.id::text IS DISTINCT FROM p_body->>'expectedVersionId' OR v.content_hash IS DISTINCT FROM p_body->>'expectedContentHash' OR
  NOT public.eva_extraction_origin(p_job,true) OR (SELECT state FROM public.eva_official_extraction_job_events WHERE job_id=p_job ORDER BY sequence DESC LIMIT 1)<>'SUCCEEDED' OR
  NOT EXISTS(SELECT 1 FROM public.eva_official_document_parts WHERE file_hash=j.file_hash) THEN RAISE EXCEPTION 'Current preserved document part required' USING ERRCODE='23505';END IF;
 meta:=p_body->'metadata';
 IF jsonb_typeof(meta) IS DISTINCT FROM 'object' OR NOT meta ?& ARRAY['publishedOn','validFrom','validTo','topic','references'] OR meta-ARRAY['publishedOn','validFrom','validTo','topic','references']<>'{}' OR jsonb_typeof(meta->'topic') IS DISTINCT FROM 'string' OR length(meta->>'topic') NOT BETWEEN 2 AND 200 OR jsonb_typeof(meta->'references') IS DISTINCT FROM 'array' OR jsonb_array_length(meta->'references')>10 THEN RAISE EXCEPTION 'Invalid metadata' USING ERRCODE='22023';END IF;
 FOREACH key IN ARRAY ARRAY['publishedOn','validFrom','validTo'] LOOP IF meta->key<>'null'::jsonb AND (jsonb_typeof(meta->key)<>'string' OR meta->>key !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((meta->>key)::date,'YYYY-MM-DD')<>meta->>key) THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='22023';END IF;END LOOP;
 IF meta->'validTo'<>'null'::jsonb AND (meta->'validFrom'='null'::jsonb OR meta->>'validTo'<=meta->>'validFrom') THEN RAISE EXCEPTION 'Invalid validity' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'references') LOOP IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR length(item#>>'{}')>1024 OR (item#>>'{}') !~ '^https://(www\.gov\.br/(aneel|mme)|www2?\.aneel\.gov\.br|biblioteca\.aneel\.gov\.br|git\.aneel\.gov\.br|(?:www\.)?planalto\.gov\.br|(?:www\.)?ccee\.org\.br|(?:www\.)?ons\.org\.br|ecmservice\.ons\.org\.br|proxyportais\.ons\.org\.br)/[^[:space:]?#]*$' THEN RAISE EXCEPTION 'Reference not official' USING ERRCODE='22023';END IF;END LOOP;
 IF jsonb_typeof(p_body->'pages') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'pages')<>v.page_count OR v.page_count>40 THEN RAISE EXCEPTION 'Complete bounded coverage required' USING ERRCODE='22023';END IF;
 new_hash:=encode(sha256(convert_to(v.content_hash||meta::text||(p_body->'pages')::text,'UTF8')),'hex');
 INSERT INTO public.eva_official_extraction_versions(id,job_id,version,kind,parent_id,content_hash,page_count,metadata,actor_id) VALUES(req,p_job,v.version+1,'CURATED',v.id,new_hash,v.page_count,meta,p_actor);
 FOR item IN SELECT value FROM jsonb_array_elements(p_body->'pages') LOOP
  cnt:=cnt+1;
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT item ?& ARRAY['page','state','segments','exclusion'] OR item-ARRAY['page','state','segments','exclusion']<>'{}' OR jsonb_typeof(item->'page') IS DISTINCT FROM 'number' OR item->>'page' IS DISTINCT FROM cnt::text OR coalesce(item->>'state','!') NOT IN ('INCLUDED','MIXED','EXCLUDED') OR jsonb_typeof(item->'segments') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'segments')>200 THEN RAISE EXCEPTION 'Invalid page disposition' USING ERRCODE='22023';END IF;
  ex:=item->'exclusion';
  IF item->>'state'='INCLUDED' THEN IF ex IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unexpected exclusion' USING ERRCODE='22023';END IF;
  ELSE IF jsonb_typeof(ex) IS DISTINCT FROM 'object' OR NOT ex ?& ARRAY['reason','reference','anchor'] OR ex-ARRAY['reason','reference','anchor']<>'{}' OR jsonb_typeof(ex->'reason') IS DISTINCT FROM 'string' OR length(btrim(ex->>'reason')) NOT BETWEEN 20 AND 1000 OR ex->>'reason' ~ '[[:cntrl:]]' OR jsonb_typeof(ex->'reference') IS DISTINCT FROM 'string' OR length(btrim(ex->>'reference')) NOT BETWEEN 1 AND 2048 OR jsonb_typeof(ex->'anchor') IS DISTINCT FROM 'string' OR length(btrim(ex->>'anchor')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Exclusion evidence required' USING ERRCODE='22023';END IF;END IF;
  IF (item->>'state'='EXCLUDED') IS DISTINCT FROM (jsonb_array_length(item->'segments')=0) THEN RAISE EXCEPTION 'Disposition contradicts content' USING ERRCODE='22023';END IF;
  INSERT INTO public.eva_curation_page_manifests VALUES(req,cnt,item->>'state',j.file_hash,v.id,encode(sha256(convert_to(item::text,'UTF8')),'hex'),item,p_actor,clock_timestamp());
  SELECT jsonb_agg(jsonb_build_object('id',s.id,'hash',s.content_hash,'start',s.start_offset,'end',s.end_offset) ORDER BY s.position) INTO origins FROM public.eva_official_extraction_sections s WHERE version_id=v.id AND page=cnt;
  -- Re-curated excluded pages retain ancestry through the original extracted version.
  IF origins IS NULL THEN SELECT jsonb_agg(jsonb_build_object('id',s.id,'hash',s.content_hash,'start',s.start_offset,'end',s.end_offset) ORDER BY s.position) INTO origins FROM public.eva_official_extraction_sections s WHERE version_id=(SELECT id FROM public.eva_official_extraction_versions WHERE job_id=p_job AND kind='EXTRACTED' ORDER BY version LIMIT 1) AND page=cnt;END IF;
  IF origins IS NULL THEN RAISE EXCEPTION 'Original page evidence unavailable' USING ERRCODE='23505';END IF;
  IF ex<>'null'::jsonb THEN INSERT INTO public.eva_curation_exclusions VALUES(gen_random_uuid(),req,cnt,ex->>'reason',ex->>'reference',ex->>'anchor',origins);END IF;
  off:=0;
  FOR seg IN SELECT value FROM jsonb_array_elements(item->'segments') LOOP
   IF pos>=2000 OR jsonb_typeof(seg) IS DISTINCT FROM 'object' OR NOT seg ?& ARRAY['heading','text'] OR seg-ARRAY['heading','text']<>'{}' OR jsonb_typeof(seg->'heading') IS DISTINCT FROM 'string' OR length(seg->>'heading')>200 OR jsonb_typeof(seg->'text') IS DISTINCT FROM 'string' OR btrim(seg->>'text')='' OR length(seg->>'text')>6000 OR octet_length(seg->>'text')>16000 THEN RAISE EXCEPTION 'Invalid complete segment' USING ERRCODE='22023';END IF;
   h:=encode(sha256(convert_to(seg->>'text','UTF8')),'hex');total_bytes:=total_bytes+octet_length(seg->>'text');IF total_bytes>2097152 THEN RAISE EXCEPTION 'Text limit' USING ERRCODE='22023';END IF;
   INSERT INTO public.eva_official_extraction_sections(id,version_id,position,page,start_offset,end_offset,heading,content,content_hash,issues,origin_section_id)
    VALUES(gen_random_uuid(),req,pos,cnt,off,off+length(seg->>'text'),seg->>'heading',seg->>'text',h,'[]',(origins->0->>'id')::uuid);
   off:=off+length(seg->>'text');pos:=pos+1;
  END LOOP;
 END LOOP;
 IF pos=0 OR NOT public.eva_curation_coverage_complete(req) THEN RAISE EXCEPTION 'Incomplete coverage' USING ERRCODE='23505';END IF;
 INSERT INTO public.eva_official_curation_events(id,job_id,version_id,sequence,state,action,actor_id,actor_name,justification,input) VALUES(req,p_job,req,ce.sequence+1,'DRAFT','correct',p_actor,public.platform_workflow_name(p_actor),p_body->>'justification',p_body);
 RETURN jsonb_build_object('id',p_job,'versionId',req,'contentHash',new_hash,'state','DRAFT','pages',cnt,'sections',pos,'replayed',false,'published',false);
END$$;
REVOKE ALL ON FUNCTION public.eva_page_curation_action(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_page_curation_action(uuid,text,uuid,jsonb) TO service_role;

-- Exact, fail-closed upgrades of existing function bodies. No signature, ACL,
-- historical row, or legacy approval changes. The migration aborts if the
-- deployed definitions no longer contain the reviewed anchors.
DO $upgrade$DECLARE d text;a text;b text;BEGIN
 d:=pg_get_functiondef('public.eva_official_extraction_action(uuid,text,uuid,jsonb)'::regprocedure);
 a:=' IF p_action=''quarantine'' THEN';
 b:=' IF EXISTS(SELECT 1 FROM public.eva_curation_page_manifests WHERE version_id=v.id) THEN
  IF p_action=''correct'' THEN RAISE EXCEPTION ''Use complete page preparation to preserve coverage'' USING ERRCODE=''23505'';END IF;
  IF p_action=''review'' AND (EXISTS(SELECT 1 FROM public.eva_official_extraction_versions pv WHERE pv.job_id=p_job AND pv.kind=''CURATED'' AND pv.actor_id=p_actor) OR NOT public.eva_curation_coverage_complete(v.id)) THEN RAISE EXCEPTION ''Independent complete page review required'' USING ERRCODE=''42501'';END IF;
 END IF;
'||a;
 IF length(d)-length(replace(d,a,''))<>length(a) THEN RAISE EXCEPTION 'Extraction upgrade anchor changed';END IF;EXECUTE replace(d,a,b);

 d:=pg_get_functiondef('public.eva_document_parts_action(uuid,text,uuid,jsonb)'::regprocedure);
 a:='ce.actor_id=p_actor OR EXISTS';
 b:='(CASE WHEN EXISTS(SELECT 1 FROM public.eva_curation_page_manifests WHERE version_id=v.id) THEN EXISTS(SELECT 1 FROM public.eva_official_extraction_versions pv WHERE pv.job_id=v.job_id AND pv.kind=''CURATED'' AND pv.actor_id=ce.actor_id) OR NOT public.eva_curation_coverage_complete(v.id) ELSE ce.actor_id=p_actor END) OR EXISTS';
 IF length(d)-length(replace(d,a,''))<>length(a) THEN RAISE EXCEPTION 'Parts upgrade anchor changed';END IF;EXECUTE replace(d,a,b);

 d:=pg_get_functiondef('public.eva_composite_candidate(uuid,boolean,boolean)'::regprocedure);
 a:='ce.actor_id=s.actor_id OR';
 b:='(CASE WHEN EXISTS(SELECT 1 FROM public.eva_curation_page_manifests WHERE version_id=v.id) THEN EXISTS(SELECT 1 FROM public.eva_official_extraction_versions pv WHERE pv.job_id=v.job_id AND pv.kind=''CURATED'' AND pv.actor_id=ce.actor_id) OR NOT public.eva_curation_coverage_complete(v.id) ELSE ce.actor_id=s.actor_id END) OR';
 IF length(d)-length(replace(d,a,''))<>length(a) THEN RAISE EXCEPTION 'Independent candidate anchor changed';END IF;d:=replace(d,a,b);
 a:='(SELECT count(DISTINCT page) FROM public.eva_official_extraction_sections WHERE version_id=v.id)<>v.page_count';
 IF length(d)-length(replace(d,a,''))<>length(a) THEN RAISE EXCEPTION 'Coverage anchor changed';END IF;d:=replace(d,a,'NOT public.eva_curation_coverage_complete(v.id)');
 a:='ELSE ''[]''::jsonb END));';
 b:='ELSE ''[]''::jsonb END)||CASE WHEN EXISTS(SELECT 1 FROM public.eva_curation_page_manifests WHERE version_id=v.id) THEN jsonb_build_object(''coverage'',(SELECT jsonb_agg(jsonb_build_object(''page'',m.page,''state'',m.disposition,''hash'',m.payload_hash) ORDER BY m.page) FROM public.eva_curation_page_manifests m WHERE m.version_id=v.id)) ELSE ''{}''::jsonb END);';
 IF length(d)-length(replace(d,a,''))<>length(a) THEN RAISE EXCEPTION 'Candidate payload anchor changed';END IF;EXECUTE replace(d,a,b);
END$upgrade$;
COMMIT;
