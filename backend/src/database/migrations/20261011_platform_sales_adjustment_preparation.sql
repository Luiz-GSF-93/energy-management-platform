BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.platform_sales_adjustment_requests (
 id uuid PRIMARY KEY,environment text NOT NULL DEFAULT 'SANDBOX' CHECK(environment='SANDBOX'),
 kind text NOT NULL CHECK(kind IN ('REFUND_PAYMENT','CANCEL_SUBSCRIPTION')),
 origin_kind text NOT NULL CHECK(origin_kind IN ('ONCE','CYCLE','SUBSCRIPTION')),source_id uuid NOT NULL,
 remote_id text NOT NULL,source jsonb NOT NULL,actor_id uuid NOT NULL,actor_name text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='REFUND_PAYMENT' AND origin_kind IN ('ONCE','CYCLE')) OR (kind='CANCEL_SUBSCRIPTION' AND origin_kind='SUBSCRIPTION'))
);
CREATE TABLE IF NOT EXISTS public.platform_sales_adjustment_events (
 request_id uuid NOT NULL REFERENCES public.platform_sales_adjustment_requests(id),version integer NOT NULL CHECK(version>0),
 command_id uuid NOT NULL UNIQUE,action text NOT NULL CHECK(action IN ('PREPARE','REVISE','CONFIRM_INTERNAL','REJECT','WITHDRAW')),
 state text NOT NULL CHECK(state IN ('PREPARED','WAITING_EVIDENCE','CONFIRMED_INTERNAL','REJECTED','WITHDRAWN')),
 parameters jsonb NOT NULL,source jsonb NOT NULL,blockers jsonb NOT NULL,actor_id uuid NOT NULL,actor_name text,
 justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(request_id,version)
);
CREATE INDEX IF NOT EXISTS platform_sales_adjustment_origin_idx ON public.platform_sales_adjustment_requests(kind,remote_id,created_at DESC,id DESC);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_adjustment_requests','platform_sales_adjustment_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;
-- Source resolution is server-side and private; no remote IDs or evidence accepted from clients.
CREATE OR REPLACE FUNCTION public.platform_sales_adjustment_source(p_actor uuid,p_origin text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb;d jsonb;e jsonb;current_state text;a public.platform_sales_billing_agreements;r public.platform_sales_evidence_attempts;v public.platform_sales_evidence_revisions;
BEGIN
 PERFORM public.read_platform_sales_finance(p_actor,0,'','',NULL,NULL,NULL);
 IF p_origin IN ('ONCE','CYCLE') THEN
  s:=public.platform_sales_evidence_source(p_actor,p_origin,p_id);
  IF p_origin='ONCE' THEN current_state:=public.read_platform_sales_finance_consolidated(p_actor,0,'','',NULL,NULL,false,p_id)->'rows'->0->>'status';
  ELSE SELECT x->>'state' INTO current_state FROM jsonb_array_elements(public.platform_sales_cycle_action(p_actor,'read',jsonb_build_object('page',0,'search',s->>'paymentId','state',''))->'rows')x WHERE x->>'id'=p_id::text;END IF;
  SELECT * INTO r FROM public.platform_sales_evidence_attempts WHERE kind=p_origin AND source_id=p_id ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT * INTO v FROM public.platform_sales_evidence_revisions WHERE attempt_id=r.id;
  RETURN jsonb_build_object('remoteId',s->>'paymentId','verified',s->'verified','binding',s,'currentPaymentState',current_state,'evidenceId',r.id,'evidenceStatus',v.status,'evidence',v.evidence,'evidenceMatches',r.source=s AND v.evidence->'payment'->>'status'=current_state);
 ELSIF p_origin='SUBSCRIPTION' THEN
  SELECT * INTO a FROM public.platform_sales_billing_agreements WHERE id=p_id AND environment='SANDBOX';
  IF a.id IS NULL THEN RAISE EXCEPTION 'Source missing' USING ERRCODE='P3700';END IF;
  d:=public.platform_sales_subscription_command_action(p_actor,'read',jsonb_build_object('agreementId',p_id));
  e:=d->'events'->-1;
  IF e->>'state' IS DISTINCT FROM 'CREATED' THEN RAISE EXCEPTION 'Subscription not verified' USING ERRCODE='P3701';END IF;
  RETURN jsonb_build_object('remoteId',e->'evidence'->>'id','verified',e->'evidence'->>'deleted'='false' AND e->'evidence'->>'status'='ACTIVE','agreementId',a.id,'proposalId',a.proposal_id,'terms',a.source,'parameters',a.parameters,'subscriptionEvidence',e->'evidence','commandVersion',e->'version');
 END IF;
 RAISE EXCEPTION 'Invalid origin' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_adjustment_source(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Conservative internal eligibility only; this is never authorization to dispatch a refund/cancellation.
CREATE OR REPLACE FUNCTION public.platform_sales_adjustment_blockers(p_kind text,p_source jsonb,p_params jsonb,p_notice_date date)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE reasons jsonb:='[]';e jsonb:=p_source->'evidence';amount bigint;refunded bigint;x jsonb;
BEGIN
 IF coalesce((p_source->>'verified')::boolean,false)=false THEN reasons:=reasons||'"SOURCE_UNVERIFIED"'::jsonb;END IF;
 IF p_kind='REFUND_PAYMENT' THEN
  IF p_params-ARRAY['amountCents']<>'{}' OR NOT p_params ? 'amountCents' OR jsonb_typeof(p_params->'amountCents')<>'number' OR coalesce(p_params->>'amountCents','') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'Invalid refund amount' USING ERRCODE='22023';END IF;
  amount:=(p_params->>'amountCents')::bigint;
  IF amount>coalesce((p_source->'binding'->>'grossCents')::bigint,0) THEN RAISE EXCEPTION 'Amount exceeds original' USING ERRCODE='22023';END IF;
  IF p_source->>'evidenceId' IS NULL OR p_source->>'evidenceStatus' IS NULL OR p_source->>'evidenceStatus' NOT IN ('COMPLETE','PARTIAL') OR p_source->>'evidenceMatches' IS DISTINCT FROM 'true' THEN reasons:=reasons||'"EVIDENCE_UNVERIFIED"'::jsonb;END IF;
  IF e->>'refundsComplete' IS DISTINCT FROM 'true' THEN reasons:=reasons||'"REFUNDS_INCOMPLETE"'::jsonb;
  ELSE
   refunded:=0;
   FOR x IN SELECT value FROM jsonb_array_elements(e->'refunds') LOOP
    IF x->>'status'='PENDING' THEN reasons:=reasons||'"REFUND_PENDING"'::jsonb;END IF;
    IF x->>'status'='DONE' THEN refunded:=refunded+(x->>'valueCents')::bigint;END IF;
   END LOOP;
   IF amount+refunded>coalesce((p_source->'binding'->>'grossCents')::bigint,0) THEN reasons:=reasons||'"REFUND_EXCEEDS_EVIDENCE"'::jsonb;END IF;
  END IF;
  IF e->'payment'->>'status' IS DISTINCT FROM 'RECEIVED' THEN reasons:=reasons||'"PAYMENT_NOT_RECEIVED"'::jsonb;END IF;
 ELSE
  IF p_kind<>'CANCEL_SUBSCRIPTION' OR p_params-ARRAY['requestedDate','conditionsReviewed','noticeDays','conditionsEvidence']<>'{}' OR NOT p_params ?& ARRAY['requestedDate','conditionsReviewed','noticeDays','conditionsEvidence'] OR jsonb_typeof(p_params->'conditionsReviewed')<>'boolean' OR jsonb_typeof(p_params->'noticeDays')<>'number' OR coalesce(p_params->>'noticeDays','') !~ '^\d{1,3}$' OR (p_params->>'noticeDays')::integer NOT BETWEEN 0 AND 365 OR coalesce(p_params->>'requestedDate','') !~ '^\d{4}-\d{2}-\d{2}$' OR jsonb_typeof(p_params->'conditionsEvidence')<>'string' OR length(p_params->>'conditionsEvidence')>1000 THEN RAISE EXCEPTION 'Invalid cancellation parameters' USING ERRCODE='22023';END IF;
  IF p_params->>'conditionsReviewed' IS DISTINCT FROM 'true' OR length(btrim(p_params->>'conditionsEvidence'))<20 THEN reasons:=reasons||'"CONDITIONS_REVIEW_REQUIRED"'::jsonb;END IF;
  -- Days are explicitly reviewed against preserved terms by the Owner; never inferred from prose.
  IF (p_params->>'requestedDate')::date<p_notice_date+(p_params->>'noticeDays')::integer THEN reasons:=reasons||'"NOTICE_PERIOD_PENDING"'::jsonb;END IF;
 END IF;
 RETURN reasons;
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_adjustment_blockers(text,jsonb,jsonb,date) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.platform_sales_adjustment_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE item public.platform_sales_adjustment_requests;event public.platform_sales_adjustment_events;replay public.platform_sales_adjustment_events;
 entity uuid;cmd uuid;origin text;kind text;source_id uuid;s jsonb;params jsonb;reasons jsonb;author text;new_state text;page integer;q text;filter_state text;can_write boolean:=false;expected integer;notice date;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501';END IF;
 IF p_action IN ('list','read','source') THEN
  PERFORM public.read_platform_sales_finance(p_actor,0,'','',NULL,NULL,NULL);
  BEGIN PERFORM public.platform_team_owner(p_actor);can_write:=true;EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_column THEN can_write:=false;END;
 ELSE PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));PERFORM public.platform_team_owner(p_actor);END IF;
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>8000 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023';END IF;
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action='list' THEN
  IF p_body-ARRAY['page','search','state']<>'{}' OR NOT p_body ?& ARRAY['page','search','state'] OR coalesce(p_body->>'page','') !~ '^\d{1,4}$' THEN RAISE EXCEPTION 'Invalid list' USING ERRCODE='22023';END IF;
  page:=(p_body->>'page')::integer;q:=p_body->>'search';filter_state:=p_body->>'state';
  IF page>1000 OR q IS NULL OR length(q)>100 OR filter_state IS NULL OR filter_state NOT IN ('','PREPARED','WAITING_EVIDENCE','CONFIRMED_INTERNAL','REJECTED','WITHDRAWN') THEN RAISE EXCEPTION 'Invalid list filters' USING ERRCODE='22023';END IF;
  RETURN (WITH rows AS(SELECT a.id,a.kind,a.origin_kind,a.source_id,a.remote_id,a.created_at,e.state,e.version,e.blockers FROM public.platform_sales_adjustment_requests a JOIN LATERAL(SELECT * FROM public.platform_sales_adjustment_events WHERE request_id=a.id ORDER BY version DESC LIMIT 1)e ON true WHERE (q='' OR strpos(a.remote_id,q)>0 OR strpos(a.source_id::text,q)>0 OR strpos(a.id::text,q)>0) AND (filter_state='' OR e.state=filter_state)) SELECT jsonb_build_object('canWrite',can_write,'environment','SANDBOX','total',(SELECT count(*) FROM rows),'rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT * FROM rows ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET page*25)x)));
 END IF;
 entity:=(p_body->>'id')::uuid;IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023';END IF;
 IF p_action='source' THEN
  IF p_body-ARRAY['id','origin']<>'{}' OR NOT p_body ?& ARRAY['id','origin'] THEN RAISE EXCEPTION 'Invalid source' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('canWrite',can_write,'source',public.platform_sales_adjustment_source(p_actor,p_body->>'origin',entity));
 END IF;
 IF p_action='read' THEN
  IF p_body-ARRAY['id','page']<>'{}' OR NOT p_body ?& ARRAY['id','page'] OR coalesce(p_body->>'page','') !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 THEN RAISE EXCEPTION 'Invalid read' USING ERRCODE='22023';END IF;
  SELECT * INTO item FROM public.platform_sales_adjustment_requests WHERE id=entity;
  IF item.id IS NULL THEN RAISE EXCEPTION 'Request missing' USING ERRCODE='P3700';END IF;
  RETURN jsonb_build_object('canWrite',can_write,'request',to_jsonb(item)||jsonb_build_object('current_actor_name',public.platform_sales_finance_name(item.actor_id)),'latest',(SELECT to_jsonb(e) FROM public.platform_sales_adjustment_events e WHERE request_id=entity ORDER BY version DESC LIMIT 1),'total',(SELECT count(*) FROM public.platform_sales_adjustment_events WHERE request_id=entity),'events',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT e.*,public.platform_sales_finance_name(e.actor_id) current_actor_name FROM public.platform_sales_adjustment_events e WHERE request_id=entity ORDER BY version DESC LIMIT 25 OFFSET (p_body->>'page')::integer*25)x));
 END IF;
 IF p_action NOT IN ('prepare','revise','confirm','reject','withdraw') OR p_body->>'justification' IS NULL OR jsonb_typeof(p_body->'justification')<>'string' OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 500 THEN RAISE EXCEPTION 'Invalid action or note' USING ERRCODE='22023';END IF;
 IF p_action='prepare' THEN
  IF p_body-ARRAY['id','origin','sourceId','parameters','justification']<>'{}' OR NOT p_body ?& ARRAY['id','origin','sourceId','parameters','justification'] THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  origin:=p_body->>'origin';source_id:=(p_body->>'sourceId')::uuid;params:=p_body->'parameters';cmd:=entity;
  IF origin IS NULL OR source_id IS NULL OR jsonb_typeof(params)<>'object' THEN RAISE EXCEPTION 'Invalid origin' USING ERRCODE='22023';END IF;
  kind:=CASE WHEN origin='SUBSCRIPTION' THEN 'CANCEL_SUBSCRIPTION' ELSE 'REFUND_PAYMENT' END;
  SELECT * INTO item FROM public.platform_sales_adjustment_requests WHERE id=entity;
  IF FOUND THEN
   SELECT * INTO event FROM public.platform_sales_adjustment_events WHERE request_id=entity AND version=1;
   IF item.actor_id IS DISTINCT FROM p_actor OR item.origin_kind IS DISTINCT FROM origin OR item.source_id IS DISTINCT FROM source_id OR event.parameters IS DISTINCT FROM params OR event.justification IS DISTINCT FROM p_body->>'justification' THEN RAISE EXCEPTION 'Changed preparation replay' USING ERRCODE='P3701';END IF;
   RETURN jsonb_build_object('id',entity,'replayed',true);
  END IF;
  s:=public.platform_sales_adjustment_source(p_actor,origin,source_id);
  IF s->>'remoteId' IS NULL THEN RAISE EXCEPTION 'Unbound source' USING ERRCODE='P3701';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-adjustment:'||kind||':'||(s->>'remoteId'),0));
  IF EXISTS(SELECT 1 FROM public.platform_sales_adjustment_requests a JOIN LATERAL(SELECT state FROM public.platform_sales_adjustment_events WHERE request_id=a.id ORDER BY version DESC LIMIT 1)e ON true WHERE a.kind=kind AND a.remote_id=s->>'remoteId' AND e.state NOT IN ('REJECTED','WITHDRAWN')) THEN RAISE EXCEPTION 'Active request exists' USING ERRCODE='P3701';END IF;
  notice:=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  reasons:=public.platform_sales_adjustment_blockers(kind,s,params,notice);
  INSERT INTO public.platform_sales_adjustment_requests(id,kind,origin_kind,source_id,remote_id,source,actor_id,actor_name) VALUES(entity,kind,origin,source_id,s->>'remoteId',s,p_actor,author);
  expected:=0;
 ELSE
  IF p_body-ARRAY['id','commandId','expectedVersion','parameters','justification']<>'{}' OR NOT p_body ?& ARRAY['id','commandId','expectedVersion','justification'] OR (p_action='revise') IS DISTINCT FROM (p_body ? 'parameters') OR jsonb_typeof(p_body->'expectedVersion')<>'number' OR coalesce(p_body->>'expectedVersion','') !~ '^[1-9][0-9]{0,5}$' THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023';END IF;
  cmd:=(p_body->>'commandId')::uuid;expected:=(p_body->>'expectedVersion')::integer;IF cmd IS NULL THEN RAISE EXCEPTION 'Command required' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-adjustment-request:'||entity::text,0));
  SELECT * INTO item FROM public.platform_sales_adjustment_requests WHERE id=entity;
  IF item.id IS NULL THEN RAISE EXCEPTION 'Request missing' USING ERRCODE='P3700';END IF;
  SELECT * INTO replay FROM public.platform_sales_adjustment_events WHERE command_id=cmd;
  IF FOUND THEN
   IF replay.request_id IS DISTINCT FROM entity OR replay.version IS DISTINCT FROM expected+1 OR replay.actor_id IS DISTINCT FROM p_actor OR replay.justification IS DISTINCT FROM p_body->>'justification' OR replay.action IS DISTINCT FROM (CASE p_action WHEN 'revise' THEN 'REVISE' WHEN 'confirm' THEN 'CONFIRM_INTERNAL' WHEN 'reject' THEN 'REJECT' ELSE 'WITHDRAW' END) OR p_action='revise' AND replay.parameters IS DISTINCT FROM p_body->'parameters' THEN RAISE EXCEPTION 'Changed transition replay' USING ERRCODE='P3701';END IF;
   RETURN jsonb_build_object('id',entity,'replayed',true);
  END IF;
  SELECT * INTO event FROM public.platform_sales_adjustment_events WHERE request_id=entity ORDER BY version DESC LIMIT 1;
  IF event.version<>expected OR event.state IN ('REJECTED','WITHDRAWN') OR p_action='confirm' AND event.state='CONFIRMED_INTERNAL' THEN RAISE EXCEPTION 'Version or state conflict' USING ERRCODE='P3701';END IF;
  kind:=item.kind;params:=CASE WHEN p_action='revise' THEN p_body->'parameters' ELSE event.parameters END;
  s:=event.source;reasons:=event.blockers;
  IF p_action IN ('revise','confirm') THEN
   IF jsonb_typeof(params)<>'object' THEN RAISE EXCEPTION 'Invalid parameters' USING ERRCODE='22023';END IF;
   s:=public.platform_sales_adjustment_source(p_actor,item.origin_kind,item.source_id);
   IF s->>'remoteId' IS DISTINCT FROM item.remote_id THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='P3701';END IF;
   notice:=(item.created_at AT TIME ZONE 'America/Sao_Paulo')::date;
   reasons:=public.platform_sales_adjustment_blockers(kind,s,params,notice);
   IF p_action='confirm' AND (s IS DISTINCT FROM event.source OR reasons<>'[]') THEN RAISE EXCEPTION 'Revise changed or incomplete evidence first' USING ERRCODE='P3701';END IF;
  END IF;
 END IF;
 new_state:=CASE p_action WHEN 'confirm' THEN 'CONFIRMED_INTERNAL' WHEN 'reject' THEN 'REJECTED' WHEN 'withdraw' THEN 'WITHDRAWN' ELSE CASE WHEN reasons='[]' THEN 'PREPARED' ELSE 'WAITING_EVIDENCE' END END;
 INSERT INTO public.platform_sales_adjustment_events(request_id,version,command_id,action,state,parameters,source,blockers,actor_id,actor_name,justification) VALUES(entity,expected+1,cmd,CASE p_action WHEN 'prepare' THEN 'PREPARE' WHEN 'revise' THEN 'REVISE' WHEN 'confirm' THEN 'CONFIRM_INTERNAL' WHEN 'reject' THEN 'REJECT' ELSE 'WITHDRAW' END,new_state,params,s,reasons,p_actor,author,p_body->>'justification');
 RETURN jsonb_build_object('id',entity,'state',new_state,'version',expected+1,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_adjustment_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_adjustment_action(uuid,text,jsonb) TO service_role;
COMMIT;
