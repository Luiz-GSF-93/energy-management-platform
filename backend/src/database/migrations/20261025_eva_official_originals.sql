BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_official_documents(id uuid PRIMARY KEY,source_id uuid NOT NULL REFERENCES public.eva_official_sources(id),actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.eva_official_document_revisions(
 id uuid PRIMARY KEY,document_id uuid NOT NULL REFERENCES public.eva_official_documents(id),version integer NOT NULL CHECK(version>0),
 document_state text NOT NULL DEFAULT 'DRAFT' CHECK(document_state='DRAFT'),source_event_id uuid NOT NULL REFERENCES public.eva_official_source_events(id),source_revision_hash text NOT NULL CHECK(source_revision_hash ~ '^[a-f0-9]{64}$'),
 metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<8000),metadata_hash text NOT NULL CHECK(metadata_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(document_id,version),UNIQUE(id,document_id));
CREATE TABLE public.eva_official_storage_operations(
 id uuid PRIMARY KEY,document_id uuid NOT NULL,revision_id uuid NOT NULL,file_hash text NOT NULL CHECK(file_hash ~ '^[a-f0-9]{64}$'),
 size integer NOT NULL CHECK(size BETWEEN 20 AND 26214400),object_key text NOT NULL UNIQUE,actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(revision_id,document_id) REFERENCES public.eva_official_document_revisions(id,document_id),UNIQUE(id,revision_id,document_id));
CREATE TABLE public.eva_official_document_events(
 id uuid PRIMARY KEY,document_id uuid NOT NULL,revision_id uuid NOT NULL,operation_id uuid,
 sequence integer NOT NULL CHECK(sequence>0),action text NOT NULL CHECK(action IN ('prepare','revise','reserve','reconcile','finish')),
 state text NOT NULL CHECK(state IN ('PREPARED','RESERVED','RECONCILING','PRESERVED','UNKNOWN','FAILED','BLOCKED')),
 diagnostic text NOT NULL CHECK(diagnostic IN ('NONE','VERIFIED','NOT_FOUND','HASH_MISMATCH','NETWORK_OR_HTTP','STORAGE_POLICY_INVALID','SOURCE_CHANGED')),
 actor_id uuid NOT NULL,justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 1000 AND justification !~ '[[:cntrl:]]'),
 input jsonb NOT NULL CHECK(octet_length(input::text)<16000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(document_id,sequence),
 FOREIGN KEY(revision_id,document_id) REFERENCES public.eva_official_document_revisions(id,document_id),
 FOREIGN KEY(operation_id,revision_id,document_id) REFERENCES public.eva_official_storage_operations(id,revision_id,document_id));
CREATE INDEX eva_official_document_latest ON public.eva_official_document_events(document_id,sequence DESC);
DO $$DECLARE tbl text;BEGIN
 FOREACH tbl IN ARRAY ARRAY['eva_official_documents','eva_official_document_revisions','eva_official_storage_operations','eva_official_document_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',tbl);
  EXECUTE format('CREATE TRIGGER eva_original_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable()',tbl);
 END LOOP;
END$$;
CREATE FUNCTION public.eva_official_document_action(p_actor uuid,p_action text,p_document_id uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE doc uuid;req uuid;source uuid;pg integer;fields text[];meta jsonb;origin text;authority text;host text;
 last_event public.eva_official_document_events;prior public.eva_official_document_events;rev public.eva_official_document_revisions;
 src_event public.eva_official_source_events;src_rev public.eva_official_source_revisions;op public.eva_official_storage_operations;
 new_revision uuid;new_operation uuid;new_state text;diag text:='NONE';result jsonb;input_value jsonb;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=p_actor::text FOR SHARE OF ur,rr,tm;
 PERFORM public.platform_team_owner(p_actor);
 IF p_action IS NULL OR p_action NOT IN ('list','detail','prepare','revise','reserve','reconcile','finish') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>16000 THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 IF p_action IN ('list','detail') THEN
  IF jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;pg:=(p_body->>'page')::integer;
  IF p_action='list' THEN
   IF p_document_id IS NOT NULL OR NOT p_body ?& ARRAY['page','search','state'] OR p_body-ARRAY['page','search','state']<>'{}'::jsonb OR jsonb_typeof(p_body->'search') IS DISTINCT FROM 'string' OR length(p_body->>'search')>100 OR coalesce(p_body->>'state','!') NOT IN ('','PREPARED','RESERVED','RECONCILING','PRESERVED','UNKNOWN','FAILED','BLOCKED') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
   WITH current_documents AS(SELECT d.id,d.source_id,r.version,r.metadata,r.document_state,e.state FROM public.eva_official_documents d CROSS JOIN LATERAL(SELECT ev.* FROM public.eva_official_document_events ev WHERE ev.document_id=d.id ORDER BY ev.sequence DESC LIMIT 1)e JOIN public.eva_official_document_revisions r ON r.id=e.revision_id),filtered AS(SELECT * FROM current_documents cd WHERE (p_body->>'state'='' OR cd.state=p_body->>'state') AND (p_body->>'search'='' OR strpos(lower((cd.metadata->>'title')||' '||(cd.metadata->>'edition')),lower(p_body->>'search'))>0)),paged AS(SELECT * FROM filtered ORDER BY lower(metadata->>'title'),id LIMIT 10 OFFSET pg*10)
   SELECT jsonb_build_object('page',pg,'pageSize',10,'total',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'sourceId',x.source_id,'title',x.metadata->>'title','edition',x.metadata->>'edition','version',x.version,'state',x.state,'documentState',x.document_state) ORDER BY lower(x.metadata->>'title'),x.id) FROM paged x),'[]'::jsonb)) INTO result;RETURN result;
  END IF;
  IF p_document_id IS NULL OR p_body-ARRAY['page']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid document' USING ERRCODE='22023';END IF;
  SELECT * INTO last_event FROM public.eva_official_document_events WHERE document_id=p_document_id ORDER BY sequence DESC LIMIT 1;
  IF last_event.id IS NULL THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='22023';END IF;
  SELECT * INTO rev FROM public.eva_official_document_revisions WHERE id=last_event.revision_id;
  RETURN jsonb_build_object('id',p_document_id,'sourceId',(SELECT source_id FROM public.eva_official_documents WHERE id=p_document_id),'state',last_event.state,'documentState',rev.document_state,'eventId',last_event.id,'revisionHash',rev.metadata_hash,'version',rev.version,'metadata',rev.metadata,'sourceEventId',rev.source_event_id,'sourceRevisionHash',rev.source_revision_hash,'operationId',last_event.operation_id,'diagnostic',last_event.diagnostic,'historyPage',pg,'historyTotal',(SELECT count(*) FROM public.eva_official_document_events WHERE document_id=p_document_id),
   'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o)-'object_key' ORDER BY o.created_at DESC),'[]'::jsonb) FROM(SELECT * FROM public.eva_official_storage_operations WHERE document_id=p_document_id AND revision_id=rev.id ORDER BY created_at DESC LIMIT 10)o),
   'history',(SELECT coalesce(jsonb_agg((to_jsonb(h)-'input')||jsonb_build_object('metadata',r.metadata,'version',r.version,'metadataHash',r.metadata_hash) ORDER BY h.sequence DESC),'[]'::jsonb) FROM(SELECT * FROM public.eva_official_document_events WHERE document_id=p_document_id ORDER BY sequence DESC LIMIT 10 OFFSET pg*10)h JOIN public.eva_official_document_revisions r ON r.id=h.revision_id));
 END IF;
 fields:=ARRAY['requestId','expectedEventId','expectedRevisionHash','justification'];
 IF p_action IN ('prepare','revise') THEN fields:=fields||ARRAY['sourceId','expectedSourceEventId','expectedSourceRevisionHash','metadata','metadataHash'];
 ELSIF p_action='reserve' THEN fields:=fields||ARRAY['fileHash','size'];
 ELSIF p_action='reconcile' THEN fields:=fields||ARRAY['operationId'];
 ELSIF p_action='finish' THEN fields:=fields||ARRAY['operationId','outcome','diagnostic'];END IF;
 IF NOT p_body ?& fields OR p_body-fields<>'{}'::jsonb OR jsonb_typeof(p_body->'requestId') IS DISTINCT FROM 'string' OR p_body->>'requestId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;doc:=CASE WHEN p_action='prepare' THEN req ELSE p_document_id END;
 IF doc IS NULL OR (p_action='prepare' AND (p_document_id IS NOT NULL OR p_body->'expectedEventId'<>'null'::jsonb OR p_body->'expectedRevisionHash'<>'null'::jsonb)) OR (p_action<>'prepare' AND (jsonb_typeof(p_body->'expectedEventId') IS DISTINCT FROM 'string' OR p_body->>'expectedEventId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR jsonb_typeof(p_body->'expectedRevisionHash') IS DISTINCT FROM 'string' OR p_body->>'expectedRevisionHash' !~ '^[a-f0-9]{64}$')) THEN RAISE EXCEPTION 'Invalid version' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-document:'||doc::text,0));PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-document-request:'||req::text,0));
 input_value:=jsonb_build_object('action',p_action,'documentId',p_document_id,'body',p_body);
 SELECT * INTO prior FROM public.eva_official_document_events WHERE id=req;
 IF prior.id IS NOT NULL THEN
  IF prior.actor_id<>p_actor OR prior.input<>input_value THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;
  SELECT * INTO last_event FROM public.eva_official_document_events WHERE document_id=prior.document_id ORDER BY sequence DESC LIMIT 1;
  RETURN jsonb_build_object('documentId',prior.document_id,'eventId',last_event.id,'state',last_event.state,'replayed',true);
 END IF;
 SELECT * INTO last_event FROM public.eva_official_document_events WHERE document_id=doc ORDER BY sequence DESC LIMIT 1;
 IF p_action='prepare' THEN IF last_event.id IS NOT NULL THEN RAISE EXCEPTION 'Document exists' USING ERRCODE='23505';END IF;
 ELSE
  SELECT * INTO rev FROM public.eva_official_document_revisions WHERE id=last_event.revision_id;
  IF last_event.id IS NULL OR last_event.id IS DISTINCT FROM (p_body->>'expectedEventId')::uuid OR rev.metadata_hash IS DISTINCT FROM p_body->>'expectedRevisionHash' THEN RAISE EXCEPTION 'Stale version' USING ERRCODE='23505';END IF;
 END IF;
 IF p_action IN ('prepare','revise') THEN
  IF jsonb_typeof(p_body->'sourceId') IS DISTINCT FROM 'string' OR p_body->>'sourceId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR jsonb_typeof(p_body->'expectedSourceEventId') IS DISTINCT FROM 'string' OR p_body->>'expectedSourceEventId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR jsonb_typeof(p_body->'expectedSourceRevisionHash') IS DISTINCT FROM 'string' OR p_body->>'expectedSourceRevisionHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid source' USING ERRCODE='22023';END IF;
  source:=(p_body->>'sourceId')::uuid;
  IF p_action='revise' AND ((SELECT source_id FROM public.eva_official_documents WHERE id=doc)<>source OR last_event.state IN ('RESERVED','RECONCILING','UNKNOWN','BLOCKED')) THEN RAISE EXCEPTION 'Revision blocked' USING ERRCODE='23505';END IF;
 ELSE SELECT source_id INTO source FROM public.eva_official_documents WHERE id=doc;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-source:'||source::text,0));
 SELECT * INTO src_event FROM public.eva_official_source_events WHERE source_id=source ORDER BY sequence DESC LIMIT 1;SELECT * INTO src_rev FROM public.eva_official_source_revisions WHERE id=src_event.revision_id;
 IF p_action IN ('prepare','revise') THEN
  IF src_event.state IS DISTINCT FROM 'REGISTERED' OR src_event.id IS DISTINCT FROM (p_body->>'expectedSourceEventId')::uuid OR src_rev.metadata_hash IS DISTINCT FROM p_body->>'expectedSourceRevisionHash' THEN RAISE EXCEPTION 'Source not current' USING ERRCODE='23505';END IF;
  meta:=p_body->'metadata';origin:=meta->>'url';authority:=src_rev.metadata->>'authority';
  IF jsonb_typeof(meta) IS DISTINCT FROM 'object' OR NOT meta ?& ARRAY['title','edition','url','publishedOn','validFrom','validTo','provenance'] OR meta-ARRAY['title','edition','url','publishedOn','validFrom','validTo','provenance']<>'{}'::jsonb OR jsonb_typeof(meta->'title') IS DISTINCT FROM 'string' OR length(btrim(meta->>'title')) NOT BETWEEN 2 AND 160 OR jsonb_typeof(meta->'edition') IS DISTINCT FROM 'string' OR length(btrim(meta->>'edition')) NOT BETWEEN 1 AND 100 OR jsonb_typeof(meta->'provenance') IS DISTINCT FROM 'string' OR length(btrim(meta->>'provenance')) NOT BETWEEN 20 AND 1000 OR jsonb_typeof(meta->'url') IS DISTINCT FROM 'string' OR length(origin)>1024 OR ((meta->>'title')||(meta->>'edition')||(meta->>'provenance')||origin) ~ '[[:cntrl:]]' OR jsonb_typeof(p_body->'metadataHash') IS DISTINCT FROM 'string' OR p_body->>'metadataHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid metadata' USING ERRCODE='22023';END IF;
  FOREACH host IN ARRAY ARRAY['publishedOn','validFrom','validTo'] LOOP
   IF meta->host<>'null'::jsonb AND (jsonb_typeof(meta->host)<>'string' OR meta->>host !~ '^\d{4}-\d{2}-\d{2}$' OR to_char((meta->>host)::date,'YYYY-MM-DD')<>meta->>host) THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='22023';END IF;
  END LOOP;
  IF meta->'validTo'<>'null'::jsonb AND (meta->'validFrom'='null'::jsonb OR meta->>'validTo'<=meta->>'validFrom') THEN RAISE EXCEPTION 'Invalid validity' USING ERRCODE='22023';END IF;
  IF origin !~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^?#[:space:]]*)?$' THEN RAISE EXCEPTION 'Invalid origin' USING ERRCODE='22023';END IF;host:=split_part(substring(origin FROM 9),'/',1);
  IF NOT ((authority='ANEEL' AND (host IN ('www.aneel.gov.br','www2.aneel.gov.br','biblioteca.aneel.gov.br','git.aneel.gov.br') OR host='www.gov.br' AND origin LIKE 'https://www.gov.br/aneel/%')) OR (authority='PLANALTO' AND host IN ('www.planalto.gov.br','planalto.gov.br')) OR (authority='CCEE' AND host IN ('www.ccee.org.br','ccee.org.br')) OR (authority='ONS' AND host IN ('www.ons.org.br','ons.org.br','ecmservice.ons.org.br','proxyportais.ons.org.br'))) THEN RAISE EXCEPTION 'Origin not institutional' USING ERRCODE='22023';END IF;
  IF p_action='prepare' THEN INSERT INTO public.eva_official_documents(id,source_id,actor_id) VALUES(doc,source,p_actor);END IF;
  INSERT INTO public.eva_official_document_revisions(id,document_id,version,source_event_id,source_revision_hash,metadata,metadata_hash,actor_id) VALUES(req,doc,coalesce(rev.version,0)+1,src_event.id,src_rev.metadata_hash,meta,p_body->>'metadataHash',p_actor);
  new_revision:=req;new_state:='PREPARED';
 ELSE
  new_revision:=rev.id;
  IF p_action<>'finish' AND (src_event.state IS DISTINCT FROM 'REGISTERED' OR src_event.id IS DISTINCT FROM rev.source_event_id OR src_rev.metadata_hash IS DISTINCT FROM rev.source_revision_hash) THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='23505';END IF;
  IF p_action='reserve' THEN
   IF last_event.state NOT IN ('PREPARED','FAILED') OR jsonb_typeof(p_body->'fileHash') IS DISTINCT FROM 'string' OR p_body->>'fileHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_body->'size') IS DISTINCT FROM 'number' OR p_body->>'size' !~ '^\d{1,8}$' OR (p_body->>'size')::integer NOT BETWEEN 20 AND 26214400 THEN RAISE EXCEPTION 'Reservation blocked' USING ERRCODE='23505';END IF;
   INSERT INTO public.eva_official_storage_operations(id,document_id,revision_id,file_hash,size,object_key,actor_id) VALUES(req,doc,rev.id,p_body->>'fileHash',(p_body->>'size')::integer,'official/'||doc::text||'/'||rev.id::text||'/'||req::text||'.pdf',p_actor);new_operation:=req;new_state:='RESERVED';
  ELSE
   IF jsonb_typeof(p_body->'operationId') IS DISTINCT FROM 'string' OR p_body->>'operationId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023';END IF;
   SELECT * INTO op FROM public.eva_official_storage_operations WHERE id=(p_body->>'operationId')::uuid AND document_id=doc AND revision_id=rev.id;
   IF op.id IS NULL OR last_event.operation_id IS DISTINCT FROM op.id THEN RAISE EXCEPTION 'Operation mismatch' USING ERRCODE='23505';END IF;new_operation:=op.id;
   IF p_action='reconcile' THEN
    IF last_event.state NOT IN ('RESERVED','RECONCILING','UNKNOWN') OR last_event.created_at>clock_timestamp()-interval '60 seconds' THEN RAISE EXCEPTION 'Recovery blocked or busy' USING ERRCODE='23505';END IF;new_state:='RECONCILING';
   ELSE
    IF last_event.state NOT IN ('RESERVED','RECONCILING') OR coalesce(p_body->>'outcome','!') NOT IN ('PRESERVED','FAILED','BLOCKED','UNKNOWN') OR coalesce(p_body->>'diagnostic','!') NOT IN ('VERIFIED','NOT_FOUND','HASH_MISMATCH','NETWORK_OR_HTTP','STORAGE_POLICY_INVALID') OR NOT ((p_body->>'outcome'='PRESERVED' AND p_body->>'diagnostic'='VERIFIED') OR (p_body->>'outcome'='FAILED' AND p_body->>'diagnostic'='NOT_FOUND' AND last_event.state='RECONCILING') OR (p_body->>'outcome'='BLOCKED' AND p_body->>'diagnostic' IN ('HASH_MISMATCH','STORAGE_POLICY_INVALID')) OR (p_body->>'outcome'='UNKNOWN' AND p_body->>'diagnostic'='NETWORK_OR_HTTP')) THEN RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='23505';END IF;
    new_state:=p_body->>'outcome';diag:=p_body->>'diagnostic';
    IF src_event.state IS DISTINCT FROM 'REGISTERED' OR src_event.id IS DISTINCT FROM rev.source_event_id OR src_rev.metadata_hash IS DISTINCT FROM rev.source_revision_hash THEN new_state:='BLOCKED';diag:='SOURCE_CHANGED';END IF;
   END IF;
  END IF;
 END IF;
 INSERT INTO public.eva_official_document_events(id,document_id,revision_id,operation_id,sequence,action,state,diagnostic,actor_id,justification,input) VALUES(req,doc,new_revision,new_operation,coalesce(last_event.sequence,0)+1,p_action,new_state,diag,p_actor,p_body->>'justification',input_value);
 result:=jsonb_build_object('documentId',doc,'eventId',req,'state',new_state,'replayed',false);
 IF p_action IN ('reserve','reconcile') THEN
  SELECT * INTO op FROM public.eva_official_storage_operations WHERE id=new_operation;
  result:=result||jsonb_build_object('operationId',op.id,'revisionHash',rev.metadata_hash,'reference',jsonb_build_object('objectKey',op.object_key,'fileHash',op.file_hash,'size',op.size));
 END IF;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.eva_official_document_action(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_official_document_action(uuid,text,uuid,jsonb) TO service_role;
COMMIT;
