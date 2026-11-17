BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Public official originals only. This index does not publish a reviewed normative corpus.
CREATE TABLE public.legal_library_files(
 operation_id uuid PRIMARY KEY REFERENCES public.eva_official_storage_operations(id),
 document_id uuid NOT NULL REFERENCES public.eva_official_documents(id),source_id text NOT NULL,
 file_hash text NOT NULL CHECK(file_hash ~ '^[a-f0-9]{64}$'),page_count integer NOT NULL CHECK(page_count BETWEEN 1 AND 1000),
 text_hash text NOT NULL CHECK(text_hash ~ '^[a-f0-9]{64}$'),captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 metadata jsonb NOT NULL CHECK(octet_length(metadata::text)<12000),actor_id uuid NOT NULL
);
CREATE TABLE public.legal_library_file_chunks(
 operation_id uuid NOT NULL REFERENCES public.legal_library_files(operation_id),page integer NOT NULL CHECK(page>0),
 position integer NOT NULL CHECK(position>=0),text text NOT NULL CHECK(length(text) BETWEEN 1 AND 4000),
 search tsvector GENERATED ALWAYS AS(to_tsvector('portuguese',text)) STORED,PRIMARY KEY(operation_id,page,position)
);
CREATE INDEX legal_library_file_search ON public.legal_library_file_chunks USING gin(search);
ALTER TABLE public.legal_library_files ENABLE ROW LEVEL SECURITY;ALTER TABLE public.legal_library_files FORCE ROW LEVEL SECURITY;
ALTER TABLE public.legal_library_file_chunks ENABLE ROW LEVEL SECURITY;ALTER TABLE public.legal_library_file_chunks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_library_files,public.legal_library_file_chunks FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER legal_library_files_immutable BEFORE UPDATE OR DELETE ON public.legal_library_files FOR EACH ROW EXECUTE FUNCTION public.legal_audit_immutable();
CREATE TRIGGER legal_library_chunks_immutable BEFORE UPDATE OR DELETE ON public.legal_library_file_chunks FOR EACH ROW EXECUTE FUNCTION public.legal_audit_immutable();
CREATE FUNCTION public.legal_library_file_active(op uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.legal_library_files f JOIN public.eva_official_documents d ON d.id=f.document_id JOIN public.eva_official_storage_operations o ON o.id=f.operation_id JOIN public.eva_official_document_revisions r ON r.id=o.revision_id CROSS JOIN LATERAL(SELECT * FROM public.eva_official_document_events WHERE document_id=d.id ORDER BY sequence DESC LIMIT 1)e CROSS JOIN LATERAL(SELECT * FROM public.eva_official_source_events WHERE source_id=d.source_id ORDER BY sequence DESC LIMIT 1)se JOIN public.eva_official_source_revisions sr ON sr.id=se.revision_id WHERE f.operation_id=op AND e.operation_id=op AND e.state='PRESERVED' AND e.diagnostic='VERIFIED' AND se.state='REGISTERED' AND public.eva_legal_official_url(sr.metadata->>'authority',r.metadata->>'url'))
$$;
REVOKE ALL ON FUNCTION public.legal_library_file_active(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.legal_library_file_action(p_actor text,p_org text,p_role text,p_platform boolean,p_action text,p_id uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='10s' AS $$
DECLARE e public.eva_official_document_events;op public.eva_official_storage_operations;rev public.eva_official_document_revisions;src public.eva_official_source_revisions;
 pages jsonb; item jsonb; n integer;v text;reading_hash text;term_query tsquery;result jsonb;
BEGIN
 IF p_actor IS NULL OR p_actor !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor::uuid AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<clock_timestamp())) THEN RAISE EXCEPTION 'Active actor required' USING ERRCODE='42501';END IF;
 IF p_action IN('index','original') THEN
  PERFORM public.platform_team_owner(p_actor::uuid);
  IF p_action='index' AND(jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>8500000 OR NOT p_body ?& ARRAY['sourceId','fileHash','pages','metadata'] OR p_body-ARRAY['sourceId','fileHash','pages','metadata']<>'{}'::jsonb) THEN RAISE EXCEPTION 'Invalid index' USING ERRCODE='22023';END IF;
  SELECT * INTO e FROM public.eva_official_document_events WHERE document_id=p_id ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO op FROM public.eva_official_storage_operations WHERE id=e.operation_id;
  SELECT * INTO rev FROM public.eva_official_document_revisions WHERE id=e.revision_id;
  SELECT * INTO src FROM public.eva_official_source_revisions WHERE metadata_hash=rev.source_revision_hash AND id=(SELECT revision_id FROM public.eva_official_source_events WHERE id=rev.source_event_id);
  IF p_action='original' THEN
   IF p_body<>'{}'::jsonb OR e.state IS DISTINCT FROM 'PRESERVED' OR e.diagnostic IS DISTINCT FROM 'VERIFIED' OR NOT public.eva_legal_official_url(src.metadata->>'authority',rev.metadata->>'url') THEN RAISE EXCEPTION 'Official original unavailable' USING ERRCODE='42501';END IF;
   RETURN jsonb_build_object('objectKey',op.object_key,'fileHash',op.file_hash,'size',op.size,'operationId',op.id,'metadata',rev.metadata);
  END IF;
  IF e.state IS DISTINCT FROM 'PRESERVED' OR e.diagnostic IS DISTINCT FROM 'VERIFIED' OR op.file_hash IS DISTINCT FROM p_body->>'fileHash' OR NOT public.eva_legal_official_url(src.metadata->>'authority',rev.metadata->>'url') OR NOT EXISTS(SELECT 1 FROM public.legal_audit_sources WHERE id=p_body->>'sourceId') THEN RAISE EXCEPTION 'Preserved official original required' USING ERRCODE='42501';END IF;
  pages:=p_body->'pages';
  IF jsonb_typeof(pages) IS DISTINCT FROM 'array' OR jsonb_array_length(pages) NOT BETWEEN 1 AND 1000 OR jsonb_typeof(p_body->'metadata') IS DISTINCT FROM 'object' OR octet_length((p_body->'metadata')::text)>11000 THEN RAISE EXCEPTION 'Invalid native reading' USING ERRCODE='22023';END IF;
  reading_hash:=encode(sha256(convert_to(pages::text,'UTF8')),'hex');
  IF EXISTS(SELECT 1 FROM public.legal_library_files WHERE operation_id=op.id AND(source_id<>p_body->>'sourceId' OR text_hash<>reading_hash)) THEN RAISE EXCEPTION 'Index immutable' USING ERRCODE='23505';END IF;
  IF EXISTS(SELECT 1 FROM public.legal_library_files WHERE operation_id=op.id) THEN RETURN jsonb_build_object('replayed',true,'state','PRESERVED_CONTEXT');END IF;
  n:=0;FOR item IN SELECT value FROM jsonb_array_elements(pages) LOOP
   n:=n+1;IF item->>'page' IS DISTINCT FROM n::text OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string' OR length(item->>'text')>200000 OR item-ARRAY['page','text']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  END LOOP;
  INSERT INTO public.legal_library_files VALUES(op.id,p_id,p_body->>'sourceId',op.file_hash,n,reading_hash,clock_timestamp(),p_body->'metadata',p_actor::uuid);
  FOR item IN SELECT value FROM jsonb_array_elements(pages) LOOP
   v:=item->>'text';INSERT INTO public.legal_library_file_chunks(operation_id,page,position,text) SELECT op.id,(item->>'page')::integer,s,substring(v FROM s+1 FOR 4000) FROM generate_series(0,length(v)-1,3800)s;
  END LOOP;
  RETURN jsonb_build_object('state','PRESERVED_CONTEXT','pages',n,'documentId',p_id,'fileHash',op.file_hash);
 END IF;
 IF p_org IS NULL THEN PERFORM public.platform_team_owner(p_actor::uuid);ELSE PERFORM public.legal_audit_actor(p_org,p_actor,p_role,p_platform,false);END IF;
 IF p_action NOT IN('list','search') OR p_id IS NOT NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>12000 THEN RAISE EXCEPTION 'Invalid lookup' USING ERRCODE='22023';END IF;
 IF p_action='list' THEN
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'sourceId') FROM(SELECT jsonb_build_object('sourceId',f.source_id,'documentId',f.document_id,'operationId',f.operation_id,'fileHash',f.file_hash,'pages',f.page_count,'capturedAt',f.captured_at,'title',r.metadata->>'title','edition',r.metadata->>'edition','url',r.metadata->>'url','state','PRESERVED_CONTEXT','normativeReview','PENDING')x FROM public.legal_library_files f JOIN public.eva_official_storage_operations o ON o.id=f.operation_id JOIN public.eva_official_document_revisions r ON r.id=o.revision_id WHERE public.legal_library_file_active(f.operation_id))z),'[]');
 END IF;
 IF jsonb_typeof(p_body->'query') IS DISTINCT FROM 'string' OR length(p_body->>'query') NOT BETWEEN 3 AND 4000 OR p_body-ARRAY['query']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023';END IF;
 SELECT string_agg(quote_literal(lexeme),' | ')::tsquery INTO term_query FROM(SELECT unnest(tsvector_to_array(to_tsvector('portuguese',p_body->>'query')))lexeme LIMIT 24)x;
 IF term_query IS NULL THEN RETURN '[]'::jsonb;END IF;
 SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM(SELECT jsonb_build_object('id','official-file-'||f.operation_id::text||'-p'||c.page||'-'||c.position,'sourceId',f.source_id,'documentId',f.document_id,'operationId',f.operation_id,'page',c.page,'position',c.position,'text',c.text,'fileHash',f.file_hash,'title',r.metadata->>'title','edition',r.metadata->>'edition','url',r.metadata->>'url','capturedAt',f.captured_at,'curation','PRESERVED_CONTEXT_NOT_NORMATIVE_REVIEW')x FROM public.legal_library_file_chunks c JOIN public.legal_library_files f ON f.operation_id=c.operation_id JOIN public.eva_official_storage_operations o ON o.id=f.operation_id JOIN public.eva_official_document_revisions r ON r.id=o.revision_id WHERE c.search @@ term_query AND public.legal_library_file_active(f.operation_id) ORDER BY ts_rank_cd(c.search,term_query) DESC,f.source_id,c.page,c.position LIMIT 4)s;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.legal_library_file_action(text,text,text,boolean,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.legal_library_file_action(text,text,text,boolean,text,uuid,jsonb) TO service_role;
COMMIT;
