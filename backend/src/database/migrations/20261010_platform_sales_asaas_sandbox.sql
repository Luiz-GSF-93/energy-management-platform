BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.platform_sales_asaas_bindings (
 id uuid PRIMARY KEY, environment text NOT NULL DEFAULT 'SANDBOX' CHECK(environment='SANDBOX'),
 proposal_id uuid NOT NULL REFERENCES public.platform_sales_proposals(id), payment_id text NOT NULL UNIQUE CHECK(payment_id ~ '^pay_[a-zA-Z0-9]{1,100}$'),
 customer_id text NOT NULL CHECK(customer_id ~ '^cus_[a-zA-Z0-9]{1,100}$'), company text NOT NULL,
 gross_cents bigint NOT NULL CHECK(gross_cents>0 AND gross_cents<=1000000000), source jsonb NOT NULL,
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.platform_sales_asaas_inbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),environment text NOT NULL DEFAULT 'SANDBOX' CHECK(environment='SANDBOX'),
 provider_id text NOT NULL UNIQUE,event text NOT NULL,payment_id text NOT NULL,summary jsonb NOT NULL,
 hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.platform_sales_asaas_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES public.platform_sales_asaas_inbox(id),
 version integer NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN ('PROCESSING','VERIFIED','REVIEW','UNLINKED')),
 lease uuid NOT NULL,actor_id uuid NOT NULL,actor_name text,note text NOT NULL,summary jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,version)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_asaas_bindings','platform_sales_asaas_inbox','platform_sales_asaas_checks'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.platform_sales_asaas_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE binding public.platform_sales_asaas_bindings; item public.platform_sales_asaas_inbox; latest public.platform_sales_asaas_checks;
 entity uuid;lease uuid;author text;source jsonb;summary jsonb;ev jsonb;q text;state text;page integer;date_from date;date_to date;note text;next_status text;
BEGIN
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>18000 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
 IF p_action='inbox' THEN
  IF p_actor IS NOT NULL THEN RAISE EXCEPTION 'Ingress only' USING ERRCODE='42501'; END IF;
  ev:=p_body->'event';summary:=ev->'payment';
  IF ev->>'id' IS NULL OR ev->>'id' !~ '^evt_[a-zA-Z0-9&_-]{1,150}$' OR ev->>'event' IS NULL OR ev->>'event' !~ '^PAYMENT_[A-Z_]{1,60}$' OR summary->>'id' IS NULL OR summary->>'id' !~ '^pay_[a-zA-Z0-9]{1,100}$' OR p_body->>'hash' IS NULL OR p_body->>'hash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid event' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-asaas-event:'||(ev->>'id'),0));
  SELECT * INTO item FROM public.platform_sales_asaas_inbox WHERE provider_id=ev->>'id';
  IF FOUND THEN
   IF item.hash IS DISTINCT FROM p_body->>'hash' OR item.summary IS DISTINCT FROM summary OR item.event IS DISTINCT FROM ev->>'event' THEN RAISE EXCEPTION 'Conflicting delivery' USING ERRCODE='P3611'; END IF;
  ELSE
   INSERT INTO public.platform_sales_asaas_inbox(provider_id,event,payment_id,summary,hash) VALUES(ev->>'id',ev->>'event',summary->>'id',summary,p_body->>'hash') RETURNING * INTO item;
  END IF;
  RETURN jsonb_build_object('id',item.id);
 END IF;
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 PERFORM public.platform_team_owner(p_actor);author:=public.platform_sales_offer_actor_name(p_actor);
 IF p_action='list' THEN
  page:=(p_body->>'page')::integer;q:=p_body->>'search';state:=p_body->>'status';date_from:=(p_body->>'from')::date;date_to:=(p_body->>'to')::date;
  IF page IS NULL OR page NOT BETWEEN 0 AND 1000 OR q IS NULL OR length(q)>100 OR state IS NULL OR state NOT IN ('','PENDING','VERIFIED','REVIEW','UNLINKED','PROCESSING') OR date_from>date_to THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023'; END IF;
  RETURN (WITH filtered AS (
   SELECT i.id,i.provider_id,i.event,i.payment_id,i.received_at,b.company,b.proposal_id,b.id binding_id,b.gross_cents,
    coalesce(c.status,CASE WHEN b.id IS NULL THEN 'UNLINKED' ELSE 'PENDING' END) status,c.created_at checked_at
   FROM public.platform_sales_asaas_inbox i LEFT JOIN public.platform_sales_asaas_bindings b ON b.payment_id=i.payment_id
   LEFT JOIN LATERAL(SELECT status,created_at FROM public.platform_sales_asaas_checks WHERE event_id=i.id ORDER BY version DESC LIMIT 1)c ON true
   WHERE (q='' OR strpos(lower(coalesce(b.company,'')),lower(q))>0 OR strpos(i.provider_id,q)>0 OR strpos(coalesce(b.proposal_id::text,''),q)>0)
    AND (date_from IS NULL OR i.received_at>=date_from::timestamptz) AND (date_to IS NULL OR i.received_at<(date_to+1)::timestamptz)
  ), matched AS (SELECT * FROM filtered WHERE state='' OR status=state)
  SELECT jsonb_build_object('environment','SANDBOX','rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT * FROM matched ORDER BY received_at DESC,id LIMIT 25 OFFSET page*25)x),'total',(SELECT count(*) FROM matched),'bindings',(SELECT count(*) FROM public.platform_sales_asaas_bindings)));
 END IF;
 entity:=(p_body->>'id')::uuid;
 IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023'; END IF;
 IF p_action='bind' THEN
  IF p_body->>'paymentId' IS NULL OR p_body->>'paymentId' !~ '^pay_[a-zA-Z0-9]{1,100}$' OR p_body->>'customerId' IS NULL OR p_body->>'customerId' !~ '^cus_[a-zA-Z0-9]{1,100}$' OR p_body->>'justification' IS NULL OR length(btrim(p_body->>'justification')) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Invalid binding' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-asaas-binding:'||entity::text,0));
  SELECT * INTO binding FROM public.platform_sales_asaas_bindings WHERE id=entity;
  IF FOUND THEN
   IF binding.actor_id<>p_actor OR binding.proposal_id IS DISTINCT FROM (p_body->>'proposalId')::uuid OR binding.payment_id IS DISTINCT FROM p_body->>'paymentId' OR binding.customer_id IS DISTINCT FROM p_body->>'customerId' OR binding.justification IS DISTINCT FROM p_body->>'justification' THEN RAISE EXCEPTION 'Binding reused' USING ERRCODE='P3611'; END IF;
   RETURN to_jsonb(binding)-'source';
  END IF;
  source:=public.read_platform_sales_approved_proposal(p_actor,(p_body->>'proposalId')::uuid);
  IF source->'snapshot'->>'currency' IS DISTINCT FROM 'BRL' OR (source->'snapshot'->'policy'->>'ends')::date<(now() AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'Invalid or expired source' USING ERRCODE='22023'; END IF;
  INSERT INTO public.platform_sales_asaas_bindings(id,proposal_id,payment_id,customer_id,company,gross_cents,source,actor_id,actor_name,justification)
  VALUES(entity,(p_body->>'proposalId')::uuid,p_body->>'paymentId',p_body->>'customerId',coalesce((SELECT payload->>'company' FROM public.platform_sales_leads WHERE receipt=(source->>'receipt')::uuid),'Empresa não disponível'),(source->'snapshot'->>'initialTotalCents')::bigint,source,p_actor,author,p_body->>'justification') RETURNING * INTO binding;
  RETURN to_jsonb(binding)-'source';
 END IF;
 SELECT * INTO item FROM public.platform_sales_asaas_inbox WHERE id=entity;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing event' USING ERRCODE='P3610'; END IF;
 IF p_action='read' THEN
  RETURN jsonb_build_object('event',to_jsonb(item),'binding',(SELECT to_jsonb(b)-'source' FROM public.platform_sales_asaas_bindings b WHERE payment_id=item.payment_id),'checks',(SELECT coalesce(jsonb_agg(c ORDER BY c.version),'[]') FROM public.platform_sales_asaas_checks c WHERE event_id=entity));
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-asaas-check:'||entity::text,0));
 SELECT * INTO latest FROM public.platform_sales_asaas_checks WHERE event_id=entity ORDER BY version DESC LIMIT 1;
 lease:=(p_body->>'lease')::uuid;IF lease IS NULL THEN RAISE EXCEPTION 'Lease required' USING ERRCODE='22023'; END IF;
 SELECT * INTO binding FROM public.platform_sales_asaas_bindings WHERE payment_id=item.payment_id;
 IF p_action='claim' THEN
  IF latest.status='VERIFIED' THEN RETURN jsonb_build_object('skip',true,'status','VERIFIED'); END IF;
  IF latest.status='PROCESSING' AND latest.created_at>now()-interval '2 minutes' THEN RAISE EXCEPTION 'Already processing' USING ERRCODE='P3611'; END IF;
  IF binding.id IS NULL THEN next_status:='UNLINKED';note:='Sem vínculo comercial; não reconhecido como recebimento.';
  ELSE next_status:='PROCESSING';note:='Consulta pontual ao sandbox solicitada pelo Owner.'; END IF;
  INSERT INTO public.platform_sales_asaas_checks(event_id,version,status,lease,actor_id,actor_name,note) VALUES(entity,coalesce(latest.version,0)+1,next_status,lease,p_actor,author,note);
  RETURN jsonb_build_object('skip',binding.id IS NULL,'status',next_status,'paymentId',item.payment_id);
 END IF;
 IF p_action='finish' THEN
  IF latest.status IS DISTINCT FROM 'PROCESSING' OR latest.lease IS DISTINCT FROM lease OR latest.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Stale lease' USING ERRCODE='P3611'; END IF;
  summary:=p_body->'summary';next_status:='REVIEW';note:='Consulta indisponível ou dados divergentes; requer análise.';
  IF binding.id IS NOT NULL AND summary IS NOT NULL AND summary<>'null'::jsonb AND summary->>'id'=item.payment_id AND summary->>'customer'=binding.customer_id AND summary->>'reference'=binding.id::text AND (summary->>'grossCents')::bigint=binding.gross_cents AND summary IS NOT DISTINCT FROM item.summary AND item.event IN ('PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','PAYMENT_DELETED','PAYMENT_RESTORED','PAYMENT_REFUNDED') THEN
   IF (item.event='PAYMENT_RECEIVED' AND summary->>'status'='RECEIVED') OR (item.event='PAYMENT_CONFIRMED' AND summary->>'status'='CONFIRMED') OR (item.event='PAYMENT_OVERDUE' AND summary->>'status'='OVERDUE') OR (item.event='PAYMENT_REFUNDED' AND summary->>'status'='REFUNDED') OR (item.event IN ('PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_RESTORED') AND summary->>'status' IN ('PENDING','CONFIRMED','RECEIVED','OVERDUE')) THEN next_status:='VERIFIED';note:='Evento compatível com consulta sandbox e vínculo preservado; não ativa licença.';END IF;
  END IF;
  INSERT INTO public.platform_sales_asaas_checks(event_id,version,status,lease,actor_id,actor_name,note,summary) VALUES(entity,latest.version+1,next_status,lease,p_actor,author,note,summary);
  RETURN jsonb_build_object('status',next_status);
 END IF;
 RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_asaas_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_asaas_action(uuid,text,jsonb) TO service_role;
COMMIT;
