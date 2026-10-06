BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.report_policies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 version integer NOT NULL DEFAULT 1,state text NOT NULL DEFAULT 'PAUSED' CHECK(state IN ('PAUSED','ACTIVE','BLOCKED')),
 config jsonb NOT NULL,contacts jsonb NOT NULL,owner_id text NOT NULL,next_run timestamptz,reason text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_policy_due ON public.report_policies(next_run) WHERE state='ACTIVE';
CREATE TABLE public.report_policy_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,policy_id uuid NOT NULL REFERENCES public.report_policies(id),
 actor_id text NOT NULL,request_id uuid,command jsonb NOT NULL,before_value jsonb,after_value jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_id)
);
CREATE TABLE public.report_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,policy_id uuid NOT NULL REFERENCES public.report_policies(id),
 policy_version integer NOT NULL,slot timestamptz NOT NULL,month date NOT NULL,config jsonb NOT NULL,contacts jsonb NOT NULL,owner_id text NOT NULL,
 requests jsonb NOT NULL,state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','PREPARING','WAITING_PUBLICATION','READY','BLOCKED','CANCELLED')),
 lease_id uuid,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,retry_after timestamptz NOT NULL DEFAULT now(),
 report_ids jsonb NOT NULL DEFAULT '[]',reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(policy_id,slot)
);
CREATE TABLE public.report_job_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,job_id uuid NOT NULL REFERENCES public.report_jobs(id),
 state text NOT NULL,reason text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_jobs_ready ON public.report_jobs(retry_after,created_at) WHERE state IN ('QUEUED','WAITING_PUBLICATION','PREPARING');
ALTER TABLE public.report_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_policy_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_job_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_policies,public.report_policy_history,public.report_jobs,public.report_job_events FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER report_policy_history_immutable BEFORE UPDATE OR DELETE ON public.report_policy_history FOR EACH ROW EXECUTE FUNCTION public.reject_report_change();
CREATE TRIGGER report_job_events_immutable BEFORE UPDATE OR DELETE ON public.report_job_events FOR EACH ROW EXECUTE FUNCTION public.reject_report_change();
CREATE FUNCTION public.audit_report_job_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN INSERT INTO public.report_job_events(organization_id,job_id,state,reason) VALUES(NEW.organization_id,NEW.id,NEW.state,NEW.reason);END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_job_state_audit AFTER INSERT OR UPDATE OF state ON public.report_jobs FOR EACH ROW EXECUTE FUNCTION public.audit_report_job_state();
REVOKE ALL ON FUNCTION public.audit_report_job_state() FROM PUBLIC,anon,authenticated,service_role;


CREATE FUNCTION public.assert_report_configuration_actor(p_org text,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,true);
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN
  RETURN jsonb_build_object('organizationId',p_org,'userId',p_actor,'role','admin_org','roleId','platform-operation','email','','accessMode','platform_operation','permissions',jsonb_build_array('3ebadd32-6f30-459e-8ed3-0d2843d89946','9541a7bb-c20a-4c4d-9f4c-2185262c8e9c','60f9690a-145b-4dba-b23f-9f945baca296','51da7cca-8196-4135-84ce-f989be5ee594'));
 END IF;
 SELECT jsonb_build_object('organizationId',p_org,'userId',p_actor,'role',r.name,'roleId',r.id,'email','','permissions',r.permissions) INTO result
 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND r.permissions ? '51da7cca-8196-4135-84ce-f989be5ee594';
 IF result IS NULL THEN RAISE EXCEPTION 'Notification configuration denied' USING ERRCODE='42501';END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.validate_report_policy(p_config jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE k text;v jsonb;expected integer;
BEGIN
 IF p_config IS NULL OR jsonb_typeof(p_config)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_config))<>11 OR NOT p_config ?& ARRAY['name','customerId','unitId','frequency','days','hour','monthlyLimit','kinds','formats','channels','contactIds']
 OR jsonb_typeof(p_config->'name') IS DISTINCT FROM 'string' OR length(trim(COALESCE(p_config->>'name',''))) NOT BETWEEN 1 AND 100 OR p_config->>'name' ~ '[[:cntrl:]]'
 OR COALESCE(p_config->>'frequency','') NOT IN ('MONTHLY','FORTNIGHTLY') OR COALESCE(p_config->>'hour','') !~ '^([0-9]|1[0-9]|2[0-3])$' OR COALESCE(p_config->>'monthlyLimit','') !~ '^[12]$'
 OR jsonb_typeof(p_config->'hour') IS DISTINCT FROM 'number' OR jsonb_typeof(p_config->'monthlyLimit') IS DISTINCT FROM 'number'
 OR COALESCE(p_config->>'customerId','') !~ '^[0-9a-f-]{36}$' OR COALESCE(p_config->>'unitId','') !~ '^[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'Invalid configuration' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['days','kinds','formats','channels','contactIds'] LOOP
  IF jsonb_typeof(p_config->k) IS DISTINCT FROM 'array' OR jsonb_array_length(p_config->k)<1 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_config->k))<>jsonb_array_length(p_config->k) THEN RAISE EXCEPTION 'Invalid choices' USING ERRCODE='22023';END IF;
 END LOOP;
 expected:=CASE WHEN p_config->>'frequency'='MONTHLY' THEN 1 ELSE 2 END;
 IF jsonb_array_length(p_config->'days')<>expected OR (p_config->>'monthlyLimit')::int>expected OR jsonb_array_length(p_config->'contactIds')>10 THEN RAISE EXCEPTION 'Invalid frequency' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p_config->'days') LOOP IF jsonb_typeof(v)<>'number' OR v::text !~ '^([1-9]|[12][0-9]|3[01])$' THEN RAISE EXCEPTION 'Invalid day' USING ERRCODE='22023';END IF;END LOOP;
 FOR v IN SELECT value FROM jsonb_array_elements(p_config->'kinds') LOOP IF v NOT IN ('"OPERATIONAL"'::jsonb,'"EXECUTIVE"'::jsonb) THEN RAISE EXCEPTION 'Invalid kind' USING ERRCODE='22023';END IF;END LOOP;
 FOR v IN SELECT value FROM jsonb_array_elements(p_config->'formats') LOOP IF v NOT IN ('"pdf"'::jsonb,'"excel"'::jsonb) THEN RAISE EXCEPTION 'Invalid format' USING ERRCODE='22023';END IF;END LOOP;
 FOR v IN SELECT value FROM jsonb_array_elements(p_config->'channels') LOOP IF v NOT IN ('"email"'::jsonb,'"whatsapp"'::jsonb,'"sms"'::jsonb) THEN RAISE EXCEPTION 'Invalid channel' USING ERRCODE='22023';END IF;END LOOP;
 IF p_config->'channels' ? 'sms' AND NOT p_config->'channels' ? 'email' THEN RAISE EXCEPTION 'SMS requires email' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p_config->'contactIds') LOOP IF jsonb_typeof(v)<>'string' OR trim(v::text,'"') !~ '^[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'Invalid contact ID' USING ERRCODE='22023';END IF;END LOOP;
END $$;

CREATE FUNCTION public.report_policy_contacts(p_org text,p_config jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.customers;result jsonb;item jsonb;channel text;
BEGIN
 PERFORM public.validate_report_policy(p_config);
 SELECT * INTO c FROM public.customers WHERE organization_id=p_org AND id=p_config->>'customerId' AND deleted_at IS NULL AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE organization_id=p_org AND customer_id=c.id AND id=p_config->>'unitId' AND status='ACTIVE') THEN RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='P3862';END IF;
 SELECT COALESCE(jsonb_agg(value ORDER BY value->>'id'),'[]'::jsonb) INTO result FROM jsonb_array_elements(c.report_contacts) WHERE p_config->'contactIds' ? (value->>'id');
 IF jsonb_array_length(result)<>jsonb_array_length(p_config->'contactIds') THEN RAISE EXCEPTION 'Contact unavailable' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(result) LOOP
  IF item->'active' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Contact inactive' USING ERRCODE='22023';END IF;
  FOR channel IN SELECT jsonb_array_elements_text(p_config->'channels') LOOP
   IF NOT COALESCE(item->'channels' ? channel,false) OR (channel='email' AND COALESCE(item->>'email','')='') OR (channel IN ('sms','whatsapp') AND COALESCE(item->>'phone','') !~ '^\+[1-9][0-9]{7,14}$') THEN RAISE EXCEPTION 'Contact channel denied' USING ERRCODE='22023';END IF;
  END LOOP;
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION public.next_report_slot(p_config jsonb,p_after timestamptz) RETURNS timestamptz LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE m date;last_day integer;d integer;candidate timestamptz;result timestamptz;
BEGIN
 PERFORM public.validate_report_policy(p_config);
 FOR offset_month IN 0..13 LOOP
  m:=(date_trunc('month',p_after AT TIME ZONE 'America/Sao_Paulo')+make_interval(months=>offset_month))::date;
  last_day:=extract(day FROM m+interval '1 month'-interval '1 day');
  FOR d IN SELECT jsonb_array_elements_text(p_config->'days')::integer LOOP
   candidate:=(m+(least(d,last_day)-1)+make_interval(hours=>(p_config->>'hour')::int)) AT TIME ZONE 'America/Sao_Paulo';
   IF candidate>p_after AND (result IS NULL OR candidate<result) THEN result:=candidate;END IF;
  END LOOP;
  IF result IS NOT NULL THEN RETURN result;END IF;
 END LOOP;
 RAISE EXCEPTION 'Calendar unavailable' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.save_report_policy(p_org text,p_actor text,p_id uuid,p_version integer,p_request uuid,p_config jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.report_policies;before_row jsonb;captured_contacts jsonb;prior public.report_policy_history;command jsonb;
BEGIN
 PERFORM public.assert_report_configuration_actor(p_org,p_actor);PERFORM pg_advisory_xact_lock(hashtextextended('report-config:'||p_org,0));captured_contacts:=public.report_policy_contacts(p_org,p_config);
 command:=jsonb_build_object('action','SAVE','id',p_id,'version',p_version,'config',p_config);
 SELECT * INTO prior FROM public.report_policy_history WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF prior.actor_id<>p_actor OR prior.command<>command THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;RETURN prior.after_value;END IF;
 IF p_request IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
 IF p_id IS NULL THEN
  IF p_version IS NOT NULL OR (SELECT count(*) FROM public.report_policies WHERE organization_id=p_org)>=100 THEN RAISE EXCEPTION 'Policy limit' USING ERRCODE='22023';END IF;
  INSERT INTO public.report_policies(organization_id,customer_id,consumer_unit_id,config,contacts,owner_id) VALUES(p_org,p_config->>'customerId',p_config->>'unitId',p_config,captured_contacts,p_actor) RETURNING * INTO r;
 ELSE
  SELECT * INTO r FROM public.report_policies WHERE organization_id=p_org AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Policy unavailable' USING ERRCODE='P3862';END IF;
  IF p_version IS DISTINCT FROM r.version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='40001';END IF;
  before_row:=to_jsonb(r);
  UPDATE public.report_policies SET customer_id=p_config->>'customerId',consumer_unit_id=p_config->>'unitId',config=p_config,contacts=captured_contacts,owner_id=p_actor,version=version+1,state='PAUSED',reason=NULL,next_run=NULL,updated_at=now() WHERE id=p_id RETURNING * INTO r;
  UPDATE public.report_jobs SET state='CANCELLED',reason='POLICY_CHANGED',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE policy_id=p_id AND state IN ('QUEUED','PREPARING','WAITING_PUBLICATION','READY');
 END IF;
 INSERT INTO public.report_policy_history(organization_id,policy_id,actor_id,request_id,command,before_value,after_value) VALUES(p_org,r.id,p_actor,p_request,command,before_row,to_jsonb(r));
 RETURN to_jsonb(r);
END $$;

CREATE FUNCTION public.set_report_policy_state(p_org text,p_actor text,p_id uuid,p_version integer,p_request uuid,p_enabled boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.report_policies;before_row jsonb;current_contacts jsonb;prior public.report_policy_history;command jsonb;
BEGIN
 PERFORM public.assert_report_configuration_actor(p_org,p_actor);PERFORM pg_advisory_xact_lock(hashtextextended('report-config:'||p_org,0));command:=jsonb_build_object('action','STATE','id',p_id,'version',p_version,'enabled',p_enabled);
 SELECT * INTO prior FROM public.report_policy_history WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF prior.actor_id<>p_actor OR prior.command<>command THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;RETURN prior.after_value;END IF;
 SELECT * INTO r FROM public.report_policies WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Policy unavailable' USING ERRCODE='P3862';END IF;
 IF p_version IS DISTINCT FROM r.version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='40001';END IF;
 IF p_request IS NULL OR p_enabled IS NULL THEN RAISE EXCEPTION 'Invalid state request' USING ERRCODE='22023';END IF;
 IF p_enabled THEN current_contacts:=public.report_policy_contacts(p_org,r.config);IF current_contacts<>r.contacts THEN RAISE EXCEPTION 'Destination changed; save reviewed configuration' USING ERRCODE='40001';END IF;END IF;
 before_row:=to_jsonb(r);
 UPDATE public.report_policies SET version=version+1,state=CASE WHEN p_enabled THEN 'ACTIVE' ELSE 'PAUSED' END,owner_id=p_actor,next_run=CASE WHEN p_enabled THEN public.next_report_slot(config,now()) ELSE NULL END,reason=NULL,updated_at=now() WHERE id=p_id RETURNING * INTO r;
 UPDATE public.report_jobs SET state='CANCELLED',reason='POLICY_CHANGED',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE policy_id=p_id AND state IN ('QUEUED','PREPARING','WAITING_PUBLICATION','READY');
 INSERT INTO public.report_policy_history(organization_id,policy_id,actor_id,request_id,command,before_value,after_value) VALUES(p_org,r.id,p_actor,p_request,command,before_row,to_jsonb(r));
 RETURN to_jsonb(r);
END $$;

CREATE FUNCTION public.read_report_configuration(p_org text,p_actor text,p_search text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customers jsonb;policies jsonb;jobs jsonb;history jsonb;
BEGIN
 PERFORM public.assert_report_configuration_actor(p_org,p_actor);
 SELECT COALESCE(jsonb_agg(j),'[]'::jsonb) INTO customers FROM (SELECT jsonb_build_object('id',c.id,'name',c.company_name,'contacts',c.report_contacts,'units',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) ORDER BY u.name) FROM public.consumer_units u WHERE u.organization_id=p_org AND u.customer_id=c.id AND u.status='ACTIVE'),'[]'::jsonb)) j FROM public.customers c WHERE c.organization_id=p_org AND c.deleted_at IS NULL AND c.status='ACTIVE' AND position(lower(trim(COALESCE(p_search,''))) IN lower(c.company_name))>0 ORDER BY c.company_name LIMIT 200) q;
 IF p_search IS NULL OR length(p_search)>100 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023';END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC),'[]'::jsonb) INTO policies FROM public.report_policies p WHERE p.organization_id=p_org;
 SELECT COALESCE(jsonb_agg(j ORDER BY j->>'created_at' DESC),'[]'::jsonb) INTO jobs FROM (SELECT jsonb_build_object('id',id,'policy_id',policy_id,'policy_version',policy_version,'slot',slot,'month',to_char(month,'YYYY-MM'),'state',state,'reason',reason,'report_ids',report_ids,'created_at',created_at) j FROM public.report_jobs WHERE organization_id=p_org ORDER BY created_at DESC LIMIT 100) q;
 SELECT COALESCE(jsonb_agg(j ORDER BY j->>'created_at' DESC),'[]'::jsonb) INTO history FROM (SELECT jsonb_build_object('id',id,'policy_id',policy_id,'actor_id',actor_id,'action',command->>'action','version',after_value->'version','created_at',created_at) j FROM public.report_policy_history WHERE organization_id=p_org ORDER BY created_at DESC LIMIT 100) q;
 RETURN jsonb_build_object('customerLimitReached',jsonb_array_length(customers)=200,'customers',customers,'policies',policies,'jobs',jobs,'history',history);
END $$;

CREATE FUNCTION public.claim_report_preparation() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.report_policies;j public.report_jobs;ctx jsonb;current_contacts jsonb;requests jsonb;before_row jsonb;k text;failure text;selected_org text;
BEGIN
 SELECT organization_id INTO selected_org FROM public.report_policies WHERE state='ACTIVE' AND next_run<=now() ORDER BY next_run LIMIT 1;
 IF selected_org IS NULL THEN SELECT organization_id INTO selected_org FROM public.report_jobs WHERE ((state IN ('QUEUED','WAITING_PUBLICATION') AND retry_after<=now()) OR (state='PREPARING' AND lease_until<now())) ORDER BY created_at LIMIT 1;END IF;
 IF selected_org IS NULL THEN RETURN NULL;END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('report-config:'||selected_org,0)) THEN RETURN NULL;END IF;
 SELECT * INTO p FROM public.report_policies WHERE organization_id=selected_org AND state='ACTIVE' AND next_run<=now() ORDER BY next_run FOR UPDATE SKIP LOCKED LIMIT 1;
 IF FOUND THEN
  before_row:=to_jsonb(p);failure:=NULL;
  BEGIN ctx:=public.assert_report_configuration_actor(p.organization_id,p.owner_id);current_contacts:=public.report_policy_contacts(p.organization_id,p.config);IF current_contacts<>p.contacts THEN failure:='CONTACT_CHANGED';END IF;
  EXCEPTION WHEN SQLSTATE '42501' THEN failure:='ACCESS_REVOKED';WHEN SQLSTATE 'P3862' THEN failure:='SCOPE_INACTIVE';WHEN SQLSTATE '22023' THEN failure:='CONTACT_UNAVAILABLE';END;
  IF failure IS NOT NULL THEN
   UPDATE public.report_policies SET state='BLOCKED',reason=failure,next_run=NULL,updated_at=now() WHERE id=p.id RETURNING * INTO p;
   INSERT INTO public.report_policy_history(organization_id,policy_id,actor_id,command,before_value,after_value) VALUES(p.organization_id,p.id,'worker',jsonb_build_object('action','BLOCK', 'reason',failure),before_row,to_jsonb(p));
  ELSE
   IF (SELECT count(*) FROM public.report_jobs WHERE policy_id=p.id AND date_trunc('month',slot AT TIME ZONE 'America/Sao_Paulo')=date_trunc('month',p.next_run AT TIME ZONE 'America/Sao_Paulo'))<(p.config->>'monthlyLimit')::int THEN
    requests:='{}'::jsonb;FOR k IN SELECT jsonb_array_elements_text(p.config->'kinds') LOOP requests:=requests||jsonb_build_object(k,gen_random_uuid());END LOOP;
    INSERT INTO public.report_jobs(organization_id,policy_id,policy_version,slot,month,config,contacts,owner_id,requests)
    VALUES(p.organization_id,p.id,p.version,p.next_run,(date_trunc('month',p.next_run AT TIME ZONE 'America/Sao_Paulo')-interval '1 month')::date,p.config,p.contacts,p.owner_id,requests) ON CONFLICT(policy_id,slot) DO NOTHING;
   END IF;
   UPDATE public.report_policies SET next_run=public.next_report_slot(config,greatest(next_run,now())),updated_at=now() WHERE id=p.id;
  END IF;
 END IF;
 SELECT * INTO j FROM public.report_jobs WHERE organization_id=selected_org AND ((state IN ('QUEUED','WAITING_PUBLICATION') AND retry_after<=now()) OR (state='PREPARING' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 failure:=NULL;
 SELECT * INTO p FROM public.report_policies WHERE id=j.policy_id FOR SHARE;
 IF p.state<>'ACTIVE' OR p.version<>j.policy_version THEN failure:='POLICY_CHANGED';
 ELSE
  BEGIN ctx:=public.assert_report_configuration_actor(j.organization_id,j.owner_id);current_contacts:=public.report_policy_contacts(j.organization_id,j.config);IF current_contacts<>j.contacts THEN failure:='CONTACT_CHANGED';END IF;
  EXCEPTION WHEN SQLSTATE '42501' THEN failure:='ACCESS_REVOKED';WHEN SQLSTATE 'P3862' THEN failure:='SCOPE_INACTIVE';WHEN SQLSTATE '22023' THEN failure:='CONTACT_UNAVAILABLE';END;
 END IF;
 IF j.attempts>=3 THEN failure:='PREPARATION_LIMIT';END IF;
 IF failure IS NOT NULL THEN
  UPDATE public.report_jobs SET state='BLOCKED',reason=failure,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=j.id;
  RETURN NULL;
 END IF;
 UPDATE public.report_jobs SET state='PREPARING',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() WHERE id=j.id RETURNING * INTO j;
 RETURN jsonb_build_object('job',to_jsonb(j),'context',ctx);
END $$;

CREATE FUNCTION public.finish_report_preparation(p_org text,p_job uuid,p_lease uuid,p_reports jsonb,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.report_jobs;p public.report_policies;r jsonb;ctx jsonb;state_name text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('report-config:'||p_org,0));
 SELECT * INTO j FROM public.report_jobs WHERE organization_id=p_org AND id=p_job AND lease_id=p_lease AND state='PREPARING' AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lease changed' USING ERRCODE='40001';END IF;
 SELECT * INTO p FROM public.report_policies WHERE id=j.policy_id FOR SHARE;
 IF p.state<>'ACTIVE' OR p.version<>j.policy_version THEN p_reason:='POLICY_CHANGED';
 ELSE
  BEGIN ctx:=public.assert_report_configuration_actor(p_org,j.owner_id);IF public.report_policy_contacts(p_org,j.config)<>j.contacts THEN p_reason:='CONTACT_CHANGED';END IF;
  EXCEPTION WHEN SQLSTATE '42501' THEN p_reason:='ACCESS_REVOKED';WHEN SQLSTATE 'P3862' THEN p_reason:='SCOPE_INACTIVE';WHEN SQLSTATE '22023' THEN p_reason:='CONTACT_UNAVAILABLE';END;
 END IF;
 IF p_reason IS NULL THEN
  IF jsonb_typeof(p_reports) IS DISTINCT FROM 'array' OR jsonb_array_length(p_reports)<>jsonb_array_length(j.config->'kinds') THEN RAISE EXCEPTION 'Invalid prepared reports' USING ERRCODE='22023';END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_reports) LOOP
   IF NOT EXISTS(SELECT 1 FROM public.published_report_snapshots s WHERE s.organization_id=p_org AND s.id::text=r->>'id' AND s.customer_id=j.config->>'customerId' AND s.consumer_unit_id=j.config->>'unitId' AND s.kind=r->>'kind' AND j.config->'kinds' ? s.kind AND s.request_id::text=j.requests->>s.kind AND s.request->>'from'=to_char(j.month,'YYYY-MM') AND s.request->>'to'=to_char(j.month,'YYYY-MM')) THEN RAISE EXCEPTION 'Report scope changed' USING ERRCODE='40001';END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'kind') FROM jsonb_array_elements(p_reports))<>jsonb_array_length(p_reports) THEN RAISE EXCEPTION 'Duplicate kind' USING ERRCODE='22023';END IF;
  state_name:='READY';
 ELSE
  IF p_reason NOT IN ('WAITING_PUBLICATION','PREPARATION_UNAVAILABLE','POLICY_CHANGED','CONTACT_CHANGED','ACCESS_REVOKED','SCOPE_INACTIVE','CONTACT_UNAVAILABLE') THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023';END IF;
  state_name:=CASE WHEN p_reason='WAITING_PUBLICATION' AND j.attempts<3 THEN 'WAITING_PUBLICATION' ELSE 'BLOCKED' END;
 END IF;
 UPDATE public.report_jobs SET state=state_name,report_ids=CASE WHEN state_name='READY' THEN p_reports ELSE '[]'::jsonb END,reason=p_reason,lease_id=NULL,lease_until=NULL,retry_after=now()+interval '1 day',updated_at=now() WHERE id=p_job;
END $$;

REVOKE ALL ON FUNCTION public.assert_report_configuration_actor(text,text),public.validate_report_policy(jsonb),public.report_policy_contacts(text,jsonb),public.next_report_slot(jsonb,timestamptz),public.save_report_policy(text,text,uuid,integer,uuid,jsonb),public.set_report_policy_state(text,text,uuid,integer,uuid,boolean),public.read_report_configuration(text,text,text),public.claim_report_preparation(),public.finish_report_preparation(text,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_report_policy(text,text,uuid,integer,uuid,jsonb),public.set_report_policy_state(text,text,uuid,integer,uuid,boolean),public.read_report_configuration(text,text,text),public.claim_report_preparation(),public.finish_report_preparation(text,uuid,uuid,jsonb,text) TO service_role;
COMMIT;
