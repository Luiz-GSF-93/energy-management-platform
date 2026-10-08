-- Independent optional entitlement. No plan, license or role is enabled automatically.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.plan_catalog ADD COLUMN ccee_registrations boolean NOT NULL DEFAULT false;
ALTER TABLE public.licenses ADD COLUMN ccee_registrations boolean NOT NULL DEFAULT false;
ALTER FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) RENAME TO save_catalog_plan_before_ccee;
REVOKE ALL ON FUNCTION public.save_catalog_plan_before_ccee(uuid,integer,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 IF definition ? 'ccee_registrations' AND jsonb_typeof(definition->'ccee_registrations')<>'boolean' THEN RAISE EXCEPTION 'Invalid CCEE module flag' USING ERRCODE='22023'; END IF;
 saved:=public.save_catalog_plan_before_ccee(target_id,expected_version,definition-'ccee_registrations',actor_id,audit_ip,audit_agent);
 UPDATE public.plan_catalog SET ccee_registrations=COALESCE((definition->>'ccee_registrations')::boolean,false) WHERE id=(saved->>'id')::uuid RETURNING to_jsonb(plan_catalog.*) INTO saved;
 UPDATE public.platform_plan_audit SET changes=jsonb_set(changes,'{after}',saved) WHERE plan_id=(saved->>'id')::uuid AND (changes->'after'->>'version')::integer=(saved->>'version')::integer;
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
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

 IF selected_modules IS NOT NULL AND NOT selected_modules ? 'ccee_registrations' THEN selected_modules:=selected_modules||jsonb_build_object('ccee_registrations',false); END IF;
 chosen:=COALESCE(selected_modules,jsonb_build_object('document_management',p.document_management,'advanced_analytics',p.advanced_analytics,'report_generation',p.report_generation,'free_market_management',p.free_market_management,'bot_energy_rag',p.bot_energy_rag,'trading_hub',p.trading_hub,'ccee_registrations',p.ccee_registrations));

 IF jsonb_typeof(chosen)<>'object' OR chosen-'document_management'-'advanced_analytics'-'report_generation'-'free_market_management'-'bot_energy_rag'-'trading_hub'-'ccee_registrations'<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid module selection' USING ERRCODE='22023'; END IF;

 FOREACH k IN ARRAY ARRAY['document_management','advanced_analytics','report_generation','free_market_management','bot_energy_rag','trading_hub','ccee_registrations'] LOOP

  IF jsonb_typeof(chosen->k) IS DISTINCT FROM 'boolean' OR ((chosen->>k)::boolean AND NOT (to_jsonb(p)->>k)::boolean) THEN RAISE EXCEPTION 'Module unavailable in plan' USING ERRCODE='22023'; END IF;

 END LOOP;

 PERFORM set_config('app.license_actor',actor_id::text,true);

 IF target_license IS NULL THEN

  INSERT INTO public.licenses(id,organization_id,license_type,documents_limit,documents_used,documents_unlimited,renewal_date,start_date,end_date,status,active,max_consumer_units,max_users,document_management,advanced_analytics,report_generation,free_market_management,ccee_registrations,trading_hub,bot_energy_rag,ai_monthly_limit_micro_usd,monthly_price_brl_cents,plan_id,plan_version,plan_snapshot)

  VALUES(gen_random_uuid()::text,target_organization,p.name,p.documents_limit,0,p.documents_unlimited,renews,starts,ends,next_status,next_status='ACTIVE',p.max_consumer_units,p.max_users,(chosen->>'document_management')::boolean,(chosen->>'advanced_analytics')::boolean,(chosen->>'report_generation')::boolean,(chosen->>'free_market_management')::boolean,(chosen->>'ccee_registrations')::boolean,(chosen->>'trading_hub')::boolean,(chosen->>'bot_energy_rag')::boolean,CASE WHEN (chosen->>'bot_energy_rag')::boolean THEN p.ai_monthly_limit_micro_usd ELSE 0 END,p.monthly_price_brl_cents,p.id,p.version,to_jsonb(p)) RETURNING * INTO saved;

 ELSE

  UPDATE public.licenses SET license_type=p.name,documents_limit=p.documents_limit,documents_unlimited=p.documents_unlimited,renewal_date=renews,start_date=starts,end_date=ends,status=next_status,active=next_status='ACTIVE',max_consumer_units=p.max_consumer_units,max_users=p.max_users,document_management=(chosen->>'document_management')::boolean,advanced_analytics=(chosen->>'advanced_analytics')::boolean,report_generation=(chosen->>'report_generation')::boolean,free_market_management=(chosen->>'free_market_management')::boolean,ccee_registrations=(chosen->>'ccee_registrations')::boolean,trading_hub=(chosen->>'trading_hub')::boolean,bot_energy_rag=(chosen->>'bot_energy_rag')::boolean,ai_monthly_limit_micro_usd=CASE WHEN (chosen->>'bot_energy_rag')::boolean THEN p.ai_monthly_limit_micro_usd ELSE 0 END,monthly_price_brl_cents=p.monthly_price_brl_cents,plan_id=p.id,plan_version=p.version,plan_snapshot=to_jsonb(p),governance_revision=governance_revision+1,updated_at=now() WHERE id=target_license RETURNING * INTO saved;

 END IF;

 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent)

 VALUES(gen_random_uuid()::text,target_organization,actor_id,CASE WHEN target_license IS NULL THEN 'CREATE' ELSE 'UPDATE' END,'license',saved.id::text,jsonb_build_object('before',CASE WHEN target_license IS NULL THEN NULL ELSE to_jsonb(previous) END,'after',to_jsonb(saved)),'success',audit_ip,audit_agent);

 PERFORM set_config('app.license_actor','',true);

 RETURN to_jsonb(saved);

END $$;








REVOKE ALL ON FUNCTION public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
