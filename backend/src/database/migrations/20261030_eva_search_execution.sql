BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_search_execution_commands(
 id uuid PRIMARY KEY,release_id uuid NOT NULL UNIQUE REFERENCES public.eva_search_releases(id),
 actor_id uuid NOT NULL,release_event_id uuid NOT NULL REFERENCES public.eva_search_events(id),
 input jsonb NOT NULL,index_name text NOT NULL CHECK(index_name='eva-official-pilot-v1'),
 token_limit integer NOT NULL CHECK(token_limit BETWEEN 1 AND 1000000),
 state text NOT NULL CHECK(state IN ('PREPARED','RUNNING','UNKNOWN','SUCCEEDED','WITHDRAWN')),
 lease_id uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.eva_search_execution_events(
 id uuid PRIMARY KEY,command_id uuid NOT NULL REFERENCES public.eva_search_execution_commands(id),
 sequence integer NOT NULL CHECK(sequence>0),action text NOT NULL CHECK(action IN ('prepare','withdraw','claim','reconcile','send','verified','finish')),
 actor_id uuid NOT NULL,actor_name text NOT NULL,state text NOT NULL CHECK(state IN ('PREPARED','RUNNING','UNKNOWN','SUCCEEDED','WITHDRAWN')),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=4096),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(command_id,sequence));
CREATE TABLE public.eva_search_execution_receipts(
 command_id uuid NOT NULL REFERENCES public.eva_search_execution_commands(id),chunk_id text NOT NULL,
 vector jsonb NOT NULL CHECK(jsonb_typeof(vector)='array' AND jsonb_array_length(vector)=1536),
 tokens integer NOT NULL CHECK(tokens BETWEEN 1 AND 16000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(command_id,chunk_id));
CREATE INDEX eva_search_execution_event_latest ON public.eva_search_execution_events(command_id,sequence DESC);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['eva_search_execution_commands','eva_search_execution_events','eva_search_execution_receipts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['eva_search_execution_events','eva_search_execution_receipts'] LOOP
  EXECUTE format('CREATE TRIGGER eva_search_execution_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable()',t);
 END LOOP;
END$$;

-- Internal helpers have no executable grant to API/database clients.
CREATE FUNCTION public.eva_search_execution_live(p_release uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.eva_search_releases;e public.eva_search_events;candidate jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-search-release:'||p_release::text,0));
 SELECT * INTO r FROM public.eva_search_releases WHERE id=p_release;
 SELECT * INTO e FROM public.eva_search_events WHERE release_id=p_release ORDER BY sequence DESC LIMIT 1;
 IF r.id IS NULL OR e.state IS DISTINCT FROM 'APPROVED_PRIVATE' OR e.actor_id=r.actor_id THEN RAISE EXCEPTION 'Approved release required' USING ERRCODE='23505';END IF;
 PERFORM public.platform_team_owner(e.actor_id);
 PERFORM public.platform_team_owner(r.actor_id);
 candidate:=public.eva_search_candidate(r.job_id,true);
 IF candidate->>'versionId' IS DISTINCT FROM r.version_id::text OR candidate->>'reviewEventId' IS DISTINCT FROM r.review_event_id::text OR candidate->>'contentHash' IS DISTINCT FROM r.manifest->>'contentHash' THEN RAISE EXCEPTION 'Live review changed' USING ERRCODE='23505';END IF;
END$$;
REVOKE ALL ON FUNCTION public.eva_search_execution_live(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_search_execution_action(p_actor uuid,p_action text,p_command uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.eva_search_execution_commands; e public.eva_search_execution_events;
 r public.eva_search_releases; ev public.eva_search_events;req uuid;pg integer;result jsonb;seq integer;profile text;reserved bigint;calls bigint;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>100000 OR p_action IS NULL OR p_action NOT IN ('list','detail','prepare','withdraw','claim','reconcile','send','embedded','verified','finish','metrics') THEN RAISE EXCEPTION 'Invalid execution command' USING ERRCODE='22023';END IF;
 IF p_action='metrics' THEN
  SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
  IF profile IS NULL OR profile NOT IN ('OWNER','FINANCE') THEN RAISE EXCEPTION 'Cost access denied' USING ERRCODE='42501';END IF;
  PERFORM public.platform_workflow_actor(p_actor,CASE profile WHEN 'OWNER' THEN 'e23a5c98-8b68-4ed2-aef8-70a7166407e4' ELSE '699703af-10ba-43a3-8eb8-9f0d9e477498' END);
  IF p_command IS NOT NULL OR p_body-'month'<>'{}'::jsonb OR coalesce(p_body->>'month','') !~ '^(20|21)\d{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';END IF;
  SELECT jsonb_build_object('commands',count(*),'confirmed',count(*) FILTER(WHERE state='SUCCEEDED'),'unknown',count(*) FILTER(WHERE state='UNKNOWN' OR (state='RUNNING' AND lease_until<clock_timestamp())),'requests',(SELECT count(*) FROM public.eva_search_execution_events x WHERE x.action='send' AND to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM')=p_body->>'month'),'inputTokens',(SELECT coalesce(sum(x.tokens),0) FROM public.eva_search_execution_receipts x WHERE to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM')=p_body->>'month'),'averageWorkerMs',(SELECT round(avg((x.payload->>'elapsedMs')::numeric)) FROM public.eva_search_execution_events x WHERE x.action='finish' AND to_char(x.created_at AT TIME ZONE 'UTC','YYYY-MM')=p_body->>'month'),'actualCostMicroUsd',null,'costSource','NOT_CONNECTED','published',false) INTO result FROM public.eva_search_execution_commands WHERE to_char(created_at AT TIME ZONE 'UTC','YYYY-MM')=p_body->>'month';RETURN result;
 END IF;
 PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=p_actor::text FOR SHARE OF ur,rr,tm;
 PERFORM public.platform_team_owner(p_actor);
 IF p_action='list' THEN
  IF p_command IS NOT NULL OR NOT p_body ?& ARRAY['page','state'] OR p_body-ARRAY['page','state']<>'{}'::jsonb OR coalesce(p_body->>'page','') !~ '^\d{1,3}$' OR coalesce(p_body->>'state','!') NOT IN ('','PREPARED','RUNNING','UNKNOWN','SUCCEEDED','WITHDRAWN') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;
  WITH filtered AS(SELECT id,release_id,state,index_name,token_limit,lease_until,created_at FROM public.eva_search_execution_commands WHERE p_body->>'state'='' OR state=p_body->>'state'),paged AS(SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 10 OFFSET pg*10)
  SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM paged x),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'page',pg) INTO result;RETURN result;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-search-execution:'||p_command::text,0));
 SELECT * INTO c FROM public.eva_search_execution_commands WHERE id=p_command FOR UPDATE;
 SELECT * INTO e FROM public.eva_search_execution_events WHERE command_id=p_command ORDER BY sequence DESC LIMIT 1;
 IF p_action='detail' THEN
  IF c.id IS NULL THEN RAISE EXCEPTION 'Command unavailable' USING ERRCODE='23505';END IF;
  IF p_body-'page'<>'{}'::jsonb OR coalesce(p_body->>'page','') !~ '^\d{1,3}$' THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;
  RETURN jsonb_build_object('id',c.id,'releaseId',c.release_id,'state',c.state,'eventId',e.id,'indexName',c.index_name,'tokenLimit',c.token_limit,'leaseUntil',c.lease_until,'published',false,'receiptCount',(SELECT count(*) FROM public.eva_search_execution_receipts WHERE command_id=c.id),'historyTotal',(SELECT count(*) FROM public.eva_search_execution_events WHERE command_id=c.id),'history',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT id,sequence,action,state,actor_name,payload,created_at FROM public.eva_search_execution_events WHERE command_id=c.id ORDER BY sequence DESC LIMIT 10 OFFSET pg*10)x),'[]'::jsonb));
 END IF;
 IF p_action='prepare' THEN
  IF NOT p_body ?& ARRAY['requestId','releaseId','expectedReleaseEventId','tokenLimit','justification'] OR p_body-ARRAY['requestId','releaseId','expectedReleaseEventId','tokenLimit','justification']<>'{}'::jsonb OR length(btrim(coalesce(p_body->>'justification',''))) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' OR p_command::text IS DISTINCT FROM p_body->>'requestId' OR coalesce(p_body->>'tokenLimit','') !~ '^\d{1,7}$' OR (p_body->>'tokenLimit')::integer NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  IF c.id IS NOT NULL THEN IF c.actor_id<>p_actor OR c.input<>p_body THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('id',c.id,'state',c.state,'replayed',true);END IF;
  PERFORM public.eva_search_execution_live((p_body->>'releaseId')::uuid);
  SELECT * INTO ev FROM public.eva_search_events WHERE release_id=(p_body->>'releaseId')::uuid ORDER BY sequence DESC LIMIT 1;
  IF ev.id::text IS DISTINCT FROM p_body->>'expectedReleaseEventId' OR EXISTS(SELECT 1 FROM public.eva_search_chunks WHERE release_id=ev.release_id AND length(content)>6000) OR (SELECT count(*) FROM public.eva_search_chunks WHERE release_id=ev.release_id) NOT BETWEEN 1 AND 100 OR (SELECT sum(octet_length(content)) FROM public.eva_search_chunks WHERE release_id=ev.release_id)>(p_body->>'tokenLimit')::integer THEN RAISE EXCEPTION 'Release or token bound changed' USING ERRCODE='23505';END IF;
  INSERT INTO public.eva_search_execution_commands VALUES(p_command,ev.release_id,p_actor,ev.id,p_body,'eva-official-pilot-v1',(p_body->>'tokenLimit')::integer,'PREPARED',null,null,clock_timestamp());
  INSERT INTO public.eva_search_execution_events VALUES(p_command,p_command,1,'prepare',p_actor,public.platform_workflow_name(p_actor),'PREPARED',jsonb_build_object('justification',p_body->>'justification'),clock_timestamp());
  RETURN jsonb_build_object('id',p_command,'state','PREPARED','published',false,'replayed',false);
 END IF;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Command unavailable' USING ERRCODE='23505';END IF;
 seq:=e.sequence+1;
 IF p_action IN ('withdraw','claim','reconcile') THEN
  IF NOT p_body ?& ARRAY['requestId','expectedEventId','justification'] OR p_body-ARRAY['requestId','expectedEventId','justification']<>'{}'::jsonb OR length(btrim(coalesce(p_body->>'justification',''))) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023';END IF;
  req:=(p_body->>'requestId')::uuid;
  IF EXISTS(SELECT 1 FROM public.eva_search_execution_events WHERE id=req) OR e.id::text IS DISTINCT FROM p_body->>'expectedEventId' THEN RAISE EXCEPTION 'Event changed' USING ERRCODE='23505';END IF;
  IF p_action='withdraw' THEN
   IF c.state<>'PREPARED' THEN RAISE EXCEPTION 'Cannot withdraw attempted command' USING ERRCODE='23505';END IF;
   UPDATE public.eva_search_execution_commands SET state='WITHDRAWN' WHERE id=c.id;
   INSERT INTO public.eva_search_execution_events VALUES(req,c.id,seq,p_action,p_actor,public.platform_workflow_name(p_actor),'WITHDRAWN',jsonb_build_object('justification',p_body->>'justification'),clock_timestamp());
   RETURN jsonb_build_object('id',c.id,'state','WITHDRAWN');
  END IF;
  PERFORM public.eva_search_execution_live(c.release_id);
  PERFORM public.platform_team_owner(c.actor_id);
  IF (p_action='claim' AND c.state<>'PREPARED') OR (p_action='reconcile' AND NOT(c.state='UNKNOWN' OR (c.state='RUNNING' AND c.lease_until<clock_timestamp()))) THEN RAISE EXCEPTION 'No safe execution lease' USING ERRCODE='23505';END IF;
  UPDATE public.eva_search_execution_commands SET state='RUNNING',lease_id=req,lease_until=clock_timestamp()+interval '60 minutes' WHERE id=c.id;
  INSERT INTO public.eva_search_execution_events VALUES(req,c.id,seq,p_action,p_actor,public.platform_workflow_name(p_actor),'RUNNING',jsonb_build_object('justification',p_body->>'justification','readOnly',p_action='reconcile'),clock_timestamp());
  SELECT * INTO r FROM public.eva_search_releases WHERE id=c.release_id;
  RETURN jsonb_build_object('id',c.id,'releaseId',c.release_id,'revisionId',r.version_id,'leaseId',req,'indexName',c.index_name,'tokenLimit',c.token_limit,'chunks',(SELECT jsonb_agg(jsonb_build_object('id',x.id,'text',x.content,'contentHash',x.content_hash,'vector',(SELECT vector FROM public.eva_search_execution_receipts z WHERE z.command_id=c.id AND z.chunk_id=x.id)) ORDER BY s.position,x.ordinal) FROM public.eva_search_chunks x JOIN public.eva_official_extraction_sections s ON s.id=x.section_id WHERE x.release_id=c.release_id));
 END IF;
 IF c.state<>'RUNNING' OR c.lease_id::text IS DISTINCT FROM p_body->>'leaseId' OR c.lease_until<clock_timestamp() THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='23505';END IF;
 IF p_action='send' THEN
  IF p_body-ARRAY['leaseId','requestId','kind','chunkId','reservedTokens']<>'{}'::jsonb OR coalesce(p_body->>'kind','') NOT IN ('EMBEDDING','INDEX','LOOKUP') OR NOT EXISTS(SELECT 1 FROM public.eva_search_chunks WHERE release_id=c.release_id AND id=p_body->>'chunkId') OR coalesce(p_body->>'reservedTokens','') !~ '^\d{1,6}$' THEN RAISE EXCEPTION 'Invalid send reservation' USING ERRCODE='22023';END IF;
  IF (SELECT action FROM public.eva_search_execution_events WHERE id=c.lease_id)='reconcile' AND p_body->>'kind'<>'LOOKUP' THEN RAISE EXCEPTION 'Recovery is read-only' USING ERRCODE='42501';END IF;
  PERFORM public.eva_search_execution_live(c.release_id);
  SELECT coalesce(sum((payload->>'reservedTokens')::integer),0),count(*) INTO reserved,calls FROM public.eva_search_execution_events WHERE command_id=c.id AND action='send';
  IF calls>=600 OR reserved+(p_body->>'reservedTokens')::integer>c.token_limit OR (p_body->>'kind'='EMBEDDING' AND ((p_body->>'reservedTokens')::integer<>(SELECT octet_length(content) FROM public.eva_search_chunks WHERE release_id=c.release_id AND id=p_body->>'chunkId') OR EXISTS(SELECT 1 FROM public.eva_search_execution_events WHERE command_id=c.id AND action='send' AND payload->>'kind'='EMBEDDING' AND payload->>'chunkId'=p_body->>'chunkId'))) OR (p_body->>'kind'='INDEX' AND EXISTS(SELECT 1 FROM public.eva_search_execution_events WHERE command_id=c.id AND action='send' AND payload->>'kind'='INDEX' AND payload->>'chunkId'=p_body->>'chunkId')) OR (p_body->>'kind'<>'EMBEDDING' AND (p_body->>'reservedTokens')::integer<>0) THEN RAISE EXCEPTION 'Budget or duplicate send' USING ERRCODE='23505';END IF;
  req:=(p_body->>'requestId')::uuid;
  IF p_body->>'kind'='INDEX' AND NOT EXISTS(SELECT 1 FROM public.eva_search_execution_receipts WHERE command_id=c.id AND chunk_id=p_body->>'chunkId') THEN RAISE EXCEPTION 'Embedding receipt required' USING ERRCODE='23505';END IF;
  INSERT INTO public.eva_search_execution_events VALUES(req,c.id,seq,'send',p_actor,public.platform_workflow_name(p_actor),'RUNNING',p_body-'leaseId',clock_timestamp());RETURN jsonb_build_object('reserved',true);
 END IF;
 IF p_action='embedded' THEN
  IF p_body-ARRAY['leaseId','chunkId','vector','tokens']<>'{}'::jsonb OR jsonb_typeof(p_body->'vector') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'vector')<>1536 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_body->'vector')v WHERE jsonb_typeof(v) IS DISTINCT FROM 'number' OR abs((v#>>'{}')::numeric)>1) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_body->'vector')v WHERE (v#>>'{}')::numeric<>0) OR coalesce(p_body->>'tokens','') !~ '^\d{1,5}$' OR (p_body->>'tokens')::integer<1 THEN RAISE EXCEPTION 'Invalid vector receipt' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.eva_search_execution_events WHERE command_id=c.id AND action='send' AND payload->>'kind'='EMBEDDING' AND payload->>'chunkId'=p_body->>'chunkId' AND (payload->>'reservedTokens')::integer>=(p_body->>'tokens')::integer) THEN RAISE EXCEPTION 'Embedding not reserved' USING ERRCODE='23505';END IF;
  INSERT INTO public.eva_search_execution_receipts(command_id,chunk_id,vector,tokens) VALUES(c.id,p_body->>'chunkId',p_body->'vector',(p_body->>'tokens')::integer);RETURN jsonb_build_object('preserved',true);
 END IF;
 IF p_action='finish' THEN
  IF p_body-ARRAY['leaseId','requestId','state','reason','elapsedMs']<>'{}'::jsonb OR coalesce(p_body->>'elapsedMs','') !~ '^\d{1,7}$' OR (p_body->>'elapsedMs')::integer>3600000 OR coalesce(p_body->>'state','') NOT IN ('UNKNOWN','SUCCEEDED') OR coalesce(p_body->>'reason','') NOT IN ('CONFIRMED','PARTIAL','PROVIDER_UNKNOWN','SOURCE_CHANGED','MISSING_OR_DIVERGENT') THEN RAISE EXCEPTION 'Invalid outcome' USING ERRCODE='22023';END IF;
  IF p_body->>'state'='SUCCEEDED' THEN
   PERFORM public.eva_search_execution_live(c.release_id);
   IF p_body->>'reason'<>'CONFIRMED' OR (SELECT count(*) FROM public.eva_search_execution_receipts WHERE command_id=c.id)<>(SELECT count(*) FROM public.eva_search_chunks WHERE release_id=c.release_id) OR (SELECT count(DISTINCT payload->>'chunkId') FROM public.eva_search_execution_events WHERE command_id=c.id AND action='verified' AND payload->>'leaseId'=c.lease_id::text)<>(SELECT count(*) FROM public.eva_search_chunks WHERE release_id=c.release_id) THEN RAISE EXCEPTION 'Incomplete receipts' USING ERRCODE='23505';END IF;
  END IF;
  UPDATE public.eva_search_execution_commands SET state=p_body->>'state',lease_until=null WHERE id=c.id;
  INSERT INTO public.eva_search_execution_events VALUES((p_body->>'requestId')::uuid,c.id,seq,'finish',p_actor,public.platform_workflow_name(p_actor),p_body->>'state',jsonb_build_object('reason',p_body->>'reason','elapsedMs',(p_body->>'elapsedMs')::integer),clock_timestamp());
  RETURN jsonb_build_object('id',c.id,'state',p_body->>'state','published',false);
 END IF;
 IF p_action='verified' THEN
  IF p_body-ARRAY['leaseId','requestId','chunkId']<>'{}'::jsonb OR NOT EXISTS(SELECT 1 FROM public.eva_search_execution_receipts WHERE command_id=c.id AND chunk_id=p_body->>'chunkId') OR NOT EXISTS(SELECT 1 FROM public.eva_search_execution_events WHERE command_id=c.id AND action='send' AND payload->>'kind'='LOOKUP' AND payload->>'chunkId'=p_body->>'chunkId' AND sequence>(SELECT sequence FROM public.eva_search_execution_events WHERE id=c.lease_id)) OR EXISTS(SELECT 1 FROM public.eva_search_execution_events WHERE command_id=c.id AND action='verified' AND payload->>'leaseId'=c.lease_id::text AND payload->>'chunkId'=p_body->>'chunkId') THEN RAISE EXCEPTION 'Lookup evidence required' USING ERRCODE='23505';END IF;
  INSERT INTO public.eva_search_execution_events VALUES((p_body->>'requestId')::uuid,c.id,seq,'verified',p_actor,public.platform_workflow_name(p_actor),'RUNNING',jsonb_build_object('chunkId',p_body->>'chunkId','leaseId',c.lease_id),clock_timestamp());RETURN jsonb_build_object('verified',true);
 END IF;
 RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.eva_search_execution_action(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_search_execution_action(uuid,text,uuid,jsonb) TO service_role;
COMMIT;
