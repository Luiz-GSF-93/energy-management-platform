BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.platform_sales_signature_original_checks (
 request_id uuid PRIMARY KEY,signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),
 lease uuid NOT NULL REFERENCES public.platform_sales_signature_attempts(lease),envelope_id uuid NOT NULL,document_id uuid NOT NULL,
 draft_sha256 text NOT NULL CHECK(draft_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_original_results (
 request_id uuid PRIMARY KEY REFERENCES public.platform_sales_signature_original_checks(request_id),
 state text NOT NULL CHECK(state IN ('INCOMPLETE','VERIFIED')),proof jsonb NOT NULL,
 actor_id uuid NOT NULL,actor_name text,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX signature_original_recent ON public.platform_sales_signature_original_checks(signature_id,created_at DESC,request_id DESC);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_signature_original_checks','platform_sales_signature_original_results'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;
CREATE FUNCTION public.platform_sales_signature_original_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE entity uuid;req uuid;author text;page integer;v jsonb;env uuid;
 r public.platform_sales_signature_requests;d public.platform_sales_contract_drafts;
 a public.platform_sales_signature_attempts;e public.platform_sales_signature_attempt_events;
 c public.platform_sales_signature_original_checks;z public.platform_sales_signature_original_results;
BEGIN
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>5000 OR p_action IS NULL OR p_action NOT IN ('read','begin','complete') THEN RAISE EXCEPTION 'Invalid original proof action' USING ERRCODE='22023';END IF;
 entity:=(p_body->>'id')::uuid;
 PERFORM public.platform_sales_signature_action(p_actor,'read',jsonb_build_object('id',entity));
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-signature:'||entity::text,0));
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action='read' THEN
  IF p_body-ARRAY['id','page']<>'{}' OR NOT p_body ? 'page' OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  page:=(p_body->>'page')::integer;IF page>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('total',(SELECT count(*) FROM public.platform_sales_signature_original_checks WHERE signature_id=entity),'page',page,'rows',
   (SELECT coalesce(jsonb_agg(to_jsonb(x)-'input'||jsonb_build_object('currentActorName',public.platform_sales_finance_name(x.actor_id),'outcome',
    (SELECT to_jsonb(y)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(y.actor_id)) FROM public.platform_sales_signature_original_results y WHERE y.request_id=x.request_id)) ORDER BY x.created_at DESC,x.request_id DESC),'[]')
    FROM(SELECT * FROM public.platform_sales_signature_original_checks WHERE signature_id=entity ORDER BY created_at DESC,request_id DESC LIMIT 25 OFFSET page*25)x),'realActivationEligible',false);
 END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request ID required' USING ERRCODE='22023';END IF;
 IF p_action='begin' THEN
  IF p_body-ARRAY['id','lease','candidateId','requestId','justification']<>'{}' OR NOT p_body ?& ARRAY['id','lease','candidateId','requestId','justification'] OR jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification'))<20 OR length(p_body->>'justification')>1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid original check' USING ERRCODE='22023';END IF;
  SELECT * INTO c FROM public.platform_sales_signature_original_checks WHERE request_id=req;
  IF c.request_id IS NOT NULL THEN
   IF c.signature_id<>entity OR c.actor_id<>p_actor OR c.input<>p_body THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;
   SELECT * INTO z FROM public.platform_sales_signature_original_results WHERE request_id=req;
   RETURN jsonb_build_object('requestId',req,'replayed',true,'state',coalesce(z.state,'PENDING'),'realActivationEligible',false);
  END IF;
  IF EXISTS(SELECT 1 FROM public.platform_sales_signature_original_checks x LEFT JOIN public.platform_sales_signature_original_results y USING(request_id) WHERE x.signature_id=entity AND y.request_id IS NULL) THEN RAISE EXCEPTION 'Unresolved document check' USING ERRCODE='23505';END IF;
  SELECT * INTO r FROM public.platform_sales_signature_requests WHERE id=entity;
  SELECT * INTO d FROM public.platform_sales_contract_drafts WHERE id=r.draft_id FOR SHARE;
  IF r.environment<>'SANDBOX' OR (SELECT state FROM public.platform_sales_signature_events WHERE signature_id=entity ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'PREPARED' OR d.sha256 IS DISTINCT FROM r.draft_sha256 OR encode(sha256(d.pdf),'hex') IS DISTINCT FROM r.draft_sha256
   OR (SELECT status FROM public.platform_sales_contract_events WHERE draft_id=d.id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL'
   OR (SELECT status FROM public.platform_sales_proposal_events WHERE proposal_id=r.proposal_id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL'
   OR (r.snapshot#>>'{terms,definition,validUntil}')::date<CURRENT_DATE THEN RAISE EXCEPTION 'Source no longer eligible' USING ERRCODE='23505';END IF;
  SELECT * INTO a FROM public.platform_sales_signature_attempts WHERE lease=(p_body->>'lease')::uuid;
  IF a.lease IS NULL OR a.signature_id<>entity OR a.ordinal<>2 OR a.step<>'DOCUMENT' THEN RAISE EXCEPTION 'Document attempt unavailable' USING ERRCODE='23505';END IF;
  SELECT * INTO e FROM public.platform_sales_signature_attempt_events WHERE lease=a.lease ORDER BY version DESC LIMIT 1;
  IF e.state NOT IN ('RESERVED','UNKNOWN','VERIFIED') THEN RAISE EXCEPTION 'Document not dispatched' USING ERRCODE='23505';END IF;
  IF e.state='VERIFIED' AND NOT EXISTS(SELECT 1 FROM public.platform_sales_signature_resources WHERE signature_id=entity AND ordinal=2 AND lease=a.lease AND external_id=(p_body->>'candidateId')::uuid AND type='documents') THEN RAISE EXCEPTION 'Divergent document' USING ERRCODE='23505';END IF;
  SELECT external_id INTO env FROM public.platform_sales_signature_resources WHERE signature_id=entity AND ordinal=1 AND type='envelopes';
  IF env IS NULL THEN RAISE EXCEPTION 'Envelope unavailable' USING ERRCODE='23505';END IF;
  INSERT INTO public.platform_sales_signature_original_checks VALUES(req,entity,a.lease,env,(p_body->>'candidateId')::uuid,r.draft_sha256,p_actor,author,p_body->>'justification',p_body,clock_timestamp());
  RETURN jsonb_build_object('id',entity,'requestId',req,'envelopeId',env,'documentId',p_body->>'candidateId','draftSha256',r.draft_sha256);
 END IF;
 IF p_body-ARRAY['id','requestId','result']<>'{}' OR NOT p_body ? 'result' THEN RAISE EXCEPTION 'Invalid proof' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.platform_sales_signature_original_checks WHERE request_id=req;
 IF c.request_id IS NULL OR c.signature_id<>entity OR c.actor_id<>p_actor THEN RAISE EXCEPTION 'Check unavailable' USING ERRCODE='23505';END IF;
 v:=p_body->'result';SELECT * INTO z FROM public.platform_sales_signature_original_results WHERE request_id=req;
 IF z.request_id IS NOT NULL THEN
  IF z.proof IS DISTINCT FROM v THEN RAISE EXCEPTION 'Conflicting proof' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('state',z.state,'replayed',true,'realActivationEligible',false);
 END IF;
 IF v<>'null'::jsonb THEN
  IF jsonb_typeof(v)<>'object' OR v-ARRAY['externalId','type','envelopeId','sha256','byteLength','environment','realActivationEligible']<>'{}' OR NOT v ?& ARRAY['externalId','type','envelopeId','sha256','byteLength','environment','realActivationEligible']
   OR v->>'externalId' IS DISTINCT FROM c.document_id::text OR v->>'type' IS DISTINCT FROM 'documents' OR v->>'envelopeId' IS DISTINCT FROM c.envelope_id::text OR v->>'sha256' IS DISTINCT FROM c.draft_sha256
   OR jsonb_typeof(v->'byteLength') IS DISTINCT FROM 'number' OR v->>'byteLength' !~ '^\d{1,7}$' OR (v->>'byteLength')::integer NOT BETWEEN 100 AND 1048576
   OR v->>'environment' IS DISTINCT FROM 'SANDBOX' OR v->'realActivationEligible' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Divergent document proof' USING ERRCODE='22023';END IF;
  SELECT * INTO d FROM public.platform_sales_contract_drafts WHERE id=(SELECT draft_id FROM public.platform_sales_signature_requests WHERE id=entity) FOR SHARE;
  IF octet_length(d.pdf)<>(v->>'byteLength')::integer OR encode(sha256(d.pdf),'hex')<>c.draft_sha256 THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='23505';END IF;
  SELECT * INTO e FROM public.platform_sales_signature_attempt_events WHERE lease=c.lease ORDER BY version DESC LIMIT 1;
  IF e.state='VERIFIED' THEN
   IF NOT EXISTS(SELECT 1 FROM public.platform_sales_signature_resources WHERE signature_id=entity AND ordinal=2 AND lease=c.lease AND external_id=c.document_id AND type='documents') THEN RAISE EXCEPTION 'Concurrent divergence' USING ERRCODE='23505';END IF;
  ELSE
   IF e.state NOT IN ('RESERVED','UNKNOWN') THEN RAISE EXCEPTION 'Attempt changed' USING ERRCODE='23505';END IF;
   INSERT INTO public.platform_sales_signature_resources VALUES(entity,2,c.lease,c.document_id,'documents');
   INSERT INTO public.platform_sales_signature_attempt_events VALUES(c.lease,e.version+1,'VERIFIED',jsonb_build_object('externalId',c.document_id,'type','documents'),p_actor,author,clock_timestamp());
  END IF;
 END IF;
 INSERT INTO public.platform_sales_signature_original_results VALUES(req,CASE WHEN v='null'::jsonb THEN 'INCOMPLETE' ELSE 'VERIFIED' END,v,p_actor,author,clock_timestamp());
 RETURN jsonb_build_object('requestId',req,'state',CASE WHEN v='null'::jsonb THEN 'INCOMPLETE' ELSE 'VERIFIED' END,'realActivationEligible',false);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signature_original_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_signature_original_action(uuid,text,jsonb) TO service_role;
COMMIT;
