BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_official_sources (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.eva_official_source_revisions (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES public.eva_official_sources(id),
 version integer NOT NULL CHECK(version>0), metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<8000),
 metadata_hash text NOT NULL CHECK(metadata_hash ~ '^[a-f0-9]{64}$'),actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(source_id,version),UNIQUE(id,source_id)
);
CREATE TABLE public.eva_official_source_events (
 id uuid PRIMARY KEY,source_id uuid NOT NULL REFERENCES public.eva_official_sources(id),revision_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0),action text NOT NULL CHECK(action IN ('create','update','confirm','suspend','resume')),
 state text NOT NULL CHECK(state IN ('DRAFT','REGISTERED','SUSPENDED')),actor_id uuid NOT NULL,
 justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 1000 AND justification !~ '[[:cntrl:]]'),
 input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(source_id,sequence),
 FOREIGN KEY(revision_id,source_id) REFERENCES public.eva_official_source_revisions(id,source_id)
);
CREATE INDEX eva_official_event_latest ON public.eva_official_source_events(source_id,sequence DESC);
DO $$DECLARE tbl text;BEGIN
 FOREACH tbl IN ARRAY ARRAY['eva_official_sources','eva_official_source_revisions','eva_official_source_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',tbl);
  EXECUTE format('CREATE TRIGGER eva_official_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable()',tbl);
 END LOOP;
END$$;
CREATE FUNCTION public.eva_official_source_action(p_actor uuid,p_action text,p_source_id uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE req uuid;src uuid;expected uuid;pg integer;rev public.eva_official_source_revisions;
 last_event public.eva_official_source_events;prior public.eva_official_source_events;
 meta jsonb;authority text;family text;origin text;host text;new_state text;new_revision uuid;result jsonb;fields text[];
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.user_roles ur JOIN public.roles role_record ON role_record.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=p_actor::text FOR SHARE OF ur,role_record,tm;
 PERFORM public.platform_team_owner(p_actor);
 IF p_action IS NULL OR p_action NOT IN ('list','detail','create','update','confirm','suspend','resume') OR p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>16000 THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 IF p_action IN ('list','detail') THEN
  IF p_body->>'page' IS NULL OR jsonb_typeof(p_body->'page')<>'number' OR p_body->>'page' !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;pg:=(p_body->>'page')::integer;
  IF p_action='list' THEN
   IF p_source_id IS NOT NULL OR NOT p_body ?& ARRAY['page','search','authority','family','state'] OR p_body-ARRAY['page','search','authority','family','state']<>'{}'::jsonb OR jsonb_typeof(p_body->'search')<>'string' OR length(p_body->>'search')>100 OR coalesce(p_body->>'state','!') NOT IN ('','DRAFT','REGISTERED','SUSPENDED') OR coalesce(p_body->>'authority','!') NOT IN ('','ANEEL','PLANALTO','CCEE','ONS','DISTRIBUTOR') OR coalesce(p_body->>'family','!') NOT IN ('','ANEEL_RULES','PRORET','PRODIST','LEGISLATION','CCEE_RULES','CCEE_PROCEDURES','ONS_PROCEDURES','DISTRIBUTOR_DOCUMENTS') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
   WITH current_sources AS (
    SELECT identity_record.id,revision_record.version,revision_record.metadata,revision_record.metadata_hash,latest.id AS event_id,latest.state
    FROM public.eva_official_sources identity_record
    CROSS JOIN LATERAL(SELECT ev.id,ev.state,ev.revision_id FROM public.eva_official_source_events ev WHERE ev.source_id=identity_record.id ORDER BY ev.sequence DESC LIMIT 1)latest
    JOIN public.eva_official_source_revisions revision_record ON revision_record.id=latest.revision_id
   ),filtered AS(SELECT * FROM current_sources cs WHERE (p_body->>'state'='' OR cs.state=p_body->>'state') AND (p_body->>'authority'='' OR cs.metadata->>'authority'=p_body->>'authority') AND (p_body->>'family'='' OR cs.metadata->>'family'=p_body->>'family') AND (p_body->>'search'='' OR strpos(lower((cs.metadata->>'title')||' '||(cs.metadata->>'url')),lower(p_body->>'search'))>0)),paged AS(SELECT * FROM filtered ORDER BY lower(metadata->>'title'),id LIMIT 10 OFFSET pg*10)
   SELECT jsonb_build_object('page',pg,'pageSize',10,'total',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',item.id,'title',item.metadata->>'title','authority',item.metadata->>'authority','family',item.metadata->>'family','state',item.state,'version',item.version) ORDER BY lower(item.metadata->>'title'),item.id) FROM paged item),'[]'::jsonb)) INTO result;
   RETURN result;
  END IF;
  IF p_source_id IS NULL OR p_body-ARRAY['page']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid source' USING ERRCODE='22023';END IF;
  SELECT * INTO last_event FROM public.eva_official_source_events WHERE source_id=p_source_id ORDER BY sequence DESC LIMIT 1;
  IF last_event.id IS NULL THEN RAISE EXCEPTION 'Source unavailable' USING ERRCODE='22023';END IF;
  SELECT * INTO rev FROM public.eva_official_source_revisions WHERE id=last_event.revision_id;
  RETURN jsonb_build_object('id',p_source_id,'state',last_event.state,'metadata',rev.metadata,'version',rev.version,'revisionHash',rev.metadata_hash,'eventId',last_event.id,'historyPage',pg,'historyTotal',(SELECT count(*) FROM public.eva_official_source_events WHERE source_id=p_source_id),'history',(SELECT coalesce(jsonb_agg((to_jsonb(history_record)-'input')||jsonb_build_object('metadata',historic_revision.metadata,'version',historic_revision.version,'metadataHash',historic_revision.metadata_hash) ORDER BY history_record.sequence DESC),'[]'::jsonb) FROM(SELECT * FROM public.eva_official_source_events WHERE source_id=p_source_id ORDER BY sequence DESC LIMIT 10 OFFSET pg*10)history_record JOIN public.eva_official_source_revisions historic_revision ON historic_revision.id=history_record.revision_id));
 END IF;
 fields:=ARRAY['requestId','expectedEventId','expectedRevisionHash','justification'];
 IF p_action IN ('create','update') THEN fields:=fields||ARRAY['metadata','metadataHash'];END IF;
 IF p_body-fields<>'{}'::jsonb OR NOT p_body ?& fields OR jsonb_typeof(p_body->'requestId')<>'string' OR p_body->>'requestId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR jsonb_typeof(p_body->'justification')<>'string' OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;src:=CASE WHEN p_action='create' THEN req ELSE p_source_id END;
 IF src IS NULL OR (p_action='create' AND (p_source_id IS NOT NULL OR p_body->'expectedEventId'<>'null'::jsonb OR p_body->'expectedRevisionHash'<>'null'::jsonb)) OR (p_action<>'create' AND (jsonb_typeof(p_body->'expectedEventId')<>'string' OR p_body->>'expectedEventId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR jsonb_typeof(p_body->'expectedRevisionHash')<>'string' OR p_body->>'expectedRevisionHash' !~ '^[a-f0-9]{64}$')) THEN RAISE EXCEPTION 'Invalid version' USING ERRCODE='22023';END IF;
 IF p_action IN ('create','update') THEN
  meta:=p_body->'metadata';authority:=meta->>'authority';family:=meta->>'family';origin:=meta->>'url';
  IF jsonb_typeof(meta) IS DISTINCT FROM 'object' OR meta-ARRAY['title','authority','family','url','markets','scopeNote','cadenceDays']<>'{}' OR NOT meta ?& ARRAY['title','authority','family','url','markets','scopeNote','cadenceDays'] OR authority IS NULL OR family IS NULL OR origin IS NULL OR jsonb_typeof(meta->'title')<>'string' OR length(btrim(meta->>'title')) NOT BETWEEN 2 AND 160 OR jsonb_typeof(meta->'scopeNote')<>'string' OR length(meta->>'scopeNote')>1000 OR ((meta->>'title')||(meta->>'scopeNote')||origin) ~ '[[:cntrl:]]' OR length(origin)>1024 OR jsonb_typeof(meta->'cadenceDays')<>'number' OR meta->>'cadenceDays' !~ '^\d{1,3}$' OR (meta->>'cadenceDays')::integer NOT BETWEEN 1 AND 366 OR jsonb_typeof(p_body->'metadataHash')<>'string' OR p_body->>'metadataHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid metadata' USING ERRCODE='22023';END IF;
  IF NOT ((authority='ANEEL' AND family IN ('ANEEL_RULES','PRORET','PRODIST')) OR (authority='PLANALTO' AND family='LEGISLATION') OR (authority='CCEE' AND family IN ('CCEE_RULES','CCEE_PROCEDURES')) OR (authority='ONS' AND family='ONS_PROCEDURES') OR (authority='DISTRIBUTOR' AND family='DISTRIBUTOR_DOCUMENTS')) THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='22023';END IF;
  IF jsonb_typeof(meta->'markets') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid markets' USING ERRCODE='22023';END IF;
  IF jsonb_array_length(meta->'markets') NOT BETWEEN 1 AND 4 OR EXISTS(SELECT 1 FROM jsonb_array_elements(meta->'markets') m WHERE jsonb_typeof(m)<>'string' OR m#>>'{}' NOT IN ('COMMON','ACL','ACR','GD')) OR (SELECT count(DISTINCT m) FROM jsonb_array_elements(meta->'markets') m)<>jsonb_array_length(meta->'markets') THEN RAISE EXCEPTION 'Invalid markets' USING ERRCODE='22023';END IF;
  IF origin !~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^?#[:space:]]*)?$' THEN RAISE EXCEPTION 'Invalid origin' USING ERRCODE='22023';END IF;
  host:=split_part(substring(origin FROM 9),'/',1);
  IF host ~ '(\.local|\.internal)$' OR (authority='ANEEL' AND NOT(host IN ('www.aneel.gov.br','www2.aneel.gov.br','biblioteca.aneel.gov.br','git.aneel.gov.br') OR host='www.gov.br' AND origin LIKE 'https://www.gov.br/aneel/%')) OR (authority='PLANALTO' AND host NOT IN ('www.planalto.gov.br','planalto.gov.br')) OR (authority='CCEE' AND host NOT IN ('www.ccee.org.br','ccee.org.br')) OR (authority='ONS' AND host NOT IN ('www.ons.org.br','ons.org.br','ecmservice.ons.org.br','proxyportais.ons.org.br')) THEN RAISE EXCEPTION 'Invalid origin' USING ERRCODE='22023';END IF;
 END IF;
 -- Lock both dimensions: shared source decisions and global request replay.
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-source:'||src::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-official-request:'||req::text,0));
 SELECT * INTO prior FROM public.eva_official_source_events WHERE id=req;
 IF prior.id IS NOT NULL THEN
  IF prior.actor_id<>p_actor OR prior.input<>jsonb_build_object('action',p_action,'sourceId',p_source_id,'body',p_body) THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('sourceId',prior.source_id,'eventId',prior.id,'state',prior.state,'replayed',true);
 END IF;
 SELECT * INTO last_event FROM public.eva_official_source_events WHERE source_id=src ORDER BY sequence DESC LIMIT 1;
 IF p_action='create' THEN
  IF last_event.id IS NOT NULL THEN RAISE EXCEPTION 'Source exists' USING ERRCODE='23505';END IF;
  INSERT INTO public.eva_official_sources(id,actor_id) VALUES(src,p_actor);
  new_state:='DRAFT';
 ELSE
  SELECT * INTO rev FROM public.eva_official_source_revisions WHERE id=last_event.revision_id;
  IF last_event.id IS NULL OR last_event.id IS DISTINCT FROM (p_body->>'expectedEventId')::uuid OR rev.metadata_hash IS DISTINCT FROM p_body->>'expectedRevisionHash' THEN RAISE EXCEPTION 'Stale version' USING ERRCODE='23505';END IF;
  new_state:=CASE WHEN p_action='update' THEN CASE WHEN last_event.state='SUSPENDED' THEN 'SUSPENDED' ELSE 'DRAFT' END WHEN p_action='confirm' AND last_event.state='DRAFT' AND rev.metadata->>'authority'<>'DISTRIBUTOR' THEN 'REGISTERED' WHEN p_action='suspend' AND last_event.state IN ('DRAFT','REGISTERED') THEN 'SUSPENDED' WHEN p_action='resume' AND last_event.state='SUSPENDED' THEN 'DRAFT' ELSE NULL END;
  IF new_state IS NULL THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='23505';END IF;
 END IF;
 IF p_action IN ('create','update') THEN
  INSERT INTO public.eva_official_source_revisions(id,source_id,version,metadata,metadata_hash,actor_id) VALUES(req,src,coalesce(rev.version,0)+1,meta,p_body->>'metadataHash',p_actor);new_revision:=req;
 ELSE new_revision:=rev.id;END IF;
 INSERT INTO public.eva_official_source_events(id,source_id,revision_id,sequence,action,state,actor_id,justification,input) VALUES(req,src,new_revision,coalesce(last_event.sequence,0)+1,p_action,new_state,p_actor,p_body->>'justification',jsonb_build_object('action',p_action,'sourceId',p_source_id,'body',p_body));
 RETURN jsonb_build_object('sourceId',src,'eventId',req,'state',new_state,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.eva_official_source_action(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_official_source_action(uuid,text,uuid,jsonb) TO service_role;
COMMIT;
