-- Approved platform-only reconciliation and assigned internal support.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
INSERT INTO public.permissions(id,code,name,module,resource,action) VALUES
 ('a7c8f257-580d-4d39-8900-4a5788068201','platform.reconciliation.prepare','Preparar conciliação','platform','reconciliation','prepare'),
 ('a7c8f257-580d-4d39-8900-4a5788068202','platform.reconciliation.confirm','Confirmar conciliação de outro autor','platform','reconciliation','confirm'),
 ('a7c8f257-580d-4d39-8900-4a5788068203','platform.cases.manage','Atribuir chamados internos','platform','cases','manage'),
 ('a7c8f257-580d-4d39-8900-4a5788068204','platform.cases.assigned','Atender chamados atribuídos','platform','cases','assigned') ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.permissions WHERE (id,code) IN
 (('a7c8f257-580d-4d39-8900-4a5788068201','platform.reconciliation.prepare'),('a7c8f257-580d-4d39-8900-4a5788068202','platform.reconciliation.confirm'),('a7c8f257-580d-4d39-8900-4a5788068203','platform.cases.manage'),('a7c8f257-580d-4d39-8900-4a5788068204','platform.cases.assigned')))<>4 THEN RAISE EXCEPTION 'Permission identifier conflict'; END IF;
END $$;
UPDATE public.roles r SET permissions=r.permissions || (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements_text(CASE r.name
 WHEN 'admin_platform' THEN '["a7c8f257-580d-4d39-8900-4a5788068201","a7c8f257-580d-4d39-8900-4a5788068202","a7c8f257-580d-4d39-8900-4a5788068203"]'::jsonb
 WHEN 'platform_finance' THEN '["a7c8f257-580d-4d39-8900-4a5788068201"]'::jsonb
 WHEN 'platform_administrator' THEN '["a7c8f257-580d-4d39-8900-4a5788068203"]'::jsonb
 ELSE '["a7c8f257-580d-4d39-8900-4a5788068204"]'::jsonb END) x WHERE NOT r.permissions ? x)
WHERE r.scope='global' AND r.name IN ('admin_platform','platform_finance','platform_administrator','platform_support');

CREATE TABLE IF NOT EXISTS public.platform_financial_evidence(
 id uuid PRIMARY KEY, uploader uuid NOT NULL REFERENCES auth.users(id), sha256 text UNIQUE NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 path text UNIQUE NOT NULL, filename text NOT NULL, bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 10485760),
 reconciliation_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.platform_cost_reconciliation_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reconciliation_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 status text NOT NULL CHECK(status IN ('PROPOSED','CONFIRMED','REJECTED')),
 prepared_by uuid NOT NULL REFERENCES auth.users(id), actor_id uuid NOT NULL REFERENCES auth.users(id),
 evidence_id uuid NOT NULL REFERENCES public.platform_financial_evidence(id), payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(reconciliation_id,revision)
);
CREATE TABLE IF NOT EXISTS public.platform_cost_reconciliation_allocations(
 version_id uuid NOT NULL REFERENCES public.platform_cost_reconciliation_versions(id), organization_id text NOT NULL REFERENCES public.organizations(id),
 amount_minor bigint NOT NULL CHECK(amount_minor>0), PRIMARY KEY(version_id,organization_id)
);
CREATE TABLE IF NOT EXISTS public.platform_cost_reconciliation_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES public.platform_cost_reconciliation_versions(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id), details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.platform_support_cases(
 id uuid PRIMARY KEY, revision integer NOT NULL CHECK(revision>0), organization_id text REFERENCES public.organizations(id),
 requester_id uuid NOT NULL REFERENCES auth.users(id), assignee_id uuid NOT NULL REFERENCES auth.users(id),
 title text NOT NULL, priority text NOT NULL CHECK(priority IN ('LOW','NORMAL','HIGH')),
 deadline date NOT NULL, status text NOT NULL CHECK(status IN ('OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.platform_support_case_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.platform_support_cases(id),
 revision integer NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id), details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(case_id,revision)
);
ALTER TABLE public.platform_financial_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_cost_reconciliation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_cost_reconciliation_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_cost_reconciliation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_case_events ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_financial_evidence','platform_cost_reconciliation_versions','platform_cost_reconciliation_allocations','platform_cost_reconciliation_audit','platform_support_cases','platform_support_case_events'] LOOP
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.platform_workflow_actor(p_actor uuid,p_permission text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE profile text;
BEGIN
 -- Same lock as team mutations: revocation and assignment cannot race a write.
 PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));
 IF (SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE u.user_id::text=p_actor::text AND r.scope='global')<>1
 OR (SELECT count(*) FROM public.user_profiles WHERE user_id=p_actor)<>1 THEN RAISE EXCEPTION 'Active unique platform identity required' USING ERRCODE='42501'; END IF;
 SELECT t.profile INTO profile FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id
 JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text AND t.active
 WHERE u.user_id::text=p_actor::text AND r.scope='global' AND r.permissions ? p_permission
 AND r.name=CASE t.profile WHEN 'OWNER' THEN 'admin_platform' WHEN 'ADMINISTRATOR' THEN 'platform_administrator' WHEN 'FINANCE' THEN 'platform_finance' WHEN 'SUPPORT' THEN 'platform_support' END;
 IF profile IS NULL THEN RAISE EXCEPTION 'Platform permission denied' USING ERRCODE='42501'; END IF;
 RETURN profile;
END $$;
CREATE OR REPLACE FUNCTION public.platform_workflow_name(p_user uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(nullif(btrim(concat_ws(' ',t.first_name,t.last_name)),''),nullif(btrim(p.name),''))
 FROM public.user_profiles p LEFT JOIN public.platform_team_members t ON t.user_id=p.user_id WHERE p.user_id=p_user
$$;
CREATE OR REPLACE FUNCTION public.platform_workflow_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Preserved platform history' USING ERRCODE='42501'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_cost_reconciliation_versions','platform_cost_reconciliation_allocations','platform_cost_reconciliation_audit','platform_support_case_events'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('public.'||t)::regclass AND tgname='platform_preserve_history') THEN
 EXECUTE format('CREATE TRIGGER platform_preserve_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_workflow_immutable()',t); END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.register_platform_financial_evidence(p_actor uuid,p_id uuid,p_hash text,p_path text,p_filename text,p_bytes integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM public.platform_workflow_actor(p_actor,'a7c8f257-580d-4d39-8900-4a5788068201');
 IF p_path IS DISTINCT FROM p_id::text||'/evidence.pdf' OR length(p_filename) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='22023'; END IF;
 INSERT INTO public.platform_financial_evidence(id,uploader,sha256,path,filename,bytes) VALUES(p_id,p_actor,p_hash,p_path,p_filename,p_bytes);
 RETURN jsonb_build_object('id',p_id,'sha256',p_hash);
END $$;
CREATE OR REPLACE FUNCTION public.save_platform_reconciliation(p_actor uuid,p_id uuid,p_revision integer,p_action text,p_body jsonb,p_ip text,p_agent text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old public.platform_cost_reconciliation_versions%ROWTYPE; doc public.platform_financial_evidence%ROWTYPE;
 v uuid; prep uuid; payload jsonb; status text; item jsonb; amount bigint; total bigint:=0; n integer; reason text;
BEGIN
 IF p_action='PROPOSE' THEN PERFORM public.platform_workflow_actor(p_actor,'a7c8f257-580d-4d39-8900-4a5788068201');
 ELSIF p_action IN ('CONFIRM','REJECT') THEN
 IF public.platform_workflow_actor(p_actor,'a7c8f257-580d-4d39-8900-4a5788068202')<>'OWNER' THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023'; END IF;
 reason:=btrim(coalesce(p_body->>'reason',''));
 IF length(reason) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.platform_cost_reconciliation_versions WHERE reconciliation_id=p_id ORDER BY revision DESC LIMIT 1;
 IF coalesce(old.revision,0) IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Stale revision' USING ERRCODE='40001'; END IF;
 IF p_action='PROPOSE' THEN
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) k WHERE k NOT IN ('provider','month','currency','amountMinor','basis','evidenceId','externalReference','method','allocations','reason'))
 OR length(btrim(coalesce(p_body->>'provider',''))) NOT BETWEEN 2 AND 120
 OR length(btrim(coalesce(p_body->>'externalReference',''))) NOT BETWEEN 1 AND 200
 OR coalesce(p_body->>'month','') !~ '^\d{4}-(0[1-9]|1[0-2])-01$'
 OR coalesce(p_body->>'currency','') NOT IN ('BRL','USD','EUR') OR coalesce(p_body->>'basis','') NOT IN ('ESTIMATE','PROVIDER_CONFIRMED','ALLOCATED')
 OR jsonb_typeof(p_body->'amountMinor') IS DISTINCT FROM 'number' OR coalesce(p_body->>'amountMinor','') !~ '^[0-9]{1,13}$'
 OR jsonb_typeof(p_body->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'allocations')>100 THEN RAISE EXCEPTION 'Invalid financial input' USING ERRCODE='22023'; END IF;
 amount:=(p_body->>'amountMinor')::bigint;
 PERFORM (p_body->>'month')::date;
 IF amount NOT BETWEEN 1 AND 1000000000000 THEN RAISE EXCEPTION 'Invalid amount' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.platform_cost_reconciliation_versions r WHERE r.reconciliation_id<>p_id AND lower(r.payload->>'provider')=lower(btrim(p_body->>'provider')) AND r.payload->>'externalReference'=btrim(p_body->>'externalReference')) THEN RAISE EXCEPTION 'Duplicate provider reference' USING ERRCODE='23505'; END IF;
 IF old.id IS NOT NULL AND (lower(old.payload->>'provider') IS DISTINCT FROM lower(btrim(p_body->>'provider')) OR old.payload->>'externalReference' IS DISTINCT FROM btrim(p_body->>'externalReference')) THEN RAISE EXCEPTION 'Source identity immutable' USING ERRCODE='22023'; END IF;
 SELECT * INTO doc FROM public.platform_financial_evidence WHERE id=(p_body->>'evidenceId')::uuid FOR UPDATE;
 IF doc.id IS NULL OR (doc.reconciliation_id IS NOT NULL AND doc.reconciliation_id<>p_id) THEN RAISE EXCEPTION 'Evidence unavailable or already assigned' USING ERRCODE='22023'; END IF;
 UPDATE public.platform_financial_evidence SET reconciliation_id=p_id WHERE id=doc.id;
 FOR item IN SELECT value FROM jsonb_array_elements(p_body->'allocations') LOOP
 IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('organizationId','amountMinor'))
 OR coalesce(item->>'amountMinor','') !~ '^[0-9]{1,13}$' OR (item->>'amountMinor')::bigint<=0
 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=item->>'organizationId') THEN RAISE EXCEPTION 'Invalid allocation' USING ERRCODE='22023'; END IF;
 total:=total+(item->>'amountMinor')::bigint;
 END LOOP;
 n:=jsonb_array_length(p_body->'allocations');
 IF n>0 AND (p_body->>'basis'<>'ALLOCATED' OR total<>amount OR length(btrim(coalesce(p_body->>'method',''))) NOT BETWEEN 5 AND 2000) OR n=0 AND p_body->>'basis'='ALLOCATED' THEN RAISE EXCEPTION 'Allocation sum or method invalid' USING ERRCODE='22023'; END IF;
 prep:=p_actor; payload:=p_body; status:='PROPOSED';
 ELSE
 IF old.id IS NULL OR old.status<>'PROPOSED' OR old.prepared_by=p_actor THEN RAISE EXCEPTION 'Different Owner must confirm a proposal' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) k WHERE k<>'reason') THEN RAISE EXCEPTION 'Decision cannot edit proposal' USING ERRCODE='22023'; END IF;
 doc.id:=old.evidence_id; prep:=old.prepared_by; payload:=old.payload; status:=CASE p_action WHEN 'CONFIRM' THEN 'CONFIRMED' ELSE 'REJECTED' END;
 END IF;
 INSERT INTO public.platform_cost_reconciliation_versions(reconciliation_id,revision,status,prepared_by,actor_id,evidence_id,payload)
 VALUES(p_id,p_revision+1,status,prep,p_actor,doc.id,payload) RETURNING id INTO v;
 INSERT INTO public.platform_cost_reconciliation_allocations(version_id,organization_id,amount_minor)
 SELECT v,value->>'organizationId',(value->>'amountMinor')::bigint FROM jsonb_array_elements(payload->'allocations');
 INSERT INTO public.platform_cost_reconciliation_audit(version_id,actor_id,details) VALUES(v,p_actor,jsonb_build_object('action',p_action,'reason',reason,'actorNameAtTime',public.platform_workflow_name(p_actor),'preparedNameAtTime',public.platform_workflow_name(prep),'ip',left(p_ip,80),'agent',left(p_agent,500),'previousVersion',old.id));
 RETURN jsonb_build_object('id',p_id,'revision',p_revision+1,'status',status);
END $$;
CREATE OR REPLACE FUNCTION public.save_platform_support_case(p_actor uuid,p_id uuid,p_revision integer,p_body jsonb,p_ip text,p_agent text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE profile text; old public.platform_support_cases%ROWTYPE; next public.platform_support_cases%ROWTYPE; reason text; manager boolean;
BEGIN
 SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
 manager:=coalesce(profile IN ('OWNER','ADMINISTRATOR'),false);
 PERFORM public.platform_workflow_actor(p_actor,CASE WHEN manager THEN 'a7c8f257-580d-4d39-8900-4a5788068203' ELSE 'a7c8f257-580d-4d39-8900-4a5788068204' END);
 IF p_id IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid case' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.platform_support_cases WHERE id=p_id FOR UPDATE;
 IF NOT manager AND (old.id IS NULL OR old.assignee_id IS DISTINCT FROM p_actor) THEN RAISE EXCEPTION 'Assigned case required' USING ERRCODE='42501'; END IF;
 IF coalesce(old.revision,0) IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Stale case revision' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) k WHERE k NOT IN ('title','organizationId','assigneeId','priority','deadline','status','reason'))
 OR length(btrim(coalesce(p_body->>'reason',''))) NOT BETWEEN 5 AND 4000 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 next:=old; reason:=btrim(p_body->>'reason');
 IF manager THEN
 next.title:=btrim(coalesce(p_body->>'title',old.title)); next.organization_id:=coalesce(nullif(p_body->>'organizationId',''),old.organization_id);
 next.assignee_id:=coalesce((p_body->>'assigneeId')::uuid,old.assignee_id); next.priority:=coalesce(p_body->>'priority',old.priority);
 next.deadline:=coalesce((p_body->>'deadline')::date,old.deadline);
 IF length(coalesce(next.title,'')) NOT BETWEEN 5 AND 200 OR next.assignee_id IS NULL OR next.priority IS NULL OR next.deadline IS NULL THEN RAISE EXCEPTION 'Complete case required' USING ERRCODE='22023'; END IF;
 IF public.platform_workflow_actor(next.assignee_id,'a7c8f257-580d-4d39-8900-4a5788068204')<>'SUPPORT' THEN RAISE EXCEPTION 'Active Support assignee required' USING ERRCODE='42501'; END IF;
 ELSIF EXISTS(SELECT 1 FROM jsonb_object_keys(p_body) k WHERE k NOT IN ('status','reason')) THEN RAISE EXCEPTION 'Support cannot reassign case' USING ERRCODE='42501'; END IF;
 next.status:=coalesce(p_body->>'status',old.status,'OPEN');
 IF old.id IS NULL AND next.status<>'OPEN' OR old.id IS NOT NULL AND next.status<>old.status AND NOT (
 (old.status='OPEN' AND next.status='IN_PROGRESS') OR (old.status='IN_PROGRESS' AND next.status IN ('WAITING','RESOLVED')) OR (old.status='WAITING' AND next.status IN ('IN_PROGRESS','RESOLVED')) OR (old.status='RESOLVED' AND next.status='CLOSED' AND manager) OR (old.status IN ('RESOLVED','CLOSED') AND next.status='OPEN' AND manager)) THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
 IF old.id IS NULL THEN
 INSERT INTO public.platform_support_cases(id,revision,organization_id,requester_id,assignee_id,title,priority,deadline,status) VALUES(p_id,1,next.organization_id,p_actor,next.assignee_id,next.title,next.priority,next.deadline,next.status);
 ELSE UPDATE public.platform_support_cases SET revision=p_revision+1,organization_id=next.organization_id,assignee_id=next.assignee_id,title=next.title,priority=next.priority,deadline=next.deadline,status=next.status,updated_at=now() WHERE id=p_id; END IF;
 INSERT INTO public.platform_support_case_events(case_id,revision,actor_id,details) VALUES(p_id,p_revision+1,p_actor,jsonb_build_object('reason',reason,'before',CASE WHEN old.id IS NULL THEN NULL ELSE to_jsonb(old) END,'after',(SELECT to_jsonb(c) FROM public.platform_support_cases c WHERE c.id=p_id),'actorNameAtTime',public.platform_workflow_name(p_actor),'requesterNameAtTime',public.platform_workflow_name(coalesce(old.requester_id,p_actor)),'assigneeNameAtTime',public.platform_workflow_name(next.assignee_id),'ip',left(p_ip,80),'agent',left(p_agent,500)));
 RETURN jsonb_build_object('id',p_id,'revision',p_revision+1,'status',next.status);
END $$;
CREATE OR REPLACE FUNCTION public.read_platform_workflows(p_actor uuid,p_kind text,p_page integer DEFAULT 0,p_id uuid DEFAULT NULL,p_filter jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE profile text; rows jsonb; total integer; choices jsonb;
BEGIN
 IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_filter) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(p_filter) f WHERE f.key NOT IN ('status','organization','month') OR jsonb_typeof(f.value)<>'string' OR length(f.value#>>'{}')>150) THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
 IF p_filter ? 'month' AND coalesce(p_filter->>'month','') !~ '^\d{4}-(0[1-9]|1[0-2])-01$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023'; END IF;
 IF p_filter ? 'status' AND NOT (p_filter->>'status'=ANY(CASE p_kind WHEN 'finance' THEN ARRAY['PROPOSED','CONFIRMED','REJECTED'] ELSE ARRAY['OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED'] END)) THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
 IF p_kind='finance' THEN
 SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
 PERFORM public.platform_workflow_actor(p_actor,CASE WHEN profile='OWNER' THEN 'a7c8f257-580d-4d39-8900-4a5788068202' ELSE 'a7c8f257-580d-4d39-8900-4a5788068201' END);
 SELECT count(*) INTO total FROM (SELECT DISTINCT ON (reconciliation_id) * FROM public.platform_cost_reconciliation_versions ORDER BY reconciliation_id,revision DESC) v
 WHERE (NOT p_filter ? 'status' OR v.status=p_filter->>'status') AND (NOT p_filter ? 'month' OR v.payload->>'month'=p_filter->>'month') AND (NOT p_filter ? 'organization' OR EXISTS(SELECT 1 FROM public.platform_cost_reconciliation_allocations a WHERE a.version_id=v.id AND a.organization_id=p_filter->>'organization'));
 SELECT coalesce(jsonb_agg(j),'[]'::jsonb) INTO rows FROM (SELECT to_jsonb(v)||jsonb_build_object('preparedName',public.platform_workflow_name(v.prepared_by),
 'evidence',(SELECT jsonb_build_object('id',e.id,'filename',e.filename,'sha256',e.sha256) FROM public.platform_financial_evidence e WHERE e.id=v.evidence_id),
 'history',CASE WHEN p_id IS NULL THEN '[]'::jsonb ELSE (SELECT jsonb_agg(to_jsonb(h)||jsonb_build_object('audit',(SELECT a.details FROM public.platform_cost_reconciliation_audit a WHERE a.version_id=h.id))) FROM public.platform_cost_reconciliation_versions h WHERE h.reconciliation_id=v.reconciliation_id) END) j
 FROM (SELECT DISTINCT ON (reconciliation_id) * FROM public.platform_cost_reconciliation_versions ORDER BY reconciliation_id,revision DESC) v WHERE (p_id IS NULL OR v.reconciliation_id=p_id)
 AND (NOT p_filter ? 'status' OR v.status=p_filter->>'status') AND (NOT p_filter ? 'month' OR v.payload->>'month'=p_filter->>'month') AND (NOT p_filter ? 'organization' OR EXISTS(SELECT 1 FROM public.platform_cost_reconciliation_allocations a WHERE a.version_id=v.id AND a.organization_id=p_filter->>'organization')) ORDER BY created_at DESC,reconciliation_id LIMIT 25 OFFSET p_page*25) q;
 ELSIF p_kind='support' THEN
 SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
 PERFORM public.platform_workflow_actor(p_actor,CASE WHEN profile IN ('OWNER','ADMINISTRATOR') THEN 'a7c8f257-580d-4d39-8900-4a5788068203' ELSE 'a7c8f257-580d-4d39-8900-4a5788068204' END);
 SELECT count(*) INTO total FROM public.platform_support_cases c WHERE (profile IN ('OWNER','ADMINISTRATOR') OR c.assignee_id=p_actor) AND (NOT p_filter ? 'status' OR c.status=p_filter->>'status') AND (NOT p_filter ? 'organization' OR c.organization_id=p_filter->>'organization');
 SELECT coalesce(jsonb_agg(j),'[]'::jsonb) INTO rows FROM (SELECT to_jsonb(c)||jsonb_build_object('requesterName',public.platform_workflow_name(c.requester_id),'assigneeName',public.platform_workflow_name(c.assignee_id),'organizationName',(SELECT name FROM public.organizations WHERE id=c.organization_id),
 'history',CASE WHEN p_id IS NULL THEN '[]'::jsonb ELSE (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.revision) FROM public.platform_support_case_events e WHERE e.case_id=c.id) END) j FROM public.platform_support_cases c
 WHERE (profile IN ('OWNER','ADMINISTRATOR') OR c.assignee_id=p_actor) AND (p_id IS NULL OR c.id=p_id) AND (NOT p_filter ? 'status' OR c.status=p_filter->>'status') AND (NOT p_filter ? 'organization' OR c.organization_id=p_filter->>'organization') ORDER BY c.updated_at DESC,c.id LIMIT 25 OFFSET p_page*25) q;
 IF profile IN ('OWNER','ADMINISTRATOR') THEN SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.user_id,'name',public.platform_workflow_name(t.user_id))),'[]'::jsonb) INTO choices FROM public.platform_team_members t WHERE t.active AND t.profile='SUPPORT'; END IF;
 ELSE RAISE EXCEPTION 'Invalid workflow' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('rows',rows,'total',total,'profile',profile,'supportMembers',coalesce(choices,'[]'::jsonb),'organizations',CASE WHEN profile IN ('OWNER','ADMINISTRATOR','FINANCE') THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]'::jsonb) FROM public.organizations) ELSE '[]'::jsonb END);
END $$;
CREATE OR REPLACE FUNCTION public.platform_financial_evidence_path(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM public.platform_workflow_actor(p_actor,'a7c8f257-580d-4d39-8900-4a5788068201');
 RETURN (SELECT jsonb_build_object('path',path,'filename',filename) FROM public.platform_financial_evidence WHERE id=p_id);
END $$;
CREATE OR REPLACE FUNCTION public.find_platform_financial_evidence(p_actor uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM public.platform_workflow_actor(p_actor,'a7c8f257-580d-4d39-8900-4a5788068201');
 IF coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid hash' USING ERRCODE='22023'; END IF;
 RETURN coalesce((SELECT jsonb_build_object('id',id,'sha256',sha256) FROM public.platform_financial_evidence WHERE sha256=p_hash),'{}'::jsonb);
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.proname name,p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('platform_workflow_actor','platform_workflow_name','platform_workflow_immutable','register_platform_financial_evidence','save_platform_reconciliation','save_platform_support_case','read_platform_workflows','platform_financial_evidence_path','find_platform_financial_evidence') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 IF f.name NOT IN ('platform_workflow_actor','platform_workflow_name','platform_workflow_immutable') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END IF;
 END LOOP;
END $$;
-- Private provider invoices, never customer catalogue or public URLs.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('platform-financial-evidence','platform-financial-evidence',false,10485760,ARRAY['application/pdf']) ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='platform-financial-evidence' AND NOT public AND file_size_limit=10485760 AND allowed_mime_types=ARRAY['application/pdf']) THEN RAISE EXCEPTION 'Private financial bucket configuration conflict'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='platform_financial_browser_denied') THEN
 CREATE POLICY platform_financial_browser_denied ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING(bucket_id<>'platform-financial-evidence') WITH CHECK(bucket_id<>'platform-financial-evidence'); END IF; END $$;
COMMIT;
