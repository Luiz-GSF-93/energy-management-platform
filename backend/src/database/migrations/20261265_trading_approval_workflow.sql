BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $install_20261265$ BEGIN
 IF to_regclass('public.trading_approval_workflows') IS NOT NULL THEN
  IF obj_description(to_regclass('public.trading_approval_workflows'),'pg_class') IS DISTINCT FROM 'trading-workflow:20261265:08bf0c81239b824f5fbaa40a4121b1c2d6e42e9eb6c1400f1e8aea2d57c47840' THEN RAISE EXCEPTION 'Review existing Trading workflow schema before migration';END IF;RETURN;
 END IF;
 EXECUTE $schema_20261265$
CREATE TABLE public.trading_approval_workflows(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 proposal_id uuid NOT NULL,opportunity_id uuid NOT NULL,customer_id text NOT NULL,unit_id text NOT NULL,supplier_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN('REVIEW','INTERNAL_PENDING','INTERNAL_APPROVED','CLIENT_PENDING','CLIENT_APPROVED','SUPPLIER_PENDING','FORMALIZING','COMPLETED','REJECTED','REVOKED','STALE')),
 revision integer NOT NULL DEFAULT 1,proposal_data jsonb NOT NULL,proposal_revision integer NOT NULL,requester_id text NOT NULL,
 recipient_id text,deadline timestamptz,document_request text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,proposal_id),
 FOREIGN KEY(organization_id,proposal_id) REFERENCES public.trading_records(organization_id,id),
 FOREIGN KEY(organization_id,opportunity_id) REFERENCES public.trading_records(organization_id,id),
 FOREIGN KEY(organization_id,supplier_id) REFERENCES public.trading_records(organization_id,id)
);
CREATE INDEX trading_approval_pending ON public.trading_approval_workflows(organization_id,state,updated_at DESC);
CREATE TABLE public.trading_approval_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,workflow_id uuid NOT NULL,
 actor_id text NOT NULL,request_id uuid NOT NULL,input jsonb NOT NULL,action text NOT NULL,reason text NOT NULL,
 snapshot jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,request_id),FOREIGN KEY(organization_id,workflow_id) REFERENCES public.trading_approval_workflows(organization_id,id)
);
CREATE TABLE public.trading_approval_deliveries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,workflow_id uuid NOT NULL,workflow_revision integer NOT NULL,
 recipient_id text NOT NULL,channel text NOT NULL CHECK(channel IN('INAPP','EMAIL','WHATSAPP','SMS')),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','SENDING','ACCEPTED','DELIVERED','FAILED','UNKNOWN','CANCELLED')),
 title text NOT NULL,href text NOT NULL,provider_id text,diagnostic text,lease_id uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sequence integer NOT NULL DEFAULT 1 CHECK(sequence IN(1,2)),
 UNIQUE(workflow_id,workflow_revision,recipient_id,channel,sequence),FOREIGN KEY(organization_id,workflow_id) REFERENCES public.trading_approval_workflows(organization_id,id)
);
CREATE TABLE public.trading_formalization_access(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,workflow_id uuid NOT NULL,email text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),otp_hash text,otp_expires_at timestamptz,otp_sent_at timestamptz,otp_attempts integer NOT NULL DEFAULT 0,
 session_hash text UNIQUE,session_expires_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,workflow_id) REFERENCES public.trading_approval_workflows(organization_id,id)
);
CREATE TABLE public.trading_formalization_files(
 id uuid PRIMARY KEY,organization_id text NOT NULL,workflow_id uuid NOT NULL,batch_id uuid NOT NULL,
 document_id text UNIQUE,path text NOT NULL,filename text NOT NULL,mime text NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes>0 AND size_bytes<=20971520),
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),uploaded_by text NOT NULL,origin text NOT NULL CHECK(origin IN('BACKOFFICE','SUPPLIER')),
 state text NOT NULL DEFAULT 'RESERVED' CHECK(state IN('RESERVED','ARCHIVED','FAILED')),shared boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(organization_id,workflow_id) REFERENCES public.trading_approval_workflows(organization_id,id)
);
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['trading_approval_workflows','trading_approval_events','trading_approval_deliveries','trading_formalization_access','trading_formalization_files'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
END LOOP;END$$;
CREATE TRIGGER trading_approval_events_immutable BEFORE UPDATE OR DELETE ON public.trading_approval_events FOR EACH ROW EXECUTE FUNCTION public.preserve_trading_history();

CREATE FUNCTION public.trading_workflow_portal_allowed(p_org text,p_actor text,p_role text,p_customer text,p_unit text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m record;
BEGIN
 IF p_org<>'org_default' OR NOT public.trading_license_active(p_org) THEN RETURN false;END IF;
 SELECT om.*,r.permissions AS role_permissions INTO m FROM public.organization_members om JOIN public.roles r ON r.id=om.role_id AND r.organization_id=om.organization_id AND r.scope='organization' AND r.name='consulta'
 WHERE om.organization_id=p_org AND om.user_id::text=p_actor AND om.role_id::text=p_role AND upper(om.status)='ACTIVE' AND om.affiliation_type='external';
 IF NOT FOUND OR NOT coalesce(coalesce(m.permissions,m.role_permissions) ? '60f9690a-145b-4dba-b23f-9f945baca296',false) THEN RETURN false;END IF;
 PERFORM public.client_portal_parent_license(p_org);
 IF NOT EXISTS(SELECT 1 FROM public.client_portal_licenses WHERE organization_id=p_org AND customer_id=p_customer AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE AND modules ? 'trading')
 OR NOT EXISTS(SELECT 1 FROM public.customers c JOIN public.consumer_units u ON u.customer_id=c.id AND u.organization_id=c.organization_id WHERE c.organization_id=p_org AND c.id=p_customer AND u.id=p_unit AND c.status='ACTIVE' AND c.deleted_at IS NULL AND u.status='ACTIVE') THEN RETURN false;END IF;
 IF coalesce((SELECT multi_customer_enabled FROM public.client_portal_policies WHERE organization_id=p_org),false) THEN
  RETURN EXISTS(SELECT 1 FROM public.portal_customer_access a WHERE a.organization_id=p_org AND a.user_id::text=p_actor AND a.customer_id=p_customer AND a.active AND(a.all_units OR p_unit=ANY(a.unit_ids)));
 END IF;
 RETURN coalesce(m.exclusive_customer_id=p_customer AND NOT m.portal_scope_managed,false);
END$$;

CREATE FUNCTION public.trading_workflow_read(p_org text,p_actor text,p_role text,p_portal boolean,p_customer text,p_page integer DEFAULT 0,p_proposal uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE answer jsonb;can_approve boolean;
BEGIN
 IF p_org<>'org_default' THEN RETURN jsonb_build_object('enabled',false,'organizationId',p_org,'rows','[]'::jsonb);END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 1000 OR p_portal IS NULL THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 IF NOT p_portal THEN PERFORM public.assert_trading_actor(p_org,p_actor,false);
  SELECT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND r.name IN('gestor','admin_org')) INTO can_approve;
 END IF;
 SELECT coalesce(jsonb_agg(body ORDER BY updated_at DESC),'[]') INTO answer FROM(
 SELECT w.updated_at,jsonb_build_object('id',w.id,'proposalId',w.proposal_id,'opportunityId',w.opportunity_id,'customerId',w.customer_id,'unitId',w.unit_id,'customer',c.company_name,'unit',u.name,
 'title',o.data->>'title','supplier',s.data->>'tradeName','state',w.state,'revision',w.revision,'proposalRevision',w.proposal_revision,'proposal',w.proposal_data,'deadline',w.deadline,'recipientId',w.recipient_id,'documentRequest',w.document_request,
 'expired',w.state='CLIENT_PENDING' AND w.deadline<=now(),'sourceChanged',p.data IS DISTINCT FROM w.proposal_data OR p.revision<>w.proposal_revision,
 'events',CASE WHEN p_portal THEN '[]'::jsonb ELSE(SELECT coalesce(jsonb_agg(jsonb_build_object('actor',e.actor_id,'action',e.action,'reason',e.reason,'at',e.created_at) ORDER BY e.created_at),'[]') FROM public.trading_approval_events e WHERE e.organization_id=p_org AND e.workflow_id=w.id) END,
 'files',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.filename,'size',f.size_bytes,'state',f.state,'shared',f.shared,'origin',f.origin,'batchId',f.batch_id,'uploadedBy',f.uploaded_by)),'[]') FROM public.trading_formalization_files f WHERE f.organization_id=p_org AND f.workflow_id=w.id AND(NOT p_portal OR(f.state='ARCHIVED' AND f.shared))),
 'supplierContacts',CASE WHEN p_portal THEN '[]'::jsonb ELSE(SELECT coalesce(jsonb_agg(DISTINCT i.email),'[]') FROM public.trading_invitations i WHERE i.organization_id=p_org AND i.proposal_id=w.proposal_id AND i.state='RESPONDED' AND i.kind='SUPPLIER') END,
 'deliveries',CASE WHEN p_portal THEN '[]'::jsonb ELSE(SELECT coalesce(jsonb_agg(jsonb_build_object('channel',d.channel,'state',d.state,'diagnostic',d.diagnostic,'at',d.created_at)),'[]') FROM public.trading_approval_deliveries d WHERE d.organization_id=p_org AND d.workflow_id=w.id) END,
 'recipients',CASE WHEN p_portal OR w.state NOT IN('INTERNAL_APPROVED','CLIENT_PENDING') THEN '[]'::jsonb ELSE(SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(m.display_name,a.email),'email',a.email)),'[]') FROM public.organization_members m JOIN auth.users a ON a.id=m.user_id WHERE m.organization_id=p_org AND a.email_confirmed_at IS NOT NULL AND public.trading_workflow_portal_allowed(p_org,m.user_id::text,m.role_id::text,w.customer_id,w.unit_id)) END) body
 FROM public.trading_approval_workflows w JOIN public.trading_records p ON p.id=w.proposal_id AND p.organization_id=w.organization_id JOIN public.trading_records o ON o.id=w.opportunity_id AND o.organization_id=w.organization_id JOIN public.trading_records s ON s.id=w.supplier_id AND s.organization_id=w.organization_id JOIN public.customers c ON c.id=w.customer_id AND c.organization_id=w.organization_id JOIN public.consumer_units u ON u.id=w.unit_id AND u.organization_id=w.organization_id
 WHERE w.organization_id=p_org AND(p_proposal IS NULL OR w.proposal_id=p_proposal) AND(NOT p_portal OR(w.recipient_id=p_actor AND w.state IN('CLIENT_PENDING','CLIENT_APPROVED','SUPPLIER_PENDING','FORMALIZING','COMPLETED','REJECTED','REVOKED') AND(p_customer IS NULL OR w.customer_id=p_customer) AND public.trading_workflow_portal_allowed(p_org,p_actor,p_role,w.customer_id,w.unit_id)))
 ORDER BY w.updated_at DESC LIMIT 20 OFFSET p_page*20)x;
 RETURN jsonb_build_object('enabled',true,'organizationId',p_org,'rows',answer,'canApprove',coalesce(can_approve,false),'page',p_page);
END$$;

CREATE FUNCTION public.trading_workflow_action(p_org text,p_actor text,p_role text,p_portal boolean,p_proposal uuid,p_revision integer,p_request uuid,p_action text,p_reason text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.trading_records;o public.trading_records;w public.trading_approval_workflows;old public.trading_approval_events;input jsonb;answer jsonb;hours integer;
BEGIN
 IF p_org<>'org_default' OR p_portal IS NULL OR p_request IS NULL OR p_revision IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>4000 THEN RAISE EXCEPTION 'Invalid workflow input' USING ERRCODE='22023';END IF;
 IF NOT p_portal THEN PERFORM public.assert_trading_actor(p_org,p_actor,true,p_action IN('APPROVE_INTERNAL','REJECT_INTERNAL','COMPLETE'));END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('trading-workflow:'||p_org||':'||p_proposal::text,0));
 input:=jsonb_build_object('proposal',p_proposal,'revision',p_revision,'action',p_action,'reason',p_reason,'body',p_body-'tokenHash','portal',p_portal);
 SELECT * INTO old FROM public.trading_approval_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF old.actor_id IS DISTINCT FROM p_actor OR old.input IS DISTINCT FROM input THEN RAISE EXCEPTION 'Changed workflow request' USING ERRCODE='40001';END IF;RETURN old.response||jsonb_build_object('replayed',true);END IF;
 SELECT * INTO p FROM public.trading_records WHERE organization_id=p_org AND id=p_proposal AND kind='proposal' FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Proposal unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO o FROM public.trading_records WHERE organization_id=p_org AND id=p.parent_id AND kind='opportunity' FOR UPDATE;
 SELECT * INTO w FROM public.trading_approval_workflows WHERE organization_id=p_org AND proposal_id=p.id FOR UPDATE;
 IF p_portal AND(w.id IS NULL OR w.recipient_id IS DISTINCT FROM p_actor OR NOT public.trading_workflow_portal_allowed(p_org,p_actor,p_role,w.customer_id,w.unit_id)) THEN RAISE EXCEPTION 'Client decision outside scope' USING ERRCODE='42501';END IF;
 IF p_action='REGISTER' THEN
  IF p_portal OR w.id IS NOT NULL OR p.revision<>p_revision OR p.status NOT IN('RECEIVED','ANALYSIS') OR o.status NOT IN('OPEN','ANALYSIS') OR NOT EXISTS(SELECT 1 FROM public.trading_records s WHERE s.organization_id=p_org AND s.id=(p.data->>'supplierId')::uuid AND s.kind='supplier' AND s.status='ACTIVE') THEN RAISE EXCEPTION 'Response changed or already registered' USING ERRCODE='40001';END IF;
  IF p.status='RECEIVED' THEN p:=jsonb_populate_record(NULL::public.trading_records,public.transition_trading_record(p_org,p_actor,p.id,p.revision,'ANALYSIS',p_reason));END IF;
  UPDATE public.trading_invitations SET proposal_id=p.id WHERE organization_id=p_org AND opportunity_id=o.id AND supplier_id=(p.data->>'supplierId')::uuid AND state='RESPONDED' AND proposal_id IS NULL AND email=p.created_by
   AND(SELECT count(*) FROM public.trading_records r WHERE r.organization_id=p_org AND r.parent_id=o.id AND r.kind='proposal' AND r.data->>'supplierId'=p.data->>'supplierId' AND r.created_by=p.created_by)=1;
  UPDATE public.trading_invitations SET state='REVOKED',session_hash=NULL,session_expires_at=NULL WHERE organization_id=p_org AND proposal_id=p.id AND kind='CLIENT' AND state='PENDING';
  INSERT INTO public.trading_approval_workflows(organization_id,proposal_id,opportunity_id,customer_id,unit_id,supplier_id,state,proposal_data,proposal_revision,requester_id)
  VALUES(p_org,p.id,o.id,o.data->>'customerId',o.data->>'unitId',(p.data->>'supplierId')::uuid,'REVIEW',p.data,p.revision,p_actor) RETURNING * INTO w;
 ELSE
  IF w.id IS NULL OR w.revision<>p_revision OR(p_action NOT IN('REVOKE','REVIEW_CURRENT') AND(p.data IS DISTINCT FROM w.proposal_data OR p.revision<>w.proposal_revision)) THEN RAISE EXCEPTION 'Proposal revision changed; review the current version' USING ERRCODE='40001';END IF;
  IF p_action='REVIEW_CURRENT' AND NOT p_portal AND w.state='STALE' AND p.status NOT IN('CONTRACTED','REJECTED') AND w.customer_id=o.data->>'customerId' AND w.unit_id=o.data->>'unitId' AND w.supplier_id=(p.data->>'supplierId')::uuid THEN
   w.state:='REVIEW';w.proposal_data:=p.data;w.proposal_revision:=p.revision;w.recipient_id:=NULL;w.deadline:=NULL;
   UPDATE public.trading_records SET status='ANALYSIS',revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() WHERE organization_id=p_org AND id=p.id RETURNING revision INTO w.proposal_revision;
  ELSIF p_action='REQUEST_INTERNAL' AND NOT p_portal AND w.state='REVIEW' THEN w.state:='INTERNAL_PENDING';
  ELSIF p_action IN('APPROVE_INTERNAL','REJECT_INTERNAL') AND NOT p_portal AND w.state='INTERNAL_PENDING' THEN
   p:=jsonb_populate_record(NULL::public.trading_records,public.transition_trading_record(p_org,p_actor,p.id,p.revision,CASE p_action WHEN 'APPROVE_INTERNAL' THEN 'MANAGER_APPROVED' ELSE 'REJECTED' END,p_reason));
   w.proposal_revision:=p.revision;w.state:=CASE p_action WHEN 'APPROVE_INTERNAL' THEN 'INTERNAL_APPROVED' ELSE 'REJECTED' END;
  ELSIF p_action='SEND_CLIENT' AND NOT p_portal AND w.state IN('INTERNAL_APPROVED','CLIENT_PENDING') THEN
   hours:=(p_body->>'hours')::integer;
   IF hours IS NULL OR hours NOT IN(4,8) OR public.trading_workflow_portal_allowed(p_org,p_body->>'recipientId',(SELECT m.role_id::text FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id::text=p_body->>'recipientId'),w.customer_id,w.unit_id) IS NOT TRUE THEN RAISE EXCEPTION 'Select an authorized recipient and 4 or 8 hours' USING ERRCODE='42501';END IF;
   UPDATE public.trading_approval_deliveries SET state='CANCELLED',diagnostic='DECISION_REISSUED' WHERE workflow_id=w.id AND state='PENDING';
   w.recipient_id:=p_body->>'recipientId';w.deadline:=least(now()+make_interval(hours=>hours),((p.data->>'validUntil')::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo');
   IF w.deadline<=now() THEN RAISE EXCEPTION 'Commercial proposal expired' USING ERRCODE='22023';END IF;w.state:='CLIENT_PENDING';
  ELSIF p_action IN('CLIENT_APPROVE','CLIENT_REJECT') AND p_portal AND w.state='CLIENT_PENDING' AND w.deadline>now() AND p_body->'confirmed'='true'::jsonb THEN
   w.state:=CASE p_action WHEN 'CLIENT_APPROVE' THEN 'CLIENT_APPROVED' ELSE 'REJECTED' END;
   UPDATE public.trading_records SET status=CASE p_action WHEN 'CLIENT_APPROVE' THEN 'CLIENT_APPROVED' ELSE 'REJECTED' END,revision=revision+1,updated_by=p_actor,updated_at=now() WHERE id=p.id AND organization_id=p_org RETURNING * INTO p;
   w.proposal_revision:=p.revision;
   INSERT INTO public.trading_history(organization_id,record_id,revision,actor_id,action,reason,snapshot)VALUES(p_org,p.id,p.revision,p_actor,p_action,p_reason,to_jsonb(p));
  ELSIF p_action='NOTIFY_SUPPLIER' AND NOT p_portal AND w.state IN('CLIENT_APPROVED','SUPPLIER_PENDING') THEN
   IF EXISTS(SELECT 1 FROM public.trading_formalization_access WHERE organization_id=p_org AND workflow_id=w.id AND created_at>clock_timestamp()-interval '60 seconds') THEN RAISE EXCEPTION 'Wait sixty seconds before reissuing supplier access' USING ERRCODE='22023';END IF;
   IF p_body->>'tokenHash' !~ '^[a-f0-9]{64}$' OR length(coalesce(p_body->>'email',''))>320 OR NOT EXISTS(SELECT 1 FROM public.trading_invitations i WHERE i.organization_id=p_org AND i.opportunity_id=w.opportunity_id AND i.supplier_id=w.supplier_id AND i.proposal_id=w.proposal_id AND i.state='RESPONDED' AND lower(i.email)=lower(p_body->>'email')) THEN RAISE EXCEPTION 'Supplier contact must match the received response' USING ERRCODE='42501';END IF;
   UPDATE public.trading_formalization_access SET revoked_at=clock_timestamp(),session_hash=NULL,session_expires_at=NULL,otp_hash=NULL WHERE organization_id=p_org AND workflow_id=w.id AND revoked_at IS NULL;
   INSERT INTO public.trading_formalization_access(organization_id,workflow_id,email,token_hash)VALUES(p_org,w.id,lower(p_body->>'email'),p_body->>'tokenHash');w.state:='SUPPLIER_PENDING';
  ELSIF p_action='COMPLETE' AND NOT p_portal AND w.state='FORMALIZING' THEN
   IF NOT EXISTS(SELECT 1 FROM public.trading_formalization_files f WHERE f.organization_id=p_org AND f.workflow_id=w.id AND f.state='ARCHIVED' AND f.document_id=p_body->>'documentId') THEN RAISE EXCEPTION 'Select the archived formalization evidence' USING ERRCODE='22023';END IF;
   PERFORM public.contract_trading_proposal(p_org,p_actor,p.id,p.revision,p_body->>'documentId',p_body->>'reference',p_reason);
   SELECT revision,data INTO w.proposal_revision,w.proposal_data FROM public.trading_records WHERE id=p.id AND organization_id=p_org;w.state:='COMPLETED';
  ELSIF p_action='REVOKE' AND NOT p_portal AND w.state NOT IN('COMPLETED','REVOKED') THEN w.state:='REVOKED';
  ELSE RAISE EXCEPTION 'Action unavailable in this stage' USING ERRCODE='22023';END IF;
  UPDATE public.trading_approval_workflows SET state=w.state,revision=revision+1,proposal_data=w.proposal_data,proposal_revision=w.proposal_revision,recipient_id=w.recipient_id,deadline=w.deadline,updated_at=clock_timestamp() WHERE id=w.id AND organization_id=p_org RETURNING * INTO w;
 END IF;
 IF w.state IN('COMPLETED','REVOKED','REJECTED') THEN
  UPDATE public.trading_formalization_access SET revoked_at=clock_timestamp(),session_hash=NULL,session_expires_at=NULL,otp_hash=NULL WHERE organization_id=p_org AND workflow_id=w.id AND revoked_at IS NULL;
  UPDATE public.trading_approval_deliveries SET state='CANCELLED' WHERE organization_id=p_org AND workflow_id=w.id AND state='PENDING';
 END IF;
 IF w.state='INTERNAL_PENDING' THEN
  INSERT INTO public.trading_approval_deliveries(organization_id,workflow_id,workflow_revision,recipient_id,channel,state,title,href)
  SELECT p_org,w.id,w.revision,m.user_id::text,'INAPP','ACCEPTED','Trading: proposta aguardando aprovação interna','/backoffice/trading-hub#aprovacoes' FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND upper(m.status)='ACTIVE' AND r.name IN('gestor','admin_org') ON CONFLICT DO NOTHING;
 ELSIF w.state='CLIENT_PENDING' THEN
  INSERT INTO public.trading_approval_deliveries(organization_id,workflow_id,workflow_revision,recipient_id,channel,state,title,href)
  SELECT p_org,w.id,w.revision,w.recipient_id,c,CASE WHEN c='INAPP' THEN 'ACCEPTED' ELSE 'PENDING' END,'Urgente: proposta de energia para decisão até '||to_char(w.deadline AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'),'https://app.expertenergy.com.br/portal#aprovacoes-trading' FROM unnest(ARRAY['INAPP','EMAIL','WHATSAPP','SMS'])c;
 END IF;
 answer:=jsonb_build_object('organizationId',p_org,'id',w.id,'proposalId',w.proposal_id,'state',w.state,'revision',w.revision);
 INSERT INTO public.trading_approval_events(organization_id,workflow_id,actor_id,request_id,input,action,reason,snapshot,response)VALUES(p_org,w.id,p_actor,p_request,input,p_action,p_reason,to_jsonb(w),answer);
 RETURN answer;
END$$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure AS name FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('trading_workflow_portal_allowed','trading_workflow_read','trading_workflow_action') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.name);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.name);
END LOOP;END$$;
NOTIFY pgrst,'reload schema';

COMMENT ON TABLE public.trading_approval_workflows IS 'trading-workflow:20261265:08bf0c81239b824f5fbaa40a4121b1c2d6e42e9eb6c1400f1e8aea2d57c47840';
$schema_20261265$;
END $install_20261265$;
COMMIT;
