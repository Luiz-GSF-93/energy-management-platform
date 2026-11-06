BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_operational_policies(
 organization_id text PRIMARY KEY REFERENCES public.organizations(id),enabled boolean NOT NULL DEFAULT false,
 actor_id text NOT NULL,revision integer NOT NULL DEFAULT 1,reason text NOT NULL,
 discover_bindings boolean NOT NULL DEFAULT true,prepare_sources boolean NOT NULL DEFAULT true,
 calendar_rules jsonb NOT NULL DEFAULT '[]',financial_rules jsonb NOT NULL DEFAULT '[]',
 homologation_limit integer NOT NULL DEFAULT 10 CHECK(homologation_limit BETWEEN 0 AND 10),
 requests_reserved integer NOT NULL DEFAULT 0 CHECK(requests_reserved>=0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(length(reason) BETWEEN 20 AND 1000),CHECK(jsonb_typeof(calendar_rules)='array' AND octet_length(calendar_rules::text)<=8000),
 CHECK(jsonb_typeof(financial_rules)='array' AND octet_length(financial_rules::text)<=8000)
);
CREATE TABLE public.eva_operational_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 month text NOT NULL CHECK(month~'^20[0-9]{2}-(0[1-9]|1[0-2])$'),kind text NOT NULL CHECK(kind IN('UNIT_SYNC','CLOSING')),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','WAITING','SUCCEEDED','UNKNOWN','PAUSED')),
 generation integer NOT NULL DEFAULT 1,claimed_generation integer,attempts integer NOT NULL DEFAULT 0,requests integer NOT NULL DEFAULT 0,
 lease_id uuid,lease_until timestamptz,write_started boolean NOT NULL DEFAULT false,
 result jsonb NOT NULL DEFAULT '{}',last_error text,next_run_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,consumer_unit_id,month,kind),CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=64000)
);
CREATE INDEX eva_operational_runs_updated ON public.eva_operational_runs(organization_id,updated_at DESC);
CREATE INDEX eva_operational_queue ON public.eva_operational_runs(next_run_at,state);
CREATE TABLE public.eva_operational_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 month text NOT NULL,closing_id uuid REFERENCES public.eva_assisted_closing_versions(id),closing_hash text,
 state text NOT NULL DEFAULT 'REQUIRES_INPUT' CHECK(state IN('REQUIRES_INPUT','READY_OPERATOR','SUBMITTED','RETURNED','APPROVED')),
 cost_ack jsonb NOT NULL DEFAULT '{}',submitted_by text,submitted_at timestamptz,returned_by text,return_reason text,
 revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,consumer_unit_id,month),CHECK(jsonb_typeof(cost_ack)='object' AND octet_length(cost_ack::text)<=4000)
);
CREATE INDEX eva_operational_reviews_updated ON public.eva_operational_reviews(organization_id,updated_at DESC);
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['eva_operational_policies','eva_operational_runs','eva_operational_reviews'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
END LOOP;END$$;

CREATE FUNCTION public.eva_flow_actor(p_org text,p_actor text,p_write boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.organization_members;role_name text;probe jsonb;u text;permissions jsonb;
BEGIN
 SELECT * INTO m FROM public.organization_members WHERE organization_id=p_org AND user_id::text=p_actor AND upper(status)='ACTIVE' AND affiliation_type='internal' AND exclusive_customer_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Backoffice membership required' USING ERRCODE='42501';END IF;
 SELECT r.name INTO role_name FROM public.roles r WHERE r.id=m.role_id AND r.organization_id=p_org AND r.scope='organization';
 IF role_name NOT IN('admin_org','gestor','operacional') OR role_name IS NULL THEN RAISE EXCEPTION 'Internal backoffice role required' USING ERRCODE='42501';END IF;
 SELECT id INTO u FROM public.consumer_units WHERE organization_id=p_org ORDER BY id LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'Registered unit required' USING ERRCODE='42501';END IF;
 probe:=public.eva_scoped_closing_action(p_org,p_actor,m.role_id,false,'history',u,to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM'),NULL,'{"page":0}','UNIT','DOCUMENTED',false);
 SELECT coalesce(jsonb_agg(x),'[]') INTO permissions FROM public.roles rr CROSS JOIN LATERAL jsonb_array_elements(rr.permissions) x WHERE rr.id=m.role_id AND rr.organization_id=p_org AND (m.permission_limit IS NULL OR m.permission_limit @> jsonb_build_array(x));
 probe:=probe||jsonb_build_object('canPrepare',coalesce((probe->>'canPrepare')::boolean,false) AND permissions?'92e1b670-ab10-483a-b825-c6e16799496d' AND (permissions?'beb6ec90-8ba8-40ce-a156-aeef6cc75cce' OR role_name='operacional' AND permissions?'fd8a932f-87c0-4f86-8389-9f30c50e95b7'),'canManage',coalesce((probe->>'canManage')::boolean,false) AND permissions?'fd8a932f-87c0-4f86-8389-9f30c50e95b7');
 IF p_write AND probe->'canPrepare' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Preparation permission required' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('roleId',m.role_id,'role',role_name,'canPrepare',probe->'canPrepare','canManage',probe->'canManage');
END$$;
REVOKE ALL ON FUNCTION public.eva_flow_actor(text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_flow_wake(p_org text,p_customer text,p_unit text,p_month text,p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_month IS NULL OR p_month!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' OR p_kind NOT IN('UNIT_SYNC','CLOSING') OR NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.organization_id=u.organization_id AND c.id=u.customer_id WHERE u.organization_id=p_org AND u.id=p_unit AND u.customer_id=p_customer AND u.status='ACTIVE' AND c.deleted_at IS NULL) THEN RETURN;END IF;
 INSERT INTO public.eva_operational_runs(organization_id,customer_id,consumer_unit_id,month,kind) VALUES(p_org,p_customer,p_unit,p_month,p_kind)
 ON CONFLICT(organization_id,consumer_unit_id,month,kind) DO UPDATE SET generation=eva_operational_runs.generation+1,
 state=CASE WHEN eva_operational_runs.state IN('RUNNING','UNKNOWN','PAUSED') THEN eva_operational_runs.state ELSE 'QUEUED' END,
 next_run_at=least(eva_operational_runs.next_run_at,now()),updated_at=now();
END$$;
REVOKE ALL ON FUNCTION public.eva_flow_wake(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_flow_source_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d jsonb:=to_jsonb(NEW);u record;m text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.eva_operational_policies WHERE organization_id=d->>'organization_id' AND enabled) THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='eva_automatic_intakes' THEN
  IF d->>'state' NOT IN('AWAITING_SOURCES','PROPOSAL_READY') THEN RETURN NEW;END IF;d:=d||jsonb_build_object('consumer_unit_id',d->>'unit_id');
 ELSIF TG_TABLE_NAME='document_ocr_jobs' THEN SELECT d||jsonb_build_object('organization_id',doc.organization_id,'customer_id',doc.customer_id,'consumer_unit_id',doc.consumer_unit_id,'reference_month',doc.reference_month) INTO d FROM public.documents doc WHERE doc.organization_id=d->>'organization_id' AND doc.id=d->>'document_id';
 ELSIF TG_TABLE_NAME='ccee_integration_jobs' THEN
  IF d->>'state'<>'SUCCEEDED' THEN RETURN NEW;END IF;
  SELECT d||jsonb_build_object('customer_id',b.customer_id,'consumer_unit_id',b.consumer_unit_id) INTO d FROM public.ccee_unit_authorizations b WHERE b.organization_id=d->>'organization_id' AND b.id::text=d->>'authorization_id';
 END IF;
 IF d->>'customer_id' IS NULL AND d->>'consumer_unit_id' IS NOT NULL THEN SELECT d||jsonb_build_object('customer_id',cu.customer_id) INTO d FROM public.consumer_units cu WHERE cu.organization_id=d->>'organization_id' AND cu.id=d->>'consumer_unit_id';END IF;
 IF TG_OP='UPDATE' AND (d-ARRAY['updated_at','last_seen_at'])=(to_jsonb(OLD)-ARRAY['updated_at','last_seen_at']) THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='ccee_unit_authorizations' THEN
  PERFORM public.eva_flow_wake(d->>'organization_id',d->>'customer_id',d->>'consumer_unit_id',to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM'),'UNIT_SYNC');
 END IF;
 IF TG_TABLE_NAME='consumer_units' THEN
  PERFORM public.eva_flow_wake(d->>'organization_id',d->>'customer_id',d->>'id',to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM'),'UNIT_SYNC');
  FOR m IN SELECT DISTINCT reference_month::text FROM public.documents WHERE organization_id=d->>'organization_id' AND consumer_unit_id=d->>'id' AND document_type='INVOICE_DISTRIBUTOR' LOOP PERFORM public.eva_flow_wake(d->>'organization_id',d->>'customer_id',d->>'id',left(m,7),'CLOSING');END LOOP;
 ELSIF TG_TABLE_NAME='customers' THEN
  FOR u IN SELECT * FROM public.consumer_units WHERE organization_id=d->>'organization_id' AND customer_id=d->>'id' LOOP PERFORM public.eva_flow_wake(u.organization_id,u.customer_id,u.id,to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM'),'UNIT_SYNC');END LOOP;
 ELSE
  m:=left(coalesce(d->>'month',d->>'reference_month'),7);
  IF m IS NOT NULL THEN PERFORM public.eva_flow_wake(d->>'organization_id',d->>'customer_id',d->>'consumer_unit_id',m,'CLOSING');
  ELSE
   FOR u IN SELECT DISTINCT doc.organization_id,doc.customer_id,doc.consumer_unit_id,left(doc.reference_month::text,7) AS month FROM public.documents doc WHERE doc.organization_id=d->>'organization_id' AND (d->>'customer_id' IS NULL OR doc.customer_id=d->>'customer_id') AND (d->>'consumer_unit_id' IS NULL OR doc.consumer_unit_id=d->>'consumer_unit_id') AND doc.document_type='INVOICE_DISTRIBUTOR' AND doc.reference_month>=date_trunc('month',now())-interval '12 months'
   LOOP PERFORM public.eva_flow_wake(u.organization_id,u.customer_id,u.consumer_unit_id,u.month,'CLOSING');END LOOP;
  END IF;
 END IF;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.eva_flow_source_changed() FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['consumer_units','customers','documents','eva_automatic_intakes','document_ocr_jobs','ccee_integration_jobs','ccee_unit_authorizations','tariff_library_versions','energy_contracts','calculation_parameters','calculation_monthly_inputs','calculation_monthly_costs','unit_demand_periods','unit_demand_approvals','management_contracts','management_fee_allocations','commercial_fee_adjustments'] LOOP
 EXECUTE format('CREATE TRIGGER eva_flow_source_changed AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_flow_source_changed()',t);
END LOOP;END$$;

CREATE FUNCTION public.eva_flow_record_closing() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v public.eva_assisted_closing_versions;u text;old public.eva_operational_reviews;next_state text;
BEGIN
 IF NEW.state NOT IN('INCOMPLETE','READY_FOR_REVIEW','APPROVED') THEN RETURN NEW;END IF;
 SELECT * INTO v FROM public.eva_assisted_closing_versions WHERE id=NEW.closing_id AND organization_id=NEW.organization_id;
 IF v.report#>>'{scope,kind}' IS DISTINCT FROM 'UNIT' OR NOT EXISTS(SELECT 1 FROM public.eva_operational_policies WHERE organization_id=v.organization_id AND enabled) THEN RETURN NEW;END IF;
 u:=v.report#>>'{scope,unitIds,0}';
 IF EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions n WHERE n.organization_id=v.organization_id AND n.consumer_unit_id=v.consumer_unit_id AND n.month=v.month AND n.version>v.version AND n.report#>>'{scope,kind}'='UNIT') THEN RETURN NEW;END IF;
 IF v.report->'unitIds' IS DISTINCT FROM jsonb_build_array(u) THEN RAISE EXCEPTION 'Unit review scope mismatch';END IF;
 SELECT * INTO old FROM public.eva_operational_reviews WHERE organization_id=v.organization_id AND consumer_unit_id=u AND month=v.month FOR UPDATE;
 next_state:=CASE WHEN NEW.state='APPROVED' THEN 'APPROVED' WHEN v.report->'approvalEligible'='true'::jsonb THEN 'READY_OPERATOR' ELSE 'REQUIRES_INPUT' END;
 INSERT INTO public.eva_operational_reviews(organization_id,customer_id,consumer_unit_id,month,closing_id,closing_hash,state) VALUES(v.organization_id,v.customer_id,u,v.month,v.id,v.payload_hash,next_state)
 ON CONFLICT(organization_id,consumer_unit_id,month) DO UPDATE SET closing_id=v.id,closing_hash=v.payload_hash,
 state=CASE WHEN eva_operational_reviews.closing_id=v.id AND eva_operational_reviews.state='SUBMITTED' AND next_state='READY_OPERATOR' THEN 'SUBMITTED' ELSE next_state END,
 revision=eva_operational_reviews.revision+1,updated_at=now();
 RETURN NEW;
END$$;
CREATE TRIGGER eva_flow_record_closing AFTER INSERT ON public.eva_assisted_closing_events FOR EACH ROW EXECUTE FUNCTION public.eva_flow_record_closing();
REVOKE ALL ON FUNCTION public.eva_flow_record_closing() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_flow_action(p_org text,p_actor text,p_action text,p_unit text DEFAULT NULL,p_month text DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='30s' AS $$
DECLARE rights jsonb;p public.eva_operational_policies;r public.eva_operational_reviews;v public.eva_assisted_closing_versions;c public.calculation_monthly_costs;u public.consumer_units;rule jsonb;existing public.ccee_integration_events;req uuid;reply jsonb;role_name text;
BEGIN
 rights:=public.eva_flow_actor(p_org,p_actor,p_action NOT IN('read','status','notifications'));
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>40000 OR p_action NOT IN('read','configure','status','submit','return','ack_costs') THEN RAISE EXCEPTION 'Invalid operational command' USING ERRCODE='22023';END IF;
 SELECT * INTO p FROM public.eva_operational_policies WHERE organization_id=p_org;
 IF p_action='read' THEN PERFORM public.assert_ccee_data_actor(p_org,p_actor,'view');RETURN jsonb_build_object('organizationId',p_org,'policy',to_jsonb(p),'canManage',rights->'canManage','canConfigure',rights->>'role'='admin_org','runsTotal',(SELECT count(*) FROM public.eva_operational_runs rr WHERE rr.organization_id=p_org),'runs',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT rr.*,cu.name unit_name,cc.company_name customer_name FROM public.eva_operational_runs rr JOIN public.consumer_units cu ON cu.id=rr.consumer_unit_id AND cu.organization_id=rr.organization_id JOIN public.customers cc ON cc.id=rr.customer_id AND cc.organization_id=rr.organization_id WHERE rr.organization_id=p_org ORDER BY rr.updated_at DESC LIMIT 100)x),'rows',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT q.*,cust.company_name customer_name,unitrow.name unit_name FROM public.eva_operational_reviews q JOIN public.customers cust ON cust.id=q.customer_id AND cust.organization_id=q.organization_id JOIN public.consumer_units unitrow ON unitrow.id=q.consumer_unit_id AND unitrow.organization_id=q.organization_id WHERE q.organization_id=p_org ORDER BY q.updated_at DESC LIMIT 100)x));END IF;
 IF p_action='configure' THEN
  PERFORM public.ccee_permanent_automation_actor(p_org,p_actor);
  IF rights->>'role' IS DISTINCT FROM 'admin_org' OR rights->'canManage' IS DISTINCT FROM 'true'::jsonb OR p_org<>'org_default' OR p_body-ARRAY['enabled','reason','requestId','calendarRules','financialRules','discoverBindings','prepareSources','revision']<>'{}'::jsonb OR jsonb_typeof(p_body->'enabled') IS DISTINCT FROM 'boolean' OR length(coalesce(p_body->>'reason','')) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Administrator policy required' USING ERRCODE='42501';END IF;
  req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request required';END IF;
  SELECT * INTO existing FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=req;
  IF FOUND THEN IF existing.actor_id<>p_actor OR existing.details->'command' IS DISTINCT FROM to_jsonb(md5(p_body::text)) THEN RAISE EXCEPTION 'Policy request changed' USING ERRCODE='40001';END IF;RETURN existing.details->'result';END IF;
  IF p.organization_id IS NOT NULL AND (p_body->>'revision')::integer IS DISTINCT FROM p.revision THEN RAISE EXCEPTION 'Policy changed' USING ERRCODE='40001';END IF;
  IF jsonb_typeof(coalesce(p_body->'calendarRules','[]'))<>'array' OR jsonb_array_length(coalesce(p_body->'calendarRules','[]'))>100 OR jsonb_typeof(coalesce(p_body->'financialRules','[]'))<>'array' OR jsonb_array_length(coalesce(p_body->'financialRules','[]'))>100 THEN RAISE EXCEPTION 'Invalid rule set';END IF;
  FOR rule IN SELECT * FROM jsonb_array_elements(coalesce(p_body->'financialRules','[]')) LOOP
   IF rule-ARRAY['bindingId','rubrics','sourceReference']<>'{}'::jsonb OR jsonb_typeof(rule->'rubrics')<>'array' OR length(coalesce(rule->>'sourceReference','')) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Allocation evidence required';END IF;
   PERFORM public.assert_ccee_data_binding(p_org,(rule->>'bindingId')::uuid,date_trunc('month',now())::date,'DRI_READ');
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(rule->'rubrics') x WHERE x NOT IN('MCP','EER','ASSOCIATIVE','PENALTY')) THEN RAISE EXCEPTION 'Unsupported financial rubric';END IF;
  END LOOP;
  FOR rule IN SELECT * FROM jsonb_array_elements(coalesce(p_body->'calendarRules','[]')) LOOP
   IF rule-ARRAY['bindingId','codes','responsibleId','sourceReference']<>'{}'::jsonb OR jsonb_typeof(rule->'codes')<>'array' OR jsonb_array_length(rule->'codes')>100 OR length(coalesce(rule->>'sourceReference','')) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Calendar applicability evidence required';END IF;
   PERFORM public.assert_ccee_data_binding(p_org,(rule->>'bindingId')::uuid,date_trunc('month',now())::date,'AGENDA');
   IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org AND user_id::text=rule->>'responsibleId' AND upper(status)='ACTIVE') THEN RAISE EXCEPTION 'Calendar responsible unavailable';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(rule->'codes') code WHERE NOT EXISTS(SELECT 1 FROM public.ccee_calendar_items i JOIN public.ccee_calendar_versions cal ON cal.id=i.version_id WHERE cal.reviewed_at IS NOT NULL AND i.code=code)) THEN RAISE EXCEPTION 'Reviewed calendar code required';END IF;
  END LOOP;
  INSERT INTO public.eva_operational_policies(organization_id,enabled,actor_id,reason,discover_bindings,prepare_sources,calendar_rules,financial_rules) VALUES(p_org,(p_body->>'enabled')::boolean,p_actor,p_body->>'reason',coalesce((p_body->>'discoverBindings')::boolean,true),coalesce((p_body->>'prepareSources')::boolean,true),coalesce(p_body->'calendarRules','[]'),coalesce(p_body->'financialRules','[]'))
  ON CONFLICT(organization_id) DO UPDATE SET enabled=excluded.enabled,actor_id=excluded.actor_id,reason=excluded.reason,discover_bindings=excluded.discover_bindings,prepare_sources=excluded.prepare_sources,calendar_rules=excluded.calendar_rules,financial_rules=excluded.financial_rules,revision=eva_operational_policies.revision+1,updated_at=now() RETURNING * INTO p;
  FOR u IN SELECT * FROM public.consumer_units WHERE organization_id=p_org AND status='ACTIVE' LOOP PERFORM public.eva_flow_wake(p_org,u.customer_id,u.id,to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM'),'UNIT_SYNC');
   PERFORM public.eva_flow_wake(p_org,u.customer_id,u.id,to_char(d.reference_month,'YYYY-MM'),'CLOSING') FROM public.documents d WHERE d.organization_id=p_org AND d.consumer_unit_id=u.id AND d.document_type='INVOICE_DISTRIBUTOR' AND d.file_verified AND d.reference_month>=date_trunc('month',now())-interval '12 months' AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions cv WHERE cv.organization_id=p_org AND cv.customer_id=u.customer_id AND cv.month=to_char(d.reference_month,'YYYY-MM') AND cv.report->'unitIds'?u.id AND cv.version=(SELECT max(n.version) FROM public.eva_assisted_closing_versions n WHERE n.organization_id=p_org AND n.customer_id=u.customer_id AND n.month=cv.month AND n.report->'unitIds'?u.id) AND (SELECT e.state FROM public.eva_assisted_closing_events e WHERE e.closing_id=cv.id ORDER BY e.sequence DESC LIMIT 1)='APPROVED' AND EXISTS(SELECT 1 FROM jsonb_array_elements(cv.report->'units') x WHERE x->>'id'=u.id AND x->>'documentId'=d.id AND x->>'sourceHash'=d.file_hash));END LOOP;
  reply:=to_jsonb(p);INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details) VALUES(p_org,p_actor,'EVA_OPERATIONAL_POLICY',req,jsonb_build_object('command',md5(p_body::text),'result',reply-'calendar_rules'-'financial_rules'));RETURN reply;
 END IF;
 IF p_unit IS NULL OR p_month IS NULL OR p_month!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' OR NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE id=p_unit AND organization_id=p_org) THEN RAISE EXCEPTION 'Unit scope required' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.eva_operational_reviews WHERE organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month FOR UPDATE;
 IF p_action='status' THEN RETURN jsonb_build_object('organizationId',p_org,'enabled',coalesce(p.enabled,false),'review',to_jsonb(r),'canPrepare',rights->'canPrepare','canManage',rights->'canManage');END IF;
 IF p.enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'Operational flow disabled' USING ERRCODE='42501';END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request required';END IF;
 SELECT * INTO existing FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=req;
 IF FOUND THEN IF existing.actor_id<>p_actor OR existing.details->'command' IS DISTINCT FROM jsonb_build_object('action',p_action,'unit',p_unit,'month',p_month,'body',p_body) THEN RAISE EXCEPTION 'Changed request' USING ERRCODE='40001';END IF;RETURN existing.details->'result';END IF;
 IF p_action='ack_costs' THEN
  IF p_body-ARRAY['requestId','costId','revision','confirmed','reason']<>'{}'::jsonb OR p_body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR length(coalesce(p_body->>'reason','')) NOT BETWEEN 20 AND 2000 THEN RAISE EXCEPTION 'Explicit cost coverage required';END IF;
  SELECT * INTO c FROM public.calculation_monthly_costs WHERE organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month AND id=(p_body->>'costId')::uuid AND revision=(p_body->>'revision')::integer;
  IF NOT FOUND OR NOT (c.costs->'noCosts'='true'::jsonb OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.costs->'items') i WHERE i->>'category'='CCEE' AND i->>'scenario'='ACL')) THEN RAISE EXCEPTION 'Cost revision changed' USING ERRCODE='40001';END IF;
  INSERT INTO public.eva_operational_reviews(organization_id,customer_id,consumer_unit_id,month,cost_ack) VALUES(p_org,c.customer_id,p_unit,p_month,jsonb_build_object('costId',c.id,'revision',c.revision,'costHash',encode(sha256(convert_to(jsonb_build_object('costs',c.costs,'source',c.source_reference,'notes',c.notes)::text,'UTF8')),'hex'),'actor',p_actor,'reason',p_body->>'reason','at',now()))
  ON CONFLICT(organization_id,consumer_unit_id,month) DO UPDATE SET cost_ack=excluded.cost_ack,revision=eva_operational_reviews.revision+1,updated_at=now() RETURNING * INTO r;
  PERFORM public.eva_flow_wake(p_org,c.customer_id,p_unit,p_month,'CLOSING');
 ELSE
  SELECT * INTO v FROM public.eva_assisted_closing_versions WHERE id=r.closing_id AND organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month;
  IF v.id IS NULL OR r.closing_id IS DISTINCT FROM (p_body->>'closingId')::uuid OR r.closing_hash IS DISTINCT FROM p_body->>'hash' OR v.payload_hash IS DISTINCT FROM r.closing_hash OR EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions n WHERE n.organization_id=p_org AND n.customer_id=v.customer_id AND n.month=p_month AND n.version>v.version AND n.report#>>'{scope,kind}'='UNIT' AND n.report->'unitIds' ? p_unit) THEN RAISE EXCEPTION 'Review sources changed' USING ERRCODE='40001';END IF;
  IF p_body-ARRAY['requestId','closingId','hash','reason','confirmed']<>'{}'::jsonb OR p_body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR length(coalesce(p_body->>'reason','')) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Review confirmation required';END IF;
  IF p_action='submit' THEN
   IF v.report->'approvalEligible' IS DISTINCT FROM 'true'::jsonb OR r.state NOT IN('READY_OPERATOR','RETURNED') OR (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)<>'READY_FOR_REVIEW' THEN RAISE EXCEPTION 'Complete the two evidence groups before submission' USING ERRCODE='22023';END IF;
   UPDATE public.eva_operational_reviews SET state='SUBMITTED',submitted_by=p_actor,submitted_at=now(),revision=revision+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  ELSE
   IF rights->'canManage' IS DISTINCT FROM 'true'::jsonb OR r.state<>'SUBMITTED' THEN RAISE EXCEPTION 'Manager review required' USING ERRCODE='42501';END IF;
   UPDATE public.eva_operational_reviews SET state='RETURNED',returned_by=p_actor,return_reason=p_body->>'reason',revision=revision+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  END IF;
 END IF;
 reply:=to_jsonb(r);INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details) VALUES(p_org,p_actor,'EVA_OPERATIONAL_'||upper(p_action),req,jsonb_build_object('command',jsonb_build_object('action',p_action,'unit',p_unit,'month',p_month,'body',p_body),'result',reply));RETURN reply;
END$$;
REVOKE ALL ON FUNCTION public.eva_flow_action(text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_flow_action(text,text,text,text,text,jsonb) TO service_role;
CREATE FUNCTION public.eva_flow_notifications(p_org text,p_actor text,p_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rights jsonb;rows jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles rr ON rr.organization_id=m.organization_id AND rr.id=m.role_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND rr.name IN('admin_org','gestor','operacional')) THEN
  IF p_key IS NOT NULL THEN RAISE EXCEPTION 'Notification unavailable' USING ERRCODE='42501';END IF;RETURN jsonb_build_object('rows','[]'::jsonb);
 END IF;
 rights:=public.eva_flow_actor(p_org,p_actor,false);
 SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') INTO rows FROM(
  SELECT 'eva-flow:'||q.id||':'||q.revision AS key,q.id,q.state AS status,q.updated_at AS date,'HIGH' AS priority,'eva-flow' AS origin,false AS overdue,NULL::timestamptz AS "dueAt",
   CASE WHEN q.state='SUBMITTED' THEN 'EVA · proposta aguardando aprovação do gestor' WHEN q.state='READY_OPERATOR' THEN 'EVA · proposta pronta para conferir e enviar ao gestor' WHEN q.state='RETURNED' THEN 'EVA · proposta devolvida pelo gestor' ELSE 'EVA · conferir informações complementares' END||' · '||u.name||' · '||q.month AS title,
   '/backoffice/contracts?ocrDocument='||coalesce(v.report#>>'{units,0,documentId}','')||'&area=preparation' AS href
  FROM public.eva_operational_reviews q JOIN public.consumer_units u ON u.id=q.consumer_unit_id AND u.organization_id=q.organization_id JOIN public.eva_assisted_closing_versions v ON v.id=q.closing_id AND v.organization_id=q.organization_id
  WHERE q.organization_id=p_org AND ((q.state='SUBMITTED' AND rights->'canManage'='true'::jsonb) OR (q.state IN('READY_OPERATOR','REQUIRES_INPUT','RETURNED') AND rights->'canPrepare'='true'::jsonb)) ORDER BY q.updated_at DESC LIMIT 100
 )n;
 IF p_key IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) x WHERE x->>'key'=p_key) THEN RAISE EXCEPTION 'Notification unavailable' USING ERRCODE='42501';END IF;
  INSERT INTO public.operation_notification_reads(organization_id,user_id,notification_key) VALUES(p_org,p_actor,p_key) ON CONFLICT DO NOTHING;
 END IF;
 RETURN jsonb_build_object('rows',rows);
END$$;
REVOKE ALL ON FUNCTION public.eva_flow_notifications(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_flow_notifications(text,text,text) TO service_role;
CREATE FUNCTION public.eva_flow_worker(p_action text,p_id uuid DEFAULT NULL,p_lease uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='30s' AS $$
DECLARE r public.eva_operational_runs;p public.eva_operational_policies;rights jsonb;delegate record;d public.documents;receipt public.eva_assisted_closing_versions;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('claim','context','begin_write','finish') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>60000 THEN RAISE EXCEPTION 'Invalid flow worker command';END IF;
 IF p_action='claim' THEN
  -- An expired uncertain write is never repeated. Read-only work can be retried.
  UPDATE public.eva_operational_runs SET state=CASE WHEN write_started THEN 'UNKNOWN' ELSE 'QUEUED' END,lease_id=NULL,lease_until=NULL,last_error=CASE WHEN write_started THEN 'WRITE_ACKNOWLEDGEMENT_PENDING' ELSE 'READ_INTERRUPTED' END WHERE organization_id='org_default' AND state='RUNNING' AND lease_until<now();
  SELECT q.* INTO r FROM public.eva_operational_runs q JOIN public.eva_operational_policies a ON a.organization_id=q.organization_id AND a.enabled WHERE q.organization_id='org_default' AND q.state IN('QUEUED','WAITING') AND q.next_run_at<=now() ORDER BY CASE WHEN q.kind='CLOSING' THEN 0 ELSE 1 END,q.next_run_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL;END IF;
  SELECT * INTO p FROM public.eva_operational_policies WHERE organization_id=r.organization_id AND enabled;
  BEGIN
   PERFORM public.ccee_permanent_automation_actor(r.organization_id,p.actor_id);
   rights:=public.eva_flow_actor(r.organization_id,p.actor_id,true);
  EXCEPTION WHEN insufficient_privilege THEN
   UPDATE public.eva_operational_runs SET state='PAUSED',last_error='AUTOMATION_ACTOR_REVOKED',updated_at=now() WHERE id=r.id;RETURN NULL;
  END;
  UPDATE public.eva_operational_runs SET state='RUNNING',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',claimed_generation=generation,attempts=attempts+1,write_started=false,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('run',to_jsonb(r));
 END IF;
 SELECT * INTO r FROM public.eva_operational_runs WHERE id=p_id AND lease_id=p_lease AND lease_until>now() AND state='RUNNING' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Flow lease unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO p FROM public.eva_operational_policies WHERE organization_id=r.organization_id AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Flow policy paused' USING ERRCODE='42501';END IF;
 PERFORM public.ccee_permanent_automation_actor(r.organization_id,p.actor_id);
 rights:=public.eva_flow_actor(r.organization_id,p.actor_id,true);
 IF p_action='context' THEN
  SELECT m.user_id::text id,rr.id::text role_id,rr.name,(SELECT coalesce(jsonb_agg(x),'[]') FROM jsonb_array_elements(rr.permissions) x WHERE m.permission_limit IS NULL OR m.permission_limit @> jsonb_build_array(x)) permissions INTO delegate FROM public.organization_members m JOIN public.roles rr ON rr.organization_id=m.organization_id AND rr.id=m.role_id WHERE m.organization_id=r.organization_id AND m.user_id::text=p.actor_id AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL;
  SELECT doc.* INTO d FROM public.documents doc WHERE doc.organization_id=r.organization_id AND doc.customer_id=r.customer_id AND doc.consumer_unit_id=r.consumer_unit_id AND to_char(doc.reference_month,'YYYY-MM')=r.month AND doc.document_type='INVOICE_DISTRIBUTOR' AND doc.file_verified AND NOT EXISTS(SELECT 1 FROM public.documents n WHERE n.organization_id=doc.organization_id AND n.catalog_previous_id=doc.id AND n.file_verified) ORDER BY doc.created_at DESC,doc.id LIMIT 1;
  -- Ambiguous originals require source selection, rather than silently choosing a bill.
  IF (SELECT count(*) FROM public.documents doc WHERE doc.organization_id=r.organization_id AND doc.customer_id=r.customer_id AND doc.consumer_unit_id=r.consumer_unit_id AND to_char(doc.reference_month,'YYYY-MM')=r.month AND doc.document_type='INVOICE_DISTRIBUTOR' AND doc.file_verified AND NOT EXISTS(SELECT 1 FROM public.documents n WHERE n.organization_id=doc.organization_id AND n.catalog_previous_id=doc.id AND n.file_verified))<>1 THEN d:=NULL;END IF;
  RETURN jsonb_build_object('run',to_jsonb(r),'policy',to_jsonb(p),'intakeActive',EXISTS(SELECT 1 FROM public.eva_automatic_intakes x WHERE x.organization_id=r.organization_id AND x.unit_id=r.consumer_unit_id AND x.month=r.month AND x.lease_until>now() AND x.state='PREPARING'),'unit',(SELECT to_jsonb(u) FROM public.consumer_units u WHERE u.organization_id=r.organization_id AND u.id=r.consumer_unit_id AND u.customer_id=r.customer_id),'binding',(SELECT to_jsonb(b) FROM public.ccee_unit_authorizations b WHERE b.organization_id=r.organization_id AND b.customer_id=r.customer_id AND b.consumer_unit_id=r.consumer_unit_id ORDER BY b.revision DESC LIMIT 1),'discovery',(SELECT jsonb_build_object('id',x.id,'state',x.state,'reason',x.reason,'result',x.result,'taxId',x.tax_id) FROM public.ccee_customer_discovery x WHERE x.organization_id=r.organization_id AND x.customer_id=r.customer_id AND x.state<>'SUPERSEDED' ORDER BY x.created_at DESC,x.id DESC LIMIT 1),'calendarItems',(SELECT coalesce(jsonb_agg(jsonb_build_object('versionId',v.id,'id',i.id,'code',i.code,'month',to_char(i.month,'YYYY-MM'),'dueDate',i.due_date,'dueAt',i.due_at,'precision',i.deadline_precision) ORDER BY i.code),'[]') FROM public.ccee_calendar_items i JOIN public.ccee_calendar_versions v ON v.id=i.version_id WHERE v.state='APPROVED' AND v.reviewed_at IS NOT NULL AND v.year=extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer AND NOT EXISTS(SELECT 1 FROM public.ccee_calendar_versions n WHERE n.source_url=v.source_url AND n.state='APPROVED' AND n.created_at>v.created_at) AND (i.due_at>now() OR i.deadline_precision='DATE' AND i.due_date>=(now() AT TIME ZONE 'America/Sao_Paulo')::date) AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.calendar_rules) q WHERE q->>'bindingId'=(SELECT b.id::text FROM public.ccee_unit_authorizations b WHERE b.organization_id=r.organization_id AND b.customer_id=r.customer_id AND b.consumer_unit_id=r.consumer_unit_id ORDER BY b.revision DESC LIMIT 1) AND q->'codes'?i.code)),'document',CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('id',d.id,'fileHash',d.file_hash,'ocrReady',EXISTS(SELECT 1 FROM public.document_ocr_jobs j WHERE j.organization_id=r.organization_id AND j.document_id=d.id AND j.file_hash=d.file_hash AND j.state='SUCCEEDED')) END,'delegate',jsonb_build_object('userId',delegate.id,'roleId',delegate.role_id,'role',delegate.name,'permissions',delegate.permissions));
 ELSIF p_action='begin_write' THEN
  IF r.write_started THEN RAISE EXCEPTION 'Write already started' USING ERRCODE='40001';END IF;
  UPDATE public.eva_operational_runs SET write_started=true,updated_at=now() WHERE id=r.id;RETURN jsonb_build_object('accepted',true);
 END IF;
 IF p_body-ARRAY['state','result','error']<>'{}'::jsonb OR coalesce(p_body->>'state','') NOT IN('SUCCEEDED','WAITING','UNKNOWN','PAUSED') OR jsonb_typeof(p_body->'result') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid worker result';END IF;
 IF p_body->>'state'='SUCCEEDED' AND r.kind='CLOSING' THEN
  SELECT * INTO receipt FROM public.eva_assisted_closing_versions WHERE id=(p_body#>>'{result,closingId}')::uuid AND organization_id=r.organization_id AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id AND month=r.month AND report#>>'{scope,kind}'='UNIT';
  IF NOT FOUND OR coalesce((SELECT e.state FROM public.eva_assisted_closing_events e WHERE e.closing_id=receipt.id ORDER BY e.sequence DESC LIMIT 1),'') NOT IN('READY_FOR_REVIEW','INCOMPLETE','APPROVED') THEN RAISE EXCEPTION 'Closing receipt unconfirmed' USING ERRCODE='40001';END IF;
  INSERT INTO public.eva_operational_reviews(organization_id,customer_id,consumer_unit_id,month,closing_id,closing_hash,state) VALUES(r.organization_id,r.customer_id,r.consumer_unit_id,r.month,receipt.id,receipt.payload_hash,CASE WHEN (SELECT e.state FROM public.eva_assisted_closing_events e WHERE e.closing_id=receipt.id ORDER BY e.sequence DESC LIMIT 1)='APPROVED' THEN 'APPROVED' WHEN receipt.report->'approvalEligible'='true'::jsonb THEN 'READY_OPERATOR' ELSE 'REQUIRES_INPUT' END)
  ON CONFLICT(organization_id,consumer_unit_id,month) DO UPDATE SET closing_id=excluded.closing_id,closing_hash=excluded.closing_hash,state=excluded.state,revision=eva_operational_reviews.revision+1,updated_at=now() WHERE eva_operational_reviews.closing_id IS DISTINCT FROM excluded.closing_id;
 END IF;
 UPDATE public.eva_operational_runs SET state=CASE WHEN generation>claimed_generation AND p_body->>'state'<>'UNKNOWN' THEN 'QUEUED' ELSE p_body->>'state' END,lease_id=NULL,lease_until=NULL,result=p_body->'result',last_error=left(p_body->>'error',100),next_run_at=CASE WHEN generation>claimed_generation THEN now() ELSE now()+interval '1 hour' END,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 RETURN to_jsonb(r);
END$$;
REVOKE ALL ON FUNCTION public.eva_flow_worker(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_flow_worker(text,uuid,uuid,jsonb) TO service_role;
CREATE FUNCTION public.eva_flow_ccee_signature(p_org text,p_customer text,p_month text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.unit_id,x.kind,x.source_hash)::text,'[]'),'UTF8')),'hex') FROM(
  SELECT DISTINCT b.consumer_unit_id unit_id,j.kind,coalesce(j.result#>>'{data,sourceHash}',j.result#>>'{record,evidence,sourceHash}') source_hash
  FROM public.ccee_integration_jobs j JOIN public.ccee_unit_authorizations b ON b.id=j.authorization_id AND b.organization_id=j.organization_id
  WHERE j.organization_id=p_org AND b.customer_id=p_customer AND to_char(j.month,'YYYY-MM')=p_month AND j.state='SUCCEEDED' AND j.kind IN('MEASUREMENTS','DRI_RESULTS') AND j.result->'complete'='true'::jsonb AND b.status='APPROVED'
   AND NOT EXISTS(SELECT 1 FROM public.ccee_unit_authorizations n WHERE n.organization_id=b.organization_id AND n.consumer_unit_id=b.consumer_unit_id AND n.revision>b.revision)
   AND coalesce(j.result#>>'{data,sourceHash}',j.result#>>'{record,evidence,sourceHash}') IS NOT NULL
 )x
$$;
REVOKE ALL ON FUNCTION public.eva_flow_ccee_signature(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.eva_flow_source_capture(p_org text,p_customer text,p_month text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.eva_operational_policies WHERE organization_id=p_org AND enabled) THEN jsonb_build_object('enabled',true,'cceeSourcesHash',public.eva_flow_ccee_signature(p_org,p_customer,p_month),'costRows',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'unitId',x.consumer_unit_id,'costHash',x.cost_hash) ORDER BY x.consumer_unit_id),'[]') FROM(SELECT DISTINCT ON(cc.consumer_unit_id) cc.id,cc.consumer_unit_id,encode(sha256(convert_to(jsonb_build_object('costs',cc.costs,'source',cc.source_reference,'notes',cc.notes)::text,'UTF8')),'hex') cost_hash FROM public.calculation_monthly_costs cc WHERE cc.organization_id=p_org AND cc.customer_id=p_customer AND cc.month=p_month ORDER BY cc.consumer_unit_id,cc.version DESC)x),'costAcks',(SELECT coalesce(jsonb_agg(jsonb_build_object('unitId',r.consumer_unit_id,'ack',r.cost_ack) ORDER BY r.consumer_unit_id),'[]') FROM public.eva_operational_reviews r WHERE r.organization_id=p_org AND r.customer_id=p_customer AND r.month=p_month AND r.cost_ack<>'{}'::jsonb)) ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.eva_flow_source_capture(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
DO $capture$
DECLARE fn record;definition text;changed integer:=0;
BEGIN
 FOR fn IN SELECT f.oid FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname IN('public','portal_scope') AND f.proname='capture_eva_assisted_closing_sources' LOOP
  definition:=pg_get_functiondef(fn.oid);IF strpos(definition,'RETURN base;')=0 THEN CONTINUE;END IF;
  definition:=replace(definition,'RETURN base;',$body$IF current_setting('energyos.eva_closing_scope',true)='UNIT' AND public.eva_flow_source_capture(p_org,p_customer,p_month) IS NOT NULL THEN base:=base||jsonb_build_object('operationalFlow',public.eva_flow_source_capture(p_org,p_customer,p_month));END IF;RETURN base;$body$);EXECUTE definition;changed:=changed+1;
 END LOOP;
 IF changed<>1 THEN RAISE EXCEPTION 'Operational capture baseline changed';END IF;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid) WHERE original_oid IN(SELECT oid FROM pg_proc WHERE proname='capture_eva_assisted_closing_sources');END IF;
END $capture$;
NOTIFY pgrst,'reload schema';
COMMIT;
