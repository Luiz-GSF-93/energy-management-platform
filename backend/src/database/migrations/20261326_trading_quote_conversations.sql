BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $install$ BEGIN
 IF to_regprocedure('public.trading_quote_exchange(text,text,text,text,jsonb)') IS NOT NULL THEN
  IF obj_description(to_regprocedure('public.trading_quote_exchange(text,text,text,text,jsonb)'),'pg_proc') IS DISTINCT FROM 'trading:20261326:v1' THEN RAISE EXCEPTION 'Review existing quotation conversations';END IF;RETURN;
 END IF;
 EXECUTE $schema$
CREATE TABLE public.trading_quote_threads(
 invitation_id uuid PRIMARY KEY REFERENCES public.trading_invitations(id),organization_id text NOT NULL,urgency integer NOT NULL DEFAULT 1 CHECK(urgency BETWEEN 1 AND 3),
 status text NOT NULL DEFAULT 'WAITING_BACKOFFICE' CHECK(status IN('WAITING_BACKOFFICE','WAITING_SUPPLIER','RESOLVED','EXPIRED')),revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX trading_quote_threads_inbox ON public.trading_quote_threads(organization_id,status,urgency DESC,updated_at);
CREATE TABLE public.trading_quote_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,invitation_id uuid NOT NULL REFERENCES public.trading_quote_threads(invitation_id),request_id uuid NOT NULL,
 author_type text NOT NULL CHECK(author_type IN('BACKOFFICE','SUPPLIER')),author_identity text NOT NULL,body text NOT NULL CHECK(length(btrim(body)) BETWEEN 3 AND 2000),
 urgency integer NOT NULL CHECK(urgency BETWEEN 1 AND 3),status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,request_id));
CREATE INDEX trading_quote_messages_thread ON public.trading_quote_messages(organization_id,invitation_id,created_at DESC);
CREATE TRIGGER trading_quote_messages_immutable BEFORE UPDATE OR DELETE ON public.trading_quote_messages FOR EACH ROW EXECUTE FUNCTION public.preserve_trading_history();
CREATE TABLE public.trading_quote_selections(
 organization_id text NOT NULL,opportunity_id uuid NOT NULL REFERENCES public.trading_records(id),proposal_id uuid NOT NULL REFERENCES public.trading_records(id),proposal_revision integer NOT NULL,
 actor_id text NOT NULL,request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,opportunity_id));
CREATE TRIGGER trading_quote_selections_immutable BEFORE UPDATE OR DELETE ON public.trading_quote_selections FOR EACH ROW EXECUTE FUNCTION public.preserve_trading_history();
CREATE TABLE public.trading_quote_mail_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,opportunity_id uuid NOT NULL REFERENCES public.trading_records(id),invitation_id uuid NOT NULL REFERENCES public.trading_invitations(id),
 actor_id text NOT NULL,request_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('UPDATE','THANKS')),email text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','CLAIMED','SENDING','ACCEPTED','FAILED','UNKNOWN','CANCELLED')),
 lease_id uuid,lease_until timestamptz,token_hash text,cost_micro_usd bigint NOT NULL DEFAULT 0 CHECK(cost_micro_usd>=0),started_at timestamptz,finished_at timestamptz,provider_id text,diagnostic text,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(invitation_id,kind,request_id));
CREATE UNIQUE INDEX trading_quote_thanks_once ON public.trading_quote_mail_outbox(organization_id,opportunity_id,lower(email)) WHERE kind='THANKS';
CREATE INDEX trading_quote_mail_pending ON public.trading_quote_mail_outbox(created_at,id) WHERE state IN('PENDING','CLAIMED','SENDING');
CREATE TABLE public.trading_quote_access(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),invitation_id uuid NOT NULL REFERENCES public.trading_invitations(id),organization_id text NOT NULL,token_hash text NOT NULL UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,otp_hash text,otp_expires_at timestamptz,otp_sent_at timestamptz,otp_day date,otp_count integer NOT NULL DEFAULT 0,otp_attempts integer NOT NULL DEFAULT 0,
 session_hash text UNIQUE,session_expires_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
DO $tables$ DECLARE r text;BEGIN FOREACH r IN ARRAY ARRAY['trading_quote_threads','trading_quote_messages','trading_quote_selections','trading_quote_mail_outbox','trading_quote_access'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',r);
END LOOP;END $tables$;

CREATE FUNCTION public.trading_quote_contact(p_id uuid) RETURNS public.trading_invitations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.trading_invitations;
BEGIN
 SELECT * INTO i FROM public.trading_invitations WHERE id=p_id AND kind='SUPPLIER';
 IF i.id IS NULL OR i.state NOT IN('PENDING','RESPONDED') OR i.expires_at<=now() OR NOT public.trading_quote_is_live(i.organization_id,i.opportunity_id)
 OR NOT EXISTS(SELECT 1 FROM public.trading_records s WHERE s.organization_id=i.organization_id AND s.id=i.supplier_id AND s.kind='supplier' AND s.status='ACTIVE' AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.data->'quotationContacts') c WHERE lower(c->>'email')=lower(i.email))) THEN RAISE EXCEPTION 'Quotation contact unavailable' USING ERRCODE='42501';END IF;RETURN i;
END$$;
CREATE FUNCTION public.trading_quote_session(p_hash text) RETURNS public.trading_invitations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE id uuid;
BEGIN
 IF p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='42501';END IF;
 SELECT invitation_id INTO id FROM public.trading_quote_access WHERE session_hash=p_hash AND session_expires_at>now() AND expires_at>now() AND revoked_at IS NULL;
 IF id IS NULL THEN SELECT i.id INTO id FROM public.trading_invitations i WHERE i.session_hash=p_hash AND i.session_expires_at>now() AND i.expires_at>now() AND i.kind='SUPPLIER';END IF;
 RETURN public.trading_quote_contact(id);
END$$;
CREATE FUNCTION public.trading_quote_access_auth(p_token text,p_action text,p_otp text,p_session text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.trading_quote_access;i public.trading_invitations;
BEGIN
 IF p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' OR p_otp IS NULL OR p_otp!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM public.trading_quote_access WHERE token_hash=p_token FOR UPDATE;
 IF a.id IS NULL OR a.expires_at<=now() OR a.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Access expired' USING ERRCODE='42501';END IF;i:=public.trading_quote_contact(a.invitation_id);
 IF p_action='CHALLENGE' THEN
  IF a.otp_sent_at>now()-interval '60 seconds' OR(a.otp_day=CURRENT_DATE AND a.otp_count>=10) THEN RETURN jsonb_build_object('allowed',false);END IF;
  UPDATE public.trading_quote_access SET otp_day=CURRENT_DATE,otp_count=CASE WHEN otp_day=CURRENT_DATE THEN otp_count+1 ELSE 1 END,otp_hash=p_otp,otp_expires_at=least(expires_at,now()+interval '10 minutes'),otp_sent_at=now(),otp_attempts=0 WHERE id=a.id;
  RETURN jsonb_build_object('allowed',true,'id',a.id,'email',i.email);
 ELSIF p_action='VERIFY' THEN
  IF a.otp_hash IS NULL OR a.otp_expires_at<=now() OR a.otp_attempts>=5 THEN RETURN jsonb_build_object('allowed',false);END IF;
  UPDATE public.trading_quote_access SET otp_attempts=otp_attempts+1 WHERE id=a.id;
  IF a.otp_hash<>p_otp THEN RETURN jsonb_build_object('allowed',false);END IF;
  IF p_session IS NULL OR p_session!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Session invalid' USING ERRCODE='22023';END IF;
  UPDATE public.trading_quote_access SET session_hash=p_session,session_expires_at=least(expires_at,now()+interval '1 hour'),otp_hash=NULL WHERE id=a.id;
  RETURN jsonb_build_object('allowed',true);
 END IF;RAISE EXCEPTION 'Unknown verification action' USING ERRCODE='22023';
END$$;

CREATE FUNCTION public.trading_quote_thanks_context(p_org text,p_proposal uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.trading_records;o public.trading_records;recipients jsonb;
BEGIN
 SELECT * INTO p FROM public.trading_records WHERE organization_id=p_org AND id=p_proposal AND kind='proposal';
 SELECT * INTO o FROM public.trading_records WHERE organization_id=p_org AND id=p.parent_id AND kind='opportunity';
 IF p.id IS NULL OR NOT public.trading_quote_is_live(p_org,o.id) OR (p.status NOT IN('MANAGER_APPROVED','CLIENT_APPROVED','CONTRACTED') AND NOT EXISTS(SELECT 1 FROM public.trading_approval_workflows w WHERE w.organization_id=p_org AND w.proposal_id=p.id AND w.proposal_revision=p.revision AND w.proposal_data=p.data AND w.state IN('INTERNAL_APPROVED','CLIENT_PENDING','CLIENT_APPROVED','SUPPLIER_PENDING','FORMALIZING','COMPLETED'))) THEN RAISE EXCEPTION 'Approved proposal required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'email'),'[]') INTO recipients FROM(
  SELECT DISTINCT ON(lower(i.email)) jsonb_build_object('invitationId',i.id,'email',lower(i.email),'supplier',s.data->>'tradeName') x FROM public.trading_invitations i JOIN public.trading_records s ON s.organization_id=i.organization_id AND s.id=i.supplier_id AND s.kind='supplier' AND s.status='ACTIVE'
  WHERE i.organization_id=p_org AND i.opportunity_id=o.id AND i.kind='SUPPLIER' AND i.state='RESPONDED' AND i.expires_at>now() AND i.supplier_id::text<>p.data->>'supplierId'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.data->'quotationContacts') c WHERE lower(c->>'email')=lower(i.email))
  AND NOT EXISTS(SELECT 1 FROM public.trading_records winner WHERE winner.organization_id=p_org AND winner.parent_id=o.id AND winner.kind='proposal' AND winner.data->>'supplierId'=i.supplier_id::text AND winner.status IN('MANAGER_APPROVED','CLIENT_APPROVED','CONTRACTED'))
  AND NOT EXISTS(SELECT 1 FROM public.trading_approval_workflows approved WHERE approved.organization_id=p_org AND approved.opportunity_id=o.id AND approved.supplier_id=i.supplier_id AND approved.state IN('INTERNAL_APPROVED','CLIENT_PENDING','CLIENT_APPROVED','SUPPLIER_PENDING','FORMALIZING','COMPLETED'))
  AND NOT EXISTS(SELECT 1 FROM public.trading_invitations chosen WHERE chosen.organization_id=p_org AND chosen.opportunity_id=o.id AND chosen.supplier_id::text=p.data->>'supplierId' AND lower(chosen.email)=lower(i.email))
  ORDER BY lower(i.email),i.id
 ) r;
 IF jsonb_array_length(recipients)>50 THEN RAISE EXCEPTION 'Recipient list too large' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('proposalId',p.id,'opportunityId',o.id,'title',o.data->>'title','recipients',recipients,'fingerprint',md5(p.id::text||':'||p.revision||':'||o.revision||':'||recipients::text));
END$$;

CREATE FUNCTION public.trading_quote_exchange(p_org text,p_actor text,p_session text,p_action text,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.trading_invitations;m public.trading_quote_messages;old public.trading_quote_messages;office boolean;body text;urgency integer;state text;req uuid;rows jsonb;context jsonb;r jsonb;selection public.trading_quote_selections;proposal public.trading_records;total integer;page integer;queued integer=0;
BEGIN
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>12000 THEN RAISE EXCEPTION 'Invalid conversation body' USING ERRCODE='22023';END IF;
 office:=p_action IN('BACKOFFICE_LIST','TASKS','BACKOFFICE_MESSAGE','THANKS_PREVIEW','THANKS_SEND');
 IF office THEN
  IF p_session IS NOT NULL THEN RAISE EXCEPTION 'Mixed authorization context' USING ERRCODE='42501';END IF;
  PERFORM public.assert_trading_actor(p_org,p_actor,p_action IN('BACKOFFICE_MESSAGE','THANKS_SEND'));
 ELSIF p_action IN('SUPPLIER_LIST','SUPPLIER_MESSAGE') THEN
  IF p_org IS NOT NULL OR p_actor IS NOT NULL THEN RAISE EXCEPTION 'Mixed authorization context' USING ERRCODE='42501';END IF;i:=public.trading_quote_session(p_session);p_org:=i.organization_id;
 ELSE RAISE EXCEPTION 'Conversation action unavailable' USING ERRCODE='22023';END IF;
 IF p_action='TASKS' THEN
  RETURN jsonb_build_object('organizationId',p_org,'count',(SELECT count(*) FROM public.trading_quote_threads t JOIN public.trading_invitations iv ON iv.id=t.invitation_id AND iv.organization_id=t.organization_id WHERE t.organization_id=p_org AND t.status='WAITING_BACKOFFICE' AND iv.expires_at>now() AND iv.state IN('PENDING','RESPONDED') AND public.trading_quote_is_live(p_org,iv.opportunity_id)),
  'urgent',(SELECT count(*) FROM public.trading_quote_threads t JOIN public.trading_invitations iv ON iv.id=t.invitation_id AND iv.organization_id=t.organization_id WHERE t.organization_id=p_org AND t.status='WAITING_BACKOFFICE' AND t.urgency=3 AND iv.expires_at>now() AND iv.state IN('PENDING','RESPONDED') AND public.trading_quote_is_live(p_org,iv.opportunity_id)));
 ELSIF p_action IN('BACKOFFICE_LIST','SUPPLIER_LIST') THEN
  page:=coalesce((p_body->>'page')::integer,0);IF page NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO total FROM public.trading_invitations n WHERE n.organization_id=p_org AND n.kind='SUPPLIER' AND(office OR n.id=i.id);
  SELECT coalesce(jsonb_agg(filtered.item ORDER BY filtered.urgency DESC,filtered.updated_at),'[]') INTO rows FROM(
   SELECT coalesce(t.urgency,1) urgency,coalesce(t.updated_at,n.created_at) updated_at,jsonb_build_object('id',n.id,'opportunityId',n.opportunity_id,'title',o.data->>'title','supplier',s.data->>'tradeName','email',n.email,'expiresAt',least(n.expires_at,(o.data->>'expiresAt')::timestamptz),
    'urgency',coalesce(t.urgency,1),'revision',coalesce(t.revision,0),'status',CASE WHEN NOT public.trading_quote_is_live(p_org,o.id) OR n.expires_at<=now() OR n.state NOT IN('PENDING','RESPONDED') THEN 'EXPIRED' ELSE coalesce(t.status,'NO_MESSAGES') END,
    'messages',(SELECT coalesce(jsonb_agg(message ORDER BY created_at),'[]') FROM(SELECT q.created_at,jsonb_build_object('id',q.id,'author',q.author_type,'text',q.body,'urgency',q.urgency,'at',q.created_at,'status',q.status) message FROM public.trading_quote_messages q WHERE q.organization_id=p_org AND q.invitation_id=n.id ORDER BY q.created_at DESC,q.id DESC LIMIT 30) mm),
    'deliveries',CASE WHEN office THEN(SELECT coalesce(jsonb_agg(jsonb_build_object('state',d.state,'kind',d.kind,'at',d.created_at,'diagnostic',d.diagnostic) ORDER BY d.created_at DESC),'[]') FROM(SELECT * FROM public.trading_quote_mail_outbox WHERE organization_id=p_org AND invitation_id=n.id ORDER BY created_at DESC LIMIT 10)d) ELSE '[]'::jsonb END) item
   FROM public.trading_invitations n JOIN public.trading_records o ON o.organization_id=n.organization_id AND o.id=n.opportunity_id JOIN public.trading_records s ON s.organization_id=n.organization_id AND s.id=n.supplier_id LEFT JOIN public.trading_quote_threads t ON t.invitation_id=n.id AND t.organization_id=n.organization_id
   WHERE n.organization_id=p_org AND n.kind='SUPPLIER' AND(office OR n.id=i.id) ORDER BY coalesce(t.urgency,1) DESC,coalesce(t.updated_at,n.created_at) LIMIT 20 OFFSET page*20
  ) filtered;
  RETURN jsonb_build_object('organizationId',p_org,'rows',rows,'total',total,'page',page,'pageSize',20);
 ELSIF p_action IN('THANKS_PREVIEW','THANKS_SEND') THEN
  SELECT * INTO proposal FROM public.trading_records WHERE organization_id=p_org AND id=(p_body->>'proposalId')::uuid AND kind='proposal';
  PERFORM 1 FROM public.trading_records WHERE organization_id=p_org AND id=proposal.parent_id FOR UPDATE;
  context:=public.trading_quote_thanks_context(p_org,proposal.id);
  IF p_action='THANKS_PREVIEW' THEN RETURN context;END IF;
  IF p_body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR p_body->>'fingerprint' IS DISTINCT FROM context->>'fingerprint' THEN RAISE EXCEPTION 'Recipients or source changed' USING ERRCODE='PT409';END IF;req:=(p_body->>'requestId')::uuid;
  SELECT * INTO selection FROM public.trading_quote_selections WHERE organization_id=p_org AND opportunity_id=proposal.parent_id;
  IF selection.opportunity_id IS NOT NULL THEN
   IF selection.proposal_id<>proposal.id OR selection.proposal_revision<>proposal.revision THEN RAISE EXCEPTION 'Another selection already confirmed' USING ERRCODE='PT409';END IF;
   RETURN jsonb_build_object('queued',0,'replayed',true,'requestId',selection.request_id);
  END IF;
  IF req IS NULL THEN RAISE EXCEPTION 'Request identifier required' USING ERRCODE='22023';END IF;
  INSERT INTO public.trading_quote_selections(organization_id,opportunity_id,proposal_id,proposal_revision,actor_id,request_id) VALUES(p_org,proposal.parent_id,proposal.id,proposal.revision,p_actor,req);
  FOR r IN SELECT value FROM jsonb_array_elements(context->'recipients') LOOP
   INSERT INTO public.trading_quote_mail_outbox(organization_id,opportunity_id,invitation_id,actor_id,request_id,kind,email) VALUES(p_org,proposal.parent_id,(r->>'invitationId')::uuid,p_actor,req,'THANKS',r->>'email');queued:=queued+1;
  END LOOP;RETURN jsonb_build_object('queued',queued,'requestId',req);
 END IF;
 IF office THEN
  SELECT * INTO i FROM public.trading_invitations WHERE id=(p_body->>'invitationId')::uuid AND organization_id=p_org FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Invitation outside organization' USING ERRCODE='42501';END IF;i:=public.trading_quote_contact(i.id);
 END IF;
 req:=(p_body->>'requestId')::uuid;body:=btrim(p_body->>'text');urgency:=(p_body->>'urgency')::integer;state:=CASE WHEN office THEN p_body->>'status' ELSE 'WAITING_BACKOFFICE' END;
 IF req IS NULL OR coalesce(length(body),0) NOT BETWEEN 3 AND 2000 OR urgency IS NULL OR urgency NOT BETWEEN 1 AND 3 OR state IS NULL OR state NOT IN('WAITING_SUPPLIER','WAITING_BACKOFFICE','RESOLVED') THEN RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('trading-conversation:'||i.id::text,0));
 SELECT * INTO old FROM public.trading_quote_messages WHERE organization_id=p_org AND request_id=req;
 IF old.id IS NOT NULL THEN
  IF old.invitation_id<>i.id OR old.author_type<>(CASE WHEN office THEN 'BACKOFFICE' ELSE 'SUPPLIER' END) OR old.author_identity<>coalesce(p_actor,i.email) OR old.body<>body OR old.urgency<>urgency OR old.status<>state THEN RAISE EXCEPTION 'Changed message request' USING ERRCODE='PT409';END IF;
  RETURN jsonb_build_object('id',old.id,'recorded',true,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.trading_quote_messages WHERE organization_id=p_org AND invitation_id=i.id AND author_identity=coalesce(p_actor,i.email) AND created_at>now()-interval '10 seconds') OR(SELECT count(*) FROM public.trading_quote_messages WHERE organization_id=p_org AND invitation_id=i.id AND created_at>=date_trunc('day',now()))>=50 THEN RAISE EXCEPTION 'Conversation rate limit' USING ERRCODE='22023';END IF;
 INSERT INTO public.trading_quote_threads(invitation_id,organization_id,urgency,status) VALUES(i.id,p_org,urgency,state) ON CONFLICT(invitation_id) DO UPDATE SET urgency=excluded.urgency,status=excluded.status,revision=trading_quote_threads.revision+1,updated_at=clock_timestamp();
 INSERT INTO public.trading_quote_messages(organization_id,invitation_id,request_id,author_type,author_identity,body,urgency,status) VALUES(p_org,i.id,req,CASE WHEN office THEN 'BACKOFFICE' ELSE 'SUPPLIER' END,coalesce(p_actor,i.email),body,urgency,state) RETURNING * INTO m;
 IF office THEN INSERT INTO public.trading_quote_mail_outbox(organization_id,opportunity_id,invitation_id,actor_id,request_id,kind,email) VALUES(p_org,i.opportunity_id,i.id,p_actor,req,'UPDATE',i.email);END IF;
 RETURN jsonb_build_object('id',m.id,'recorded',true,'mail',CASE WHEN office THEN 'PENDING' ELSE 'INAPP' END);
END$$;

CREATE FUNCTION public.trading_quote_mail(p_action text,p_id uuid,p_lease uuid,p_token text,p_daily integer,p_budget bigint,p_costs jsonb,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.trading_quote_mail_outbox;i public.trading_invitations;cost bigint;daily bigint;spent bigint;chosen public.trading_quote_selections;
BEGIN
 IF p_action='CLAIM' THEN
  IF p_daily IS NULL OR p_daily NOT BETWEEN 1 AND 100 OR p_budget IS NULL OR p_budget NOT BETWEEN 1 AND 1000000000 OR coalesce(p_costs->>'EMAIL','')!~'^[0-9]{1,9}$' OR p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' THEN RETURN NULL;END IF;cost:=(p_costs->>'EMAIL')::bigint;IF cost<=0 THEN RETURN NULL;END IF;
  UPDATE public.trading_quote_mail_outbox SET state=CASE WHEN state='SENDING' THEN 'UNKNOWN' ELSE 'PENDING' END,diagnostic=CASE WHEN state='SENDING' THEN 'SENDING_INTERRUPTED_INSPECT_PROVIDER' ELSE NULL END,lease_id=NULL,lease_until=NULL WHERE state IN('CLAIMED','SENDING') AND lease_until<=now();
  SELECT * INTO d FROM public.trading_quote_mail_outbox WHERE state='PENDING' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;IF d.id IS NULL THEN RETURN NULL;END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-notice-budget:'||d.organization_id,0));
  SELECT count(*) INTO daily FROM public.trading_quote_mail_outbox WHERE organization_id=d.organization_id AND state IN('CLAIMED','SENDING','ACCEPTED','UNKNOWN') AND created_at>=date_trunc('day',now());
  SELECT coalesce(sum(cost_micro_usd),0) INTO spent FROM public.trading_quote_mail_outbox WHERE organization_id=d.organization_id AND state IN('CLAIMED','SENDING','ACCEPTED','UNKNOWN') AND created_at>=date_trunc('month',now());
  daily:=public.trading_delivery_usage(d.organization_id,'DAY')+(SELECT count(*) FROM public.portal_notification_deliveries WHERE organization_id=d.organization_id AND sequence=1 AND created_at>=date_trunc('day',now()));
  spent:=public.trading_delivery_usage(d.organization_id,'MONTH')+(SELECT coalesce(sum(cost_micro_usd),0) FROM public.portal_notification_deliveries WHERE organization_id=d.organization_id AND created_at>=date_trunc('month',now()));
  IF daily>=p_daily OR spent+cost>p_budget THEN RETURN NULL;END IF;
  BEGIN i:=public.trading_quote_contact(d.invitation_id);PERFORM public.assert_trading_actor(d.organization_id,d.actor_id,true);EXCEPTION WHEN SQLSTATE '42501' THEN UPDATE public.trading_quote_mail_outbox SET state='CANCELLED',diagnostic='QUOTATION_CONTACT_OR_AUTHORIZATION_EXPIRED' WHERE id=d.id;RETURN NULL;END;
  UPDATE public.trading_quote_mail_outbox SET state='CLAIMED',lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',token_hash=p_token,cost_micro_usd=cost WHERE id=d.id RETURNING * INTO d;
  RETURN jsonb_build_object('id',d.id,'lease',d.lease_id,'kind',d.kind);
 END IF;
 SELECT * INTO d FROM public.trading_quote_mail_outbox WHERE id=p_id AND lease_id=p_lease FOR UPDATE;IF d.id IS NULL THEN RETURN NULL;END IF;
 IF p_action='START' AND d.state='CLAIMED' AND d.lease_until>now() THEN
  BEGIN i:=public.trading_quote_contact(d.invitation_id);PERFORM public.assert_trading_actor(d.organization_id,d.actor_id,true);EXCEPTION WHEN SQLSTATE '42501' THEN UPDATE public.trading_quote_mail_outbox SET state='CANCELLED',diagnostic='SOURCE_OR_AUTHORIZATION_EXPIRED' WHERE id=d.id;RETURN NULL;END;
  IF lower(i.email)<>lower(d.email) THEN UPDATE public.trading_quote_mail_outbox SET state='CANCELLED',diagnostic='RECIPIENT_CHANGED' WHERE id=d.id;RETURN NULL;END IF;
  IF d.kind='THANKS' THEN
   SELECT * INTO chosen FROM public.trading_quote_selections WHERE organization_id=d.organization_id AND opportunity_id=d.opportunity_id;
   IF chosen.proposal_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.trading_records p WHERE p.organization_id=d.organization_id AND p.id=chosen.proposal_id AND p.revision=chosen.proposal_revision) THEN UPDATE public.trading_quote_mail_outbox SET state='CANCELLED',diagnostic='SELECTED_SOURCE_CHANGED' WHERE id=d.id;RETURN NULL;END IF;
   BEGIN PERFORM public.trading_quote_thanks_context(d.organization_id,chosen.proposal_id);EXCEPTION WHEN SQLSTATE '42501' THEN UPDATE public.trading_quote_mail_outbox SET state='CANCELLED',diagnostic='APPROVED_SELECTION_NO_LONGER_VALID' WHERE id=d.id;RETURN NULL;END;
  ELSE
   INSERT INTO public.trading_quote_access(invitation_id,organization_id,token_hash,expires_at) VALUES(i.id,i.organization_id,d.token_hash,least(i.expires_at,(SELECT(data->>'expiresAt')::timestamptz FROM public.trading_records WHERE organization_id=i.organization_id AND id=i.opportunity_id)));
  END IF;
  UPDATE public.trading_quote_mail_outbox SET state='SENDING',started_at=clock_timestamp() WHERE id=d.id;
  RETURN jsonb_build_object('email',d.email,'title',(SELECT data->>'title' FROM public.trading_records WHERE organization_id=d.organization_id AND id=d.opportunity_id),'organization',(SELECT name FROM public.organizations WHERE id=d.organization_id));
 ELSIF p_action='FINISH' AND d.state='SENDING' THEN
  IF p_result->>'state' NOT IN('ACCEPTED','FAILED','UNKNOWN') OR octet_length(p_result::text)>1500 THEN RAISE EXCEPTION 'Invalid delivery receipt' USING ERRCODE='22023';END IF;
  UPDATE public.trading_quote_mail_outbox SET state=p_result->>'state',provider_id=left(p_result->>'providerId',200),diagnostic=left(p_result->>'diagnostic',200),finished_at=clock_timestamp() WHERE id=d.id;
  RETURN jsonb_build_object('recorded',true);
 END IF;RETURN NULL;
END$$;

-- The existing Trading delivery worker shares this per-organization budget with portal notifications.
-- Account for reservations from this outbox in both older claim paths, without changing their consumers.
ALTER FUNCTION public.trading_workflow_delivery(text,uuid,uuid,integer,bigint,jsonb,jsonb) RENAME TO trading_workflow_delivery_before_quote_mail;
CREATE FUNCTION public.trading_workflow_delivery(p_action text,p_id uuid,p_lease uuid,p_daily integer,p_budget bigint,p_costs jsonb,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE used integer;spent bigint;
BEGIN
 IF p_action='CLAIM' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-notice-budget:org_default',0));
  SELECT count(*) FILTER(WHERE created_at>=date_trunc('day',now())),coalesce(sum(cost_micro_usd),0) INTO used,spent FROM public.trading_quote_mail_outbox WHERE organization_id='org_default' AND state IN('CLAIMED','SENDING','ACCEPTED','UNKNOWN') AND created_at>=date_trunc('month',now());
  IF p_daily-used<=0 OR p_budget-spent<=0 THEN RETURN NULL;END IF;p_daily:=p_daily-used;p_budget:=p_budget-spent;
 END IF;RETURN public.trading_workflow_delivery_before_quote_mail(p_action,p_id,p_lease,p_daily,p_budget,p_costs,p_result);
END$$;
CREATE OR REPLACE FUNCTION public.trading_delivery_usage(p_org text,p_period text) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT (SELECT CASE p_period WHEN 'DAY' THEN count(*) ELSE coalesce(sum(cost_micro_usd),0) END FROM public.trading_approval_deliveries WHERE organization_id=p_org AND channel<>'INAPP' AND state IN('SENDING','ACCEPTED','DELIVERED','UNKNOWN') AND created_at>=date_trunc(CASE p_period WHEN 'DAY' THEN 'day' ELSE 'month' END,now()))
 +(SELECT CASE p_period WHEN 'DAY' THEN count(*) ELSE coalesce(sum(cost_micro_usd),0) END FROM public.trading_quote_mail_outbox WHERE organization_id=p_org AND state IN('CLAIMED','SENDING','ACCEPTED','UNKNOWN') AND created_at>=date_trunc(CASE p_period WHEN 'DAY' THEN 'day' ELSE 'month' END,now()))
$$;
DO $privileges$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure name,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND(proname LIKE 'trading_quote_%' OR proname IN('trading_workflow_delivery','trading_workflow_delivery_before_quote_mail','claim_portal_notification','claim_portal_notification_before_quote_mail')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.name);
 IF f.proname IN('trading_quote_exchange','trading_quote_access_auth','trading_quote_mail','trading_workflow_delivery','claim_portal_notification') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.name);END IF;
END LOOP;END $privileges$;
COMMENT ON FUNCTION public.trading_quote_exchange(text,text,text,text,jsonb) IS 'trading:20261326:v1';
NOTIFY pgrst,'reload schema';
$schema$;
END $install$;
COMMIT;
