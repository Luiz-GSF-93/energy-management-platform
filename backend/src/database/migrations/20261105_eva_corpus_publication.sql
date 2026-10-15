BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE public.eva_corpus_publications(
 id uuid PRIMARY KEY,release_id uuid NOT NULL UNIQUE REFERENCES public.eva_search_releases(id),
 execution_id uuid NOT NULL UNIQUE REFERENCES public.eva_search_execution_commands(id),
 actor_id uuid NOT NULL,input jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('PREPARED','PUBLISHING','UNKNOWN','ACTIVE','QUARANTINED')),
 lease_id uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.eva_corpus_events(
 id uuid PRIMARY KEY,publication_id uuid REFERENCES public.eva_corpus_publications(id),
 sequence integer NOT NULL CHECK(sequence>0),action text NOT NULL CHECK(action IN ('prepare','publish','reconcile','send','verified','finish','quarantine','query_begin','query_finish')),
 state text NOT NULL CHECK(state IN ('PREPARED','PUBLISHING','UNKNOWN','ACTIVE','QUARANTINED','QUERY_REQUESTED','QUERY_READY','QUERY_NO_EVIDENCE','QUERY_FAILED')),
 actor_id uuid NOT NULL,actor_name text NOT NULL,organization_id text,
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=4096),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(publication_id,sequence),
 CHECK((publication_id IS NULL AND action IN ('query_begin','query_finish') AND organization_id IS NOT NULL AND organization_id='org_default') OR
       (publication_id IS NOT NULL AND action NOT IN ('query_begin','query_finish') AND organization_id IS NULL)));
CREATE INDEX eva_corpus_event_latest ON public.eva_corpus_events(publication_id,sequence DESC);
CREATE INDEX eva_corpus_metric_period ON public.eva_corpus_events(action,created_at);
CREATE UNIQUE INDEX eva_corpus_query_finish_once ON public.eva_corpus_events((payload->>'requestId')) WHERE action='query_finish';
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['eva_corpus_publications','eva_corpus_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END$$;
CREATE TRIGGER eva_corpus_events_immutable BEFORE UPDATE OR DELETE ON public.eva_corpus_events FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable();

-- Internal live source, not an endpoint. Rechecks the actual independent Owner decision.
CREATE FUNCTION public.eva_corpus_source(p_release uuid,p_chunks boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.eva_search_releases;c public.eva_search_execution_commands;e public.eva_search_events;
 j public.eva_official_extraction_jobs;d public.eva_official_document_revisions;s public.eva_official_source_revisions;result jsonb;
BEGIN
 PERFORM public.eva_search_execution_live(p_release);
 SELECT * INTO r FROM public.eva_search_releases WHERE id=p_release;
 SELECT * INTO c FROM public.eva_search_execution_commands WHERE release_id=p_release;
 SELECT * INTO e FROM public.eva_search_events WHERE release_id=p_release ORDER BY sequence DESC LIMIT 1;
 IF c.id IS NULL OR c.state<>'SUCCEEDED' OR c.index_name<>'eva-official-pilot-v1'
  OR (SELECT count(*) FROM public.eva_search_chunks WHERE release_id=p_release) NOT BETWEEN 1 AND 100
  OR (SELECT count(*) FROM public.eva_search_execution_receipts WHERE command_id=c.id)<>(SELECT count(*) FROM public.eva_search_chunks WHERE release_id=p_release)
 THEN RAISE EXCEPTION 'Verified private execution required' USING ERRCODE='23505';END IF;
 PERFORM public.platform_team_owner(c.actor_id);
 SELECT * INTO j FROM public.eva_official_extraction_jobs WHERE id=r.job_id;
 SELECT * INTO d FROM public.eva_official_document_revisions WHERE id=j.document_revision_id;
 SELECT sr.* INTO s FROM public.eva_official_source_revisions sr JOIN public.eva_official_source_events se ON se.revision_id=sr.id WHERE se.id=j.source_event_id;
 IF d.id IS NULL OR s.id IS NULL OR coalesce(r.manifest->'metadata'->>'validFrom','') !~ '^\d{4}-\d{2}-\d{2}$'
  OR d.metadata->>'url' IS NULL OR d.metadata->>'edition' IS NULL OR d.metadata->>'title' IS NULL
 THEN RAISE EXCEPTION 'Source metadata incomplete' USING ERRCODE='23505';END IF;
 result:=jsonb_build_object('releaseId',r.id,'revisionId',r.version_id,'executionId',c.id,'documentId',j.document_id,
  'title',d.metadata->>'title','version',d.metadata->>'edition','url',d.metadata->>'url','family',s.metadata->>'family','authority',s.metadata->>'authority',
  'markets',s.metadata->'markets','validFrom',r.manifest->'metadata'->>'validFrom','validTo',r.manifest->'metadata'->>'validTo',
  'topic',r.manifest->'metadata'->>'topic','fileHash',r.manifest->>'fileHash','reviewedAt',e.created_at,'reviewedBy',e.actor_id,
  'chunkTotal',(SELECT count(*) FROM public.eva_search_chunks WHERE release_id=p_release));
 IF p_chunks THEN
  result:=result||jsonb_build_object('chunks',(SELECT jsonb_agg(jsonb_build_object('id',x.id,'text',x.content,'contentHash',x.content_hash,'page',x.page,'heading',x.heading,'vector',z.vector) ORDER BY es.position,x.ordinal)
   FROM public.eva_search_chunks x JOIN public.eva_official_extraction_sections es ON es.id=x.section_id
   JOIN public.eva_search_execution_receipts z ON z.command_id=c.id AND z.chunk_id=x.id WHERE x.release_id=p_release));
 END IF;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.eva_corpus_source(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_corpus_action(p_actor uuid,p_action text,p_publication uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.eva_corpus_publications;e public.eva_corpus_events;prior public.eva_corpus_events;req uuid;pg integer;seq integer;
 src jsonb;result jsonb;profile text;month_start timestamptz;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>16000 OR p_action IS NULL
  OR p_action NOT IN ('list','detail','prepare','publish','reconcile','send','verified','finish','quarantine','metrics') THEN RAISE EXCEPTION 'Invalid publication action' USING ERRCODE='22023';END IF;
 IF p_action='metrics' THEN
  SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
  IF profile IS NULL OR profile NOT IN ('OWNER','FINANCE') THEN RAISE EXCEPTION 'Cost access denied' USING ERRCODE='42501';END IF;
  PERFORM public.platform_workflow_actor(p_actor,CASE profile WHEN 'OWNER' THEN 'e23a5c98-8b68-4ed2-aef8-70a7166407e4' ELSE '699703af-10ba-43a3-8eb8-9f0d9e477498' END);
  IF p_publication IS NOT NULL OR p_body-'month'<>'{}'::jsonb OR coalesce(p_body->>'month','') !~ '^(20|21)\d{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';END IF;
  month_start:=((p_body->>'month')||'-01')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  WITH events AS(SELECT * FROM public.eva_corpus_events WHERE created_at>=month_start AND created_at<month_start+interval '1 month'),queries AS(SELECT * FROM events WHERE action='query_finish')
  SELECT jsonb_build_object('publications',(SELECT count(*) FROM public.eva_corpus_publications),'active',(SELECT count(*) FROM public.eva_corpus_publications WHERE state='ACTIVE'),
   'requests',(SELECT count(*) FROM events WHERE action='query_begin'),'completed',count(*),'ready',count(*) FILTER(WHERE state='QUERY_READY'),
   'failed',count(*) FILTER(WHERE state='QUERY_FAILED'),'p50RetrievalMs',percentile_cont(0.5) WITHIN GROUP(ORDER BY (payload->>'elapsedMs')::integer),
   'p95RetrievalMs',percentile_cont(0.95) WITHIN GROUP(ORDER BY (payload->>'elapsedMs')::integer),
   'inputTokens',coalesce(sum((payload->>'inputTokens')::bigint),0),'searchRequests',coalesce(sum((payload->>'searchRequests')::integer),0),
   'embeddingCostMicroUsd',CASE WHEN count(*) FILTER(WHERE payload->'embeddingCostMicroUsd'='null'::jsonb)>0 THEN null ELSE sum((payload->>'embeddingCostMicroUsd')::bigint) END,
   'costIncludedInAiLedger',true,'generationCostSource','EXISTING_AI_LEDGER','providerBillingConnected',false)
  INTO result FROM queries;RETURN result;
 END IF;
 PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=p_actor::text FOR SHARE OF ur,rr,tm;
 PERFORM public.platform_team_owner(p_actor);
 IF p_action='list' THEN
  IF p_publication IS NOT NULL OR NOT p_body ?& ARRAY['page','state','search'] OR p_body-ARRAY['page','state','search']<>'{}'::jsonb OR coalesce(p_body->>'page','') !~ '^\d{1,3}$'
   OR coalesce(p_body->>'state','!') NOT IN ('','PREPARED','PUBLISHING','UNKNOWN','ACTIVE','QUARANTINED') OR jsonb_typeof(p_body->'search') IS DISTINCT FROM 'string' OR length(p_body->>'search')>100 THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;
  WITH rows AS(SELECT x.id,x.release_id,x.state,x.created_at,r.manifest->'metadata'->>'topic' title FROM public.eva_corpus_publications x JOIN public.eva_search_releases r ON r.id=x.release_id),
   filtered AS(SELECT * FROM rows WHERE (p_body->>'state'='' OR state=p_body->>'state') AND (p_body->>'search'='' OR strpos(lower(title),lower(p_body->>'search'))>0)),
   paged AS(SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 10 OFFSET pg*10)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM paged x),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',pg) INTO result;RETURN result;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-corpus:'||p_publication::text,0));
 SELECT * INTO p FROM public.eva_corpus_publications WHERE id=p_publication FOR UPDATE;
 SELECT * INTO e FROM public.eva_corpus_events WHERE publication_id=p_publication ORDER BY sequence DESC LIMIT 1;
 IF p_action='detail' THEN
  IF p.id IS NULL THEN RAISE EXCEPTION 'Publication unavailable' USING ERRCODE='23505';END IF;
  IF p_body-'page'<>'{}'::jsonb OR coalesce(p_body->>'page','') !~ '^\d{1,3}$' THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;pg:=(p_body->>'page')::integer;
  RETURN jsonb_build_object('id',p.id,'releaseId',p.release_id,'state',p.state,'eventId',e.id,'leaseUntil',p.lease_until,
   'historyTotal',(SELECT count(*) FROM public.eva_corpus_events WHERE publication_id=p.id),
   'history',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT id,action,state,actor_name,payload,created_at FROM public.eva_corpus_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 10 OFFSET pg*10)x),'[]'::jsonb));
 END IF;
 IF p_action IN ('prepare','publish','reconcile','quarantine') THEN
  IF NOT p_body ?& ARRAY['requestId','justification'] OR length(btrim(coalesce(p_body->>'justification',''))) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023';END IF;
  req:=(p_body->>'requestId')::uuid;
  IF req IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
  SELECT * INTO prior FROM public.eva_corpus_events WHERE id=req;
  IF prior.id IS NOT NULL THEN
   IF prior.publication_id IS DISTINCT FROM p_publication OR prior.actor_id<>p_actor OR prior.action<>p_action OR prior.payload IS DISTINCT FROM p_body THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505';END IF;
   RETURN jsonb_build_object('id',p.id,'state',p.state,'replayed',true);
  END IF;
  IF p_action='prepare' THEN
   IF p.id IS NOT NULL OR p_publication IS DISTINCT FROM req OR NOT p_body ?& ARRAY['releaseId','expectedReleaseEventId'] OR p_body-ARRAY['requestId','releaseId','expectedReleaseEventId','justification']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
   src:=public.eva_corpus_source((p_body->>'releaseId')::uuid,false);
   IF (SELECT id::text FROM public.eva_search_events WHERE release_id=(p_body->>'releaseId')::uuid ORDER BY sequence DESC LIMIT 1) IS DISTINCT FROM p_body->>'expectedReleaseEventId' THEN RAISE EXCEPTION 'Review changed' USING ERRCODE='23505';END IF;
   INSERT INTO public.eva_corpus_publications VALUES(req,(src->>'releaseId')::uuid,(src->>'executionId')::uuid,p_actor,p_body,'PREPARED',null,null,clock_timestamp());
   INSERT INTO public.eva_corpus_events VALUES(req,req,1,p_action,'PREPARED',p_actor,public.platform_workflow_name(p_actor),null,p_body,clock_timestamp());
   RETURN jsonb_build_object('id',req,'state','PREPARED','replayed',false);
  END IF;
  IF p.id IS NULL OR NOT p_body ? 'expectedEventId' OR p_body-ARRAY['requestId','expectedEventId','justification']<>'{}'::jsonb OR e.id::text IS DISTINCT FROM p_body->>'expectedEventId' THEN RAISE EXCEPTION 'Publication changed' USING ERRCODE='23505';END IF;
  seq:=e.sequence+1;
  IF p_action='quarantine' THEN
   IF p.state='QUARANTINED' THEN RAISE EXCEPTION 'Already quarantined' USING ERRCODE='23505';END IF;
   -- Local denial is effective before any eventual remote cleanup. Never waits on Azure.
   UPDATE public.eva_corpus_publications SET state='QUARANTINED',lease_id=null,lease_until=null WHERE id=p.id;
   INSERT INTO public.eva_corpus_events VALUES(req,p.id,seq,p_action,'QUARANTINED',p_actor,public.platform_workflow_name(p_actor),null,p_body,clock_timestamp());
   RETURN jsonb_build_object('id',p.id,'state','QUARANTINED');
  END IF;
  src:=public.eva_corpus_source(p.release_id,true);PERFORM public.platform_team_owner(p.actor_id);
  IF (p_action='publish' AND p.state<>'PREPARED') OR (p_action='reconcile' AND NOT(p.state='UNKNOWN' OR (p.state='PUBLISHING' AND p.lease_until<clock_timestamp()))) THEN RAISE EXCEPTION 'No safe publication lease' USING ERRCODE='23505';END IF;
  UPDATE public.eva_corpus_publications SET state='PUBLISHING',lease_id=req,lease_until=clock_timestamp()+interval '60 minutes' WHERE id=p.id;
  INSERT INTO public.eva_corpus_events VALUES(req,p.id,seq,p_action,'PUBLISHING',p_actor,public.platform_workflow_name(p_actor),null,p_body,clock_timestamp());
  RETURN src||jsonb_build_object('id',p.id,'leaseId',req,'readOnly',p_action='reconcile');
 END IF;
 IF p.id IS NULL OR p.state<>'PUBLISHING' OR p.lease_id::text IS DISTINCT FROM p_body->>'leaseId' OR p.lease_until<clock_timestamp() THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='23505';END IF;
 PERFORM public.platform_team_owner(p.actor_id);seq:=e.sequence+1;
 IF p_action IN ('send','verified') THEN
  IF NOT p_body ?& ARRAY['requestId','leaseId','chunkId'] OR p_body-ARRAY['requestId','leaseId','chunkId','kind']<>'{}'::jsonb OR NOT EXISTS(SELECT 1 FROM public.eva_search_chunks WHERE release_id=p.release_id AND id=p_body->>'chunkId') THEN RAISE EXCEPTION 'Invalid publication evidence' USING ERRCODE='22023';END IF;
  PERFORM public.eva_corpus_source(p.release_id,false);
  IF p_action='send' THEN
   IF coalesce(p_body->>'kind','') NOT IN ('LOOKUP','MERGE') THEN RAISE EXCEPTION 'Invalid provider operation' USING ERRCODE='22023';END IF;
   IF (SELECT action FROM public.eva_corpus_events WHERE id=p.lease_id)='reconcile' AND p_body->>'kind'<>'LOOKUP' THEN RAISE EXCEPTION 'Read-only recovery' USING ERRCODE='42501';END IF;
   IF (SELECT count(*) FROM public.eva_corpus_events WHERE publication_id=p.id AND action='send')>=600 OR
    (p_body->>'kind'='MERGE' AND EXISTS(SELECT 1 FROM public.eva_corpus_events WHERE publication_id=p.id AND action='send' AND payload->>'kind'='MERGE' AND payload->>'chunkId'=p_body->>'chunkId')) THEN RAISE EXCEPTION 'Duplicate or excessive request' USING ERRCODE='23505';END IF;
  ELSIF p_body ? 'kind' OR NOT EXISTS(SELECT 1 FROM public.eva_corpus_events WHERE publication_id=p.id AND action='send' AND payload->>'leaseId'=p.lease_id::text AND payload->>'chunkId'=p_body->>'chunkId' AND payload->>'kind'='LOOKUP')
   OR EXISTS(SELECT 1 FROM public.eva_corpus_events WHERE publication_id=p.id AND action='verified' AND payload->>'leaseId'=p.lease_id::text AND payload->>'chunkId'=p_body->>'chunkId') THEN RAISE EXCEPTION 'Lookup or unique proof required' USING ERRCODE='23505';END IF;
  INSERT INTO public.eva_corpus_events VALUES((p_body->>'requestId')::uuid,p.id,seq,p_action,'PUBLISHING',p_actor,public.platform_workflow_name(p_actor),null,p_body,clock_timestamp());RETURN jsonb_build_object('recorded',true);
 END IF;
 IF p_action='finish' THEN
  IF NOT p_body ?& ARRAY['requestId','leaseId','confirmed'] OR p_body-ARRAY['requestId','leaseId','confirmed']<>'{}'::jsonb OR jsonb_typeof(p_body->'confirmed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid completion' USING ERRCODE='22023';END IF;
  IF (p_body->>'confirmed')::boolean THEN
   PERFORM public.eva_corpus_source(p.release_id,false);
   IF (SELECT count(*) FROM public.eva_corpus_events WHERE publication_id=p.id AND action='verified' AND payload->>'leaseId'=p.lease_id::text)<>(SELECT count(*) FROM public.eva_search_chunks WHERE release_id=p.release_id) THEN RAISE EXCEPTION 'Incomplete publication' USING ERRCODE='23505';END IF;
  END IF;
  UPDATE public.eva_corpus_publications SET state=CASE WHEN (p_body->>'confirmed')::boolean THEN 'ACTIVE' ELSE 'UNKNOWN' END,lease_until=null WHERE id=p.id;
  INSERT INTO public.eva_corpus_events VALUES((p_body->>'requestId')::uuid,p.id,seq,p_action,CASE WHEN (p_body->>'confirmed')::boolean THEN 'ACTIVE' ELSE 'UNKNOWN' END,p_actor,public.platform_workflow_name(p_actor),null,p_body,clock_timestamp());
  RETURN jsonb_build_object('id',p.id,'state',CASE WHEN (p_body->>'confirmed')::boolean THEN 'ACTIVE' ELSE 'UNKNOWN' END);
 END IF;
 RAISE EXCEPTION 'Unsupported action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.eva_corpus_action(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_corpus_action(uuid,text,uuid,jsonb) TO service_role;

-- Scope comes from the authenticated backend context, then is independently checked live.
CREATE FUNCTION public.eva_corpus_rag(p_actor uuid,p_org text,p_role text,p_operation boolean,p_action text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pub public.eva_corpus_publications;ev public.eva_corpus_events;src jsonb;item jsonb;hit jsonb;result jsonb:='[]';validated_sources jsonb:='{}';x public.eva_search_chunks;begin_event public.eva_corpus_events;
BEGIN
 IF p_org IS DISTINCT FROM 'org_default' OR p_actor IS NULL OR p_role IS NULL OR p_operation IS NULL OR
  NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) OR coalesce(public.bot_energy_license_quota(p_org),0)<=0 THEN RAISE EXCEPTION 'Pilot access denied' USING ERRCODE='42501';END IF;
 IF p_operation THEN
  PERFORM public.platform_team_owner(p_actor);
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor::text AND expires_at>clock_timestamp() AND revoked_at IS NULL)
   OR NOT EXISTS(SELECT 1 FROM public.roles rr WHERE rr.id::text=p_role AND rr.organization_id=p_org AND rr.scope='organization' AND rr.name='admin_org' AND rr.permissions ? '62443ab1-9187-42e4-a932-a7cf54f76250')
   OR (SELECT count(*) FROM public.roles rr WHERE rr.organization_id=p_org AND rr.scope='organization' AND rr.name='admin_org')<>1
   OR NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id WHERE ur.user_id::text=p_actor::text AND rr.scope='global' AND rr.permissions ? '5f6e284b-07b2-4e3c-aec3-a331c071719a') THEN RAISE EXCEPTION 'Operation access denied' USING ERRCODE='42501';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles rr ON rr.id=m.role_id AND rr.organization_id=m.organization_id AND rr.scope='organization'
   WHERE m.organization_id=p_org AND m.user_id::text=p_actor::text AND rr.id::text=p_role AND upper(m.status)='ACTIVE' AND rr.name IN ('admin_org','gestor','operacional') AND rr.permissions ? '62443ab1-9187-42e4-a932-a7cf54f76250') THEN RAISE EXCEPTION 'Organization access denied' USING ERRCODE='42501';END IF;
 END IF;
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>64000 OR p_action IS NULL OR p_action NOT IN ('sources','hydrate','revalidate','begin','finish') THEN RAISE EXCEPTION 'Invalid retrieval' USING ERRCODE='22023';END IF;
 IF p_action='sources' THEN
  IF NOT p_body ?& ARRAY['from','to','market'] OR p_body-ARRAY['from','to','market']<>'{}'::jsonb OR coalesce(p_body->>'from','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(p_body->>'to','') !~ '^\d{4}-\d{2}-\d{2}$' OR (p_body->>'from')::date>(p_body->>'to')::date OR coalesce(p_body->>'market','') NOT IN ('COMMON','ACL','ACR','GD') THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023';END IF;
  FOR pub IN SELECT * FROM public.eva_corpus_publications WHERE state='ACTIVE' ORDER BY id LOOP
   src:=public.eva_corpus_source(pub.release_id,false);
   IF (src->>'validFrom')::date<=(p_body->>'to')::date AND (src->>'validTo' IS NULL OR (src->>'validTo')::date>(p_body->>'from')::date) AND ((src->'markets') ? 'COMMON' OR (src->'markets') ? (p_body->>'market')) THEN
    SELECT * INTO ev FROM public.eva_corpus_events WHERE publication_id=pub.id ORDER BY sequence DESC LIMIT 1;
    result:=result||jsonb_build_array(src||jsonb_build_object('publicationId',pub.id,'publicationEventId',ev.id));
   END IF;
  END LOOP;
  IF jsonb_array_length(result)>8 THEN RAISE EXCEPTION 'Corpus bound exceeded' USING ERRCODE='22023';END IF;
  RETURN result;
 END IF;
 IF p_action IN ('hydrate','revalidate','begin') THEN
  IF NOT p_body ? 'proofs' OR jsonb_typeof(p_body->'proofs') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'proofs') NOT BETWEEN 1 AND 8 OR p_body-ARRAY['proofs','hits','requestId']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid proof' USING ERRCODE='22023';END IF;
  IF (SELECT count(DISTINCT value->>'publicationId') FROM jsonb_array_elements(p_body->'proofs'))<>jsonb_array_length(p_body->'proofs') THEN RAISE EXCEPTION 'Duplicate proof' USING ERRCODE='22023';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_body->'proofs') LOOP
   IF NOT item ?& ARRAY['publicationId','eventId'] OR item-ARRAY['publicationId','eventId']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid proof' USING ERRCODE='22023';END IF;
   SELECT * INTO pub FROM public.eva_corpus_publications WHERE id=(item->>'publicationId')::uuid;
   SELECT * INTO ev FROM public.eva_corpus_events WHERE publication_id=pub.id ORDER BY sequence DESC LIMIT 1;
   IF pub.id IS NULL OR pub.state<>'ACTIVE' OR ev.id::text IS DISTINCT FROM item->>'eventId' THEN RAISE EXCEPTION 'Publication revoked or changed' USING ERRCODE='23505';END IF;
   src:=public.eva_corpus_source(pub.release_id,false);
   validated_sources:=validated_sources||jsonb_build_object(pub.release_id::text,src);
  END LOOP;
  IF p_action='revalidate' THEN
   IF p_body-'proofs'<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid revalidation' USING ERRCODE='22023';END IF;RETURN jsonb_build_object('valid',true);
  END IF;
  IF p_action='begin' THEN
   IF NOT p_body ? 'requestId' OR p_body-ARRAY['proofs','requestId']<>'{}'::jsonb THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
   INSERT INTO public.eva_corpus_events VALUES((p_body->>'requestId')::uuid,null,1,'query_begin','QUERY_REQUESTED',p_actor,public.platform_workflow_name(p_actor),p_org,'{}',clock_timestamp());RETURN jsonb_build_object('recorded',true);
  END IF;
  IF NOT p_body ? 'hits' OR p_body-ARRAY['proofs','hits']<>'{}'::jsonb OR jsonb_typeof(p_body->'hits') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'hits')>80 THEN RAISE EXCEPTION 'Invalid hits' USING ERRCODE='22023';END IF;
  IF (SELECT count(DISTINCT ((value->>'releaseId')||'|'||(value->>'chunkId'))) FROM jsonb_array_elements(p_body->'hits'))<>jsonb_array_length(p_body->'hits') THEN RAISE EXCEPTION 'Duplicate hit' USING ERRCODE='22023';END IF;
  FOR hit IN SELECT value FROM jsonb_array_elements(p_body->'hits') LOOP
   IF NOT hit ?& ARRAY['releaseId','chunkId','revisionId','contentHash'] OR hit-ARRAY['releaseId','chunkId','revisionId','contentHash']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid hit' USING ERRCODE='22023';END IF;
   SELECT p.* INTO pub FROM public.eva_corpus_publications p WHERE release_id=(hit->>'releaseId')::uuid AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_body->'proofs') v WHERE v->>'publicationId'=p.id::text);
   IF pub.id IS NULL THEN RAISE EXCEPTION 'Hit outside authorized release' USING ERRCODE='42501';END IF;
   src:=validated_sources->pub.release_id::text;
   SELECT * INTO x FROM public.eva_search_chunks WHERE release_id=pub.release_id AND id=hit->>'chunkId';
   IF x.id IS NULL OR src->>'revisionId' IS DISTINCT FROM hit->>'revisionId' OR x.content_hash IS DISTINCT FROM hit->>'contentHash' OR x.content_hash IS DISTINCT FROM encode(sha256(convert_to(x.content,'UTF8')),'hex') THEN RAISE EXCEPTION 'Hit integrity failed' USING ERRCODE='23505';END IF;
   result:=result||jsonb_build_array(src||jsonb_build_object('chunkId',x.id,'text',x.content,'textHash',x.content_hash,'page',x.page,'heading',x.heading,'context',x.context));
  END LOOP;
  RETURN result;
 END IF;
 IF NOT p_body ?& ARRAY['requestId','eventId','state','elapsedMs','inputTokens','searchRequests','embeddingCostMicroUsd'] OR p_body-ARRAY['requestId','eventId','state','elapsedMs','inputTokens','searchRequests','embeddingCostMicroUsd']<>'{}'::jsonb OR coalesce(p_body->>'state','') NOT IN ('READY','NO_EVIDENCE','FAILED') OR coalesce(p_body->>'elapsedMs','') !~ '^\d{1,7}$' OR (p_body->>'elapsedMs')::integer>3600000 OR coalesce(p_body->>'inputTokens','') !~ '^\d{1,4}$' OR (p_body->>'inputTokens')::integer>2000 OR coalesce(p_body->>'searchRequests','') !~ '^[0-8]$' OR (p_body->'embeddingCostMicroUsd'<>'null'::jsonb AND (coalesce(p_body->>'embeddingCostMicroUsd','') !~ '^\d{1,12}$')) THEN RAISE EXCEPTION 'Invalid retrieval metric' USING ERRCODE='22023';END IF;
 SELECT * INTO begin_event FROM public.eva_corpus_events WHERE id=(p_body->>'requestId')::uuid AND action='query_begin' AND actor_id=p_actor AND organization_id=p_org;
 IF begin_event.id IS NULL THEN RAISE EXCEPTION 'Audited intent required' USING ERRCODE='23505';END IF;
 -- Distinct immutable events; the unique request index prevents double settlement.
 IF (p_body->>'eventId')::uuid IS NULL OR (p_body->>'eventId')::uuid=begin_event.id THEN RAISE EXCEPTION 'Distinct finish identifier required' USING ERRCODE='22023';END IF;
 INSERT INTO public.eva_corpus_events VALUES((p_body->>'eventId')::uuid,null,2,'query_finish','QUERY_'||(p_body->>'state'),p_actor,public.platform_workflow_name(p_actor),p_org,p_body-'eventId',clock_timestamp());
 RETURN jsonb_build_object('recorded',true);
END$$;
REVOKE ALL ON FUNCTION public.eva_corpus_rag(uuid,text,text,boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_corpus_rag(uuid,text,text,boolean,text,jsonb) TO service_role;
COMMIT;
