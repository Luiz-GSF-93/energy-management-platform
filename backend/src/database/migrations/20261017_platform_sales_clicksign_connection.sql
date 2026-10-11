BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.platform_sales_clicksign_connections (
 request_id uuid PRIMARY KEY,account_id text NOT NULL CHECK(account_id ~ '^[1-9][0-9]{0,11}$'),
 environment text NOT NULL DEFAULT 'PRODUCTION' CHECK(environment='PRODUCTION'),
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,input jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_clicksign_connection_results (
 request_id uuid PRIMARY KEY REFERENCES public.platform_sales_clicksign_connections(request_id),
 state text NOT NULL CHECK(state IN ('AUTHENTICATED','REJECTED','INCOMPLETE')),
 diagnostic text NOT NULL CHECK(diagnostic IN ('OK','HTTP','NETWORK','TIMEOUT','FORMAT','OVERSIZE')),
 http_status integer CHECK(http_status BETWEEN 100 AND 599),actor_id uuid NOT NULL,actor_name text,
 CHECK(http_status IS NOT NULL OR state='INCOMPLETE'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='AUTHENTICATED' AND diagnostic='OK' AND http_status=200) OR
 (state='REJECTED' AND diagnostic='HTTP' AND http_status IN (401,403)) OR
 (state='INCOMPLETE' AND diagnostic<>'OK'))
);
CREATE INDEX clicksign_connections_recent ON public.platform_sales_clicksign_connections(account_id,created_at DESC,request_id DESC);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_clicksign_connections','platform_sales_clicksign_connection_results'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;
CREATE FUNCTION public.platform_sales_clicksign_connection_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE req uuid;account text;author text;page integer;c public.platform_sales_clicksign_connections;r public.platform_sales_clicksign_connection_results;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.user_roles u JOIN public.roles x ON x.id=u.role_id JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text WHERE u.user_id::text=p_actor::text FOR SHARE OF u,x,t;
 PERFORM public.platform_team_owner(p_actor);
 IF p_action IS NULL OR p_action NOT IN ('list','begin','complete') OR p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>5000 THEN RAISE EXCEPTION 'Invalid connection' USING ERRCODE='22023';END IF;
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action='list' THEN
  IF p_body-ARRAY['accountId','page']<>'{}' OR NOT p_body ?& ARRAY['accountId','page'] OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' THEN RAISE EXCEPTION 'Invalid list' USING ERRCODE='22023';END IF;
  account:=p_body->>'accountId';page:=(p_body->>'page')::integer;
  IF jsonb_typeof(p_body->'accountId') IS DISTINCT FROM 'string' OR account !~ '^[1-9][0-9]{0,11}$' OR page>1000 THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('environment','PRODUCTION','accountIdentityVerified',false,'realActivationEligible',false,'page',page,'total',(SELECT count(*) FROM public.platform_sales_clicksign_connections WHERE account_id=account),'rows',(SELECT coalesce(jsonb_agg(to_jsonb(x)-'input'||jsonb_build_object('currentActorName',public.platform_sales_finance_name(x.actor_id),'result',(SELECT to_jsonb(z)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(z.actor_id)) FROM public.platform_sales_clicksign_connection_results z WHERE z.request_id=x.request_id)) ORDER BY x.created_at DESC,x.request_id DESC),'[]') FROM(SELECT * FROM public.platform_sales_clicksign_connections WHERE account_id=account ORDER BY created_at DESC,request_id DESC LIMIT 25 OFFSET page*25)x));
 END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('clicksign-connection-request:'||req::text,0));
 SELECT * INTO c FROM public.platform_sales_clicksign_connections WHERE request_id=req;
 IF p_action='begin' THEN
  IF p_body-ARRAY['requestId','accountId','justification']<>'{}' OR NOT p_body ?& ARRAY['requestId','accountId','justification'] OR jsonb_typeof(p_body->'accountId') IS DISTINCT FROM 'string' OR p_body->>'accountId' !~ '^[1-9][0-9]{0,11}$' OR jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification'))<20 OR length(p_body->>'justification')>1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  IF c.request_id IS NOT NULL THEN
   IF c.actor_id<>p_actor OR c.input<>p_body THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;
   SELECT * INTO r FROM public.platform_sales_clicksign_connection_results WHERE request_id=req;
   RETURN jsonb_build_object('requestId',req,'replayed',true,'state',coalesce(r.state,'PENDING'),'accountIdentityVerified',false,'realActivationEligible',false);
  END IF;
  -- Serialize all production checks: the token is platform-wide, not selected by accountId.
  PERFORM pg_advisory_xact_lock(hashtextextended('clicksign-production-connection',0));
  IF EXISTS(SELECT 1 FROM public.platform_sales_clicksign_connections x WHERE x.created_at>clock_timestamp()-interval '60 seconds' AND NOT EXISTS(SELECT 1 FROM public.platform_sales_clicksign_connection_results y WHERE y.request_id=x.request_id)) THEN RAISE EXCEPTION 'Check pending' USING ERRCODE='23505';END IF;
  INSERT INTO public.platform_sales_clicksign_connections(request_id,account_id,actor_id,actor_name,justification,input) VALUES(req,p_body->>'accountId',p_actor,author,p_body->>'justification',p_body);
  RETURN jsonb_build_object('requestId',req,'replayed',false,'environment','PRODUCTION','accountIdentityVerified',false,'realActivationEligible',false);
 END IF;
 IF p_body-ARRAY['requestId','state','diagnostic','httpStatus']<>'{}' OR NOT p_body ?& ARRAY['requestId','state','diagnostic','httpStatus'] OR jsonb_typeof(p_body->'state') IS DISTINCT FROM 'string' OR jsonb_typeof(p_body->'diagnostic') IS DISTINCT FROM 'string' OR p_body->>'state' NOT IN ('AUTHENTICATED','REJECTED','INCOMPLETE') OR p_body->>'diagnostic' NOT IN ('OK','HTTP','NETWORK','TIMEOUT','FORMAT','OVERSIZE') OR p_body->'httpStatus'<>'null'::jsonb AND (jsonb_typeof(p_body->'httpStatus') IS DISTINCT FROM 'number' OR p_body->>'httpStatus' !~ '^[1-5][0-9]{2}$') THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023';END IF;
 IF c.request_id IS NULL OR c.actor_id<>p_actor THEN RAISE EXCEPTION 'Check unavailable' USING ERRCODE='23505';END IF;
 SELECT * INTO r FROM public.platform_sales_clicksign_connection_results WHERE request_id=req;
 IF r.request_id IS NOT NULL THEN
  IF r.state IS DISTINCT FROM p_body->>'state' OR r.diagnostic IS DISTINCT FROM p_body->>'diagnostic' OR r.http_status IS DISTINCT FROM (p_body->>'httpStatus')::integer THEN RAISE EXCEPTION 'Conflicting result' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('requestId',req,'state',r.state,'replayed',true,'accountIdentityVerified',false,'realActivationEligible',false);
 END IF;
 INSERT INTO public.platform_sales_clicksign_connection_results(request_id,state,diagnostic,http_status,actor_id,actor_name) VALUES(req,p_body->>'state',p_body->>'diagnostic',(p_body->>'httpStatus')::integer,p_actor,author);
 RETURN jsonb_build_object('requestId',req,'state',p_body->>'state','accountIdentityVerified',false,'realActivationEligible',false);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_clicksign_connection_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_clicksign_connection_action(uuid,text,jsonb) TO service_role;
COMMIT;
