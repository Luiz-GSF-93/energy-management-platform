BEGIN;
SET LOCAL lock_timeout='5s';
-- Access stores only hashes. No organization account is created for a prospect.
CREATE TABLE IF NOT EXISTS public.platform_sales_access(
 receipt uuid PRIMARY KEY REFERENCES public.platform_sales_leads(receipt) ON DELETE CASCADE,
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', revoked_at timestamptz,
 verified_at timestamptz, challenge_id uuid, code_hash text, code_expires_at timestamptz,
 calls integer NOT NULL DEFAULT 0, window_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0, sends integer NOT NULL DEFAULT 0, last_sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.platform_sales_suggestions(
 id uuid PRIMARY KEY, receipt uuid NOT NULL REFERENCES public.platform_sales_leads(receipt) ON DELETE CASCADE,
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(receipt,id)
);
CREATE INDEX IF NOT EXISTS sales_suggestions_receipt_date ON public.platform_sales_suggestions(receipt,created_at DESC,id);
CREATE TABLE IF NOT EXISTS public.platform_sales_journey_events(
 id uuid PRIMARY KEY, receipt uuid NOT NULL, suggestion_id uuid, kind text NOT NULL
 CHECK(kind IN ('RECOMMENDED','CONTACT_VERIFIED','ACCEPTED','OWNER_APPROVED','MANUAL_REVIEW','REVOKED')),
 actor_id uuid, evidence jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_journey_receipt_date ON public.platform_sales_journey_events(receipt,created_at DESC,id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_suggestion_decisions ON public.platform_sales_journey_events(suggestion_id,kind) WHERE kind IN ('ACCEPTED','OWNER_APPROVED');
CREATE TABLE IF NOT EXISTS public.platform_sales_journey_outbox(
 id uuid PRIMARY KEY,receipt uuid NOT NULL REFERENCES public.platform_sales_leads(receipt) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ACCEPTED','UNKNOWN','REJECTED')),
 created_at timestamptz NOT NULL DEFAULT now(),provider_id text,diagnostic text
);
CREATE INDEX IF NOT EXISTS sales_journey_outbox_receipt ON public.platform_sales_journey_outbox(receipt);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_access','platform_sales_suggestions','platform_sales_journey_events','platform_sales_journey_outbox'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
-- Audit events have no contact payload and remain preserved after contact erasure.
DROP TRIGGER IF EXISTS journey_events_immutable ON public.platform_sales_journey_events;
CREATE TRIGGER journey_events_immutable BEFORE UPDATE OR DELETE ON public.platform_sales_journey_events FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable();
DROP TRIGGER IF EXISTS sales_suggestion_immutable ON public.platform_sales_suggestions;
CREATE TRIGGER sales_suggestion_immutable BEFORE UPDATE OR DELETE ON public.platform_sales_suggestions FOR EACH ROW EXECUTE FUNCTION public.platform_sales_intake_immutable();
CREATE OR REPLACE FUNCTION public.assert_platform_sales_access(p_receipt uuid,p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM public.platform_sales_access a JOIN public.platform_sales_leads l USING(receipt) WHERE a.receipt=p_receipt AND a.token_hash=p_token AND a.expires_at>now() AND a.revoked_at IS NULL) THEN RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501'; END IF;
 UPDATE public.platform_sales_access SET calls=CASE WHEN window_at<now()-interval '1 hour' THEN 1 ELSE calls+1 END,window_at=CASE WHEN window_at<now()-interval '1 hour' THEN now() ELSE window_at END WHERE receipt=p_receipt AND (window_at<now()-interval '1 hour' OR calls<240);
 IF NOT FOUND THEN RAISE EXCEPTION 'Journey request limit' USING ERRCODE='P3602'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.submit_platform_sales_journey(p_receipt uuid,p_payload jsonb,p_hash text,p_requester text,p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid access' USING ERRCODE='22023'; END IF;
 PERFORM public.submit_platform_sales_lead(p_receipt,p_payload,p_hash,p_requester);
 INSERT INTO public.platform_sales_access(receipt,token_hash) VALUES(p_receipt,p_token) ON CONFLICT(receipt) DO NOTHING;
 PERFORM public.assert_platform_sales_access(p_receipt,p_token);
 RETURN jsonb_build_object('receipt',p_receipt);
END $$;
CREATE OR REPLACE FUNCTION public.sales_journey_context(p_receipt uuid,p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lead jsonb; plans jsonb; policies jsonb;
BEGIN
 PERFORM public.assert_platform_sales_access(p_receipt,p_token);
 SELECT payload-'email'-'name'-'cnpj'-'company'-'phone'-'jobTitle' INTO lead FROM public.platform_sales_leads WHERE receipt=p_receipt;
 SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') INTO plans FROM public.plan_catalog c WHERE active;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO policies FROM (SELECT DISTINCT ON(s.plan_id) s.* FROM public.platform_sales_policies s JOIN public.plan_catalog c ON c.id=s.plan_id AND c.version=s.plan_version AND c.active WHERE ((now() AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN (definition->>'starts')::date AND (definition->>'ends')::date ORDER BY s.plan_id,s.version DESC) q;
 RETURN jsonb_build_object('profile',lead,'plans',plans,'policies',policies);
END $$;
CREATE OR REPLACE FUNCTION public.preserve_sales_suggestion(p_id uuid,p_receipt uuid,p_token text,p_plan uuid,p_policy integer,p_cycle text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_snapshot jsonb; saved public.platform_sales_suggestions;
BEGIN
 PERFORM public.assert_platform_sales_access(p_receipt,p_token);
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-journey:'||p_receipt::text,0));
 v_snapshot:=public.build_platform_sales_snapshot(p_receipt,p_plan,p_policy,p_cycle,'[]','Sugestão EVA conforme perfil e política vigente.');
 IF (v_snapshot->>'solarReviewRequired')::boolean THEN RAISE EXCEPTION 'Solar review required' USING ERRCODE='22023'; END IF;
 SELECT * INTO saved FROM public.platform_sales_suggestions WHERE receipt=p_receipt AND platform_sales_suggestions.snapshot=v_snapshot ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND THEN
  INSERT INTO public.platform_sales_suggestions(id,receipt,snapshot) VALUES(p_id,p_receipt,v_snapshot) RETURNING * INTO saved;
  INSERT INTO public.platform_sales_journey_events(id,receipt,suggestion_id,kind) VALUES(p_id,p_receipt,p_id,'RECOMMENDED');
 END IF;
 RETURN jsonb_build_object('id',saved.id,'snapshot',saved.snapshot,'createdAt',saved.created_at);
END $$;
CREATE OR REPLACE FUNCTION public.sales_contact_challenge(p_receipt uuid,p_token text,p_id uuid,p_code_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.platform_sales_access; email text;
BEGIN
 PERFORM public.assert_platform_sales_access(p_receipt,p_token);
 SELECT * INTO a FROM public.platform_sales_access WHERE receipt=p_receipt FOR UPDATE;
 IF a.verified_at IS NOT NULL THEN RETURN jsonb_build_object('verified',true); END IF;
 -- Retry the same challenge uses the same provider idempotency key and never consumes another send.
 IF a.challenge_id IS DISTINCT FROM p_id THEN
  IF a.sends>=5 OR a.last_sent_at>now()-interval '5 minutes' THEN RETURN jsonb_build_object('limited',true); END IF;
  IF p_id IS NULL OR p_code_hash IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid challenge' USING ERRCODE='22023'; END IF;
  UPDATE public.platform_sales_access SET challenge_id=p_id,code_hash=p_code_hash,code_expires_at=now()+interval '10 minutes',attempts=0,sends=sends+1,last_sent_at=now() WHERE receipt=p_receipt;
  INSERT INTO public.platform_sales_journey_outbox(id,receipt) VALUES(p_id,p_receipt);
 ELSIF a.code_hash IS DISTINCT FROM p_code_hash THEN RAISE EXCEPTION 'Challenge conflict' USING ERRCODE='P3611';
 END IF;
 SELECT payload->>'email' INTO email FROM public.platform_sales_leads WHERE receipt=p_receipt;
 RETURN jsonb_build_object('id',p_id,'email',email,'state',(SELECT state FROM public.platform_sales_journey_outbox WHERE id=p_id));
END $$;
CREATE OR REPLACE FUNCTION public.sales_contact_delivery(p_receipt uuid,p_token text,p_id uuid,p_state text,p_provider text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.assert_platform_sales_access(p_receipt,p_token);
 IF p_state IS NULL OR p_state NOT IN ('ACCEPTED','UNKNOWN','REJECTED') OR length(coalesce(p_provider,''))>120 THEN RAISE EXCEPTION 'Invalid delivery' USING ERRCODE='22023'; END IF;
 UPDATE public.platform_sales_journey_outbox SET state=p_state,provider_id=CASE WHEN p_state='ACCEPTED' THEN p_provider ELSE NULL END,diagnostic=CASE WHEN p_state<>'ACCEPTED' THEN p_state ELSE NULL END WHERE id=p_id AND receipt=p_receipt AND state<>'ACCEPTED';
END $$;
CREATE OR REPLACE FUNCTION public.verify_sales_contact(p_receipt uuid,p_token text,p_code_hash text,p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.platform_sales_access;
BEGIN
 PERFORM public.assert_platform_sales_access(p_receipt,p_token);
 SELECT * INTO a FROM public.platform_sales_access WHERE receipt=p_receipt FOR UPDATE;
 IF a.verified_at IS NOT NULL THEN RETURN jsonb_build_object('verified',true); END IF;
 IF a.attempts>=5 OR a.code_expires_at IS NULL OR a.code_expires_at<=now() THEN RETURN jsonb_build_object('verified',false,'expired',true); END IF;
 UPDATE public.platform_sales_access SET attempts=attempts+1 WHERE receipt=p_receipt;
 IF a.code_hash IS DISTINCT FROM p_code_hash THEN RETURN jsonb_build_object('verified',false); END IF;
 UPDATE public.platform_sales_access SET verified_at=now(),code_hash=NULL WHERE receipt=p_receipt;
 INSERT INTO public.platform_sales_journey_events(id,receipt,kind,evidence) VALUES(gen_random_uuid(),p_receipt,'CONTACT_VERIFIED',jsonb_build_object('method','EMAIL_OTP','requesterHash',p_evidence));
 RETURN jsonb_build_object('verified',true);
END $$;
CREATE OR REPLACE FUNCTION public.accept_sales_suggestion(p_request uuid,p_receipt uuid,p_token text,p_suggestion uuid,p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved public.platform_sales_suggestions; current_snapshot jsonb;
BEGIN
 PERFORM public.assert_platform_sales_access(p_receipt,p_token);
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-journey:'||p_receipt::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.platform_sales_access WHERE receipt=p_receipt AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Verify contact' USING ERRCODE='42501'; END IF;
 SELECT * INTO saved FROM public.platform_sales_suggestions WHERE id=p_suggestion AND receipt=p_receipt;
 IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion missing' USING ERRCODE='P3610'; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_sales_journey_events WHERE suggestion_id=p_suggestion AND kind='ACCEPTED') THEN RETURN jsonb_build_object('status','AWAITING_OWNER','suggestionId',p_suggestion); END IF;
 current_snapshot:=public.build_platform_sales_snapshot(p_receipt,(saved.snapshot->>'planId')::uuid,(saved.snapshot->>'policyVersion')::integer,saved.snapshot->>'cycle','[]',saved.snapshot->>'justification');
 IF current_snapshot<>saved.snapshot THEN RAISE EXCEPTION 'Suggestion changed' USING ERRCODE='P3611'; END IF;
 INSERT INTO public.platform_sales_journey_events(id,receipt,suggestion_id,kind,evidence) VALUES(p_request,p_receipt,p_suggestion,'ACCEPTED',jsonb_build_object('consentVersion','sales-suggestion-v1','requesterHash',p_evidence));
 RETURN jsonb_build_object('status','AWAITING_OWNER','suggestionId',p_suggestion);
END $$;
CREATE OR REPLACE FUNCTION public.read_sales_journey(p_receipt uuid,p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.assert_platform_sales_access(p_receipt,p_token);
 RETURN jsonb_build_object('verified',(SELECT verified_at IS NOT NULL FROM public.platform_sales_access WHERE receipt=p_receipt),'suggestions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'snapshot',s.snapshot,'createdAt',s.created_at) ORDER BY s.created_at DESC,s.id),'[]') FROM public.platform_sales_suggestions s WHERE receipt=p_receipt),'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'createdAt',created_at,'suggestionId',suggestion_id) ORDER BY created_at,id),'[]') FROM public.platform_sales_journey_events WHERE receipt=p_receipt));
END $$;
CREATE OR REPLACE FUNCTION public.owner_sales_journey(p_actor uuid,p_receipt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.platform_team_owner(p_actor);
 RETURN jsonb_build_object('suggestions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY created_at DESC,id),'[]') FROM public.platform_sales_suggestions s WHERE receipt=p_receipt),'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY created_at,id),'[]') FROM public.platform_sales_journey_events e WHERE receipt=p_receipt),'contactVerified',(SELECT verified_at IS NOT NULL FROM public.platform_sales_access WHERE receipt=p_receipt));
END $$;
CREATE OR REPLACE FUNCTION public.approve_sales_journey(p_actor uuid,p_request uuid,p_receipt uuid,p_suggestion uuid,p_justification text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.platform_sales_suggestions; proposal jsonb; previous public.platform_sales_journey_events;
BEGIN
 PERFORM public.platform_team_owner(p_actor);
 IF length(btrim(p_justification)) NOT BETWEEN 5 AND 1000 OR p_justification IS NULL THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-journey:'||p_receipt::text,0));
 SELECT * INTO previous FROM public.platform_sales_journey_events WHERE suggestion_id=p_suggestion AND kind='OWNER_APPROVED';
 IF FOUND THEN RETURN jsonb_build_object('proposalId',previous.evidence->>'proposalId','status','APPROVED_INTERNAL'); END IF;
 SELECT * INTO s FROM public.platform_sales_suggestions WHERE id=p_suggestion AND receipt=p_receipt;
 IF NOT FOUND OR (SELECT suggestion_id FROM public.platform_sales_journey_events WHERE receipt=p_receipt AND kind='ACCEPTED' ORDER BY created_at DESC,id DESC LIMIT 1) IS DISTINCT FROM p_suggestion THEN RAISE EXCEPTION 'Accepted suggestion missing' USING ERRCODE='P3610'; END IF;
 -- Reuse authoritative quote builder. Any catalog/policy change requires a renewed suggestion/acceptance.
 IF public.build_platform_sales_snapshot(p_receipt,(s.snapshot->>'planId')::uuid,(s.snapshot->>'policyVersion')::integer,s.snapshot->>'cycle','[]',s.snapshot->>'justification')<>s.snapshot THEN RAISE EXCEPTION 'Renew prospect acceptance' USING ERRCODE='P3611'; END IF;
 proposal:=public.create_platform_sales_proposal(p_actor,p_request,p_receipt,(s.snapshot->>'planId')::uuid,(s.snapshot->>'policyVersion')::integer,s.snapshot->>'cycle','[]',p_justification);
 PERFORM public.transition_platform_sales_proposal(p_actor,gen_random_uuid(),p_request,1,'CHECKED',p_justification);
 PERFORM public.transition_platform_sales_proposal(p_actor,gen_random_uuid(),p_request,2,'APPROVED_INTERNAL',p_justification);
 INSERT INTO public.platform_sales_journey_events(id,receipt,suggestion_id,kind,actor_id,evidence) VALUES(gen_random_uuid(),p_receipt,p_suggestion,'OWNER_APPROVED',p_actor,jsonb_build_object('proposalId',p_request,'justification',p_justification));
 RETURN jsonb_build_object('proposalId',p_request,'status','APPROVED_INTERNAL');
END $$;
-- No public role can execute RPCs directly; HTTP boundary validates origin, budget, payload and hashes.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('assert_platform_sales_access','submit_platform_sales_journey','sales_journey_context','preserve_sales_suggestion','sales_contact_challenge','sales_contact_delivery','verify_sales_contact','accept_sales_suggestion','read_sales_journey','owner_sales_journey','approve_sales_journey') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 IF f.signature::text NOT LIKE '%assert_platform_sales_access%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.read_platform_sales_leads(p_actor uuid,p_page integer DEFAULT 0,p_search text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; total bigint;
BEGIN
 PERFORM public.platform_team_owner(p_actor);
 IF p_page IS NULL OR p_page<0 OR p_page>1000 OR p_search IS NULL OR length(p_search)>120 THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO total FROM public.platform_sales_leads WHERE p_search='' OR strpos(lower(payload->>'company'),lower(p_search))>0 OR strpos(lower(payload->>'email'),lower(p_search))>0;
 SELECT coalesce(jsonb_agg(jsonb_build_object('receipt',receipt,'createdAt',created_at,'status',status,'data',payload,'awaitingOwner',EXISTS(SELECT 1 FROM public.platform_sales_journey_events e WHERE e.receipt=q.receipt AND e.kind='ACCEPTED' AND e.id=(SELECT recent.id FROM public.platform_sales_journey_events recent WHERE recent.receipt=q.receipt AND recent.kind='ACCEPTED' ORDER BY created_at DESC,id DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM public.platform_sales_journey_events approved WHERE approved.suggestion_id=e.suggestion_id AND approved.kind='OWNER_APPROVED'))) ORDER BY created_at DESC,receipt),'[]'::jsonb) INTO result FROM
 (SELECT receipt,created_at,status,payload FROM public.platform_sales_leads WHERE p_search='' OR strpos(lower(payload->>'company'),lower(p_search))>0 OR strpos(lower(payload->>'email'),lower(p_search))>0 ORDER BY created_at DESC,receipt LIMIT 25 OFFSET p_page*25) q;
 RETURN jsonb_build_object('rows',result,'total',total,'page',p_page);
END $$;

COMMIT;
