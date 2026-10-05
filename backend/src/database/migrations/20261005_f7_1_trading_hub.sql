BEGIN;

SET LOCAL lock_timeout='5s';

SET LOCAL statement_timeout='30s';

ALTER TABLE public.plan_catalog ADD COLUMN trading_hub boolean NOT NULL DEFAULT false;

ALTER TABLE public.licenses ADD COLUMN trading_hub boolean NOT NULL DEFAULT false;

ALTER FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) RENAME TO save_catalog_plan_before_trading;

REVOKE ALL ON FUNCTION public.save_catalog_plan_before_trading(uuid,integer,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$

DECLARE saved jsonb;

BEGIN

 PERFORM public.assert_license_platform_actor(actor_id);

 saved:=public.save_catalog_plan_before_trading(target_id,expected_version,definition,actor_id,audit_ip,audit_agent);

 UPDATE public.plan_catalog SET trading_hub=COALESCE((definition->>'trading_hub')::boolean,false) WHERE id=(saved->>'id')::uuid RETURNING to_jsonb(plan_catalog.*) INTO saved;

 UPDATE public.platform_plan_audit SET changes=jsonb_set(changes,'{after}',saved) WHERE plan_id=(saved->>'id')::uuid AND (changes->'after'->>'version')::integer=(saved->>'version')::integer;

 RETURN saved;

END $$;

CREATE TABLE public.trading_records (

 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),

 kind text NOT NULL CHECK(kind IN ('supplier','opportunity','proposal')),parent_id uuid REFERENCES public.trading_records(id),

 status text NOT NULL DEFAULT 'DRAFT',data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),

 created_by text NOT NULL,updated_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),

 UNIQUE(organization_id,id),CHECK(kind='proposal' OR parent_id IS NULL)

);

CREATE INDEX trading_records_scope ON public.trading_records(organization_id,kind,created_at DESC);

CREATE TABLE public.trading_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,record_id uuid NOT NULL REFERENCES public.trading_records(id),revision integer NOT NULL,actor_id text NOT NULL,action text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),snapshot jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),UNIQUE(record_id,revision));

ALTER TABLE public.trading_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.trading_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.trading_records,public.trading_history FROM PUBLIC,anon,authenticated;

GRANT SELECT ON public.trading_records,public.trading_history TO service_role;

CREATE FUNCTION public.assert_trading_actor(p_org text,p_actor text,p_write boolean,p_approve boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$

DECLARE n text;permissions jsonb;

BEGIN

 IF NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND trading_hub AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE)) OR (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1 THEN RAISE EXCEPTION 'Trading license required' USING ERRCODE='42501';END IF;

 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN PERFORM public.assert_license_platform_actor(p_actor::uuid);RETURN;END IF;

 SELECT r.name,r.permissions INTO n,permissions FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';

 IF n IS NULL OR n NOT IN ('admin_org','gestor','operacional') OR NOT COALESCE(permissions ? CASE WHEN p_write THEN 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce' ELSE '60f9690a-145b-4dba-b23f-9f945baca296' END,false) OR (p_approve AND n NOT IN ('admin_org','gestor')) THEN RAISE EXCEPTION 'Trading backoffice permission required' USING ERRCODE='42501';END IF;

END $$;

CREATE FUNCTION public.save_trading_record(p_org text,p_actor text,p_kind text,p_id uuid,p_revision integer,p_parent uuid,p_data jsonb,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$

DECLARE old public.trading_records;saved public.trading_records;

BEGIN

 PERFORM public.assert_trading_actor(p_org,p_actor,true);

 IF p_kind NOT IN ('supplier','opportunity','proposal') OR jsonb_typeof(p_data)<>'object' OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid trading data' USING ERRCODE='22023';END IF;

 IF p_id IS NOT NULL THEN SELECT * INTO old FROM public.trading_records WHERE id=p_id AND organization_id=p_org AND kind=p_kind FOR UPDATE;IF NOT FOUND OR old.revision IS DISTINCT FROM p_revision OR NOT (old.status IN ('DRAFT','RECEIVED') OR (p_kind='supplier' AND old.status='ACTIVE')) THEN RAISE EXCEPTION 'Trading version changed or immutable' USING ERRCODE='P3151';END IF;ELSIF p_revision<>0 THEN RAISE EXCEPTION 'Initial revision invalid' USING ERRCODE='22023';END IF;

 IF p_kind='opportunity' AND NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE organization_id=p_org AND id=p_data->>'unitId' AND customer_id=p_data->>'customerId') THEN RAISE EXCEPTION 'Unit outside scope' USING ERRCODE='42501';END IF;

 IF p_kind='proposal' AND NOT EXISTS(SELECT 1 FROM public.trading_records WHERE id=p_parent AND organization_id=p_org AND kind='opportunity' AND status IN ('DRAFT','OPEN','ANALYSIS')) THEN RAISE EXCEPTION 'Opportunity unavailable' USING ERRCODE='42501';END IF;

 INSERT INTO public.trading_records(id,organization_id,kind,parent_id,status,data,revision,created_by,updated_by,created_at)

 VALUES(COALESCE(p_id,gen_random_uuid()),p_org,p_kind,p_parent,COALESCE(old.status,CASE WHEN p_kind='proposal' THEN 'RECEIVED' ELSE 'DRAFT' END),p_data,COALESCE(old.revision,0)+1,COALESCE(old.created_by,p_actor),p_actor,COALESCE(old.created_at,now()))

 ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated_by=p_actor,updated_at=now() RETURNING * INTO saved;

 INSERT INTO public.trading_history(organization_id,record_id,revision,actor_id,action,reason,snapshot) VALUES(p_org,saved.id,saved.revision,p_actor,CASE WHEN p_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END,p_reason,to_jsonb(saved));

 RETURN to_jsonb(saved);

END $$;

CREATE FUNCTION public.transition_trading_record(p_org text,p_actor text,p_id uuid,p_revision integer,p_status text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$

DECLARE r public.trading_records;

BEGIN

 PERFORM public.assert_trading_actor(p_org,p_actor,true,p_status='MANAGER_APPROVED');

 SELECT * INTO r FROM public.trading_records WHERE id=p_id AND organization_id=p_org FOR UPDATE;

 IF NOT FOUND OR r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='P3151';END IF;

 IF length(btrim(p_reason)) NOT BETWEEN 3 AND 500 OR NOT ((r.kind='supplier' AND r.status='DRAFT' AND p_status='ACTIVE') OR (r.kind='supplier' AND r.status='ACTIVE' AND p_status='INACTIVE') OR (r.kind='opportunity' AND r.status='DRAFT' AND p_status='OPEN') OR (r.kind='opportunity' AND r.status='OPEN' AND p_status IN ('ANALYSIS','CANCELLED')) OR (r.kind='proposal' AND r.status='RECEIVED' AND p_status IN ('ANALYSIS','REJECTED')) OR (r.kind='proposal' AND r.status='ANALYSIS' AND p_status IN ('MANAGER_APPROVED','REJECTED'))) THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023';END IF;

 IF p_status='MANAGER_APPROVED' AND (coalesce((r.data->>'validUntil')::date<CURRENT_DATE,true) OR NOT EXISTS(SELECT 1 FROM public.trading_records s WHERE s.id=(r.data->>'supplierId')::uuid AND s.organization_id=p_org AND s.kind='supplier' AND s.status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public.trading_records o WHERE o.id=r.parent_id AND o.organization_id=p_org AND o.status IN ('OPEN','ANALYSIS') AND (o.data->>'expiresAt')::timestamptz>now())) THEN RAISE EXCEPTION 'Proposal expired or unavailable' USING ERRCODE='42501';END IF;

 UPDATE public.trading_records SET status=p_status,revision=revision+1,updated_by=p_actor,updated_at=now() WHERE id=r.id RETURNING * INTO r;

 INSERT INTO public.trading_history(organization_id,record_id,revision,actor_id,action,reason,snapshot) VALUES(p_org,r.id,r.revision,p_actor,p_status,p_reason,to_jsonb(r));RETURN to_jsonb(r);

END $$;

CREATE FUNCTION public.preserve_trading_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Immutable trading audit' USING ERRCODE='42501';END $$;

CREATE TRIGGER preserve_trading_history BEFORE UPDATE OR DELETE ON public.trading_history FOR EACH ROW EXECUTE FUNCTION public.preserve_trading_history();

REVOKE ALL ON FUNCTION public.assert_trading_actor(text,text,boolean,boolean),public.save_trading_record(text,text,text,uuid,integer,uuid,jsonb,text),public.transition_trading_record(text,text,uuid,integer,text,text),public.preserve_trading_history() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.save_trading_record(text,text,text,uuid,integer,uuid,jsonb,text),public.transition_trading_record(text,text,uuid,integer,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) TO service_role;



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

 IF selected_modules IS NOT NULL AND NOT selected_modules ? 'trading_hub' THEN selected_modules:=selected_modules||jsonb_build_object('trading_hub',false); END IF;

 chosen:=COALESCE(selected_modules,jsonb_build_object('document_management',p.document_management,'advanced_analytics',p.advanced_analytics,'report_generation',p.report_generation,'free_market_management',p.free_market_management,'bot_energy_rag',p.bot_energy_rag,'trading_hub',p.trading_hub));

 IF jsonb_typeof(chosen)<>'object' OR chosen-'document_management'-'advanced_analytics'-'report_generation'-'free_market_management'-'bot_energy_rag'-'trading_hub'<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid module selection' USING ERRCODE='22023'; END IF;

 FOREACH k IN ARRAY ARRAY['document_management','advanced_analytics','report_generation','free_market_management','bot_energy_rag','trading_hub'] LOOP

  IF jsonb_typeof(chosen->k) IS DISTINCT FROM 'boolean' OR ((chosen->>k)::boolean AND NOT (to_jsonb(p)->>k)::boolean) THEN RAISE EXCEPTION 'Module unavailable in plan' USING ERRCODE='22023'; END IF;

 END LOOP;

 PERFORM set_config('app.license_actor',actor_id::text,true);

 IF target_license IS NULL THEN

  INSERT INTO public.licenses(id,organization_id,license_type,documents_limit,documents_used,documents_unlimited,renewal_date,start_date,end_date,status,active,max_consumer_units,max_users,document_management,advanced_analytics,report_generation,free_market_management,trading_hub,bot_energy_rag,ai_monthly_limit_micro_usd,monthly_price_brl_cents,plan_id,plan_version,plan_snapshot)

  VALUES(gen_random_uuid()::text,target_organization,p.name,p.documents_limit,0,p.documents_unlimited,renews,starts,ends,next_status,next_status='ACTIVE',p.max_consumer_units,p.max_users,(chosen->>'document_management')::boolean,(chosen->>'advanced_analytics')::boolean,(chosen->>'report_generation')::boolean,(chosen->>'free_market_management')::boolean,(chosen->>'trading_hub')::boolean,(chosen->>'bot_energy_rag')::boolean,CASE WHEN (chosen->>'bot_energy_rag')::boolean THEN p.ai_monthly_limit_micro_usd ELSE 0 END,p.monthly_price_brl_cents,p.id,p.version,to_jsonb(p)) RETURNING * INTO saved;

 ELSE

  UPDATE public.licenses SET license_type=p.name,documents_limit=p.documents_limit,documents_unlimited=p.documents_unlimited,renewal_date=renews,start_date=starts,end_date=ends,status=next_status,active=next_status='ACTIVE',max_consumer_units=p.max_consumer_units,max_users=p.max_users,document_management=(chosen->>'document_management')::boolean,advanced_analytics=(chosen->>'advanced_analytics')::boolean,report_generation=(chosen->>'report_generation')::boolean,free_market_management=(chosen->>'free_market_management')::boolean,trading_hub=(chosen->>'trading_hub')::boolean,bot_energy_rag=(chosen->>'bot_energy_rag')::boolean,ai_monthly_limit_micro_usd=CASE WHEN (chosen->>'bot_energy_rag')::boolean THEN p.ai_monthly_limit_micro_usd ELSE 0 END,monthly_price_brl_cents=p.monthly_price_brl_cents,plan_id=p.id,plan_version=p.version,plan_snapshot=to_jsonb(p),governance_revision=governance_revision+1,updated_at=now() WHERE id=target_license RETURNING * INTO saved;

 END IF;

 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent)

 VALUES(gen_random_uuid()::text,target_organization,actor_id,CASE WHEN target_license IS NULL THEN 'CREATE' ELSE 'UPDATE' END,'license',saved.id::text,jsonb_build_object('before',CASE WHEN target_license IS NULL THEN NULL ELSE to_jsonb(previous) END,'after',to_jsonb(saved)),'success',audit_ip,audit_agent);

 PERFORM set_config('app.license_actor','',true);

 RETURN to_jsonb(saved);

END $$;







NOTIFY pgrst,'reload schema';

COMMIT;

