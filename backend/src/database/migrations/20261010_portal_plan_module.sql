-- Portal is a platform-selected plan module. Customer configuration is scoped to the organization administrator.
-- No plans, licenses, users, roles, financial snapshots or publication states are enabled/rewritten by this migration.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
ALTER TABLE public.plan_catalog ADD COLUMN client_portal boolean NOT NULL DEFAULT false;
ALTER TABLE public.licenses ADD COLUMN client_portal boolean NOT NULL DEFAULT false;
ALTER FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) RENAME TO save_catalog_plan_before_portal_module;
REVOKE ALL ON FUNCTION public.save_catalog_plan_before_portal_module(uuid,integer,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; next_portal boolean;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 PERFORM pg_advisory_xact_lock(60405);
 IF definition ? 'client_portal' AND jsonb_typeof(definition->'client_portal')<>'boolean' THEN RAISE EXCEPTION 'Invalid Portal module flag' USING ERRCODE='22023'; END IF;
 IF target_id IS NOT NULL THEN SELECT client_portal INTO next_portal FROM public.plan_catalog WHERE id=target_id FOR UPDATE; END IF;
 next_portal:=CASE WHEN definition ? 'client_portal' THEN (definition->>'client_portal')::boolean ELSE coalesce(next_portal,false) END;
 saved:=public.save_catalog_plan_before_portal_module(target_id,expected_version,definition-'client_portal',actor_id,audit_ip,audit_agent);
 UPDATE public.plan_catalog SET client_portal=next_portal WHERE id=(saved->>'id')::uuid RETURNING to_jsonb(plan_catalog.*) INTO saved;
 UPDATE public.platform_plan_audit SET changes=jsonb_set(changes,'{after}',saved) WHERE plan_id=(saved->>'id')::uuid AND (changes->'after'->>'version')::integer=(saved->>'version')::integer;
 RETURN saved;
END $$;
CREATE FUNCTION public.assert_portal_customer_manager(org text,actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id::text=actor::text AND r.name='admin_platform' AND r.scope='global') THEN
  PERFORM public.assert_license_platform_actor(actor);
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=org AND user_id=actor AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Active platform organization context required' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' JOIN public.organizations o ON o.id=m.organization_id AND o.deleted_at IS NULL WHERE m.organization_id=org AND m.user_id=actor AND m.status='active' AND r.name IN ('admin_org','gestor') AND r.permissions ? '94f57d38-0438-43c5-81bc-5544ab53912a' AND r.permissions ? '8c5673e4-115c-4ab7-bb11-3b410eddcad3') THEN RAISE EXCEPTION 'Organization administrator or manager required for Portal customers' USING ERRCODE='42501'; END IF;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.snapshot_portal_actor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.kind='PORTAL_LICENSE' THEN PERFORM public.assert_portal_customer_manager(NEW.organization_id,NEW.actor_id); ELSE PERFORM public.assert_license_platform_actor(NEW.actor_id); END IF;
 SELECT coalesce(nullif(btrim(m.display_name),''),nullif(btrim(p.name),'')) INTO NEW.actor_name FROM public.user_profiles p LEFT JOIN public.organization_members m ON m.user_id=p.user_id AND m.organization_id=NEW.organization_id WHERE p.user_id=NEW.actor_id;
 IF EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id::text=NEW.actor_id::text AND r.name='admin_platform' AND r.scope='global') THEN NEW.actor_affiliation:='platform';NEW.actor_role:='admin_platform';
 ELSE SELECT coalesce(m.affiliation_type,'not_defined'),r.name INTO NEW.actor_affiliation,NEW.actor_role FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.user_id=NEW.actor_id AND m.organization_id=NEW.organization_id AND m.status='active'; END IF;
 RETURN NEW;
END $$;
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
 IF selected_modules IS NOT NULL AND NOT selected_modules ? 'client_portal' THEN selected_modules:=selected_modules||jsonb_build_object('client_portal',false); END IF;
 chosen:=COALESCE(selected_modules,jsonb_build_object('document_management',p.document_management,'advanced_analytics',p.advanced_analytics,'report_generation',p.report_generation,'free_market_management',p.free_market_management,'bot_energy_rag',p.bot_energy_rag,'trading_hub',p.trading_hub,'ccee_registrations',p.ccee_registrations,'client_portal',p.client_portal));

 IF jsonb_typeof(chosen)<>'object' OR chosen-'document_management'-'advanced_analytics'-'report_generation'-'free_market_management'-'bot_energy_rag'-'trading_hub'-'ccee_registrations'-'client_portal'<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid module selection' USING ERRCODE='22023'; END IF;

 FOREACH k IN ARRAY ARRAY['document_management','advanced_analytics','report_generation','free_market_management','bot_energy_rag','trading_hub','ccee_registrations','client_portal'] LOOP

  IF jsonb_typeof(chosen->k) IS DISTINCT FROM 'boolean' OR ((chosen->>k)::boolean AND NOT (to_jsonb(p)->>k)::boolean) THEN RAISE EXCEPTION 'Module unavailable in plan' USING ERRCODE='22023'; END IF;

 END LOOP;

 PERFORM set_config('app.license_actor',actor_id::text,true);

 IF target_license IS NULL THEN

  INSERT INTO public.licenses(id,organization_id,license_type,documents_limit,documents_used,documents_unlimited,renewal_date,start_date,end_date,status,active,max_consumer_units,max_users,document_management,advanced_analytics,report_generation,free_market_management,client_portal,ccee_registrations,trading_hub,bot_energy_rag,ai_monthly_limit_micro_usd,monthly_price_brl_cents,plan_id,plan_version,plan_snapshot)

  VALUES(gen_random_uuid()::text,target_organization,p.name,p.documents_limit,0,p.documents_unlimited,renews,starts,ends,next_status,next_status='ACTIVE',p.max_consumer_units,p.max_users,(chosen->>'document_management')::boolean,(chosen->>'advanced_analytics')::boolean,(chosen->>'report_generation')::boolean,(chosen->>'free_market_management')::boolean,(chosen->>'client_portal')::boolean,(chosen->>'ccee_registrations')::boolean,(chosen->>'trading_hub')::boolean,(chosen->>'bot_energy_rag')::boolean,CASE WHEN (chosen->>'bot_energy_rag')::boolean THEN p.ai_monthly_limit_micro_usd ELSE 0 END,p.monthly_price_brl_cents,p.id,p.version,to_jsonb(p)) RETURNING * INTO saved;

 ELSE

  UPDATE public.licenses SET license_type=p.name,documents_limit=p.documents_limit,documents_unlimited=p.documents_unlimited,renewal_date=renews,start_date=starts,end_date=ends,status=next_status,active=next_status='ACTIVE',max_consumer_units=p.max_consumer_units,max_users=p.max_users,document_management=(chosen->>'document_management')::boolean,advanced_analytics=(chosen->>'advanced_analytics')::boolean,report_generation=(chosen->>'report_generation')::boolean,free_market_management=(chosen->>'free_market_management')::boolean,client_portal=(chosen->>'client_portal')::boolean,ccee_registrations=(chosen->>'ccee_registrations')::boolean,trading_hub=(chosen->>'trading_hub')::boolean,bot_energy_rag=(chosen->>'bot_energy_rag')::boolean,ai_monthly_limit_micro_usd=CASE WHEN (chosen->>'bot_energy_rag')::boolean THEN p.ai_monthly_limit_micro_usd ELSE 0 END,monthly_price_brl_cents=p.monthly_price_brl_cents,plan_id=p.id,plan_version=p.version,plan_snapshot=to_jsonb(p),governance_revision=governance_revision+1,updated_at=now() WHERE id=target_license RETURNING * INTO saved;

 END IF;

 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent)

 VALUES(gen_random_uuid()::text,target_organization,actor_id,CASE WHEN target_license IS NULL THEN 'CREATE' ELSE 'UPDATE' END,'license',saved.id::text,jsonb_build_object('before',CASE WHEN target_license IS NULL THEN NULL ELSE to_jsonb(previous) END,'after',to_jsonb(saved)),'success',audit_ip,audit_agent);

 PERFORM set_config('app.license_actor','',true);

 RETURN to_jsonb(saved);

END $$;
CREATE OR REPLACE FUNCTION public.client_portal_parent_license(org text) RETURNS public.licenses LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lic public.licenses;
BEGIN
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1 THEN RAISE EXCEPTION 'One effective organization license required' USING ERRCODE='42501'; END IF;
 SELECT * INTO lic FROM public.licenses WHERE organization_id=org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
 IF lic.plan_id IS NULL OR lic.plan_version IS NULL OR lic.max_users IS NULL OR lic.max_consumer_units IS NULL THEN RAISE EXCEPTION 'Regularize parent catalog license before Portal preparation' USING ERRCODE='P3410'; END IF;
 IF NOT lic.client_portal THEN RAISE EXCEPTION 'Portal module not contracted' USING ERRCODE='42501'; END IF;
 RETURN lic;
END $$;
CREATE OR REPLACE FUNCTION public.check_portal_modules(lic public.licenses,modules jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_typeof(modules)='array' AND jsonb_array_length(modules)<=10 AND jsonb_array_length(modules)=(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(modules) x) AND NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements_text(modules) x WHERE CASE x
 WHEN 'agenda' THEN lic.client_portal
 WHEN 'notifications' THEN lic.client_portal
 WHEN 'map' THEN lic.client_portal
 WHEN 'trading' THEN lic.client_portal AND lic.trading_hub
 WHEN 'reports' THEN lic.report_generation AND lic.free_market_management
 WHEN 'forecasts' THEN lic.report_generation AND lic.free_market_management AND lic.advanced_analytics
 WHEN 'energy_prices' THEN lic.report_generation AND lic.free_market_management
 WHEN 'acl' THEN lic.free_market_management
 WHEN 'documents' THEN lic.document_management
 WHEN 'bot' THEN lic.bot_energy_rag AND lic.report_generation AND lic.free_market_management
 ELSE false END IS DISTINCT FROM true),false);
$$;
CREATE OR REPLACE FUNCTION public.save_client_portal_license(p_org text,p_customer text,p_actor uuid,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous public.client_portal_licenses; saved public.client_portal_licenses; lic public.licenses; revision integer; reason text;
BEGIN
 PERFORM public.assert_portal_customer_manager(p_org,p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND organization_id=p_org AND deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Customer outside organization' USING ERRCODE='42501'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR NOT p_data ?& ARRAY['revision','status','starts','ends','modules','maxUsers','maxUnits','reason'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('revision','status','starts','ends','modules','maxUsers','maxUnits','reason')) THEN RAISE EXCEPTION 'Invalid portal license fields' USING ERRCODE='22023'; END IF;
 lic:=public.client_portal_parent_license(p_org);reason:=btrim(p_data->>'reason');revision:=(p_data->>'revision')::integer;
 IF reason IS NULL OR length(reason) NOT BETWEEN 3 AND 1000 OR p_data->>'status' NOT IN ('ACTIVE','SUSPENDED','CANCELLED') OR (p_data->>'starts')::date IS NULL OR (p_data->>'ends')::date IS NULL OR (p_data->>'ends')::date<(p_data->>'starts')::date OR NOT public.check_portal_modules(lic,p_data->'modules') OR (p_data->>'maxUsers')::integer IS NULL OR (p_data->>'maxUnits')::integer IS NULL OR (p_data->>'maxUsers')::integer<0 OR (p_data->>'maxUnits')::integer<0 OR (p_data->>'maxUsers')::integer>lic.max_users OR (p_data->>'maxUnits')::integer>lic.max_consumer_units THEN RAISE EXCEPTION 'Portal conditions exceed parent license or are invalid' USING ERRCODE='22023'; END IF;
 IF (p_data->>'starts')::date<lic.start_date OR (lic.end_date IS NOT NULL AND (p_data->>'ends')::date>lic.end_date) THEN RAISE EXCEPTION 'Portal dates exceed parent license' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND exclusive_customer_id=p_customer AND status='active' AND affiliation_type='external')>(p_data->>'maxUsers')::integer OR (SELECT count(*) FROM public.consumer_units WHERE organization_id=p_org AND customer_id=p_customer)>(p_data->>'maxUnits')::integer THEN RAISE EXCEPTION 'Portal limit below retained usage' USING ERRCODE='P3412'; END IF;
 SELECT * INTO previous FROM public.client_portal_licenses WHERE organization_id=p_org AND customer_id=p_customer FOR UPDATE;
 IF NOT FOUND THEN
  IF revision IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Portal license revision changed' USING ERRCODE='P3413'; END IF;
  INSERT INTO public.client_portal_licenses(organization_id,customer_id,status,starts,ends,modules,max_users,max_units,created_by,updated_by) VALUES(p_org,p_customer,p_data->>'status',(p_data->>'starts')::date,(p_data->>'ends')::date,p_data->'modules',(p_data->>'maxUsers')::integer,(p_data->>'maxUnits')::integer,p_actor,p_actor) RETURNING * INTO saved;
 ELSE
  IF revision IS DISTINCT FROM previous.revision THEN RAISE EXCEPTION 'Portal license revision changed' USING ERRCODE='P3413'; END IF;
  -- Customer uniqueness and optimistic revision prevent duplicate grants on retry.
  UPDATE public.client_portal_licenses SET status=p_data->>'status',starts=(p_data->>'starts')::date,ends=(p_data->>'ends')::date,modules=p_data->'modules',max_users=(p_data->>'maxUsers')::integer,max_units=(p_data->>'maxUnits')::integer,revision=client_portal_licenses.revision+1,updated_by=p_actor,updated_at=now() WHERE id=previous.id RETURNING * INTO saved;
 END IF;
 INSERT INTO public.client_portal_license_events(organization_id,actor_id,kind,resource_id,reason,before_snapshot,after_snapshot) VALUES(p_org,p_actor,'PORTAL_LICENSE',saved.id::text,reason,CASE WHEN previous.id IS NULL THEN NULL ELSE to_jsonb(previous) END,to_jsonb(saved));
 RETURN to_jsonb(saved);
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_entitlement(p_org text,p_actor text,p_role text,p_module text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer text; portal public.client_portal_licenses; lic public.licenses; enabled boolean;
BEGIN
 IF p_module IS NOT NULL AND p_module NOT IN ('reports','forecasts','energy_prices','acl','documents','bot','agenda','notifications','map','trading') THEN RAISE EXCEPTION 'Invalid portal module' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Client scope required' USING ERRCODE='42501'; END IF;
 SELECT c.id INTO customer FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' JOIN public.customers c ON c.id=m.exclusive_customer_id AND c.organization_id=m.organization_id JOIN public.organizations o ON o.id=m.organization_id AND o.deleted_at IS NULL
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id=p_role AND m.status='active' AND m.affiliation_type='external' AND r.name='consulta' AND c.status='ACTIVE' AND c.deleted_at IS NULL;
 IF customer IS NULL THEN RAISE EXCEPTION 'Exclusive client scope required' USING ERRCODE='42501'; END IF;

 lic:=public.client_portal_parent_license(p_org);
 SELECT * INTO portal FROM public.client_portal_licenses WHERE organization_id=p_org AND customer_id=customer AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE;
 IF NOT FOUND OR NOT public.check_portal_modules(lic,portal.modules) OR (p_module IS NOT NULL AND NOT (portal.modules ? p_module)) THEN RAISE EXCEPTION 'Portal license or module unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('enabled',true,'organizationId',p_org,'customerId',customer,'status',portal.status,'starts',portal.starts,'ends',portal.ends,'modules',portal.modules,'maxUsers',portal.max_users,'maxUnits',portal.max_units,'revision',portal.revision);
END $$;
REVOKE ALL ON FUNCTION public.assert_portal_customer_manager(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text),public.save_client_portal_license(text,text,uuid,jsonb),public.client_portal_entitlement(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text),public.save_client_portal_license(text,text,uuid,jsonb),public.client_portal_entitlement(text,text,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.client_capacity(org text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lic public.licenses; used bigint; cap bigint; n bigint; enabled boolean;
BEGIN
 SELECT coalesce((SELECT p.enabled FROM public.client_portal_policies p WHERE p.organization_id=org),false) INTO enabled;
 SELECT count(*) INTO used FROM public.organization_members WHERE organization_id=org AND status='active';
 SELECT count(*) INTO n FROM public.licenses WHERE organization_id=org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
 IF n=1 THEN
  SELECT * INTO lic FROM public.licenses WHERE organization_id=org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
  cap:=lic.max_users;
 END IF;
 RETURN jsonb_build_object('enabled',coalesce(lic.client_portal,false),'portalContracted',coalesce(lic.client_portal,false),'licenseId',lic.id,'base',cap,'additional',0,'contracted',cap,'used',used,'available',CASE WHEN cap IS NULL THEN NULL ELSE greatest(0,cap-used) END,'configured',n=1 AND cap IS NOT NULL AND lic.plan_id IS NOT NULL AND lic.plan_version IS NOT NULL,'resource','users','shared',true);
END $$;
CREATE OR REPLACE FUNCTION public.enforce_client_portal_resource_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer text; cap integer; used bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 IF NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=NEW.organization_id AND client_portal AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE)) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='organization_members' THEN
  IF NEW.status<>'active' OR NEW.affiliation_type IS DISTINCT FROM 'external' OR NEW.exclusive_customer_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='active' AND OLD.affiliation_type='external' AND OLD.exclusive_customer_id=NEW.exclusive_customer_id THEN RETURN NEW; END IF;
  customer:=NEW.exclusive_customer_id;
 ELSE
  IF TG_OP='UPDATE' AND OLD.customer_id=NEW.customer_id THEN RETURN NEW; END IF;
  customer:=NEW.customer_id;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 IF TG_TABLE_NAME='organization_members' THEN
  IF NOT EXISTS(SELECT 1 FROM public.roles r JOIN public.customers c ON c.id=customer AND c.organization_id=NEW.organization_id AND c.status='ACTIVE' AND c.deleted_at IS NULL WHERE r.id=NEW.role_id AND r.organization_id=NEW.organization_id AND r.scope='organization' AND r.name='consulta') THEN RAISE EXCEPTION 'Exclusive client and read-only role required' USING ERRCODE='42501'; END IF;
  SELECT max_users INTO cap FROM public.client_portal_licenses WHERE organization_id=NEW.organization_id AND customer_id=customer AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE AND public.check_portal_modules(public.client_portal_parent_license(NEW.organization_id),modules);
  IF cap IS NULL THEN RAISE EXCEPTION 'Client portal license required for external membership' USING ERRCODE='P3410'; END IF;
  SELECT count(*) INTO used FROM public.organization_members WHERE organization_id=NEW.organization_id AND exclusive_customer_id=customer AND status='active' AND affiliation_type='external' AND id<>NEW.id;
 ELSE
  SELECT max_units INTO cap FROM public.client_portal_licenses WHERE organization_id=NEW.organization_id AND customer_id=customer AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE;
  IF cap IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO used FROM public.consumer_units WHERE organization_id=NEW.organization_id AND customer_id=customer AND id<>NEW.id;
 END IF;
 IF used>=cap THEN RAISE EXCEPTION 'Client portal resource quota exceeded' USING ERRCODE='P3411'; END IF;
 RETURN NEW;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
