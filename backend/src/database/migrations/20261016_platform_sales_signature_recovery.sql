BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.platform_sales_signature_checks (
 request_id uuid PRIMARY KEY,signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),
 lease uuid NOT NULL REFERENCES public.platform_sales_signature_attempts(lease),candidate_id uuid NOT NULL,
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,input jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_check_results (
 request_id uuid PRIMARY KEY REFERENCES public.platform_sales_signature_checks(request_id),
 state text NOT NULL CHECK(state IN ('INCOMPLETE','RECOVERED')),result jsonb NOT NULL,
 actor_id uuid NOT NULL,actor_name text,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX signature_checks_by_request ON public.platform_sales_signature_checks(signature_id,created_at,request_id);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_signature_checks','platform_sales_signature_check_results'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;
CREATE FUNCTION public.platform_sales_signature_recovery_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE entity uuid;req uuid;token uuid;author text;r public.platform_sales_signature_requests;
 a public.platform_sales_signature_attempts;e public.platform_sales_signature_attempt_events;
 c public.platform_sales_signature_checks;z public.platform_sales_signature_check_results;v jsonb;deps jsonb;kind text;page integer;
BEGIN
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>5000 OR p_action IS NULL OR p_action NOT IN ('read','begin','complete') THEN RAISE EXCEPTION 'Invalid recovery' USING ERRCODE='22023';END IF;
 entity:=(p_body->>'id')::uuid;
 PERFORM public.platform_sales_signature_action(p_actor,'read',jsonb_build_object('id',entity));
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-signature:'||entity::text,0));
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action='read' THEN
  IF p_body-ARRAY['id','page']<>'{}' OR p_body ? 'page' AND (jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$') THEN RAISE EXCEPTION 'Invalid read' USING ERRCODE='22023';END IF;
  page:=coalesce((p_body->>'page')::integer,0);IF page>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('total',(SELECT count(*) FROM public.platform_sales_signature_checks WHERE signature_id=entity),'page',page,'rows',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'input'||jsonb_build_object('currentActorName',public.platform_sales_finance_name(x.actor_id),'outcome',(SELECT to_jsonb(y)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(y.actor_id)) FROM public.platform_sales_signature_check_results y WHERE y.request_id=x.request_id)) ORDER BY x.created_at DESC,x.request_id DESC),'[]') FROM(SELECT * FROM public.platform_sales_signature_checks WHERE signature_id=entity ORDER BY created_at DESC,request_id DESC LIMIT 25 OFFSET page*25)x),'realActivationEligible',false);
 END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023';END IF;
 IF p_action='begin' THEN
  IF p_body-ARRAY['id','lease','requestId','candidateId','justification']<>'{}' OR NOT p_body ?& ARRAY['id','lease','requestId','candidateId','justification'] OR jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification'))<20 OR length(p_body->>'justification')>1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid check' USING ERRCODE='22023';END IF;
  SELECT * INTO c FROM public.platform_sales_signature_checks WHERE request_id=req;
  IF c.request_id IS NOT NULL THEN
   IF c.actor_id<>p_actor OR c.input<>p_body THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;
   SELECT * INTO z FROM public.platform_sales_signature_check_results WHERE request_id=req;
   RETURN jsonb_build_object('replayed',true,'requestId',req,'state',coalesce(z.state,'PENDING'),'realActivationEligible',false);
  END IF;
  token:=(p_body->>'lease')::uuid;
  SELECT * INTO a FROM public.platform_sales_signature_attempts WHERE lease=token;
  IF a.lease IS NULL OR a.signature_id<>entity OR a.ordinal=2 THEN RAISE EXCEPTION 'Attempt or document proof unavailable' USING ERRCODE='23505';END IF;
  SELECT * INTO e FROM public.platform_sales_signature_attempt_events WHERE lease=token ORDER BY version DESC LIMIT 1;
  IF e.state NOT IN ('RESERVED','UNKNOWN') OR EXISTS(SELECT 1 FROM public.platform_sales_signature_resources WHERE signature_id=entity AND ordinal=a.ordinal) THEN RAISE EXCEPTION 'No uncertain attempt' USING ERRCODE='23505';END IF;
  SELECT * INTO r FROM public.platform_sales_signature_requests WHERE id=entity;
  INSERT INTO public.platform_sales_signature_checks VALUES(req,entity,token,(p_body->>'candidateId')::uuid,p_actor,author,p_body->>'justification',p_body,clock_timestamp());
  SELECT coalesce(jsonb_object_agg(CASE ordinal WHEN 1 THEN 'envelope' WHEN 2 THEN 'document' WHEN 3 THEN 'supplier' WHEN 4 THEN 'customer' END,external_id),'{}') INTO deps FROM public.platform_sales_signature_resources WHERE signature_id=entity AND ordinal<=4;
  RETURN jsonb_build_object('id',entity,'requestId',req,'candidateId',p_body->>'candidateId','lease',token,'ordinal',a.ordinal,'step',a.step,'source',jsonb_build_object('draftSha256',r.draft_sha256,'parties',r.snapshot->'parties'),'dependencies',deps);
 END IF;
 IF p_body-ARRAY['id','requestId','result']<>'{}' OR NOT p_body ? 'result' THEN RAISE EXCEPTION 'Invalid proof' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.platform_sales_signature_checks WHERE request_id=req;
 IF c.request_id IS NULL OR c.signature_id<>entity OR c.actor_id<>p_actor THEN RAISE EXCEPTION 'Check unavailable' USING ERRCODE='23505';END IF;
 v:=p_body->'result';
 SELECT * INTO z FROM public.platform_sales_signature_check_results WHERE request_id=req;
 IF z.request_id IS NOT NULL THEN
  IF z.result IS DISTINCT FROM v THEN RAISE EXCEPTION 'Conflicting proof' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('state',z.state,'replayed',true,'realActivationEligible',false);
 END IF;
 SELECT * INTO a FROM public.platform_sales_signature_attempts WHERE lease=c.lease;
 SELECT * INTO e FROM public.platform_sales_signature_attempt_events WHERE lease=c.lease ORDER BY version DESC LIMIT 1;
 IF v<>'null'::jsonb THEN
  kind:=CASE a.ordinal WHEN 1 THEN 'envelopes' WHEN 3 THEN 'signers' WHEN 4 THEN 'signers' ELSE 'requirements' END;
  IF jsonb_typeof(v)<>'object' OR v-ARRAY['externalId','type']<>'{}' OR NOT v ?& ARRAY['externalId','type'] OR v->>'type' IS DISTINCT FROM kind OR (v->>'externalId')::uuid IS DISTINCT FROM c.candidate_id THEN RAISE EXCEPTION 'Divergent proof' USING ERRCODE='22023';END IF;
  IF e.state='VERIFIED' THEN
   IF NOT EXISTS(SELECT 1 FROM public.platform_sales_signature_resources WHERE signature_id=entity AND ordinal=a.ordinal AND external_id=c.candidate_id AND type=kind) THEN RAISE EXCEPTION 'Concurrent divergence' USING ERRCODE='23505';END IF;
  ELSE
   IF e.state NOT IN ('RESERVED','UNKNOWN') THEN RAISE EXCEPTION 'Attempt changed' USING ERRCODE='23505';END IF;
   INSERT INTO public.platform_sales_signature_resources VALUES(entity,a.ordinal,c.lease,c.candidate_id,kind);
   INSERT INTO public.platform_sales_signature_attempt_events VALUES(c.lease,e.version+1,'VERIFIED',v,p_actor,author,clock_timestamp());
  END IF;
 END IF;
 INSERT INTO public.platform_sales_signature_check_results VALUES(req,CASE WHEN v='null'::jsonb THEN 'INCOMPLETE' ELSE 'RECOVERED' END,v,p_actor,author,clock_timestamp());
 RETURN jsonb_build_object('requestId',req,'state',CASE WHEN v='null'::jsonb THEN 'INCOMPLETE' ELSE 'RECOVERED' END,'realActivationEligible',false);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signature_recovery_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_signature_recovery_action(uuid,text,jsonb) TO service_role;
COMMIT;
