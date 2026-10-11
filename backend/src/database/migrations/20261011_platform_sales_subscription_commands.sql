BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Additive private command ledger. External routes are delivered gated off.
CREATE TABLE IF NOT EXISTS public.platform_sales_subscription_commands (
 id uuid PRIMARY KEY, agreement_id uuid NOT NULL UNIQUE REFERENCES public.platform_sales_billing_agreements(id),
 environment text NOT NULL DEFAULT 'SANDBOX' CHECK(environment='SANDBOX'),
 parameters jsonb NOT NULL, parameters_hash text NOT NULL CHECK(parameters_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL, actor_name text, justification text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.platform_sales_subscription_command_events (
 command_id uuid NOT NULL REFERENCES public.platform_sales_subscription_commands(id),
 version integer NOT NULL CHECK(version>0), request_id uuid NOT NULL UNIQUE,
 state text NOT NULL CHECK(state IN ('PREPARED','POST_RESERVED','AMBIGUOUS','CREATED')), evidence jsonb NOT NULL DEFAULT '{}', actor_id uuid NOT NULL, actor_name text,
 justification text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(command_id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_sales_subscription_remote_unique ON public.platform_sales_subscription_command_events ((evidence->>'id')) WHERE state='CREATED';
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_subscription_commands','platform_sales_subscription_command_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.platform_sales_subscription_command_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item public.platform_sales_subscription_commands; agreement public.platform_sales_billing_agreements;
 intent public.platform_sales_creation_intents; entity uuid; agreement_key uuid; doc jsonb; author text;
 latest public.platform_sales_subscription_command_events; req uuid; evidence jsonb; version_number integer;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501'; END IF;
 IF p_action='read' THEN
  PERFORM public.read_platform_sales_finance(p_actor,0,'','',NULL,NULL,NULL);
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
  PERFORM public.platform_team_owner(p_actor);
 END IF;
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>5000 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023'; END IF;
 agreement_key:=(p_body->>'agreementId')::uuid;
 IF agreement_key IS NULL THEN RAISE EXCEPTION 'Agreement required' USING ERRCODE='22023'; END IF;
 IF p_action='read' THEN
  IF p_body - ARRAY['agreementId']<>'{}' THEN RAISE EXCEPTION 'Invalid read' USING ERRCODE='22023'; END IF;
  SELECT * INTO item FROM public.platform_sales_subscription_commands WHERE agreement_id=agreement_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('command',NULL,'events','[]'::jsonb,'externalCallsEnabled',false); END IF;
  RETURN jsonb_build_object('command',to_jsonb(item)||jsonb_build_object('current_actor_name',public.platform_sales_finance_name(item.actor_id)),
   'events',(SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('current_actor_name',public.platform_sales_finance_name(e.actor_id)) ORDER BY version) FROM public.platform_sales_subscription_command_events e WHERE e.command_id=item.id),'externalCallsEnabled',false);
 END IF;
 IF p_action IN ('authorize','reserve','finish','ambiguous','reconcile') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-subscription-agreement:'||agreement_key::text,0));
  SELECT * INTO item FROM public.platform_sales_subscription_commands WHERE agreement_id=agreement_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Command not found' USING ERRCODE='P3670'; END IF;
  SELECT * INTO latest FROM public.platform_sales_subscription_command_events WHERE command_id=item.id ORDER BY version DESC LIMIT 1;
  IF p_action='reserve' OR p_action='authorize' AND latest.state='PREPARED' THEN
   SELECT * INTO agreement FROM public.platform_sales_billing_agreements WHERE id=agreement_key;
   SELECT * INTO intent FROM public.platform_sales_creation_intents WHERE id=agreement.intent_id;
   doc:=public.read_platform_sales_offer_document(p_actor,agreement.proposal_id,intent.terms_revision);
   IF doc->>'expired' IS DISTINCT FROM 'false' OR doc->'proposal'->'snapshot' IS DISTINCT FROM agreement.source->'proposal'->'snapshot' OR agreement.next_due_date<(now() AT TIME ZONE 'UTC')::date OR (SELECT state FROM public.platform_sales_billing_events WHERE agreement_id=agreement_key ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL' THEN RAISE EXCEPTION 'Source invalid' USING ERRCODE='P3671'; END IF;
  END IF;
  IF p_action='authorize' THEN
   IF p_body - ARRAY['agreementId']<>'{}' THEN RAISE EXCEPTION 'Invalid authorize' USING ERRCODE='22023'; END IF;
   RETURN jsonb_build_object('parameters',item.parameters,'state',latest.state);
  END IF;
  IF p_body - ARRAY['agreementId','requestId','evidence','justification']<>'{}' OR NOT p_body ?& ARRAY['agreementId','requestId','evidence','justification'] OR p_body->>'justification' IS NULL OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 500 THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023'; END IF;
  req:=(p_body->>'requestId')::uuid;evidence:=p_body->'evidence';
  IF req IS NULL OR jsonb_typeof(evidence)<>'object' THEN RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.platform_sales_subscription_command_events WHERE request_id=req) THEN RAISE EXCEPTION 'Command request already consumed' USING ERRCODE='P3671'; END IF;
  IF p_action='reserve' THEN
   IF latest.state<>'PREPARED' OR evidence - ARRAY['customer','reference','notificationDisabled','totalCount','hasMore','checkedAt']<>'{}' OR NOT evidence ?& ARRAY['customer','reference','notificationDisabled','totalCount','hasMore','checkedAt'] OR evidence->>'customer' IS DISTINCT FROM item.parameters->>'customer' OR evidence->>'reference' IS DISTINCT FROM item.parameters->>'externalReference' OR evidence->>'notificationDisabled' IS DISTINCT FROM 'true' OR evidence->>'totalCount' IS DISTINCT FROM '0' OR evidence->>'hasMore' IS DISTINCT FROM 'false' OR evidence->>'checkedAt' IS NULL OR (evidence->>'checkedAt')::timestamptz NOT BETWEEN now()-interval '30 seconds' AND now()+interval '2 seconds' THEN RAISE EXCEPTION 'Reservation refused' USING ERRCODE='P3671'; END IF;
   version_number:=latest.version+1;
   INSERT INTO public.platform_sales_subscription_command_events(command_id,version,request_id,state,evidence,actor_id,actor_name,justification) VALUES(item.id,version_number,req,'POST_RESERVED',evidence,p_actor,public.platform_sales_finance_name(p_actor),p_body->>'justification');
   RETURN jsonb_build_object('parameters',item.parameters,'reserved',true);
  ELSIF p_action='ambiguous' THEN
   IF latest.state<>'POST_RESERVED' OR evidence<>'{}' THEN RAISE EXCEPTION 'Invalid ambiguous result' USING ERRCODE='P3671'; END IF;
  ELSIF p_action IN ('finish','reconcile') THEN
   IF latest.state NOT IN ('POST_RESERVED','AMBIGUOUS') OR p_action='finish' AND latest.state<>'POST_RESERVED' OR evidence - ARRAY['id','customer','reference','grossCents','cycle','billingType','nextDueDate','endDate','status','deleted']<>'{}' OR NOT evidence ?& ARRAY['id','customer','reference','grossCents','cycle','billingType','nextDueDate','endDate','status','deleted'] OR evidence->>'id' !~ '^sub_[a-zA-Z0-9]{1,100}$' OR evidence->>'customer' IS DISTINCT FROM item.parameters->>'customer' OR evidence->>'reference' IS DISTINCT FROM item.parameters->>'externalReference' OR (evidence->>'grossCents')::bigint IS DISTINCT FROM (item.parameters->>'value')::numeric*100 OR evidence->>'cycle' IS DISTINCT FROM item.parameters->>'cycle' OR evidence->>'billingType' IS DISTINCT FROM 'BOLETO' OR (evidence->>'nextDueDate')::date<(item.parameters->>'nextDueDate')::date OR evidence->>'endDate' IS DISTINCT FROM item.parameters->>'endDate' OR evidence->>'status' NOT IN ('ACTIVE','INACTIVE','EXPIRED') OR evidence->>'deleted' NOT IN ('true','false') OR evidence->>'id' IS NULL OR evidence->>'nextDueDate' IS NULL OR evidence->>'status' IS NULL OR evidence->>'deleted' IS NULL THEN RAISE EXCEPTION 'Result mismatch' USING ERRCODE='P3671'; END IF;
   IF EXISTS(SELECT 1 FROM public.platform_sales_subscription_command_events e WHERE e.state='CREATED' AND e.evidence->>'id'=p_body->'evidence'->>'id') THEN RAISE EXCEPTION 'Subscription already bound' USING ERRCODE='P3671'; END IF;
  ELSE RAISE EXCEPTION 'Unknown command' USING ERRCODE='22023'; END IF;
  INSERT INTO public.platform_sales_subscription_command_events(command_id,version,request_id,state,evidence,actor_id,actor_name,justification) VALUES(item.id,latest.version+1,req,CASE WHEN p_action='ambiguous' THEN 'AMBIGUOUS' ELSE 'CREATED' END,evidence,p_actor,public.platform_sales_finance_name(p_actor),p_body->>'justification');
  RETURN jsonb_build_object('id',item.id,'state',CASE WHEN p_action='ambiguous' THEN 'AMBIGUOUS' ELSE 'CREATED' END);
 END IF;
 IF p_action<>'prepare' OR p_body - ARRAY['id','agreementId','justification']<>'{}' OR NOT p_body ?& ARRAY['id','agreementId','justification'] OR p_body->>'justification' IS NULL OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 500 THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023'; END IF;
 entity:=(p_body->>'id')::uuid;
 IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-subscription-agreement:'||agreement_key::text,0));
 SELECT * INTO item FROM public.platform_sales_subscription_commands WHERE id=entity OR agreement_id=agreement_key;
 IF FOUND THEN
  IF item.id IS DISTINCT FROM entity OR item.agreement_id IS DISTINCT FROM agreement_key OR item.actor_id IS DISTINCT FROM p_actor OR item.justification IS DISTINCT FROM p_body->>'justification' THEN RAISE EXCEPTION 'Command conflict' USING ERRCODE='P3671'; END IF;
  RETURN jsonb_build_object('id',entity,'replayed',true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-recurrence:'||agreement_key::text,0));
 SELECT * INTO agreement FROM public.platform_sales_billing_agreements WHERE id=agreement_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'Agreement not found' USING ERRCODE='P3670'; END IF;
 IF (SELECT state FROM public.platform_sales_billing_events WHERE agreement_id=agreement_key ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'APPROVED_INTERNAL' THEN RAISE EXCEPTION 'Agreement not approved' USING ERRCODE='P3671'; END IF;
 SELECT * INTO intent FROM public.platform_sales_creation_intents WHERE id=agreement.intent_id;
 doc:=public.read_platform_sales_offer_document(p_actor,agreement.proposal_id,intent.terms_revision);
 IF doc->>'expired' IS DISTINCT FROM 'false' OR doc->'proposal'->'snapshot' IS DISTINCT FROM agreement.source->'proposal'->'snapshot' OR agreement.next_due_date<(now() AT TIME ZONE 'UTC')::date OR agreement.parameters_hash IS DISTINCT FROM encode(sha256(convert_to(agreement.parameters::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Source invalid' USING ERRCODE='P3671'; END IF;
 author:=public.platform_sales_finance_name(p_actor);
 INSERT INTO public.platform_sales_subscription_commands(id,agreement_id,parameters,parameters_hash,actor_id,actor_name,justification) VALUES(entity,agreement_key,agreement.parameters,agreement.parameters_hash,p_actor,author,p_body->>'justification');
 INSERT INTO public.platform_sales_subscription_command_events(command_id,version,request_id,state,actor_id,actor_name,justification) VALUES(entity,1,entity,'PREPARED',p_actor,author,p_body->>'justification');
 RETURN jsonb_build_object('id',entity,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_subscription_command_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_subscription_command_action(uuid,text,jsonb) TO service_role;
COMMIT;
