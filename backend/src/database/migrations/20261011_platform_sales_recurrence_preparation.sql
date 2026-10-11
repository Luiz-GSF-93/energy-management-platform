BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Preparation only: no provider, scheduler, license or financial mutations.
CREATE TABLE IF NOT EXISTS public.platform_sales_billing_agreements (
 id uuid PRIMARY KEY, intent_id uuid NOT NULL UNIQUE REFERENCES public.platform_sales_creation_intents(id),
 proposal_id uuid NOT NULL UNIQUE REFERENCES public.platform_sales_proposals(id),
 environment text NOT NULL DEFAULT 'SANDBOX' CHECK(environment='SANDBOX'),
 cycle text NOT NULL CHECK(cycle IN ('MONTHLY','ANNUAL')), customer_id text NOT NULL,
 first_payment_id text NOT NULL UNIQUE, next_due_date date NOT NULL,
 recurring_cents bigint NOT NULL CHECK(recurring_cents BETWEEN 1 AND 1000000000),
 source jsonb NOT NULL, parameters jsonb NOT NULL, parameters_hash text NOT NULL CHECK(parameters_hash ~ '^[a-f0-9]{64}$'),
 justification text NOT NULL, actor_id uuid NOT NULL, actor_name text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.platform_sales_billing_cycles (
 agreement_id uuid NOT NULL REFERENCES public.platform_sales_billing_agreements(id),
 sequence integer NOT NULL CHECK(sequence BETWEEN 2 AND 13), due_date date NOT NULL,
 competence date NOT NULL CHECK(extract(day FROM competence)=1),
 gross_cents bigint NOT NULL CHECK(gross_cents BETWEEN 1 AND 1000000000),
 PRIMARY KEY(agreement_id,sequence), UNIQUE(agreement_id,competence)
);
CREATE TABLE IF NOT EXISTS public.platform_sales_billing_events (
 agreement_id uuid NOT NULL REFERENCES public.platform_sales_billing_agreements(id), version integer NOT NULL CHECK(version>0),
 request_id uuid NOT NULL UNIQUE, state text NOT NULL CHECK(state IN ('PREPARED','CHECKED','APPROVED_INTERNAL')),
 actor_id uuid NOT NULL, actor_name text, justification text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(agreement_id,version)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_billing_agreements','platform_sales_billing_cycles','platform_sales_billing_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.platform_sales_recurrence_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item public.platform_sales_billing_agreements; event public.platform_sales_billing_events;
 intent public.platform_sales_creation_intents; binding public.platform_sales_asaas_bindings;
 entity uuid; author text; doc jsonb; params jsonb; amount bigint; due date; finish date;
 period text; month_step integer; page integer; q text; filter_state text; req uuid;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501'; END IF;
 IF p_action IN ('read','list') THEN
  -- Existing Owner/Finance authority; read-name availability never creates authority.
  PERFORM public.read_platform_sales_finance(p_actor,0,'','',NULL,NULL,NULL);
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
  PERFORM public.platform_team_owner(p_actor);
 END IF;
 author:=public.platform_sales_finance_name(p_actor);
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>5000 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023'; END IF;
 IF p_action='list' THEN
  IF p_body - ARRAY['page','search','state']<>'{}' OR NOT p_body ?& ARRAY['page','search','state'] THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
  page:=(p_body->>'page')::integer;q:=p_body->>'search';filter_state:=p_body->>'state';
  IF page IS NULL OR page NOT BETWEEN 0 AND 1000 OR q IS NULL OR length(q)>100 OR filter_state IS NULL OR filter_state NOT IN ('','PREPARED','CHECKED','APPROVED_INTERNAL') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
  RETURN (WITH rows AS (
   SELECT a.id,a.proposal_id,a.customer_id,a.cycle,a.next_due_date,a.recurring_cents::text recurring_cents,e.state,a.created_at
   FROM public.platform_sales_billing_agreements a
   JOIN LATERAL(SELECT state FROM public.platform_sales_billing_events WHERE agreement_id=a.id ORDER BY version DESC LIMIT 1)e ON true
   WHERE (q='' OR strpos(a.id::text,q)>0 OR strpos(a.proposal_id::text,q)>0 OR strpos(a.customer_id,q)>0)
    AND (filter_state='' OR e.state=filter_state)
  ) SELECT jsonb_build_object('environment','SANDBOX','externalCallsEnabled',false,'total',(SELECT count(*) FROM rows),
   'rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT * FROM rows ORDER BY created_at DESC,id LIMIT 25 OFFSET page*25)x)));
 END IF;
 entity:=(p_body->>'id')::uuid;
 IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023'; END IF;
 IF p_action='prepare' THEN
  IF p_body - ARRAY['id','intentId','nextDueDate','justification']<>'{}' OR NOT p_body ?& ARRAY['id','intentId','nextDueDate','justification'] OR (p_body->>'intentId')::uuid IS NULL OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 500 OR p_body->>'justification' IS NULL THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023'; END IF;
  due:=(p_body->>'nextDueDate')::date;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-recurrence-intent:'||(p_body->>'intentId'),0));
  SELECT * INTO item FROM public.platform_sales_billing_agreements WHERE id=entity OR intent_id=(p_body->>'intentId')::uuid;
  IF FOUND THEN
   IF item.id IS DISTINCT FROM entity OR item.intent_id IS DISTINCT FROM (p_body->>'intentId')::uuid OR item.next_due_date IS DISTINCT FROM due OR item.justification IS DISTINCT FROM p_body->>'justification' OR item.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Preparation conflict' USING ERRCODE='P3661'; END IF;
   RETURN jsonb_build_object('id',entity,'replayed',true);
  END IF;
  SELECT * INTO intent FROM public.platform_sales_creation_intents WHERE id=(p_body->>'intentId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source not found' USING ERRCODE='P3660'; END IF;
  IF (SELECT state FROM public.platform_sales_creation_events WHERE intent_id=intent.id ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'CREATED' THEN RAISE EXCEPTION 'First cycle not reconciled' USING ERRCODE='P3661'; END IF;
  SELECT * INTO binding FROM public.platform_sales_asaas_bindings WHERE id=intent.id AND proposal_id=intent.proposal_id;
  IF NOT FOUND OR binding.customer_id IS DISTINCT FROM intent.parameters->>'customer' OR binding.payment_id IS DISTINCT FROM (SELECT payment_id FROM public.platform_sales_creation_events WHERE intent_id=intent.id ORDER BY version DESC LIMIT 1) THEN RAISE EXCEPTION 'First cycle binding mismatch' USING ERRCODE='P3661'; END IF;
  doc:=public.read_platform_sales_offer_document(p_actor,intent.proposal_id,intent.terms_revision);
  IF doc->>'expired' IS DISTINCT FROM 'false' OR doc->'proposal'->'snapshot' IS DISTINCT FROM intent.snapshot->'proposal'->'snapshot' OR doc->'proposal'->'snapshot'->>'currency' IS DISTINCT FROM 'BRL' THEN RAISE EXCEPTION 'Source expired or changed' USING ERRCODE='P3661'; END IF;
  period:=doc->'proposal'->'snapshot'->>'cycle';
  IF period NOT IN ('MONTHLY','ANNUAL') OR period IS NULL THEN RAISE EXCEPTION 'Unknown cycle' USING ERRCODE='22023'; END IF;
  month_step:=CASE WHEN period='MONTHLY' THEN 1 ELSE 12 END;
  amount:=(doc->'proposal'->'snapshot'->>CASE WHEN period='MONTHLY' THEN 'monthlyRecurringCents' ELSE 'annualRecurringCents' END)::bigint;
  finish:=(doc->'proposal'->'snapshot'->'policy'->>'ends')::date;
  IF amount IS NULL OR amount NOT BETWEEN 1 AND 1000000000 OR due IS NULL OR finish IS NULL OR due<(now() AT TIME ZONE 'UTC')::date OR due<((intent.parameters->>'dueDate')::date+make_interval(months=>month_step))::date OR due>finish THEN RAISE EXCEPTION 'Next cycle overlaps or price is invalid' USING ERRCODE='22023'; END IF;
  params:=jsonb_build_object('customer',binding.customer_id,'billingType','BOLETO','cycle',CASE WHEN period='MONTHLY' THEN 'MONTHLY' ELSE 'YEARLY' END,'value',amount::numeric/100,'nextDueDate',due::text,'endDate',finish::text,'externalReference',entity::text,'description','EnergyOS: previa privada de recorrencia sandbox; sem envio ou ativacao.');
  INSERT INTO public.platform_sales_billing_agreements(id,intent_id,proposal_id,cycle,customer_id,first_payment_id,next_due_date,recurring_cents,source,parameters,parameters_hash,justification,actor_id,actor_name)
   VALUES(entity,intent.id,intent.proposal_id,period,binding.customer_id,binding.payment_id,due,amount,doc,params,encode(sha256(convert_to(params::text,'UTF8')),'hex'),p_body->>'justification',p_actor,author);
  -- Preview only; no remote payment IDs, no received totals and no IPCA assumptions.
  INSERT INTO public.platform_sales_billing_cycles(agreement_id,sequence,due_date,competence,gross_cents)
   SELECT entity,2+n,d::date,date_trunc('month',d)::date,amount FROM generate_series(0,CASE WHEN period='MONTHLY' THEN 11 ELSE 0 END)n
   CROSS JOIN LATERAL(SELECT due+make_interval(months=>n*month_step) d)s WHERE d::date<=finish;
  INSERT INTO public.platform_sales_billing_events(agreement_id,version,request_id,state,actor_id,actor_name,justification) VALUES(entity,1,entity,'PREPARED',p_actor,author,p_body->>'justification');
  RETURN jsonb_build_object('id',entity,'replayed',false);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-recurrence:'||entity::text,0));
 SELECT * INTO item FROM public.platform_sales_billing_agreements WHERE id=entity;
 IF NOT FOUND THEN RAISE EXCEPTION 'Agreement not found' USING ERRCODE='P3660'; END IF;
 IF p_action='read' THEN
  IF p_body - ARRAY['id']<>'{}' THEN RAISE EXCEPTION 'Invalid read' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('agreement',to_jsonb(item)||jsonb_build_object('recurring_cents',item.recurring_cents::text,'current_actor_name',public.platform_sales_finance_name(item.actor_id)),
   'cycles',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('gross_cents',c.gross_cents::text) ORDER BY sequence),'[]') FROM public.platform_sales_billing_cycles c WHERE agreement_id=entity),
   'events',(SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('current_actor_name',public.platform_sales_finance_name(e.actor_id)) ORDER BY version) FROM public.platform_sales_billing_events e WHERE agreement_id=entity),'externalCallsEnabled',false,'environment','SANDBOX');
 END IF;
 IF p_action='review' THEN
  IF p_body - ARRAY['id','requestId','expectedVersion','status','justification']<>'{}' OR NOT p_body ?& ARRAY['id','requestId','expectedVersion','status','justification'] OR (p_body->>'expectedVersion')::integer IS NULL OR (p_body->>'requestId')::uuid IS NULL OR p_body->>'status' IS NULL OR p_body->>'justification' IS NULL OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 500 THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE='22023'; END IF;
  req:=(p_body->>'requestId')::uuid;
  SELECT * INTO event FROM public.platform_sales_billing_events WHERE request_id=req;
  IF FOUND THEN
   IF event.agreement_id IS DISTINCT FROM entity OR event.version IS DISTINCT FROM (p_body->>'expectedVersion')::integer+1 OR event.state IS DISTINCT FROM p_body->>'status' OR event.actor_id IS DISTINCT FROM p_actor OR event.justification IS DISTINCT FROM p_body->>'justification' THEN RAISE EXCEPTION 'Review replay changed' USING ERRCODE='P3661'; END IF;
   RETURN jsonb_build_object('id',entity,'replayed',true);
  END IF;
  SELECT * INTO event FROM public.platform_sales_billing_events WHERE agreement_id=entity ORDER BY version DESC LIMIT 1;
  IF event.version IS DISTINCT FROM (p_body->>'expectedVersion')::integer OR NOT (event.state='PREPARED' AND p_body->>'status'='CHECKED' OR event.state='CHECKED' AND p_body->>'status'='APPROVED_INTERNAL') THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='P3661'; END IF;
  SELECT * INTO intent FROM public.platform_sales_creation_intents WHERE id=item.intent_id;
  doc:=public.read_platform_sales_offer_document(p_actor,item.proposal_id,intent.terms_revision);
  IF doc->>'expired' IS DISTINCT FROM 'false' OR doc->'proposal'->'snapshot' IS DISTINCT FROM item.source->'proposal'->'snapshot' OR item.next_due_date<(now() AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'Source no longer valid' USING ERRCODE='P3661'; END IF;
  INSERT INTO public.platform_sales_billing_events(agreement_id,version,request_id,state,actor_id,actor_name,justification) VALUES(entity,event.version+1,req,p_body->>'status',p_actor,author,p_body->>'justification');
  RETURN jsonb_build_object('id',entity,'replayed',false);
 END IF;
 RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_recurrence_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_recurrence_action(uuid,text,jsonb) TO service_role;
COMMIT;

