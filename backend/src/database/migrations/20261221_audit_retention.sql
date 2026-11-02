-- Retention V1: additive, simulation first; no permanent deletion or cold upload.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
INSERT INTO public.permissions(id,code,name,module,resource,action) VALUES
('dbb580ca-d940-4e80-97fb-e9f9619a0006','audit.retention_manage','Administrar retenção auditada','audit','retention','manage'),
('dbb580ca-d940-4e80-97fb-e9f9619a0007','audit.archive_restore','Solicitar restauração de arquivo','audit','archive','restore'),
('dbb580ca-d940-4e80-97fb-e9f9619a0008','audit.disposition','Aprovar disposição de registros','audit','retention','dispose');
-- These permissions are registered, never granted by the migration.
CREATE TABLE public.audit_retention_policies(
 version text PRIMARY KEY, organization_id text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 mode text NOT NULL DEFAULT 'SIMULATION' CHECK(mode='SIMULATION'),
 definition jsonb NOT NULL, purpose text NOT NULL, legal_review text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), review_at timestamptz NOT NULL,
 cold_state text NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK(cold_state='NOT_CONFIGURED')
);
INSERT INTO public.audit_retention_policies(version,organization_id,enabled,definition,purpose,legal_review,review_at)
 VALUES('V1','org_default',true,'{"INFO":12,"MEDIUM":36,"SECURITY":60,"HIGH":120,"CRITICAL":null,"primaryMonths":24,"coldMonths":60,"permanentDeletion":false}',
 'Rastreabilidade, segurança, minimização e gestão do ciclo de vida dos logs; documentos e dados de negócio fora do descarte.',
 'Prazos internos aprovados; necessidade e fundamento específicos devem ser revisados antes de disposição ou conservação excepcional.',now()+interval '1 year');
CREATE TABLE public.audit_retention_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), policy_version text NOT NULL REFERENCES public.audit_retention_policies(version),
 organization_id text NOT NULL, cycle timestamptz NOT NULL, kind text NOT NULL CHECK(kind IN('SIMULATION','MOVE')),
 state text NOT NULL CHECK(state IN('RUNNING','COMPLETED','APPROVED','MOVED')),
 cursor_source text, cursor_id text, scanned bigint NOT NULL DEFAULT 0, bytes_observed bigint NOT NULL DEFAULT 0,
 counts jsonb NOT NULL DEFAULT '{}', sample jsonb NOT NULL DEFAULT '[]',
 approved_ids jsonb NOT NULL DEFAULT '[]', approved_by uuid, reason text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(policy_version,organization_id,cycle,kind)
);
CREATE TABLE public.audit_archive_objects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,policy_version text NOT NULL,
 state text NOT NULL DEFAULT 'WAITING_STORAGE' CHECK(state IN('WAITING_STORAGE','RESTORE_REQUESTED')),
 source_table text NOT NULL,source_id text NOT NULL,checksum text NOT NULL,record_count integer NOT NULL CHECK(record_count=1),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_table,source_id)
);
CREATE TABLE public.audit_logs_archive(
 source_table text NOT NULL CHECK(source_table='energy_audit_events'),source_id uuid NOT NULL,
 organization_id text NOT NULL,event_at timestamptz NOT NULL,classification text NOT NULL,
 expires_at timestamptz,policy_version text NOT NULL REFERENCES public.audit_retention_policies(version),
 canonical jsonb NOT NULL,checksum text NOT NULL,job_id uuid NOT NULL REFERENCES public.audit_retention_jobs(id),
 archived_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(source_table,source_id),
 CHECK(encode(sha256(convert_to(canonical::text,'UTF8')),'hex')=checksum),
 CHECK(canonical->>'id'=source_id::text),CHECK(canonical->>'organization_id'=organization_id)
);
CREATE INDEX audit_archive_scope_date ON public.audit_logs_archive(organization_id,event_at DESC,source_id);
CREATE INDEX audit_archive_class_date ON public.audit_logs_archive(classification,event_at);
CREATE TABLE public.audit_legal_holds(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text,source_table text,source_id text,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),basis text NOT NULL CHECK(length(basis) BETWEEN 10 AND 1000),
 review_at timestamptz NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz,released_by uuid,
 CHECK((source_table IS NULL)=(source_id IS NULL))
);
CREATE INDEX audit_holds_scope ON public.audit_legal_holds(organization_id,source_table,source_id) WHERE released_at IS NULL;
CREATE TABLE public.audit_retention_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text,actor_id uuid NOT NULL,
 action text NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),
 details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER audit_retention_decision_immutable BEFORE UPDATE OR DELETE ON public.audit_retention_decisions FOR EACH ROW EXECUTE FUNCTION public.energy_audit_immutable();
CREATE TRIGGER audit_archive_immutable BEFORE UPDATE OR DELETE ON public.audit_logs_archive FOR EACH ROW EXECUTE FUNCTION public.energy_audit_immutable();
CREATE TRIGGER audit_policy_immutable BEFORE UPDATE OR DELETE ON public.audit_retention_policies FOR EACH ROW EXECUTE FUNCTION public.energy_audit_immutable();
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['audit_retention_policies','audit_retention_jobs','audit_archive_objects','audit_logs_archive','audit_legal_holds','audit_retention_decisions'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
END LOOP;END$$;

-- Classification uses structured origin/action/module, never free-form reasons or invoice competence.
-- Unknown operations remain REVIEW and are never assigned an expiry for deletion.
CREATE FUNCTION public.energy_audit_retention_class(p_source text,p_action text,p_module text,p_role text,p_result text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE a text:=upper(coalesce(p_action,''));m text:=lower(coalesce(p_module,''));s text:=lower(coalesce(p_source,'')); mutation boolean;
BEGIN
 IF a IN('PASSWORD_CHANGE','PASSWORD_RESET','MFA','MFA_CHANGE','ACCOUNT_BLOCK') THEN RETURN 'SECURITY';END IF;
 mutation:=a~'(^|_)(CREATE|INSERT|UPDATE|EDIT|CHANGE|DELETE|REMOVE|APPROVE|APPROVED|SIGN|GRANT|REVOKE|DECIDE|AUTHORIZE|POST|PUT|PATCH)(_|$)';
 IF a~'(^|_)(DELETE|REMOVE|GRANT|REVOKE|APPROVE|APPROVED|SIGN|AUTHORIZE)(_|$)'
 OR mutation AND (m~'(user|permission|role|contract|financial|finance|invoice|billing|cost|calculation|payment|expense|tariff|license|plan|compliance|signature)' OR s~'(platform_plan_audit|platform_team_audit|portal_customer_access_events|organization_user_request_events|contract_entry_events|calculation_parameter_events|calculation_monthly_cost_events|eva_tariff_events|eva_closing_change_events)')
 OR mutation AND p_role IN('admin_platform','OWNER') THEN RETURN 'CRITICAL';END IF;
 IF a IN('AUTH_FAILURE','PASSWORD_CHANGE','PASSWORD_RESET','MFA','MFA_CHANGE','ACCOUNT_BLOCK','ADMIN_ACCESS')
 OR p_result IN('AUTH_FAILURE','DENIED') OR m IN('security','auth','authentication') AND a NOT IN('READ','LOGIN','LOGOUT','MODULE_VISIT') THEN RETURN 'SECURITY';END IF;
 IF a IN('READ','LOGIN','LOGOUT','MODULE_VISIT','VIEW','DASHBOARD','DOWNLOAD_REQUEST','GET') THEN RETURN 'INFO';END IF;
 IF m~'(financial|finance|invoice|contract|billing|calculation)' OR s~'(calculation_|contract_|eva_assisted_closing|eva_closing)' THEN RETURN 'HIGH';END IF;
 IF mutation THEN RETURN 'MEDIUM';END IF;
 RETURN 'REVIEW';
END$$;
CREATE FUNCTION public.energy_audit_retention_expiry(p_class text,p_at timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT CASE p_class
 WHEN 'INFO' THEN ((p_at AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC' WHEN 'MEDIUM' THEN ((p_at AT TIME ZONE 'UTC')+interval '36 months') AT TIME ZONE 'UTC'
 WHEN 'SECURITY' THEN ((p_at AT TIME ZONE 'UTC')+interval '60 months') AT TIME ZONE 'UTC' WHEN 'HIGH' THEN ((p_at AT TIME ZONE 'UTC')+interval '120 months') AT TIME ZONE 'UTC' END $$;
CREATE FUNCTION public.energy_audit_retention_held(p_org text,p_source text,p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.audit_legal_holds WHERE organization_id IS NOT DISTINCT FROM p_org AND released_at IS NULL
 AND(source_table IS NULL OR source_table=p_source AND source_id=p_id))
$$;
CREATE VIEW public.energy_audit_retained_events WITH(security_barrier=true) AS
 SELECT id::text id,organization_id,actor_id,role,module,action,resource,reason,result,ip,ip_basis,'http'::text source,
 jsonb_build_object('release',release,'storage','PRIMARY') details,created_at FROM public.energy_audit_events
 UNION ALL SELECT id,organization_id,actor_id,role,module,action,resource,reason,result,ip,ip_basis,source,
 details||jsonb_build_object('storage','PRIMARY') details,created_at FROM public.energy_audit_source_events
 UNION ALL SELECT a.source_id::text,a.organization_id,a.canonical->>'actor_id',a.canonical->>'role',a.canonical->>'module',a.canonical->>'action',
 a.canonical->>'resource',a.canonical->>'reason',a.canonical->>'result',a.canonical->>'ip',a.canonical->>'ip_basis','http',
 jsonb_build_object('release',a.canonical->>'release','storage','HISTORY','classification',a.classification,'expiresAt',a.expires_at,'policy',a.policy_version),a.event_at
 FROM public.audit_logs_archive a WHERE NOT EXISTS(SELECT 1 FROM public.energy_audit_events e WHERE e.id=a.source_id);
REVOKE ALL ON public.energy_audit_retained_events FROM PUBLIC,anon,authenticated,service_role;

-- Compatibility patch to the existing authorized/redacted query; fail rather than silently lose its guards.
DO $migration$ DECLARE body text;old_union text:=$old$SELECT id::text id,organization_id,actor_id,role,module,action,resource,reason,result,ip,ip_basis,'http'::text source,jsonb_build_object('release',release) details,created_at FROM public.energy_audit_events
 UNION ALL SELECT id,organization_id,actor_id,role,module,action,resource,reason,result,ip,ip_basis,source,details,created_at FROM public.energy_audit_source_events$old$;
BEGIN
 old_union:=replace(old_union,E'\r\n',E'\n');
 body:=replace(pg_get_functiondef('public.energy_audit_read(text,uuid,boolean,jsonb)'::regprocedure),E'\r\n',E'\n');
 IF strpos(body,old_union)=0 OR strpos(body,'u-f>interval ''180 days''')=0 OR strpos(body,'Janela técnica de 180 dias, sem exclusão automática.')=0 THEN RAISE EXCEPTION 'Audit query changed: inspect compatibility';END IF;
 body:=replace(body,old_union,'SELECT * FROM public.energy_audit_retained_events');
 body:=replace(body,'u-f>interval ''180 days'' OR f<now()-interval ''181 days''',
 'u-f>interval ''24 months'' OR f<''1900-01-01''::timestamptz OR coalesce(p_filters->>''storage'',''PRIMARY'') NOT IN(''PRIMARY'',''HISTORY'',''ALL'') OR coalesce(p_filters->>''storage'',''PRIMARY'')=''PRIMARY'' AND f<now()-interval ''24 months 1 day''');
 body:=replace(body,'WHERE e.created_at BETWEEN f AND u AND(p_global',
 'WHERE e.created_at BETWEEN f AND u AND(coalesce(p_filters->>''storage'',''PRIMARY'')=''ALL'' OR e.details->>''storage''=coalesce(p_filters->>''storage'',''PRIMARY'')) AND(p_global');
 body:=replace(body,'''windowDays'',180','''windowMonths'',24');
 body:=replace(body,'Janela técnica de 180 dias, sem exclusão automática.','Política V1: consulta principal até 24 meses; histórico pesquisável. Simulação mensal, sem exclusão definitiva automática.');
 EXECUTE body;
END $migration$;

-- Monthly inventory: bounded keyset batches, atomic transaction lock, resumable cursor.
CREATE FUNCTION public.energy_audit_retention_tick(p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pol public.audit_retention_policies;j public.audit_retention_jobs;e record;c text;x timestamptz;bucket text;n integer:=0;
 cy timestamptz:=date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
BEGIN
 IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid batch size' USING ERRCODE='22023';END IF;
 IF NOT pg_try_advisory_xact_lock(6040621) THEN RETURN jsonb_build_object('state','BUSY');END IF;
 cy:=cy+interval '3 hours';IF now()<cy THEN cy:=cy-interval '1 month';END IF;
 SELECT * INTO pol FROM public.audit_retention_policies WHERE enabled AND organization_id='org_default' ORDER BY created_at DESC LIMIT 1;
 IF pol.version IS NULL THEN RETURN jsonb_build_object('state','DISABLED');END IF;
 SELECT * INTO j FROM public.audit_retention_jobs WHERE policy_version=pol.version AND organization_id=pol.organization_id AND kind='SIMULATION' AND state='RUNNING' ORDER BY cycle LIMIT 1 FOR UPDATE;
 IF j.id IS NULL THEN
 INSERT INTO public.audit_retention_jobs(policy_version,organization_id,cycle,kind,state) VALUES(pol.version,pol.organization_id,cy,'SIMULATION','RUNNING') ON CONFLICT DO NOTHING;
 SELECT * INTO j FROM public.audit_retention_jobs WHERE policy_version=pol.version AND organization_id=pol.organization_id AND cycle=cy AND kind='SIMULATION' FOR UPDATE;
 END IF;
 cy:=j.cycle;
 IF j.state='COMPLETED' THEN RETURN jsonb_build_object('state','COMPLETED','id',j.id);END IF;
 FOR e IN SELECT * FROM public.energy_audit_retained_events WHERE organization_id=pol.organization_id
 AND(created_at IS NULL OR created_at<=cy) AND (j.cursor_source IS NULL OR (source,id)>(j.cursor_source,j.cursor_id)) ORDER BY source,id LIMIT p_limit LOOP
 c:=public.energy_audit_retention_class(e.source,e.action,e.module,e.role,e.result);x:=public.energy_audit_retention_expiry(c,e.created_at);
 bucket:=CASE WHEN e.created_at IS NULL OR c='REVIEW' THEN 'REVIEW' WHEN public.energy_audit_retention_held(e.organization_id,CASE WHEN e.source='http' THEN 'energy_audit_events' ELSE e.source END,e.id) THEN 'HELD'
 WHEN x<=cy THEN 'EXPIRED_PENDING_DECISION' WHEN e.created_at<=cy-interval '60 months' THEN 'WAITING_STORAGE'
 WHEN e.created_at<=cy-interval '24 months' AND e.source='http' AND e.details->>'storage'='PRIMARY' THEN 'MOVE_ELIGIBLE'
 WHEN e.created_at<=cy-interval '24 months' AND e.source<>'http' THEN 'SOURCE_ADAPTER_REVIEW' ELSE 'WITHIN_RETENTION' END;
 j.counts:=jsonb_set(j.counts,ARRAY[c||':'||bucket],to_jsonb(coalesce((j.counts->>(c||':'||bucket))::bigint,0)+1));
 IF bucket='MOVE_ELIGIBLE' AND jsonb_array_length(j.sample)<10 THEN j.sample:=j.sample||jsonb_build_array(jsonb_build_object('source','energy_audit_events','id',e.id,'at',e.created_at,'classification',c));END IF;
 j.scanned:=j.scanned+1;j.bytes_observed:=j.bytes_observed+octet_length(to_jsonb(e)::text);j.cursor_source:=e.source;j.cursor_id:=e.id;n:=n+1;
 END LOOP;
 UPDATE public.audit_retention_jobs SET counts=j.counts,sample=j.sample,scanned=j.scanned,bytes_observed=j.bytes_observed,cursor_source=j.cursor_source,cursor_id=j.cursor_id,
 state=CASE WHEN n<p_limit THEN 'COMPLETED' ELSE 'RUNNING' END,updated_at=now(),completed_at=CASE WHEN n<p_limit THEN now() END WHERE id=j.id;
 RETURN jsonb_build_object('state',CASE WHEN n<p_limit THEN 'COMPLETED' ELSE 'RUNNING' END,'id',j.id,'batch',n,'scanned',j.scanned);
END$$;

CREATE FUNCTION public.energy_audit_retention_owner(p_actor uuid,p_permission text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM public.energy_audit_authorize(NULL,p_actor,true,p_permission);
 IF NOT EXISTS(SELECT 1 FROM public.platform_team_members WHERE user_id::text=p_actor::text AND active AND profile='OWNER') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;RETURN true;
END$$;

CREATE FUNCTION public.energy_audit_retention_read(p_org text,p_actor uuid,p_global boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.energy_audit_authorize(p_org,p_actor,p_global,CASE WHEN p_global THEN 'dbb580ca-d940-4e80-97fb-e9f9619a0004' ELSE 'dbb580ca-d940-4e80-97fb-e9f9619a0001' END);
 RETURN jsonb_build_object('policy',jsonb_build_object('version','V1','INFO',12,'MEDIUM',36,'SECURITY',60,'HIGH',120,'CRITICAL',null,'primaryMonths',24,'coldMonths',60,'permanentDeletion',false),
 'schedule','Dia 1 às 03:00 — Brasília','lastCheck',(SELECT max(updated_at) FROM public.audit_retention_jobs WHERE p_global OR organization_id=p_org),'nextCheck',now()+interval '1 minute','nextRun',((date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')+interval '1 month 3 hours') AT TIME ZONE 'America/Sao_Paulo'),
 'automation','SIMULATION','coldState','NOT_CONFIGURED','primaryOnlyMovementSource','energy_audit_events',
 'jobs',coalesce((SELECT jsonb_agg(to_jsonb(q)-'approved_ids'-'cursor_id'-'cursor_source') FROM (SELECT * FROM public.audit_retention_jobs WHERE p_global OR organization_id=p_org ORDER BY created_at DESC LIMIT 25)q),'[]'::jsonb),
 'holds',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM public.audit_legal_holds WHERE p_global OR organization_id=p_org ORDER BY created_at DESC LIMIT 25)q),'[]'::jsonb),
 'decisions',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM public.audit_retention_decisions WHERE p_global OR organization_id=p_org ORDER BY created_at DESC LIMIT 25)q),'[]'::jsonb),
 'archive',jsonb_build_object('records',(SELECT count(*) FROM public.audit_logs_archive WHERE p_global OR organization_id=p_org),'canonicalBytes',(SELECT coalesce(sum(octet_length(canonical::text)),0) FROM public.audit_logs_archive WHERE p_global OR organization_id=p_org)),
 'objects',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (SELECT * FROM public.audit_archive_objects WHERE p_global OR organization_id=p_org ORDER BY created_at DESC LIMIT 25)q),'[]'::jsonb));
END$$;

-- No generic deletion bypass. A row can leave the source ONLY during its exact approved transfer.
CREATE FUNCTION public.energy_audit_verified_transfer_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.audit_logs_archive a JOIN public.audit_retention_jobs j ON j.id=a.job_id
 WHERE a.source_table='energy_audit_events' AND a.source_id=OLD.id AND a.organization_id=OLD.organization_id
 AND a.canonical=to_jsonb(OLD) AND a.checksum=encode(sha256(convert_to(to_jsonb(OLD)::text,'UTF8')),'hex')
 AND j.organization_id=OLD.organization_id AND j.kind='MOVE' AND j.state='RUNNING' AND j.approved_by IS NOT NULL AND j.approved_ids?OLD.id::text
 AND EXISTS(SELECT 1 FROM public.audit_retention_decisions d WHERE d.action='APPROVE_MOVE' AND d.actor_id=j.approved_by AND d.details->>'jobId'=j.id::text))
 THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Immutable audit: verified approved transfer required' USING ERRCODE='42501';
END$$;
DROP TRIGGER energy_audit_event_immutable ON public.energy_audit_events;
CREATE TRIGGER energy_audit_event_immutable BEFORE UPDATE OR DELETE ON public.energy_audit_events FOR EACH ROW EXECUTE FUNCTION public.energy_audit_verified_transfer_guard();

CREATE FUNCTION public.energy_audit_retention_act(p_actor uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE why text:=public.energy_audit_text(p_data->>'reason');org text:=nullif(p_data->>'organization','');d uuid;ids jsonb;bad integer;
 e public.energy_audit_events;j public.audit_retention_jobs;cl text;ex timestamptz;can jsonb;h text;n integer:=0;
BEGIN
 PERFORM public.energy_audit_retention_owner(p_actor,CASE WHEN p_action='REQUEST_RESTORE' THEN 'dbb580ca-d940-4e80-97fb-e9f9619a0007' ELSE 'dbb580ca-d940-4e80-97fb-e9f9619a0006' END);
 IF why IS NULL OR length(why)<10 OR p_action NOT IN('HOLD','RELEASE_HOLD','APPROVE_MOVE','EXECUTE_MOVE','REQUEST_RESTORE') THEN RAISE EXCEPTION 'Invalid retention decision' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(6040621);
 IF p_action='HOLD' THEN
 IF length(coalesce(p_data->>'basis','')) NOT BETWEEN 10 AND 1000 OR (p_data->>'reviewAt')::timestamptz<=now() OR (p_data->>'reviewAt') IS NULL
 OR org IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid hold scope or review' USING ERRCODE='22023';END IF;
 INSERT INTO public.audit_legal_holds(organization_id,source_table,source_id,reason,basis,review_at,created_by)
 VALUES(org,nullif(p_data->>'source',''),nullif(p_data->>'sourceId',''),why,public.energy_audit_text(p_data->>'basis'),(p_data->>'reviewAt')::timestamptz,p_actor) RETURNING id INTO d;
 ELSIF p_action='RELEASE_HOLD' THEN
 UPDATE public.audit_legal_holds SET released_at=now(),released_by=p_actor WHERE id=(p_data->>'id')::uuid AND released_at IS NULL RETURNING id,organization_id INTO d,org;
 IF d IS NULL THEN RAISE EXCEPTION 'Hold unavailable' USING ERRCODE='22023';END IF;
 ELSIF p_action='APPROVE_MOVE' THEN
 ids:=p_data->'ids';IF org<>'org_default' OR org IS NULL OR jsonb_typeof(ids) IS DISTINCT FROM 'array' OR jsonb_array_length(ids) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid exact batch' USING ERRCODE='22023';END IF;
 SELECT count(*) INTO bad FROM jsonb_array_elements(ids) z WHERE jsonb_typeof(z)<>'string' OR z#>>'{}'!~'^[0-9a-f-]{36}$';IF bad>0 THEN RAISE EXCEPTION 'Invalid identities' USING ERRCODE='22023';END IF;
 SELECT count(*) INTO bad FROM (SELECT DISTINCT value FROM jsonb_array_elements(ids))z;IF bad<>jsonb_array_length(ids) THEN RAISE EXCEPTION 'Duplicate identities' USING ERRCODE='22023';END IF;
 FOR e IN SELECT * FROM public.energy_audit_events WHERE organization_id=org AND ids?id::text FOR UPDATE LOOP
 cl:=public.energy_audit_retention_class('http',e.action,e.module,e.role,e.result);ex:=public.energy_audit_retention_expiry(cl,e.created_at);
 IF e.created_at>now()-interval '24 months' OR cl='REVIEW' OR ex<=now() OR public.energy_audit_retention_held(org,'energy_audit_events',e.id::text) THEN RAISE EXCEPTION 'Ineligible source or legal hold' USING ERRCODE='22023';END IF;n:=n+1;
 END LOOP;
 IF n<>jsonb_array_length(ids) THEN RAISE EXCEPTION 'Exact source batch unavailable' USING ERRCODE='22023';END IF;
 INSERT INTO public.audit_retention_jobs(policy_version,organization_id,cycle,kind,state,approved_ids,approved_by,reason)
 VALUES('V1',org,clock_timestamp(),'MOVE','APPROVED',ids,p_actor,why) RETURNING id INTO d;
 ELSIF p_action='EXECUTE_MOVE' THEN
 SELECT * INTO j FROM public.audit_retention_jobs WHERE id=(p_data->>'id')::uuid AND kind='MOVE' FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'Batch unavailable' USING ERRCODE='22023';END IF;org:=j.organization_id;d:=j.id;
 IF j.state='MOVED' THEN RETURN jsonb_build_object('id',j.id,'state','MOVED','idempotent',true);END IF;
 PERFORM public.energy_audit_retention_owner(j.approved_by,'dbb580ca-d940-4e80-97fb-e9f9619a0006');
 IF j.state<>'APPROVED' THEN RAISE EXCEPTION 'Batch not approved' USING ERRCODE='22023';END IF;
 UPDATE public.audit_retention_jobs SET state='RUNNING',updated_at=now() WHERE id=j.id;
 FOR e IN SELECT * FROM public.energy_audit_events WHERE organization_id=org AND j.approved_ids?id::text ORDER BY id FOR UPDATE LOOP
 cl:=public.energy_audit_retention_class('http',e.action,e.module,e.role,e.result);ex:=public.energy_audit_retention_expiry(cl,e.created_at);
 IF e.created_at>now()-interval '24 months' OR cl='REVIEW' OR ex<=now() OR public.energy_audit_retention_held(org,'energy_audit_events',e.id::text) THEN RAISE EXCEPTION 'Source no longer eligible' USING ERRCODE='22023';END IF;
 can:=to_jsonb(e);h:=encode(sha256(convert_to(can::text,'UTF8')),'hex');
 INSERT INTO public.audit_logs_archive(source_table,source_id,organization_id,event_at,classification,expires_at,policy_version,canonical,checksum,job_id)
 VALUES('energy_audit_events',e.id,org,e.created_at,cl,ex,j.policy_version,can,h,j.id);
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs_archive WHERE source_id=e.id AND canonical=can AND checksum=h AND job_id=j.id) THEN RAISE EXCEPTION 'Archive verification failed';END IF;
 DELETE FROM public.energy_audit_events WHERE id=e.id;n:=n+1;
 IF e.created_at<=now()-interval '60 months' THEN INSERT INTO public.audit_archive_objects(organization_id,policy_version,source_table,source_id,checksum,record_count)
 VALUES(org,j.policy_version,'energy_audit_events',e.id::text,h,1);END IF;
 END LOOP;
 IF n<>jsonb_array_length(j.approved_ids) THEN RAISE EXCEPTION 'Source count mismatch';END IF;
 UPDATE public.audit_retention_jobs SET state='MOVED',scanned=n,updated_at=now(),completed_at=now() WHERE id=j.id;
 ELSIF p_action='REQUEST_RESTORE' THEN
 -- No external upload/rehydration until a dedicated destination is homologated.
 SELECT id,organization_id INTO d,org FROM public.audit_archive_objects WHERE id=(p_data->>'id')::uuid;
 IF d IS NULL THEN RAISE EXCEPTION 'Object unavailable' USING ERRCODE='22023';END IF;
 UPDATE public.audit_archive_objects SET state='RESTORE_REQUESTED' WHERE id=d;
 END IF;
 INSERT INTO public.audit_retention_decisions(organization_id,actor_id,action,reason,details)
 VALUES(org,p_actor,p_action,why,jsonb_build_object('jobId',d,'count',n,'coldState','NOT_CONFIGURED'));
 RETURN jsonb_build_object('id',d,'action',p_action,'count',n,'coldState','NOT_CONFIGURED');
END$$;

DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'energy_audit_retention_%' OR p.proname='energy_audit_verified_transfer_guard') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION public.energy_audit_retention_read(text,uuid,boolean),public.energy_audit_retention_tick(integer),public.energy_audit_retention_act(uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
