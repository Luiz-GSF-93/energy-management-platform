BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.portal_document_intakes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id), consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 request_id uuid NOT NULL, actor_id text NOT NULL, document_id text REFERENCES public.documents(id),
 record_id uuid REFERENCES public.operation_records(id), month text NOT NULL CHECK(month~'^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 kind text NOT NULL CHECK(kind IN('INVOICE','FISCAL','CONTRACT','BILLING','ART','TECHNICAL','REPORT','OTHER')),
 file_hash text NOT NULL CHECK(file_hash~'^[a-f0-9]{64}$'), filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 255),
 consent boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_id), UNIQUE(organization_id,document_id)
);
CREATE TABLE public.portal_document_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, intake_id uuid NOT NULL REFERENCES public.portal_document_intakes(id),
 event_key text NOT NULL, state text NOT NULL CHECK(state IN('RESERVED','RECEIVED','ANALYSING','VALIDATING','PUBLISHED','ERROR','REJECTED','AUTOMATION_PENDING','AUTOMATION_RESERVED','AUTOMATION_STOPPED')),
 source_id text, note text NOT NULL CHECK(length(note)<=500), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(intake_id,event_key)
);
CREATE TABLE public.portal_service_routing(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 revision integer NOT NULL CHECK(revision>0), kind text NOT NULL CHECK(kind IN('ROUTING','PREFERENCES')), owner_user_id text NOT NULL,
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=12000),
 actor_id text NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,kind,owner_user_id,revision)
);
CREATE TABLE public.portal_notification_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id), customer_id text NOT NULL REFERENCES public.customers(id),
 recipient_id text NOT NULL, event_key text NOT NULL, kind text NOT NULL CHECK(kind IN('DOCUMENT','REQUEST','REPLY','DEADLINE','PUBLICATION','NEWS')),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 160), href text NOT NULL CHECK(href IN('/portal#minhas-faturas','/portal#notificacoes','/portal#financeiro','/backoffice/operation/notifications','/backoffice/documents')),
 record_id uuid REFERENCES public.operation_records(id), document_id text REFERENCES public.documents(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,recipient_id,event_key)
);
CREATE TABLE public.portal_notification_deliveries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, notification_id uuid NOT NULL REFERENCES public.portal_notification_outbox(id),
 channel text NOT NULL CHECK(channel IN('EMAIL','SMS','WHATSAPP')), sequence integer NOT NULL DEFAULT 1 CHECK(sequence BETWEEN 1 AND 8), attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3),
 state text NOT NULL CHECK(state IN('BLOCKED','RESERVED','ACCEPTED','DELIVERED','FAILED','UNKNOWN')),
 provider_id text, reason text, cost_micro_usd bigint CHECK(cost_micro_usd>=0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(notification_id,channel,attempt,sequence)
);
CREATE TABLE public.ccee_financial_cost_snapshots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id), consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 month text NOT NULL CHECK(month~'^20[0-9]{2}-(0[1-9]|1[0-2])$'), revision integer NOT NULL CHECK(revision>0),
 provider text NOT NULL CHECK(provider='CCEE'), source_reference text NOT NULL, source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 closing_hash text CHECK(closing_hash~'^[a-f0-9]{64}$'), state text NOT NULL CHECK(state IN('DRAFT','PUBLISHED')),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=100000),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,consumer_unit_id,month,revision)
);
ALTER TABLE public.operation_records ADD COLUMN portal_sector text CHECK(portal_sector IN('ANALYST','FINANCIAL','ENGINEERING'));
ALTER TABLE public.operation_records ADD COLUMN portal_origin text CHECK(portal_origin='CLIENT');
DO $$DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['portal_document_intakes','portal_document_events','portal_service_routing','portal_notification_outbox','portal_notification_deliveries','ccee_financial_cost_snapshots'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 IF t<>'portal_document_intakes' THEN EXECUTE format('CREATE TRIGGER preserve_portal_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history()',t); END IF;
END LOOP;END$$;
CREATE INDEX portal_intakes_scope ON public.portal_document_intakes(organization_id,customer_id,created_at DESC,id);
CREATE INDEX portal_notifications_recipient ON public.portal_notification_outbox(organization_id,recipient_id,created_at DESC,id);

CREATE FUNCTION public.portal_workspace_actor(p_org text,p_actor text,p_role text,p_platform boolean,p_module text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m record; b jsonb;
BEGIN
 IF p_org IS NULL OR p_actor IS NULL OR p_role IS NULL OR p_platform IS NULL OR p_module NOT IN('documents','notifications') THEN RAISE EXCEPTION 'Portal actor required' USING ERRCODE='42501';END IF;
 IF p_platform THEN
  PERFORM public.assert_license_platform_actor(p_actor::uuid);
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Active organization session required' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('external',false,'admin',true);
 END IF;
 IF (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND user_id::text=p_actor AND upper(status)='ACTIVE')<>1 THEN RAISE EXCEPTION 'Unique membership required' USING ERRCODE='42501';END IF;
 SELECT om.affiliation_type,om.exclusive_customer_id,r.name,r.permissions INTO m FROM public.organization_members om JOIN public.roles r ON r.id=om.role_id AND r.organization_id=om.organization_id AND r.scope='organization'
 WHERE om.organization_id=p_org AND om.user_id::text=p_actor AND om.role_id::text=p_role AND upper(om.status)='ACTIVE' FOR SHARE OF om,r;
 IF NOT FOUND THEN RAISE EXCEPTION 'Membership unavailable' USING ERRCODE='42501';END IF;
 IF m.name='consulta' AND m.affiliation_type='external' AND m.exclusive_customer_id IS NOT NULL THEN
  b:=public.client_portal_entitlement(p_org,p_actor,p_role,p_module);
  IF b->>'enabled' IS DISTINCT FROM 'true' OR b->>'customerId' IS DISTINCT FROM m.exclusive_customer_id THEN RAISE EXCEPTION 'Portal license unavailable' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('external',true,'customerId',m.exclusive_customer_id,'admin',false);
 END IF;
 IF m.name NOT IN('admin_org','gestor','operacional') OR m.affiliation_type IS DISTINCT FROM 'internal' OR m.exclusive_customer_id IS NOT NULL THEN RAISE EXCEPTION 'Internal team required' USING ERRCODE='42501';END IF;
 PERFORM public.assert_operation_actor(p_org,p_actor,'requests',false);
 RETURN jsonb_build_object('external',false,'admin',m.name='admin_org');
END$$;

CREATE FUNCTION public.portal_workspace_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_id uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb; ext boolean; customer text; config jsonb; rec public.operation_records; item public.portal_document_intakes; old public.portal_document_intakes;
 saved public.portal_service_routing; member text; unit text; target text; value jsonb; n integer; result jsonb; request uuid;
BEGIN
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>20000 THEN RAISE EXCEPTION 'Invalid portal body' USING ERRCODE='22023';END IF;
 a:=public.portal_workspace_actor(p_org,p_actor,p_role,p_platform,CASE WHEN p_action IN('reserve_upload','attach_upload','list','file','context','upload_error') THEN 'documents' ELSE 'notifications' END);
 ext:=(a->>'external')::boolean;customer:=a->>'customerId';
 SELECT body INTO config FROM public.portal_service_routing WHERE organization_id=p_org AND kind='ROUTING' AND owner_user_id='organization' ORDER BY revision DESC LIMIT 1;
 IF p_action IN('context','service_context') THEN
  IF NOT ext THEN RAISE EXCEPTION 'External portal required' USING ERRCODE='42501';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]') INTO result FROM public.consumer_units WHERE organization_id=p_org AND customer_id=customer AND status='ACTIVE';
  IF jsonb_array_length(result)>100 THEN RAISE EXCEPTION 'Scope too large' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('organizationId',p_org,'customerId',customer,'units',result);
 ELSIF p_action='preferences' THEN
  IF NOT ext THEN RAISE EXCEPTION 'External portal required' USING ERRCODE='42501';END IF;
  SELECT * INTO saved FROM public.portal_service_routing WHERE organization_id=p_org AND kind='PREFERENCES' AND owner_user_id=p_actor ORDER BY revision DESC LIMIT 1;
  IF p_body='{}' THEN RETURN jsonb_build_object('revision',coalesce(saved.revision,0),'body',coalesce(saved.body,'{"EMAIL":false,"SMS":false,"WHATSAPP":false}'));END IF;
  IF p_body-ARRAY['revision','body']<>'{}' OR jsonb_typeof(p_body->'body') IS DISTINCT FROM 'object' OR (p_body->'body')-ARRAY['EMAIL','SMS','WHATSAPP']<>'{}' OR jsonb_typeof(p_body#>'{body,EMAIL}') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_body#>'{body,SMS}') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_body#>'{body,WHATSAPP}') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid communication preferences' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-preferences:'||p_org||p_actor,0));
  SELECT coalesce(max(revision),0) INTO n FROM public.portal_service_routing WHERE organization_id=p_org AND kind='PREFERENCES' AND owner_user_id=p_actor;
  IF (p_body->>'revision')::integer IS DISTINCT FROM n THEN RAISE EXCEPTION 'Preferences changed' USING ERRCODE='40001';END IF;
  INSERT INTO public.portal_service_routing(organization_id,revision,kind,owner_user_id,body,actor_id,reason) VALUES(p_org,n+1,'PREFERENCES',p_actor,p_body->'body',p_actor,'Preferências de comunicação atualizadas pelo cliente.') RETURNING * INTO saved;
  RETURN jsonb_build_object('revision',saved.revision,'body',saved.body);
 ELSIF p_action='routing' THEN
  IF ext OR a->>'admin'<>'true' THEN RAISE EXCEPTION 'Organization administrator required' USING ERRCODE='42501';END IF;
  IF p_body='{}' THEN RETURN jsonb_build_object('deliveries',(SELECT coalesce(jsonb_agg(rows),'[]') FROM (SELECT DISTINCT ON(d.notification_id,d.channel) d.notification_id AS id,d.channel,CASE WHEN d.channel='WHATSAPP' AND EXISTS(SELECT 1 FROM public.platform_whatsapp_status_events w WHERE w.message_id=d.provider_id AND w.status IN('delivered','read')) THEN 'DELIVERED' WHEN d.channel='WHATSAPP' AND EXISTS(SELECT 1 FROM public.platform_whatsapp_status_events w WHERE w.message_id=d.provider_id AND w.status='failed') THEN 'FAILED' ELSE d.state END AS state,d.reason,d.created_at AS date,n.title FROM public.portal_notification_deliveries d JOIN public.portal_notification_outbox n ON n.id=d.notification_id AND n.organization_id=p_org WHERE d.organization_id=p_org ORDER BY d.notification_id,d.channel,(d.state='DELIVERED') DESC,(d.state='FAILED') DESC,d.sequence DESC LIMIT 20)rows),'members',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',om.user_id,'name',coalesce(nullif(om.display_name,''),om.user_id::text),'role',r.name)),'[]') FROM public.organization_members om JOIN public.roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.organization_id=p_org AND upper(om.status)='ACTIVE' AND om.affiliation_type='internal' AND om.exclusive_customer_id IS NULL AND r.scope='organization' AND r.name IN('admin_org','gestor','operacional')),'revision',coalesce((SELECT max(revision) FROM public.portal_service_routing WHERE organization_id=p_org AND kind='ROUTING'),0),'body',coalesce(config,'{}'));END IF;
  IF p_body-ARRAY['revision','reason','body']<>'{}' OR length(btrim(p_body->>'reason')) NOT BETWEEN 10 AND 1000 OR jsonb_typeof(p_body->'body') IS DISTINCT FROM 'object' OR (p_body->'body')-ARRAY['ANALYST','FINANCIAL','ENGINEERING','automationActor','automationEnabled','enabled']<>'{}' THEN RAISE EXCEPTION 'Invalid routing' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-routing:'||p_org,0));
  SELECT coalesce(max(revision),0) INTO n FROM public.portal_service_routing WHERE organization_id=p_org AND kind='ROUTING';
  IF (p_body->>'revision')::integer IS DISTINCT FROM n THEN RAISE EXCEPTION 'Routing changed' USING ERRCODE='40001';END IF;
  FOREACH target IN ARRAY ARRAY['ANALYST','FINANCIAL','ENGINEERING'] LOOP
   IF jsonb_typeof(p_body#>ARRAY['body',target]) IS DISTINCT FROM 'array' OR jsonb_array_length(p_body#>ARRAY['body',target])>20 THEN RAISE EXCEPTION 'Invalid department' USING ERRCODE='22023';END IF;
   FOR member IN SELECT jsonb_array_elements_text(p_body#>ARRAY['body',target]) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.organization_members om JOIN public.roles r ON r.id=om.role_id AND r.organization_id=p_org AND r.scope='organization' WHERE om.organization_id=p_org AND om.user_id::text=member AND upper(om.status)='ACTIVE' AND om.affiliation_type='internal' AND om.exclusive_customer_id IS NULL AND r.name IN('admin_org','gestor','operacional')) THEN RAISE EXCEPTION 'Internal organizational recipient required' USING ERRCODE='42501';END IF;
    PERFORM public.assert_operation_actor(p_org,member,'requests',false);
    IF target='ENGINEERING' AND NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=member AND upper(m.status)='ACTIVE' AND r.scope='organization' AND r.name IN('gestor','admin_org') AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL) THEN RAISE EXCEPTION 'Engineering requires organizational management' USING ERRCODE='42501';END IF;
   END LOOP;
  END LOOP;
  IF coalesce((p_body#>>'{body,automationEnabled}')::boolean,false) THEN
   member:=p_body#>>'{body,automationActor}';
   IF NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=member AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND r.scope='organization' AND r.name IN('gestor','admin_org')) THEN RAISE EXCEPTION 'Explicit organizational automation actor required' USING ERRCODE='42501';END IF;
  END IF;
  INSERT INTO public.portal_service_routing(organization_id,revision,kind,owner_user_id,body,actor_id,reason) VALUES(p_org,n+1,'ROUTING','organization',p_body->'body',p_actor,p_body->>'reason') RETURNING * INTO saved;
  RETURN jsonb_build_object('revision',saved.revision,'body',saved.body);
 ELSIF p_action IN('reserve_upload','request') THEN
  IF NOT ext THEN RAISE EXCEPTION 'External portal required' USING ERRCODE='42501';END IF;
  unit:=p_body->>'unitId';request:=(p_body->>'requestId')::uuid;
  IF request IS NULL OR NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE organization_id=p_org AND customer_id=customer AND id=unit AND status='ACTIVE') THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-intake:'||p_org||request::text,0));
  IF p_action='reserve_upload' THEN
   IF p_body-ARRAY['requestId','unitId','month','kind','fileHash','filename','recordId','consent']<>'{}' THEN RAISE EXCEPTION 'Invalid upload' USING ERRCODE='22023';END IF;
   IF p_body->>'kind'<>'INVOICE' THEN
    SELECT * INTO rec FROM public.operation_records WHERE organization_id=p_org AND customer_id=customer AND consumer_unit_id=unit AND id=(p_body->>'recordId')::uuid AND status NOT IN('DONE','CANCELLED','ARCHIVED');
    IF NOT FOUND OR NOT(rec.portal_origin='CLIENT' OR EXISTS(SELECT 1 FROM public.operation_client_messages WHERE organization_id=p_org AND record_id=rec.id AND direction='OUTBOUND')) THEN RAISE EXCEPTION 'Open shared request required' USING ERRCODE='42501';END IF;
   ELSIF p_body->>'recordId' IS NOT NULL THEN RAISE EXCEPTION 'Invoice intake does not accept a request binding' USING ERRCODE='22023';END IF;
   SELECT * INTO old FROM public.portal_document_intakes WHERE organization_id=p_org AND request_id=request;
   IF FOUND THEN
    IF old.actor_id<>p_actor OR old.customer_id<>customer OR old.consumer_unit_id<>unit OR old.month IS DISTINCT FROM p_body->>'month' OR old.file_hash IS DISTINCT FROM p_body->>'fileHash' OR old.filename IS DISTINCT FROM p_body->>'filename' OR old.kind IS DISTINCT FROM p_body->>'kind' OR old.record_id IS DISTINCT FROM rec.id OR old.consent IS DISTINCT FROM coalesce((p_body->>'consent')::boolean,false) THEN RAISE EXCEPTION 'Upload request changed' USING ERRCODE='40001';END IF;
    RETURN jsonb_build_object('id',old.id,'documentId',old.document_id,'acquired',false);
   END IF;
   INSERT INTO public.portal_document_intakes(organization_id,customer_id,consumer_unit_id,request_id,actor_id,record_id,month,kind,file_hash,filename,consent) VALUES(p_org,customer,unit,request,p_actor,rec.id,p_body->>'month',p_body->>'kind',p_body->>'fileHash',p_body->>'filename',coalesce((p_body->>'consent')::boolean,false)) RETURNING * INTO item;
   INSERT INTO public.portal_document_events(organization_id,intake_id,event_key,state,note) VALUES(p_org,item.id,'reserved','RESERVED','Arquivo em recebimento.');
   RETURN jsonb_build_object('id',item.id,'acquired',true);
  END IF;
  IF p_body-ARRAY['requestId','unitId','sector','subject','body']<>'{}' OR p_body->>'sector' NOT IN('ANALYST','FINANCIAL','ENGINEERING') OR length(btrim(p_body->>'subject')) NOT BETWEEN 3 AND 160 OR length(btrim(p_body->>'body')) NOT BETWEEN 3 AND 6000 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023';END IF;
  SELECT * INTO rec FROM public.operation_records WHERE organization_id=p_org AND created_by=p_actor AND id=request;
  IF FOUND THEN
   IF rec.customer_id<>customer OR rec.consumer_unit_id<>unit OR rec.title<>btrim(p_body->>'subject') OR rec.description<>btrim(p_body->>'body') OR rec.portal_sector<>p_body->>'sector' THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001';END IF;
   RETURN jsonb_build_object('id',rec.id,'replayed',true);
  END IF;
  target:=config#>>ARRAY[p_body->>'sector','0'];
  IF config->>'enabled' IS DISTINCT FROM 'true' OR target IS NULL THEN RAISE EXCEPTION 'Department is not configured' USING ERRCODE='22023';END IF;
  PERFORM public.assert_operation_actor(p_org,target,'requests',true);
  INSERT INTO public.operation_records(id,organization_id,kind,customer_id,consumer_unit_id,title,description,priority,status,responsible_id,due_at,effective_date,request_type,revision,created_by,updated_by,portal_sector,portal_origin)
  VALUES(request,p_org,'requests',customer,unit,btrim(p_body->>'subject'),btrim(p_body->>'body'),'NORMAL','OPEN',target,now()+interval '2 days',current_date,'INFORMATION',1,p_actor,p_actor,p_body->>'sector','CLIENT') RETURNING * INTO rec;
  INSERT INTO public.operation_record_history(organization_id,record_id,revision,request_id,request_payload,action,actor_id,reason,snapshot) VALUES(p_org,rec.id,1,request,p_body,'CREATE',p_actor,'Atendimento solicitado pelo cliente.',to_jsonb(rec));
  INSERT INTO public.operation_client_messages(organization_id,record_id,customer_id,consumer_unit_id,direction,subject,body,actor_id,actor_name,request_id) VALUES(p_org,rec.id,customer,unit,'INBOUND',rec.title,rec.description,p_actor,rec.requested_by_name,request);
  FOR member IN SELECT jsonb_array_elements_text(config->(p_body->>'sector')) LOOP
   PERFORM public.assert_operation_actor(p_org,member,'requests',false);
   INSERT INTO public.portal_notification_outbox(organization_id,customer_id,recipient_id,event_key,kind,title,href,record_id) VALUES(p_org,customer,member,'request:'||rec.id,'REQUEST','Atendimento solicitado pelo cliente','/backoffice/operation/notifications',rec.id) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('id',rec.id,'replayed',false);
 ELSIF p_action IN('attach_upload','upload_error','file') THEN
  IF NOT ext THEN RAISE EXCEPTION 'External portal required' USING ERRCODE='42501';END IF;
  SELECT * INTO item FROM public.portal_document_intakes WHERE organization_id=p_org AND customer_id=customer AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Upload unavailable' USING ERRCODE='42501';END IF;
  IF p_action='file' THEN
   IF item.document_id IS NULL THEN RAISE EXCEPTION 'File not received' USING ERRCODE='22023';END IF;
   RETURN jsonb_build_object('documentId',item.document_id);
  END IF;
  IF item.actor_id<>p_actor THEN RAISE EXCEPTION 'Upload author required' USING ERRCODE='42501';END IF;
  IF p_action='upload_error' THEN
   INSERT INTO public.portal_document_events(organization_id,intake_id,event_key,state,note) VALUES(p_org,item.id,'upload-error','ERROR','Envio não confirmado. Consulte a equipe antes de repetir.') ON CONFLICT DO NOTHING;RETURN '{}';
  END IF;
  IF p_body-ARRAY['documentId']<>'{}' OR NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.organization_id=p_org AND d.customer_id=customer AND d.consumer_unit_id=item.consumer_unit_id AND d.id=p_body->>'documentId' AND d.file_hash=item.file_hash AND d.file_verified AND to_char(d.reference_month,'YYYY-MM')=item.month AND d.document_type=CASE item.kind WHEN 'INVOICE' THEN 'INVOICE_DISTRIBUTOR' WHEN 'FISCAL' THEN 'TAX_DOCUMENT' WHEN 'CONTRACT' THEN 'CONTRACT_ENERGY' WHEN 'ART' THEN 'COMPLIANCE_REPORT' WHEN 'TECHNICAL' THEN 'COMPLIANCE_REPORT' WHEN 'REPORT' THEN 'COMPLIANCE_REPORT' ELSE 'OTHER' END) THEN RAISE EXCEPTION 'Document binding changed' USING ERRCODE='42501';END IF;
  IF item.document_id IS NOT NULL AND item.document_id<>p_body->>'documentId' THEN RAISE EXCEPTION 'Document already bound' USING ERRCODE='40001';END IF;
  UPDATE public.portal_document_intakes SET document_id=p_body->>'documentId' WHERE id=item.id;
  INSERT INTO public.portal_document_events(organization_id,intake_id,event_key,state,source_id,note) VALUES(p_org,item.id,'received','RECEIVED',p_body->>'documentId','Arquivo recebido e vinculado ao cliente.') ON CONFLICT DO NOTHING;
  INSERT INTO public.portal_notification_outbox(organization_id,customer_id,recipient_id,event_key,kind,title,href,document_id) SELECT p_org,customer,m.user_id::text,'document:'||item.id,'DOCUMENT','Documento enviado pelo cliente','/backoffice/documents',p_body->>'documentId' FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND r.scope='organization' AND r.name IN('admin_org','gestor','operacional') AND m.user_id::text IN(SELECT jsonb_array_elements_text(coalesce(config->'ANALYST','[]'))) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('id',item.id,'documentId',p_body->>'documentId');
 ELSIF p_action='list' THEN
  IF NOT ext THEN RAISE EXCEPTION 'External portal required' USING ERRCODE='42501';END IF;
  SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM (SELECT i.id,i.document_id AS "documentId",i.consumer_unit_id AS "unitId",u.name AS "unitName",i.month,i.kind,i.filename,i.created_at AS "createdAt",i.consent,j.state AS "ocrState",i.record_id AS "recordId",
   (SELECT e.state FROM public.portal_document_events e WHERE e.intake_id=i.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS "intakeState",
   EXISTS(SELECT 1 FROM public.eva_closing_publications p JOIN public.eva_assisted_closing_versions v ON v.id=p.closing_id AND v.organization_id=p_org WHERE p.organization_id=p_org AND p.customer_id=customer AND v.month=i.month AND p.source_hash=v.payload_hash AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units') j(unit_body) WHERE unit_body->>'id'=i.consumer_unit_id AND unit_body->>'documentId'=i.document_id AND unit_body->>'sourceHash'=i.file_hash) AND (SELECT state FROM public.eva_closing_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 1)='PUBLISHED' AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)='APPROVED') AS published,
   EXISTS(SELECT 1 FROM public.calculation_preparation_runs a WHERE a.organization_id=p_org AND a.document_id=i.document_id AND a.source_hash=i.file_hash AND EXISTS(SELECT 1 FROM public.calculation_preparation_run_events e WHERE e.run_id=a.id AND e.organization_id=p_org AND e.sequence=2 AND e.state IN('PREPARED','PARTIAL'))) AS prepared
   FROM public.portal_document_intakes i JOIN public.consumer_units u ON u.organization_id=p_org AND u.customer_id=customer AND u.id=i.consumer_unit_id AND u.status='ACTIVE' LEFT JOIN public.document_ocr_jobs j ON j.organization_id=p_org AND j.document_id=i.document_id WHERE i.organization_id=p_org AND i.customer_id=customer ORDER BY i.created_at DESC,i.id DESC LIMIT 100)x;
  IF jsonb_array_length(result)>100 THEN RAISE EXCEPTION 'Use a narrower history' USING ERRCODE='22023';END IF;RETURN jsonb_build_object('rows',result);
 ELSIF p_action='requests' THEN
  IF NOT ext THEN RAISE EXCEPTION 'External portal required' USING ERRCODE='42501';END IF;
  SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM (SELECT r.id,r.operation_number AS number,r.title,r.status,r.portal_sector AS sector,r.due_at AS "dueAt",r.consumer_unit_id AS "unitId" FROM public.operation_records r WHERE r.organization_id=p_org AND r.customer_id=customer AND (r.portal_origin='CLIENT' OR EXISTS(SELECT 1 FROM public.operation_client_messages m WHERE m.organization_id=p_org AND m.record_id=r.id AND m.direction='OUTBOUND')) ORDER BY r.updated_at DESC,r.id DESC LIMIT 100)x;
  IF jsonb_array_length(result)>100 THEN RAISE EXCEPTION 'Request history too large' USING ERRCODE='22023';END IF;RETURN jsonb_build_object('rows',result);
 ELSIF p_action IN('notifications','read') THEN
  IF p_action='read' THEN
   IF NOT EXISTS(SELECT 1 FROM public.portal_notification_outbox WHERE organization_id=p_org AND recipient_id=p_actor AND id=p_id AND (NOT ext OR customer_id=customer)) THEN RAISE EXCEPTION 'Notification unavailable' USING ERRCODE='42501';END IF;
   INSERT INTO public.operation_notification_reads(organization_id,user_id,notification_key) VALUES(p_org,p_actor,'portal:'||p_id) ON CONFLICT DO NOTHING;RETURN '{"read":true}';
  END IF;
  SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM (SELECT n.id,n.title,n.href,n.kind,n.record_id AS "recordId",n.created_at AS date,EXISTS(SELECT 1 FROM public.operation_notification_reads WHERE organization_id=p_org AND user_id=p_actor AND notification_key='portal:'||n.id) AS read FROM public.portal_notification_outbox n WHERE n.organization_id=p_org AND n.recipient_id=p_actor AND (NOT ext OR n.customer_id=customer) ORDER BY n.created_at DESC,n.id DESC LIMIT 100)x;
  IF jsonb_array_length(result)>100 THEN RAISE EXCEPTION 'Notification history too large' USING ERRCODE='22023';END IF;RETURN jsonb_build_object('rows',result);
 END IF;
 RAISE EXCEPTION 'Unknown portal action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.portal_workspace_actor(text,text,text,boolean,text),public.portal_workspace_action(text,text,text,boolean,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.portal_workspace_action(text,text,text,boolean,text,uuid,jsonb) TO service_role;
COMMIT;
