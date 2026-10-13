BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Fix only list aliases; retain existing function ACL, signature and history.
CREATE OR REPLACE FUNCTION public.eva_product_guide_admin_action(p_actor uuid,p_action text,p_body jsonb) RETURNS jsonb
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
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(pub)||jsonb_build_object('state',latest.state,'event_id',latest.id) ORDER BY pub.guide_key,pub.version),'[]'::jsonb) FROM public.eva_product_guide_publications pub CROSS JOIN LATERAL(SELECT ev.id,ev.state FROM public.eva_product_guide_publication_events ev WHERE ev.publication_id=pub.id ORDER BY ev.sequence DESC LIMIT 1)latest);
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
COMMIT;
