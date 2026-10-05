-- Bot-Energy + RAG plan entitlement, monthly tenant budgets and platform observability.
-- All monetary units are integers; USD budgets do not include OCR pages or infrastructure.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.plan_catalog ADD COLUMN bot_energy_rag boolean NOT NULL DEFAULT false;
ALTER TABLE public.plan_catalog ADD COLUMN ai_monthly_limit_micro_usd bigint NOT NULL DEFAULT 10000000 CHECK(ai_monthly_limit_micro_usd BETWEEN 0 AND 1000000000000);
ALTER TABLE public.plan_catalog ADD COLUMN monthly_price_brl_cents bigint CHECK(monthly_price_brl_cents BETWEEN 0 AND 1000000000);
ALTER TABLE public.licenses ADD COLUMN bot_energy_rag boolean NOT NULL DEFAULT false;
ALTER TABLE public.licenses ADD COLUMN ai_monthly_limit_micro_usd bigint NOT NULL DEFAULT 0 CHECK(ai_monthly_limit_micro_usd BETWEEN 0 AND 1000000000000);
ALTER TABLE public.licenses ADD COLUMN monthly_price_brl_cents bigint CHECK(monthly_price_brl_cents BETWEEN 0 AND 1000000000);
ALTER TABLE public.plan_catalog ADD CONSTRAINT plan_bot_energy_positive CHECK(NOT bot_energy_rag OR ai_monthly_limit_micro_usd>0);
ALTER TABLE public.licenses ADD CONSTRAINT license_bot_energy_positive CHECK(NOT bot_energy_rag OR ai_monthly_limit_micro_usd>0);
ALTER FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) RENAME TO save_catalog_plan_before_ai;
REVOKE ALL ON FUNCTION public.save_catalog_plan_before_ai(uuid,integer,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; enabled boolean; quota bigint; price bigint;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 enabled:=COALESCE((definition->>'bot_energy_rag')::boolean,false);
 quota:=COALESCE((definition->>'ai_monthly_limit_micro_usd')::bigint,10000000);
 price:=(definition->>'monthly_price_brl_cents')::bigint;
 saved:=public.save_catalog_plan_before_ai(target_id,expected_version,definition,actor_id,audit_ip,audit_agent);
 UPDATE public.plan_catalog SET bot_energy_rag=enabled,ai_monthly_limit_micro_usd=quota,monthly_price_brl_cents=price WHERE id=(saved->>'id')::uuid RETURNING to_jsonb(plan_catalog.*) INTO saved;
 UPDATE public.platform_plan_audit SET changes=jsonb_set(changes,'{after}',saved) WHERE plan_id=(saved->>'id')::uuid AND (changes->'after'->>'version')::integer=(saved->>'version')::integer;
 RETURN saved;
END $$;
CREATE TABLE public.platform_cost_policy(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),platform_ai_micro_usd bigint NOT NULL DEFAULT 0 CHECK(platform_ai_micro_usd BETWEEN 0 AND 1000000000000),
 monthly_cost_limit_brl_cents bigint CHECK(monthly_cost_limit_brl_cents>0 AND monthly_cost_limit_brl_cents<=1000000000000),
 email text NOT NULL DEFAULT 'luiz@expertenergy.com.br',whatsapp text NOT NULL DEFAULT '+5516994043678',email_enabled boolean NOT NULL DEFAULT true,
 usd_brl_rate numeric(12,6) CHECK(usd_brl_rate>0 AND usd_brl_rate<=10000),fx_date date,
 revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_cost_policy(id) VALUES(true);
-- Preserve the existing pilot explicitly; only applies while its license is valid.
CREATE TABLE public.bot_energy_pilot_allowance(organization_id text PRIMARY KEY REFERENCES public.organizations(id),micro_usd bigint NOT NULL CHECK(micro_usd>0));
INSERT INTO public.bot_energy_pilot_allowance VALUES('org_default',50000000);
CREATE FUNCTION public.bot_energy_license_quota(p_organization text) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN count(*)=1 THEN max(CASE WHEN l.bot_energy_rag THEN l.ai_monthly_limit_micro_usd ELSE COALESCE(p.micro_usd,0) END) ELSE 0 END
 FROM public.licenses l LEFT JOIN public.bot_energy_pilot_allowance p ON p.organization_id=l.organization_id
 WHERE l.organization_id=p_organization AND l.active=true AND lower(l.status)='active' AND l.start_date<=((clock_timestamp() AT TIME ZONE 'UTC')::date) AND (l.end_date IS NULL OR l.end_date>=((clock_timestamp() AT TIME ZONE 'UTC')::date));
$$;
CREATE TABLE public.bot_energy_ai_organization_months(organization_id text NOT NULL REFERENCES public.organizations(id),month date NOT NULL,committed_micro_usd bigint NOT NULL DEFAULT 0 CHECK(committed_micro_usd>=0),PRIMARY KEY(organization_id,month));
INSERT INTO public.bot_energy_ai_organization_months SELECT organization_id,month,sum(CASE WHEN state IN ('SETTLED','OVERRUN') THEN actual_micro_usd ELSE reserved_micro_usd END) FROM public.bot_energy_ai_usage GROUP BY organization_id,month;
ALTER TABLE public.bot_energy_ai_usage ADD COLUMN module text NOT NULL DEFAULT 'UNCLASSIFIED' CHECK(module IN ('OCR','BOT_ENERGY','CHAT','AUDITORIA','ANALISES','RAG','INDEXACAO','UNCLASSIFIED'));
ALTER TABLE public.bot_energy_ai_usage ADD COLUMN provider text NOT NULL DEFAULT 'AZURE_OPENAI';
-- Historic requests lack a reliable business module; do not invent attribution.
ALTER TABLE public.bot_energy_ai_months DROP CONSTRAINT bot_energy_ai_months_ceiling_micro_usd_check;
ALTER TABLE public.bot_energy_ai_months ADD CHECK(ceiling_micro_usd BETWEEN 1 AND 1000000000000000);
CREATE FUNCTION public.reserve_bot_energy_ai_usage_v2(p_id uuid,p_organization text,p_actor text,p_kind text,p_reserved_micro_usd bigint,p_module text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m date:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date; b public.bot_energy_ai_months; o public.bot_energy_ai_organization_months; quota bigint; total bigint;
BEGIN
 IF p_id IS NULL OR p_actor IS NULL OR p_kind NOT IN ('conversation','embeddings') OR p_kind IS NULL OR p_reserved_micro_usd IS NULL OR p_reserved_micro_usd<=0 OR p_module IS NULL OR p_module NOT IN ('OCR','BOT_ENERGY','CHAT','AUDITORIA','ANALISES','RAG','INDEXACAO') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_organization AND m.user_id::text=p_actor AND m.status='active' AND COALESCE(r.permissions,'[]'::jsonb) ? '62443ab1-9187-42e4-a932-a7cf54f76250') THEN RETURN false; END IF;
 -- Serialize quota policy, license activation and reservations using the same global lock.
 PERFORM pg_advisory_xact_lock(60405);
 quota:=public.bot_energy_license_quota(p_organization);
 IF quota<=0 THEN RETURN false; END IF;
 SELECT greatest(1,COALESCE(sum(greatest(CASE WHEN x.deleted_at IS NULL THEN public.bot_energy_license_quota(x.id) ELSE 0 END,COALESCE(h.committed_micro_usd,0))),0)+(SELECT platform_ai_micro_usd FROM public.platform_cost_policy WHERE id)) INTO total FROM public.organizations x LEFT JOIN public.bot_energy_ai_organization_months h ON h.organization_id=x.id AND h.month=m;
 INSERT INTO public.bot_energy_ai_months(month,ceiling_micro_usd) VALUES(m,total) ON CONFLICT(month) DO NOTHING;
 SELECT * INTO b FROM public.bot_energy_ai_months WHERE month=m FOR UPDATE;
 INSERT INTO public.bot_energy_ai_organization_months(organization_id,month) VALUES(p_organization,m) ON CONFLICT DO NOTHING;
 SELECT * INTO o FROM public.bot_energy_ai_organization_months WHERE organization_id=p_organization AND month=m FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.bot_energy_ai_usage WHERE id=p_id) OR b.committed_micro_usd+p_reserved_micro_usd>total OR o.committed_micro_usd+p_reserved_micro_usd>quota THEN RETURN false; END IF;
 INSERT INTO public.bot_energy_ai_usage(id,organization_id,actor_id,month,kind,reserved_micro_usd,module) VALUES(p_id,p_organization,p_actor,m,p_kind,p_reserved_micro_usd,p_module);
 UPDATE public.bot_energy_ai_months SET ceiling_micro_usd=total,committed_micro_usd=committed_micro_usd+p_reserved_micro_usd WHERE month=m;
 UPDATE public.bot_energy_ai_organization_months SET committed_micro_usd=committed_micro_usd+p_reserved_micro_usd WHERE organization_id=p_organization AND month=m;
 RETURN true;
END $$;
-- Existing callers must use the same gate; no bypass through the old RPC.
CREATE OR REPLACE FUNCTION public.reserve_bot_energy_ai_usage(p_id uuid,p_organization text,p_actor text,p_kind text,p_reserved_micro_usd bigint) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.reserve_bot_energy_ai_usage_v2(p_id,p_organization,p_actor,p_kind,p_reserved_micro_usd,'BOT_ENERGY');
$$;
CREATE OR REPLACE FUNCTION public.settle_bot_energy_ai_usage(p_id uuid,p_organization text,p_actual_micro_usd bigint,p_input_tokens bigint,p_output_tokens bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.bot_energy_ai_usage;
BEGIN
 IF p_actual_micro_usd IS NULL OR p_actual_micro_usd<0 OR p_input_tokens IS NULL OR p_input_tokens<0 OR p_output_tokens IS NULL OR p_output_tokens<0 THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(60405);
 SELECT * INTO r FROM public.bot_energy_ai_usage WHERE id=p_id AND organization_id=p_organization FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF r.state='SETTLED' THEN RETURN r.actual_micro_usd=p_actual_micro_usd AND r.input_tokens=p_input_tokens AND r.output_tokens=p_output_tokens; END IF;
 IF r.state<>'RESERVED' THEN RETURN false; END IF;
 IF p_actual_micro_usd>r.reserved_micro_usd THEN
 UPDATE public.bot_energy_ai_months SET committed_micro_usd=committed_micro_usd-r.reserved_micro_usd+p_actual_micro_usd WHERE month=r.month;
 UPDATE public.bot_energy_ai_organization_months SET committed_micro_usd=committed_micro_usd-r.reserved_micro_usd+p_actual_micro_usd WHERE organization_id=r.organization_id AND month=r.month;
 UPDATE public.bot_energy_ai_usage SET state='OVERRUN',actual_micro_usd=p_actual_micro_usd,input_tokens=p_input_tokens,output_tokens=p_output_tokens WHERE id=p_id; RETURN false; END IF;
 UPDATE public.bot_energy_ai_months SET committed_micro_usd=committed_micro_usd-r.reserved_micro_usd+p_actual_micro_usd WHERE month=r.month;
 UPDATE public.bot_energy_ai_organization_months SET committed_micro_usd=committed_micro_usd-r.reserved_micro_usd+p_actual_micro_usd WHERE organization_id=r.organization_id AND month=r.month;
 UPDATE public.bot_energy_ai_usage SET state='SETTLED',actual_micro_usd=p_actual_micro_usd,input_tokens=p_input_tokens,output_tokens=p_output_tokens,settled_at=clock_timestamp() WHERE id=p_id;
 RETURN true;
END $$;
CREATE TABLE public.platform_cost_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,kind text NOT NULL,changes jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.platform_infrastructure_costs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),month date NOT NULL CHECK(extract(day FROM month)=1),provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 80),service text NOT NULL CHECK(length(service) BETWEEN 1 AND 120),category text NOT NULL CHECK(category IN ('SERVER','DATABASE','STORAGE','BACKUP','OCR','OTHER')),organization_id text REFERENCES public.organizations(id),amount_minor bigint NOT NULL CHECK(amount_minor>=0 AND amount_minor<=1000000000000),currency text NOT NULL CHECK(currency IN ('USD','BRL')),basis text NOT NULL CHECK(basis IN ('INVOICE','ESTIMATE')),source text NOT NULL CHECK(length(source) BETWEEN 3 AND 1000),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.platform_runtime_samples(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),instance text NOT NULL,service text NOT NULL,observed_at timestamptz NOT NULL DEFAULT now(),metrics jsonb NOT NULL);
CREATE INDEX platform_runtime_time ON public.platform_runtime_samples(observed_at);
CREATE INDEX bot_energy_usage_time ON public.bot_energy_ai_usage(created_at,organization_id,module);
CREATE TABLE public.platform_cost_alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dedupe_key text NOT NULL UNIQUE,organization_id text,month date NOT NULL,level text NOT NULL,message text NOT NULL,channel text NOT NULL DEFAULT 'panel' CHECK(channel IN ('panel','email','whatsapp')),state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SENDING','SENT','UNKNOWN')),created_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,sent_at timestamptz);
CREATE FUNCTION public.platform_database_metrics() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('databaseBytes',pg_database_size(current_database()),'observedAt',clock_timestamp()); $$;
CREATE FUNCTION public.lock_ai_license_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM pg_advisory_xact_lock(60405); RETURN NEW; END $$;
-- All license writes serialize with budget reservations; the save RPC takes this lock before row locks.
CREATE TRIGGER ai_license_capacity_lock BEFORE INSERT OR UPDATE OR DELETE ON public.licenses FOR EACH STATEMENT EXECUTE FUNCTION public.lock_ai_license_capacity();
CREATE TRIGGER ai_policy_capacity_lock BEFORE UPDATE ON public.platform_cost_policy FOR EACH STATEMENT EXECUTE FUNCTION public.lock_ai_license_capacity();
CREATE OR REPLACE FUNCTION public.save_plan_license(target_organization text,target_license text,expected_revision integer,target_plan uuid,expected_version integer,starts date,ends date,renews date,next_status text,selected_modules jsonb,actor_id uuid,audit_ip text,audit_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.plan_catalog; saved public.licenses; previous public.licenses; chosen jsonb; k text;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 PERFORM pg_advisory_xact_lock(60405);
 PERFORM pg_advisory_xact_lock(hashtextextended(target_organization,315));
 IF starts IS NULL OR renews IS NULL OR (ends IS NOT NULL AND ends<starts) OR next_status NOT IN ('ACTIVE','SUSPENDED','EXPIRED','CANCELLED') THEN RAISE EXCEPTION 'Invalid license dates/status' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=target_organization AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Organization missing' USING ERRCODE='P3150'; END IF;
 SELECT * INTO p FROM public.plan_catalog WHERE id=target_plan FOR SHARE;
 IF NOT FOUND OR NOT p.active THEN RAISE EXCEPTION 'Active plan missing' USING ERRCODE='P3150'; END IF;
 IF p.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'Plan changed' USING ERRCODE='P3151'; END IF;
 IF target_license IS NOT NULL THEN
  SELECT * INTO previous FROM public.licenses WHERE id=target_license AND organization_id=target_organization FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'License missing' USING ERRCODE='P3150'; END IF;
  IF previous.governance_revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'License changed' USING ERRCODE='P3151'; END IF;
 END IF;
 IF selected_modules IS NOT NULL AND NOT selected_modules ? 'bot_energy_rag' THEN selected_modules:=selected_modules||jsonb_build_object('bot_energy_rag',false); END IF;
 chosen:=COALESCE(selected_modules,jsonb_build_object('document_management',p.document_management,'advanced_analytics',p.advanced_analytics,'report_generation',p.report_generation,'free_market_management',p.free_market_management,'bot_energy_rag',p.bot_energy_rag));
 IF jsonb_typeof(chosen)<>'object' OR chosen-'document_management'-'advanced_analytics'-'report_generation'-'free_market_management'-'bot_energy_rag'<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid module selection' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['document_management','advanced_analytics','report_generation','free_market_management','bot_energy_rag'] LOOP
  IF jsonb_typeof(chosen->k) IS DISTINCT FROM 'boolean' OR ((chosen->>k)::boolean AND NOT (to_jsonb(p)->>k)::boolean) THEN RAISE EXCEPTION 'Module unavailable in plan' USING ERRCODE='22023'; END IF;
 END LOOP;
 PERFORM set_config('app.license_actor',actor_id::text,true);
 IF target_license IS NULL THEN
  INSERT INTO public.licenses(id,organization_id,license_type,documents_limit,documents_used,documents_unlimited,renewal_date,start_date,end_date,status,active,max_consumer_units,max_users,document_management,advanced_analytics,report_generation,free_market_management,bot_energy_rag,ai_monthly_limit_micro_usd,monthly_price_brl_cents,plan_id,plan_version,plan_snapshot)
  VALUES(gen_random_uuid()::text,target_organization,p.name,p.documents_limit,0,p.documents_unlimited,renews,starts,ends,next_status,next_status='ACTIVE',p.max_consumer_units,p.max_users,(chosen->>'document_management')::boolean,(chosen->>'advanced_analytics')::boolean,(chosen->>'report_generation')::boolean,(chosen->>'free_market_management')::boolean,(chosen->>'bot_energy_rag')::boolean,CASE WHEN (chosen->>'bot_energy_rag')::boolean THEN p.ai_monthly_limit_micro_usd ELSE 0 END,p.monthly_price_brl_cents,p.id,p.version,to_jsonb(p)) RETURNING * INTO saved;
 ELSE
  UPDATE public.licenses SET license_type=p.name,documents_limit=p.documents_limit,documents_unlimited=p.documents_unlimited,renewal_date=renews,start_date=starts,end_date=ends,status=next_status,active=next_status='ACTIVE',max_consumer_units=p.max_consumer_units,max_users=p.max_users,document_management=(chosen->>'document_management')::boolean,advanced_analytics=(chosen->>'advanced_analytics')::boolean,report_generation=(chosen->>'report_generation')::boolean,free_market_management=(chosen->>'free_market_management')::boolean,bot_energy_rag=(chosen->>'bot_energy_rag')::boolean,ai_monthly_limit_micro_usd=CASE WHEN (chosen->>'bot_energy_rag')::boolean THEN p.ai_monthly_limit_micro_usd ELSE 0 END,monthly_price_brl_cents=p.monthly_price_brl_cents,plan_id=p.id,plan_version=p.version,plan_snapshot=to_jsonb(p),governance_revision=governance_revision+1,updated_at=now() WHERE id=target_license RETURNING * INTO saved;
 END IF;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent)
 VALUES(gen_random_uuid()::text,target_organization,actor_id,CASE WHEN target_license IS NULL THEN 'CREATE' ELSE 'UPDATE' END,'license',saved.id::text,jsonb_build_object('before',CASE WHEN target_license IS NULL THEN NULL ELSE to_jsonb(previous) END,'after',to_jsonb(saved)),'success',audit_ip,audit_agent);
 PERFORM set_config('app.license_actor','',true);
 RETURN to_jsonb(saved);
END $$;


CREATE FUNCTION public.platform_cost_snapshot(p_month date) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
 'policy',(SELECT to_jsonb(p) FROM public.platform_cost_policy p WHERE id),
 'global_ceiling_micro_usd',(SELECT greatest(1,COALESCE(sum(greatest(CASE WHEN x.deleted_at IS NULL THEN public.bot_energy_license_quota(x.id) ELSE 0 END,COALESCE(h.committed_micro_usd,0))),0)+(SELECT platform_ai_micro_usd FROM public.platform_cost_policy WHERE id)) FROM public.organizations x LEFT JOIN public.bot_energy_ai_organization_months h ON h.organization_id=x.id AND h.month=p_month),
 'totals',(SELECT jsonb_build_object('input_tokens',COALESCE(sum(input_tokens),0),'output_tokens',COALESCE(sum(output_tokens),0),'actual_micro_usd',COALESCE(sum(CASE WHEN state IN ('SETTLED','OVERRUN') THEN actual_micro_usd ELSE 0 END),0),'reserved_micro_usd',COALESCE(sum(CASE WHEN state NOT IN ('SETTLED','OVERRUN') THEN reserved_micro_usd ELSE 0 END),0),'pending',count(*) FILTER(WHERE state<>'SETTLED')) FROM public.bot_energy_ai_usage WHERE month=p_month),
 'daily',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY day) FROM (SELECT (created_at AT TIME ZONE 'UTC')::date AS day,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,sum(CASE WHEN state IN ('SETTLED','OVERRUN') THEN actual_micro_usd ELSE 0 END) actual_micro_usd FROM public.bot_energy_ai_usage WHERE month=p_month GROUP BY 1) q),'[]'::jsonb),
 'modules',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY module) FROM (SELECT module,provider,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,sum(CASE WHEN state IN ('SETTLED','OVERRUN') THEN actual_micro_usd ELSE 0 END) actual_micro_usd,count(*) calls FROM public.bot_energy_ai_usage WHERE month=p_month GROUP BY module,provider) q),'[]'::jsonb),
 'companies',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY name) FROM (SELECT o.id organization_id,o.name,public.bot_energy_license_quota(o.id) quota_micro_usd,(SELECT CASE WHEN count(*)=1 THEN max(l.monthly_price_brl_cents) ELSE NULL END FROM public.licenses l WHERE l.organization_id=o.id AND l.active AND lower(l.status)='active' AND l.start_date<=p_month AND (l.end_date IS NULL OR l.end_date>=((p_month+interval '1 month'-interval '1 day')::date))) monthly_price_brl_cents,COALESCE(sum(CASE WHEN u.state IN ('SETTLED','OVERRUN') THEN u.actual_micro_usd ELSE 0 END),0) actual_micro_usd,COALESCE(sum(CASE WHEN u.state NOT IN ('SETTLED','OVERRUN') THEN u.reserved_micro_usd ELSE 0 END),0) reserved_micro_usd,COALESCE(sum(u.input_tokens),0) input_tokens,COALESCE(sum(u.output_tokens),0) output_tokens FROM public.organizations o LEFT JOIN public.bot_energy_ai_usage u ON u.organization_id=o.id AND u.month=p_month WHERE o.deleted_at IS NULL GROUP BY o.id) q),'[]'::jsonb),
 'infrastructure',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY created_at DESC) FROM public.platform_infrastructure_costs c WHERE month=p_month),'[]'::jsonb),
 'runtime',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT DISTINCT ON(service,instance) service,instance,observed_at,metrics FROM public.platform_runtime_samples WHERE observed_at>clock_timestamp()-interval '10 minutes' ORDER BY service,instance,observed_at DESC) q),'[]'::jsonb),
 'alerts',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT id,organization_id,level,message,channel,state,created_at,sent_at FROM public.platform_cost_alerts WHERE month=p_month ORDER BY created_at DESC LIMIT 100) q),'[]'::jsonb),
 'database',public.platform_database_metrics());
$$;
CREATE FUNCTION public.save_platform_cost_setting(p_kind text,p_definition jsonb,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; previous jsonb;
BEGIN
 PERFORM public.assert_license_platform_actor(p_actor);
 IF p_kind='policy' THEN
  PERFORM pg_advisory_xact_lock(60405);
  SELECT to_jsonb(p) INTO previous FROM public.platform_cost_policy p WHERE id FOR UPDATE;
  IF (previous->>'revision')::integer IS DISTINCT FROM (p_definition->>'revision')::integer THEN RAISE EXCEPTION 'Policy changed' USING ERRCODE='P3151'; END IF;
  IF COALESCE((p_definition->>'email_enabled')::boolean,false) AND COALESCE(p_definition->>'email','') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'Email required' USING ERRCODE='22023'; END IF;
  IF (p_definition->>'usd_brl_rate') IS NOT NULL AND (p_definition->>'fx_date') IS NULL THEN RAISE EXCEPTION 'FX date required' USING ERRCODE='22023'; END IF;
  UPDATE public.platform_cost_policy SET platform_ai_micro_usd=(p_definition->>'platform_ai_micro_usd')::bigint,email=COALESCE(p_definition->>'email',''),whatsapp=COALESCE(p_definition->>'whatsapp',''),email_enabled=(p_definition->>'email_enabled')::boolean,monthly_cost_limit_brl_cents=(p_definition->>'monthly_cost_limit_brl_cents')::bigint,usd_brl_rate=(p_definition->>'usd_brl_rate')::numeric,fx_date=(p_definition->>'fx_date')::date,revision=revision+1,updated_at=clock_timestamp() WHERE id RETURNING to_jsonb(platform_cost_policy.*) INTO saved;
 ELSIF p_kind='infrastructure' THEN
  INSERT INTO public.platform_infrastructure_costs(month,provider,service,category,organization_id,amount_minor,currency,basis,source,created_by)
  VALUES((p_definition->>'month')::date,p_definition->>'provider',p_definition->>'service',p_definition->>'category',p_definition->>'organization_id',(p_definition->>'amount_minor')::bigint,p_definition->>'currency',p_definition->>'basis',p_definition->>'source',p_actor::text) RETURNING to_jsonb(platform_infrastructure_costs.*) INTO saved;
 ELSE RAISE EXCEPTION 'Invalid setting' USING ERRCODE='22023'; END IF;
 INSERT INTO public.platform_cost_audit(actor_id,kind,changes) VALUES(p_actor,p_kind,jsonb_build_object('before',previous,'after',saved));
 RETURN saved;
END $$;
CREATE FUNCTION public.claim_platform_cost_alert(p_channels text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.platform_cost_alerts;
BEGIN
 -- An abandoned send is UNKNOWN, not an automatic duplicate notification.
 UPDATE public.platform_cost_alerts SET state='UNKNOWN' WHERE state='SENDING' AND lease_until<clock_timestamp();
 SELECT * INTO a FROM public.platform_cost_alerts WHERE state='PENDING' AND channel=ANY(p_channels) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.platform_cost_alerts SET state='SENDING',lease_until=clock_timestamp()+interval '1 minute' WHERE id=a.id RETURNING * INTO a;
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.platform_cost_snapshot(date),public.save_platform_cost_setting(text,jsonb,uuid),public.claim_platform_cost_alert(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_cost_snapshot(date),public.save_platform_cost_setting(text,jsonb,uuid),public.claim_platform_cost_alert(text[]) TO service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_cost_audit','platform_cost_policy','bot_energy_pilot_allowance','bot_energy_ai_organization_months','platform_infrastructure_costs','platform_runtime_samples','platform_cost_alerts'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $$;
GRANT SELECT ON public.platform_cost_audit TO service_role;
GRANT SELECT,UPDATE ON public.platform_cost_policy TO service_role;
GRANT SELECT ON public.bot_energy_pilot_allowance,public.bot_energy_ai_organization_months TO service_role;
GRANT SELECT,INSERT ON public.platform_infrastructure_costs,public.platform_runtime_samples TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.platform_cost_alerts TO service_role;
REVOKE ALL ON FUNCTION public.bot_energy_license_quota(text),public.reserve_bot_energy_ai_usage_v2(uuid,text,text,text,bigint,text),public.platform_database_metrics(),public.lock_ai_license_capacity() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bot_energy_license_quota(text),public.reserve_bot_energy_ai_usage_v2(uuid,text,text,text,bigint,text),public.platform_database_metrics(),public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
