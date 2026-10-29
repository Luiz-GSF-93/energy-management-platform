-- Platform administrators may handle a Central Support intake without delegating it.
-- Existing internal cases still require an active Support assignee.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE INDEX central_support_outbox_sending ON public.central_support_outbox(lease_until) WHERE state='SENDING';
ALTER TABLE public.central_support_requests ADD COLUMN promised_deadline date;
ALTER TABLE public.central_support_requests ADD COLUMN triage_status text NOT NULL DEFAULT 'OPEN' CHECK(triage_status IN ('OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED'));
ALTER TABLE public.central_support_requests ADD COLUMN triage_priority text NOT NULL DEFAULT 'NORMAL' CHECK(triage_priority IN ('LOW','NORMAL','HIGH'));
ALTER TABLE public.central_support_requests ADD COLUMN managing_admin_id uuid REFERENCES auth.users(id);
CREATE OR REPLACE FUNCTION public.central_support_notice(i uuid,k text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.central_support_requests; c public.platform_support_cases;
BEGIN
 SELECT * INTO r FROM public.central_support_requests WHERE id=i;SELECT * INTO c FROM public.platform_support_cases WHERE id=i;
 INSERT INTO public.central_support_outbox(request_id,event_key,payload)
 VALUES(i,k,jsonb_build_object('protocol','AT-'||upper(replace(i::text,'-','')),'organizationId',r.organization_id,
 'organizationName',(SELECT name FROM public.organizations WHERE id=r.organization_id),'requesterId',r.requester_id,
 'title',r.title,'status',coalesce(c.status,CASE WHEN r.promised_deadline IS NOT NULL THEN r.triage_status ELSE 'TRIAGE' END),'deadline',coalesce(c.deadline,r.promised_deadline),'reply',r.public_reply,'quoteMinor',r.quote_minor,
 'summary',public.central_support_summary(r.cycle_id))) ON CONFLICT(event_key) DO NOTHING;
END$$;

CREATE OR REPLACE FUNCTION public.central_support_action(o text,a uuid,x text,i uuid DEFAULT NULL,b jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
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
 'deadline',coalesce(pc.deadline,r.promised_deadline),'status',coalesce(pc.status,CASE WHEN r.state='SUBMITTED' THEN CASE WHEN r.promised_deadline IS NULL THEN 'TRIAGE' ELSE r.triage_status END ELSE r.state END),'reply',r.public_reply,
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

CREATE OR REPLACE FUNCTION public.central_support_platform(a uuid,x text,i uuid DEFAULT NULL,b jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE p public.central_support_policies;r public.central_support_requests;profile text;case_revision integer;res jsonb;previous_policy jsonb;notice public.central_support_outbox;prior_license_actor text;prior_status text;
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
 IF nullif(b->>'assigneeId','') IS NULL THEN
 IF case_revision IS NOT NULL THEN RAISE EXCEPTION 'Keep the active assignee of a delegated case' USING ERRCODE='22023';END IF;
 prior_status:=CASE WHEN r.promised_deadline IS NULL THEN NULL ELSE r.triage_status END;
 IF prior_status IS NULL AND b->>'status'<>'OPEN' OR prior_status IS NOT NULL AND b->>'status'<>prior_status AND NOT (
 (prior_status='OPEN' AND b->>'status'='IN_PROGRESS') OR (prior_status='IN_PROGRESS' AND b->>'status' IN ('WAITING','RESOLVED')) OR
 (prior_status='WAITING' AND b->>'status' IN ('IN_PROGRESS','RESOLVED')) OR (prior_status='RESOLVED' AND b->>'status'='CLOSED') OR
 (prior_status IN ('RESOLVED','CLOSED') AND b->>'status'='OPEN')) THEN RAISE EXCEPTION 'Invalid support transition' USING ERRCODE='22023';END IF;
 ELSE
 PERFORM set_config('energyos.central_support_reply','on',true);
 res:=public.save_platform_support_case(a,i,coalesce(case_revision,0),jsonb_build_object('title',r.title,'organizationId',r.organization_id,'assigneeId',b->>'assigneeId','priority',b->>'priority','deadline',b->>'deadline','status',coalesce(b->>'status','OPEN'),'reason','Atendimento Central: '||(b->>'reason')),NULL,NULL);
 PERFORM set_config('energyos.central_support_reply','off',true);
 END IF;
 UPDATE public.central_support_requests SET promised_deadline=(b->>'deadline')::date,triage_status=b->>'status',triage_priority=b->>'priority',managing_admin_id=a WHERE id=i;
 ELSIF x='reply' THEN
 IF NOT EXISTS(SELECT 1 FROM public.platform_support_cases WHERE id=i) THEN RAISE EXCEPTION 'Triage first' USING ERRCODE='22023';END IF;
 ELSE RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';END IF;
 UPDATE public.central_support_requests SET public_reply=btrim(b->>'reason'),reply_revision=reply_revision+1,updated_at=now() WHERE id=i;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status)
 VALUES(gen_random_uuid()::text,r.organization_id,a,'UPDATE','central_support',i::text,jsonb_build_object('action',x,'replyRevision',r.reply_revision+1,'publicReply',btrim(b->>'reason'),'previousDeadline',r.promised_deadline,'previousStatus',r.triage_status,'priority',b->>'priority','deadline',b->>'deadline','status',b->>'status','assigneeId',nullif(b->>'assigneeId','')),'success');
 PERFORM public.central_support_notice(i,i::text||':reply:'||(r.reply_revision+1)::text);RETURN jsonb_build_object('recorded',true);
END$$;
COMMIT;
