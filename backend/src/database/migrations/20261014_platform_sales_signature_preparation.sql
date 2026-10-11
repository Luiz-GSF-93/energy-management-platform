BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.platform_sales_signature_requests (
 id uuid PRIMARY KEY,draft_id uuid NOT NULL UNIQUE REFERENCES public.platform_sales_contract_drafts(id),
 proposal_id uuid NOT NULL REFERENCES public.platform_sales_proposals(id),
 draft_sha256 text NOT NULL CHECK(draft_sha256 ~ '^[a-f0-9]{64}$'),
 provider text NOT NULL DEFAULT 'CLICKSIGN' CHECK(provider='CLICKSIGN'),
 environment text NOT NULL DEFAULT 'SANDBOX' CHECK(environment='SANDBOX'),
 snapshot jsonb NOT NULL,snapshot_hash text NOT NULL,
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,input jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(snapshot_hash=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'))
);
CREATE TABLE public.platform_sales_signature_events (
 request_id uuid PRIMARY KEY,signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),
 version integer NOT NULL CHECK(version>0),state text NOT NULL CHECK(state IN ('PREPARED','WITHDRAWN')),
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,input jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(signature_id,version)
);
CREATE INDEX sales_signature_recent ON public.platform_sales_signature_requests(created_at DESC,id DESC);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_signature_requests','platform_sales_signature_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;

CREATE FUNCTION public.platform_sales_signature_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE r public.platform_sales_signature_requests;e public.platform_sales_signature_events;
 d public.platform_sales_contract_drafts;v jsonb;result jsonb;entity uuid;req uuid;author text;note text;page integer;q text;s text;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 -- Recheck and hold authority for this transaction; no frontend-only permissions.
 PERFORM 1 FROM public.user_roles u JOIN public.roles x ON x.id=u.role_id JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text WHERE u.user_id::text=p_actor::text FOR SHARE OF u,x,t;
 PERFORM public.platform_team_owner(p_actor);
 IF p_action IS NULL OR p_action NOT IN ('list','read','prepare','withdraw') OR p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>16000 THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action='list' THEN
  IF p_body-ARRAY['page','search','status']<>'{}' OR NOT p_body ?& ARRAY['page','search','status'] OR jsonb_typeof(p_body->'page')<>'number' OR p_body->>'page' !~ '^\d+$' OR jsonb_typeof(p_body->'search')<>'string' OR jsonb_typeof(p_body->'status')<>'string' THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  page:=(p_body->>'page')::integer;q:=p_body->>'search';s:=p_body->>'status';
  IF page NOT BETWEEN 0 AND 1000 OR length(q)>100 OR s NOT IN ('','PREPARED','WITHDRAWN') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  WITH rows AS(SELECT a.id,a.draft_id,a.created_at,a.snapshot#>>'{parties,customer,name}' AS customer_name,x.state,x.version FROM public.platform_sales_signature_requests a CROSS JOIN LATERAL(SELECT state,version FROM public.platform_sales_signature_events WHERE signature_id=a.id ORDER BY version DESC LIMIT 1)x WHERE (s='' OR x.state=s) AND (q='' OR strpos(lower(a.snapshot#>>'{parties,customer,name}'),lower(q))>0 OR strpos(a.draft_id::text,q)>0))
  SELECT jsonb_build_object('total',(SELECT count(*) FROM rows),'rows',(SELECT coalesce(jsonb_agg(t),'[]') FROM(SELECT * FROM rows ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET page*25)t)) INTO result;RETURN result;
 END IF;
 entity:=(p_body->>'id')::uuid;IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023';END IF;
 IF p_action='read' THEN
  IF p_body-ARRAY['id']<>'{}' THEN RAISE EXCEPTION 'Invalid read' USING ERRCODE='22023';END IF;
  SELECT * INTO r FROM public.platform_sales_signature_requests WHERE id=entity;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request missing' USING ERRCODE='P3620';END IF;
  RETURN jsonb_build_object('request',to_jsonb(r)-'input','realActivationEligible',false,'events',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'input'||jsonb_build_object('currentActorName',public.platform_sales_finance_name(x.actor_id)) ORDER BY version),'[]') FROM public.platform_sales_signature_events x WHERE signature_id=entity));
 END IF;
 note:=p_body->>'justification';
 IF jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(note))<20 OR length(note)>1000 OR note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-signature:'||entity::text,0));
 IF p_action='prepare' THEN
  IF p_body-ARRAY['id','draftId','draftSha256','justification']<>'{}' OR NOT p_body ?& ARRAY['id','draftId','draftSha256','justification'] OR jsonb_typeof(p_body->'draftSha256')<>'string' OR p_body->>'draftSha256' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  SELECT * INTO r FROM public.platform_sales_signature_requests WHERE id=entity;
  IF r.id IS NOT NULL THEN
   IF r.actor_id<>p_actor OR r.input<>p_body THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;
   RETURN jsonb_build_object('id',r.id,'environment','SANDBOX','realActivationEligible',false,'replayed',true);
  END IF;
  SELECT * INTO d FROM public.platform_sales_contract_drafts WHERE id=(p_body->>'draftId')::uuid FOR SHARE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Draft missing' USING ERRCODE='P3620';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-signature-draft:'||d.id::text,0));
  IF d.sha256<>p_body->>'draftSha256' OR (SELECT status FROM public.platform_sales_contract_events WHERE draft_id=d.id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL' OR (SELECT status FROM public.platform_sales_proposal_events WHERE proposal_id=d.proposal_id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL' THEN RAISE EXCEPTION 'Approved source required' USING ERRCODE='23505';END IF;
  IF d.snapshot#>>'{terms,status}' IS DISTINCT FROM 'APPROVED_INTERNAL' OR d.snapshot#>>'{terms,definition,validUntil}' IS NULL OR (d.snapshot#>>'{terms,definition,validUntil}')::date<CURRENT_DATE THEN RAISE EXCEPTION 'Expired or missing terms' USING ERRCODE='23505';END IF;
  IF d.snapshot#>'{parties}' IS NULL OR jsonb_typeof(d.snapshot#>'{parties}')<>'object' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text('["supplier","customer"]') k WHERE coalesce(length(d.snapshot#>>ARRAY['parties',k,'name']),0)<3 OR coalesce(length(d.snapshot#>>ARRAY['parties',k,'signatory']),0)<3 OR coalesce(length(d.snapshot#>>ARRAY['parties',k,'email']),0)<3) THEN RAISE EXCEPTION 'Parties incomplete' USING ERRCODE='22023';END IF;
  v:=jsonb_build_object('draftId',d.id,'proposalId',d.proposal_id,'draftSha256',d.sha256,'parties',d.snapshot->'parties','terms',d.snapshot->'terms','provider','CLICKSIGN','environment','SANDBOX','realActivationEligible',false,'automaticNotifications',false);
  INSERT INTO public.platform_sales_signature_requests(id,draft_id,proposal_id,draft_sha256,snapshot,snapshot_hash,actor_id,actor_name,justification,input) VALUES(entity,d.id,d.proposal_id,d.sha256,v,encode(sha256(convert_to(v::text,'UTF8')),'hex'),p_actor,author,note,p_body);
  INSERT INTO public.platform_sales_signature_events VALUES(entity,entity,1,'PREPARED',p_actor,author,note,p_body,clock_timestamp());
  RETURN jsonb_build_object('id',entity,'environment','SANDBOX','realActivationEligible',false,'replayed',false);
 END IF;
 IF p_body-ARRAY['id','requestId','expectedVersion','justification']<>'{}' OR NOT p_body ?& ARRAY['id','requestId','expectedVersion','justification'] OR jsonb_typeof(p_body->'expectedVersion')<>'number' OR p_body->>'expectedVersion' !~ '^\d+$' THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request ID required' USING ERRCODE='22023';END IF;
 SELECT * INTO e FROM public.platform_sales_signature_events WHERE request_id=req;
 IF e.request_id IS NOT NULL THEN
  IF e.signature_id<>entity OR e.actor_id<>p_actor OR e.input<>p_body THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('id',entity,'state',e.state,'replayed',true);
 END IF;
 SELECT * INTO r FROM public.platform_sales_signature_requests WHERE id=entity FOR SHARE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request missing' USING ERRCODE='P3620';END IF;
 SELECT * INTO e FROM public.platform_sales_signature_events WHERE signature_id=entity ORDER BY version DESC LIMIT 1;
 IF e.version<>(p_body->>'expectedVersion')::integer OR e.state<>'PREPARED' THEN RAISE EXCEPTION 'Stale transition' USING ERRCODE='23505';END IF;
 INSERT INTO public.platform_sales_signature_events VALUES(req,entity,e.version+1,'WITHDRAWN',p_actor,author,note,p_body,clock_timestamp());
 RETURN jsonb_build_object('id',entity,'state','WITHDRAWN','replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signature_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_signature_action(uuid,text,jsonb) TO service_role;
COMMIT;
