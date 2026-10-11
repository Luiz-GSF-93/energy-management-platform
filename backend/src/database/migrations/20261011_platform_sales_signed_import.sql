BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Private documentary evidence only. No signature provider, payment or provisioning.
CREATE TABLE IF NOT EXISTS public.platform_sales_signed_documents (
 id uuid PRIMARY KEY,draft_id uuid NOT NULL REFERENCES public.platform_sales_contract_drafts(id),
 draft_sha256 text NOT NULL, pdf bytea NOT NULL CHECK(octet_length(pdf) BETWEEN 100 AND 3145728),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),filename text NOT NULL,
 metadata jsonb NOT NULL,actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(draft_id,sha256),
 CHECK(sha256=encode(pg_catalog.sha256(pdf),'hex'))
);
CREATE TABLE IF NOT EXISTS public.platform_sales_signed_document_events (
 document_id uuid NOT NULL REFERENCES public.platform_sales_signed_documents(id),
 version integer NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN ('IMPORTED','CHECKED','ACCEPTED','REJECTED')),
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,checks jsonb,
 request_id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(document_id,version)
);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_signed_documents','platform_sales_signed_document_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;
CREATE OR REPLACE FUNCTION public.platform_sales_signed_document_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item public.platform_sales_signed_documents; draft public.platform_sales_contract_drafts;
 event public.platform_sales_signed_document_events; latest public.platform_sales_signed_document_events;
 entity uuid; request uuid; author text; note text; file bytea; result jsonb; page integer; query text; filter_status text; k text;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 IF p_action IN ('list','read','pdf') THEN
  -- Read authority is independent of the optional name registry, as in finance 4B.
  IF (SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE u.user_id::text=p_actor::text AND r.scope='global')<>1
   OR NOT EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text
    WHERE u.user_id::text=p_actor::text AND r.scope='global' AND r.name='admin_platform' AND r.permissions ? '82e7fc71-479a-4dd6-8b22-4fba6eaa6841' AND t.active AND t.profile='OWNER') THEN
   RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 ELSE
  -- Freeze existing authority for the write; loss of identity registry fails closed.
  PERFORM 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text WHERE u.user_id::text=p_actor::text FOR SHARE OF u,r,t;
  PERFORM public.platform_team_owner(p_actor);
 END IF;
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023'; END IF;
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action='list' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) x WHERE x NOT IN ('page','search','status')) THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
  page:=(p_body->>'page')::integer;query:=p_body->>'search';filter_status:=p_body->>'status';
  IF page IS NULL OR page NOT BETWEEN 0 AND 1000 OR query IS NULL OR length(query)>100 OR filter_status IS NULL OR filter_status NOT IN ('','IMPORTED','CHECKED','ACCEPTED','REJECTED') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
  WITH filtered AS (
   SELECT d.id,d.draft_id,d.sha256,d.filename,d.created_at,d.actor_id,d.actor_name,
    c.proposal_id,c.snapshot->'parties'->'customer'->>'name' company,e.status,e.version
   FROM public.platform_sales_signed_documents d JOIN public.platform_sales_contract_drafts c ON c.id=d.draft_id
   CROSS JOIN LATERAL(SELECT status,version FROM public.platform_sales_signed_document_events WHERE document_id=d.id ORDER BY version DESC LIMIT 1)e
   WHERE (filter_status='' OR e.status=filter_status) AND (query='' OR strpos(lower(c.snapshot->'parties'->'customer'->>'name'),lower(query))>0 OR strpos(c.proposal_id::text,query)>0 OR strpos(c.id::text,query)>0)
  ) SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 25 OFFSET page*25)x)) INTO result;
  RETURN result;
 END IF;
 entity:=(p_body->>'id')::uuid;
 IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023'; END IF;
 IF p_action IN ('read','pdf') THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_body))<>1 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023'; END IF;
  SELECT * INTO item FROM public.platform_sales_signed_documents WHERE id=entity;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document missing' USING ERRCODE='P3610'; END IF;
  IF p_action='pdf' THEN RETURN jsonb_build_object('hex',encode(item.pdf,'hex'),'sha256',item.sha256); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.version),'[]') INTO result FROM public.platform_sales_signed_document_events x WHERE document_id=entity;
  RETURN (to_jsonb(item)-'pdf')||jsonb_build_object('events',result,'currentActorName',public.platform_sales_finance_name(item.actor_id));
 END IF;
 note:=p_body->>'justification';
 IF jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR note IS NULL OR length(btrim(note)) NOT BETWEEN 10 AND 2000 OR note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-signed-document:'||entity::text,0));
 IF p_action='import' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_body))<>7 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) x WHERE x NOT IN ('id','draftId','draftSha256','hex','filename','metadata','justification')) THEN RAISE EXCEPTION 'Invalid import' USING ERRCODE='22023'; END IF;
  IF p_body->>'hex' IS NULL OR length(p_body->>'hex') NOT BETWEEN 200 AND 6291456 OR p_body->>'hex' !~ '^[a-f0-9]+$' OR length(p_body->>'hex')%2<>0 THEN RAISE EXCEPTION 'Invalid PDF' USING ERRCODE='22023'; END IF;
  file:=decode(p_body->>'hex','hex');
  IF substring(file FROM 1 FOR 5)<>decode('255044462d','hex') OR position(decode('2525454f46','hex') IN substring(file FROM greatest(1,octet_length(file)-1023)))=0 THEN RAISE EXCEPTION 'PDF envelope invalid' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_body->'filename') IS DISTINCT FROM 'string' OR p_body->>'filename' IS NULL OR p_body->>'filename' !~ '^[A-Za-z0-9 _().-]{1,116}\.pdf$' THEN RAISE EXCEPTION 'Invalid filename' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_body->'metadata') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_body->'metadata'))<>4 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_body->'metadata') x WHERE x NOT IN ('signedAt','supplierSignatory','customerSignatory','source')) THEN RAISE EXCEPTION 'Invalid provenance' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['supplierSignatory','customerSignatory','source'] LOOP
   IF jsonb_typeof(p_body->'metadata'->k) IS DISTINCT FROM 'string' OR length(btrim(p_body->'metadata'->>k)) NOT BETWEEN 3 AND 500 OR (p_body->'metadata'->>k) ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Incomplete provenance' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF jsonb_typeof(p_body->'metadata'->'signedAt') IS DISTINCT FROM 'string' OR p_body->'metadata'->>'signedAt' IS NULL OR p_body->'metadata'->>'signedAt' !~ '^\d{4}-\d{2}-\d{2}$' OR (p_body->'metadata'->>'signedAt')::date>current_date THEN RAISE EXCEPTION 'Invalid signature date' USING ERRCODE='22023'; END IF;
  SELECT * INTO item FROM public.platform_sales_signed_documents WHERE id=entity;
  IF FOUND THEN
   IF item.actor_id<>p_actor OR item.draft_id<>(p_body->>'draftId')::uuid OR item.draft_sha256 IS DISTINCT FROM p_body->>'draftSha256' OR item.sha256<>encode(sha256(file),'hex') OR item.filename<>p_body->>'filename' OR item.metadata IS DISTINCT FROM p_body->'metadata' OR item.justification<>note THEN RAISE EXCEPTION 'ID reused' USING ERRCODE='P3611'; END IF;
   RETURN jsonb_build_object('id',item.id,'sha256',item.sha256);
  END IF;
  SELECT * INTO draft FROM public.platform_sales_contract_drafts WHERE id=(p_body->>'draftId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft missing' USING ERRCODE='P3610'; END IF;
  IF encode(sha256(file),'hex')=draft.sha256 THEN RAISE EXCEPTION 'Unsigned internal draft is not external signature evidence' USING ERRCODE='22023'; END IF;
  IF draft.sha256 IS DISTINCT FROM p_body->>'draftSha256' OR (SELECT status FROM public.platform_sales_contract_events WHERE draft_id=draft.id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL' THEN RAISE EXCEPTION 'Approved draft required' USING ERRCODE='P3611'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-signed-draft:'||draft.id::text,0));
  IF EXISTS(SELECT 1 FROM public.platform_sales_signed_documents WHERE draft_id=draft.id AND sha256=encode(sha256(file),'hex')) THEN RAISE EXCEPTION 'Duplicate signed evidence' USING ERRCODE='P3611'; END IF;
  INSERT INTO public.platform_sales_signed_documents VALUES(entity,draft.id,draft.sha256,file,encode(sha256(file),'hex'),p_body->>'filename',p_body->'metadata',p_actor,author,note,now()) RETURNING * INTO item;
  INSERT INTO public.platform_sales_signed_document_events VALUES(entity,1,'IMPORTED',p_actor,author,note,null,entity,now());
  RETURN jsonb_build_object('id',item.id,'sha256',item.sha256);
 END IF;
 IF p_action='review' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_body))<>6 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) x WHERE x NOT IN ('id','requestId','expectedVersion','status','checks','justification')) THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE='22023'; END IF;
  request:=(p_body->>'requestId')::uuid;
  IF request IS NULL OR (p_body->>'expectedVersion')::integer IS NULL OR p_body->>'status' IS NULL OR p_body->>'status' NOT IN ('CHECKED','ACCEPTED','REJECTED') THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_body->'checks') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_body->'checks'))<>5 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_body->'checks') x WHERE x NOT IN ('parties','scope','prices','signatures','draftVersion')) OR EXISTS(SELECT 1 FROM jsonb_each(p_body->'checks') x WHERE jsonb_typeof(x.value)<>'boolean') THEN RAISE EXCEPTION 'Invalid checklist' USING ERRCODE='22023'; END IF;
  IF p_body->>'status'<>'REJECTED' AND EXISTS(SELECT 1 FROM jsonb_each(p_body->'checks') x WHERE x.value<>'true'::jsonb) THEN RAISE EXCEPTION 'Checklist incomplete' USING ERRCODE='22023'; END IF;
  SELECT * INTO event FROM public.platform_sales_signed_document_events WHERE request_id=request;
  IF FOUND THEN
   IF event.document_id<>entity OR event.actor_id<>p_actor OR event.version<>(p_body->>'expectedVersion')::integer+1 OR event.status<>p_body->>'status' OR event.justification<>note OR event.checks IS DISTINCT FROM p_body->'checks' THEN RAISE EXCEPTION 'Review ID reused' USING ERRCODE='P3611'; END IF;
   RETURN to_jsonb(event);
  END IF;
  SELECT * INTO item FROM public.platform_sales_signed_documents WHERE id=entity;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document missing' USING ERRCODE='P3610'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-signed-draft:'||item.draft_id::text,0));
  SELECT * INTO latest FROM public.platform_sales_signed_document_events WHERE document_id=entity ORDER BY version DESC LIMIT 1;
  IF latest.version IS DISTINCT FROM (p_body->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Stale review' USING ERRCODE='P3611'; END IF;
  IF NOT((latest.status='IMPORTED' AND p_body->>'status' IN ('CHECKED','REJECTED')) OR (latest.status='CHECKED' AND p_body->>'status' IN ('ACCEPTED','REJECTED'))) THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
  IF p_body->>'status'='ACCEPTED' AND EXISTS(SELECT 1 FROM public.platform_sales_signed_documents d JOIN LATERAL(SELECT status FROM public.platform_sales_signed_document_events WHERE document_id=d.id ORDER BY version DESC LIMIT 1)e ON true WHERE d.draft_id=item.draft_id AND e.status='ACCEPTED') THEN RAISE EXCEPTION 'Draft already accepted with other evidence' USING ERRCODE='P3611'; END IF;
  INSERT INTO public.platform_sales_signed_document_events VALUES(entity,latest.version+1,p_body->>'status',p_actor,author,note,p_body->'checks',request,now()) RETURNING * INTO event;
  RETURN to_jsonb(event);
 END IF;
 RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signed_document_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_signed_document_action(uuid,text,jsonb) TO service_role;
COMMIT;
