BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.platform_sales_cycle_bindings (
 id uuid PRIMARY KEY,agreement_id uuid NOT NULL,sequence integer NOT NULL,
 payment_id text NOT NULL UNIQUE CHECK(payment_id ~ '^pay_[a-zA-Z0-9]{1,100}$'),
 event_id uuid NOT NULL REFERENCES public.platform_sales_asaas_inbox(id),
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(agreement_id,sequence) REFERENCES public.platform_sales_billing_cycles(agreement_id,sequence),UNIQUE(agreement_id,sequence)
);
CREATE TABLE IF NOT EXISTS public.platform_sales_cycle_attempts (
 id uuid PRIMARY KEY,binding_id uuid NOT NULL,agreement_id uuid NOT NULL,sequence integer NOT NULL,
 payment_id text NOT NULL,event_id uuid NOT NULL REFERENCES public.platform_sales_asaas_inbox(id),
 FOREIGN KEY(agreement_id,sequence) REFERENCES public.platform_sales_billing_cycles(agreement_id,sequence),
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.platform_sales_cycle_checks (
 attempt_id uuid PRIMARY KEY REFERENCES public.platform_sales_cycle_attempts(id),
 status text NOT NULL CHECK(status IN ('VERIFIED','REVIEW')),summary jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_cycle_bindings','platform_sales_cycle_attempts','platform_sales_cycle_checks'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;
CREATE OR REPLACE FUNCTION public.platform_sales_cycle_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE a public.platform_sales_billing_agreements; c public.platform_sales_billing_cycles;
 b public.platform_sales_cycle_bindings; i public.platform_sales_asaas_inbox;
 attempt public.platform_sales_cycle_attempts; old public.platform_sales_cycle_checks;
 subscription jsonb; s jsonb; valid boolean; entity uuid; lease uuid; author text; result jsonb; page integer; q text; filter_state text;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501';END IF;
 IF p_action='read' THEN PERFORM public.read_platform_sales_finance(p_actor,0,'','',NULL,NULL,NULL);
 ELSE PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));PERFORM public.platform_team_owner(p_actor);END IF;
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>5000 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023';END IF;
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action='read' THEN
  IF p_body-ARRAY['agreementId','page','search','state']<>'{}' OR NOT p_body ?& ARRAY['page','search','state'] THEN RAISE EXCEPTION 'Filters required' USING ERRCODE='22023';END IF;
  entity:=(p_body->>'agreementId')::uuid;page:=(p_body->>'page')::integer;q:=p_body->>'search';filter_state:=p_body->>'state';
  IF page IS NULL OR page NOT BETWEEN 0 AND 1000 OR q IS NULL OR length(q)>100 OR filter_state IS NULL OR filter_state NOT IN ('','UNKNOWN','PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED','DELETED') THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023';END IF;
  IF entity IS NOT NULL THEN
   SELECT * INTO a FROM public.platform_sales_billing_agreements WHERE id=entity;
   IF NOT FOUND THEN RAISE EXCEPTION 'Agreement missing' USING ERRCODE='P3680';END IF;
  END IF;
  WITH source AS (
   SELECT b.id,b.agreement_id,b.sequence,b.payment_id,b.actor_id,b.actor_name,b.justification,
    a.proposal_id,a.customer_id,c.due_date,c.competence,c.gross_cents::text expected_cents,
    coalesce((SELECT av.company FROM public.platform_sales_asaas_bindings av WHERE av.payment_id=a.first_payment_id),a.source->'proposal'->'snapshot'->>'company','Empresa não informada') company,
    x.status check_result,x.summary,x.created_at checked_at,
    EXISTS(SELECT 1 FROM public.platform_sales_asaas_bindings av WHERE av.payment_id=b.payment_id) collision,
    EXISTS(SELECT 1 FROM public.platform_sales_asaas_inbox ev WHERE ev.payment_id=b.payment_id AND ev.received_at>x.created_at) pending_event,
    EXISTS(SELECT 1 FROM public.platform_sales_cycle_attempts at WHERE at.binding_id=b.id AND NOT EXISTS(SELECT 1 FROM public.platform_sales_cycle_checks ch WHERE ch.attempt_id=at.id) AND at.created_at>coalesce(x.created_at,'-infinity'::timestamptz)) processing
   FROM public.platform_sales_cycle_bindings b JOIN public.platform_sales_billing_agreements a ON a.id=b.agreement_id
   JOIN public.platform_sales_billing_cycles c ON c.agreement_id=b.agreement_id AND c.sequence=b.sequence
   LEFT JOIN LATERAL(SELECT ch.* FROM public.platform_sales_cycle_checks ch JOIN public.platform_sales_cycle_attempts at ON at.id=ch.attempt_id WHERE at.binding_id=b.id ORDER BY at.created_at DESC,at.id DESC LIMIT 1)x ON true
   WHERE (entity IS NULL OR b.agreement_id=entity) AND (q='' OR strpos(lower(coalesce((SELECT av.company FROM public.platform_sales_asaas_bindings av WHERE av.payment_id=a.first_payment_id),a.source->'proposal'->'snapshot'->>'company','')),lower(q))>0 OR strpos(b.payment_id,q)>0 OR strpos(a.id::text,q)>0)
  ), projected AS (
   SELECT source.*,CASE WHEN check_result='VERIFIED' AND NOT collision AND NOT pending_event AND NOT processing THEN summary->>'status' ELSE 'UNKNOWN' END state,
    CASE WHEN collision THEN 'DUPLICATE_ORIGIN' WHEN processing THEN 'CHECK_IN_PROGRESS' WHEN pending_event THEN 'EVENT_AFTER_CHECK' WHEN check_result IS DISTINCT FROM 'VERIFIED' THEN 'CHECK_REQUIRED' END reason
   FROM source
  ), filtered AS (SELECT * FROM projected WHERE filter_state='' OR state=filter_state)
  SELECT jsonb_build_object('environment','SANDBOX','total',(SELECT count(*) FROM filtered),'rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT *,public.platform_sales_finance_name(actor_id) current_actor_name FROM filtered ORDER BY due_date DESC,id LIMIT 25 OFFSET page*25)x),
   'totals',(SELECT jsonb_build_object('receivedGrossCents',coalesce(sum((summary->>'grossCents')::bigint) FILTER(WHERE state='RECEIVED'),0)::text,'receivedKnownNetCents',coalesce(sum((summary->>'netCents')::bigint) FILTER(WHERE state='RECEIVED'),0)::text,'receivedNetMissingCount',count(*) FILTER(WHERE state='RECEIVED' AND summary->>'netCents' IS NULL),'reviewCount',count(*) FILTER(WHERE state='UNKNOWN'),'pendingCount',count(*) FILTER(WHERE state='PENDING')) FROM filtered)) INTO result;
  IF entity IS NOT NULL THEN result:=result||jsonb_build_object(
   'cycles',(SELECT jsonb_agg(to_jsonb(c) ORDER BY sequence) FROM public.platform_sales_billing_cycles c WHERE agreement_id=entity),
   'candidateCount',(SELECT count(*) FROM public.platform_sales_asaas_inbox WHERE summary->>'reference'=entity::text AND summary->>'customer'=a.customer_id),
   'candidates',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT id,event,payment_id,summary,received_at FROM public.platform_sales_asaas_inbox WHERE summary->>'reference'=entity::text AND summary->>'customer'=a.customer_id ORDER BY received_at DESC,id LIMIT 25 OFFSET page*25)x),
   'history',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT at.id,at.binding_id,at.actor_id,at.actor_name,public.platform_sales_finance_name(at.actor_id) current_actor_name,at.justification,at.created_at,coalesce(ch.status,'PROCESSING') status,ch.summary FROM public.platform_sales_cycle_attempts at LEFT JOIN public.platform_sales_cycle_checks ch ON ch.attempt_id=at.id WHERE at.agreement_id=entity ORDER BY at.created_at DESC,at.id LIMIT 50)x));END IF;
  RETURN result;
 END IF;
 IF p_action='claim' THEN
  IF p_body-ARRAY['id','agreementId','sequence','eventId','lease','justification']<>'{}' OR NOT p_body ?& ARRAY['id','agreementId','sequence','eventId','lease','justification'] OR p_body->>'justification' IS NULL OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 500 THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='22023';END IF;
  entity:=(p_body->>'agreementId')::uuid;lease:=(p_body->>'lease')::uuid;
  IF entity IS NULL OR lease IS NULL OR (p_body->>'id')::uuid IS NULL OR (p_body->>'eventId')::uuid IS NULL THEN RAISE EXCEPTION 'IDs required' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-cycle:'||entity::text,0));
  SELECT * INTO a FROM public.platform_sales_billing_agreements WHERE id=entity;
  SELECT * INTO c FROM public.platform_sales_billing_cycles WHERE agreement_id=entity AND sequence=(p_body->>'sequence')::integer;
  SELECT * INTO i FROM public.platform_sales_asaas_inbox WHERE id=(p_body->>'eventId')::uuid;
  SELECT e.evidence INTO subscription FROM public.platform_sales_subscription_commands sc JOIN public.platform_sales_subscription_command_events e ON e.command_id=sc.id WHERE sc.agreement_id=entity ORDER BY e.version DESC LIMIT 1;
  IF a.id IS NULL OR c.agreement_id IS NULL OR i.id IS NULL OR subscription->>'id' IS NULL OR subscription->>'reference' IS DISTINCT FROM entity::text OR subscription->>'customer' IS DISTINCT FROM a.customer_id OR i.summary->>'reference' IS DISTINCT FROM entity::text OR i.summary->>'customer' IS DISTINCT FROM a.customer_id OR i.summary->>'grossCents' IS DISTINCT FROM c.gross_cents::text OR i.payment_id=a.first_payment_id OR EXISTS(SELECT 1 FROM public.platform_sales_asaas_bindings av WHERE av.payment_id=i.payment_id) THEN RAISE EXCEPTION 'Source mismatch' USING ERRCODE='P3681';END IF;
  IF (SELECT state FROM public.platform_sales_subscription_command_events e JOIN public.platform_sales_subscription_commands sc ON sc.id=e.command_id WHERE sc.agreement_id=entity ORDER BY version DESC LIMIT 1) IS DISTINCT FROM 'CREATED' THEN RAISE EXCEPTION 'Subscription not confirmed' USING ERRCODE='P3681';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-cycle-payment:'||i.payment_id,0));
  SELECT * INTO b FROM public.platform_sales_cycle_bindings WHERE agreement_id=entity AND sequence=c.sequence;
  IF b.id IS NOT NULL AND b.payment_id IS DISTINCT FROM i.payment_id THEN RAISE EXCEPTION 'Cycle already linked' USING ERRCODE='P3681';END IF;
  SELECT * INTO attempt FROM public.platform_sales_cycle_attempts WHERE agreement_id=entity AND sequence=c.sequence ORDER BY created_at DESC,id DESC LIMIT 1;
  IF attempt.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.platform_sales_cycle_checks WHERE attempt_id=attempt.id) AND attempt.created_at>clock_timestamp()-interval '30 seconds' THEN RAISE EXCEPTION 'Concurrent check' USING ERRCODE='P3681';END IF;
  INSERT INTO public.platform_sales_cycle_attempts(id,binding_id,agreement_id,sequence,payment_id,event_id,actor_id,actor_name,justification) VALUES(lease,coalesce(b.id,(p_body->>'id')::uuid),entity,c.sequence,i.payment_id,i.id,p_actor,author,p_body->>'justification');
  RETURN jsonb_build_object('lease',lease,'paymentId',i.payment_id,'customer',a.customer_id,'reference',a.id,'subscription',subscription->>'id','dueDate',c.due_date,'grossCents',c.gross_cents);
 END IF;
 IF p_action='finish' THEN
  IF p_body-ARRAY['lease','summary']<>'{}' OR NOT p_body ?& ARRAY['lease','summary'] THEN RAISE EXCEPTION 'Invalid finish' USING ERRCODE='22023';END IF;
  lease:=(p_body->>'lease')::uuid;s:=p_body->'summary';SELECT * INTO attempt FROM public.platform_sales_cycle_attempts WHERE id=lease;
  IF attempt.id IS NULL THEN RAISE EXCEPTION 'Attempt missing' USING ERRCODE='P3680';END IF;
  IF attempt.actor_id<>p_actor THEN RAISE EXCEPTION 'Actor mismatch' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-cycle:'||attempt.agreement_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-cycle-payment:'||attempt.payment_id,0));
  SELECT * INTO old FROM public.platform_sales_cycle_checks WHERE attempt_id=lease;
  IF FOUND THEN IF old.summary IS DISTINCT FROM s THEN RAISE EXCEPTION 'Changed finish replay' USING ERRCODE='P3681';END IF;RETURN jsonb_build_object('status',old.status,'replayed',true);END IF;
  IF (SELECT id FROM public.platform_sales_cycle_attempts WHERE agreement_id=attempt.agreement_id AND sequence=attempt.sequence ORDER BY created_at DESC,id DESC LIMIT 1)<>lease THEN RAISE EXCEPTION 'Stale attempt' USING ERRCODE='P3681';END IF;
  IF s IS NOT NULL AND s<>'null'::jsonb AND (jsonb_typeof(s)<>'object' OR s-ARRAY['id','customer','reference','subscription','dueDate','grossCents','netCents','status']<>'{}' OR NOT s ?& ARRAY['id','customer','reference','subscription','dueDate','grossCents','netCents','status']) THEN RAISE EXCEPTION 'Invalid summary' USING ERRCODE='22023';END IF;
  SELECT * INTO a FROM public.platform_sales_billing_agreements WHERE id=attempt.agreement_id;SELECT * INTO c FROM public.platform_sales_billing_cycles WHERE agreement_id=attempt.agreement_id AND sequence=attempt.sequence;
  SELECT e.evidence INTO subscription FROM public.platform_sales_subscription_commands sc JOIN public.platform_sales_subscription_command_events e ON e.command_id=sc.id WHERE sc.agreement_id=a.id ORDER BY version DESC LIMIT 1;
  valid:=coalesce(s->>'id'=attempt.payment_id AND s->>'customer'=a.customer_id AND s->>'reference'=a.id::text AND s->>'subscription'=subscription->>'id' AND s->>'dueDate'=c.due_date::text AND s->>'grossCents'=c.gross_cents::text AND (s->>'netCents' IS NULL OR (s->>'netCents')::bigint BETWEEN 0 AND c.gross_cents) AND s->>'status' IN ('PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED','DELETED') AND NOT EXISTS(SELECT 1 FROM public.platform_sales_asaas_bindings av WHERE av.payment_id=attempt.payment_id) AND NOT EXISTS(SELECT 1 FROM public.platform_sales_cycle_bindings x WHERE (x.payment_id=attempt.payment_id OR x.agreement_id=attempt.agreement_id AND x.sequence=attempt.sequence) AND (x.agreement_id<>attempt.agreement_id OR x.sequence<>attempt.sequence OR x.payment_id<>attempt.payment_id)),false);
  IF valid THEN INSERT INTO public.platform_sales_cycle_bindings(id,agreement_id,sequence,payment_id,event_id,actor_id,actor_name,justification) VALUES(attempt.binding_id,attempt.agreement_id,attempt.sequence,attempt.payment_id,attempt.event_id,attempt.actor_id,attempt.actor_name,attempt.justification) ON CONFLICT(agreement_id,sequence) DO NOTHING;END IF;
  INSERT INTO public.platform_sales_cycle_checks(attempt_id,status,summary) VALUES(lease,CASE WHEN valid THEN 'VERIFIED' ELSE 'REVIEW' END,s);
  RETURN jsonb_build_object('status',CASE WHEN valid THEN 'VERIFIED' ELSE 'REVIEW' END);
 END IF;
 RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_cycle_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_cycle_action(uuid,text,jsonb) TO service_role;
COMMIT;
