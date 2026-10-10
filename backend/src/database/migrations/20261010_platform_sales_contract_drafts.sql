BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- SaaS contract drafts only. No organization, energy contract, payment or license writes.
CREATE TABLE IF NOT EXISTS public.platform_sales_contract_templates (
 id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0), definition jsonb NOT NULL,
 actor_id uuid NOT NULL, actor_name text, justification text NOT NULL,
 request_id uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(id,revision)
);
CREATE TABLE IF NOT EXISTS public.platform_sales_contract_drafts (
 id uuid PRIMARY KEY, proposal_id uuid NOT NULL REFERENCES public.platform_sales_proposals(id),
 terms_revision integer NOT NULL, template_id uuid NOT NULL, template_revision integer NOT NULL,
 snapshot jsonb NOT NULL, pdf bytea NOT NULL CHECK(octet_length(pdf) BETWEEN 100 AND 1048576),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), renderer_version text NOT NULL,
 actor_id uuid NOT NULL, actor_name text, justification text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(proposal_id,terms_revision) REFERENCES public.platform_sales_offer_terms(proposal_id,revision),
 FOREIGN KEY(template_id,template_revision) REFERENCES public.platform_sales_contract_templates(id,revision),
 CHECK(sha256=encode(pg_catalog.sha256(pdf),'hex'))
);
CREATE TABLE IF NOT EXISTS public.platform_sales_contract_events (
 template_id uuid, template_revision integer, draft_id uuid REFERENCES public.platform_sales_contract_drafts(id),
 version integer NOT NULL CHECK(version>0), status text NOT NULL CHECK(status IN ('DRAFT','CHECKED','APPROVED_INTERNAL')),
 actor_id uuid NOT NULL, actor_name text, justification text NOT NULL,
 request_id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(template_id,template_revision) REFERENCES public.platform_sales_contract_templates(id,revision),
 CHECK((template_id IS NOT NULL AND template_revision IS NOT NULL AND draft_id IS NULL) OR (template_id IS NULL AND template_revision IS NULL AND draft_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_contract_template_event_version ON public.platform_sales_contract_events(template_id,template_revision,version) WHERE template_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_contract_draft_event_version ON public.platform_sales_contract_events(draft_id,version) WHERE draft_id IS NOT NULL;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_contract_templates','platform_sales_contract_drafts','platform_sales_contract_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.platform_sales_contract_snapshot(p_actor uuid,p_proposal uuid,p_terms integer,p_template uuid,p_revision integer,p_parties jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source jsonb; model public.platform_sales_contract_templates; current_status text; party jsonb; k text;
BEGIN
 source:=public.read_platform_sales_offer_document(p_actor,p_proposal,p_terms);
 IF source->>'expired' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Expired offer' USING ERRCODE='22023'; END IF;
 PERFORM public.validate_platform_sales_offer_terms(source->'terms'->'definition',source->'proposal'->'snapshot',true);
 SELECT * INTO model FROM public.platform_sales_contract_templates WHERE id=p_template AND revision=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'Template missing' USING ERRCODE='P3610'; END IF;
 SELECT status INTO current_status FROM public.platform_sales_contract_events WHERE template_id=p_template AND template_revision=p_revision ORDER BY version DESC LIMIT 1;
 IF current_status IS DISTINCT FROM 'APPROVED_INTERNAL' THEN RAISE EXCEPTION 'Template not approved' USING ERRCODE='P3611'; END IF;
 IF p_parties IS NULL OR jsonb_typeof(p_parties)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_parties))<>2 OR NOT((p_parties ? 'supplier') AND (p_parties ? 'customer')) THEN RAISE EXCEPTION 'Invalid parties' USING ERRCODE='22023'; END IF;
 FOR party IN SELECT value FROM jsonb_each(p_parties) LOOP
  IF jsonb_typeof(party)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(party))<>5 OR EXISTS(SELECT 1 FROM jsonb_object_keys(party) x WHERE x NOT IN ('name','document','address','signatory','email')) THEN RAISE EXCEPTION 'Invalid party' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(party) LOOP
   IF jsonb_typeof(party->k)<>'string' OR length(btrim(party->>k)) NOT BETWEEN 3 AND 500 OR (party->>k) ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Incomplete party' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF party->>'email' !~ '^[^ @]+@[^ @]+\.[^ @]+$' THEN RAISE EXCEPTION 'Invalid signatory email' USING ERRCODE='22023'; END IF;
 END LOOP;
 RETURN jsonb_build_object('proposal',source->'proposal','terms',source->'terms','template',jsonb_build_object('id',model.id,'revision',model.revision,'definition',model.definition),'parties',p_parties,'asOfDate',source->'asOfDate','rendererVersion','contract-draft-v1');
END $$;
-- All actions are private and recheck the current Owner at the database boundary.
CREATE OR REPLACE FUNCTION public.platform_sales_contract_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE model public.platform_sales_contract_templates; draft public.platform_sales_contract_drafts; event public.platform_sales_contract_events;
 latest integer; expected integer; review_revision integer; entity uuid; request uuid; kind text; author text; snapshot jsonb; definition jsonb; clause jsonb; justification text; pdf bytea; result jsonb; page integer; q text; filter_status text;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 PERFORM public.platform_team_owner(p_actor);
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023'; END IF;
 author:=public.platform_sales_offer_actor_name(p_actor);
 IF p_action='list' THEN
  page:=(p_body->>'page')::integer; q:=p_body->>'search'; filter_status:=p_body->>'status';
  IF page IS NULL OR page NOT BETWEEN 0 AND 1000 OR q IS NULL OR length(q)>100 OR filter_status IS NULL OR filter_status NOT IN ('','DRAFT','CHECKED','APPROVED_INTERNAL') THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO result FROM (
   SELECT t.*,(SELECT max(t2.revision) FROM public.platform_sales_contract_templates t2 WHERE t2.id=t.id) latest_revision,coalesce((SELECT jsonb_agg(e ORDER BY e.version) FROM public.platform_sales_contract_events e WHERE e.template_id=t.id AND e.template_revision=t.revision),'[]') events
   FROM public.platform_sales_contract_templates t ORDER BY t.created_at DESC,t.id LIMIT 25 OFFSET page*25
  ) x;
  RETURN jsonb_build_object('templates',result,'totalTemplates',(SELECT count(*) FROM public.platform_sales_contract_templates),'drafts',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
   SELECT d.id,d.proposal_id,d.template_id,d.template_revision,d.terms_revision,d.created_at,d.actor_name,d.actor_id,d.sha256,d.snapshot->'parties'->'customer'->>'name' customer_name,e.status,e.version
   FROM public.platform_sales_contract_drafts d CROSS JOIN LATERAL(SELECT status,version FROM public.platform_sales_contract_events WHERE draft_id=d.id ORDER BY version DESC LIMIT 1) e
   WHERE (q='' OR strpos(lower(d.snapshot->'parties'->'customer'->>'name'),lower(q))>0 OR strpos(d.proposal_id::text,q)>0) AND (filter_status='' OR e.status=filter_status)
   ORDER BY d.created_at DESC,d.id LIMIT 25 OFFSET page*25
  ) x),'total',(SELECT count(*) FROM public.platform_sales_contract_drafts d CROSS JOIN LATERAL(SELECT status FROM public.platform_sales_contract_events WHERE draft_id=d.id ORDER BY version DESC LIMIT 1) e WHERE (q='' OR strpos(lower(d.snapshot->'parties'->'customer'->>'name'),lower(q))>0 OR strpos(d.proposal_id::text,q)>0) AND (filter_status='' OR e.status=filter_status)));
 END IF;
 entity:=(p_body->>'id')::uuid;
 IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023'; END IF;
 IF p_action IN ('read','pdf') THEN
  SELECT * INTO draft FROM public.platform_sales_contract_drafts WHERE id=entity;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft missing' USING ERRCODE='P3610'; END IF;
  IF p_action='pdf' THEN RETURN jsonb_build_object('hex',encode(draft.pdf,'hex'),'sha256',draft.sha256); END IF;
  RETURN (to_jsonb(draft)-'pdf')||jsonb_build_object('events',(SELECT jsonb_agg(e ORDER BY version) FROM public.platform_sales_contract_events e WHERE draft_id=entity));
 END IF;
 IF p_action='prepare' THEN RETURN public.platform_sales_contract_snapshot(p_actor,(p_body->>'proposalId')::uuid,(p_body->>'termsRevision')::integer,(p_body->>'templateId')::uuid,(p_body->>'templateRevision')::integer,p_body->'parties'); END IF;
 request:=(p_body->>'requestId')::uuid; justification:=p_body->>'justification';
 IF request IS NULL OR justification IS NULL OR length(btrim(justification)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-contract-request:'||request::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-contract:'||entity::text,0));
 IF p_action='template' THEN
  expected:=(p_body->>'expectedRevision')::integer; definition:=p_body->'definition';
  IF expected IS NULL OR expected<0 OR definition IS NULL OR jsonb_typeof(definition)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(definition))<>2 OR NOT((definition ? 'title') AND (definition ? 'clauses')) OR jsonb_typeof(definition->'title')<>'string' OR length(btrim(definition->>'title')) NOT BETWEEN 5 AND 120 OR jsonb_typeof(definition->'clauses')<>'array' OR jsonb_array_length(definition->'clauses') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Invalid template' USING ERRCODE='22023'; END IF;
  FOR clause IN SELECT value FROM jsonb_array_elements(definition->'clauses') LOOP
   IF jsonb_typeof(clause)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(clause))<>2 OR NOT((clause ? 'title') AND (clause ? 'text')) OR jsonb_typeof(clause->'title')<>'string' OR jsonb_typeof(clause->'text')<>'string' OR length(btrim(clause->>'title')) NOT BETWEEN 3 AND 120 OR length(btrim(clause->>'text')) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Invalid clause' USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT * INTO model FROM public.platform_sales_contract_templates WHERE request_id=request;
  IF FOUND THEN
   IF model.actor_id<>p_actor OR model.id<>entity OR model.revision<>expected+1 OR model.definition<>definition OR model.justification<>justification THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='P3611'; END IF;
   RETURN to_jsonb(model);
  END IF;
  SELECT coalesce(max(t.revision),0) INTO latest FROM public.platform_sales_contract_templates t WHERE t.id=entity;
  IF latest<>expected THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='P3611'; END IF;
  INSERT INTO public.platform_sales_contract_templates VALUES(entity,latest+1,definition,p_actor,author,justification,request,now()) RETURNING * INTO model;
  INSERT INTO public.platform_sales_contract_events VALUES(entity,latest+1,NULL,1,'DRAFT',p_actor,author,justification,request,now());
  RETURN to_jsonb(model);
 END IF;
 IF p_action='store' THEN
  SELECT * INTO draft FROM public.platform_sales_contract_drafts WHERE id=entity;
  IF FOUND THEN
   IF draft.actor_id<>p_actor OR draft.snapshot IS DISTINCT FROM p_body->'snapshot' OR draft.justification<>justification OR request<>entity THEN RAISE EXCEPTION 'Draft ID reused' USING ERRCODE='P3611'; END IF;
   RETURN jsonb_build_object('id',draft.id,'sha256',draft.sha256);
  END IF;
  IF request<>entity OR p_body->>'rendererVersion' IS DISTINCT FROM 'contract-draft-v1' OR p_body->>'hex' IS NULL OR length(p_body->>'hex') NOT BETWEEN 200 AND 2097152 OR p_body->>'hex' !~ '^[a-f0-9]+$' THEN RAISE EXCEPTION 'Invalid artifact' USING ERRCODE='22023'; END IF;
  snapshot:=public.platform_sales_contract_snapshot(p_actor,(p_body->>'proposalId')::uuid,(p_body->>'termsRevision')::integer,(p_body->>'templateId')::uuid,(p_body->>'templateRevision')::integer,p_body->'parties');
  IF snapshot IS DISTINCT FROM p_body->'snapshot' THEN RAISE EXCEPTION 'Sources changed' USING ERRCODE='P3611'; END IF;
  pdf:=decode(p_body->>'hex','hex');
  IF substring(pdf FROM 1 FOR 5)<>decode('255044462d','hex') THEN RAISE EXCEPTION 'Invalid PDF' USING ERRCODE='22023'; END IF;
  INSERT INTO public.platform_sales_contract_drafts VALUES(entity,(p_body->>'proposalId')::uuid,(p_body->>'termsRevision')::integer,(p_body->>'templateId')::uuid,(p_body->>'templateRevision')::integer,snapshot,pdf,encode(pg_catalog.sha256(pdf),'hex'),'contract-draft-v1',p_actor,author,justification,now()) RETURNING * INTO draft;
  INSERT INTO public.platform_sales_contract_events VALUES(NULL,NULL,entity,1,'DRAFT',p_actor,author,justification,request,now());
  RETURN jsonb_build_object('id',draft.id,'sha256',draft.sha256);
 END IF;
 IF p_action='review' THEN
  kind:=p_body->>'kind'; review_revision:=(p_body->>'revision')::integer; expected:=(p_body->>'expectedVersion')::integer;
  IF kind IS NULL OR kind NOT IN ('template','draft') OR expected IS NULL OR expected<1 OR review_revision IS NULL OR review_revision<1 OR p_body->>'status' IS NULL OR p_body->>'status' NOT IN ('CHECKED','APPROVED_INTERNAL') THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE='22023'; END IF;
  SELECT * INTO event FROM public.platform_sales_contract_events WHERE request_id=request;
  IF FOUND THEN
   IF event.actor_id<>p_actor OR event.justification<>justification OR event.version<>expected+1 OR event.status<>p_body->>'status' OR (kind='template' AND (event.template_id IS DISTINCT FROM entity OR event.template_revision IS DISTINCT FROM review_revision)) OR (kind='draft' AND event.draft_id IS DISTINCT FROM entity) THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='P3611'; END IF;
   RETURN to_jsonb(event);
  END IF;
  SELECT * INTO event FROM public.platform_sales_contract_events WHERE (kind='template' AND template_id=entity AND template_revision=review_revision) OR (kind='draft' AND draft_id=entity) ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Record missing' USING ERRCODE='P3610'; END IF;
  IF event.version<>expected THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='P3611'; END IF;
  IF NOT((event.status='DRAFT' AND p_body->>'status'='CHECKED') OR (event.status='CHECKED' AND p_body->>'status'='APPROVED_INTERNAL')) THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
  IF kind='template' AND review_revision<>(SELECT max(t.revision) FROM public.platform_sales_contract_templates t WHERE t.id=entity) THEN RAISE EXCEPTION 'Newer template exists' USING ERRCODE='P3611'; END IF;
  IF kind='template' AND EXISTS(SELECT 1 FROM public.platform_sales_contract_templates t WHERE t.id=entity AND t.revision=review_revision AND t.definition::text LIKE '%[PENDENTE:%') THEN RAISE EXCEPTION 'Unresolved model fields' USING ERRCODE='22023'; END IF;
  IF kind='draft' THEN
   SELECT * INTO draft FROM public.platform_sales_contract_drafts WHERE id=entity;
   PERFORM public.validate_platform_sales_offer_terms(draft.snapshot->'terms'->'definition',draft.snapshot->'proposal'->'snapshot',true);
  END IF;
  INSERT INTO public.platform_sales_contract_events VALUES(CASE WHEN kind='template' THEN entity END,CASE WHEN kind='template' THEN review_revision END,CASE WHEN kind='draft' THEN entity END,expected+1,p_body->>'status',p_actor,author,justification,request,now()) RETURNING * INTO event;
  RETURN to_jsonb(event);
 END IF;
 RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_contract_snapshot(uuid,uuid,integer,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.platform_sales_contract_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_contract_action(uuid,text,jsonb) TO service_role;
COMMIT;
