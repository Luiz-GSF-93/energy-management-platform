BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Private, append-only sandbox intentions. No role grants or automatic jobs.
CREATE TABLE IF NOT EXISTS public.platform_sales_creation_intents (
 id uuid PRIMARY KEY, proposal_id uuid NOT NULL UNIQUE REFERENCES public.platform_sales_proposals(id),
 terms_revision integer NOT NULL, environment text NOT NULL DEFAULT 'SANDBOX' CHECK(environment='SANDBOX'),
 cycle integer NOT NULL DEFAULT 1 CHECK(cycle=1), snapshot jsonb NOT NULL, parameters jsonb NOT NULL,
 parameters_hash text NOT NULL CHECK(parameters_hash ~ '^[a-f0-9]{64}$'),
 origin text NOT NULL CHECK(length(btrim(origin)) BETWEEN 5 AND 500),
 consent boolean NOT NULL CHECK(consent), actor_id uuid NOT NULL, actor_name text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(proposal_id,terms_revision) REFERENCES public.platform_sales_offer_terms(proposal_id,revision)
);
CREATE TABLE IF NOT EXISTS public.platform_sales_creation_events (
 intent_id uuid NOT NULL REFERENCES public.platform_sales_creation_intents(id), version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('PREPARED','DISPATCHING','RECONCILIATION','CREATED')),
 lease uuid, payment_id text CHECK(payment_id ~ '^pay_[a-zA-Z0-9]{1,100}$'),
 actor_id uuid NOT NULL, actor_name text, note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(intent_id,version)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_creation_intents','platform_sales_creation_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.platform_sales_creation_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item public.platform_sales_creation_intents; latest public.platform_sales_creation_events;
 doc jsonb; params jsonb; summary jsonb; entity uuid; author text; due date; page integer; q text; filter_state text; next_state text; token uuid;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 PERFORM public.platform_team_owner(p_actor);author:=public.platform_sales_finance_name(p_actor);
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>5000 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
 IF p_action='list' THEN
  page:=(p_body->>'page')::integer;q:=p_body->>'search';filter_state:=p_body->>'state';
  IF page IS NULL OR page NOT BETWEEN 0 AND 1000 OR q IS NULL OR length(q)>100 OR filter_state IS NULL OR filter_state NOT IN ('','PREPARED','DISPATCHING','RECONCILIATION','CREATED') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
  RETURN (WITH rows AS (
   SELECT i.id,i.proposal_id,i.created_at,i.parameters->>'customer' customer_id,i.parameters->>'dueDate' due_date,
    i.snapshot->'proposal'->'snapshot'->>'initialTotalCents' gross_cents,e.state,e.payment_id
   FROM public.platform_sales_creation_intents i
   JOIN LATERAL(SELECT * FROM public.platform_sales_creation_events WHERE intent_id=i.id ORDER BY version DESC LIMIT 1)e ON true
   WHERE (q='' OR strpos(i.proposal_id::text,q)>0 OR strpos(i.id::text,q)>0 OR strpos(i.parameters->>'customer',q)>0) AND (filter_state='' OR e.state=filter_state)
  ) SELECT jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT * FROM rows ORDER BY created_at DESC,id LIMIT 25 OFFSET page*25)x),'total',(SELECT count(*) FROM rows),'environment','SANDBOX','externalCallsEnabled',false));
 END IF;
 entity:=(p_body->>'id')::uuid;
 IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023'; END IF;
 IF p_action='prepare' THEN
  IF p_body->>'customerId' IS NULL OR p_body->>'customerId' !~ '^cus_[a-zA-Z0-9]{1,100}$' OR p_body->>'origin' IS NULL OR length(btrim(p_body->>'origin')) NOT BETWEEN 5 AND 500 OR p_body->>'consent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Payer origin and consent required' USING ERRCODE='22023'; END IF;
  due:=(p_body->>'dueDate')::date;
  IF due IS NULL OR due<(now() AT TIME ZONE 'UTC')::date OR due>(now() AT TIME ZONE 'UTC')::date+90 THEN RAISE EXCEPTION 'Invalid due date' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-first-cycle:'||(p_body->>'proposalId'),0));
  SELECT * INTO item FROM public.platform_sales_creation_intents WHERE id=entity OR proposal_id=(p_body->>'proposalId')::uuid;
  IF FOUND THEN
   IF item.id IS DISTINCT FROM entity OR item.proposal_id IS DISTINCT FROM (p_body->>'proposalId')::uuid OR item.terms_revision IS DISTINCT FROM (p_body->>'termsRevision')::integer OR item.parameters->>'customer' IS DISTINCT FROM p_body->>'customerId' OR item.parameters->>'dueDate' IS DISTINCT FROM p_body->>'dueDate' OR item.origin IS DISTINCT FROM p_body->>'origin' OR item.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'First cycle already reserved or request changed' USING ERRCODE='P3641'; END IF;
   RETURN jsonb_build_object('id',item.id,'replayed',true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.platform_sales_asaas_bindings WHERE proposal_id=(p_body->>'proposalId')::uuid) THEN RAISE EXCEPTION 'First cycle already bound' USING ERRCODE='P3641'; END IF;
  doc:=public.read_platform_sales_offer_document(p_actor,(p_body->>'proposalId')::uuid,(p_body->>'termsRevision')::integer);
  IF doc->>'expired' IS DISTINCT FROM 'false' OR doc->'proposal'->'snapshot'->>'currency' IS DISTINCT FROM 'BRL' OR (doc->'proposal'->'snapshot'->'policy'->>'ends')::date<(now() AT TIME ZONE 'UTC')::date OR (doc->'proposal'->'snapshot'->>'initialTotalCents')::bigint NOT BETWEEN 1 AND 1000000000 THEN RAISE EXCEPTION 'Invalid or expired approved source' USING ERRCODE='22023'; END IF;
  params:=jsonb_build_object('customer',p_body->>'customerId','billingType','BOLETO','value',(doc->'proposal'->'snapshot'->>'initialTotalCents')::numeric/100,'dueDate',due::text,'externalReference',entity::text,'description','EnergyOS: homologacao sandbox de primeiro ciclo; sem ativacao de licenca.');
  INSERT INTO public.platform_sales_creation_intents(id,proposal_id,terms_revision,snapshot,parameters,parameters_hash,origin,consent,actor_id,actor_name)
   VALUES(entity,(p_body->>'proposalId')::uuid,(p_body->>'termsRevision')::integer,doc,params,encode(sha256(convert_to(params::text,'UTF8')),'hex'),p_body->>'origin',true,p_actor,author);
  INSERT INTO public.platform_sales_creation_events(intent_id,version,state,actor_id,actor_name,note) VALUES(entity,1,'PREPARED',p_actor,author,'Intencao preservada; nenhuma chamada externa executada.');
  RETURN jsonb_build_object('id',entity,'replayed',false);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-create:'||entity::text,0));
 SELECT * INTO item FROM public.platform_sales_creation_intents WHERE id=entity;
 IF NOT FOUND THEN RAISE EXCEPTION 'Intent not found' USING ERRCODE='P3640'; END IF;
 SELECT * INTO latest FROM public.platform_sales_creation_events WHERE intent_id=entity ORDER BY version DESC LIMIT 1;
 IF p_action='read' THEN RETURN jsonb_build_object('intent',to_jsonb(item),'events',(SELECT jsonb_agg(e ORDER BY version) FROM public.platform_sales_creation_events e WHERE intent_id=entity),'externalCallsEnabled',false); END IF;
 token:=(p_body->>'lease')::uuid;
 IF token IS NULL THEN RAISE EXCEPTION 'Lease required' USING ERRCODE='22023'; END IF;
 IF p_action IN ('claim','reconcile') THEN
  IF latest.state='CREATED' THEN RETURN jsonb_build_object('skip',true,'paymentId',latest.payment_id); END IF;
  IF p_action='claim' AND latest.state<>'PREPARED' THEN RAISE EXCEPTION 'Ambiguous attempt: reconcile only; never recreate' USING ERRCODE='P3641'; END IF;
  IF p_action='reconcile' AND (latest.state NOT IN ('DISPATCHING','RECONCILIATION') OR latest.state='DISPATCHING' AND latest.created_at>now()-interval '2 minutes') THEN RAISE EXCEPTION 'Not ready for reconciliation' USING ERRCODE='P3641'; END IF;
  IF p_action='claim' THEN
   doc:=public.read_platform_sales_offer_document(p_actor,item.proposal_id,item.terms_revision);
   IF doc->>'expired' IS DISTINCT FROM 'false' OR doc->'proposal'->'snapshot' IS DISTINCT FROM item.snapshot->'proposal'->'snapshot' OR (doc->'proposal'->'snapshot'->'policy'->>'ends')::date<(now() AT TIME ZONE 'UTC')::date OR (item.parameters->>'dueDate')::date<(now() AT TIME ZONE 'UTC')::date OR EXISTS(SELECT 1 FROM public.platform_sales_asaas_bindings WHERE proposal_id=item.proposal_id) THEN RAISE EXCEPTION 'Source changed, expired or cycle bound' USING ERRCODE='P3641'; END IF;
  END IF;
  INSERT INTO public.platform_sales_creation_events(intent_id,version,state,lease,actor_id,actor_name,note)
   VALUES(entity,latest.version+1,CASE WHEN p_action='claim' THEN 'DISPATCHING' ELSE 'RECONCILIATION' END,token,p_actor,author,CASE WHEN p_action='claim' THEN 'Reserva antes do envio; interrupcao exige reconciliacao.' ELSE 'Consulta de recuperacao; sem nova criacao.' END);
  RETURN jsonb_build_object('skip',false,'parameters',item.parameters);
 END IF;
 IF p_action='finish' THEN
  IF latest.state NOT IN ('DISPATCHING','RECONCILIATION') OR latest.lease IS DISTINCT FROM token OR latest.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Stale attempt' USING ERRCODE='P3641'; END IF;
  summary:=p_body->'summary';next_state:='RECONCILIATION';
  IF summary IS NOT NULL AND summary<>'null'::jsonb AND summary->>'id' ~ '^pay_[a-zA-Z0-9]{1,100}$' AND summary->>'customer'=item.parameters->>'customer' AND summary->>'reference'=item.id::text AND (summary->>'grossCents')::bigint=(item.snapshot->'proposal'->'snapshot'->>'initialTotalCents')::bigint AND summary->>'status' IN ('PENDING','OVERDUE','CONFIRMED','RECEIVED') THEN
   IF EXISTS(SELECT 1 FROM public.platform_sales_asaas_bindings WHERE proposal_id=item.proposal_id OR payment_id=summary->>'id') THEN RAISE EXCEPTION 'Binding conflict: review required' USING ERRCODE='P3641'; END IF;
   INSERT INTO public.platform_sales_asaas_bindings(id,proposal_id,payment_id,customer_id,company,gross_cents,source,actor_id,actor_name,justification)
    VALUES(item.id,item.proposal_id,summary->>'id',summary->>'customer',coalesce((SELECT payload->>'company' FROM public.platform_sales_leads WHERE receipt=(item.snapshot->'proposal'->>'receipt')::uuid),'Empresa nao disponivel'),(summary->>'grossCents')::bigint,item.snapshot->'proposal',p_actor,author,'Primeiro ciclo sandbox criado e conferido; sem contrato, recebimento real ou licenca.');
   next_state:='CREATED';
  END IF;
  INSERT INTO public.platform_sales_creation_events(intent_id,version,state,lease,payment_id,actor_id,actor_name,note)
   VALUES(entity,latest.version+1,next_state,token,CASE WHEN next_state='CREATED' THEN summary->>'id' ELSE NULL END,p_actor,author,CASE WHEN next_state='CREATED' THEN 'Criacao compativel registrada; nenhuma licenca ativada.' ELSE 'Resultado ausente ou divergente; nova criacao bloqueada, requer reconciliacao.' END);
  RETURN jsonb_build_object('state',next_state);
 END IF;
 RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_creation_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_creation_action(uuid,text,jsonb) TO service_role;
COMMIT;
