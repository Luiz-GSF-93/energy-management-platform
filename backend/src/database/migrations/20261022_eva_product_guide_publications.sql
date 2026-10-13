BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_product_guide_publications (
 id uuid PRIMARY KEY,guide_key text NOT NULL CHECK(guide_key IN ('guide-client-units','guide-documents','guide-ocr','guide-investments','guide-reports','guide-portal','guide-environment','guide-eva')),
 version text NOT NULL CHECK(length(version) BETWEEN 1 AND 40),release text NOT NULL CHECK(length(release) BETWEEN 1 AND 100),
 document_hash text NOT NULL CHECK(document_hash ~ '^[a-f0-9]{64}$'),content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<40000),
 actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(guide_key,version)
);
CREATE TABLE public.eva_product_guide_publication_events (
 id uuid PRIMARY KEY,publication_id uuid NOT NULL REFERENCES public.eva_product_guide_publications(id),
 sequence integer NOT NULL CHECK(sequence>0),state text NOT NULL CHECK(state IN ('PUBLISHED','QUARANTINED')),
 actor_id uuid NOT NULL,justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 1000 AND justification !~ '[[:cntrl:]]'),
 input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(publication_id,sequence)
);
CREATE INDEX eva_guide_event_recent ON public.eva_product_guide_publication_events(publication_id,sequence DESC);
CREATE FUNCTION public.eva_product_guide_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Guide history is immutable' USING ERRCODE='42501';END$$;
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['eva_product_guide_publications','eva_product_guide_publication_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER eva_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable()',t);
 END LOOP;
END$$;
CREATE FUNCTION public.eva_product_guide_read_publication(p_key text,p_version text,p_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT to_jsonb(p)||jsonb_build_object('state',e.state,'event_id',e.id)
 FROM public.eva_product_guide_publications p
 CROSS JOIN LATERAL(SELECT id,state FROM public.eva_product_guide_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 1)e
 WHERE p.guide_key=p_key AND p.version=p_version AND p.document_hash=p_hash AND e.state='PUBLISHED';
$$;
CREATE FUNCTION public.eva_product_guide_admin_action(p_actor uuid,p_action text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE k text;v text;req uuid;expected uuid;p public.eva_product_guide_publications;e public.eva_product_guide_publication_events;prior public.eva_product_guide_publication_events;pg integer;seq integer;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 -- Hold the same rows used by the authoritative Owner check against concurrent revocation.
 PERFORM 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text WHERE u.user_id::text=p_actor::text FOR SHARE OF u,r,t;
 PERFORM public.platform_team_owner(p_actor);
 IF p_action IS NULL OR p_action NOT IN ('list','detail','publish','quarantine') OR p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>50000 THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 IF p_action='list' THEN
  IF p_body<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid list' USING ERRCODE='22023';END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('state',e.state,'event_id',e.id) ORDER BY p.guide_key,p.version),'[]'::jsonb) FROM public.eva_product_guide_publications p CROSS JOIN LATERAL(SELECT id,state FROM public.eva_product_guide_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 1)e);
 END IF;
 k:=p_body->>'key';v:=p_body->>'version';
 IF jsonb_typeof(p_body->'key') IS DISTINCT FROM 'string' OR k NOT IN ('guide-client-units','guide-documents','guide-ocr','guide-investments','guide-reports','guide-portal','guide-environment','guide-eva') OR jsonb_typeof(p_body->'version') IS DISTINCT FROM 'string' OR length(v) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'Invalid guide' USING ERRCODE='22023';END IF;
 IF p_action='detail' THEN
  IF p_body-ARRAY['key','version','page']<>'{}' OR NOT p_body ?& ARRAY['key','version','page'] OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;
  SELECT * INTO p FROM public.eva_product_guide_publications WHERE guide_key=k AND version=v;
  SELECT * INTO e FROM public.eva_product_guide_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 1;
  RETURN jsonb_build_object('publication',CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p)||jsonb_build_object('state',e.state,'event_id',e.id) END,'historyPage',pg,'historyTotal',(SELECT count(*) FROM public.eva_product_guide_publication_events WHERE publication_id=p.id),'history',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'input' ORDER BY sequence DESC),'[]') FROM(SELECT * FROM public.eva_product_guide_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 10 OFFSET pg*10)x));
 END IF;
 IF (p_action='publish' AND (p_body-ARRAY['requestId','expectedEventId','expectedDocumentHash','justification','key','version','release','documentHash','contentHash','snapshot']<>'{}' OR NOT p_body ?& ARRAY['requestId','expectedEventId','expectedDocumentHash','justification','key','version','release','documentHash','contentHash','snapshot'])) OR
 (p_action='quarantine' AND (p_body-ARRAY['requestId','expectedEventId','expectedDocumentHash','justification','key','version','release','documentHash','contentHash']<>'{}' OR NOT p_body ?& ARRAY['requestId','expectedEventId','expectedDocumentHash','justification','key','version','release','documentHash','contentHash'])) OR
 jsonb_typeof(p_body->'requestId') IS DISTINCT FROM 'string' OR p_body->'expectedEventId'<>'null'::jsonb AND jsonb_typeof(p_body->'expectedEventId') IS DISTINCT FROM 'string' OR
 jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' OR
 p_body->>'expectedDocumentHash' IS DISTINCT FROM p_body->>'documentHash' OR jsonb_typeof(p_body->'release') IS DISTINCT FROM 'string' OR length(p_body->>'release') NOT BETWEEN 1 AND 100 OR jsonb_typeof(p_body->'documentHash') IS DISTINCT FROM 'string' OR p_body->>'documentHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_body->'contentHash') IS DISTINCT FROM 'string' OR p_body->>'contentHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;expected:=(p_body->>'expectedEventId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-guide-request:'||req::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-guide-version:'||k||':'||v,0));
 SELECT * INTO prior FROM public.eva_product_guide_publication_events WHERE id=req;
 IF prior.id IS NOT NULL THEN
  IF prior.actor_id<>p_actor OR prior.input<>jsonb_build_object('action',p_action,'body',p_body) THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;
  SELECT * INTO e FROM public.eva_product_guide_publication_events WHERE publication_id=prior.publication_id ORDER BY sequence DESC LIMIT 1;
  RETURN jsonb_build_object('publicationId',prior.publication_id,'eventId',prior.id,'state',e.state,'replayed',true);
 END IF;
 SELECT * INTO p FROM public.eva_product_guide_publications WHERE guide_key=k AND version=v;
 SELECT * INTO e FROM public.eva_product_guide_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 1;
 IF e.id IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Stale event' USING ERRCODE='23505';END IF;
 IF p_action='publish' THEN
  IF p.id IS NOT NULL THEN RAISE EXCEPTION 'Version already preserved; create new version' USING ERRCODE='23505';END IF;
  IF jsonb_typeof(p_body->'snapshot') IS DISTINCT FROM 'object' OR (p_body->'snapshot')-ARRAY['key','content','roles','permissions','modules','codeSnapshots']<>'{}' OR NOT (p_body->'snapshot') ?& ARRAY['key','content','roles','permissions','modules','codeSnapshots'] OR p_body->'snapshot'->>'key' IS DISTINCT FROM k OR jsonb_typeof(p_body->'snapshot'->'content') IS DISTINCT FROM 'object' OR jsonb_typeof(p_body->'snapshot'->'roles') IS DISTINCT FROM 'array' OR jsonb_typeof(p_body->'snapshot'->'permissions') IS DISTINCT FROM 'array' OR jsonb_typeof(p_body->'snapshot'->'modules') IS DISTINCT FROM 'array' OR jsonb_typeof(p_body->'snapshot'->'codeSnapshots') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid snapshot' USING ERRCODE='22023';END IF;
  INSERT INTO public.eva_product_guide_publications(id,guide_key,version,release,document_hash,content_hash,snapshot,actor_id) VALUES(req,k,v,p_body->>'release',p_body->>'documentHash',p_body->>'contentHash',p_body->'snapshot',p_actor) RETURNING * INTO p;seq:=1;
 ELSE
  IF p.id IS NULL OR e.state<>'PUBLISHED' OR p.release IS DISTINCT FROM p_body->>'release' OR p.document_hash IS DISTINCT FROM p_body->>'documentHash' OR p.content_hash IS DISTINCT FROM p_body->>'contentHash' THEN RAISE EXCEPTION 'Publication unavailable' USING ERRCODE='23505';END IF;
  seq:=e.sequence+1;
 END IF;
 INSERT INTO public.eva_product_guide_publication_events(id,publication_id,sequence,state,actor_id,justification,input) VALUES(req,p.id,seq,CASE WHEN p_action='publish' THEN 'PUBLISHED' ELSE 'QUARANTINED' END,p_actor,p_body->>'justification',jsonb_build_object('action',p_action,'body',p_body)) RETURNING * INTO e;
 RETURN jsonb_build_object('publicationId',p.id,'eventId',e.id,'state',e.state,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.eva_product_guide_immutable() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.eva_product_guide_admin_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.eva_product_guide_read_publication(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_product_guide_admin_action(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.eva_product_guide_read_publication(text,text,text) TO service_role;
COMMIT;
