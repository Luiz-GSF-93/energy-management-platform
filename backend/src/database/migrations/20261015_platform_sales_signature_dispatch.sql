BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.platform_sales_signature_attempts (
 lease uuid PRIMARY KEY,signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 8),step text NOT NULL,
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.platform_sales_signature_attempt_events (
 lease uuid NOT NULL REFERENCES public.platform_sales_signature_attempts(lease),version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('CLAIMED','RESERVED','ABORTED','UNKNOWN','VERIFIED')),
 result jsonb,actor_id uuid NOT NULL,actor_name text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(lease,version)
);
CREATE INDEX signature_attempts_by_request ON public.platform_sales_signature_attempts(signature_id,created_at,lease);
CREATE TABLE public.platform_sales_signature_resources (
 signature_id uuid NOT NULL REFERENCES public.platform_sales_signature_requests(id),ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 8),
 lease uuid NOT NULL UNIQUE REFERENCES public.platform_sales_signature_attempts(lease),external_id uuid NOT NULL,type text NOT NULL,
 PRIMARY KEY(signature_id,ordinal),UNIQUE(type,external_id)
);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_signature_attempts','platform_sales_signature_attempt_events','platform_sales_signature_resources'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;
-- Withdrawal cannot race a reserved POST or hide resources already created.
CREATE FUNCTION public.platform_sales_signature_withdraw_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.state='WITHDRAWN' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-signature:'||NEW.signature_id::text,0));
  IF EXISTS(SELECT 1 FROM public.platform_sales_signature_attempts a CROSS JOIN LATERAL(SELECT state FROM public.platform_sales_signature_attempt_events WHERE lease=a.lease ORDER BY version DESC LIMIT 1)e WHERE a.signature_id=NEW.signature_id AND e.state<>'ABORTED') THEN RAISE EXCEPTION 'Creation already started; reconcile before withdrawal' USING ERRCODE='23505';END IF;
 END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signature_withdraw_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER signature_withdraw_guard BEFORE INSERT ON public.platform_sales_signature_events FOR EACH ROW EXECUTE FUNCTION public.platform_sales_signature_withdraw_guard();
CREATE FUNCTION public.platform_sales_signature_dispatch_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE r public.platform_sales_signature_requests;d public.platform_sales_contract_drafts;
 a public.platform_sales_signature_attempts;e public.platform_sales_signature_attempt_events;
 entity uuid;token uuid;author text;n integer;deps jsonb;v jsonb;kind text;
 steps text[]:=ARRAY['ENVELOPE','DOCUMENT','SUPPLIER','CUSTOMER','QUAL_SUPPLIER','AUTH_SUPPLIER','QUAL_CUSTOMER','AUTH_CUSTOMER'];
BEGIN
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>5000 OR p_action IS NULL OR p_action NOT IN ('read','claim','reserve','abort','finish') THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 entity:=(p_body->>'id')::uuid;
 -- Existing RPC rechecks Owner authority and holds role locks through this transaction.
 PERFORM public.platform_sales_signature_action(p_actor,'read',jsonb_build_object('id',entity));
 author:=public.platform_sales_finance_name(p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-signature:'||entity::text,0));
 SELECT * INTO r FROM public.platform_sales_signature_requests WHERE id=entity;
 SELECT coalesce(max(ordinal),0)+1 INTO n FROM public.platform_sales_signature_resources WHERE signature_id=entity;
 IF p_action='read' THEN
  IF p_body-ARRAY['id']<>'{}' THEN RAISE EXCEPTION 'Invalid read' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('id',entity,'nextOrdinal',n,'completed',n=9,'realActivationEligible',false,'envelopeActivated',false,
   'blocked',EXISTS(SELECT 1 FROM public.platform_sales_signature_attempts x CROSS JOIN LATERAL(SELECT state FROM public.platform_sales_signature_attempt_events WHERE lease=x.lease ORDER BY version DESC LIMIT 1)y WHERE x.signature_id=entity AND y.state IN ('CLAIMED','RESERVED','UNKNOWN')),
   'resources',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY ordinal),'[]') FROM public.platform_sales_signature_resources x WHERE signature_id=entity),
   'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(x.actor_id),'events',(SELECT jsonb_agg(to_jsonb(z) ORDER BY version) FROM public.platform_sales_signature_attempt_events z WHERE z.lease=x.lease)) ORDER BY created_at),'[]') FROM public.platform_sales_signature_attempts x WHERE signature_id=entity));
 END IF;
 token:=(p_body->>'lease')::uuid;IF token IS NULL THEN RAISE EXCEPTION 'Lease required' USING ERRCODE='22023';END IF;
 IF p_action IN ('claim','reserve') THEN
  SELECT * INTO d FROM public.platform_sales_contract_drafts WHERE id=r.draft_id FOR SHARE;
  IF (SELECT state FROM public.platform_sales_signature_events WHERE signature_id=entity ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'PREPARED'
   OR d.sha256 IS DISTINCT FROM r.draft_sha256 OR encode(sha256(d.pdf),'hex') IS DISTINCT FROM r.draft_sha256
   OR (SELECT status FROM public.platform_sales_contract_events WHERE draft_id=d.id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL'
   OR (SELECT status FROM public.platform_sales_proposal_events WHERE proposal_id=r.proposal_id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL'
   OR (r.snapshot#>>'{terms,definition,validUntil}')::date<CURRENT_DATE THEN RAISE EXCEPTION 'Source no longer eligible' USING ERRCODE='23505';END IF;
 END IF;
 IF p_action='claim' THEN
  IF p_body-ARRAY['id','lease','expectedOrdinal','justification']<>'{}' OR NOT p_body ?& ARRAY['id','lease','expectedOrdinal','justification'] OR jsonb_typeof(p_body->'expectedOrdinal') IS DISTINCT FROM 'number' OR p_body->>'expectedOrdinal' !~ '^[1-8]$' OR jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification'))<20 OR length(p_body->>'justification')>1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='22023';END IF;
  IF n<> (p_body->>'expectedOrdinal')::integer OR n>8 OR EXISTS(SELECT 1 FROM public.platform_sales_signature_attempts x CROSS JOIN LATERAL(SELECT state FROM public.platform_sales_signature_attempt_events WHERE lease=x.lease ORDER BY version DESC LIMIT 1)y WHERE x.signature_id=entity AND y.state IN ('CLAIMED','RESERVED','UNKNOWN')) THEN RAISE EXCEPTION 'Stale or uncertain attempt' USING ERRCODE='23505';END IF;
  INSERT INTO public.platform_sales_signature_attempts VALUES(token,entity,n,steps[n],p_actor,author,p_body->>'justification',clock_timestamp());
  INSERT INTO public.platform_sales_signature_attempt_events VALUES(token,1,'CLAIMED',null,p_actor,author,clock_timestamp());
  SELECT coalesce(jsonb_object_agg(CASE ordinal WHEN 1 THEN 'envelope' WHEN 2 THEN 'document' WHEN 3 THEN 'supplier' WHEN 4 THEN 'customer' END,external_id),'{}') INTO deps FROM public.platform_sales_signature_resources WHERE signature_id=entity AND ordinal<=4;
  v:=jsonb_build_object('draftSha256',r.draft_sha256,'parties',r.snapshot->'parties');
  IF n=2 THEN v:=v||jsonb_build_object('pdfHex',encode(d.pdf,'hex'));END IF;
  RETURN jsonb_build_object('id',entity,'lease',token,'ordinal',n,'step',steps[n],'source',v,'dependencies',deps);
 END IF;
 SELECT * INTO a FROM public.platform_sales_signature_attempts WHERE lease=token;
 IF a.lease IS NULL OR a.signature_id<>entity OR a.actor_id<>p_actor THEN RAISE EXCEPTION 'Attempt unavailable' USING ERRCODE='23505';END IF;
 SELECT * INTO e FROM public.platform_sales_signature_attempt_events WHERE lease=token ORDER BY version DESC LIMIT 1;
 IF p_action IN ('reserve','abort') THEN
  IF p_body-ARRAY['id','lease']<>'{}' THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023';END IF;
  IF e.state<>'CLAIMED' THEN RAISE EXCEPTION 'Attempt already consumed' USING ERRCODE='23505';END IF;
  INSERT INTO public.platform_sales_signature_attempt_events VALUES(token,e.version+1,CASE p_action WHEN 'reserve' THEN 'RESERVED' ELSE 'ABORTED' END,null,p_actor,author,clock_timestamp());
 ELSE
  IF p_body-ARRAY['id','lease','result']<>'{}' OR NOT p_body ? 'result' THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023';END IF;
  v:=p_body->'result';
  IF e.state IN ('VERIFIED','UNKNOWN') AND e.result IS NOT DISTINCT FROM v THEN RETURN jsonb_build_object('state',e.state,'replayed',true);END IF;
  IF e.state<>'RESERVED' THEN RAISE EXCEPTION 'Reservation required' USING ERRCODE='23505';END IF;
  IF v<>'null'::jsonb THEN
   kind:=CASE a.ordinal WHEN 1 THEN 'envelopes' WHEN 2 THEN 'documents' WHEN 3 THEN 'signers' WHEN 4 THEN 'signers' ELSE 'requirements' END;
   IF jsonb_typeof(v)<>'object' OR v-ARRAY['externalId','type']<>'{}' OR NOT v ?& ARRAY['externalId','type'] OR v->>'type' IS DISTINCT FROM kind THEN RAISE EXCEPTION 'Invalid resource proof' USING ERRCODE='22023';END IF;
   INSERT INTO public.platform_sales_signature_resources VALUES(entity,a.ordinal,token,(v->>'externalId')::uuid,kind);
  END IF;
  INSERT INTO public.platform_sales_signature_attempt_events VALUES(token,e.version+1,CASE WHEN v='null'::jsonb THEN 'UNKNOWN' ELSE 'VERIFIED' END,v,p_actor,author,clock_timestamp());
 END IF;
 RETURN jsonb_build_object('id',entity,'state',CASE WHEN p_action='reserve' THEN 'RESERVED' WHEN p_action='abort' THEN 'ABORTED' WHEN v='null'::jsonb THEN 'UNKNOWN' ELSE 'VERIFIED' END,'realActivationEligible',false);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_signature_dispatch_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_signature_dispatch_action(uuid,text,jsonb) TO service_role;
COMMIT;
