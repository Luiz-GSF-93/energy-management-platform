BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.legal_audit_sources(
 id text NOT NULL CHECK(id ~ '^[a-z0-9-]{3,80}$'),version integer NOT NULL CHECK(version>0),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(id,version)
);
CREATE TABLE public.legal_audit_jobs(
 id uuid PRIMARY KEY,organization_id text NOT NULL,customer_id text NOT NULL,unit_id text NOT NULL,
 document_id text NOT NULL REFERENCES public.documents(id),source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 actor_id text NOT NULL,role_id text NOT NULL,platform boolean NOT NULL,as_of date NOT NULL,
 basis text NOT NULL CHECK(basis ~ '^[a-f0-9]{64}$'),sources jsonb NOT NULL,library_version text NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','EXTRACTING','OCR_SUBMITTING','OCR_POLLING','ANALYZING','REPORTING','COMPLETED','NEEDS_REVIEW','TECHNICAL_REVIEW','ACCESS_REQUIRED','FAILED')),
 pages jsonb NOT NULL DEFAULT '[]',narratives jsonb NOT NULL DEFAULT '[]',cursor integer NOT NULL DEFAULT 0 CHECK(cursor BETWEEN 0 AND 150),
 operation_url text,report jsonb,report_document_id text NOT NULL DEFAULT gen_random_uuid()::text UNIQUE,report_hash text,
 quota_units integer NOT NULL CHECK(quota_units IN(0,1)),attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 note text NOT NULL DEFAULT 'Recebido; aguardando leitura.',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,document_id,basis),CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX legal_audit_ready ON public.legal_audit_jobs(next_attempt_at,created_at) WHERE state IN('QUEUED','OCR_POLLING','ANALYZING','REPORTING');
CREATE INDEX legal_audit_organization_recent ON public.legal_audit_jobs(organization_id,created_at DESC,id DESC);
CREATE INDEX legal_audit_live_leases ON public.legal_audit_jobs(lease_until) WHERE lease_until IS NOT NULL;
CREATE TABLE public.legal_audit_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,job_id uuid NOT NULL REFERENCES public.legal_audit_jobs(id),organization_id text NOT NULL,
 state text NOT NULL,kind text NOT NULL,body jsonb NOT NULL DEFAULT '{}',actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.legal_audit_questions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,job_id uuid NOT NULL REFERENCES public.legal_audit_jobs(id),actor_id text NOT NULL,question_hash text NOT NULL,question text NOT NULL,state text NOT NULL DEFAULT 'REQUESTED' CHECK(state IN('REQUESTED','ANSWERED')),answer jsonb,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(job_id,actor_id,question_hash));
CREATE INDEX legal_audit_event_history ON public.legal_audit_events(organization_id,job_id,id);
CREATE FUNCTION public.legal_audit_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'Legal audit history immutable' USING ERRCODE='23514';END$$;
CREATE TRIGGER legal_sources_immutable BEFORE UPDATE OR DELETE ON public.legal_audit_sources FOR EACH ROW EXECUTE FUNCTION public.legal_audit_immutable();
CREATE TRIGGER legal_events_immutable BEFORE UPDATE OR DELETE ON public.legal_audit_events FOR EACH ROW EXECUTE FUNCTION public.legal_audit_immutable();
ALTER TABLE public.legal_audit_sources ENABLE ROW LEVEL SECURITY;ALTER TABLE public.legal_audit_jobs ENABLE ROW LEVEL SECURITY;ALTER TABLE public.legal_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_audit_questions ENABLE ROW LEVEL SECURITY;REVOKE ALL ON public.legal_audit_questions FROM PUBLIC,anon,authenticated,service_role;GRANT SELECT ON public.legal_audit_questions TO service_role;
REVOKE ALL ON public.legal_audit_sources,public.legal_audit_jobs,public.legal_audit_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.legal_audit_sources,public.legal_audit_jobs,public.legal_audit_events TO service_role;

CREATE FUNCTION public.legal_audit_actor(o text,a text,rid text,operation boolean,writing boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE member_row record;perms jsonb;role_name text;
BEGIN
 IF o IS NULL OR a IS NULL OR rid IS NULL OR operation IS NULL OR a !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=o AND deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=a::uuid AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<clock_timestamp())) THEN RAISE EXCEPTION 'Legal actor unavailable' USING ERRCODE='42501';END IF;
 IF operation THEN
  IF NOT public.eva_scoped_platform_owner(o,a) THEN RAISE EXCEPTION 'Scoped Owner session required' USING ERRCODE='42501';END IF;
  role_name:='admin_org';SELECT coalesce(jsonb_agg(x->'id'),'[]') INTO perms FROM jsonb_array_elements(public.organization_permission_rules())x;
 ELSE
  IF (SELECT count(*) FROM public.organization_members WHERE organization_id=o AND user_id::text=a AND lower(status)='active')<>1 THEN RAISE EXCEPTION 'Unique internal membership required' USING ERRCODE='42501';END IF;
  SELECT r.name,r.permissions,m.permission_limit INTO member_row FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
   WHERE m.organization_id=o AND m.user_id::text=a AND m.role_id::text=rid AND lower(m.status)='active' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL FOR SHARE OF m,r;
  IF NOT FOUND OR member_row.name NOT IN('admin_org','gestor','operacional') THEN RAISE EXCEPTION 'Internal legal auditor required' USING ERRCODE='42501';END IF;
  role_name:=member_row.name;SELECT coalesce(jsonb_agg(value),'[]') INTO perms FROM jsonb_array_elements(member_row.permissions) WHERE member_row.permission_limit IS NULL OR member_row.permission_limit ? (value#>>'{}');
 END IF;
 IF NOT perms ? '8f105b02-4443-49de-b188-847e0284e7ed' OR writing AND NOT perms @> '["92e1b670-ab10-483a-b825-c6e16799496d","62443ab1-9187-42e4-a932-a7cf54f76250"]' THEN RAISE EXCEPTION 'Legal audit permissions required' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=o AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE) AND document_management)<>1 THEN RAISE EXCEPTION 'Unique document license required' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('userId',a,'organizationId',o,'roleId',rid,'role',role_name,'permissions',perms,'scope','organization','accessMode',CASE WHEN operation THEN 'platform_operation' ELSE NULL END,'email','');
END$$;
CREATE FUNCTION public.legal_audit_latest_sources() RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) ORDER BY id),'[]') FROM(SELECT DISTINCT ON(id) * FROM public.legal_audit_sources ORDER BY id,version DESC)x
$$;
CREATE FUNCTION public.legal_audit_library(p_actor text,p_org text,p_role text,p_platform boolean,p_action text,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v integer;b jsonb;
BEGIN
 IF p_actor IS NULL OR p_actor !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor::uuid AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<clock_timestamp())) THEN RAISE EXCEPTION 'Active library actor required' USING ERRCODE='42501';END IF;
 IF p_action='list' THEN
  IF p_org IS NULL THEN PERFORM public.platform_team_owner(p_actor::uuid);ELSE PERFORM public.legal_audit_actor(p_org,p_actor,p_role,p_platform,false);END IF;
  RETURN public.legal_audit_latest_sources();
 END IF;
 PERFORM public.platform_team_owner(p_actor::uuid);
 IF p_action<>'publish' OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>40000 THEN RAISE EXCEPTION 'Invalid legal source' USING ERRCODE='22023';END IF;
 IF NOT p_body ?& ARRAY['id','title','authority','kind','url','edition','validFrom','validTo','topics','state','text','expectedVersion','reason','hash'] OR jsonb_typeof(p_body->'text') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'reason')) NOT BETWEEN 20 AND 1000 OR p_body->>'hash' IS DISTINCT FROM encode(sha256(convert_to(p_body->>'text','UTF8')),'hex') OR p_body->>'state'='PUBLISHED' AND p_body->>'kind'='INDICE_JURISPRUDENCIA' THEN RAISE EXCEPTION 'Unverified official source' USING ERRCODE='22023';END IF;
 IF p_body->>'id' !~ '^[a-z0-9-]{3,80}$' OR p_body->>'state' NOT IN('PUBLISHED','CATALOGUED','WITHDRAWN') OR length(p_body->>'title') NOT BETWEEN 3 AND 300 OR p_body->>'kind' NOT IN('LEI','DECRETO','RESOLUCAO','PORTARIA','REGRA_CCEE','PROCEDIMENTO','DADO_OFICIAL','INDICE_JURISPRUDENCIA','PRECEDENTE_VINCULANTE','JURISPRUDENCIA') OR length(p_body->>'text')>24000 OR jsonb_typeof(p_body->'topics') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'topics')>12 OR p_body->>'url' !~ '^https://(www\.)?(planalto\.gov\.br|www2\.camara\.leg\.br|camara\.leg\.br|gov\.br|www2\.aneel\.gov\.br|aneel\.gov\.br|ccee\.org\.br|stj\.jus\.br|portal\.stf\.jus\.br|senado\.leg\.br)/[^\s]*$' OR p_body->>'validFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p_body->>'state'='PUBLISHED' AND(length(btrim(p_body->>'text'))<40 OR p_body->>'hash' !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Invalid official source fields' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('legal-source:'||(p_body->>'id'),0));
 SELECT coalesce(max(version),0) INTO v FROM public.legal_audit_sources WHERE id=p_body->>'id';
 IF (p_body->>'expectedVersion')::integer IS DISTINCT FROM v THEN RAISE EXCEPTION 'Source version changed' USING ERRCODE='40001';END IF;
 b:=(p_body-'expectedVersion')||jsonb_build_object('reviewedOn',(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date::text);
 INSERT INTO public.legal_audit_sources(id,version,body,created_by) VALUES(p_body->>'id',v+1,b,p_actor);RETURN b||jsonb_build_object('version',v+1);
END$$;
CREATE FUNCTION public.legal_audit_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_id uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.legal_audit_jobs;d public.documents;lic public.licenses;ctx jsonb;n integer;used bigint;charge integer;old public.legal_audit_jobs;q public.legal_audit_questions;
BEGIN
 IF p_action NOT IN('list','detail','enqueue','resume','question','answer') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>(CASE WHEN p_action='enqueue' THEN 3000000 ELSE 60000 END) THEN RAISE EXCEPTION 'Invalid legal action' USING ERRCODE='22023';END IF;
 ctx:=public.legal_audit_actor(p_org,p_actor,p_role,p_platform,p_action IN('enqueue','resume'));
 IF p_action IN('question','answer') AND NOT ((ctx->'permissions') ? '62443ab1-9187-42e4-a932-a7cf54f76250') THEN RAISE EXCEPTION 'Question AI permission required' USING ERRCODE='42501';END IF;
 IF p_action='list' THEN RETURN jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT jsonb_build_object('id',id,'documentId',document_id,'customerId',customer_id,'unitId',unit_id,'state',state,'note',note,'cursor',cursor,'asOf',as_of,'createdAt',created_at,'updatedAt',updated_at,'reportDocumentId',CASE WHEN state IN('COMPLETED','NEEDS_REVIEW') THEN report_document_id ELSE NULL END)x FROM public.legal_audit_jobs WHERE organization_id=p_org ORDER BY created_at DESC,id DESC LIMIT 100)s));END IF;
 IF p_action='enqueue' THEN
  SELECT * INTO d FROM public.documents WHERE organization_id=p_org AND id=p_body->>'documentId' FOR SHARE;
  IF d.file_hash IS DISTINCT FROM p_body->>'sourceHash' THEN RAISE EXCEPTION 'Original hash changed' USING ERRCODE='40001';END IF;
  IF NOT FOUND OR d.customer_id IS DISTINCT FROM p_body->>'customerId' OR d.consumer_unit_id IS DISTINCT FROM p_body->>'unitId' OR d.file_verified IS DISTINCT FROM true OR d.storage_bucket IS DISTINCT FROM 'energy-documents-private' OR d.file_hash !~ '^[a-f0-9]{64}$' OR d.document_type NOT IN('CONTRACT_ENERGY','CONTRACT_CUSD','CONTRACT_CCER','CONTRACT_MANAGEMENT','OTHER') OR d.mime_type NOT IN('application/pdf','image/png','image/jpeg') OR NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=d.consumer_unit_id AND u.organization_id=p_org AND c.id=d.customer_id AND u.status='ACTIVE' AND c.status='ACTIVE' AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'Legal source outside customer or unit' USING ERRCODE='42501';END IF;
  IF p_body->>'asOf' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (p_body->>'asOf')::date>CURRENT_DATE OR p_body->>'basis' !~ '^[a-f0-9]{64}$' OR p_body->>'libraryVersion' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_body->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'sources')>100 THEN RAISE EXCEPTION 'Invalid legal scope' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
  SELECT * INTO old FROM public.legal_audit_jobs WHERE organization_id=p_org AND document_id=d.id AND basis=p_body->>'basis';IF FOUND THEN RETURN jsonb_build_object('id',old.id,'state',old.state,'replayed',true);END IF;
  IF (SELECT count(*) FROM public.legal_audit_jobs WHERE organization_id=p_org AND state IN('QUEUED','EXTRACTING','OCR_SUBMITTING','OCR_POLLING','ANALYZING','REPORTING'))>=20 THEN RAISE EXCEPTION 'Legal queue capacity reached' USING ERRCODE='P3410';END IF;
  charge:=CASE WHEN EXISTS(SELECT 1 FROM public.legal_audit_jobs WHERE organization_id=p_org AND document_id=d.id) THEN 1 ELSE 0 END;
  SELECT * INTO lic FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE);
  used:=(public.organization_resource_usage(p_org)->>'documents')::bigint;
  IF lic.plan_id IS NULL OR NOT coalesce(lic.documents_unlimited,false) AND(lic.documents_limit IS NULL OR used+charge>lic.documents_limit) THEN RAISE EXCEPTION 'Legal document quota exceeded' USING ERRCODE='P3391';END IF;
  INSERT INTO public.legal_audit_jobs(id,organization_id,customer_id,unit_id,document_id,source_hash,actor_id,role_id,platform,as_of,basis,sources,library_version,quota_units) VALUES(p_id,p_org,d.customer_id,d.consumer_unit_id,d.id,d.file_hash,p_actor,p_role,p_platform,(p_body->>'asOf')::date,p_body->>'basis',p_body->'sources',p_body->>'libraryVersion',charge) RETURNING * INTO j;
  INSERT INTO public.legal_audit_events(job_id,organization_id,state,kind,body,actor_id) VALUES(j.id,p_org,j.state,'REQUESTED',jsonb_build_object('logicalDocumentCredits',1,'additionalCredits',charge,'sourceHash',d.file_hash),p_actor);
  UPDATE public.licenses SET documents_used=(public.organization_resource_usage(p_org)->>'documents')::integer WHERE id=lic.id;
  RETURN jsonb_build_object('id',j.id,'state',j.state,'replayed',false);
 END IF;
 SELECT * INTO j FROM public.legal_audit_jobs WHERE id=p_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Legal report unavailable' USING ERRCODE='42501';END IF;
 IF p_action='detail' THEN RETURN jsonb_build_object('id',j.id,'documentId',j.document_id,'customerId',j.customer_id,'unitId',j.unit_id,'asOf',j.as_of,'sourceHash',j.source_hash,'state',j.state,'note',j.note,'cursor',j.cursor,'pages',jsonb_array_length(j.pages),'report',j.report,'reportDocumentId',CASE WHEN j.state IN('COMPLETED','NEEDS_REVIEW') THEN j.report_document_id ELSE NULL END,'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'state',state,'at',created_at,'body',body) ORDER BY id),'[]') FROM public.legal_audit_events WHERE job_id=j.id AND organization_id=p_org));END IF;
 IF p_action='question' THEN
  IF j.state NOT IN('COMPLETED','NEEDS_REVIEW') OR j.report IS NULL OR length(btrim(p_body->>'question')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Read the completed report before asking' USING ERRCODE='22023';END IF;
  IF p_body->>'questionHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid question hash' USING ERRCODE='22023';END IF;
  SELECT * INTO q FROM public.legal_audit_questions WHERE job_id=j.id AND organization_id=p_org AND actor_id=p_actor AND question_hash=p_body->>'questionHash';
  IF FOUND THEN RETURN jsonb_build_object('answer',q.answer,'pending',q.state='REQUESTED','replayed',true);END IF;
  INSERT INTO public.legal_audit_questions(organization_id,job_id,actor_id,question_hash,question) VALUES(p_org,j.id,p_actor,p_body->>'questionHash',p_body->>'question') RETURNING * INTO q;
  RETURN jsonb_build_object('context',ctx,'questionId',q.id,'job',to_jsonb(j)-'lease_token'-'operation_url');
 END IF;
 IF p_action='answer' THEN
  SELECT * INTO q FROM public.legal_audit_questions WHERE id=(p_body->>'questionId')::uuid AND job_id=j.id AND organization_id=p_org AND actor_id=p_actor FOR UPDATE;
  IF NOT FOUND OR jsonb_typeof(p_body->'answer') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Question unavailable' USING ERRCODE='42501';END IF;
  IF q.state='ANSWERED' THEN RETURN q.answer;END IF;
  UPDATE public.legal_audit_questions SET state='ANSWERED',answer=p_body->'answer' WHERE id=q.id;
  INSERT INTO public.legal_audit_events(job_id,organization_id,state,kind,body,actor_id) VALUES(j.id,p_org,j.state,'QUESTION_ANSWERED',jsonb_build_object('questionId',q.id,'question',q.question,'answer',p_body->'answer'),p_actor);RETURN p_body->'answer';
 END IF;
 IF j.state NOT IN('FAILED','ACCESS_REQUIRED','TECHNICAL_REVIEW') THEN RETURN jsonb_build_object('id',j.id,'state',j.state,'replayed',true);END IF;
 IF j.state='TECHNICAL_REVIEW' AND(j.note LIKE 'OCR_SUBMISSION_UNKNOWN%' OR j.note LIKE 'AI_RESULT_UNKNOWN%') THEN RAISE EXCEPTION 'Inspect provider history before repeating paid request' USING ERRCODE='40001';END IF;
 UPDATE public.legal_audit_jobs SET actor_id=p_actor,role_id=p_role,platform=p_platform,state=CASE WHEN report IS NOT NULL THEN 'REPORTING' WHEN jsonb_array_length(pages)>0 THEN 'ANALYZING' WHEN operation_url IS NOT NULL THEN 'OCR_POLLING' ELSE 'QUEUED' END,lease_token=NULL,lease_until=NULL,next_attempt_at=now(),note='Retomada preservando leitura e etapas já concluídas.',updated_at=now() WHERE id=j.id RETURNING * INTO j;
 INSERT INTO public.legal_audit_events(job_id,organization_id,state,kind,actor_id) VALUES(j.id,p_org,j.state,'RESUMED',p_actor);RETURN jsonb_build_object('id',j.id,'state',j.state);
END$$;

CREATE FUNCTION public.legal_audit_performance(p_org text,p_actor text,p_role text,p_platform boolean,p_from date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' AS $$
DECLARE r jsonb:='[]';lo timestamptz;hi timestamptz;x jsonb;i integer;
BEGIN
 PERFORM public.legal_audit_actor(p_org,p_actor,p_role,p_platform,false);
 IF p_from IS NULL OR p_from>CURRENT_DATE OR p_from<CURRENT_DATE-30 THEN RAISE EXCEPTION 'Performance window unavailable' USING ERRCODE='22023';END IF;
 FOR i IN 0..1 LOOP
  lo:=CASE WHEN i=0 THEN p_from::timestamp AT TIME ZONE 'America/Sao_Paulo' ELSE (p_from-7)::timestamp AT TIME ZONE 'America/Sao_Paulo' END;
  hi:=CASE WHEN i=0 THEN clock_timestamp() ELSE p_from::timestamp AT TIME ZONE 'America/Sao_Paulo' END;
  SELECT jsonb_build_object('cohort',CASE WHEN i=0 THEN 'TEST' ELSE 'BASELINE' END,'received',count(*),'ocrCompleted',count(*) FILTER(WHERE state='SUCCEEDED'),'technical',count(*) FILTER(WHERE state IN('FAILED','SUBMISSION_UNKNOWN')),'ocrP50Seconds',percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM updated_at-created_at)) FILTER(WHERE state='SUCCEEDED'),'ocrP95Seconds',percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM updated_at-created_at)) FILTER(WHERE state='SUCCEEDED')) INTO x FROM public.document_ocr_jobs WHERE organization_id=p_org AND created_at>=lo AND created_at<hi;
  SELECT x||jsonb_build_object('intakes',count(*),'proposalReady',count(done_at),'proposalP95Seconds',percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM done_at-created_at)) FILTER(WHERE done_at IS NOT NULL)) INTO x FROM(SELECT a.created_at,(SELECT min(e.created_at) FROM public.eva_automatic_intake_events e WHERE e.organization_id=p_org AND e.intake_id=a.id AND e.state IN('PROPOSAL_READY','PUBLISHED'))done_at FROM public.eva_automatic_intakes a WHERE a.organization_id=p_org AND a.created_at>=lo AND a.created_at<hi)s;
  r:=r||jsonb_build_array(x);
 END LOOP;
 RETURN jsonb_build_object('from',p_from,'cohorts',r,'note','OCR inclui fila e provedor; proposta mede recebimento até a primeira proposta registrada. Não inclui aprovação. Amostras pequenas não demonstram SLO ou ganho de desempenho.');
END$$;

CREATE FUNCTION public.legal_audit_worker(p_action text,p_id uuid,p_token uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='30s' AS $$
DECLARE j public.legal_audit_jobs;d public.documents;ctx jsonb;path text;
BEGIN
 IF p_action='claim' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('legal-audit-worker',0));
  UPDATE public.legal_audit_jobs SET state=CASE WHEN state='EXTRACTING' THEN 'QUEUED' WHEN state='OCR_SUBMITTING' THEN 'TECHNICAL_REVIEW' WHEN state='ANALYZING' THEN 'TECHNICAL_REVIEW' ELSE state END,note=CASE WHEN state='OCR_SUBMITTING' THEN 'OCR_SUBMISSION_UNKNOWN — consulte o provedor antes de repetir.' WHEN state='ANALYZING' THEN 'AI_RESULT_UNKNOWN — consulte o consumo e histórico antes de repetir.' ELSE 'Etapa preservada após interrupção.' END,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE lease_until<now();
  IF EXISTS(SELECT 1 FROM public.legal_audit_jobs WHERE lease_until>now()) THEN RETURN NULL;END IF;
  SELECT * INTO j FROM public.legal_audit_jobs WHERE state IN('QUEUED','OCR_POLLING','ANALYZING','REPORTING') AND next_attempt_at<=now() AND lease_token IS NULL ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL;END IF;
  BEGIN ctx:=public.legal_audit_actor(j.organization_id,j.actor_id,j.role_id,j.platform,true);EXCEPTION WHEN insufficient_privilege THEN UPDATE public.legal_audit_jobs SET state='ACCESS_REQUIRED',note='Renove o acesso autorizado à organização e retome sem reenviar.',updated_at=now() WHERE id=j.id;RETURN NULL;END;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(j.sources)s WHERE NOT EXISTS(SELECT 1 FROM public.legal_audit_sources live WHERE live.id=s->>'id' AND live.version=(s->>'version')::integer AND live.version=(SELECT max(v.version) FROM public.legal_audit_sources v WHERE v.id=live.id) AND live.body->>'state'='PUBLISHED' AND (live.body->>'reviewedOn')::date>=CURRENT_DATE-30)) THEN UPDATE public.legal_audit_jobs SET state='FAILED',note='A biblioteca mudou ou exige revisão de vigência. A leitura permanece preservada; confira as fontes antes de nova análise.',updated_at=now() WHERE id=j.id;RETURN NULL;END IF;
  SELECT * INTO d FROM public.documents WHERE id=j.document_id AND organization_id=j.organization_id AND customer_id=j.customer_id AND consumer_unit_id=j.unit_id AND file_hash=j.source_hash AND file_verified=true;
  IF NOT FOUND THEN UPDATE public.legal_audit_jobs SET state='FAILED',note='A fonte mudou; confira a versão do documento.',updated_at=now() WHERE id=j.id;RETURN NULL;END IF;
  UPDATE public.legal_audit_jobs SET state=CASE WHEN state='QUEUED' THEN 'EXTRACTING' ELSE state END,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=attempts+1,updated_at=now() WHERE id=j.id RETURNING * INTO j;
  RETURN jsonb_build_object('job',to_jsonb(j),'context',ctx,'document',jsonb_build_object('id',d.id,'path',d.file_path,'bucket',d.storage_bucket,'hash',d.file_hash,'mime',d.mime_type,'filename',d.original_filename,'size',d.file_size_bytes));
 END IF;
 SELECT * INTO j FROM public.legal_audit_jobs WHERE id=p_id AND lease_token=p_token AND p_token IS NOT NULL AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Legal lease lost' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>5000000 THEN RAISE EXCEPTION 'Legal checkpoint too large' USING ERRCODE='22023';END IF;
 IF p_action='ocr_begin' AND j.state='EXTRACTING' THEN UPDATE public.legal_audit_jobs SET state='OCR_SUBMITTING',note='OCR em processamento; não reenviar.' WHERE id=j.id;RETURN '{}'::jsonb;END IF;
 IF p_action='defer' AND j.state IN('OCR_POLLING','ANALYZING') AND (p_body->>'delay')::integer BETWEEN 5 AND 300 THEN
  UPDATE public.legal_audit_jobs SET next_attempt_at=now()+make_interval(secs=>(p_body->>'delay')::integer),note='Aguardando disponibilidade do provedor ou janela da IA; leitura preservada.' WHERE id=j.id;
 ELSIF p_action='ocr_accepted' AND j.state='OCR_SUBMITTING' THEN
  UPDATE public.legal_audit_jobs SET state='OCR_POLLING',operation_url=p_body->>'operation',next_attempt_at=now()+interval '5 seconds' WHERE id=j.id;
 ELSIF p_action='ocr_wait' AND j.state='OCR_POLLING' THEN UPDATE public.legal_audit_jobs SET next_attempt_at=now()+interval '10 seconds' WHERE id=j.id;
 ELSIF p_action='reading' AND j.state IN('EXTRACTING','OCR_POLLING') AND jsonb_typeof(p_body->'pages')='array' AND jsonb_array_length(p_body->'pages') BETWEEN 1 AND 100 THEN
  UPDATE public.legal_audit_jobs SET state='ANALYZING',pages=p_body->'pages',note='Leitura preservada; conferindo cláusulas e fontes oficiais.',next_attempt_at=now() WHERE id=j.id;
 ELSIF p_action='analysis' AND j.state='ANALYZING' AND (p_body->>'cursor')::integer=j.cursor AND jsonb_typeof(p_body->'narrative')='object' THEN
  UPDATE public.legal_audit_jobs SET cursor=cursor+1,narratives=narratives||jsonb_build_array(p_body->'narrative'),note='Bloco analisado e preservado.',next_attempt_at=now() WHERE id=j.id;
 ELSIF p_action='report' AND j.state='ANALYZING' AND jsonb_typeof(p_body->'report')='object' THEN
  UPDATE public.legal_audit_jobs SET state='REPORTING',report=p_body->'report',note='Relatório preparado; arquivando em Documentos.',next_attempt_at=now() WHERE id=j.id;
 ELSIF p_action='complete' AND j.state='REPORTING' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(j.organization_id,315));
  IF p_body->>'hash' !~ '^[a-f0-9]{64}$' OR (p_body->>'size')::bigint NOT BETWEEN 20 AND 15728640 THEN RAISE EXCEPTION 'Invalid legal report bytes' USING ERRCODE='22023';END IF;
  path:=j.organization_id||'/'||j.unit_id||'/legal-audit/'||j.id::text||'/'||j.report_document_id||'.pdf';
  UPDATE public.legal_audit_jobs SET report_hash=p_body->>'hash' WHERE id=j.id;
  INSERT INTO public.documents(id,organization_id,customer_id,consumer_unit_id,document_type,reference_month,original_filename,mime_type,file_hash,file_size_bytes,file_path,storage_bucket,file_verified,file_verified_at,uploaded_by_auth_user_id,license_check_passed,processing_status,ocr_status,description)
  VALUES(j.report_document_id,j.organization_id,j.customer_id,j.unit_id,'COMPLIANCE_REPORT',date_trunc('month',j.as_of)::date,'Relatorio-de-conformidade-'||j.id::text||'.pdf','application/pdf',p_body->>'hash',(p_body->>'size')::bigint,path,'energy-documents-private',true,clock_timestamp(),j.actor_id::uuid,true,'COMPLETED','COMPLETED','Análise técnico-jurídica assistida EVA; fonte '||j.document_id||'; revisão jurídica necessária.');
  UPDATE public.legal_audit_jobs SET state='NEEDS_REVIEW',note='Relatório de conformidade arquivado em Documentos. Confira as ressalvas e a cobertura normativa.' WHERE id=j.id;
 ELSIF p_action='fail' AND p_body->>'state' IN('FAILED','TECHNICAL_REVIEW','ACCESS_REQUIRED') THEN UPDATE public.legal_audit_jobs SET state=p_body->>'state',note=left(p_body->>'note',1000) WHERE id=j.id;
 ELSE RAISE EXCEPTION 'Invalid legal transition' USING ERRCODE='22023';END IF;
 UPDATE public.legal_audit_jobs SET lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=j.id RETURNING * INTO j;
 INSERT INTO public.legal_audit_events(job_id,organization_id,state,kind,body,actor_id) VALUES(j.id,j.organization_id,j.state,upper(p_action),jsonb_build_object('cursor',j.cursor,'durationMs',p_body->'durationMs'),j.actor_id);
 RETURN jsonb_build_object('id',j.id,'state',j.state);
END$$;

-- A generated report is part of the already-reserved verification, never a free arbitrary upload.
CREATE FUNCTION public.legal_audit_grouped_report(d jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.legal_audit_jobs j WHERE j.state='REPORTING' AND j.report IS NOT NULL AND j.lease_token IS NOT NULL AND j.lease_until>now() AND j.report_document_id=d->>'id' AND j.organization_id=d->>'organization_id' AND j.customer_id=d->>'customer_id' AND j.unit_id=d->>'consumer_unit_id' AND j.report_hash=d->>'file_hash' AND d->>'document_type'='COMPLIANCE_REPORT' AND d->>'file_verified'='true' AND d->>'storage_bucket'='energy-documents-private' AND d->>'file_path'=j.organization_id||'/'||j.unit_id||'/legal-audit/'||j.id::text||'/'||j.report_document_id||'.pdf')
$$;
ALTER FUNCTION public.organization_resource_usage(text) RENAME TO organization_resource_usage_before_legal;
CREATE FUNCTION public.organization_resource_usage(org text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_set(v,'{documents}',to_jsonb((v->>'documents')::bigint+(SELECT coalesce(sum(quota_units),0) FROM public.legal_audit_jobs WHERE organization_id=org)-(SELECT count(*) FROM public.documents d JOIN public.legal_audit_jobs j ON j.report_document_id=d.id AND j.organization_id=d.organization_id WHERE d.organization_id=org))) FROM public.organization_resource_usage_before_legal(org)v
$$;
DO $capacity$
DECLARE d text;old text;seam text;
BEGIN
 d:=pg_get_functiondef('public.enforce_organization_capacity()'::regprocedure);
 old:='IF cap IS NOT NULL AND used>=cap THEN RAISE EXCEPTION ''Organization capacity exceeded: %'',resource USING ERRCODE=''P3391''; END IF;';
 seam:=substring(d from 'IF\s+cap\s+IS\s+NOT\s+NULL\s+AND\s+used\s*>=\s*cap\s+THEN[^;]*Organization capacity exceeded[^;]*;\s*END\s+IF;');
 IF seam IS NULL OR regexp_replace(seam,'\s','','g')<>regexp_replace(old,'\s','','g') THEN RAISE EXCEPTION 'Review current capacity guard before legal grouping';END IF;
 EXECUTE replace(d,seam,'IF cap IS NOT NULL AND used>=cap AND NOT(resource=''documents'' AND public.legal_audit_grouped_report(to_jsonb(NEW))) THEN RAISE EXCEPTION ''Organization capacity exceeded: %'',resource USING ERRCODE=''P3391''; END IF;');
END $capacity$;
CREATE FUNCTION public.legal_audit_report_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN IF EXISTS(SELECT 1 FROM public.legal_audit_jobs WHERE report_document_id=OLD.id AND organization_id=OLD.organization_id AND state IN('COMPLETED','NEEDS_REVIEW')) THEN RAISE EXCEPTION 'Issued legal report immutable; create new verification' USING ERRCODE='23514';END IF;RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;END$$;
CREATE TRIGGER legal_report_immutable BEFORE UPDATE OR DELETE ON public.documents FOR EACH ROW WHEN(OLD.document_type='COMPLIANCE_REPORT') EXECUTE FUNCTION public.legal_audit_report_immutable();
REVOKE ALL ON FUNCTION public.legal_audit_actor(text,text,text,boolean,boolean),public.legal_audit_latest_sources(),public.legal_audit_grouped_report(jsonb),public.legal_audit_immutable(),public.legal_audit_report_immutable(),public.organization_resource_usage_before_legal(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.organization_resource_usage(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organization_resource_usage(text) TO service_role;
REVOKE ALL ON FUNCTION public.legal_audit_library(text,text,text,boolean,text,jsonb),public.legal_audit_action(text,text,text,boolean,text,uuid,jsonb),public.legal_audit_worker(text,uuid,uuid,jsonb),public.legal_audit_performance(text,text,text,boolean,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.legal_audit_library(text,text,text,boolean,text,jsonb),public.legal_audit_action(text,text,text,boolean,text,uuid,jsonb),public.legal_audit_worker(text,uuid,uuid,jsonb),public.legal_audit_performance(text,text,text,boolean,date) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
