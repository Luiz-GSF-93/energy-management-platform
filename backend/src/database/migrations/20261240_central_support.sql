BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.central_support_policies(
 plan_id uuid PRIMARY KEY REFERENCES public.plan_catalog(id), revision integer NOT NULL CHECK(revision>0),
 allowance integer NOT NULL CHECK(allowance BETWEEN 0 AND 100000), extra_minor integer NOT NULL CHECK(extra_minor BETWEEN 0 AND 100000000),
 updated_by uuid NOT NULL REFERENCES auth.users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.licenses ADD COLUMN central_support_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE public.central_support_cycles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 license_id text NOT NULL, anchor date NOT NULL, starts date NOT NULL, ends date NOT NULL CHECK(ends>starts),
 policy jsonb NOT NULL, UNIQUE(organization_id,starts)
);
CREATE TABLE public.central_support_requests(
 id uuid PRIMARY KEY, organization_id text NOT NULL REFERENCES public.organizations(id), requester_id uuid NOT NULL REFERENCES auth.users(id),
 revision integer NOT NULL DEFAULT 1, title text NOT NULL CHECK(length(title) BETWEEN 5 AND 200), description text NOT NULL CHECK(length(description) BETWEEN 10 AND 12000),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','AUTHORIZED','SUBMITTED')),
 cycle_id uuid REFERENCES public.central_support_cycles(id), quote_minor integer, code_hash text, code_expires timestamptz,
 attempts integer NOT NULL DEFAULT 0, authorized_by uuid REFERENCES auth.users(id), authorized_at timestamptz,
 submitted_at timestamptz, consent jsonb, public_reply text, reply_revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.central_support_movements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid UNIQUE NOT NULL REFERENCES public.central_support_requests(id),
 cycle_id uuid NOT NULL REFERENCES public.central_support_cycles(id), extra_minor integer NOT NULL CHECK(extra_minor>=0),
 is_extra boolean NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.central_support_extras(
 request_id uuid PRIMARY KEY REFERENCES public.central_support_requests(id), organization_id text NOT NULL REFERENCES public.organizations(id),
 amount_minor integer NOT NULL CHECK(amount_minor>=0), state text NOT NULL DEFAULT 'PENDING_INVOICE' CHECK(state IN ('PENDING_INVOICE','INVOICED','REVERSED')),
 invoice_reference text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.central_support_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.central_support_requests(id),
 event_key text UNIQUE NOT NULL, payload jsonb NOT NULL, state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SENDING','ACCEPTED','FAILED','UNKNOWN')),
 lease uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, provider_id text,
 created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz
);
CREATE INDEX central_support_requests_org_date ON public.central_support_requests(organization_id,created_at DESC,id);
CREATE INDEX central_support_movements_cycle ON public.central_support_movements(cycle_id);
CREATE INDEX central_support_outbox_request ON public.central_support_outbox(request_id,created_at DESC);
CREATE INDEX central_support_outbox_pending ON public.central_support_outbox(created_at) WHERE state='PENDING';
ALTER TABLE public.central_support_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.central_support_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.central_support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.central_support_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.central_support_extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.central_support_outbox ENABLE ROW LEVEL SECURITY;
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['central_support_policies','central_support_cycles','central_support_requests','central_support_movements','central_support_extras','central_support_outbox'] LOOP
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END$$;

CREATE FUNCTION public.central_support_actor(o text,a uuid,admin_only boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE role_name text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=o AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Inactive organization' USING ERRCODE='42501';END IF;
 SELECT r.name INTO role_name FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id
 WHERE m.organization_id=o AND m.user_id::text=a::text AND m.status='active' AND r.scope='organization'
 AND m.affiliation_type='internal' AND r.organization_id=o AND r.name IN ('admin_org','gestor','operacional') FOR SHARE OF m,r;
 IF role_name IS NULL OR admin_only AND role_name<>'admin_org' THEN RAISE EXCEPTION 'Organization support access denied' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=a AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<now()))
 THEN RAISE EXCEPTION 'Inactive identity' USING ERRCODE='42501';END IF;
 RETURN role_name;
END$$;

CREATE FUNCTION public.central_support_cycle(o text) RETURNS public.central_support_cycles
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l public.licenses; p public.central_support_policies; c public.central_support_cycles; anchor_day date; first_day date; yr integer; today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('central-support:'||o,0));
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=o AND active AND lower(status)='active' AND start_date<=today AND(end_date IS NULL OR end_date>=today))<>1
 THEN RAISE EXCEPTION 'Active unique license required' USING ERRCODE='22023'; END IF;
 SELECT * INTO l FROM public.licenses WHERE organization_id=o AND active AND lower(status)='active' AND start_date<=today AND(end_date IS NULL OR end_date>=today) FOR SHARE;
 IF NOT l.central_support_enabled THEN RAISE EXCEPTION 'Support not enabled in license' USING ERRCODE='22023';END IF;
 SELECT min(anchor) INTO anchor_day FROM public.central_support_cycles WHERE organization_id=o;
 anchor_day:=coalesce(anchor_day,l.start_date);
 yr:=extract(year FROM today)::integer-extract(year FROM anchor_day)::integer;
 first_day:=(anchor_day+make_interval(years=>yr))::date;
 IF first_day>today THEN yr:=yr-1;first_day:=(anchor_day+make_interval(years=>yr))::date;END IF;
 SELECT * INTO c FROM public.central_support_cycles WHERE organization_id=o AND starts=first_day;
 IF c.id IS NULL THEN
 SELECT * INTO p FROM public.central_support_policies WHERE plan_id=l.plan_id;
 IF p.plan_id IS NULL THEN RAISE EXCEPTION 'Configure support policy in plan' USING ERRCODE='22023';END IF;
 INSERT INTO public.central_support_cycles(organization_id,license_id,anchor,starts,ends,policy)
 VALUES(o,l.id::text,anchor_day,first_day,(anchor_day+make_interval(years=>yr+1))::date,to_jsonb(p)) RETURNING * INTO c;
 END IF;
 RETURN c;
END$$;

CREATE FUNCTION public.central_support_summary(c_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('cycleId',c.id,'starts',c.starts,'ends',c.ends,'allowance',(c.policy->>'allowance')::integer,
 'extraMinor',(c.policy->>'extra_minor')::integer,'includedUsed',count(m.id) FILTER(WHERE NOT m.is_extra),'extrasUsed',count(m.id) FILTER(WHERE m.is_extra),
 'totalUsed',count(m.id),'remaining',greatest(0,(c.policy->>'allowance')::integer-count(m.id) FILTER(WHERE NOT m.is_extra)))
 FROM public.central_support_cycles c LEFT JOIN public.central_support_movements m ON m.cycle_id=c.id WHERE c.id=c_id GROUP BY c.id
$$;

CREATE FUNCTION public.central_support_notice(i uuid,k text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.central_support_requests; c public.platform_support_cases;
BEGIN
 SELECT * INTO r FROM public.central_support_requests WHERE id=i;SELECT * INTO c FROM public.platform_support_cases WHERE id=i;
 INSERT INTO public.central_support_outbox(request_id,event_key,payload)
 VALUES(i,k,jsonb_build_object('protocol','AT-'||upper(replace(i::text,'-','')),'organizationId',r.organization_id,
 'organizationName',(SELECT name FROM public.organizations WHERE id=r.organization_id),'requesterId',r.requester_id,
 'title',r.title,'status',coalesce(c.status,'TRIAGE'),'deadline',c.deadline,'reply',r.public_reply,'quoteMinor',r.quote_minor,
 'summary',public.central_support_summary(r.cycle_id))) ON CONFLICT(event_key) DO NOTHING;
END$$;

CREATE FUNCTION public.central_support_action(o text,a uuid,x text,i uuid DEFAULT NULL,b jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE role_name text;c public.central_support_cycles;r public.central_support_requests;summary jsonb;cost integer;extra boolean;result jsonb;
BEGIN
 role_name:=public.central_support_actor(o,a,x='authorize');
 IF jsonb_typeof(b)<>'object' THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023';END IF;
 c:=public.central_support_cycle(o);summary:=public.central_support_summary(c.id);
 IF x='list' THEN
 IF coalesce((b->>'page')::integer,0) NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('total',(SELECT count(*) FROM public.central_support_requests sr WHERE sr.organization_id=o AND(role_name='admin_org' OR sr.requester_id=a)),'summary',summary,'canAuthorize',role_name='admin_org','rows',coalesce((SELECT jsonb_agg(j ORDER BY created_at DESC) FROM
 (SELECT r.created_at,jsonb_build_object('id',r.id,'protocol','AT-'||upper(replace(r.id::text,'-','')),'revision',r.revision,'title',r.title,'description',r.description,
 'state',r.state,'requesterId',r.requester_id,'quoteMinor',r.quote_minor,'authorizedAt',r.authorized_at,'expiresAt',r.code_expires,
 'deadline',pc.deadline,'status',coalesce(pc.status,CASE WHEN r.state='SUBMITTED' THEN 'TRIAGE' ELSE r.state END),'reply',r.public_reply,
 'submittedAt',r.submitted_at,'consent',r.consent,'summary',public.central_support_summary(r.cycle_id),'extra',to_jsonb(e)-'organization_id',
 'communications',coalesce((SELECT jsonb_agg(jsonb_build_object('id',n.id,'date',n.created_at,'state',n.state,'payload',n.payload) ORDER BY n.created_at DESC) FROM public.central_support_outbox n WHERE n.request_id=r.id),'[]'::jsonb)) j
 FROM public.central_support_requests r LEFT JOIN public.platform_support_cases pc ON pc.id=r.id LEFT JOIN public.central_support_extras e ON e.request_id=r.id
 WHERE r.organization_id=o AND(role_name='admin_org' OR r.requester_id=a) ORDER BY r.created_at DESC LIMIT 50 OFFSET coalesce((b->>'page')::integer,0)*50) q),'[]'::jsonb));
 END IF;
 SELECT * INTO r FROM public.central_support_requests WHERE id=i FOR UPDATE;
 IF r.id IS NOT NULL AND(r.organization_id<>o OR role_name<>'admin_org' AND r.requester_id<>a) THEN RAISE EXCEPTION 'Request access denied' USING ERRCODE='42501';END IF;
 IF x='draft' THEN
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(b) k WHERE k NOT IN ('title','description')) OR i IS NULL THEN RAISE EXCEPTION 'Invalid draft' USING ERRCODE='22023';END IF;
 IF r.id IS NOT NULL THEN
 IF r.title=b->>'title' AND r.description=b->>'description' THEN RETURN jsonb_build_object('id',r.id,'revision',r.revision);END IF;
 RAISE EXCEPTION 'Request immutable; prepare a new draft' USING ERRCODE='40001';END IF;
 IF (SELECT count(*) FROM public.central_support_requests WHERE organization_id=o AND requester_id=a AND state<>'SUBMITTED')>=20 THEN RAISE EXCEPTION 'Conclude pending drafts first' USING ERRCODE='22023';END IF;
 INSERT INTO public.central_support_requests(id,organization_id,requester_id,title,description)
 VALUES(i,o,a,btrim(b->>'title'),btrim(b->>'description')) RETURNING * INTO r;
 ELSIF x='authorize' THEN
 IF r.id IS NULL OR r.state='SUBMITTED' OR (b->>'revision')::integer IS DISTINCT FROM r.revision THEN RAISE EXCEPTION 'Stale request' USING ERRCODE='40001';END IF;
 IF r.authorized_at>now()-interval '1 minute' THEN RAISE EXCEPTION 'Wait before authorizing again' USING ERRCODE='22023';END IF;
 cost:=CASE WHEN(summary->>'remaining')::integer>0 THEN 0 ELSE(summary->>'extraMinor')::integer END;
 IF b->>'confirmed' IS DISTINCT FROM 'true' OR (b->>'quoteMinor')::integer IS DISTINCT FROM cost OR coalesce(b->>'codeHash','') !~ '^[a-f0-9]{64}$'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(b) k WHERE k NOT IN ('revision','confirmed','quoteMinor','codeHash')) THEN RAISE EXCEPTION 'Confirm content and exact price' USING ERRCODE='22023';END IF;
 UPDATE public.central_support_requests SET state='AUTHORIZED',revision=revision+1,cycle_id=c.id,quote_minor=cost,
 code_hash=b->>'codeHash',code_expires=now()+interval '10 minutes',attempts=0,authorized_by=a,authorized_at=now(),updated_at=now() WHERE id=i RETURNING * INTO r;
 ELSIF x='submit' THEN
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request missing' USING ERRCODE='42501';END IF;
 IF r.state='SUBMITTED' THEN RETURN jsonb_build_object('id',r.id,'submitted',true);END IF;
 IF r.requester_id<>a AND role_name<>'admin_org' THEN RAISE EXCEPTION 'Submit denied' USING ERRCODE='42501';END IF;
 IF r.state<>'AUTHORIZED' OR r.attempts>=5 OR r.code_expires<now() OR r.cycle_id<>c.id THEN RETURN jsonb_build_object('error','EXPIRED','message','Autorização expirada; solicite nova liberação ao administrador.');END IF;
 PERFORM public.central_support_actor(o,r.authorized_by,true);
 IF r.code_hash IS DISTINCT FROM b->>'codeHash' THEN
 UPDATE public.central_support_requests SET attempts=attempts+1 WHERE id=i;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status)
 VALUES(gen_random_uuid()::text,o,a,'UPDATE','central_support',i::text,jsonb_build_object('action','CODE_REJECTED','attempt',r.attempts+1),'failure');
 RETURN jsonb_build_object('error','CODE','message','Código inválido; confira a liberação do administrador.');END IF;
 extra:=(summary->>'remaining')::integer=0;cost:=CASE WHEN extra THEN(summary->>'extraMinor')::integer ELSE 0 END;
 IF cost<>r.quote_minor THEN RETURN jsonb_build_object('error','PRICE_CHANGED','message','A franquia mudou. Solicite nova autorização do valor.');END IF;
 INSERT INTO public.central_support_movements(request_id,cycle_id,extra_minor,is_extra,actor_id) VALUES(i,c.id,cost,extra,a);
 IF extra THEN INSERT INTO public.central_support_extras(request_id,organization_id,amount_minor) VALUES(i,o,cost);END IF;
 UPDATE public.central_support_requests SET state='SUBMITTED',code_hash=NULL,revision=revision+1,submitted_at=now(),updated_at=now(),
 consent=jsonb_build_object('authorizationReference',i,'authorizedBy',r.authorized_by,'authorizedAt',r.authorized_at,'contentRevision',r.revision,
 'cycleId',c.id,'quoteMinor',cost,'confidentialSupportOnly',true,'submittedBy',a) WHERE id=i RETURNING * INTO r;
 PERFORM public.central_support_notice(i,i::text||':submitted');
 ELSE RAISE EXCEPTION 'Unknown support action' USING ERRCODE='22023';END IF;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status)
 VALUES(gen_random_uuid()::text,o,a,'UPDATE','central_support',i::text,jsonb_build_object('action',x,'revision',r.revision,'state',r.state,'quoteMinor',r.quote_minor),'success');
 RETURN jsonb_build_object('id',r.id,'revision',r.revision,'submitted',r.state='SUBMITTED','expiresAt',r.code_expires);
END$$;

CREATE FUNCTION public.central_support_platform(a uuid,x text,i uuid DEFAULT NULL,b jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE p public.central_support_policies;r public.central_support_requests;profile text;case_revision integer;res jsonb;previous_policy jsonb;notice public.central_support_outbox;prior_license_actor text;
BEGIN
 IF x='policy_read' THEN
 PERFORM public.platform_workflow_actor(a,'af285642-16b0-405a-982c-58de1a10f987');
 SELECT * INTO p FROM public.central_support_policies WHERE plan_id=i;RETURN jsonb_build_object('policy',CASE WHEN p.plan_id IS NULL THEN NULL ELSE to_jsonb(p) END);
 END IF;
 IF x IN ('policy','activate') THEN
 PERFORM public.platform_workflow_actor(a,'af285642-16b0-405a-982c-58de1a10f987');
 IF x='policy' THEN
 SELECT * INTO p FROM public.central_support_policies WHERE plan_id=i FOR UPDATE;
 previous_policy:=to_jsonb(p);
 IF coalesce(p.revision,0) IS DISTINCT FROM (b->>'revision')::integer THEN RAISE EXCEPTION 'Policy changed' USING ERRCODE='40001';END IF;
 INSERT INTO public.central_support_policies(plan_id,revision,allowance,extra_minor,updated_by)
 VALUES(i,coalesce(p.revision,0)+1,(b->>'allowance')::integer,(b->>'extraMinor')::integer,a)
 ON CONFLICT(plan_id) DO UPDATE SET revision=excluded.revision,allowance=excluded.allowance,extra_minor=excluded.extra_minor,updated_by=a,updated_at=now() RETURNING * INTO p;
 res:=to_jsonb(p);
 ELSE
 IF NOT EXISTS(SELECT 1 FROM public.licenses l JOIN public.central_support_policies cp ON cp.plan_id=l.plan_id WHERE l.id::text=b->>'licenseId' AND l.organization_id='org_default')
 THEN RAISE EXCEPTION 'Configure policy; initial rollout Expert Energy only' USING ERRCODE='22023';END IF;
 prior_license_actor:=current_setting('app.license_actor',true);
 PERFORM set_config('app.license_actor',a::text,true);
 UPDATE public.licenses SET central_support_enabled=(b->>'enabled')::boolean,governance_revision=governance_revision+1,updated_at=now() WHERE id::text=b->>'licenseId' AND organization_id='org_default';
 PERFORM set_config('app.license_actor',coalesce(prior_license_actor,''),true);
 res:=jsonb_build_object('recorded',true);
 END IF;
 IF x='policy' THEN
 INSERT INTO public.platform_plan_audit(plan_id,actor_id,action,changes)
 VALUES(i,a,'UPDATE',jsonb_build_object('resource','central_support_policy','before',previous_policy,'after',res,'reason',b->>'reason'));
 ELSE
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status)
 VALUES(gen_random_uuid()::text,'org_default',a,'UPDATE','central_support_policy',b->>'licenseId',jsonb_build_object('action',x,'after',res,'enabled',b->>'enabled','reason',b->>'reason'),'success');
 END IF;RETURN res;
 END IF;
 SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=a AND t.active;
 PERFORM public.platform_workflow_actor(a,CASE WHEN profile IN ('OWNER','ADMINISTRATOR') THEN 'a7c8f257-580d-4d39-8900-4a5788068203' ELSE 'a7c8f257-580d-4d39-8900-4a5788068204' END);
 IF x='retry_email' THEN
 IF profile NOT IN ('OWNER','ADMINISTRATOR') OR length(btrim(coalesce(b->>'reason',''))) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Manager and reason required' USING ERRCODE='42501';END IF;
 SELECT * INTO notice FROM public.central_support_outbox WHERE id=i FOR UPDATE;
 IF notice.id IS NULL OR notice.state NOT IN ('FAILED','UNKNOWN') OR notice.attempts>=3 OR notice.created_at<now()-interval '23 hours' THEN RAISE EXCEPTION 'Verify provider; safe retry not available' USING ERRCODE='40001';END IF;
 UPDATE public.central_support_outbox SET state='PENDING',lease=NULL,lease_until=NULL WHERE id=i;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status)
 VALUES(gen_random_uuid()::text,notice.payload->>'organizationId',a,'UPDATE','central_support_delivery',i::text,jsonb_build_object('action',x,'before',notice.state,'reason',b->>'reason'),'success');
 RETURN jsonb_build_object('recorded',true);
 END IF;
 IF x='list' THEN
 IF coalesce((b->>'page')::integer,0) NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('total',(SELECT count(*) FROM public.central_support_requests sr LEFT JOIN public.platform_support_cases sc ON sc.id=sr.id WHERE sr.state='SUBMITTED' AND(profile IN ('OWNER','ADMINISTRATOR') OR sc.assignee_id=a)),'rows',coalesce((SELECT jsonb_agg(j ORDER BY submitted_at) FROM(SELECT r.submitted_at,to_jsonb(r)-'code_hash'-'code_expires'-'attempts'||jsonb_build_object('protocol','AT-'||upper(replace(r.id::text,'-','')),'organizationName',o.name,'case',to_jsonb(c),'summary',public.central_support_summary(r.cycle_id),'extra',to_jsonb(e),'communications',coalesce((SELECT jsonb_agg(jsonb_build_object('id',n.id,'state',n.state,'date',n.created_at,'attempts',n.attempts,'providerId',n.provider_id) ORDER BY n.created_at DESC) FROM public.central_support_outbox n WHERE n.request_id=r.id),'[]'::jsonb)) j
 FROM public.central_support_requests r JOIN public.organizations o ON o.id=r.organization_id LEFT JOIN public.platform_support_cases c ON c.id=r.id LEFT JOIN public.central_support_extras e ON e.request_id=r.id
 WHERE r.state='SUBMITTED' AND (profile IN ('OWNER','ADMINISTRATOR') OR c.assignee_id=a) ORDER BY r.submitted_at DESC LIMIT 50 OFFSET coalesce((b->>'page')::integer,0)*50)q),'[]'::jsonb),
 'policies',CASE WHEN profile='OWNER' THEN coalesce((SELECT jsonb_agg(to_jsonb(cp)) FROM public.central_support_policies cp),'[]'::jsonb) ELSE '[]'::jsonb END);
 END IF;
 SELECT * INTO r FROM public.central_support_requests WHERE id=i AND state='SUBMITTED' FOR UPDATE;
 IF r.id IS NULL OR profile NOT IN ('OWNER','ADMINISTRATOR') AND NOT EXISTS(SELECT 1 FROM public.platform_support_cases WHERE id=i AND assignee_id=a)
 THEN RAISE EXCEPTION 'Assigned ticket required' USING ERRCODE='42501';END IF;
 IF (b->>'replyRevision')::integer IS DISTINCT FROM r.reply_revision OR length(btrim(coalesce(b->>'reason',''))) NOT BETWEEN 5 AND 4000 THEN RAISE EXCEPTION 'Stale revision or invalid reply' USING ERRCODE='40001';END IF;
 IF x='triage' THEN
 IF profile NOT IN ('OWNER','ADMINISTRATOR') THEN RAISE EXCEPTION 'Manager required' USING ERRCODE='42501';END IF;
 SELECT revision INTO case_revision FROM public.platform_support_cases WHERE id=i;
 PERFORM set_config('energyos.central_support_reply','on',true);
 res:=public.save_platform_support_case(a,i,coalesce(case_revision,0),jsonb_build_object('title',r.title,'organizationId',r.organization_id,'assigneeId',b->>'assigneeId','priority',b->>'priority','deadline',b->>'deadline','status',coalesce(b->>'status','OPEN'),'reason','Atendimento Central: '||(b->>'reason')),NULL,NULL);
 PERFORM set_config('energyos.central_support_reply','off',true);
 ELSIF x='reply' THEN
 IF NOT EXISTS(SELECT 1 FROM public.platform_support_cases WHERE id=i) THEN RAISE EXCEPTION 'Triage first' USING ERRCODE='22023';END IF;
 ELSE RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';END IF;
 UPDATE public.central_support_requests SET public_reply=btrim(b->>'reason'),reply_revision=reply_revision+1,updated_at=now() WHERE id=i;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status)
 VALUES(gen_random_uuid()::text,r.organization_id,a,'UPDATE','central_support',i::text,jsonb_build_object('action',x,'replyRevision',r.reply_revision+1,'publicReply',btrim(b->>'reason')),'success');
 PERFORM public.central_support_notice(i,i::text||':reply:'||(r.reply_revision+1)::text);RETURN jsonb_build_object('recorded',true);
END$$;

CREATE FUNCTION public.central_support_case_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF current_setting('energyos.central_support_reply',true)='on' THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public.central_support_requests WHERE id=NEW.id AND state='SUBMITTED') THEN
 IF TG_OP='INSERT' THEN RETURN NEW;END IF;
 IF NEW.deadline IS DISTINCT FROM OLD.deadline OR NEW.status IS DISTINCT FROM OLD.status THEN
 PERFORM public.central_support_notice(NEW.id,NEW.id::text||':case:'||NEW.revision::text);END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER central_support_case_changed AFTER INSERT OR UPDATE ON public.platform_support_cases FOR EACH ROW EXECUTE FUNCTION public.central_support_case_changed();

CREATE FUNCTION public.central_support_case_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.central_support_requests;
BEGIN
 SELECT * INTO r FROM public.central_support_requests WHERE id=NEW.id AND state='SUBMITTED';
 IF r.id IS NOT NULL THEN
 IF NEW.organization_id IS DISTINCT FROM r.organization_id THEN RAISE EXCEPTION 'Case organization is immutable' USING ERRCODE='42501';END IF;
 NEW.requester_id:=r.requester_id;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER central_support_case_identity BEFORE INSERT OR UPDATE ON public.platform_support_cases FOR EACH ROW EXECUTE FUNCTION public.central_support_case_identity();

CREATE FUNCTION public.central_support_notifications(o text,a uuid,k text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE role_name text;result jsonb;
BEGIN
 BEGIN role_name:=public.central_support_actor(o,a);EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('rows','[]'::jsonb);END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('key','support:'||n.id,'id',n.request_id,'origin','support','title','Atendimento Central · '||(n.payload->>'title'),
 'date',n.created_at,'status',n.payload->>'status','priority','NORMAL','href','/backoffice/support','dueAt',NULL,'overdue',false) ORDER BY n.created_at DESC),'[]'::jsonb)
 INTO result FROM (SELECT n.* FROM public.central_support_outbox n JOIN public.central_support_requests r ON r.id=n.request_id
 WHERE r.organization_id=o AND(role_name='admin_org' OR r.requester_id=a) ORDER BY n.created_at DESC LIMIT 50) n;
 IF k IS NOT NULL THEN
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) z WHERE z->>'key'=k) THEN RAISE EXCEPTION 'Notice not in scope' USING ERRCODE='42501';END IF;
 INSERT INTO public.operation_notification_reads(organization_id,user_id,notification_key) VALUES(o,a::text,k) ON CONFLICT DO NOTHING;
 END IF;
 RETURN jsonb_build_object('rows',result);
END$$;

CREATE FUNCTION public.central_support_delivery(x text,i uuid DEFAULT NULL,b jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n public.central_support_outbox;recipients jsonb;
BEGIN
 IF x='claim' THEN
 -- An abandoned send can have reached the provider. Do not blindly resend outside its idempotency window.
 UPDATE public.central_support_outbox SET state='UNKNOWN' WHERE state='SENDING' AND lease_until<now();
 SELECT * INTO n FROM public.central_support_outbox WHERE state='PENDING' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF n.id IS NULL THEN RETURN '{}'::jsonb;END IF;
 SELECT jsonb_agg(DISTINCT u.email) INTO recipients FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id JOIN auth.users u ON u.id::text=m.user_id::text
 WHERE m.organization_id=n.payload->>'organizationId' AND m.status='active' AND m.affiliation_type='internal' AND r.scope='organization' AND r.organization_id=m.organization_id AND r.name='admin_org' AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<now());
 IF recipients IS NULL THEN UPDATE public.central_support_outbox SET state='FAILED' WHERE id=n.id;RETURN jsonb_build_object('unavailable',true);END IF;
 UPDATE public.central_support_outbox SET state='SENDING',lease=i,lease_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=n.id;
 RETURN to_jsonb(n)||jsonb_build_object('recipients',recipients,'lease',i);
 ELSIF x='finish' THEN
 UPDATE public.central_support_outbox SET state=b->>'state',provider_id=b->>'providerId',accepted_at=CASE WHEN b->>'state'='ACCEPTED' THEN now() ELSE NULL END
 WHERE id=i AND state='SENDING' AND lease=(b->>'lease')::uuid AND lease_until>now();
 RETURN jsonb_build_object('recorded',FOUND);
 END IF;RAISE EXCEPTION 'Unknown delivery action' USING ERRCODE='22023';
END$$;

REVOKE ALL ON FUNCTION public.central_support_actor(text,uuid,boolean),public.central_support_cycle(text),public.central_support_summary(uuid),public.central_support_notice(uuid,text),public.central_support_action(text,uuid,text,uuid,jsonb),public.central_support_platform(uuid,text,uuid,jsonb),public.central_support_case_changed(),public.central_support_case_identity(),public.central_support_notifications(text,uuid,text),public.central_support_delivery(text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.central_support_action(text,uuid,text,uuid,jsonb),public.central_support_platform(uuid,text,uuid,jsonb),public.central_support_delivery(text,uuid,jsonb),public.central_support_notifications(text,uuid,text) TO service_role;
COMMIT;
