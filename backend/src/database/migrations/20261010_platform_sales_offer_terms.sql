BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Internal terms only. No customer acceptance, contract, payment or license writes.
CREATE TABLE IF NOT EXISTS public.platform_sales_offer_terms(
 proposal_id uuid NOT NULL REFERENCES public.platform_sales_proposals(id), revision integer NOT NULL CHECK(revision>0),
 definition jsonb NOT NULL, actor_id uuid NOT NULL, actor_name text, justification text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), request_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(proposal_id,revision)
);
CREATE TABLE IF NOT EXISTS public.platform_sales_offer_term_events(
 proposal_id uuid NOT NULL, revision integer NOT NULL, version integer NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN ('DRAFT','CHECKED','APPROVED_INTERNAL')),
 actor_id uuid NOT NULL, actor_name text, justification text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), request_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(proposal_id,revision,version), FOREIGN KEY(proposal_id,revision) REFERENCES public.platform_sales_offer_terms(proposal_id,revision)
);
ALTER TABLE public.platform_sales_offer_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sales_offer_term_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_sales_offer_terms,public.platform_sales_offer_term_events FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_offer_terms','platform_sales_offer_term_events'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.platform_sales_offer_actor_name(p_actor uuid) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RETURN public.platform_sales_actor_name(p_actor);
EXCEPTION WHEN undefined_table OR undefined_column THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_offer_actor_name(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.validate_platform_sales_offer_terms(p_definition jsonb,p_snapshot jsonb,p_complete boolean)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE k text; expiry date;
BEGIN
 IF p_definition IS NULL OR jsonb_typeof(p_definition)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_definition))<>7 OR
 EXISTS(SELECT 1 FROM jsonb_object_keys(p_definition) x WHERE x NOT IN ('validUntil','contractTerm','paymentTerms','implementationTerms','supportTerms','renewalCancellationTerms','exclusions')) THEN RAISE EXCEPTION 'Invalid terms' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_definition) LOOP
  IF jsonb_typeof(p_definition->k)<>'string' OR length(p_definition->>k)>1000 OR (p_complete AND length(btrim(p_definition->>k))<5) THEN RAISE EXCEPTION 'Incomplete or invalid terms' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_definition->>'validUntil'<>'' THEN
  IF p_definition->>'validUntil' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid validity' USING ERRCODE='22023'; END IF;
  expiry:=(p_definition->>'validUntil')::date;
  IF expiry>(p_snapshot->'policy'->>'ends')::date OR expiry<(p_snapshot->'policy'->>'starts')::date THEN RAISE EXCEPTION 'Validity outside price policy' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_complete AND (expiry IS NULL OR expiry<(now() AT TIME ZONE 'UTC')::date OR (now() AT TIME ZONE 'UTC')::date NOT BETWEEN (p_snapshot->'policy'->>'starts')::date AND (p_snapshot->'policy'->>'ends')::date) THEN RAISE EXCEPTION 'Expired offer or prices' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.validate_platform_sales_offer_terms(jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.save_platform_sales_offer_terms(p_actor uuid,p_request uuid,p_proposal uuid,p_expected integer,p_definition jsonb,p_justification text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE approved jsonb; saved public.platform_sales_offer_terms; latest integer; author text;
BEGIN
 approved:=public.read_platform_sales_approved_proposal(p_actor,p_proposal);
 IF p_request IS NULL OR p_expected IS NULL OR p_expected<0 OR p_justification IS NULL OR length(btrim(p_justification)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Invalid revision' USING ERRCODE='22023'; END IF;
 PERFORM public.validate_platform_sales_offer_terms(p_definition,approved->'snapshot',false);
 PERFORM pg_advisory_xact_lock(hashtextextended('commercial-offer:'||p_proposal::text,0));
 SELECT * INTO saved FROM public.platform_sales_offer_terms WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.actor_id<>p_actor OR saved.proposal_id<>p_proposal OR saved.revision<>p_expected+1 OR saved.definition<>p_definition OR saved.justification<>p_justification THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='P3611'; END IF;
  RETURN to_jsonb(saved);
 END IF;
 SELECT coalesce(max(revision),0) INTO latest FROM public.platform_sales_offer_terms WHERE proposal_id=p_proposal;
 IF latest<>p_expected THEN RAISE EXCEPTION 'Revision changed' USING ERRCODE='P3611'; END IF;
 author:=public.platform_sales_offer_actor_name(p_actor);
 INSERT INTO public.platform_sales_offer_terms VALUES(p_proposal,latest+1,p_definition,p_actor,author,p_justification,now(),p_request) RETURNING * INTO saved;
 INSERT INTO public.platform_sales_offer_term_events VALUES(p_proposal,latest+1,1,'DRAFT',p_actor,author,p_justification,now(),p_request);
 RETURN to_jsonb(saved);
END $$;
CREATE OR REPLACE FUNCTION public.review_platform_sales_offer_terms(p_actor uuid,p_request uuid,p_proposal uuid,p_revision integer,p_expected integer,p_status text,p_justification text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE approved jsonb; terms public.platform_sales_offer_terms; current_event public.platform_sales_offer_term_events; saved public.platform_sales_offer_term_events;
BEGIN
 approved:=public.read_platform_sales_approved_proposal(p_actor,p_proposal);
 IF p_request IS NULL OR p_revision IS NULL OR p_expected IS NULL OR p_expected<1 OR p_status IS NULL OR p_justification IS NULL OR length(btrim(p_justification)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('commercial-offer:'||p_proposal::text,0));
 SELECT * INTO saved FROM public.platform_sales_offer_term_events WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.actor_id<>p_actor OR saved.proposal_id<>p_proposal OR saved.revision<>p_revision OR saved.version<>p_expected+1 OR saved.status<>p_status OR saved.justification<>p_justification THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='P3611'; END IF;
  RETURN to_jsonb(saved);
 END IF;
 SELECT * INTO terms FROM public.platform_sales_offer_terms WHERE proposal_id=p_proposal AND revision=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'Terms missing' USING ERRCODE='P3610'; END IF;
 IF p_revision<>(SELECT max(revision) FROM public.platform_sales_offer_terms WHERE proposal_id=p_proposal) THEN RAISE EXCEPTION 'Newer revision exists' USING ERRCODE='P3611'; END IF;
 SELECT * INTO current_event FROM public.platform_sales_offer_term_events WHERE proposal_id=p_proposal AND revision=p_revision ORDER BY version DESC LIMIT 1;
 IF current_event.version IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Review changed' USING ERRCODE='P3611'; END IF;
 IF NOT ((current_event.status='DRAFT' AND p_status='CHECKED') OR (current_event.status='CHECKED' AND p_status='APPROVED_INTERNAL')) THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
 PERFORM public.validate_platform_sales_offer_terms(terms.definition,approved->'snapshot',true);
 INSERT INTO public.platform_sales_offer_term_events VALUES(p_proposal,p_revision,p_expected+1,p_status,p_actor,public.platform_sales_offer_actor_name(p_actor),p_justification,now(),p_request) RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;
CREATE OR REPLACE FUNCTION public.read_platform_sales_offer_terms(p_actor uuid,p_proposal uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE approved jsonb; revisions jsonb;
BEGIN
 approved:=public.read_platform_sales_approved_proposal(p_actor,p_proposal);
 SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('expired',CASE WHEN t.definition->>'validUntil'='' THEN NULL ELSE (t.definition->>'validUntil')::date<(now() AT TIME ZONE 'UTC')::date END,'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY version) FROM public.platform_sales_offer_term_events e WHERE e.proposal_id=t.proposal_id AND e.revision=t.revision)) ORDER BY t.revision DESC),'[]'::jsonb)
 INTO revisions FROM (SELECT * FROM public.platform_sales_offer_terms WHERE proposal_id=p_proposal ORDER BY revision DESC LIMIT 50) t;
 RETURN jsonb_build_object('proposal',approved,'revisions',revisions,'asOfDate',(now() AT TIME ZONE 'UTC')::date);
END $$;
REVOKE ALL ON FUNCTION public.save_platform_sales_offer_terms(uuid,uuid,uuid,integer,jsonb,text),public.review_platform_sales_offer_terms(uuid,uuid,uuid,integer,integer,text,text),public.read_platform_sales_offer_terms(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_platform_sales_offer_terms(uuid,uuid,uuid,integer,jsonb,text),public.review_platform_sales_offer_terms(uuid,uuid,uuid,integer,integer,text,text),public.read_platform_sales_offer_terms(uuid,uuid) TO service_role;
COMMIT;
