-- Approved support continuity. Additive; no historical ticket transition or email replay.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
ALTER TABLE public.central_support_requests
 ADD COLUMN resolution_id uuid,ADD COLUMN resolved_at timestamptz,ADD COLUMN resolution_notice_id uuid REFERENCES public.central_support_outbox(id),
 ADD COLUMN close_due_at timestamptz,ADD COLUMN closed_at timestamptz,ADD COLUMN closed_by uuid REFERENCES auth.users(id),
 ADD COLUMN closure_kind text CHECK(closure_kind IN('ORGANIZATION_CONFIRMED','SYSTEM_24H'));
CREATE TABLE public.central_support_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES public.central_support_requests(id),organization_id text NOT NULL,
 command_id uuid NOT NULL,fingerprint text NOT NULL,actor_id uuid REFERENCES auth.users(id),actor_name text NOT NULL,actor_scope text NOT NULL CHECK(actor_scope IN('PLATFORM','ORGANIZATION','SYSTEM')),
 kind text NOT NULL,body text NOT NULL CHECK(length(body) BETWEEN 5 AND 4000),status text NOT NULL,notice_id uuid REFERENCES public.central_support_outbox(id),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(request_id,command_id)
);
CREATE INDEX central_support_thread_date ON public.central_support_messages(request_id,created_at,id);
CREATE TABLE public.central_support_attachments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES public.central_support_requests(id),organization_id text NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 200),mime text NOT NULL CHECK(mime IN('application/pdf','image/jpeg','image/png')),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 5242880),sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 path text NOT NULL UNIQUE,state text NOT NULL DEFAULT 'RESERVED' CHECK(state IN('RESERVED','AVAILABLE','REMOVED')),
 created_at timestamptz NOT NULL DEFAULT now(),available_at timestamptz,UNIQUE(request_id,sha256)
);
CREATE INDEX central_support_attachments_request ON public.central_support_attachments(request_id,state);
CREATE INDEX central_support_close_due ON public.central_support_requests(close_due_at) WHERE resolution_id IS NOT NULL AND closed_at IS NULL;
ALTER TABLE public.central_support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.central_support_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.central_support_messages,public.central_support_attachments FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.central_support_thread_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'SC_IMMUTABLE' USING ERRCODE='42501';END$$;
CREATE TRIGGER central_support_thread_immutable BEFORE UPDATE OR DELETE ON public.central_support_messages FOR EACH ROW EXECUTE FUNCTION public.central_support_thread_immutable();
-- Existing private Supabase service only; no anon/authenticated object policies added.
DO $$BEGIN IF to_regclass('storage.buckets') IS NOT NULL THEN
 INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('central-support-private','central-support-private',false,5242880,ARRAY['application/pdf','image/jpeg','image/png']) ON CONFLICT(id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='central-support-private' AND NOT public AND file_size_limit=5242880 AND allowed_mime_types@>ARRAY['application/pdf','image/jpeg','image/png']) THEN RAISE EXCEPTION 'Private support bucket conflict';END IF;
END IF;
 IF to_regclass('storage.objects') IS NOT NULL THEN
 -- Restrictive AND policy denies direct client access even if another bucket has broad permissive rules.
 EXECUTE 'CREATE POLICY central_support_private_client_deny ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING(bucket_id<>''central-support-private'') WITH CHECK(bucket_id<>''central-support-private'')';
 END IF;
END$$;

CREATE FUNCTION public.central_support_thread_actor(o text,a uuid,p boolean,i uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.central_support_requests;role_name text;
BEGIN
 SELECT * INTO r FROM public.central_support_requests WHERE id=i;
 IF r.id IS NULL THEN RAISE EXCEPTION 'SC_DENIED' USING ERRCODE='42501';END IF;
 IF p THEN
 IF r.state<>'SUBMITTED' THEN RAISE EXCEPTION 'SC_DENIED' USING ERRCODE='42501';END IF;
 SELECT profile INTO role_name FROM public.platform_team_members WHERE user_id=a AND active;
 PERFORM public.platform_workflow_actor(a,CASE WHEN role_name IN('OWNER','ADMINISTRATOR') THEN 'a7c8f257-580d-4d39-8900-4a5788068203' ELSE 'a7c8f257-580d-4d39-8900-4a5788068204' END);
 IF role_name NOT IN('OWNER','ADMINISTRATOR') THEN
 PERFORM 1 FROM public.platform_support_cases WHERE id=i AND assignee_id=a FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SC_DENIED' USING ERRCODE='42501';END IF;
 END IF;
 ELSE
 role_name:=public.central_support_actor(o,a);
 IF r.organization_id<>o OR role_name<>'admin_org' AND r.requester_id<>a THEN RAISE EXCEPTION 'SC_DENIED' USING ERRCODE='42501';END IF;
 END IF;RETURN role_name;
END$$;

-- Only this private state writer synchronizes central intake and delegated internal case.
CREATE FUNCTION public.central_support_thread_state(i uuid,s text,a uuid,scope text,why text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.platform_support_cases;
BEGIN
 UPDATE public.central_support_requests SET triage_status=s,updated_at=now() WHERE id=i;
 SELECT * INTO c FROM public.platform_support_cases WHERE id=i FOR UPDATE;
 IF c.id IS NOT NULL AND c.status<>s THEN
 PERFORM set_config('energyos.central_support_reply','on',true);
 UPDATE public.platform_support_cases SET status=s,revision=revision+1,updated_at=now() WHERE id=i;
 PERFORM set_config('energyos.central_support_reply','off',true);
 INSERT INTO public.platform_support_case_events(case_id,revision,actor_id,details) VALUES(i,c.revision+1,a,jsonb_build_object('reason',why,'beforeStatus',c.status,'afterStatus',s,'actorScope',scope,'actorNameAtTime',CASE WHEN a IS NULL THEN 'Encerramento automático' ELSE public.platform_workflow_name(a) END));
 END IF;
END$$;
CREATE FUNCTION public.central_support_case_closure_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.central_support_requests;
BEGIN
 SELECT * INTO r FROM public.central_support_requests WHERE id=NEW.id AND state='SUBMITTED';IF r.id IS NULL THEN RETURN NEW;END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM r.triage_status THEN RAISE EXCEPTION 'SC_USE_THREAD' USING ERRCODE='22023';END IF;
 IF OLD.status='CLOSED' AND NEW.status<>'CLOSED' THEN RAISE EXCEPTION 'SC_CLOSED_NEW_TICKET' USING ERRCODE='22023';END IF;
 IF NEW.status='CLOSED' AND OLD.status<>'CLOSED' AND(r.closed_at IS NULL OR r.closure_kind IS NULL OR NOT EXISTS(SELECT 1 FROM public.central_support_messages WHERE request_id=r.id AND kind='CLOSE')) THEN RAISE EXCEPTION 'SC_CONFIRM_REQUIRED' USING ERRCODE='22023';END IF;
 IF OLD.status='RESOLVED' AND NEW.status IN('OPEN','IN_PROGRESS','WAITING') AND r.resolution_id IS NOT NULL THEN RAISE EXCEPTION 'SC_CONTEST_REQUIRED' USING ERRCODE='22023';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER central_support_case_closure_guard BEFORE UPDATE ON public.platform_support_cases FOR EACH ROW EXECUTE FUNCTION public.central_support_case_closure_guard();

-- System closures must not be attributed to an impersonated human account.
ALTER TABLE public.platform_support_case_events ALTER COLUMN actor_id DROP NOT NULL;
CREATE FUNCTION public.central_support_system_case_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF NEW.actor_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.central_support_requests r JOIN public.central_support_messages m ON m.request_id=r.id WHERE r.id=NEW.case_id AND r.closure_kind='SYSTEM_24H' AND r.closed_at IS NOT NULL AND m.actor_scope='SYSTEM' AND m.kind='CLOSE' AND NEW.details->>'actorScope'='SYSTEM' AND NEW.details->>'afterStatus'='CLOSED') THEN RAISE EXCEPTION 'SC_DENIED' USING ERRCODE='42501';END IF;RETURN NEW;
END$$;
CREATE TRIGGER central_support_system_case_event BEFORE INSERT ON public.platform_support_case_events FOR EACH ROW EXECUTE FUNCTION public.central_support_system_case_event();

CREATE FUNCTION public.central_support_thread(o text,a uuid,p boolean,x text,i uuid,b jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.central_support_requests;c public.platform_support_cases;profile text;manager boolean;s text;wanted text;why text;cmd uuid;fp text;prior public.central_support_messages;msg uuid;nt uuid;rid uuid;ret jsonb;pg integer;dl date;
BEGIN
 IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR octet_length(b::text)>20000 THEN RAISE EXCEPTION 'SC_INPUT' USING ERRCODE='22023';END IF;
 IF x='read' THEN
 profile:=public.central_support_thread_actor(o,a,p,i);
 SELECT * INTO r FROM public.central_support_requests WHERE id=i;SELECT * INTO c FROM public.platform_support_cases WHERE id=i;
 s:=coalesce(c.status,r.triage_status);pg:=coalesce((b->>'page')::integer,0);IF pg NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'SC_INPUT' USING ERRCODE='22023';END IF;
 WITH timeline AS(
 SELECT id::text id,actor_name,actor_scope,kind,body,status,created_at FROM public.central_support_messages WHERE request_id=i
 UNION ALL SELECT 'history:'||n.id::text,'Atendimento · registro histórico','PLATFORM','HISTORY',left(n.payload->>'reply',4000),n.payload->>'status',n.created_at FROM public.central_support_outbox n
 WHERE n.request_id=i AND n.event_key LIKE i::text||':reply:%' AND length(coalesce(n.payload->>'reply',''))>=5 AND NOT EXISTS(SELECT 1 FROM public.central_support_messages m WHERE m.notice_id=n.id)
 ),page AS(SELECT * FROM timeline ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET pg*50)
 SELECT jsonb_build_object('messages',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY created_at,id) FROM page q),'[]'),'messageTotal',(SELECT count(*) FROM timeline)) INTO ret;
 RETURN ret||jsonb_build_object('id',r.id,'protocol','AT-'||upper(replace(i::text,'-','')),'organizationName',(SELECT name FROM public.organizations WHERE id=r.organization_id),'title',r.title,'description',r.description,'state',r.state,'status',CASE WHEN r.closed_at IS NOT NULL THEN 'CLOSED' WHEN r.state<>'SUBMITTED' THEN r.state ELSE s END,'revision',r.reply_revision,'deadline',coalesce(c.deadline,r.promised_deadline),'priority',coalesce(c.priority,r.triage_priority),'assigneeId',c.assignee_id,'manager',p AND profile IN('OWNER','ADMINISTRATOR'),'summary',CASE WHEN r.cycle_id IS NOT NULL THEN public.central_support_summary(r.cycle_id) END,
 'resolution',jsonb_build_object('id',r.resolution_id,'resolvedAt',r.resolved_at,'closeDueAt',r.close_due_at,'closedAt',r.closed_at,'kind',r.closure_kind,'noticeState',(SELECT state FROM public.central_support_outbox WHERE id=r.resolution_notice_id)),
 'canReply',r.state='SUBMITTED' AND s<>'CLOSED' AND r.closed_at IS NULL,'canUpload',s<>'CLOSED' AND r.closed_at IS NULL,
 'attachments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.filename,'bytes',f.bytes,'mime',f.mime,'state',f.state,'createdAt',f.created_at) ORDER BY f.created_at) FROM public.central_support_attachments f WHERE f.request_id=i AND f.state<>'REMOVED'),'[]'),
 'supportMembers',CASE WHEN p AND profile IN('OWNER','ADMINISTRATOR') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.user_id,'name',public.platform_workflow_name(t.user_id))) FROM public.platform_team_members t WHERE t.active AND t.profile='SUPPORT'),'[]') ELSE '[]'::jsonb END);
 END IF;
 SELECT * INTO r FROM public.central_support_requests WHERE id=i FOR UPDATE;
 profile:=public.central_support_thread_actor(o,a,p,i);manager:=p AND profile IN('OWNER','ADMINISTRATOR');
 IF r.state<>'SUBMITTED' THEN RAISE EXCEPTION 'SC_SUBMIT_FIRST' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.platform_support_cases WHERE id=i FOR UPDATE;s:=coalesce(c.status,r.triage_status);
 cmd:=(b->>'commandId')::uuid;why:=btrim(b->>'text');fp:=encode(sha256(convert_to(jsonb_build_object('action',x,'body',b,'actor',a)::text,'UTF8')),'hex');
 IF cmd IS NULL OR why IS NULL OR length(why) NOT BETWEEN 5 AND 4000 THEN RAISE EXCEPTION 'SC_TEXT' USING ERRCODE='22023';END IF;
 SELECT * INTO prior FROM public.central_support_messages WHERE request_id=i AND command_id=cmd;
 IF prior.id IS NOT NULL THEN IF prior.fingerprint<>fp OR prior.actor_id IS DISTINCT FROM a THEN RAISE EXCEPTION 'SC_COMMAND_CHANGED' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('recorded',true,'idempotent',true,'messageId',prior.id);END IF;
 IF r.closed_at IS NOT NULL OR s='CLOSED' THEN RAISE EXCEPTION 'SC_CLOSED_NEW_TICKET' USING ERRCODE='22023';END IF;
 IF (b->>'revision')::integer IS DISTINCT FROM r.reply_revision THEN RAISE EXCEPTION 'SC_STALE' USING ERRCODE='40001';END IF;
 wanted:=s;
 IF p THEN
 IF x NOT IN('START','UPDATE','WAIT','RESOLVE','TRIAGE') THEN RAISE EXCEPTION 'SC_ACTION' USING ERRCODE='22023';END IF;
 IF x='START' AND s IN('OPEN','WAITING') THEN wanted:='IN_PROGRESS';
 ELSIF x='WAIT' AND s='IN_PROGRESS' THEN wanted:='WAITING';
 ELSIF x='RESOLVE' AND s IN('IN_PROGRESS','WAITING') THEN wanted:='RESOLVED';
 ELSIF x IN('UPDATE','TRIAGE') THEN NULL;
 ELSE RAISE EXCEPTION 'SC_TRANSITION' USING ERRCODE='22023';END IF;
 IF manager THEN
 dl:=coalesce(nullif(b->>'deadline','')::date,c.deadline,r.promised_deadline);
 IF dl IS NULL THEN RAISE EXCEPTION 'SC_DEADLINE' USING ERRCODE='22023';END IF;
 IF b?'priority' AND b->>'priority' NOT IN('LOW','NORMAL','HIGH') THEN RAISE EXCEPTION 'SC_INPUT' USING ERRCODE='22023';END IF;
 IF s='RESOLVED' AND (b?'assigneeId' OR b?'deadline' OR b?'priority') THEN RAISE EXCEPTION 'SC_CONTEST_REQUIRED' USING ERRCODE='22023';END IF;
 IF b?'assigneeId' AND nullif(b->>'assigneeId','') IS NULL AND c.id IS NOT NULL THEN RAISE EXCEPTION 'SC_KEEP_ASSIGNEE' USING ERRCODE='22023';END IF;
 IF c.id IS NOT NULL AND(b?'assigneeId' OR b?'deadline' OR b?'priority') OR c.id IS NULL AND nullif(b->>'assigneeId','') IS NOT NULL THEN
 PERFORM set_config('energyos.central_support_reply','on',true);
 PERFORM public.save_platform_support_case(a,i,coalesce(c.revision,0),jsonb_build_object('title',r.title,'organizationId',r.organization_id,'assigneeId',coalesce(nullif(b->>'assigneeId',''),c.assignee_id::text),'priority',coalesce(b->>'priority',c.priority,r.triage_priority),'deadline',dl,'status',coalesce(c.status,'OPEN'),'reason',why),NULL,NULL);
 PERFORM set_config('energyos.central_support_reply','off',true);
 END IF;
 UPDATE public.central_support_requests SET promised_deadline=dl,triage_priority=coalesce(b->>'priority',triage_priority),managing_admin_id=a WHERE id=i;
 ELSE
 IF b?'assigneeId' OR b?'deadline' OR b?'priority' THEN RAISE EXCEPTION 'SC_DENIED' USING ERRCODE='42501';END IF;
 END IF;
 ELSE
 IF x NOT IN('UPDATE','CONTEST','CONFIRM') THEN RAISE EXCEPTION 'SC_ACTION' USING ERRCODE='22023';END IF;
 IF x='CONTEST' THEN IF s<>'RESOLVED' THEN RAISE EXCEPTION 'SC_TRANSITION' USING ERRCODE='22023';END IF;wanted:='IN_PROGRESS';
 ELSIF x='CONFIRM' THEN IF s<>'RESOLVED' THEN RAISE EXCEPTION 'SC_TRANSITION' USING ERRCODE='22023';END IF;wanted:='CLOSED';
 ELSIF s='WAITING' THEN wanted:='IN_PROGRESS';END IF;
 END IF;
 msg:=gen_random_uuid();
 INSERT INTO public.central_support_messages(id,request_id,organization_id,command_id,fingerprint,actor_id,actor_name,actor_scope,kind,body,status)
 VALUES(msg,i,r.organization_id,cmd,fp,a,coalesce(public.platform_workflow_name(a),'Usuário autorizado'),CASE WHEN p THEN 'PLATFORM' ELSE 'ORGANIZATION' END,CASE x WHEN 'RESOLVE' THEN 'SOLUTION' WHEN 'CONFIRM' THEN 'CLOSE' ELSE x END,why,wanted);
 IF x='CONTEST' THEN UPDATE public.central_support_requests SET resolution_id=NULL,resolved_at=NULL,resolution_notice_id=NULL,close_due_at=NULL WHERE id=i;END IF;
 IF x='CONFIRM' THEN UPDATE public.central_support_requests SET closed_at=now(),closed_by=a,closure_kind='ORGANIZATION_CONFIRMED' WHERE id=i;END IF;
 PERFORM public.central_support_thread_state(i,wanted,a,CASE WHEN p THEN 'PLATFORM' ELSE 'ORGANIZATION' END,why);
 UPDATE public.central_support_requests SET public_reply=CASE WHEN p THEN why ELSE public_reply END,reply_revision=reply_revision+1,updated_at=now() WHERE id=i;
 IF p OR x='CONFIRM' THEN
 PERFORM public.central_support_notice(i,i::text||':thread:'||cmd::text);
 SELECT id INTO nt FROM public.central_support_outbox WHERE event_key=i::text||':thread:'||cmd::text;
 -- The message is immutable. Link by command event in the reader; no UPDATE of it.
 UPDATE public.central_support_outbox SET payload=payload||jsonb_build_object('ticketPath','/backoffice/support/'||i::text,'confirmationHours',CASE WHEN x='RESOLVE' THEN 24 END,'resolutionId',CASE WHEN x='RESOLVE' THEN msg END) WHERE id=nt;
 END IF;
 IF x='RESOLVE' THEN UPDATE public.central_support_requests SET resolution_id=msg,resolved_at=now(),resolution_notice_id=nt,close_due_at=NULL WHERE id=i;END IF;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status)
 VALUES(gen_random_uuid()::text,r.organization_id,a,'UPDATE','central_support',i::text,jsonb_build_object('action',x,'messageId',msg,'beforeStatus',s,'status',wanted,'revision',r.reply_revision+1,'beforeDeadline',coalesce(c.deadline,r.promised_deadline),'deadline',coalesce(nullif(b->>'deadline',''),c.deadline::text,r.promised_deadline::text),'beforePriority',coalesce(c.priority,r.triage_priority),'priority',coalesce(b->>'priority',c.priority,r.triage_priority),'beforeAssigneeId',c.assignee_id,'assigneeId',coalesce(nullif(b->>'assigneeId','')::uuid,c.assignee_id)),'success');
 RETURN jsonb_build_object('recorded',true,'messageId',msg,'status',wanted,'revision',r.reply_revision+1);
END$$;

CREATE FUNCTION public.central_support_close_due(p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.central_support_requests;n public.central_support_outbox;s text;due timestamptz;closed integer:=0;armed integer:=0;msg uuid;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'SC_INPUT' USING ERRCODE='22023';END IF;
 FOR r IN SELECT q.* FROM public.central_support_requests q WHERE q.state='SUBMITTED' AND q.resolution_id IS NOT NULL AND q.closed_at IS NULL
 AND(q.close_due_at<=now() OR q.close_due_at IS NULL AND EXISTS(SELECT 1 FROM public.central_support_outbox z WHERE z.id=q.resolution_notice_id AND z.state='ACCEPTED' AND z.accepted_at IS NOT NULL))
 ORDER BY q.resolved_at,q.id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
 SELECT * INTO n FROM public.central_support_outbox WHERE id=r.resolution_notice_id AND request_id=r.id AND state='ACCEPTED' AND accepted_at IS NOT NULL;
 SELECT coalesce((SELECT status FROM public.platform_support_cases WHERE id=r.id),r.triage_status) INTO s;
 IF n.id IS NULL OR n.payload->>'status'<>'RESOLVED' OR n.payload->>'resolutionId' IS DISTINCT FROM r.resolution_id::text OR s<>'RESOLVED' THEN CONTINUE;END IF;
 due:=greatest(r.resolved_at,n.created_at,n.accepted_at)+interval '24 hours';
 IF r.close_due_at IS NULL THEN UPDATE public.central_support_requests SET close_due_at=due,updated_at=now() WHERE id=r.id;armed:=armed+1;END IF;
 IF due>now() THEN CONTINUE;END IF;
 msg:=gen_random_uuid();
 INSERT INTO public.central_support_messages(id,request_id,organization_id,command_id,fingerprint,actor_name,actor_scope,kind,body,status)
 VALUES(msg,r.id,r.organization_id,msg,'SYSTEM_24H:'||r.resolution_id::text,'Encerramento automático','SYSTEM','CLOSE','Encerrado após 24 horas do aviso de resolução, sem contestação. Para outra solicitação, abra um novo chamado.','CLOSED');
 UPDATE public.central_support_requests SET closed_at=now(),closure_kind='SYSTEM_24H',reply_revision=reply_revision+1,close_due_at=due WHERE id=r.id;
 PERFORM public.central_support_thread_state(r.id,'CLOSED',NULL,'SYSTEM','24h após aviso de resolução sem contestação');
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status) VALUES(gen_random_uuid()::text,r.organization_id,NULL,'UPDATE','central_support',r.id::text,jsonb_build_object('action','SYSTEM_AUTOCLOSE','resolutionId',r.resolution_id,'dueAt',due,'messageId',msg),'success');
 PERFORM public.central_support_notice(r.id,r.id::text||':closed:'||r.resolution_id::text);closed:=closed+1;
 END LOOP;RETURN jsonb_build_object('armed',armed,'closed',closed);
END$$;

CREATE FUNCTION public.central_support_files(o text,a uuid,p boolean,x text,i uuid,b jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.central_support_requests;f public.central_support_attachments;profile text;s text;
BEGIN
 SELECT * INTO r FROM public.central_support_requests WHERE id=i FOR UPDATE;profile:=public.central_support_thread_actor(o,a,p,i);
 s:=coalesce((SELECT status FROM public.platform_support_cases WHERE id=i),r.triage_status);
 IF x='path' THEN
 SELECT * INTO f FROM public.central_support_attachments WHERE id=(b->>'id')::uuid AND request_id=i AND state='AVAILABLE';
 IF f.id IS NULL THEN RAISE EXCEPTION 'SC_FILE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status) VALUES(gen_random_uuid()::text,r.organization_id,a,'READ','central_support_attachment',f.id::text,jsonb_build_object('action','DOWNLOAD_REQUEST','requestId',i),'success');
 RETURN jsonb_build_object('id',f.id,'path',f.path,'filename',f.filename,'sha256',f.sha256,'bytes',f.bytes);
 END IF;
 IF r.closed_at IS NOT NULL OR s='CLOSED' THEN RAISE EXCEPTION 'SC_CLOSED_NEW_TICKET' USING ERRCODE='22023';END IF;
 IF x='reserve' THEN
 IF length(coalesce(b->>'filename','')) NOT BETWEEN 1 AND 200 OR b->>'mime' NOT IN('application/pdf','image/png','image/jpeg') OR (b->>'bytes')::integer NOT BETWEEN 1 AND 5242880 OR coalesce(b->>'sha256','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'SC_FILE_INPUT' USING ERRCODE='22023';END IF;
 SELECT * INTO f FROM public.central_support_attachments WHERE request_id=i AND sha256=b->>'sha256';
 IF f.id IS NOT NULL AND f.state<>'REMOVED' THEN RETURN jsonb_build_object('id',f.id,'path',f.path,'state',f.state);END IF;
 IF (SELECT count(*) FROM public.central_support_attachments WHERE request_id=i AND state<>'REMOVED')>=5 THEN RAISE EXCEPTION 'SC_FILE_LIMIT' USING ERRCODE='22023';END IF;
 IF f.id IS NOT NULL THEN UPDATE public.central_support_attachments SET state='RESERVED',actor_id=a WHERE id=f.id RETURNING * INTO f;
 ELSE INSERT INTO public.central_support_attachments(request_id,organization_id,actor_id,filename,mime,bytes,sha256,path)
 VALUES(i,r.organization_id,a,b->>'filename',b->>'mime',(b->>'bytes')::integer,b->>'sha256',r.organization_id||'/'||i::text||'/'||gen_random_uuid()::text) RETURNING * INTO f;END IF;
 ELSIF x='finish' THEN
 UPDATE public.central_support_attachments SET state='AVAILABLE',available_at=now() WHERE id=(b->>'id')::uuid AND request_id=i AND state='RESERVED' AND sha256=b->>'sha256' RETURNING * INTO f;
 IF f.id IS NULL THEN SELECT * INTO f FROM public.central_support_attachments WHERE id=(b->>'id')::uuid AND request_id=i AND state='AVAILABLE' AND sha256=b->>'sha256';END IF;
 IF f.id IS NULL THEN RAISE EXCEPTION 'SC_FILE_UNAVAILABLE' USING ERRCODE='40001';END IF;
 ELSIF x='discard' THEN
 IF p OR r.state='SUBMITTED' THEN RAISE EXCEPTION 'SC_FILE_PRESERVED' USING ERRCODE='22023';END IF;
 UPDATE public.central_support_attachments SET state='REMOVED' WHERE id=(b->>'id')::uuid AND request_id=i AND state<>'REMOVED' RETURNING * INTO f;
 IF f.id IS NULL THEN RAISE EXCEPTION 'SC_FILE_UNAVAILABLE' USING ERRCODE='40001';END IF;
 ELSE RAISE EXCEPTION 'SC_ACTION' USING ERRCODE='22023';END IF;
 IF r.state='AUTHORIZED' THEN UPDATE public.central_support_requests SET state='DRAFT',code_hash=NULL,code_expires=NULL,revision=revision+1,updated_at=now() WHERE id=i;END IF;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status) VALUES(gen_random_uuid()::text,r.organization_id,a,'UPDATE','central_support_attachment',f.id::text,jsonb_build_object('action',x,'requestId',i,'sha256',f.sha256,'bytes',f.bytes),'success');
 RETURN jsonb_build_object('id',f.id,'path',f.path,'state',f.state,'name',f.filename,'bytes',f.bytes);
END$$;

-- Preserve old endpoints while enforcing the new Central Support lifecycle.
ALTER FUNCTION public.central_support_platform(uuid,text,uuid,jsonb) RENAME TO central_support_platform_before_threads;
CREATE FUNCTION public.central_support_platform(a uuid,x text,i uuid DEFAULT NULL,b jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE action text;s text;outcome jsonb;
BEGIN
 IF x NOT IN('triage','reply') THEN
 outcome:=public.central_support_platform_before_threads(a,x,i,b);
 IF x='list' THEN SELECT outcome||jsonb_build_object('rows',coalesce(jsonb_agg(row||jsonb_build_object('hasOrganizationReply',EXISTS(SELECT 1 FROM public.central_support_messages m WHERE m.request_id=(row->>'id')::uuid AND m.actor_scope='ORGANIZATION' AND m.created_at>coalesce((SELECT max(z.created_at) FROM public.central_support_messages z WHERE z.request_id=m.request_id AND z.actor_scope='PLATFORM'),'-infinity'::timestamptz)))),'[]')) INTO outcome FROM jsonb_array_elements(outcome->'rows')row;END IF;RETURN outcome;
 END IF;
 s:=coalesce((SELECT status FROM public.platform_support_cases WHERE id=i),(SELECT triage_status FROM public.central_support_requests WHERE id=i));
 IF x='reply' THEN action:='UPDATE';
 ELSIF b->>'status'='CLOSED' THEN RAISE EXCEPTION 'SC_CONFIRM_REQUIRED' USING ERRCODE='22023';
 ELSIF b->>'status'=s OR b->>'status'='OPEN' AND s='OPEN' THEN action:='TRIAGE';
 ELSIF b->>'status'='IN_PROGRESS' THEN action:='START';ELSIF b->>'status'='WAITING' THEN action:='WAIT';ELSIF b->>'status'='RESOLVED' THEN action:='RESOLVE';
 ELSE RAISE EXCEPTION 'SC_TRANSITION' USING ERRCODE='22023';END IF;
 RETURN public.central_support_thread(NULL,a,true,action,i,(b-'replyRevision'-'reason'-'status')||jsonb_build_object('commandId',gen_random_uuid(),'revision',b->'replyRevision','text',b->>'reason'));
END$$;
ALTER FUNCTION public.central_support_action(text,uuid,text,uuid,jsonb) RENAME TO central_support_action_before_threads;
CREATE FUNCTION public.central_support_action(o text,a uuid,x text,i uuid DEFAULT NULL,b jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;ids jsonb;
BEGIN
 IF x IN('authorize','submit') THEN
 PERFORM public.central_support_actor(o,a,x='authorize');
 PERFORM 1 FROM public.central_support_requests WHERE id=i AND organization_id=o FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.central_support_attachments WHERE request_id=i AND state='RESERVED') THEN RAISE EXCEPTION 'SC_FILE_PENDING' USING ERRCODE='22023';END IF;
 END IF;
 result:=public.central_support_action_before_threads(o,a,x,i,b);
 IF x='submit' AND result->>'submitted'='true' THEN
 SELECT coalesce(jsonb_agg(f.id ORDER BY f.id),'[]') INTO ids FROM public.central_support_attachments f JOIN public.central_support_requests r ON r.id=f.request_id WHERE r.id=i AND f.state='AVAILABLE' AND f.available_at<=r.authorized_at;
 UPDATE public.central_support_requests SET consent=consent||jsonb_build_object('attachmentIds',ids) WHERE id=i AND organization_id=o;
 END IF;RETURN result;
END$$;
-- Link org notifications to their authorized, dedicated ticket page.
DO $$DECLARE body text;BEGIN body:=pg_get_functiondef('public.central_support_notifications(text,uuid,text)'::regprocedure);
 IF strpos(body,'''href'',''/backoffice/support''')=0 THEN RAISE EXCEPTION 'Support notification gateway changed';END IF;
 EXECUTE replace(body,'''href'',''/backoffice/support''','''href'',''/backoffice/support/''||n.request_id::text');END$$;

DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('central_support_system_case_event','central_support_thread_immutable','central_support_thread_actor','central_support_thread_state','central_support_case_closure_guard','central_support_thread','central_support_close_due','central_support_files','central_support_platform_before_threads','central_support_action_before_threads','central_support_platform','central_support_action') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION public.central_support_thread(text,uuid,boolean,text,uuid,jsonb),public.central_support_close_due(integer),public.central_support_files(text,uuid,boolean,text,uuid,jsonb),public.central_support_platform(uuid,text,uuid,jsonb),public.central_support_action(text,uuid,text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
