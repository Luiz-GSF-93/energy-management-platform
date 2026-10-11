BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.platform_sales_signature_inbox(
 event_hash text PRIMARY KEY CHECK(event_hash ~ '^[a-f0-9]{64}$'),signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),
 account_id uuid NOT NULL,document_id uuid NOT NULL,name text NOT NULL CHECK(name ~ '^[a-z_]{1,60}$'),occurred_at timestamptz NOT NULL,signer_id uuid,
 raw_hash text NOT NULL CHECK(raw_hash ~ '^[a-f0-9]{64}$'),received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_observations(
 request_id uuid PRIMARY KEY,signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),event_hash text REFERENCES public.platform_sales_signature_inbox(event_hash),
 source_hash text NOT NULL,actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX signature_event_observation ON public.platform_sales_signature_observations(event_hash) WHERE event_hash IS NOT NULL;
CREATE TABLE public.platform_sales_signature_observation_results(
 request_id uuid PRIMARY KEY REFERENCES public.platform_sales_signature_observations(request_id),proof jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_observation_resolutions(
 request_id uuid PRIMARY KEY REFERENCES public.platform_sales_signature_observations(request_id),actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_artifacts(
 check_id uuid PRIMARY KEY REFERENCES public.platform_sales_signature_observations(request_id),signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),
 pdf bytea NOT NULL CHECK(octet_length(pdf) BETWEEN 100 AND 1048576),sha256 text NOT NULL CHECK(sha256=encode(pg_catalog.sha256(pdf),'hex')),
 log jsonb NOT NULL,signed_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_lifecycle_commands(
 request_id uuid PRIMARY KEY,signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),check_id uuid NOT NULL REFERENCES public.platform_sales_signature_observations(request_id),
 kind text NOT NULL CHECK(kind IN ('ACTIVATE','NOTIFY')),source_hash text NOT NULL,actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_lifecycle_events(
 command_id uuid NOT NULL REFERENCES public.platform_sales_signature_lifecycle_commands(request_id),version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('RESERVED','NOT_SENT','UNKNOWN','VERIFIED','ACKNOWLEDGED')),check_id uuid REFERENCES public.platform_sales_signature_observations(request_id),
 actor_id uuid NOT NULL,actor_name text,justification text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(command_id,version)
);
CREATE TABLE public.platform_sales_signature_signed_links(
 check_id uuid PRIMARY KEY REFERENCES public.platform_sales_signature_artifacts(check_id),signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),
 document_id uuid NOT NULL UNIQUE REFERENCES public.platform_sales_signed_documents(id),actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX signature_observation_recent ON public.platform_sales_signature_observations(signature_id,created_at DESC,request_id DESC);
CREATE INDEX signature_inbox_recent ON public.platform_sales_signature_inbox(signature_id,received_at DESC,event_hash);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_signature_inbox','platform_sales_signature_observations','platform_sales_signature_observation_results','platform_sales_signature_observation_resolutions','platform_sales_signature_artifacts','platform_sales_signature_lifecycle_commands','platform_sales_signature_lifecycle_events','platform_sales_signature_signed_links'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;
CREATE FUNCTION public.platform_sales_signature_lifecycle_context(entity uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE r public.platform_sales_signature_requests;d public.platform_sales_contract_drafts;resources jsonb;data jsonb;
BEGIN
 SELECT * INTO r FROM public.platform_sales_signature_requests WHERE id=entity;
 SELECT * INTO d FROM public.platform_sales_contract_drafts WHERE id=r.draft_id FOR SHARE;
 IF r.environment IS DISTINCT FROM 'SANDBOX' OR d.sha256 IS DISTINCT FROM r.draft_sha256 OR encode(sha256(d.pdf),'hex') IS DISTINCT FROM r.draft_sha256
 OR (SELECT state FROM public.platform_sales_signature_events WHERE signature_id=entity ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'PREPARED'
 OR (SELECT status FROM public.platform_sales_contract_events WHERE draft_id=d.id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL'
 OR (SELECT status FROM public.platform_sales_proposal_events WHERE proposal_id=r.proposal_id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL'
 OR coalesce((r.snapshot#>>'{terms,definition,validUntil}')::date<CURRENT_DATE,true) THEN RAISE EXCEPTION 'Signature source changed' USING ERRCODE='23505';END IF;
 SELECT jsonb_agg(to_jsonb(x) ORDER BY ordinal) INTO resources FROM public.platform_sales_signature_resources x WHERE signature_id=entity;
 IF jsonb_array_length(coalesce(resources,'[]'))<>8 OR EXISTS(SELECT 1 FROM public.platform_sales_signature_attempts a CROSS JOIN LATERAL(SELECT state FROM public.platform_sales_signature_attempt_events WHERE lease=a.lease ORDER BY version DESC LIMIT 1)e WHERE a.signature_id=entity AND e.state IN ('CLAIMED','RESERVED','UNKNOWN'))
 OR NOT EXISTS(SELECT 1 FROM public.platform_sales_signature_original_checks c JOIN public.platform_sales_signature_original_results z USING(request_id) WHERE c.signature_id=entity AND z.state='VERIFIED' AND c.draft_sha256=r.draft_sha256 AND c.document_id=(resources->1->>'external_id')::uuid AND c.envelope_id=(resources->0->>'external_id')::uuid)
 THEN RAISE EXCEPTION 'Incomplete configured resources' USING ERRCODE='23505';END IF;
 data:=jsonb_build_object('id',entity,'draftSha256',r.draft_sha256,'parties',r.snapshot->'parties','resources',resources);
 RETURN data||jsonb_build_object('sourceHash',encode(sha256(convert_to(data::text,'UTF8')),'hex'),'activationConfirmed',EXISTS(SELECT 1 FROM public.platform_sales_signature_lifecycle_commands cmd JOIN public.platform_sales_signature_lifecycle_events ev ON ev.command_id=cmd.request_id WHERE cmd.signature_id=entity AND cmd.kind='ACTIVATE' AND ev.state='VERIFIED'));
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signature_lifecycle_context(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Webhook capability can only append a sanitized notification for a known sandbox document.
-- It neither supplies an Owner identity nor creates observations, signatures or accepted contracts.
CREATE FUNCTION public.platform_sales_signature_receive_event(p_event jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE entity uuid;v public.platform_sales_signature_inbox;
BEGIN
 IF jsonb_typeof(p_event) IS DISTINCT FROM 'object' OR p_event-ARRAY['account','documentId','name','occurredAt','signerId','eventHash','rawHash']<>'{}' OR NOT p_event ?& ARRAY['account','documentId','name','occurredAt','signerId','eventHash','rawHash'] OR octet_length(p_event::text)>1500
 OR p_event->>'eventHash' IS NULL OR p_event->>'eventHash' !~ '^[a-f0-9]{64}$' OR p_event->>'rawHash' IS NULL OR p_event->>'rawHash' !~ '^[a-f0-9]{64}$'
 OR p_event->>'name' IS NULL OR p_event->>'name' !~ '^[a-z_]{1,60}$' OR (p_event->>'occurredAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid event' USING ERRCODE='22023';END IF;
 SELECT x.signature_id INTO entity FROM public.platform_sales_signature_resources x JOIN public.platform_sales_signature_requests r ON r.id=x.signature_id WHERE x.ordinal=2 AND x.type='documents' AND x.external_id=(p_event->>'documentId')::uuid AND r.environment='SANDBOX';
 IF entity IS NULL THEN RETURN jsonb_build_object('accepted',true,'linked',false);END IF;
 IF p_event->>'signerId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.platform_sales_signature_resources WHERE signature_id=entity AND ordinal IN (3,4) AND external_id=(p_event->>'signerId')::uuid) THEN RAISE EXCEPTION 'Unbound signer' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-signature:'||entity::text,0));
 SELECT * INTO v FROM public.platform_sales_signature_inbox WHERE event_hash=p_event->>'eventHash';
 IF v.event_hash IS NOT NULL THEN
  IF v.signature_id<>entity OR v.account_id<>(p_event->>'account')::uuid OR v.document_id<>(p_event->>'documentId')::uuid OR v.name<>p_event->>'name' OR v.occurred_at<>(p_event->>'occurredAt')::timestamptz OR v.signer_id IS DISTINCT FROM (p_event->>'signerId')::uuid THEN RAISE EXCEPTION 'Divergent event retry' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('accepted',true,'replayed',true);
 END IF;
 INSERT INTO public.platform_sales_signature_inbox VALUES(p_event->>'eventHash',entity,(p_event->>'account')::uuid,(p_event->>'documentId')::uuid,p_event->>'name',(p_event->>'occurredAt')::timestamptz,(p_event->>'signerId')::uuid,p_event->>'rawHash',clock_timestamp());
 RETURN jsonb_build_object('accepted',true,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signature_receive_event(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_signature_receive_event(jsonb) TO service_role;

CREATE FUNCTION public.platform_sales_signature_lifecycle_action(p_actor uuid,p_action text,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE entity uuid;req uuid;page integer;author text;context jsonb;v jsonb;proof jsonb;file bytea;latest uuid;note text;command public.platform_sales_signature_lifecycle_commands;event public.platform_sales_signature_lifecycle_events;
 o public.platform_sales_signature_observations;z public.platform_sales_signature_observation_results;a public.platform_sales_signature_artifacts;link public.platform_sales_signature_signed_links;r public.platform_sales_signature_requests;item public.platform_sales_signed_documents;ids jsonb;state text;
BEGIN
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR p_action IS NULL OR p_action NOT IN ('read','check_begin','check_finish','resolve_check','command_reserve','command_guard','command_finish','reconcile','artifact','bridge','review') OR octet_length(p_body::text)>2300000 THEN RAISE EXCEPTION 'Invalid lifecycle action' USING ERRCODE='22023';END IF;
 entity:=(p_body->>'id')::uuid;
 PERFORM public.platform_sales_signature_action(p_actor,'read',jsonb_build_object('id',entity));
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-signature:'||entity::text,0));author:=public.platform_sales_finance_name(p_actor);
 SELECT * INTO r FROM public.platform_sales_signature_requests WHERE id=entity;
 SELECT request_id INTO latest FROM public.platform_sales_signature_observations WHERE signature_id=entity ORDER BY created_at DESC,request_id DESC LIMIT 1;
 IF p_action='read' THEN
  IF p_body-ARRAY['id','page']<>'{}' OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  page:=(p_body->>'page')::integer;IF page>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('id',entity,'environment','SANDBOX','realActivationEligible',false,'page',page,'latestCheckId',latest,
   'total',(SELECT count(*) FROM public.platform_sales_signature_observations WHERE signature_id=entity),
   'checks',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'input'||jsonb_build_object('currentActorName',public.platform_sales_finance_name(x.actor_id),'result',(SELECT to_jsonb(y) FROM public.platform_sales_signature_observation_results y WHERE y.request_id=x.request_id),'resolution',(SELECT to_jsonb(rs)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(rs.actor_id)) FROM public.platform_sales_signature_observation_resolutions rs WHERE rs.request_id=x.request_id),'artifact',(SELECT to_jsonb(f)-'pdf'-'log' FROM public.platform_sales_signature_artifacts f WHERE f.check_id=x.request_id),'signedDocument',(SELECT public.platform_sales_signed_document_action(p_actor,'read',jsonb_build_object('id',l.document_id)) FROM public.platform_sales_signature_signed_links l JOIN public.platform_sales_signature_artifacts linked_pdf ON linked_pdf.check_id=l.check_id WHERE l.signature_id=x.signature_id AND (l.check_id=x.request_id OR linked_pdf.sha256=(SELECT f.sha256 FROM public.platform_sales_signature_artifacts f WHERE f.check_id=x.request_id)) ORDER BY l.created_at DESC LIMIT 1)) ORDER BY x.created_at DESC,x.request_id DESC),'[]') FROM(SELECT * FROM public.platform_sales_signature_observations WHERE signature_id=entity ORDER BY created_at DESC,request_id DESC LIMIT 25 OFFSET page*25)x),
   'commands',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'input'||jsonb_build_object('currentActorName',public.platform_sales_finance_name(x.actor_id),'events',(SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(e.actor_id)) ORDER BY version) FROM public.platform_sales_signature_lifecycle_events e WHERE e.command_id=x.request_id)) ORDER BY x.created_at DESC),'[]') FROM(SELECT * FROM public.platform_sales_signature_lifecycle_commands WHERE signature_id=entity ORDER BY created_at DESC LIMIT 25)x),
   'inbox',(SELECT coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('confirmed',EXISTS(SELECT 1 FROM public.platform_sales_signature_observations ob JOIN public.platform_sales_signature_observation_results res USING(request_id) WHERE ob.event_hash=x.event_hash AND res.proof IS NOT NULL)) ORDER BY x.received_at DESC),'[]') FROM(SELECT * FROM public.platform_sales_signature_inbox WHERE signature_id=entity ORDER BY received_at DESC LIMIT 25)x));
 END IF;
 IF p_action='artifact' THEN
  IF p_body-ARRAY['id','checkId','kind']<>'{}' OR p_body->>'kind' NOT IN ('PDF','LOG') OR p_body->>'kind' IS NULL THEN RAISE EXCEPTION 'Invalid artifact' USING ERRCODE='22023';END IF;
  SELECT * INTO a FROM public.platform_sales_signature_artifacts WHERE check_id=(p_body->>'checkId')::uuid AND signature_id=entity;
  IF a.check_id IS NULL THEN RAISE EXCEPTION 'Artifact unavailable' USING ERRCODE='P3620';END IF;
  RETURN CASE WHEN p_body->>'kind'='PDF' THEN jsonb_build_object('hex',encode(a.pdf,'hex'),'sha256',a.sha256) ELSE jsonb_build_object('log',a.log) END;
 END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
 note:=p_body->>'justification';
 IF p_action IN ('check_begin','resolve_check','command_reserve','reconcile','bridge','review') AND (jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(note)) NOT BETWEEN 20 AND 1000 OR note ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023';END IF;
 IF p_action='resolve_check' THEN
  IF p_body-ARRAY['id','requestId','justification']<>'{}' OR NOT p_body ?& ARRAY['id','requestId','justification'] THEN RAISE EXCEPTION 'Invalid resolution' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM public.platform_sales_signature_observation_resolutions rs JOIN public.platform_sales_signature_observations ob USING(request_id) WHERE rs.request_id=req AND ob.signature_id=entity AND rs.actor_id=p_actor AND rs.justification=note) THEN RETURN jsonb_build_object('state','INCOMPLETE','replayed',true);END IF;
  SELECT * INTO o FROM public.platform_sales_signature_observations WHERE request_id=req AND signature_id=entity;
  IF o.request_id IS NULL OR o.created_at>clock_timestamp()-interval '5 minutes' OR EXISTS(SELECT 1 FROM public.platform_sales_signature_observation_results WHERE request_id=req) THEN RAISE EXCEPTION 'Observation not unresolved or too recent' USING ERRCODE='23505';END IF;
  INSERT INTO public.platform_sales_signature_observation_resolutions VALUES(req,p_actor,author,note,clock_timestamp());
  INSERT INTO public.platform_sales_signature_observation_results VALUES(req,NULL,clock_timestamp());
  RETURN jsonb_build_object('state','INCOMPLETE','realActivationEligible',false);
 END IF;
 IF p_action='check_begin' THEN
  IF p_body-ARRAY['id','requestId','eventHash','justification']<>'{}' OR NOT p_body ?& ARRAY['id','requestId','eventHash','justification'] THEN RAISE EXCEPTION 'Invalid check' USING ERRCODE='22023';END IF;
  SELECT * INTO o FROM public.platform_sales_signature_observations WHERE request_id=req;
  IF o.request_id IS NOT NULL THEN
   IF o.signature_id<>entity OR o.actor_id<>p_actor OR o.input<>p_body THEN RAISE EXCEPTION 'Changed check retry' USING ERRCODE='23505';END IF;
   RETURN jsonb_build_object('replayed',true,'state',CASE WHEN EXISTS(SELECT 1 FROM public.platform_sales_signature_observation_results WHERE request_id=req) THEN 'FINISHED' ELSE 'PENDING' END);
  END IF;
  IF EXISTS(SELECT 1 FROM public.platform_sales_signature_observations x LEFT JOIN public.platform_sales_signature_observation_results y USING(request_id) WHERE x.signature_id=entity AND y.request_id IS NULL) THEN RAISE EXCEPTION 'Pending observation' USING ERRCODE='23505';END IF;
  IF p_body->>'eventHash' IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.platform_sales_signature_inbox WHERE event_hash=p_body->>'eventHash' AND signature_id=entity) OR EXISTS(SELECT 1 FROM public.platform_sales_signature_observations x JOIN public.platform_sales_signature_observation_results y USING(request_id) WHERE x.event_hash=p_body->>'eventHash' AND y.proof IS NOT NULL) THEN RAISE EXCEPTION 'Event already confirmed or unavailable' USING ERRCODE='23505';END IF;
  ELSE
   -- Explicit preflight before first notification and uncertain activation recovery; no background polling.
   IF EXISTS(SELECT 1 FROM public.platform_sales_signature_lifecycle_commands cmd CROSS JOIN LATERAL(SELECT ev.state FROM public.platform_sales_signature_lifecycle_events ev WHERE ev.command_id=cmd.request_id ORDER BY version DESC LIMIT 1)e WHERE cmd.signature_id=entity AND cmd.kind='NOTIFY' AND e.state<>'NOT_SENT') THEN RAISE EXCEPTION 'Notification already dispatched; webhook event required' USING ERRCODE='23505';END IF;
  END IF;
  context:=public.platform_sales_signature_lifecycle_context(entity);
  INSERT INTO public.platform_sales_signature_observations VALUES(req,entity,p_body->>'eventHash',context->>'sourceHash',p_actor,author,note,p_body,clock_timestamp());
  RETURN context||jsonb_build_object('requestId',req);
 END IF;
 IF p_action='check_finish' THEN
  IF p_body-ARRAY['id','requestId','result']<>'{}' OR NOT p_body ? 'result' THEN RAISE EXCEPTION 'Invalid check result' USING ERRCODE='22023';END IF;
  SELECT * INTO o FROM public.platform_sales_signature_observations WHERE request_id=req AND signature_id=entity;
  IF o.request_id IS NULL OR o.actor_id<>p_actor THEN RAISE EXCEPTION 'Check unavailable' USING ERRCODE='23505';END IF;
  v:=p_body->'result';proof:=CASE WHEN v='null'::jsonb THEN NULL ELSE v->'proof' END;
  SELECT * INTO z FROM public.platform_sales_signature_observation_results WHERE request_id=req;
  IF z.request_id IS NOT NULL THEN
   IF z.proof IS DISTINCT FROM proof OR v->>'pdfHex' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.platform_sales_signature_artifacts WHERE check_id=req AND pdf=decode(v->>'pdfHex','hex')) THEN RAISE EXCEPTION 'Divergent result retry' USING ERRCODE='23505';END IF;
   RETURN jsonb_build_object('replayed',true,'status',coalesce(proof->>'status','INCOMPLETE'));
  END IF;
  IF proof IS NOT NULL THEN
   context:=public.platform_sales_signature_lifecycle_context(entity);ids:=context->'resources';
   IF context->>'sourceHash'<>o.source_hash OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v-ARRAY['proof','pdfHex']<>'{}' OR NOT v ?& ARRAY['proof','pdfHex'] OR jsonb_typeof(proof) IS DISTINCT FROM 'object'
   OR proof-ARRAY['envelopeId','documentId','status','signedAt','signers','log','environment','realActivationEligible']<>'{}' OR NOT proof ?& ARRAY['envelopeId','documentId','status','signedAt','signers','log','environment','realActivationEligible']
   OR proof->>'envelopeId' IS DISTINCT FROM ids->0->>'external_id' OR proof->>'documentId' IS DISTINCT FROM ids->1->>'external_id' OR proof->>'environment' IS DISTINCT FROM 'SANDBOX' OR proof->'realActivationEligible' IS DISTINCT FROM 'false'::jsonb
   OR proof->>'status' IS NULL OR proof->>'status' NOT IN ('DRAFT','RUNNING','SIGNED','CANCELED') OR proof->'signers' IS DISTINCT FROM jsonb_build_array(ids->2->>'external_id',ids->3->>'external_id') OR jsonb_typeof(proof->'log') IS DISTINCT FROM 'array' OR jsonb_array_length(proof->'log')>200
   THEN RAISE EXCEPTION 'Divergent observation' USING ERRCODE='22023';END IF;
   IF proof->>'status'='SIGNED' THEN
    IF EXISTS(SELECT 1 FROM public.platform_sales_signature_observation_results y JOIN public.platform_sales_signature_observations x USING(request_id) WHERE x.signature_id=entity AND y.proof->>'status'='CANCELED') THEN RAISE EXCEPTION 'Canceled source cannot become signed' USING ERRCODE='23505';END IF;
    IF v->>'pdfHex' IS NULL OR length(v->>'pdfHex') NOT BETWEEN 200 AND 2097152 OR v->>'pdfHex' !~ '^([a-f0-9]{2})+$' OR proof->>'signedAt' IS NULL OR (proof->>'signedAt')::timestamptz>clock_timestamp()+interval '5 minutes'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'log') x WHERE jsonb_typeof(x)<>'object' OR x-ARRAY['id','name','occurredAt','signerId']<>'{}' OR NOT x ?& ARRAY['id','name','occurredAt','signerId'] OR x->>'name' IS NULL OR x->>'name' !~ '^[a-z_]{1,60}$' OR x->>'name' IN ('cancel','refusal','deadline') OR x->>'occurredAt' IS NULL OR (x->>'occurredAt')::timestamptz>clock_timestamp()+interval '5 minutes' OR x->>'id' IS NULL)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(proof->'signers') s WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'log') x WHERE x->>'name'='sign' AND x->>'signerId'=s.value)) THEN RAISE EXCEPTION 'Incomplete signature proof' USING ERRCODE='22023';END IF;
    file:=decode(v->>'pdfHex','hex');IF substring(file FROM 1 FOR 5)<>decode('255044462d','hex') OR position(decode('2525454f46','hex') IN substring(file FROM greatest(1,octet_length(file)-1023)))=0 OR encode(sha256(file),'hex')=r.draft_sha256 THEN RAISE EXCEPTION 'Unsigned PDF' USING ERRCODE='22023';END IF;
    INSERT INTO public.platform_sales_signature_artifacts VALUES(req,entity,file,encode(sha256(file),'hex'),proof->'log',(proof->>'signedAt')::timestamptz,clock_timestamp());
   ELSE
    IF v->'pdfHex' IS DISTINCT FROM 'null'::jsonb OR proof->'signedAt' IS DISTINCT FROM 'null'::jsonb OR proof->'log'<>'[]' THEN RAISE EXCEPTION 'Unexpected artifact' USING ERRCODE='22023';END IF;
    IF proof->>'status' IN ('DRAFT','RUNNING') AND EXISTS(SELECT 1 FROM public.platform_sales_signature_observation_results y JOIN public.platform_sales_signature_observations x USING(request_id) WHERE x.signature_id=entity AND y.proof->>'status' IN ('SIGNED','CANCELED')) THEN RAISE EXCEPTION 'Terminal state cannot regress' USING ERRCODE='23505';END IF;
   END IF;
  ELSIF v<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023';END IF;
  INSERT INTO public.platform_sales_signature_observation_results VALUES(req,proof,clock_timestamp());
  RETURN jsonb_build_object('checkId',req,'status',coalesce(proof->>'status','INCOMPLETE'),'realActivationEligible',false);
 END IF;
 IF p_action IN ('command_guard','command_finish') THEN
  IF p_action='command_guard' AND p_body-ARRAY['id','requestId']<>'{}' OR p_action='command_finish' AND (p_body-ARRAY['id','requestId','state']<>'{}' OR p_body->>'state' IS NULL OR p_body->>'state' NOT IN ('NOT_SENT','UNKNOWN','VERIFIED','ACKNOWLEDGED')) THEN RAISE EXCEPTION 'Invalid command result' USING ERRCODE='22023';END IF;
  SELECT * INTO command FROM public.platform_sales_signature_lifecycle_commands WHERE request_id=req AND signature_id=entity;
  IF command.request_id IS NULL OR command.actor_id<>p_actor THEN RAISE EXCEPTION 'Command unavailable' USING ERRCODE='23505';END IF;
  SELECT * INTO event FROM public.platform_sales_signature_lifecycle_events WHERE command_id=req ORDER BY version DESC LIMIT 1;
  IF p_action='command_guard' THEN
   context:=public.platform_sales_signature_lifecycle_context(entity);IF event.state<>'RESERVED' OR context->>'sourceHash'<>command.source_hash OR latest<>command.check_id THEN RAISE EXCEPTION 'Command source changed' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('reserved',true);
  END IF;
  state:=p_body->>'state';IF command.kind='ACTIVATE' AND state='ACKNOWLEDGED' OR command.kind='NOTIFY' AND state='VERIFIED' THEN RAISE EXCEPTION 'Wrong command result' USING ERRCODE='22023';END IF;
  IF event.state<>'RESERVED' THEN IF event.state<>state THEN RAISE EXCEPTION 'Changed finish retry' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('state',state,'replayed',true);END IF;
  INSERT INTO public.platform_sales_signature_lifecycle_events VALUES(req,event.version+1,state,command.check_id,p_actor,author,NULL,clock_timestamp());RETURN jsonb_build_object('state',state);
 END IF;
 IF p_action='command_reserve' THEN
  IF p_body-ARRAY['id','requestId','checkId','kind','justification']<>'{}' OR NOT p_body ?& ARRAY['id','requestId','checkId','kind','justification'] OR p_body->>'kind' IS NULL OR p_body->>'kind' NOT IN ('ACTIVATE','NOTIFY') THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
  SELECT * INTO command FROM public.platform_sales_signature_lifecycle_commands WHERE request_id=req;
  IF command.request_id IS NOT NULL THEN
   IF command.signature_id<>entity OR command.actor_id<>p_actor OR command.input<>p_body THEN RAISE EXCEPTION 'Changed command retry' USING ERRCODE='23505';END IF;
   RETURN jsonb_build_object('replayed',true,'state',(SELECT ev.state FROM public.platform_sales_signature_lifecycle_events ev WHERE ev.command_id=req ORDER BY version DESC LIMIT 1));
  END IF;
  context:=public.platform_sales_signature_lifecycle_context(entity);
  SELECT * INTO o FROM public.platform_sales_signature_observations WHERE request_id=(p_body->>'checkId')::uuid AND signature_id=entity;SELECT * INTO z FROM public.platform_sales_signature_observation_results WHERE request_id=o.request_id;
  IF o.request_id IS NULL OR o.request_id IS DISTINCT FROM latest OR o.source_hash<>context->>'sourceHash' OR z.created_at<clock_timestamp()-interval '5 minutes' OR z.proof->>'status' IS DISTINCT FROM (CASE WHEN p_body->>'kind'='ACTIVATE' THEN 'DRAFT' ELSE 'RUNNING' END)
  OR EXISTS(SELECT 1 FROM public.platform_sales_signature_inbox i WHERE i.signature_id=entity AND i.received_at>z.created_at)
  OR EXISTS(SELECT 1 FROM public.platform_sales_signature_lifecycle_commands c CROSS JOIN LATERAL(SELECT ev.state FROM public.platform_sales_signature_lifecycle_events ev WHERE ev.command_id=c.request_id ORDER BY version DESC LIMIT 1)e WHERE c.signature_id=entity AND (c.kind=p_body->>'kind' OR e.state IN ('RESERVED','UNKNOWN')) AND e.state<>'NOT_SENT') THEN RAISE EXCEPTION 'Command blocked or duplicate' USING ERRCODE='23505';END IF;
  IF p_body->>'kind'='NOTIFY' AND NOT EXISTS(SELECT 1 FROM public.platform_sales_signature_lifecycle_commands c JOIN public.platform_sales_signature_lifecycle_events e ON e.command_id=c.request_id WHERE c.signature_id=entity AND c.kind='ACTIVATE' AND e.state='VERIFIED') THEN RAISE EXCEPTION 'Activation unconfirmed' USING ERRCODE='23505';END IF;
  INSERT INTO public.platform_sales_signature_lifecycle_commands VALUES(req,entity,o.request_id,p_body->>'kind',context->>'sourceHash',p_actor,author,note,p_body,clock_timestamp());
  INSERT INTO public.platform_sales_signature_lifecycle_events VALUES(req,1,'RESERVED',o.request_id,p_actor,author,note,clock_timestamp());RETURN context||jsonb_build_object('requestId',req);
 END IF;
 IF p_action='reconcile' THEN
  IF p_body-ARRAY['id','requestId','checkId','justification']<>'{}' THEN RAISE EXCEPTION 'Invalid reconciliation' USING ERRCODE='22023';END IF;
  SELECT * INTO command FROM public.platform_sales_signature_lifecycle_commands WHERE request_id=req AND signature_id=entity AND kind='ACTIVATE';
  SELECT * INTO event FROM public.platform_sales_signature_lifecycle_events WHERE command_id=req ORDER BY version DESC LIMIT 1;
  SELECT * INTO o FROM public.platform_sales_signature_observations WHERE request_id=(p_body->>'checkId')::uuid AND signature_id=entity;SELECT * INTO z FROM public.platform_sales_signature_observation_results WHERE request_id=o.request_id;
  context:=public.platform_sales_signature_lifecycle_context(entity);
 IF command.request_id IS NULL OR o.request_id IS DISTINCT FROM latest OR o.source_hash<>command.source_hash OR o.source_hash<>context->>'sourceHash' OR o.created_at<command.created_at OR z.proof->>'status' IS NULL OR z.proof->>'status' NOT IN ('RUNNING','SIGNED') THEN RAISE EXCEPTION 'Recovery proof unavailable' USING ERRCODE='23505';END IF;
  IF event.state='VERIFIED' THEN RETURN jsonb_build_object('replayed',true,'state','VERIFIED');END IF;
  IF event.state NOT IN ('RESERVED','UNKNOWN') THEN RAISE EXCEPTION 'No uncertain activation' USING ERRCODE='23505';END IF;
  INSERT INTO public.platform_sales_signature_lifecycle_events VALUES(req,event.version+1,'VERIFIED',o.request_id,p_actor,author,note,clock_timestamp());RETURN jsonb_build_object('state','VERIFIED');
 END IF;
 IF p_action IN ('bridge','review') THEN
  IF p_action='bridge' OR p_body->>'status' IS DISTINCT FROM 'REJECTED' THEN context:=public.platform_sales_signature_lifecycle_context(entity);END IF;
  IF p_action='bridge' THEN
   IF p_body-ARRAY['id','requestId','checkId','justification']<>'{}' OR NOT p_body ?& ARRAY['id','requestId','checkId','justification'] THEN RAISE EXCEPTION 'Invalid bridge' USING ERRCODE='22023';END IF;
   SELECT * INTO a FROM public.platform_sales_signature_artifacts WHERE check_id=(p_body->>'checkId')::uuid AND signature_id=entity;
   IF a.check_id IS NULL OR a.check_id IS DISTINCT FROM latest OR EXISTS(SELECT 1 FROM public.platform_sales_signature_inbox WHERE signature_id=entity AND received_at>(SELECT created_at FROM public.platform_sales_signature_observation_results WHERE request_id=latest)) THEN RAISE EXCEPTION 'Artifact requires current confirmation' USING ERRCODE='23505';END IF;
   SELECT * INTO link FROM public.platform_sales_signature_signed_links WHERE check_id=a.check_id;
   IF link.check_id IS NOT NULL THEN IF link.document_id<>req OR link.actor_id<>p_actor OR link.justification<>note THEN RAISE EXCEPTION 'Changed bridge retry' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('documentId',req,'replayed',true);END IF;
   v:=public.platform_sales_signed_document_action(p_actor,'import',jsonb_build_object('id',req,'draftId',r.draft_id,'draftSha256',r.draft_sha256,'hex',encode(a.pdf,'hex'),'filename','energyos-clicksign-sandbox.pdf','metadata',jsonb_build_object('signedAt',(a.signed_at AT TIME ZONE 'UTC')::date::text,'supplierSignatory',context#>>'{parties,supplier,signatory}','customerSignatory',context#>>'{parties,customer,signatory}','source','Clicksign SANDBOX - '||entity::text),'justification',note));
   INSERT INTO public.platform_sales_signature_signed_links VALUES(a.check_id,entity,req,p_actor,author,note,clock_timestamp());RETURN jsonb_build_object('documentId',req,'proposalId',r.proposal_id,'state','IMPORTED','realActivationEligible',false);
  END IF;
  IF p_body-ARRAY['id','documentId','requestId','expectedVersion','status','checks','justification']<>'{}' THEN RAISE EXCEPTION 'Invalid Owner review' USING ERRCODE='22023';END IF;
  SELECT * INTO link FROM public.platform_sales_signature_signed_links WHERE signature_id=entity AND document_id=(p_body->>'documentId')::uuid;
  IF link.check_id IS NULL THEN RAISE EXCEPTION 'Unbound document' USING ERRCODE='23505';END IF;
  IF p_body->>'status'<>'REJECTED' AND ((SELECT res.proof->>'status' FROM public.platform_sales_signature_observation_results res WHERE res.request_id=latest) IS DISTINCT FROM 'SIGNED' OR EXISTS(SELECT 1 FROM public.platform_sales_signature_inbox WHERE signature_id=entity AND received_at>(SELECT created_at FROM public.platform_sales_signature_observation_results WHERE request_id=latest))) THEN RAISE EXCEPTION 'Signature evidence changed' USING ERRCODE='23505';END IF;
  RETURN public.platform_sales_signed_document_action(p_actor,'review',jsonb_build_object('id',link.document_id,'requestId',req,'expectedVersion',p_body->'expectedVersion','status',p_body->'status','checks',p_body->'checks','justification',note));
 END IF;
 RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signature_lifecycle_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_signature_lifecycle_action(uuid,text,jsonb) TO service_role;

-- The existing manual review endpoint also obeys current API evidence for linked documents.
CREATE FUNCTION public.platform_sales_signature_review_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE link public.platform_sales_signature_signed_links;latest uuid;proof jsonb;context jsonb;o public.platform_sales_signature_observations;
BEGIN
 IF NEW.status NOT IN ('CHECKED','ACCEPTED') THEN RETURN NEW;END IF;
 SELECT * INTO link FROM public.platform_sales_signature_signed_links WHERE document_id=NEW.document_id;IF link.check_id IS NULL THEN RETURN NEW;END IF;
 context:=public.platform_sales_signature_lifecycle_context(link.signature_id);
 SELECT * INTO o FROM public.platform_sales_signature_observations WHERE signature_id=link.signature_id ORDER BY created_at DESC,request_id DESC LIMIT 1;
 SELECT z.proof INTO proof FROM public.platform_sales_signature_observation_results z WHERE z.request_id=o.request_id;
 IF proof->>'status' IS DISTINCT FROM 'SIGNED' OR o.source_hash<>context->>'sourceHash' OR (SELECT sha256 FROM public.platform_sales_signature_artifacts WHERE check_id=o.request_id) IS DISTINCT FROM (SELECT sha256 FROM public.platform_sales_signature_artifacts WHERE check_id=link.check_id) OR EXISTS(SELECT 1 FROM public.platform_sales_signature_inbox WHERE signature_id=link.signature_id AND received_at>(SELECT created_at FROM public.platform_sales_signature_observation_results WHERE request_id=o.request_id)) THEN RAISE EXCEPTION 'Signature evidence must be reconfirmed' USING ERRCODE='23505';END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signature_review_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER signature_api_review_guard BEFORE INSERT ON public.platform_sales_signed_document_events FOR EACH ROW EXECUTE FUNCTION public.platform_sales_signature_review_guard();
-- Acquire signature before document/draft locks on both review entry points.
ALTER FUNCTION public.platform_sales_signed_document_action(uuid,text,jsonb) RENAME TO platform_sales_signed_document_action_before_clicksign;
CREATE FUNCTION public.platform_sales_signed_document_action(p_actor uuid,p_action text,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE link public.platform_sales_signature_signed_links;v jsonb;
BEGIN
 IF p_action='review' AND jsonb_typeof(p_body)='object' THEN
  SELECT * INTO link FROM public.platform_sales_signature_signed_links WHERE document_id=(p_body->>'id')::uuid;
  IF link.check_id IS NOT NULL THEN
   PERFORM public.platform_sales_signature_action(p_actor,'read',jsonb_build_object('id',link.signature_id));
   PERFORM pg_advisory_xact_lock(hashtextextended('sales-signature:'||link.signature_id::text,0));
  END IF;
 END IF;
 v:=public.platform_sales_signed_document_action_before_clicksign(p_actor,p_action,p_body);
 IF p_action='read' THEN
  v:=jsonb_set(v,'{events}',(SELECT coalesce(jsonb_agg(x||jsonb_build_object('currentActorName',public.platform_sales_finance_name((x->>'actor_id')::uuid)) ORDER BY (x->>'version')::integer),'[]') FROM jsonb_array_elements(v->'events') x));
 END IF;
 RETURN v;
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signed_document_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_signed_document_action(uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.platform_sales_signed_document_action_before_clicksign(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Keep manual imports unchanged. A linked Clicksign document adds current API provenance
-- to 5A and therefore to the revalidated 5B payload, never replacing financial checks.
ALTER FUNCTION public.platform_sales_activation_source(text,uuid,uuid,uuid) RENAME TO platform_sales_activation_source_before_clicksign;
CREATE FUNCTION public.platform_sales_activation_source(p_org text,p_proposal uuid,p_document uuid,p_binding uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v jsonb;link public.platform_sales_signature_signed_links;latest uuid;proof jsonb;extra jsonb;blockers jsonb;
BEGIN
 v:=public.platform_sales_activation_source_before_clicksign(p_org,p_proposal,p_document,p_binding);
 SELECT * INTO link FROM public.platform_sales_signature_signed_links WHERE document_id=p_document;IF link.check_id IS NULL THEN RETURN v;END IF;
 SELECT request_id INTO latest FROM public.platform_sales_signature_observations WHERE signature_id=link.signature_id ORDER BY created_at DESC,request_id DESC LIMIT 1;
 SELECT z.proof INTO proof FROM public.platform_sales_signature_observation_results z WHERE z.request_id=latest;
 extra:=jsonb_build_object('provider','CLICKSIGN','environment','SANDBOX','signatureId',link.signature_id,'artifactCheckId',link.check_id,'currentCheckId',latest,'status',coalesce(proof->>'status','INCOMPLETE'),'realActivationEligible',false);
 blockers:=v->'blockers';IF proof->>'status' IS DISTINCT FROM 'SIGNED' OR (SELECT sha256 FROM public.platform_sales_signature_artifacts WHERE check_id=latest) IS DISTINCT FROM (SELECT sha256 FROM public.platform_sales_signature_artifacts WHERE check_id=link.check_id) OR EXISTS(SELECT 1 FROM public.platform_sales_signature_inbox WHERE signature_id=link.signature_id AND received_at>(SELECT created_at FROM public.platform_sales_signature_observation_results WHERE request_id=latest)) THEN blockers:=blockers||jsonb_build_array('SIGNATURE_API_RECONFIRMATION_REQUIRED');END IF;
 v:=jsonb_set(v,'{snapshot}',v->'snapshot'||jsonb_build_object('signatureEvidence',extra,'blockers',blockers));v:=jsonb_set(v,'{blockers}',blockers);
 RETURN jsonb_set(v,'{sourceHash}',to_jsonb(encode(sha256(convert_to((v->'snapshot')::text,'UTF8')),'hex')));
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_activation_source(text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.platform_sales_activation_source_before_clicksign(text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
