BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.platform_sales_creation_events ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'LEGACY';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sales_creation_phase' AND conrelid='public.platform_sales_creation_events'::regclass) THEN
  ALTER TABLE public.platform_sales_creation_events ADD CONSTRAINT sales_creation_phase CHECK(phase IN ('LEGACY','PREFLIGHT','PREFLIGHT_FAILED','POST_RESERVED','RECOVERY_AUTHORIZED','RECONCILE'));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.platform_sales_creation_recoveries (
 intent_id uuid PRIMARY KEY REFERENCES public.platform_sales_creation_intents(id),
 event_version integer NOT NULL, actor_id uuid NOT NULL, actor_name text,
 justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 500),
 legacy_acknowledged boolean NOT NULL, proof jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(intent_id,event_version) REFERENCES public.platform_sales_creation_events(intent_id,version)
);
ALTER TABLE public.platform_sales_creation_recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_sales_creation_recoveries FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS commercial_immutable ON public.platform_sales_creation_recoveries;
CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.platform_sales_creation_recoveries FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable();
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
 IF p_action='authorize_recovery' THEN
  IF latest.state<>'RECONCILIATION' OR EXISTS(SELECT 1 FROM public.platform_sales_creation_recoveries WHERE intent_id=entity)
   OR EXISTS(SELECT 1 FROM public.platform_sales_creation_events WHERE intent_id=entity AND phase='POST_RESERVED')
   OR EXISTS(SELECT 1 FROM public.platform_sales_asaas_bindings WHERE proposal_id=item.proposal_id)
   THEN RAISE EXCEPTION 'Recovery blocked' USING ERRCODE='P3641'; END IF;
  -- Old ambiguous records remain blocked. Only the explicitly approved sandbox pilot is eligible for exceptional review.
  IF latest.phase<>'PREFLIGHT_FAILED' AND NOT (
   entity='47f866fd-1170-4e80-9d5a-351e351c007c'::uuid
   AND item.proposal_id='21c17af2-f514-4612-bfbe-f66f05aad880'::uuid
   AND item.parameters->>'customer'='cus_000009420032'
   AND item.parameters->>'dueDate'='2026-10-20'
   AND (item.parameters->>'value')::numeric=2600
   AND latest.phase IN ('LEGACY','RECONCILE')
   AND p_body->>'legacyAcknowledged'='true'
  ) THEN RAISE EXCEPTION 'No proof of pre-POST failure; reconcile only' USING ERRCODE='P3641'; END IF;
  IF p_body->>'justification' IS NULL OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 500
   OR p_body->>'legacyAcknowledged' NOT IN ('true','false') OR p_body->>'legacyAcknowledged' IS NULL
   OR jsonb_typeof(p_body->'proof') IS DISTINCT FROM 'object'
   OR p_body->'proof'->>'customer' IS DISTINCT FROM item.parameters->>'customer'
   OR p_body->'proof'->>'reference' IS DISTINCT FROM entity::text
   OR p_body->'proof'->>'notificationDisabled' IS DISTINCT FROM 'true'
   OR p_body->'proof'->>'totalCount' IS DISTINCT FROM '0'
   OR p_body->'proof'->>'hasMore' IS DISTINCT FROM 'false'
   THEN RAISE EXCEPTION 'Fresh server-side GET evidence required' USING ERRCODE='22023'; END IF;
  doc:=public.read_platform_sales_offer_document(p_actor,item.proposal_id,item.terms_revision);
  IF doc->>'expired' IS DISTINCT FROM 'false' OR doc->'proposal'->'snapshot' IS DISTINCT FROM item.snapshot->'proposal'->'snapshot'
   OR (doc->'proposal'->'snapshot'->'policy'->>'ends')::date<(now() AT TIME ZONE 'UTC')::date
   OR (item.parameters->>'dueDate')::date<(now() AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'Source expired or changed' USING ERRCODE='P3641'; END IF;
  INSERT INTO public.platform_sales_creation_recoveries(intent_id,event_version,actor_id,actor_name,justification,legacy_acknowledged,proof)
   VALUES(entity,latest.version,p_actor,author,p_body->>'justification',(p_body->>'legacyAcknowledged')::boolean,p_body->'proof');
  INSERT INTO public.platform_sales_creation_events(intent_id,version,state,phase,actor_id,actor_name,note)
   VALUES(entity,latest.version+1,'RECONCILIATION','RECOVERY_AUTHORIZED',p_actor,author,'Recuperacao sandbox de uso unico autorizada; evidencia e justificativa preservadas.');
  RETURN jsonb_build_object('state','RECONCILIATION','phase','RECOVERY_AUTHORIZED');
 END IF;
 token:=(p_body->>'lease')::uuid;
 IF token IS NULL THEN RAISE EXCEPTION 'Lease required' USING ERRCODE='22023'; END IF;
 IF p_action IN ('claim','claim_recovery','reconcile') THEN
  IF latest.state='CREATED' THEN RETURN jsonb_build_object('skip',true,'paymentId',latest.payment_id); END IF;
  IF p_action='claim_recovery' AND (latest.phase<>'RECOVERY_AUTHORIZED' OR NOT EXISTS(SELECT 1 FROM public.platform_sales_creation_recoveries WHERE intent_id=entity) OR EXISTS(SELECT 1 FROM public.platform_sales_creation_events WHERE intent_id=entity AND phase='POST_RESERVED')) THEN RAISE EXCEPTION 'Recovery already consumed or ineligible' USING ERRCODE='P3641'; END IF;
  IF p_action='claim' AND latest.state<>'PREPARED' THEN RAISE EXCEPTION 'Ambiguous attempt: reconcile only; never recreate' USING ERRCODE='P3641'; END IF;
  IF p_action='reconcile' AND (latest.state NOT IN ('DISPATCHING','RECONCILIATION') OR latest.state='DISPATCHING' AND latest.created_at>now()-interval '2 minutes') THEN RAISE EXCEPTION 'Not ready for reconciliation' USING ERRCODE='P3641'; END IF;
  IF p_action IN ('claim','claim_recovery') THEN
   doc:=public.read_platform_sales_offer_document(p_actor,item.proposal_id,item.terms_revision);
   IF doc->>'expired' IS DISTINCT FROM 'false' OR doc->'proposal'->'snapshot' IS DISTINCT FROM item.snapshot->'proposal'->'snapshot' OR (doc->'proposal'->'snapshot'->'policy'->>'ends')::date<(now() AT TIME ZONE 'UTC')::date OR (item.parameters->>'dueDate')::date<(now() AT TIME ZONE 'UTC')::date OR EXISTS(SELECT 1 FROM public.platform_sales_asaas_bindings WHERE proposal_id=item.proposal_id) THEN RAISE EXCEPTION 'Source changed, expired or cycle bound' USING ERRCODE='P3641'; END IF;
  END IF;
  INSERT INTO public.platform_sales_creation_events(intent_id,version,state,phase,lease,actor_id,actor_name,note)
   VALUES(entity,latest.version+1,CASE WHEN p_action IN ('claim','claim_recovery') THEN 'DISPATCHING' ELSE 'RECONCILIATION' END,CASE WHEN p_action IN ('claim','claim_recovery') THEN 'PREFLIGHT' ELSE 'RECONCILE' END,token,p_actor,author,CASE WHEN p_action IN ('claim','claim_recovery') THEN 'Pre-validacao reservada; nenhum POST executado nesta fase.' ELSE 'Consulta de recuperacao; sem nova criacao.' END);
  RETURN jsonb_build_object('skip',false,'parameters',item.parameters);
 END IF;
 IF p_action IN ('fail_preflight','reserve_post') THEN
  IF latest.state<>'DISPATCHING' OR latest.phase<>'PREFLIGHT' OR latest.lease IS DISTINCT FROM token OR latest.actor_id IS DISTINCT FROM p_actor
   THEN RAISE EXCEPTION 'Stale preflight' USING ERRCODE='P3641'; END IF;
  INSERT INTO public.platform_sales_creation_events(intent_id,version,state,phase,lease,actor_id,actor_name,note)
   VALUES(entity,latest.version+1,CASE WHEN p_action='fail_preflight' THEN 'RECONCILIATION' ELSE 'DISPATCHING' END,
    CASE WHEN p_action='fail_preflight' THEN 'PREFLIGHT_FAILED' ELSE 'POST_RESERVED' END,token,p_actor,author,
    CASE WHEN p_action='fail_preflight' THEN 'Pre-validacao falhou antes do POST; nenhum envio de criacao executado.' ELSE 'Inicio de POST reservado; resultado incerto permite apenas consulta.' END);
  RETURN jsonb_build_object('state',CASE WHEN p_action='fail_preflight' THEN 'RECONCILIATION' ELSE 'DISPATCHING' END);
 END IF;
 IF p_action='finish' THEN
  IF latest.state NOT IN ('DISPATCHING','RECONCILIATION') OR (latest.state='DISPATCHING' AND latest.phase<>'POST_RESERVED') OR latest.lease IS DISTINCT FROM token OR latest.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Stale attempt' USING ERRCODE='P3641'; END IF;
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
