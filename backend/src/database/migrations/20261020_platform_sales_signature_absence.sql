BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.platform_sales_signature_absence_checks (
 id uuid PRIMARY KEY,signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),
 lease uuid NOT NULL REFERENCES public.platform_sales_signature_attempts(lease),account_key uuid NOT NULL,
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,input jsonb NOT NULL,
 resolution_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_absence_results (
 check_id uuid PRIMARY KEY REFERENCES public.platform_sales_signature_absence_checks(id),
 proof jsonb NOT NULL,actor_id uuid NOT NULL,actor_name text,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_absence_resolutions (
 id uuid PRIMARY KEY,check_id uuid NOT NULL UNIQUE REFERENCES public.platform_sales_signature_absence_checks(id),
 lease uuid NOT NULL UNIQUE REFERENCES public.platform_sales_signature_attempts(lease),
 account_key uuid NOT NULL,provider_reference text NOT NULL,actor_id uuid NOT NULL,actor_name text,
 justification text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_absence_resolution_events (
 resolution_id uuid NOT NULL REFERENCES public.platform_sales_signature_absence_resolutions(id),version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('AUTHORIZED','USED','REJECTED')),request_id uuid REFERENCES public.platform_sales_signature_absence_checks(id),
 new_lease uuid REFERENCES public.platform_sales_signature_attempts(lease),actor_id uuid NOT NULL,actor_name text,
 justification text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(resolution_id,version)
);
ALTER TABLE public.platform_sales_signature_absence_checks ADD CONSTRAINT signature_absence_resolution_fk FOREIGN KEY(resolution_id) REFERENCES public.platform_sales_signature_absence_resolutions(id);
CREATE UNIQUE INDEX signature_absence_unique_execution ON public.platform_sales_signature_absence_checks(resolution_id) WHERE resolution_id IS NOT NULL;
CREATE TABLE public.platform_sales_signature_dispatch_diagnostics (
 lease uuid PRIMARY KEY REFERENCES public.platform_sales_signature_attempts(lease),
 reason text NOT NULL CHECK(reason IN ('HTTP','NETWORK','TIMEOUT','FORMAT','UNKNOWN')),
 http_status integer CHECK(http_status BETWEEN 100 AND 599),actor_id uuid NOT NULL,actor_name text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK((reason='HTTP' AND http_status IS NOT NULL) OR (reason<>'HTTP' AND http_status IS NULL))
);
CREATE INDEX signature_absence_by_request ON public.platform_sales_signature_absence_checks(signature_id,created_at,id);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_signature_absence_checks','platform_sales_signature_absence_results','platform_sales_signature_absence_resolutions','platform_sales_signature_absence_resolution_events','platform_sales_signature_dispatch_diagnostics'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;
CREATE FUNCTION public.platform_sales_signature_absence_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE entity uuid;author text;a public.platform_sales_signature_attempts;e public.platform_sales_signature_attempt_events;
 c public.platform_sales_signature_absence_checks;r public.platform_sales_signature_absence_resolutions;
 re public.platform_sales_signature_absence_resolution_events;proof jsonb;req uuid;res uuid;claim jsonb;pg integer;total integer;
BEGIN
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>12000 OR p_action IS NULL OR p_action NOT IN ('read','begin','complete','authorize','reject','executionCheck','consume','diagnostic') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 IF NOT (p_body ?& (CASE p_action WHEN 'read' THEN ARRAY['id','page'] WHEN 'begin' THEN ARRAY['id','lease','requestId','accountKey','justification'] WHEN 'complete' THEN ARRAY['id','requestId','proof'] WHEN 'authorize' THEN ARRAY['id','checkId','resolutionId','providerReference','accountKey','justification'] WHEN 'reject' THEN ARRAY['id','resolutionId','justification'] WHEN 'executionCheck' THEN ARRAY['id','resolutionId','requestId','justification'] WHEN 'consume' THEN ARRAY['id','resolutionId','requestId','lease','justification'] ELSE ARRAY['id','lease','reason','httpStatus'] END)) THEN RAISE EXCEPTION 'Missing fields' USING ERRCODE='22023';END IF;
 entity:=(p_body->>'id')::uuid;
 PERFORM public.platform_sales_signature_action(p_actor,'read',jsonb_build_object('id',entity));
 author:=public.platform_sales_finance_name(p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-signature:'||entity::text,0));
 IF p_action='read' THEN
  IF p_body-ARRAY['id','page']<>'{}' OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;IF pg>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO total FROM public.platform_sales_signature_absence_checks WHERE signature_id=entity;
  RETURN jsonb_build_object('id',entity,'total',total,'page',pg,'realActivationEligible',false,
   'rows',(SELECT coalesce(jsonb_agg(v ORDER BY created_at DESC,id),'[]') FROM (SELECT x.id,x.created_at,to_jsonb(x)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(x.actor_id),'outcome',(SELECT to_jsonb(y) FROM public.platform_sales_signature_absence_results y WHERE y.check_id=x.id),'resolution',(SELECT to_jsonb(z)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(z.actor_id),'events',(SELECT jsonb_agg(to_jsonb(ev) ORDER BY version) FROM public.platform_sales_signature_absence_resolution_events ev WHERE ev.resolution_id=z.id)) FROM public.platform_sales_signature_absence_resolutions z WHERE z.check_id=x.id)) v FROM public.platform_sales_signature_absence_checks x WHERE x.signature_id=entity ORDER BY x.created_at DESC,x.id LIMIT 25 OFFSET pg*25)s),
   'diagnostics',(SELECT coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(x.actor_id)) ORDER BY x.created_at),'[]') FROM public.platform_sales_signature_dispatch_diagnostics x JOIN public.platform_sales_signature_attempts t ON t.lease=x.lease WHERE t.signature_id=entity));
 END IF;
 IF p_action='diagnostic' THEN
  IF p_body-ARRAY['id','lease','reason','httpStatus']<>'{}' OR NOT p_body ?& ARRAY['id','lease','reason','httpStatus'] OR p_body->>'reason' NOT IN ('HTTP','NETWORK','TIMEOUT','FORMAT','UNKNOWN') OR jsonb_typeof(p_body->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid diagnostic' USING ERRCODE='22023';END IF;
  SELECT * INTO a FROM public.platform_sales_signature_attempts WHERE lease=(p_body->>'lease')::uuid;
  SELECT * INTO e FROM public.platform_sales_signature_attempt_events WHERE lease=a.lease ORDER BY version DESC LIMIT 1;
  IF a.signature_id IS DISTINCT FROM entity OR a.actor_id<>p_actor OR e.state IS DISTINCT FROM 'UNKNOWN' THEN RAISE EXCEPTION 'Diagnostic unavailable' USING ERRCODE='23505';END IF;
  IF EXISTS(SELECT 1 FROM public.platform_sales_signature_dispatch_diagnostics WHERE lease=a.lease) THEN RAISE EXCEPTION 'Diagnostic already preserved' USING ERRCODE='23505';END IF;
  INSERT INTO public.platform_sales_signature_dispatch_diagnostics VALUES(a.lease,p_body->>'reason',(p_body->>'httpStatus')::integer,p_actor,author,clock_timestamp());
  RETURN jsonb_build_object('recorded',true);
 END IF;
 IF p_action IN ('reject','executionCheck','consume') THEN
  res:=(p_body->>'resolutionId')::uuid;SELECT * INTO r FROM public.platform_sales_signature_absence_resolutions WHERE id=res;
  SELECT * INTO c FROM public.platform_sales_signature_absence_checks WHERE id=r.check_id;
  SELECT * INTO re FROM public.platform_sales_signature_absence_resolution_events WHERE resolution_id=res ORDER BY version DESC LIMIT 1;
  IF c.signature_id IS DISTINCT FROM entity OR re.state IS DISTINCT FROM 'AUTHORIZED' THEN RAISE EXCEPTION 'Authorization unavailable' USING ERRCODE='23505';END IF;
  IF r.created_at<clock_timestamp()-interval '10 minutes' AND p_action<>'reject' THEN RAISE EXCEPTION 'Authorization expired' USING ERRCODE='23505';END IF;
 ELSE
  IF p_action='authorize' THEN SELECT * INTO c FROM public.platform_sales_signature_absence_checks WHERE id=(p_body->>'checkId')::uuid;
  ELSIF p_action='complete' THEN SELECT * INTO c FROM public.platform_sales_signature_absence_checks WHERE id=(p_body->>'requestId')::uuid;
  END IF;
 END IF;
 IF p_action IN ('complete','authorize') AND c.signature_id IS DISTINCT FROM entity THEN RAISE EXCEPTION 'Check unavailable' USING ERRCODE='23505';END IF;
 SELECT * INTO a FROM public.platform_sales_signature_attempts WHERE lease=CASE WHEN p_action='begin' THEN (p_body->>'lease')::uuid ELSE c.lease END;
 SELECT * INTO e FROM public.platform_sales_signature_attempt_events WHERE lease=a.lease ORDER BY version DESC LIMIT 1;
 IF a.signature_id IS DISTINCT FROM entity OR a.ordinal IS DISTINCT FROM 1 OR e.state IS DISTINCT FROM 'UNKNOWN'
  OR EXISTS(SELECT 1 FROM public.platform_sales_signature_resources WHERE signature_id=entity)
  OR EXISTS(SELECT 1 FROM public.platform_sales_signature_attempts x CROSS JOIN LATERAL(SELECT state FROM public.platform_sales_signature_attempt_events WHERE lease=x.lease ORDER BY version DESC LIMIT 1)y WHERE x.signature_id=entity AND x.lease<>a.lease AND y.state<>'ABORTED') THEN RAISE EXCEPTION 'Uncertain envelope no longer eligible' USING ERRCODE='23505';END IF;
 IF p_action IN ('begin','executionCheck') THEN
  IF p_body-(CASE p_action WHEN 'begin' THEN ARRAY['id','lease','requestId','accountKey','justification'] ELSE ARRAY['id','resolutionId','requestId','justification'] END)<>'{}' THEN RAISE EXCEPTION 'Invalid check' USING ERRCODE='22023';END IF;
  req:=(p_body->>'requestId')::uuid;
  IF EXISTS(SELECT 1 FROM public.platform_sales_signature_absence_checks WHERE id=req) THEN RAISE EXCEPTION 'Check consumed; consult history' USING ERRCODE='23505';END IF;
  IF p_action='executionCheck' AND EXISTS(SELECT 1 FROM public.platform_sales_signature_absence_checks WHERE resolution_id=res) THEN RAISE EXCEPTION 'Execution check already consumed' USING ERRCODE='23505';END IF;
  IF jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification'))<20 OR length(p_body->>'justification')>1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid justification' USING ERRCODE='22023';END IF;
  INSERT INTO public.platform_sales_signature_absence_checks VALUES(req,entity,a.lease,CASE p_action WHEN 'begin' THEN (p_body->>'accountKey')::uuid ELSE r.account_key END,p_actor,author,p_body->>'justification',p_body,CASE WHEN p_action='executionCheck' THEN res END,clock_timestamp());
  RETURN jsonb_build_object('id',entity,'lease',a.lease,'accountKey',CASE p_action WHEN 'begin' THEN p_body->>'accountKey' ELSE r.account_key::text END);
 END IF;
 IF p_action='complete' THEN
  IF p_body-ARRAY['id','requestId','proof']<>'{}' OR c.actor_id<>p_actor THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023';END IF;
  proof:=p_body->'proof';
  IF proof IS NULL OR jsonb_typeof(proof)<>'object' OR proof-ARRAY['state','pages','candidateIds','reason']<>'{}' OR NOT proof ?& ARRAY['state','pages','candidateIds','reason'] OR jsonb_typeof(proof->'state') IS DISTINCT FROM 'string' OR proof->>'state' NOT IN ('EMPTY','CANDIDATE','INCOMPLETE') OR jsonb_typeof(proof->'pages') IS DISTINCT FROM 'number' OR proof->>'pages' !~ '^\d{1,2}$' OR (proof->>'pages')::int>20 OR jsonb_typeof(proof->'candidateIds') IS DISTINCT FROM 'array' OR jsonb_array_length(proof->'candidateIds')>100 THEN RAISE EXCEPTION 'Invalid proof' USING ERRCODE='22023';END IF;
  IF proof->>'state'='EMPTY' AND ((proof->>'pages')::int<1 OR proof->'candidateIds'<>'[]' OR proof->'reason'<>'null') OR proof->>'state'='CANDIDATE' AND ((proof->>'pages')::int<1 OR jsonb_array_length(proof->'candidateIds')<1 OR proof->'reason'<>'null') OR proof->>'state'='INCOMPLETE' AND (jsonb_typeof(proof->'reason') IS DISTINCT FROM 'string' OR proof->>'reason' NOT IN ('HTTP','NETWORK','TIMEOUT','FORMAT','PAGINATION') OR proof->'candidateIds'<>'[]') THEN RAISE EXCEPTION 'Inconsistent proof' USING ERRCODE='22023';END IF;
  PERFORM value::uuid FROM jsonb_array_elements_text(proof->'candidateIds');
  IF EXISTS(SELECT 1 FROM public.platform_sales_signature_absence_results WHERE check_id=c.id) THEN RAISE EXCEPTION 'Result already preserved' USING ERRCODE='23505';END IF;
  INSERT INTO public.platform_sales_signature_absence_results VALUES(c.id,proof,p_actor,author,clock_timestamp());
  RETURN jsonb_build_object('state',proof->>'state','realActivationEligible',false);
 END IF;
 IF p_action='authorize' THEN
  IF p_body-ARRAY['id','checkId','resolutionId','providerReference','accountKey','justification']<>'{}' OR jsonb_typeof(p_body->'providerReference') IS DISTINCT FROM 'string' OR p_body->>'providerReference' !~ '^[-a-zA-Z0-9_./: ]{8,160}$' OR (p_body->>'accountKey')::uuid IS DISTINCT FROM c.account_key OR c.created_at<clock_timestamp()-interval '10 minutes' OR c.resolution_id IS NOT NULL THEN RAISE EXCEPTION 'Confirmation unavailable' USING ERRCODE='23505';END IF;
  SELECT x.proof INTO proof FROM public.platform_sales_signature_absence_results x WHERE check_id=c.id;
  IF proof->>'state' IS DISTINCT FROM 'EMPTY' THEN RAISE EXCEPTION 'Absence not established' USING ERRCODE='23505';END IF;
  IF jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification'))<20 OR length(p_body->>'justification')>1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid justification' USING ERRCODE='22023';END IF;
  res:=(p_body->>'resolutionId')::uuid;
  INSERT INTO public.platform_sales_signature_absence_resolutions VALUES(res,c.id,a.lease,c.account_key,p_body->>'providerReference',p_actor,author,p_body->>'justification',clock_timestamp());
  INSERT INTO public.platform_sales_signature_absence_resolution_events VALUES(res,1,'AUTHORIZED',null,null,p_actor,author,p_body->>'justification',clock_timestamp());
  RETURN jsonb_build_object('state','AUTHORIZED','realActivationEligible',false);
 END IF;
 IF p_action IN ('reject','consume') THEN
  IF p_body-(CASE p_action WHEN 'reject' THEN ARRAY['id','resolutionId','justification'] ELSE ARRAY['id','resolutionId','requestId','lease','justification'] END)<>'{}' OR jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification'))<20 OR length(p_body->>'justification')>1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid resolution' USING ERRCODE='22023';END IF;
  IF p_action='reject' THEN
   INSERT INTO public.platform_sales_signature_absence_resolution_events VALUES(res,re.version+1,'REJECTED',null,null,p_actor,author,p_body->>'justification',clock_timestamp());
   RETURN jsonb_build_object('state','REJECTED');
  END IF;
  SELECT * INTO c FROM public.platform_sales_signature_absence_checks WHERE id=(p_body->>'requestId')::uuid;
  SELECT x.proof INTO proof FROM public.platform_sales_signature_absence_results x WHERE check_id=c.id;
  IF c.signature_id IS DISTINCT FROM entity OR c.resolution_id IS DISTINCT FROM res OR c.actor_id<>p_actor OR c.account_key<>r.account_key OR c.created_at<clock_timestamp()-interval '30 seconds' OR proof->>'state' IS DISTINCT FROM 'EMPTY' THEN RAISE EXCEPTION 'Fresh complete proof required' USING ERRCODE='23505';END IF;
  -- Both the exceptional resolution and ordinary claim use the same advisory lock and transaction.
  INSERT INTO public.platform_sales_signature_attempt_events VALUES(a.lease,e.version+1,'ABORTED',jsonb_build_object('absenceResolution',res,'checkId',c.id),p_actor,author,clock_timestamp());
  claim:=public.platform_sales_signature_dispatch_action(p_actor,'claim',jsonb_build_object('id',entity,'lease',p_body->>'lease','expectedOrdinal',1,'justification',p_body->>'justification'));
  INSERT INTO public.platform_sales_signature_absence_resolution_events VALUES(res,re.version+1,'USED',c.id,(p_body->>'lease')::uuid,p_actor,author,p_body->>'justification',clock_timestamp());
  RETURN claim;
 END IF;
 RAISE EXCEPTION 'Unhandled action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signature_absence_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_signature_absence_action(uuid,text,jsonb) TO service_role;
COMMIT;
