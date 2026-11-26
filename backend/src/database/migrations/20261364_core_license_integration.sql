BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.platform_core_plan_links(
 core_plan_id uuid NOT NULL,core_version integer NOT NULL CHECK(core_version>0),cycle text NOT NULL CHECK(cycle IN('MONTHLY','YEARLY')),
 scope_hash text NOT NULL,plan_id uuid NOT NULL UNIQUE REFERENCES public.plan_catalog(id),plan_version integer NOT NULL,
 PRIMARY KEY(core_plan_id,core_version,cycle)
);
CREATE TABLE public.platform_core_license_links(
 core_subscription_id uuid PRIMARY KEY,organization_id text NOT NULL UNIQUE REFERENCES public.organizations(id),license_id text NOT NULL UNIQUE REFERENCES public.licenses(id),
 customer_cnpj text NOT NULL UNIQUE,source jsonb NOT NULL,revision integer NOT NULL CHECK(revision>0),license_revision integer NOT NULL,
 billing jsonb NOT NULL,payment jsonb NOT NULL,started_on date NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.platform_core_license_events(
 event_id uuid PRIMARY KEY,core_subscription_id uuid NOT NULL REFERENCES public.platform_core_license_links(core_subscription_id),
 revision integer NOT NULL,body_hash text NOT NULL,actor_id uuid NOT NULL,proof jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(core_subscription_id,revision)
);
CREATE TABLE public.platform_core_welcomes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),core_subscription_id uuid NOT NULL UNIQUE REFERENCES public.platform_core_license_links(core_subscription_id),
 organization_id text NOT NULL REFERENCES public.organizations(id),email text NOT NULL,name text NOT NULL,role_id text NOT NULL REFERENCES public.roles(id),
 state text NOT NULL DEFAULT 'PREPARED' CHECK(state IN('PREPARED','PROVISIONING','IDENTITY_READY','SENDING','SENT','UNKNOWN','FAILED')),
 password_cipher jsonb,user_id uuid,membership_id uuid,provisioning_path text,provider_id text,expires_at timestamptz,lease_id uuid,mail_hash text,mail_attempts integer NOT NULL DEFAULT 0,
 detail text,updated_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now()
);
-- Explicit RLS for every new table; no direct access through API roles.
ALTER TABLE public.platform_core_plan_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_core_license_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_core_license_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_core_welcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_core_plan_links FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.platform_core_license_links FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.platform_core_license_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.platform_core_welcomes FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.platform_core_billing_state(b jsonb,on_day date)RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE due date;days integer;
BEGIN
 IF b->'cancelled'='true'::jsonb THEN RETURN jsonb_build_object('state','cancelled','blocked',true,'notice','Assinatura cancelada.');END IF;
 IF b->>'paidThrough' IS NULL THEN RETURN jsonb_build_object('state','suspended','blocked',true,'notice','Assinatura aguardando conciliação do pagamento.');END IF;
 due:=coalesce((b->>'oldestUnpaidDueOn')::date,(b->>'paidThrough')::date);days:=on_day-due;
 IF days>0 THEN RETURN jsonb_build_object('state',CASE WHEN days>7 THEN 'suspended' ELSE 'grace' END,'blocked',days>7,'notice','Assinatura em atraso','overdueDays',days);END IF;
 RETURN jsonb_build_object('state','active','blocked',false,'notice',NULL);
END $$;
REVOKE ALL ON FUNCTION public.platform_core_billing_state(jsonb,date)FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.platform_core_license_sync(p_actor uuid,p_body jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE link public.platform_core_license_links;prior public.platform_core_license_events;mapping public.platform_core_plan_links;
 bodyhash text;scopehash text;sourceproof jsonb;definition jsonb;catalog jsonb;saved jsonb;state jsonb;result jsonb;beforelic public.licenses;
 coreid uuid;eventid uuid;rev integer;today date:=(now()AT TIME ZONE 'America/Sao_Paulo')::date;org text;starts date;expiry date;roleid text;welcomeid uuid;k text;name text;
BEGIN
 PERFORM public.platform_team_owner(p_actor);PERFORM public.assert_license_platform_actor(p_actor);
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>32768 OR p_body-ARRAY['eventId','coreSubscriptionId','revision','source','customer','plan','contract','payment','billing']<>'{}' THEN RAISE EXCEPTION 'Invalid Core command' USING ERRCODE='22023';END IF;
 coreid:=(p_body->>'coreSubscriptionId')::uuid;eventid:=(p_body->>'eventId')::uuid;rev:=(p_body->>'revision')::integer;
 IF coreid IS NULL OR eventid IS NULL OR rev IS NULL OR rev<1 OR rev>100000000 OR p_body#>>'{contract,environment}' IS DISTINCT FROM 'production' OR p_body#>>'{contract,contentHash}' !~ '^[a-f0-9]{64}$' OR p_body#>>'{contract,signedPdfHash}' !~ '^[a-f0-9]{64}$' OR p_body#>>'{customer,cnpj}' !~ '^[A-Z0-9]{12}[0-9]{2}$' THEN RAISE EXCEPTION 'Production evidence required' USING ERRCODE='22023';END IF;
 bodyhash:=encode(sha256(convert_to(p_body::text,'UTF8')),'hex');PERFORM pg_advisory_xact_lock(hashtextextended('core-license:'||coreid::text,0));
 SELECT * INTO prior FROM public.platform_core_license_events WHERE event_id=eventid;
 IF FOUND THEN IF prior.body_hash<>bodyhash OR prior.actor_id<>p_actor THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='P3660';END IF;RETURN prior.result;END IF;
 IF (p_body#>>'{payment,verifiedAt}')::timestamptz<now()-interval '15 minutes' OR (p_body#>>'{payment,verifiedAt}')::timestamptz>now()+interval '5 minutes' OR (p_body#>>'{contract,verifiedAt}')::timestamptz>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Reconcile fresh source first' USING ERRCODE='P3660';END IF;
 IF p_body->>'source' NOT IN('site','manual') OR p_body#>>'{payment,cycle}' NOT IN('MONTHLY','YEARLY') OR p_body->>'source'='site'AND p_body#>>'{payment,billingType}'<>'CREDIT_CARD' THEN RAISE EXCEPTION 'Invalid billing scope' USING ERRCODE='22023';END IF;
 sourceproof:=jsonb_build_object('customer',p_body->'customer','plan',p_body->'plan','contract',p_body->'contract','subscription',p_body#>'{payment,subscriptionId}','payer',p_body#>'{payment,customerId}','cycle',p_body#>'{payment,cycle}','source',p_body->'source');
 SELECT * INTO link FROM public.platform_core_license_links WHERE core_subscription_id=coreid FOR UPDATE;
 IF FOUND AND (link.source IS DISTINCT FROM sourceproof OR rev<=link.revision)THEN RAISE EXCEPTION 'Contract or revision changed' USING ERRCODE='P3660';END IF;
 state:=public.platform_core_billing_state(p_body->'billing',today);
 IF link.core_subscription_id IS NULL AND (state->>'state'<>'active' OR p_body#>>'{payment,status}' NOT IN('CONFIRMED','RECEIVED'))THEN RAISE EXCEPTION 'Settled production payment required before provisioning' USING ERRCODE='42501';END IF;
 IF state->>'state'='active' AND p_body#>>'{payment,status}' NOT IN('CONFIRMED','RECEIVED') THEN RAISE EXCEPTION 'Unconfirmed payment cannot enable access' USING ERRCODE='42501';END IF;
 IF (p_body#>>'{billing,paidThrough}')::date>today+(CASE p_body#>>'{payment,cycle}' WHEN 'YEARLY' THEN 400 ELSE 40 END) THEN RAISE EXCEPTION 'Payment coverage out of bounds' USING ERRCODE='22023';END IF;
 scopehash:=encode(sha256(convert_to((p_body->'plan')::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('core-plan:'||(p_body#>>'{plan,id}')||':'||(p_body#>>'{plan,version}')||':'||(p_body#>>'{payment,cycle}'),0));
 SELECT * INTO mapping FROM public.platform_core_plan_links WHERE core_plan_id=(p_body#>>'{plan,id}')::uuid AND core_version=(p_body#>>'{plan,version}')::integer AND cycle=p_body#>>'{payment,cycle}';
 IF FOUND AND mapping.scope_hash<>scopehash THEN RAISE EXCEPTION 'Frozen Core plan changed' USING ERRCODE='P3660';END IF;
 IF mapping.plan_id IS NULL THEN
  name:='Core EnergyOS · '||left(p_body#>>'{plan,name}',50)||' · '||left(p_body#>>'{plan,id}',8)||'v'||(p_body#>>'{plan,version}')||left(p_body#>>'{payment,cycle}',1);
  definition:=jsonb_build_object('name',name,'description',p_body#>'{plan,description}','active',true,'documents_unlimited',false,'documents_limit',p_body#>'{plan,limits,documents}','max_users',p_body#>'{plan,limits,users}','max_consumer_units',p_body#>'{plan,limits,units}','max_clients',p_body#>'{plan,limits,clients}','ai_monthly_limit_micro_usd',p_body#>'{plan,aiMonthlyMicroUsd}','monthly_price_brl_cents',p_body#>'{plan,monthlyCents}')||(p_body#>'{plan,modules}');
  catalog:=public.save_catalog_plan(NULL,NULL,definition,p_actor,NULL,'Energy Core license automation');
  INSERT INTO public.platform_core_plan_links VALUES((p_body#>>'{plan,id}')::uuid,(p_body#>>'{plan,version}')::integer,p_body#>>'{payment,cycle}',scopehash,(catalog->>'id')::uuid,(catalog->>'version')::integer)RETURNING * INTO mapping;
 END IF;
 IF link.core_subscription_id IS NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('core-cnpj:'||(p_body#>>'{customer,cnpj}'),0));
  IF EXISTS(SELECT 1 FROM public.platform_core_license_links WHERE customer_cnpj=p_body#>>'{customer,cnpj}')THEN RAISE EXCEPTION 'Existing customer requires explicit amendment review' USING ERRCODE='P3660';END IF;
  IF (SELECT count(*)FROM public.platform_core_license_links WHERE created_at>now()-interval '1 day')>=100 THEN RAISE EXCEPTION 'Core provisioning daily review limit reached' USING ERRCODE='P3660';END IF;
  org:=gen_random_uuid()::text;starts:=today;PERFORM * FROM public.create_organization_with_canonical_rbac(org,p_body#>>'{customer,legalName}','Licença EnergyOS gerida pelo Energy Core');
 ELSE
  org:=link.organization_id;starts:=link.started_on;SELECT * INTO beforelic FROM public.licenses WHERE id=link.license_id AND organization_id=org FOR UPDATE;
  IF beforelic.id IS NULL OR beforelic.governance_revision<>link.license_revision THEN RAISE EXCEPTION 'Owner changed license; reconcile before applying' USING ERRCODE='P3660';END IF;
 END IF;
 expiry:=greatest(starts,coalesce((p_body#>>'{billing,paidThrough}')::date,today)+7);
 saved:=public.save_plan_license(org,link.license_id,link.license_revision,mapping.plan_id,mapping.plan_version,starts,expiry,coalesce((p_body#>>'{billing,paidThrough}')::date,today),CASE state->>'state' WHEN 'cancelled' THEN 'CANCELLED' WHEN 'suspended' THEN 'SUSPENDED' ELSE 'ACTIVE' END,p_body#>'{plan,modules}',p_actor,NULL,'Energy Core license automation');
 IF link.core_subscription_id IS NULL THEN
  INSERT INTO public.platform_core_license_links(core_subscription_id,organization_id,license_id,customer_cnpj,source,revision,license_revision,billing,payment,started_on)VALUES(coreid,org,saved->>'id',p_body#>>'{customer,cnpj}',sourceproof,rev,(saved->>'governance_revision')::integer,p_body->'billing',p_body->'payment',starts);
  SELECT r.id INTO STRICT roleid FROM public.roles r WHERE r.organization_id=org AND r.scope='organization'AND r.name='admin_org';
  INSERT INTO public.platform_core_welcomes(core_subscription_id,organization_id,email,name,role_id)VALUES(coreid,org,p_body#>>'{customer,email}',p_body#>>'{customer,adminName}',roleid)RETURNING id INTO welcomeid;
 ELSE
  UPDATE public.platform_core_license_links SET revision=rev,license_revision=(saved->>'governance_revision')::integer,billing=p_body->'billing',payment=p_body->'payment',updated_at=now() WHERE core_subscription_id=coreid;
  SELECT id INTO welcomeid FROM public.platform_core_welcomes WHERE core_subscription_id=coreid;
 END IF;
 result:=jsonb_build_object('organizationId',org,'licenseId',saved->>'id','revision',rev,'state',state->>'state','startsOn',starts,'welcomeId',welcomeid);
 INSERT INTO public.platform_core_license_events VALUES(eventid,coreid,rev,bodyhash,p_actor,p_body,result,now());
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,user_agent)VALUES(gen_random_uuid()::text,org,p_actor,'UPDATE','core_license',saved->>'id',jsonb_build_object('coreSubscriptionId',coreid,'eventId',eventid,'revision',rev,'state',state,'contractHash',p_body#>'{contract,contentHash}','paymentId',p_body#>'{payment,id}'),'success','Energy Core authenticated license integration');
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.platform_core_license_sync(uuid,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_core_license_sync(uuid,jsonb)TO service_role;

CREATE FUNCTION public.platform_core_subscription_access(p_org text,p_user uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l public.platform_core_license_links;counts jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org AND user_id::text=p_user::text AND status='active')THEN RAISE EXCEPTION 'Membership required' USING ERRCODE='42501';END IF;
 SELECT * INTO l FROM public.platform_core_license_links WHERE organization_id=p_org;
 IF l.core_subscription_id IS NULL THEN RETURN jsonb_build_object('managed',false);END IF;
 RETURN jsonb_build_object('managed',true,'organizationId',p_org,'paidThrough',l.billing->'paidThrough','oldestUnpaidDueOn',l.billing->'oldestUnpaidDueOn')||public.platform_core_billing_state(l.billing,(now()AT TIME ZONE 'America/Sao_Paulo')::date);
END $$;
REVOKE ALL ON FUNCTION public.platform_core_subscription_access(text,uuid)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_core_subscription_access(text,uuid)TO service_role;

CREATE FUNCTION public.platform_core_welcome_action(p_actor uuid,p_action text,p_body jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE w public.platform_core_welcomes;l public.platform_core_license_links;wid uuid;lease uuid;state jsonb;
BEGIN
 PERFORM public.platform_team_owner(p_actor);PERFORM public.assert_license_platform_actor(p_actor);
 IF p_action IS NULL OR p_action NOT IN('read','lease','identity','sending','sent','unknown')OR p_body IS NULL OR jsonb_typeof(p_body)<>'object'OR octet_length(p_body::text)>12000 THEN RAISE EXCEPTION 'Invalid welcome command' USING ERRCODE='22023';END IF;
 wid:=(p_body->>'id')::uuid;IF wid IS NULL THEN RAISE EXCEPTION 'Welcome required' USING ERRCODE='22023';END IF;
 SELECT * INTO w FROM public.platform_core_welcomes WHERE id=wid FOR UPDATE;
 IF w.id IS NULL THEN RAISE EXCEPTION 'Welcome missing' USING ERRCODE='22023';END IF;
 SELECT * INTO STRICT l FROM public.platform_core_license_links WHERE core_subscription_id=w.core_subscription_id FOR SHARE;
 state:=public.platform_core_billing_state(l.billing,(now()AT TIME ZONE 'America/Sao_Paulo')::date);
 IF p_action='read' THEN RETURN to_jsonb(w)||jsonb_build_object('organization_name',l.source#>>'{customer,legalName}');END IF;
 IF w.state='SENT' THEN RETURN to_jsonb(w)||jsonb_build_object('organization_name',l.source#>>'{customer,legalName}');END IF;
 IF state->>'state'<>'active'OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE id=l.license_id AND organization_id=l.organization_id AND active AND lower(status)='active')THEN RAISE EXCEPTION 'Eligible paid license required' USING ERRCODE='42501';END IF;
 IF p_action='lease' THEN
  IF w.state<>'PREPARED'THEN RETURN to_jsonb(w)||jsonb_build_object('organization_name',l.source#>>'{customer,legalName}');END IF;
  lease:=(p_body->>'leaseId')::uuid;
  IF lease IS NULL OR jsonb_typeof(p_body->'cipher')<>'object'OR (p_body->>'expiresAt')::timestamptz<=now()OR (p_body->>'expiresAt')::timestamptz>now()+interval '25 hours'THEN RAISE EXCEPTION 'Invalid temporary access' USING ERRCODE='22023';END IF;
  UPDATE public.platform_core_welcomes SET state='PROVISIONING',lease_id=lease,password_cipher=p_body->'cipher',expires_at=(p_body->>'expiresAt')::timestamptz,updated_at=now() WHERE id=wid RETURNING * INTO w;
  RETURN to_jsonb(w)||jsonb_build_object('organization_name',l.source#>>'{customer,legalName}');
 END IF;
 IF w.lease_id IS DISTINCT FROM(p_body->>'leaseId')::uuid THEN RAISE EXCEPTION 'Welcome lease changed' USING ERRCODE='P3660';END IF;
 IF p_action='identity' THEN
  IF w.state<>'PROVISIONING'OR p_body->>'path' IS NULL OR p_body->>'path' NOT IN('new_identity','existing_identity')OR NOT EXISTS(SELECT 1 FROM public.organization_members WHERE id::text=p_body->>'membershipId'AND organization_id=w.organization_id AND user_id::text=p_body->>'userId'AND role_id=w.role_id AND status='active')THEN RAISE EXCEPTION 'Identity proof missing' USING ERRCODE='P3660';END IF;
  UPDATE public.platform_core_welcomes SET state='IDENTITY_READY',user_id=(p_body->>'userId')::uuid,membership_id=(p_body->>'membershipId')::uuid,provisioning_path=p_body->>'path',updated_at=now() WHERE id=wid RETURNING * INTO w;
 ELSIF p_action='sending' THEN
  IF w.state NOT IN('IDENTITY_READY','SENDING')OR w.expires_at<=now()OR w.mail_attempts>=5 OR (w.mail_hash IS NOT NULL AND w.mail_hash IS DISTINCT FROM p_body->>'mailHash')OR p_body->>'mailHash' IS NULL OR p_body->>'mailHash'!~'^[a-f0-9]{64}$'OR(p_body->>'nextLeaseId')::uuid IS NULL THEN RAISE EXCEPTION 'Welcome not ready' USING ERRCODE='P3660';END IF;
  IF w.state='SENDING'AND w.updated_at>now()-make_interval(secs=>least(1800,60*power(2,greatest(0,w.mail_attempts-1)))::integer)THEN RAISE EXCEPTION 'Mail confirmation pending' USING ERRCODE='P3660';END IF;
  UPDATE public.platform_core_welcomes SET state='SENDING',lease_id=(p_body->>'nextLeaseId')::uuid,mail_hash=p_body->>'mailHash',mail_attempts=mail_attempts+1,updated_at=now() WHERE id=wid RETURNING * INTO w;
 ELSIF p_action='sent' THEN
  IF w.state<>'SENDING'OR coalesce(length(p_body->>'providerId'),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Mail confirmation missing' USING ERRCODE='P3660';END IF;
  UPDATE public.platform_core_welcomes SET state='SENT',provider_id=p_body->>'providerId',password_cipher=NULL,updated_at=now() WHERE id=wid RETURNING * INTO w;
  INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,user_agent)VALUES(gen_random_uuid()::text,w.organization_id,p_actor,'CREATE','core_welcome',w.id::text,jsonb_build_object('userId',w.user_id,'membershipId',w.membership_id,'providerId',w.provider_id,'passwordLogged',false,'passwordSetupRequired',w.provisioning_path='new_identity'),'success','Energy Core license onboarding');
 ELSIF p_action='unknown' THEN
  IF w.state NOT IN('PROVISIONING','IDENTITY_READY','SENDING')THEN RETURN to_jsonb(w)||jsonb_build_object('organization_name',l.source#>>'{customer,legalName}');END IF;
  UPDATE public.platform_core_welcomes SET state='UNKNOWN',detail='Confirmação técnica necessária; não repetir criação de usuário ou envio sem conferir o provedor.',updated_at=now() WHERE id=wid RETURNING * INTO w;
 END IF;
 RETURN to_jsonb(w)||jsonb_build_object('organization_name',l.source#>>'{customer,legalName}');
END $$;
REVOKE ALL ON FUNCTION public.platform_core_welcome_action(uuid,text,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_core_welcome_action(uuid,text,jsonb)TO service_role;

CREATE FUNCTION public.platform_core_license_status(p_actor uuid,p_ids uuid[])RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.platform_team_owner(p_actor);PERFORM public.assert_license_platform_actor(p_actor);
 IF p_ids IS NULL OR cardinality(p_ids)>50 THEN RAISE EXCEPTION 'Invalid status scope' USING ERRCODE='22023';END IF;
 RETURN(SELECT coalesce(jsonb_agg(jsonb_build_object('coreSubscriptionId',l.core_subscription_id,'organizationId',l.organization_id,'activeUsers',u.active_count,'inactiveUsers',u.inactive_count,'checkedAt',now())),'[]'::jsonb)
 FROM public.platform_core_license_links l CROSS JOIN LATERAL(SELECT count(*)FILTER(WHERE m.status='active')active_count,count(*)FILTER(WHERE m.status<>'active')inactive_count FROM public.organization_members m WHERE m.organization_id=l.organization_id)u WHERE l.core_subscription_id=ANY(p_ids));
END $$;
REVOKE ALL ON FUNCTION public.platform_core_license_status(uuid,uuid[])FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_core_license_status(uuid,uuid[])TO service_role;

COMMIT;
