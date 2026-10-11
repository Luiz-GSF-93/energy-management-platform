BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Private commands only. Current 5A sources are SANDBOX and cannot apply licenses.
CREATE TABLE public.platform_sales_provisioning_commands (
 id uuid PRIMARY KEY,activation_id uuid NOT NULL UNIQUE REFERENCES public.platform_sales_activation_requests(id),
 organization_id text NOT NULL UNIQUE REFERENCES public.organizations(id),activation_version integer NOT NULL,
 source_hash text NOT NULL,complement jsonb NOT NULL,payload jsonb NOT NULL,payload_hash text NOT NULL,
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(payload_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex'))
);
CREATE TABLE public.platform_sales_provisioning_events (
 request_id uuid PRIMARY KEY,command_id uuid NOT NULL REFERENCES public.platform_sales_provisioning_commands(id),
 version integer NOT NULL CHECK(version>0),state text NOT NULL CHECK(state IN ('PREPARED','AUTHORIZED','WITHDRAWN','APPLIED')),
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,input jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(command_id,version)
);
CREATE TABLE public.platform_sales_provisioning_results (
 command_id uuid PRIMARY KEY REFERENCES public.platform_sales_provisioning_commands(id),
 license_id text NOT NULL UNIQUE REFERENCES public.licenses(id),audit_id text NOT NULL UNIQUE REFERENCES public.audit_logs(id),
 payload_hash text NOT NULL,license_snapshot jsonb NOT NULL,actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sales_provisioning_recent ON public.platform_sales_provisioning_commands(created_at DESC,id DESC);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_provisioning_commands','platform_sales_provisioning_events','platform_sales_provisioning_results'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;

-- Read original proposal, never the current catalog. Explicit complement is immutable.
CREATE FUNCTION public.platform_sales_provisioning_payload(p_activation uuid,p_complement jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a public.platform_sales_activation_requests;e public.platform_sales_activation_events;s jsonb;p jsonb;scope jsonb;reasons jsonb;v jsonb;k text;
BEGIN
 SELECT * INTO a FROM public.platform_sales_activation_requests WHERE id=p_activation;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Activation missing' USING ERRCODE='P3620';END IF;
 SELECT * INTO e FROM public.platform_sales_activation_events WHERE activation_id=a.id ORDER BY version DESC LIMIT 1;
 s:=public.platform_sales_activation_source(a.organization_id,a.proposal_id,a.document_id,a.binding_id);
 SELECT snapshot INTO p FROM public.platform_sales_proposals WHERE id=a.proposal_id;
 scope:=s#>'{snapshot,scope}';reasons:=s->'blockers';
 IF e.state IS DISTINCT FROM 'CHECKED_INTERNAL' THEN reasons:=reasons||jsonb_build_array('ACTIVATION_NOT_CHECKED');END IF;
 IF p_complement IS NULL OR jsonb_typeof(p_complement)<>'object' OR p_complement-ARRAY['starts','ends','renews','aiMonthlyMicroUsd','contractConfirmed']<>'{}' THEN RAISE EXCEPTION 'Invalid complement' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['starts','ends','renews'] LOOP
  IF NOT p_complement ? k OR p_complement->k='null' THEN reasons:=reasons||jsonb_build_array('LICENSE_DATES_MISSING');
  ELSIF jsonb_typeof(p_complement->k)<>'string' OR p_complement->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid dates' USING ERRCODE='22023';
  ELSE PERFORM (p_complement->>k)::date;END IF;
 END LOOP;
 IF p_complement ?& ARRAY['starts','ends','renews'] AND p_complement->>'starts' IS NOT NULL AND p_complement->>'ends' IS NOT NULL AND p_complement->>'renews' IS NOT NULL THEN
  IF (p_complement->>'ends')::date<(p_complement->>'starts')::date OR (p_complement->>'renews')::date<(p_complement->>'starts')::date OR (p_complement->>'renews')::date>(p_complement->>'ends')::date THEN RAISE EXCEPTION 'Dates incompatible' USING ERRCODE='22023';END IF;
 END IF;
 IF p_complement->'contractConfirmed' IS DISTINCT FROM 'true'::jsonb THEN reasons:=reasons||jsonb_build_array('COMPLEMENT_CONTRACT_REVIEW');END IF;
 IF NOT p_complement ? 'aiMonthlyMicroUsd' OR p_complement->'aiMonthlyMicroUsd'='null' THEN reasons:=reasons||jsonb_build_array('AI_QUOTA_MISSING');
 ELSIF jsonb_typeof(p_complement->'aiMonthlyMicroUsd')<>'number' OR p_complement->>'aiMonthlyMicroUsd' !~ '^\d+$' OR (p_complement->>'aiMonthlyMicroUsd')::numeric>9000000000000 THEN RAISE EXCEPTION 'Invalid AI quota' USING ERRCODE='22023';
 ELSIF coalesce((scope#>>'{modules,bot_energy_rag}')::boolean,false)=false AND (p_complement->>'aiMonthlyMicroUsd')::bigint<>0 THEN RAISE EXCEPTION 'AI not contracted' USING ERRCODE='22023';END IF;
 IF p->>'cycle' IS DISTINCT FROM 'MONTHLY' OR p->>'monthlyRecurringCents' IS NULL THEN reasons:=reasons||jsonb_build_array('BILLING_SCOPE_UNSUPPORTED');END IF;
 IF p->>'monthlyRecurringCents' IS NOT NULL AND (p->>'monthlyRecurringCents' !~ '^\d+$' OR (p->>'monthlyRecurringCents')::numeric NOT BETWEEN 1 AND 9000000000000) THEN RAISE EXCEPTION 'Invalid recurring amount' USING ERRCODE='22023';END IF;
 IF p->>'planName' IS NULL THEN reasons:=reasons||jsonb_build_array('PLAN_NAME_MISSING');END IF;
 IF scope->>'units' !~ '^\d+$' OR scope->>'users' !~ '^\d+$' OR coalesce((scope->>'units')::bigint,0)<1 OR coalesce((scope->>'users')::bigint,0)<1 THEN reasons:=reasons||jsonb_build_array('SCOPE_INCOMPLETE');END IF;
 IF scope->'documentsLimit' IS DISTINCT FROM 'null'::jsonb AND (scope->>'documentsLimit' IS NULL OR scope->>'documentsLimit' !~ '^\d+$') THEN reasons:=reasons||jsonb_build_array('SCOPE_INCOMPLETE');END IF;
 IF (scope->'modules')-ARRAY['document_management','advanced_analytics','report_generation','free_market_management','bot_energy_rag','trading_hub','ccee_registrations','client_portal']<>'{}' OR EXISTS(SELECT 1 FROM jsonb_each(scope->'modules') x WHERE jsonb_typeof(x.value)<>'boolean') THEN reasons:=reasons||jsonb_build_array('SCOPE_INCOMPLETE');END IF;
 v:=jsonb_build_object('organizationId',a.organization_id,'activationId',a.id,'activationVersion',e.version,'sourceHash',s->'sourceHash','environment',s#>'{snapshot,environment}','realActivationEligible',s->'realActivationEligible','scope',scope,'planName',p->'planName','monthlyCents',p->'monthlyRecurringCents','complement',p_complement,'blockers',reasons);
 RETURN jsonb_build_object('payload',v,'payloadHash',encode(sha256(convert_to(v::text,'UTF8')),'hex'),'blockers',reasons);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_provisioning_payload(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.platform_sales_provisioning_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE c public.platform_sales_provisioning_commands;e public.platform_sales_provisioning_events;last public.platform_sales_provisioning_events;
 r public.platform_sales_provisioning_results;lic public.licenses;f jsonb;v jsonb;scope jsonb;m jsonb;aid text;old_actor text;
 entity uuid;req uuid;note text;author text;page integer;q text;state text;result jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('list','read','preview','prepare','authorize','withdraw','execute') THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';END IF;
 IF p_actor IS NULL OR (SELECT count(*) FROM public.user_roles u JOIN public.roles x ON x.id=u.role_id WHERE u.user_id::text=p_actor::text AND x.scope='global')<>1 OR NOT EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles x ON x.id=u.role_id JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text WHERE u.user_id::text=p_actor::text AND x.scope='global' AND x.name='admin_platform' AND x.permissions ? '82e7fc71-479a-4dd6-8b22-4fba6eaa6841' AND t.active AND t.profile='OWNER') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF p_action NOT IN ('list','read','preview') THEN
  PERFORM 1 FROM public.user_roles u JOIN public.roles x ON x.id=u.role_id JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text WHERE u.user_id::text=p_actor::text FOR SHARE OF u,x,t;
  PERFORM public.platform_team_owner(p_actor);
 END IF;
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>16000 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023';END IF;
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action='list' THEN
  IF p_body-ARRAY['page','search','status']<>'{}' OR NOT p_body ?& ARRAY['page','search','status'] THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  page:=(p_body->>'page')::integer;q:=p_body->>'search';state:=p_body->>'status';
  IF page IS NULL OR page NOT BETWEEN 0 AND 1000 OR q IS NULL OR length(q)>100 OR state IS NULL OR state NOT IN ('','PREPARED','AUTHORIZED','WITHDRAWN','APPLIED') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  WITH rows AS(SELECT a.id,a.organization_id,a.activation_id,a.created_at,x.state,x.version FROM public.platform_sales_provisioning_commands a CROSS JOIN LATERAL(SELECT * FROM public.platform_sales_provisioning_events WHERE command_id=a.id ORDER BY version DESC LIMIT 1)x WHERE (state='' OR x.state=state) AND (q='' OR strpos(a.organization_id,q)>0 OR strpos(a.activation_id::text,q)>0))
  SELECT jsonb_build_object('total',(SELECT count(*) FROM rows),'rows',(SELECT coalesce(jsonb_agg(t),'[]') FROM(SELECT * FROM rows ORDER BY created_at DESC,id LIMIT 25 OFFSET page*25)t)) INTO result;RETURN result;
 END IF;
 entity:=(p_body->>'id')::uuid;IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023';END IF;
 IF p_action='preview' THEN
  IF p_body-ARRAY['id','complement']<>'{}' OR NOT p_body ? 'complement' THEN RAISE EXCEPTION 'Invalid preview' USING ERRCODE='22023';END IF;
  RETURN public.platform_sales_provisioning_payload(entity,p_body->'complement');
 END IF;
 IF p_action='read' THEN
  IF p_body-ARRAY['id']<>'{}' THEN RAISE EXCEPTION 'Invalid read' USING ERRCODE='22023';END IF;
  SELECT * INTO c FROM public.platform_sales_provisioning_commands WHERE id=entity;IF c.id IS NULL THEN RAISE EXCEPTION 'Command missing' USING ERRCODE='P3620';END IF;
  RETURN jsonb_build_object('command',to_jsonb(c),'current',public.platform_sales_provisioning_payload(c.activation_id,c.complement),'events',(SELECT coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(x.actor_id)) ORDER BY version),'[]') FROM public.platform_sales_provisioning_events x WHERE command_id=entity),'result',(SELECT to_jsonb(x) FROM public.platform_sales_provisioning_results x WHERE command_id=entity));
 END IF;
 note:=p_body->>'justification';IF jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(note)) NOT BETWEEN 20 AND 1000 OR note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-provisioning:'||entity::text,0));
 IF p_action='prepare' THEN
  IF p_body-ARRAY['id','activationId','payloadHash','complement','justification']<>'{}' OR NOT p_body ?& ARRAY['id','activationId','payloadHash','complement','justification'] THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  SELECT * INTO c FROM public.platform_sales_provisioning_commands WHERE id=entity;
  IF c.id IS NOT NULL THEN
   IF c.actor_id<>p_actor OR c.activation_id IS DISTINCT FROM (p_body->>'activationId')::uuid OR c.complement IS DISTINCT FROM p_body->'complement' OR c.payload_hash IS DISTINCT FROM p_body->>'payloadHash' OR c.justification<>note THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='P3621';END IF;RETURN jsonb_build_object('id',entity);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-activation:'||(p_body->>'activationId'),0));
  f:=public.platform_sales_provisioning_payload((p_body->>'activationId')::uuid,p_body->'complement');v:=f->'payload';
  IF f->>'payloadHash' IS DISTINCT FROM p_body->>'payloadHash' THEN RAISE EXCEPTION 'Sources changed' USING ERRCODE='P3621';END IF;
  IF f->'blockers'<>'[]' THEN RAISE EXCEPTION 'Scope blocked' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v->>'organizationId',315));
  INSERT INTO public.platform_sales_provisioning_commands(id,activation_id,organization_id,activation_version,source_hash,complement,payload,payload_hash,actor_id,actor_name,justification) VALUES(entity,(p_body->>'activationId')::uuid,v->>'organizationId',(v->>'activationVersion')::integer,v->>'sourceHash',p_body->'complement',v,f->>'payloadHash',p_actor,author,note);
  INSERT INTO public.platform_sales_provisioning_events VALUES(entity,entity,1,'PREPARED',p_actor,author,note,p_body,clock_timestamp());RETURN jsonb_build_object('id',entity);
 END IF;
 IF p_action NOT IN ('authorize','withdraw','execute') OR p_body-ARRAY['id','requestId','expectedVersion','payloadHash','justification']<>'{}' OR NOT p_body ?& ARRAY['id','requestId','expectedVersion','payloadHash','justification'] THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL OR (p_body->>'expectedVersion')::integer<1 OR p_body->>'payloadHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid identifiers' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.platform_sales_provisioning_commands WHERE id=entity;IF c.id IS NULL THEN RAISE EXCEPTION 'Command missing' USING ERRCODE='P3620';END IF;
 SELECT * INTO e FROM public.platform_sales_provisioning_events WHERE request_id=req;
 IF e.request_id IS NOT NULL THEN
  IF e.command_id<>entity OR e.actor_id<>p_actor OR e.input IS DISTINCT FROM p_body OR e.state IS DISTINCT FROM (CASE p_action WHEN 'authorize' THEN 'AUTHORIZED' WHEN 'withdraw' THEN 'WITHDRAWN' ELSE 'APPLIED' END) THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='P3621';END IF;
  IF p_action<>'execute' THEN RETURN to_jsonb(e);END IF;
  SELECT * INTO r FROM public.platform_sales_provisioning_results WHERE command_id=entity;
  IF r.command_id IS NULL OR r.payload_hash<>c.payload_hash OR NOT EXISTS(SELECT 1 FROM public.licenses x WHERE x.id=r.license_id AND (to_jsonb(x)-'documents_used'-'updated_at')=(r.license_snapshot-'documents_used'-'updated_at')) OR NOT EXISTS(SELECT 1 FROM public.audit_logs x WHERE x.id=r.audit_id AND x.resource_id=r.license_id AND x.changes->'after'=r.license_snapshot AND x.changes->>'commercialPayloadHash'=r.payload_hash) THEN RAISE EXCEPTION 'Recovery requires review' USING ERRCODE='P3621';END IF;
  RETURN to_jsonb(r);
 END IF;
 SELECT * INTO last FROM public.platform_sales_provisioning_events WHERE command_id=entity ORDER BY version DESC LIMIT 1;
 IF last.version IS DISTINCT FROM (p_body->>'expectedVersion')::integer OR c.payload_hash IS DISTINCT FROM p_body->>'payloadHash' OR last.state IN ('WITHDRAWN','APPLIED') THEN RAISE EXCEPTION 'Stale or terminal command' USING ERRCODE='P3621';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-activation:'||c.activation_id::text,0));
 f:=public.platform_sales_provisioning_payload(c.activation_id,c.complement);v:=f->'payload';
 IF p_action<>'withdraw' AND (f->>'payloadHash'<>c.payload_hash OR f->'blockers'<>'[]') THEN RAISE EXCEPTION 'Sources changed or blocked' USING ERRCODE='P3621';END IF;
 IF p_action='authorize' AND last.state<>'PREPARED' OR p_action='execute' AND last.state<>'AUTHORIZED' THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='P3621';END IF;
 IF p_action='execute' THEN
  -- No fixture toggle, caller-supplied environment or override exists in production code.
  IF v->>'environment' IS DISTINCT FROM 'PRODUCTION' OR v->'realActivationEligible' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Production evidence required; sandbox cannot provision' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(60405);PERFORM pg_advisory_xact_lock(hashtextextended(c.organization_id,315));
  IF EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=c.organization_id) THEN RAISE EXCEPTION 'Existing license requires separate review' USING ERRCODE='P3621';END IF;
  scope:=v->'scope';m:=scope->'modules';old_actor:=current_setting('app.license_actor',true);PERFORM set_config('app.license_actor',p_actor::text,true);
  INSERT INTO public.licenses(id,organization_id,license_type,documents_limit,documents_used,documents_unlimited,renewal_date,start_date,end_date,status,active,max_consumer_units,max_users,document_management,advanced_analytics,report_generation,free_market_management,client_portal,ccee_registrations,trading_hub,bot_energy_rag,ai_monthly_limit_micro_usd,monthly_price_brl_cents,plan_id,plan_version,plan_snapshot)
  VALUES(gen_random_uuid()::text,c.organization_id,v->>'planName',(scope->>'documentsLimit')::integer,0,scope->'documentsLimit'='null'::jsonb,(c.complement->>'renews')::date,(c.complement->>'starts')::date,(c.complement->>'ends')::date,'ACTIVE',true,(scope->>'units')::integer,(scope->>'users')::integer,coalesce((m->>'document_management')::boolean,false),coalesce((m->>'advanced_analytics')::boolean,false),coalesce((m->>'report_generation')::boolean,false),coalesce((m->>'free_market_management')::boolean,false),coalesce((m->>'client_portal')::boolean,false),coalesce((m->>'ccee_registrations')::boolean,false),coalesce((m->>'trading_hub')::boolean,false),coalesce((m->>'bot_energy_rag')::boolean,false),(c.complement->>'aiMonthlyMicroUsd')::bigint,(v->>'monthlyCents')::bigint,(scope->>'planId')::uuid,(scope->>'planVersion')::integer,v) RETURNING * INTO lic;
  aid:=gen_random_uuid()::text;
  INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent) VALUES(aid,c.organization_id,p_actor,'CREATE','license',lic.id,jsonb_build_object('before',NULL,'after',to_jsonb(lic),'commercialCommandId',entity,'commercialPayloadHash',c.payload_hash,'actorName',author),'success',NULL,'EnergyOS commercial provisioning');
  INSERT INTO public.platform_sales_provisioning_results(command_id,license_id,audit_id,payload_hash,license_snapshot,actor_id) VALUES(entity,lic.id,aid,c.payload_hash,to_jsonb(lic),p_actor) RETURNING * INTO r;
  PERFORM set_config('app.license_actor',coalesce(old_actor,''),true);
 END IF;
 INSERT INTO public.platform_sales_provisioning_events VALUES(req,entity,last.version+1,CASE p_action WHEN 'authorize' THEN 'AUTHORIZED' WHEN 'withdraw' THEN 'WITHDRAWN' ELSE 'APPLIED' END,p_actor,author,note,p_body,clock_timestamp()) RETURNING * INTO e;
 RETURN CASE WHEN p_action='execute' THEN to_jsonb(r) ELSE to_jsonb(e) END;
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_provisioning_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_provisioning_action(uuid,text,jsonb) TO service_role;
COMMIT;
