-- Commercial license intake only. No tenant, license or payment mutations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.platform_sales_core_policy(
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 actor_id uuid,reason text,updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_sales_core_policy(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.platform_sales_core_outbox(
 receipt uuid PRIMARY KEY REFERENCES public.platform_sales_leads(receipt) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','LEASED','ACCEPTED','DEAD_LETTER')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),lease_id uuid,lease_until timestamptz,
 core_request_id text UNIQUE,revision integer NOT NULL DEFAULT 0,commercial_status text,
 proposal_ref text,contract_ref text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_sales_core_pending ON public.platform_sales_core_outbox(state,created_at,receipt);
CREATE TABLE IF NOT EXISTS public.platform_sales_core_claims(
 id uuid PRIMARY KEY,receipts uuid[] NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.platform_sales_core_events(
 id uuid PRIMARY KEY,receipt uuid REFERENCES public.platform_sales_leads(receipt) ON DELETE CASCADE,
 action text NOT NULL,digest text,detail jsonb NOT NULL,actor_id uuid,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_sales_core_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sales_core_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sales_core_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sales_core_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_sales_core_policy,public.platform_sales_core_outbox,public.platform_sales_core_claims,public.platform_sales_core_events FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enqueue_platform_sales_core() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Same transaction as accepted intake; disabled routing has no historical backfill.
 IF EXISTS(SELECT 1 FROM public.platform_sales_core_policy WHERE id AND enabled) THEN
  INSERT INTO public.platform_sales_core_outbox(receipt) VALUES(NEW.receipt) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_platform_sales_core() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS enqueue_platform_sales_core ON public.platform_sales_leads;
CREATE TRIGGER enqueue_platform_sales_core AFTER INSERT ON public.platform_sales_leads FOR EACH ROW EXECUTE FUNCTION public.enqueue_platform_sales_core();

CREATE OR REPLACE FUNCTION public.guard_core_managed_sales_proposal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.platform_sales_core_outbox WHERE receipt=NEW.receipt) THEN
  RAISE EXCEPTION 'Proposal managed by Energy Core' USING ERRCODE='P3652';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_core_managed_sales_proposal() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS guard_core_managed_sales_proposal ON public.platform_sales_proposals;
CREATE TRIGGER guard_core_managed_sales_proposal BEFORE INSERT ON public.platform_sales_proposals FOR EACH ROW EXECUTE FUNCTION public.guard_core_managed_sales_proposal();

CREATE OR REPLACE FUNCTION public.platform_sales_core_bridge(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rec public.platform_sales_core_outbox; ev public.platform_sales_core_events; ids uuid[]; result jsonb; rid uuid; lease uuid; prior_rank integer; next_rank integer;
BEGIN
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>4096 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023'; END IF;
 IF p_action IN ('status','routing','retry') THEN
  PERFORM public.platform_team_owner(p_actor);
 ELSE
  IF p_actor IS NOT NULL OR p_action NOT IN ('claim','ack','update') OR NOT EXISTS(SELECT 1 FROM public.platform_sales_core_policy WHERE id AND enabled) THEN RAISE EXCEPTION 'Bridge disabled' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_action='status' THEN
  RETURN jsonb_build_object('enabled',(SELECT enabled FROM public.platform_sales_core_policy WHERE id),'counts',(SELECT coalesce(jsonb_object_agg(state,n),'{}') FROM (SELECT state,count(*) n FROM public.platform_sales_core_outbox GROUP BY state) q),'deadLetters',(SELECT coalesce(jsonb_agg(receipt),'[]') FROM (SELECT receipt FROM public.platform_sales_core_outbox WHERE state='DEAD_LETTER' ORDER BY created_at LIMIT 25) q));
 ELSIF p_action='routing' THEN
  IF jsonb_typeof(p_body->'enabled') IS DISTINCT FROM 'boolean' OR length(trim(p_body->>'reason')) NOT BETWEEN 20 AND 1000 OR p_body->>'reason' IS NULL THEN RAISE EXCEPTION 'Invalid routing' USING ERRCODE='22023'; END IF;
  UPDATE public.platform_sales_core_policy SET enabled=(p_body->>'enabled')::boolean,actor_id=p_actor,reason=p_body->>'reason',updated_at=now() WHERE id;
  INSERT INTO public.platform_sales_core_events(id,action,detail,actor_id) VALUES(gen_random_uuid(),'ROUTING',p_body,p_actor);
  RETURN jsonb_build_object('enabled',(p_body->>'enabled')::boolean);
 ELSIF p_action='retry' THEN
  IF length(trim(p_body->>'reason')) NOT BETWEEN 20 AND 1000 OR p_body->>'reason' IS NULL THEN RAISE EXCEPTION 'Invalid reason' USING ERRCODE='22023'; END IF;
  UPDATE public.platform_sales_core_outbox SET state='QUEUED',attempts=0,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE receipt=(p_body->>'receipt')::uuid AND state='DEAD_LETTER' RETURNING * INTO rec;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not retryable' USING ERRCODE='P3650'; END IF;
  INSERT INTO public.platform_sales_core_events(id,receipt,action,detail,actor_id) VALUES(gen_random_uuid(),rec.receipt,'RETRY',p_body,p_actor);
  RETURN jsonb_build_object('receipt',rec.receipt,'state',rec.state);
 ELSIF p_action='claim' THEN
  lease:=(p_body->>'requestId')::uuid;IF lease IS NULL THEN RAISE EXCEPTION 'Invalid lease' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('core-claim:'||lease::text,0));
  SELECT receipts INTO ids FROM public.platform_sales_core_claims WHERE id=lease;
  IF NOT FOUND THEN
   UPDATE public.platform_sales_core_outbox SET state='DEAD_LETTER',updated_at=now() WHERE attempts>=10 AND state='LEASED' AND lease_until<=now();
   WITH picked AS (SELECT receipt FROM public.platform_sales_core_outbox WHERE attempts<10 AND (state='QUEUED' OR state='LEASED' AND lease_until<=now()) ORDER BY created_at,receipt LIMIT 10 FOR UPDATE SKIP LOCKED), changed AS
   (UPDATE public.platform_sales_core_outbox o SET state='LEASED',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '5 minutes',updated_at=now() FROM picked p WHERE o.receipt=p.receipt RETURNING o.receipt)
   SELECT coalesce(array_agg(receipt),'{}'::uuid[]) INTO ids FROM changed;
   INSERT INTO public.platform_sales_core_claims(id,receipts) VALUES(lease,ids);
  END IF;
  -- Always read live intake: erasure cannot be undone by a copied payload.
  SELECT coalesce(jsonb_agg(jsonb_build_object('receipt',o.receipt,'leaseId',o.lease_id,'leaseUntil',o.lease_until,'idempotencyKey','energyos-license:'||o.receipt::text,'createdAt',l.created_at,'lead',l.payload-'requestId'-'website'-'emailKind') ORDER BY o.created_at,o.receipt),'[]') INTO result
  FROM public.platform_sales_core_outbox o JOIN public.platform_sales_leads l USING(receipt) WHERE o.receipt=ANY(ids) AND o.state='LEASED' AND o.lease_id=lease AND o.lease_until>now();
  RETURN jsonb_build_object('schemaVersion',1,'requests',result);
 END IF;
 rid:=(p_body->>'receipt')::uuid;
 SELECT * INTO rec FROM public.platform_sales_core_outbox WHERE receipt=rid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown commercial request' USING ERRCODE='P3651'; END IF;
 IF p_action='ack' THEN
  IF coalesce(p_body->>'coreRequestId','')!~'^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' THEN RAISE EXCEPTION 'Invalid Core reference' USING ERRCODE='22023'; END IF;
  IF rec.state='ACCEPTED' AND rec.core_request_id=p_body->>'coreRequestId' AND rec.lease_id=(p_body->>'leaseId')::uuid THEN RETURN jsonb_build_object('receipt',rid,'state','ACCEPTED'); END IF;
  IF rec.state<>'LEASED' OR rec.lease_id IS DISTINCT FROM (p_body->>'leaseId')::uuid OR rec.lease_until<=now() THEN RAISE EXCEPTION 'Lease changed' USING ERRCODE='P3650'; END IF;
  UPDATE public.platform_sales_core_outbox SET state='ACCEPTED',core_request_id=p_body->>'coreRequestId',lease_until=NULL,updated_at=now() WHERE receipt=rid;
  INSERT INTO public.platform_sales_core_events(id,receipt,action,detail) VALUES(gen_random_uuid(),rid,'ACK',jsonb_build_object('coreRequestId',p_body->>'coreRequestId'));
  RETURN jsonb_build_object('receipt',rid,'state','ACCEPTED');
 ELSIF p_action='update' THEN
  IF rec.state<>'ACCEPTED' THEN RAISE EXCEPTION 'Not accepted' USING ERRCODE='P3650'; END IF;
  IF (p_body->>'eventId') IS NULL OR coalesce(p_body->>'digest','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid event' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('core-event:'||(p_body->>'eventId'),0));
  SELECT * INTO ev FROM public.platform_sales_core_events WHERE id=(p_body->>'eventId')::uuid;
  IF FOUND THEN
   IF ev.receipt IS DISTINCT FROM rid OR ev.digest IS DISTINCT FROM p_body->>'digest' THEN RAISE EXCEPTION 'Event changed' USING ERRCODE='P3650'; END IF;
   RETURN jsonb_build_object('receipt',rid,'recorded',true,'duplicate',true);
  END IF;
  next_rank:=CASE p_body->>'status' WHEN 'PROPOSAL_PREPARED' THEN 1 WHEN 'CONTRACT_PREPARED' THEN 2 WHEN 'CONTRACT_SIGNED' THEN 3 WHEN 'CANCELLED' THEN 4 ELSE 0 END;
  prior_rank:=CASE rec.commercial_status WHEN 'PROPOSAL_PREPARED' THEN 1 WHEN 'CONTRACT_PREPARED' THEN 2 WHEN 'CONTRACT_SIGNED' THEN 3 WHEN 'CANCELLED' THEN 4 ELSE 0 END;
  IF next_rank=0 OR next_rank<prior_rank OR (p_body->>'revision')::integer<=rec.revision OR (p_body->>'revision')::integer>1000000 OR next_rank=1 AND coalesce(p_body->>'proposalRef','')!~'^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' OR next_rank IN (2,3) AND coalesce(p_body->>'contractRef','')!~'^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$' THEN RAISE EXCEPTION 'Commercial revision changed' USING ERRCODE='P3650'; END IF;
  UPDATE public.platform_sales_core_outbox SET revision=(p_body->>'revision')::integer,commercial_status=p_body->>'status',proposal_ref=coalesce(p_body->>'proposalRef',proposal_ref),contract_ref=coalesce(p_body->>'contractRef',contract_ref),updated_at=now() WHERE receipt=rid;
  INSERT INTO public.platform_sales_core_events(id,receipt,action,digest,detail) VALUES((p_body->>'eventId')::uuid,rid,'UPDATE',p_body->>'digest',p_body-'digest');
  RETURN jsonb_build_object('receipt',rid,'recorded',true,'licenseActivated',false);
 END IF;
 RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_core_bridge(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_core_bridge(uuid,text,jsonb) TO service_role;
COMMIT;
