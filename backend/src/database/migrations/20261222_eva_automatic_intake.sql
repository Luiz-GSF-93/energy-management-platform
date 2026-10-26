BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_automatic_intakes(
 id uuid PRIMARY KEY, organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text REFERENCES public.customers(id), actor_id text NOT NULL, role_id text NOT NULL,
 platform boolean NOT NULL, external boolean NOT NULL, request_id uuid NOT NULL,
 file_hash text NOT NULL CHECK(file_hash~'^[a-f0-9]{64}$'), filename text NOT NULL,
 mime text NOT NULL CHECK(mime IN('application/pdf','image/png','image/jpeg')), size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 20 AND 15728640),
 consent boolean NOT NULL, hints jsonb NOT NULL DEFAULT '{}', stored boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'RECEIVING' CHECK(state IN('RECEIVING','RECOGNIZING','OCR_QUEUED','OCR_SUBMITTING','OCR_POLLING','LINKING','WAITING_OCR','PREPARING','AWAITING_SOURCES','PROPOSAL_READY','REVIEW_REQUIRED','UNKNOWN','PUBLISHED','SOURCE_READY')),
 unit_id text REFERENCES public.consumer_units(id), month text CHECK(month~'^20[0-9]{2}-(0[1-9]|1[0-2])$'), document_type text,
 document_id text REFERENCES public.documents(id), proof jsonb, raw_result jsonb, operation_url text,
 signature text, closing_id uuid, ai_attempted boolean NOT NULL DEFAULT false,note text NOT NULL DEFAULT 'Arquivo em recebimento.',
 lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,request_id),UNIQUE(organization_id,file_hash),CHECK((lease_token IS NULL)=(lease_until IS NULL)),
 CHECK(NOT external OR customer_id IS NOT NULL)
);
CREATE TABLE public.eva_automatic_intake_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intake_id uuid NOT NULL REFERENCES public.eva_automatic_intakes(id),
 organization_id text NOT NULL,sequence integer NOT NULL,event text NOT NULL,state text NOT NULL,actor_id text NOT NULL,
 body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(intake_id,sequence)
);
CREATE TRIGGER preserve_eva_intake_history BEFORE UPDATE OR DELETE ON public.eva_automatic_intake_events FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();
ALTER TABLE public.eva_automatic_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eva_automatic_intakes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.eva_automatic_intake_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eva_automatic_intake_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.eva_automatic_intakes,public.eva_automatic_intake_events FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX eva_intake_ready ON public.eva_automatic_intakes(next_attempt_at,created_at);

-- Retained unidentified originals consume the same allowance, exactly once.
DO $$DECLARE definition text;copy text;BEGIN
 definition:=pg_get_functiondef('public.organization_resource_usage(text)'::regprocedure);
 copy:=replace(definition,'FUNCTION public.organization_resource_usage(','FUNCTION public.organization_resource_usage_before_intake(');
 IF copy=definition THEN RAISE EXCEPTION 'Review resource-usage signature before migration';END IF;
 EXECUTE copy;
END$$;
REVOKE ALL ON FUNCTION public.organization_resource_usage_before_intake(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.organization_resource_usage(org text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_set(v,'{documents}',to_jsonb((v->>'documents')::bigint+(SELECT count(*) FROM public.eva_automatic_intakes WHERE organization_id=org AND document_id IS NULL))) FROM public.organization_resource_usage_before_intake(org)v;
$$;

CREATE FUNCTION public.eva_intake_actor(p_org text,p_actor text,p_role text,p_platform boolean,p_customer text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;lic public.licenses;
BEGIN
 a:=public.portal_workspace_actor(p_org,p_actor,p_role,p_platform,'documents');
 IF a->>'external'='true' THEN
  IF p_customer IS NOT NULL AND p_customer IS DISTINCT FROM a->>'customerId' THEN RAISE EXCEPTION 'Client scope changed' USING ERRCODE='42501';END IF;
 ELSIF NOT p_platform AND NOT EXISTS(SELECT 1 FROM public.roles r JOIN public.organization_members m ON m.organization_id=r.organization_id AND m.role_id=r.id WHERE r.organization_id=p_org AND r.id::text=p_role AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND r.permissions @> '["8f105b02-4443-49de-b188-847e0284e7ed","8f3ff5eb-157a-468a-91af-6f89d92e23a7"]'::jsonb) THEN
  RAISE EXCEPTION 'Document permissions required' USING ERRCODE='42501';
 END IF;
 IF p_customer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers WHERE organization_id=p_org AND id=p_customer AND status='ACTIVE' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Client unavailable' USING ERRCODE='42501';END IF;
 IF(SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=current_date AND(end_date IS NULL OR end_date>=current_date) AND document_management)<>1 THEN RAISE EXCEPTION 'Unique document license required' USING ERRCODE='42501';END IF;
 RETURN a;
END$$;
CREATE FUNCTION public.eva_intake_event(p_id uuid,p_event text,p_body jsonb DEFAULT '{}',p_actor text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;
BEGIN
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id FOR UPDATE;
 INSERT INTO public.eva_automatic_intake_events(intake_id,organization_id,sequence,event,state,actor_id,body)
 SELECT i.id,i.organization_id,coalesce(max(sequence),0)+1,p_event,i.state,coalesce(p_actor,i.actor_id),p_body FROM public.eva_automatic_intake_events WHERE intake_id=i.id;
END$$;
CREATE FUNCTION public.eva_intake_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;i public.eva_automatic_intakes;customer text;lic public.licenses;used bigint;existing_document public.documents;
BEGIN
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>12000 THEN RAISE EXCEPTION 'Invalid intake request' USING ERRCODE='22023';END IF;
 a:=public.eva_intake_actor(p_org,p_actor,p_role,p_platform,p_body->>'customerId');
 customer:=CASE WHEN a->>'external'='true' THEN a->>'customerId' ELSE p_body->>'customerId' END;
 IF p_action='list' THEN
  RETURN jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'createdAt' DESC),'[]') FROM(SELECT jsonb_build_object('id',id,'filename',filename,'state',state,'month',month,'customerId',customer_id,'unitId',unit_id,'documentId',document_id,'documentType',document_type,'note',CASE WHEN a->>'external'='true' THEN CASE state WHEN 'PUBLISHED' THEN 'Publicado.' WHEN 'PROPOSAL_READY' THEN 'Preenchimento concluído. Em conferência pela equipe.' WHEN 'AWAITING_SOURCES' THEN 'Recebido. A equipe está conferindo as informações complementares.' WHEN 'REVIEW_REQUIRED' THEN 'Recebido. A equipe precisa conferir o vínculo ou a leitura.' WHEN 'UNKNOWN' THEN 'Recebido. A equipe está conferindo o processamento.' ELSE 'Reconhecimento e preparação em andamento.' END ELSE note END,'createdAt',created_at)x FROM public.eva_automatic_intakes WHERE organization_id=p_org AND (a->>'external'<>'true' OR customer_id=customer) AND (customer IS NULL OR customer_id=customer) ORDER BY created_at DESC LIMIT 100)s));
 ELSIF p_action='source' THEN
  SELECT * INTO i FROM public.eva_automatic_intakes WHERE id=p_id AND organization_id=p_org AND stored AND(a->>'external'<>'true' OR customer_id=customer);
  IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable for actor' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('hash',i.file_hash,'size',i.size_bytes,'mime',i.mime,'filename',i.filename);
 ELSIF p_action='reserve' THEN
  IF p_id IS NULL OR NOT(p_body ?& ARRAY['requestId','hash','filename','mime','size','consent','hints']) OR p_body-ARRAY['customerId','requestId','hash','filename','mime','size','consent','hints']<>'{}' OR coalesce(p_body->>'hash','') !~ '^[a-f0-9]{64}$' OR coalesce(length(p_body->>'filename'),0) NOT BETWEEN 1 AND 255 OR coalesce(p_body->>'mime','') NOT IN('application/pdf','image/png','image/jpeg') OR coalesce((p_body->>'size')::integer,0) NOT BETWEEN 20 AND 15728640 OR jsonb_typeof(p_body->'consent') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_body->'hints') IS DISTINCT FROM 'object' OR (p_body->'hints')-ARRAY['unitId','month']<>'{}' THEN RAISE EXCEPTION 'Invalid intake metadata' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
  SELECT * INTO i FROM public.eva_automatic_intakes WHERE organization_id=p_org AND(request_id=(p_body->>'requestId')::uuid OR file_hash=p_body->>'hash') ORDER BY created_at LIMIT 1;
  IF FOUND THEN
   IF i.file_hash<>p_body->>'hash' OR i.customer_id IS DISTINCT FROM customer AND customer IS NOT NULL OR i.actor_id=p_actor AND i.hints IS DISTINCT FROM p_body->'hints' THEN RAISE EXCEPTION 'Original request changed' USING ERRCODE='40001';END IF;
   IF NOT i.consent AND p_body->>'consent'='true' THEN UPDATE public.eva_automatic_intakes SET consent=true,next_attempt_at=clock_timestamp() WHERE id=i.id;PERFORM public.eva_intake_event(i.id,'CONSENT_GRANTED','{}',p_actor);END IF;
   RETURN jsonb_build_object('id',i.id,'replayed',true,'stored',i.stored,'state',i.state,'customerId',i.customer_id);
  END IF;
  SELECT * INTO STRICT lic FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=current_date AND(end_date IS NULL OR end_date>=current_date) AND document_management;
  used:=(public.organization_resource_usage(p_org)->>'documents')::bigint;
  SELECT * INTO existing_document FROM public.documents WHERE organization_id=p_org AND file_hash=p_body->>'hash';
  IF FOUND AND (NOT existing_document.file_verified OR customer IS NOT NULL AND existing_document.customer_id<>customer OR existing_document.file_size_bytes<>(p_body->>'size')::integer) THEN RAISE EXCEPTION 'Existing original has another scope' USING ERRCODE='42501';END IF;
  IF existing_document.id IS NULL AND(lic.plan_id IS NULL OR NOT lic.documents_unlimited AND(lic.documents_limit IS NULL OR used>=lic.documents_limit)) THEN RAISE EXCEPTION 'Document allowance exceeded' USING ERRCODE='P3391';END IF;
  INSERT INTO public.eva_automatic_intakes(id,organization_id,customer_id,actor_id,role_id,platform,external,request_id,file_hash,filename,mime,size_bytes,consent,hints) VALUES(p_id,p_org,customer,p_actor,p_role,p_platform,(a->>'external')::boolean,(p_body->>'requestId')::uuid,p_body->>'hash',p_body->>'filename',p_body->>'mime',(p_body->>'size')::integer,(p_body->>'consent')::boolean,p_body->'hints') RETURNING * INTO i;
  IF existing_document.id IS NOT NULL THEN UPDATE public.eva_automatic_intakes SET document_id=existing_document.id WHERE id=i.id;END IF;
  PERFORM public.eva_intake_event(i.id,'RECEIVED');
  RETURN jsonb_build_object('id',i.id,'replayed',false,'stored',false,'state',i.state,'customerId',i.customer_id);
 ELSIF p_action='stored' THEN
  SELECT * INTO i FROM public.eva_automatic_intakes WHERE id=p_id AND organization_id=p_org AND(a->>'external'<>'true' OR customer_id=customer) FOR UPDATE;
  IF NOT FOUND OR i.file_hash IS DISTINCT FROM p_body->>'hash' THEN RAISE EXCEPTION 'Original source unavailable' USING ERRCODE='42501';END IF;
  IF NOT i.stored THEN UPDATE public.eva_automatic_intakes SET stored=true,state='RECOGNIZING',updated_at=clock_timestamp() WHERE id=i.id;PERFORM public.eva_intake_event(i.id,'STORED','{}',p_actor);END IF;
  RETURN jsonb_build_object('id',i.id,'state','RECOGNIZING');
 ELSIF p_action='resolve' AND a->>'external'='false' THEN
  SELECT * INTO i FROM public.eva_automatic_intakes WHERE id=p_id AND organization_id=p_org AND state='REVIEW_REQUIRED' FOR UPDATE;
  IF NOT FOUND OR p_body-ARRAY['customerId','unitId','month','reason']<>'{}' OR coalesce(length(btrim(p_body->>'reason')),0) NOT BETWEEN 10 AND 1000 OR coalesce(p_body->>'month','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' OR i.external AND i.customer_id IS DISTINCT FROM p_body->>'customerId' OR NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE organization_id=p_org AND customer_id=p_body->>'customerId' AND id=p_body->>'unitId' AND status='ACTIVE') THEN RAISE EXCEPTION 'Invalid source review' USING ERRCODE='42501';END IF;
  UPDATE public.eva_automatic_intakes SET customer_id=p_body->>'customerId',hints=jsonb_build_object('unitId',p_body->>'unitId','month',p_body->>'month'),state='RECOGNIZING',next_attempt_at=clock_timestamp(),note='Vínculo indicado pelo backoffice; o conteúdo será reconferido sem confirmação financeira.' WHERE id=i.id;
  PERFORM public.eva_intake_event(i.id,'SOURCE_REVIEW',p_body||jsonb_build_object('reviewedBy',p_actor),p_actor);
  RETURN jsonb_build_object('id',i.id,'state','RECOGNIZING');
 ELSE RAISE EXCEPTION 'Unknown intake action' USING ERRCODE='22023';END IF;
END$$;

-- Deliberately checks current permissions and the current delegation each time.
CREATE FUNCTION public.eva_intake_work_context(p_id uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;a jsonb;policy public.portal_service_routing;delegate record;customers jsonb;units jsonb;
BEGIN
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp();
 a:=public.eva_intake_actor(i.organization_id,i.actor_id,i.role_id,i.platform,i.customer_id);
 SELECT * INTO policy FROM public.portal_service_routing WHERE organization_id=i.organization_id AND kind='ROUTING' AND owner_user_id='organization' ORDER BY revision DESC LIMIT 1;
 IF policy.body->>'enabled' IS DISTINCT FROM 'true' OR policy.body->>'automationEnabled' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Automation delegation unavailable' USING ERRCODE='42501';END IF;
 SELECT m.user_id::text AS id,r.id::text AS role_id,r.name,r.permissions INTO delegate FROM public.organization_members m JOIN public.roles r ON r.organization_id=m.organization_id AND r.id=m.role_id AND r.scope='organization' WHERE m.organization_id=i.organization_id AND m.user_id::text=policy.body->>'automationActor' AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND r.name IN('admin_org','gestor');
 IF NOT FOUND OR NOT coalesce(delegate.permissions @> '["8f105b02-4443-49de-b188-847e0284e7ed","92e1b670-ab10-483a-b825-c6e16799496d","60f9690a-145b-4dba-b23f-9f945baca296","beb6ec90-8ba8-40ce-a156-aeef6cc75cce"]'::jsonb,false) THEN RAISE EXCEPTION 'Delegated actor revoked' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') INTO customers FROM(SELECT id,document,company_name FROM public.customers WHERE organization_id=i.organization_id AND status='ACTIVE' AND deleted_at IS NULL AND(i.customer_id IS NULL OR id=i.customer_id) ORDER BY id LIMIT 501)c;
 SELECT coalesce(jsonb_agg(to_jsonb(u)),'[]') INTO units FROM(SELECT id,customer_id,consumer_unit_number,address FROM public.consumer_units WHERE organization_id=i.organization_id AND status='ACTIVE' AND(i.customer_id IS NULL OR customer_id=i.customer_id) ORDER BY id LIMIT 1001)u;
 IF jsonb_array_length(customers)>500 OR jsonb_array_length(units)>1000 THEN RAISE EXCEPTION 'Recognition scope too large' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('intake',to_jsonb(i)||jsonb_build_object('raw_result',coalesce(i.raw_result,(SELECT r.raw_result FROM public.document_ocr_results r JOIN public.document_ocr_jobs j ON j.id=r.job_id AND j.organization_id=i.organization_id AND j.document_id=i.document_id AND j.state='SUCCEEDED' WHERE r.organization_id=i.organization_id AND r.document_id=i.document_id AND r.file_hash=i.file_hash LIMIT 1))),'customers',customers,'units',units,'delegate',jsonb_build_object('userId',delegate.id,'roleId',delegate.role_id,'role',delegate.name,'permissions',delegate.permissions),'policyId',policy.id);
END$$;

CREATE FUNCTION public.claim_eva_automatic_intake(p_organizations text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;c jsonb;
BEGIN
 IF cardinality(p_organizations) NOT BETWEEN 1 AND 100 THEN RETURN NULL;END IF;
 FOR i IN UPDATE public.eva_automatic_intakes SET state='UNKNOWN',lease_token=NULL,lease_until=NULL,note='Resultado incerto. Conferir histórico antes de repetir.',updated_at=clock_timestamp() WHERE organization_id=ANY(p_organizations) AND state IN('OCR_SUBMITTING','PREPARING') AND lease_until<clock_timestamp() RETURNING * LOOP PERFORM public.eva_intake_event(i.id,'LEASE_EXPIRED','{}','system:lease-reconciliation');END LOOP;
 FOR i IN SELECT * FROM public.eva_automatic_intakes WHERE organization_id=ANY(p_organizations) AND stored AND consent AND next_attempt_at<=clock_timestamp() AND(lease_until IS NULL OR lease_until<clock_timestamp()) AND state IN('RECOGNIZING','OCR_QUEUED','OCR_POLLING','LINKING','WAITING_OCR','AWAITING_SOURCES','PROPOSAL_READY') ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 20 LOOP
  UPDATE public.eva_automatic_intakes SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1,updated_at=clock_timestamp() WHERE id=i.id RETURNING * INTO i;
  BEGIN c:=public.eva_intake_work_context(i.id,i.lease_token);
  EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '22023' THEN UPDATE public.eva_automatic_intakes SET state='REVIEW_REQUIRED',lease_token=NULL,lease_until=NULL,note='Autorização ou escopo exige conferência; nenhuma nova leitura foi iniciada.' WHERE id=i.id;PERFORM public.eva_intake_event(i.id,'ACCESS_REVIEW','{}','system:scope-check');CONTINUE;END;
  RETURN jsonb_build_object('id',i.id,'token',i.lease_token,'context',c);
 END LOOP;RETURN NULL;
END$$;
CREATE FUNCTION public.eva_intake_unit_aliases(p_id uuid,p_token uuid,p_unit text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb;u jsonb;
BEGIN
 c:=public.eva_intake_work_context(p_id,p_token);
 SELECT x INTO u FROM jsonb_array_elements(c->'units')x WHERE x->>'id'=p_unit;
 IF u IS NULL THEN RAISE EXCEPTION 'Unit outside intake scope' USING ERRCODE='42501';END IF;
 RETURN public.ocr_identity_unit_lineage(c#>>'{intake,organization_id}',u->>'customer_id',p_unit,u->>'consumer_unit_number');
END$$;
CREATE FUNCTION public.transition_eva_automatic_intake(p_id uuid,p_token uuid,p_action text,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;ctx jsonb;recognized jsonb;d public.documents;job public.document_ocr_jobs;n integer;next_state text;proposed_complete boolean;
BEGIN
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 ctx:=public.eva_intake_work_context(i.id,p_token);
 IF jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>18000000 THEN RAISE EXCEPTION 'Invalid transition body' USING ERRCODE='22023';END IF;
 next_state:=i.state;
 IF p_action='recognized' AND i.state IN('RECOGNIZING','OCR_POLLING') THEN
  recognized:=p_body->'proof';
   IF recognized->>'version' IS DISTINCT FROM 'automatic-intake-context-1' OR recognized->>'state' IS DISTINCT FROM 'MATCH' OR recognized->>'fileHash' IS DISTINCT FROM i.file_hash OR coalesce(recognized->>'documentType','') NOT IN('INVOICE_DISTRIBUTOR','INVOICE_SUPPLIER') OR coalesce(recognized->>'month','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' OR i.customer_id IS NOT NULL AND i.customer_id IS DISTINCT FROM recognized->>'customerId' OR NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.organization_id=u.organization_id AND c.id=u.customer_id WHERE u.organization_id=i.organization_id AND u.id=recognized->>'unitId' AND u.customer_id=recognized->>'customerId' AND u.status='ACTIVE' AND c.status='ACTIVE' AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'Recognized scope mismatch' USING ERRCODE='42501';END IF;
  UPDATE public.eva_automatic_intakes SET customer_id=recognized->>'customerId',unit_id=recognized->>'unitId',month=recognized->>'month',document_type=recognized->>'documentType',proof=recognized WHERE id=i.id;next_state:='LINKING';
 ELSIF p_action='need_ocr' AND i.state='RECOGNIZING' THEN next_state:='OCR_QUEUED';
 ELSIF p_action='use_existing_ocr' AND i.state='OCR_QUEUED' AND EXISTS(SELECT 1 FROM public.document_ocr_jobs j JOIN public.document_ocr_results r ON r.job_id=j.id AND r.organization_id=j.organization_id AND r.document_id=j.document_id WHERE j.organization_id=i.organization_id AND j.document_id=i.document_id AND j.file_hash=i.file_hash AND r.file_hash=i.file_hash AND j.state='SUCCEEDED') THEN next_state:='RECOGNIZING';
 ELSIF p_action='begin_ocr' AND i.state='OCR_QUEUED' AND i.operation_url IS NULL AND i.raw_result IS NULL THEN next_state:='OCR_SUBMITTING';
 ELSIF p_action='accepted' AND i.state='OCR_SUBMITTING' AND length(p_body->>'operation') BETWEEN 10 AND 2000 THEN UPDATE public.eva_automatic_intakes SET operation_url=p_body->>'operation' WHERE id=i.id;next_state:='OCR_POLLING';
 ELSIF p_action='retry_ocr' AND i.state='OCR_SUBMITTING' AND p_body->>'error'='RATE_LIMITED' AND i.operation_url IS NULL THEN next_state:='OCR_QUEUED';
 ELSIF p_action='raw' AND i.state='OCR_POLLING' AND i.raw_result IS NULL AND jsonb_typeof(p_body->'raw')='object' THEN UPDATE public.eva_automatic_intakes SET raw_result=p_body->'raw' WHERE id=i.id;
 ELSIF p_action='linked' AND i.state='LINKING' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(i.organization_id,315));
  SELECT * INTO d FROM public.documents WHERE organization_id=i.organization_id AND file_hash=i.file_hash;
  IF FOUND THEN
   IF d.customer_id<>i.customer_id OR d.consumer_unit_id<>i.unit_id OR to_char(d.reference_month,'YYYY-MM')<>i.month OR d.document_type<>i.document_type OR NOT d.file_verified THEN RAISE EXCEPTION 'Existing document has another scope' USING ERRCODE='40001';END IF;
  ELSE
   -- Transfer the retained-file allowance atomically, before the normal document quota trigger.
   UPDATE public.eva_automatic_intakes SET document_id=NULL WHERE id=i.id;
   IF p_body->>'path' IS DISTINCT FROM (i.organization_id||'/'||i.unit_id||'/eva-intake-'||i.id::text||CASE i.mime WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' ELSE '.jpg' END) THEN RAISE EXCEPTION 'Unexpected file path' USING ERRCODE='42501';END IF;
   -- The temporary transfer is excluded by organization_resource_usage below through the lease state.
   UPDATE public.eva_automatic_intakes SET state='LINKING',note='ATOMIC_DOCUMENT_TRANSFER' WHERE id=i.id;
   INSERT INTO public.documents(id,organization_id,customer_id,consumer_unit_id,document_type,reference_month,original_filename,mime_type,file_hash,file_size_bytes,file_path,storage_bucket,file_verified,file_verified_at,uploaded_by_auth_user_id,license_check_passed,processing_status,ocr_status,description)
   VALUES(i.id::text,i.organization_id,i.customer_id,i.unit_id,i.document_type,(i.month||'-01')::date,i.filename,i.mime,i.file_hash,i.size_bytes,p_body->>'path','energy-documents-private',true,clock_timestamp(),i.actor_id,true,'PENDING','PENDING','Recebimento automático EVA · '||i.id) RETURNING * INTO d;
  END IF;
  UPDATE public.eva_automatic_intakes SET document_id=d.id WHERE id=i.id;
  IF i.document_type='INVOICE_DISTRIBUTOR' AND i.raw_result IS NOT NULL THEN
   PERFORM public.assert_invoice_month_ocr(i.organization_id,d.id);
   IF i.operation_url IS NULL THEN RAISE EXCEPTION 'Original OCR operation missing' USING ERRCODE='40001';END IF;
   -- Reserve the completed operation in the existing queue atomically with the
   -- document. The normal worker resumes by GET; there is no second POST gap.
   INSERT INTO public.document_ocr_jobs(organization_id,document_id,file_hash,requested_by,state,operation_url) VALUES(i.organization_id,d.id,i.file_hash,ctx#>>'{delegate,userId}','POLLING',i.operation_url) ON CONFLICT(organization_id,document_id) DO NOTHING;
  END IF;
  next_state:=CASE i.document_type WHEN 'INVOICE_DISTRIBUTOR' THEN 'WAITING_OCR' ELSE 'SOURCE_READY' END;
 ELSIF p_action='begin_prepare' AND i.state IN('WAITING_OCR','AWAITING_SOURCES','PROPOSAL_READY') THEN
  IF NOT EXISTS(SELECT 1 FROM public.document_ocr_jobs WHERE organization_id=i.organization_id AND document_id=i.document_id AND state='SUCCEEDED' AND file_hash=i.file_hash) THEN RAISE EXCEPTION 'Completed OCR required' USING ERRCODE='42501';END IF;
  next_state:='PREPARING';
 ELSIF p_action='begin_interpret' AND i.state='PREPARING' AND NOT i.ai_attempted THEN
  UPDATE public.eva_automatic_intakes SET ai_attempted=true WHERE id=i.id;
 ELSIF p_action='prepared' AND i.state='PREPARING' THEN
  SELECT coalesce((v.report#>>'{preparation,percent}')::numeric=100,false) OR coalesce((v.report->>'approvalEligible')::boolean,false) INTO proposed_complete FROM public.eva_assisted_closing_versions v WHERE v.id=(p_body->>'closingId')::uuid AND v.organization_id=i.organization_id AND v.customer_id=i.customer_id AND v.month=i.month AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units')u WHERE u->>'id'=i.unit_id AND u->>'documentId'=i.document_id AND u->>'sourceHash'=i.file_hash) AND(SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1) IN('INCOMPLETE','READY_FOR_REVIEW');
  IF NOT FOUND OR proposed_complete IS DISTINCT FROM(p_body->>'complete')::boolean THEN RAISE EXCEPTION 'Closing source mismatch' USING ERRCODE='42501';END IF;
  UPDATE public.eva_automatic_intakes SET closing_id=(p_body->>'closingId')::uuid,signature=p_body->>'signature' WHERE id=i.id;
  next_state:=CASE WHEN proposed_complete THEN 'PROPOSAL_READY' ELSE 'AWAITING_SOURCES' END;
 ELSIF p_action='wait' AND i.state NOT IN('OCR_SUBMITTING','PREPARING','UNKNOWN') THEN NULL;
 ELSIF p_action='unknown' THEN next_state:='UNKNOWN';
 ELSIF p_action='review' AND i.state NOT IN('PREPARING','OCR_SUBMITTING') THEN next_state:='REVIEW_REQUIRED';
 ELSIF p_action='published' AND EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.id=(p_body->>'closingId')::uuid AND v.organization_id=i.organization_id AND v.customer_id=i.customer_id AND v.month=i.month AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units')u WHERE u->>'id'=i.unit_id AND u->>'documentId'=i.document_id AND u->>'sourceHash'=i.file_hash) AND EXISTS(SELECT 1 FROM public.eva_assisted_closing_events e WHERE e.closing_id=v.id AND e.state='APPROVED')) THEN UPDATE public.eva_automatic_intakes SET closing_id=(p_body->>'closingId')::uuid WHERE id=i.id;next_state:='PUBLISHED';
 ELSE RAISE EXCEPTION 'Invalid intake transition' USING ERRCODE='22023';END IF;
 UPDATE public.eva_automatic_intakes SET state=next_state,note=left(coalesce(p_body->>'note','Fonte preservada. Processamento em andamento.'),500),lease_token=CASE WHEN p_action IN('begin_ocr','raw','recognized','begin_prepare','begin_interpret','use_existing_ocr') THEN lease_token ELSE NULL END,lease_until=CASE WHEN p_action IN('begin_ocr','raw','recognized','begin_prepare','begin_interpret','use_existing_ocr') THEN lease_until ELSE NULL END,next_attempt_at=CASE WHEN p_action='prepared' AND p_body->>'sourcesChanged'='false' OR p_action='wait' AND i.state IN('AWAITING_SOURCES','PROPOSAL_READY') THEN 'infinity'::timestamptz ELSE clock_timestamp()+make_interval(secs=>CASE WHEN p_action='retry_ocr' THEN greatest(30,least(coalesce((p_body->>'delay')::integer,30),3600)) WHEN p_action='wait' THEN 30 ELSE 5 END) END,updated_at=clock_timestamp() WHERE id=i.id;
 PERFORM public.eva_intake_event(i.id,p_action,jsonb_build_object('proof',p_body->'proof','closingId',p_body->>'closingId','signature',p_body->>'signature','note',p_body->>'note'),ctx#>>'{delegate,userId}');
 RETURN jsonb_build_object('id',i.id,'state',next_state);
END$$;

-- Include pending originals, excluding only the in-transaction document transfer.
CREATE OR REPLACE FUNCTION public.organization_resource_usage(org text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_set(v,'{documents}',to_jsonb((v->>'documents')::bigint+(SELECT count(*) FROM public.eva_automatic_intakes WHERE organization_id=org AND document_id IS NULL AND NOT(state='LINKING' AND note='ATOMIC_DOCUMENT_TRANSFER')))) FROM public.organization_resource_usage_before_intake(org)v;
$$;
CREATE FUNCTION public.eva_intake_supplier_text(p_org text,p_customer text,p_unit text,p_document text,p_hash text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT i.raw_result->>'content' FROM public.eva_automatic_intakes i JOIN public.documents d ON d.id=i.document_id AND d.organization_id=i.organization_id WHERE i.organization_id=p_org AND i.customer_id=p_customer AND i.unit_id=p_unit AND i.document_id=p_document AND i.file_hash=p_hash AND i.document_type='INVOICE_SUPPLIER' AND i.proof->>'state'='MATCH' AND d.customer_id=p_customer AND d.consumer_unit_id=p_unit AND d.file_hash=p_hash AND d.file_verified;
$$;
CREATE FUNCTION public.eva_intake_identity_text(p_org text,p_customer text,p_unit text,p_document text,p_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('text',i.raw_result->>'content','pages',(SELECT jsonb_agg(p->'pageNumber') FROM jsonb_array_elements(i.raw_result->'pages')p),'lineage',public.ocr_identity_unit_lineage(p_org,p_customer,p_unit,u.consumer_unit_number)) FROM public.eva_automatic_intakes i JOIN public.documents d ON d.id=i.document_id AND d.organization_id=i.organization_id JOIN public.consumer_units u ON u.id=d.consumer_unit_id AND u.organization_id=d.organization_id AND u.customer_id=d.customer_id WHERE i.organization_id=p_org AND i.customer_id=p_customer AND i.unit_id=p_unit AND i.document_id=p_document AND i.file_hash=p_hash AND i.document_type='INVOICE_DISTRIBUTOR' AND i.proof->>'state'='MATCH' AND i.raw_result IS NOT NULL AND d.customer_id=p_customer AND d.consumer_unit_id=p_unit AND d.file_hash=p_hash AND d.file_verified AND u.status='ACTIVE';
$$;
CREATE FUNCTION public.eva_intake_reference_signature(p_id uuid,p_token uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb;i public.eva_automatic_intakes;prices jsonb;settlements jsonb;approvals jsonb;
BEGIN
 c:=public.eva_intake_work_context(p_id,p_token);SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') INTO prices FROM public.contract_price_history p JOIN public.energy_contracts e ON e.id=p.contract_id WHERE e.organization_id=i.organization_id AND e.customer_id=i.customer_id AND e.consumer_unit_id=i.unit_id;
 SELECT coalesce(jsonb_agg(jsonb_build_array(id,month,version_number,financial_hash,status,validation_status,approved_at,published_at) ORDER BY month,version_number,id),'[]') INTO settlements FROM public.monthly_energy_settlements WHERE organization_id=i.organization_id AND customer_id=i.customer_id AND consumer_unit_id=i.unit_id AND month<(i.month||'-01')::date AND month>=((i.month||'-01')::date-interval '6 months');
 SELECT coalesce(jsonb_agg(jsonb_build_array(v.id,v.month,v.payload_hash,(SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)) ORDER BY v.month,v.id),'[]') INTO approvals FROM public.eva_assisted_closing_versions v WHERE v.organization_id=i.organization_id AND v.customer_id=i.customer_id AND v.month<i.month AND v.month>=to_char((i.month||'-01')::date-interval '6 months','YYYY-MM') AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units')u WHERE u->>'id'=i.unit_id);
 IF jsonb_array_length(prices)>1000 OR jsonb_array_length(settlements)>500 OR jsonb_array_length(approvals)>500 THEN RAISE EXCEPTION 'Reference history too large' USING ERRCODE='22023';END IF;
 RETURN md5(jsonb_build_array(prices,settlements,approvals)::text);
END$$;
REVOKE ALL ON FUNCTION public.organization_resource_usage(text),public.eva_intake_actor(text,text,text,boolean,text),public.eva_intake_event(uuid,text,jsonb,text),public.eva_intake_action(text,text,text,boolean,text,uuid,jsonb),public.eva_intake_work_context(uuid,uuid),public.claim_eva_automatic_intake(text[]),public.transition_eva_automatic_intake(uuid,uuid,text,jsonb),public.eva_intake_supplier_text(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.organization_resource_usage(text),public.eva_intake_action(text,text,text,boolean,text,uuid,jsonb),public.eva_intake_work_context(uuid,uuid),public.claim_eva_automatic_intake(text[]),public.transition_eva_automatic_intake(uuid,uuid,text,jsonb),public.eva_intake_supplier_text(text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.eva_intake_unit_aliases(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_unit_aliases(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.eva_intake_identity_text(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_identity_text(text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.eva_intake_reference_signature(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_reference_signature(uuid,uuid) TO service_role;
CREATE FUNCTION public.wake_eva_intake_sources() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;org text;customer text;unit text;closing public.eva_assisted_closing_versions;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;org:=r->>'organization_id';customer:=r->>'customer_id';unit:=r->>'consumer_unit_id';
 IF TG_TABLE_NAME='consumer_units' THEN unit:=r->>'id';END IF;
 IF TG_TABLE_NAME='contract_price_history' THEN SELECT organization_id,customer_id,consumer_unit_id INTO org,customer,unit FROM public.energy_contracts WHERE id=r->>'contract_id';END IF;
 IF TG_TABLE_NAME='eva_assisted_closing_events' THEN SELECT * INTO closing FROM public.eva_assisted_closing_versions WHERE id=(r->>'closing_id')::uuid;org:=closing.organization_id;customer:=closing.customer_id;END IF;
 UPDATE public.eva_automatic_intakes SET next_attempt_at=clock_timestamp() WHERE organization_id=org AND(customer IS NULL OR customer_id=customer) AND(unit IS NULL OR unit_id=unit) AND state IN('AWAITING_SOURCES','PROPOSAL_READY') AND lease_token IS NULL;
 RETURN NULL;
END$$;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['documents','consumer_units','energy_contracts','contract_price_history','calculation_parameters','calculation_monthly_inputs','calculation_monthly_costs','supplier_billing_rules','supplier_spot_reconciliations','calculation_cost_absences','management_contracts','management_fee_allocations','commercial_fee_adjustments','tariff_library_versions','monthly_energy_settlements','eva_assisted_closing_events'] LOOP IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('CREATE TRIGGER wake_eva_automatic_intake AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.wake_eva_intake_sources()',t);END IF;END LOOP;END$$;
REVOKE ALL ON FUNCTION public.wake_eva_intake_sources() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
