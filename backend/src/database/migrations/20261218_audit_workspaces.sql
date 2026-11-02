-- Additive audit workspaces. No license activation or role/user grants.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
ALTER TABLE public.plan_catalog ADD COLUMN organization_audit boolean NOT NULL DEFAULT false;
ALTER TABLE public.licenses ADD COLUMN organization_audit boolean NOT NULL DEFAULT false;
INSERT INTO public.permissions(id,code,name,module,resource,action) VALUES
('dbb580ca-d940-4e80-97fb-e9f9619a0001','audit.view','Consultar auditoria da organização','audit','events','view'),
('dbb580ca-d940-4e80-97fb-e9f9619a0002','audit.ip','Consultar IP restrito da auditoria','audit','technical','view'),
('dbb580ca-d940-4e80-97fb-e9f9619a0003','audit.review','Tratar alertas da organização','audit','alerts','review'),
('dbb580ca-d940-4e80-97fb-e9f9619a0004','audit.global','Consultar Auditoria Global','audit','global','view'),
('dbb580ca-d940-4e80-97fb-e9f9619a0005','audit.global_review','Tratar alertas globais','audit','global','review');
CREATE TABLE public.energy_audit_events(
 id uuid PRIMARY KEY, organization_id text, actor_id text, role text, module text NOT NULL, action text NOT NULL,
 resource text, reason text, result text NOT NULL, status_code integer, duration_ms integer,
 ip text,ip_basis text,origin text,session_id text,release text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(length(coalesce(reason,''))<=1000),CHECK(length(module)<=100),CHECK(length(coalesce(resource,''))<=200)
);
CREATE INDEX energy_audit_events_scope_date ON public.energy_audit_events(organization_id,created_at DESC,id DESC);
CREATE INDEX energy_audit_events_detection ON public.energy_audit_events(result,created_at DESC,organization_id,actor_id);
CREATE TABLE public.energy_audit_sessions(
 session_id text NOT NULL,scope_key text NOT NULL,organization_id text,actor_id text NOT NULL,
 last_seen timestamptz NOT NULL,expires_at timestamptz NOT NULL,module text NOT NULL,ended_at timestamptz,
 PRIMARY KEY(session_id,scope_key)
);
CREATE INDEX energy_audit_presence ON public.energy_audit_sessions(organization_id,last_seen DESC);
CREATE TABLE public.energy_audit_alerts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text,kind text NOT NULL,subject text NOT NULL,
 evidence_count integer NOT NULL,first_at timestamptz NOT NULL DEFAULT now(),last_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','ANALYSIS','RESOLVED','FALSE_POSITIVE')),revision integer NOT NULL DEFAULT 1
);
CREATE INDEX energy_audit_alert_scope ON public.energy_audit_alerts(organization_id,last_at DESC,id DESC);
CREATE INDEX energy_audit_alert_dedupe ON public.energy_audit_alerts(kind,subject,last_at DESC);
CREATE TABLE public.energy_audit_alert_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),alert_id uuid NOT NULL REFERENCES public.energy_audit_alerts(id),actor_id text NOT NULL,
 state text NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 1000),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.energy_audit_health(source text PRIMARY KEY,last_success timestamptz,last_error_at timestamptz,error_code text);
-- Query window is 180 days. This migration performs no purge or retroactive deletion.
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['energy_audit_events','energy_audit_sessions','energy_audit_alerts','energy_audit_alert_decisions','energy_audit_health'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
END LOOP;END$$;
CREATE FUNCTION public.energy_audit_text(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT left(regexp_replace(regexp_replace(regexp_replace(v,'[[:cntrl:]]',' ','g'),'https?://[^[:space:]]+','[URL omitida]','gi'),'(bearer[[:space:]]+[^[:space:]]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|re_[A-Za-z0-9_]{15,}|(password|senha|token|secret|api.?key|authorization|cookie)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)','[segredo omitido]','gi'),1000)
$$;
CREATE FUNCTION public.energy_audit_authorize(p_org text,p_actor uuid,p_global boolean,p_permission text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ok boolean; perms jsonb; lim jsonb; role_name text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<now())) THEN RAISE EXCEPTION 'Inactive actor' USING ERRCODE='42501';END IF;
 IF p_global THEN
 SELECT EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.platform_team_members m ON m.user_id::text=u.user_id::text AND m.active AND m.profile IN('OWNER','ADMINISTRATOR') WHERE u.user_id::text=p_actor::text AND r.scope='global' AND r.permissions?p_permission) INTO ok;
 ELSE
 SELECT r.permissions,to_jsonb(m)->'permission_limit',r.name INTO perms,lim,role_name FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 JOIN public.organizations o ON o.id=m.organization_id AND o.deleted_at IS NULL WHERE m.organization_id=p_org AND m.user_id::text=p_actor::text AND m.status='active' AND m.affiliation_type='internal';
 ok:=role_name IN('admin_org','gestor','operacional') AND coalesce(perms?p_permission,false) AND(lim IS NULL OR lim='null'::jsonb OR lim?p_permission);
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND organization_audit AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE)) THEN ok:=false;END IF;
 END IF;
 IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'Audit access denied' USING ERRCODE='42501';END IF;RETURN true;
END$$;
CREATE FUNCTION public.energy_audit_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Immutable audit record' USING ERRCODE='42501';END$$;
CREATE TRIGGER energy_audit_event_immutable BEFORE UPDATE OR DELETE ON public.energy_audit_events FOR EACH ROW EXECUTE FUNCTION public.energy_audit_immutable();
CREATE TRIGGER energy_audit_decision_immutable BEFORE UPDATE OR DELETE ON public.energy_audit_alert_decisions FOR EACH ROW EXECUTE FUNCTION public.energy_audit_immutable();
CREATE FUNCTION public.energy_audit_capture(p_event jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e public.energy_audit_events;n integer; threshold integer;span interval;k text;sub text;al public.energy_audit_alerts;
BEGIN
 IF jsonb_typeof(p_event)<>'object' OR octet_length(p_event::text)>8000 THEN RAISE EXCEPTION 'Invalid event' USING ERRCODE='22023';END IF;
 e:=jsonb_populate_record(null::public.energy_audit_events,p_event);e.created_at:=now();e.reason:=public.energy_audit_text(e.reason);
 IF e.id IS NULL OR e.module IS NULL OR e.action IS NULL OR e.result IS NULL THEN RAISE EXCEPTION 'Incomplete event' USING ERRCODE='22023';END IF;
 INSERT INTO public.energy_audit_events SELECT e.* ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false;END IF;
 k:=CASE WHEN e.result='AUTH_FAILURE' THEN 'AUTH_FAILURE' WHEN e.result='DENIED' THEN 'DENIED' WHEN e.action='DOWNLOAD_REQUEST' THEN 'DOWNLOAD_BURST' WHEN e.result='CRITICAL' THEN 'CRITICAL_ERROR' END;
 IF k IS NOT NULL THEN
 threshold:=CASE k WHEN 'AUTH_FAILURE' THEN 5 WHEN 'DENIED' THEN 10 WHEN 'DOWNLOAD_BURST' THEN 20 ELSE 1 END;
 span:=CASE k WHEN 'DENIED' THEN interval '5 minutes' ELSE interval '10 minutes' END;
 sub:=coalesce(e.actor_id,e.origin);IF sub IS NOT NULL THEN
 PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(e.organization_id,'GLOBAL')||':'||k||':'||sub,0));
 SELECT count(*) INTO n FROM public.energy_audit_events x WHERE x.organization_id IS NOT DISTINCT FROM e.organization_id AND x.created_at>=now()-span
 AND coalesce(x.actor_id,x.origin)=sub AND CASE k WHEN 'DOWNLOAD_BURST' THEN x.action='DOWNLOAD_REQUEST' ELSE x.result=e.result END;
 IF n>=threshold THEN
 SELECT * INTO al FROM public.energy_audit_alerts WHERE organization_id IS NOT DISTINCT FROM e.organization_id AND kind=k AND subject=sub AND last_at>now()-interval '15 minutes' AND state IN('OPEN','ANALYSIS') ORDER BY last_at DESC LIMIT 1;
 IF al.id IS NULL THEN INSERT INTO public.energy_audit_alerts(organization_id,kind,subject,evidence_count) VALUES(e.organization_id,k,sub,n);
 ELSE UPDATE public.energy_audit_alerts SET evidence_count=n,last_at=now(),revision=revision+1 WHERE id=al.id;END IF;
 END IF;END IF;
 END IF;
 INSERT INTO public.energy_audit_health(source,last_success) VALUES('http',now()) ON CONFLICT(source) DO UPDATE SET last_success=excluded.last_success;
 RETURN true;
END$$;
CREATE FUNCTION public.energy_audit_presence(p_org text,p_actor uuid,p_session text,p_expires timestamptz,p_module text,p_stop boolean,p_visit boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.energy_audit_sessions;rn text;ok boolean;sk text:=coalesce(p_org,'GLOBAL');
BEGIN
 IF length(p_session)<>64 OR p_session!~'^[a-f0-9]+$' OR p_expires<=now() OR p_expires>now()+interval '2 days' OR p_module!~'^/backoffice(/[a-z0-9-]+){0,4}$' THEN RAISE EXCEPTION 'Invalid session observation' USING ERRCODE='22023';END IF;
 IF p_org IS NULL THEN SELECT EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.platform_team_members m ON m.user_id::text=u.user_id::text AND m.active WHERE u.user_id::text=p_actor::text AND r.scope='global') INTO ok;
 ELSE SELECT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor::text AND m.status='active' AND m.affiliation_type='internal' AND r.name IN('admin_org','gestor','operacional')) INTO ok;END IF;
 IF NOT coalesce(ok,false) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<now())) THEN RAISE EXCEPTION 'Invalid session actor' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_session||sk,0));
 SELECT * INTO prior FROM public.energy_audit_sessions WHERE session_id=p_session AND scope_key=sk;
 IF prior.session_id IS NOT NULL AND prior.actor_id<>p_actor::text THEN RAISE EXCEPTION 'Session actor mismatch' USING ERRCODE='42501';END IF;
 IF NOT p_stop AND prior.last_seen>now()-interval '55 seconds' AND prior.module=p_module THEN RETURN jsonb_build_object('observed',true,'throttled',true);END IF;
 INSERT INTO public.energy_audit_sessions(session_id,scope_key,organization_id,actor_id,last_seen,expires_at,module,ended_at) VALUES(p_session,sk,p_org,p_actor::text,now(),p_expires,p_module,CASE WHEN p_stop THEN now() END)
 ON CONFLICT(session_id,scope_key) DO UPDATE SET last_seen=now(),expires_at=p_expires,module=p_module,ended_at=CASE WHEN p_stop THEN now() END;
 IF p_stop OR p_visit AND prior.module IS DISTINCT FROM p_module THEN PERFORM public.energy_audit_capture(jsonb_build_object('id',gen_random_uuid(),'organization_id',p_org,'actor_id',p_actor,'module',split_part(p_module,'/',3),'action',CASE WHEN p_stop THEN 'LOGOUT' ELSE 'MODULE_VISIT' END,'resource',p_module,'result','SUCCESS','session_id',p_session));END IF;
 RETURN jsonb_build_object('observed',true);
END$$;
CREATE FUNCTION public.energy_audit_changes(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_object_agg(k,v),'{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(j)='object' THEN j ELSE '{}'::jsonb END) n(k,v)
 WHERE k IN('active','status','state','version','governance_revision','license_type','plan_id','plan_version','role_id','max_users','max_clients','max_consumer_units','documents_limit','documents_unlimited','document_management','advanced_analytics','report_generation','free_market_management','client_portal','ccee_data','ccee_registrations','trading_hub','organization_audit','name')
 AND jsonb_typeof(v) IN('string','number','boolean','null') AND length(v::text)<=150 AND v::text!~*'(https?://|bearer|eyJ[A-Za-z0-9_-]+\.|password|senha|token|secret)'
$$;
-- Whitelisted projections. Never return raw changes, payloads, prompts or signed URLs.
DO $$DECLARE t text;parts text[]:=ARRAY[]::text[];date_expr text;BEGIN
 FOREACH t IN ARRAY ARRAY['audit_logs','platform_plan_audit','platform_team_audit','platform_support_case_events','ccee_registration_history','trading_portal_audit','eva_assisted_closing_events','eva_tariff_events','eva_closing_change_events','calculation_preparation_run_events','eva_automatic_intake_events','eva_intake_unit_aliases_audit','portal_customer_access_events','ccee_integration_events','platform_cost_service_events','platform_sales_activation_events','platform_sales_provisioning_events','calculation_parameter_events','calculation_monthly_input_events','contract_entry_events','calculation_monthly_cost_events','operation_record_history','document_catalog_events','platform_cost_audit','trading_history','consumer_unit_location_history','acl_admission_events','report_policy_history','report_job_events','customer_notice_history','client_portal_license_events','energy_forecast_events','energy_forecast_history','platform_cost_reconciliation_audit','user_environment_events','organization_user_request_events'] LOOP
 IF to_regclass('public.'||t) IS NOT NULL THEN
 INSERT INTO public.energy_audit_health(source) VALUES('projection:'||t);
 SELECT format('a.%I',column_name) INTO date_expr FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name IN('created_at','recorded_at','occurred_at','changed_at','at') AND data_type IN('timestamp with time zone','timestamp without time zone') ORDER BY CASE column_name WHEN 'created_at' THEN 0 ELSE 1 END LIMIT 1;
 date_expr:=coalesce(date_expr,'NULL::timestamptz');
 parts:=array_append(parts,format($q$SELECT %L||':'||coalesce(j->>'id',md5(j::text)) id,coalesce(j->>'organization_id',j->>'org') organization_id,coalesce(j->>'user_id',j->>'actor_id',j->>'actor') actor_id,j->>'role' role,coalesce(j->>'resource_type',%L) module,coalesce(j->>'action',j->>'event_type',j->>'kind','EVENT') action,coalesce(j->>'resource_id',j->>'record_id',j->>'document_id',j->>'contract_id',j->>'case_id',j->>'plan_id') resource,public.energy_audit_text(coalesce(j->>'reason',j->>'justification',j#>>'{changes,reason}',j#>>'{details,reason}',j#>>'{changes,after,reason}')) reason,coalesce(j->>'status','RECORDED') result,coalesce(j->>'ip_address',j->>'ip') ip,CASE WHEN coalesce(j->>'ip_address',j->>'ip') IS NOT NULL THEN 'SOURCE_RECORDED_UNVERIFIED' END ip_basis,%L source,jsonb_build_object('before',public.energy_audit_changes(j#>'{changes,before}'),'after',public.energy_audit_changes(coalesce(j#>'{changes,after}',j->'snapshot'))) details,%s created_at FROM public.%I a CROSS JOIN LATERAL (SELECT to_jsonb(a) j) n$q$,t,t,t,date_expr,t));
 END IF;END LOOP;
 EXECUTE 'CREATE VIEW public.energy_audit_source_events WITH (security_barrier=true) AS '||array_to_string(parts,' UNION ALL ');
END$$;
REVOKE ALL ON public.energy_audit_source_events FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.energy_audit_read(p_org text,p_actor uuid,p_global boolean,p_filters jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE perm text:=CASE WHEN p_global THEN 'dbb580ca-d940-4e80-97fb-e9f9619a0004' ELSE 'dbb580ca-d940-4e80-97fb-e9f9619a0001' END;
 ip_ok boolean:=false;f timestamptz:=(p_filters->>'from')::timestamptz;u timestamptz:=(p_filters->>'to')::timestamptz;
 sz integer:=coalesce((p_filters->>'size')::integer,25);pg integer:=coalesce((p_filters->>'page')::integer,0);o text;outcome jsonb;cov jsonb;
BEGIN
 PERFORM public.energy_audit_authorize(p_org,p_actor,p_global,perm);
 BEGIN PERFORM public.energy_audit_authorize(p_org,p_actor,p_global,CASE WHEN p_global THEN perm ELSE 'dbb580ca-d940-4e80-97fb-e9f9619a0002' END);ip_ok:=true;EXCEPTION WHEN insufficient_privilege THEN ip_ok:=false;END;
 IF f IS NULL OR u IS NULL OR f>u OR u-f>interval '180 days' OR f<now()-interval '181 days' OR sz NOT IN(25,50,100) OR pg<0 OR pg>10000 OR(NOT p_global AND p_filters?'organization') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
 o:=CASE WHEN p_global THEN nullif(p_filters->>'organization','') ELSE p_org END;
 WITH all_events AS(
 SELECT id::text id,organization_id,actor_id,role,module,action,resource,reason,result,ip,ip_basis,'http'::text source,jsonb_build_object('release',release) details,created_at FROM public.energy_audit_events
 UNION ALL SELECT id,organization_id,actor_id,role,module,action,resource,reason,result,ip,ip_basis,source,details,created_at FROM public.energy_audit_source_events
 ),filtered AS(SELECT * FROM all_events e WHERE e.created_at BETWEEN f AND u AND(p_global AND o IS NULL OR e.organization_id=o)
 AND(coalesce(p_filters->>'module','')='' OR e.module=p_filters->>'module') AND(coalesce(p_filters->>'actor','')='' OR e.actor_id=p_filters->>'actor')
 AND(coalesce(p_filters->>'action','')='' OR e.action=p_filters->>'action') AND(coalesce(p_filters->>'result','')='' OR e.result=p_filters->>'result') AND(coalesce(p_filters->>'resource','')='' OR e.resource=p_filters->>'resource')),
 page AS(SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT sz OFFSET pg*sz)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg((to_jsonb(x)-'ip')||jsonb_build_object('ip',CASE WHEN ip_ok THEN x.ip END,'actor_name_current',(SELECT coalesce(nullif(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name'),''),to_jsonb(p)->>'full_name',to_jsonb(p)->>'display_name') FROM public.user_profiles p WHERE p.user_id::text=x.actor_id LIMIT 1)) ORDER BY created_at DESC,id DESC) FROM page x),'[]'::jsonb),
 'modules',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT module,count(*) count FROM filtered WHERE action='MODULE_VISIT' GROUP BY module ORDER BY count(*) DESC LIMIT 20)x),'[]'::jsonb),
 'downloads',(SELECT count(*) FROM filtered WHERE action='DOWNLOAD_REQUEST'),'operations',(SELECT count(*) FROM filtered)) INTO outcome;
 RETURN outcome||jsonb_build_object('ipAllowed',ip_ok,'windowDays',180,'page',pg,'size',sz,'activeUsers',(SELECT count(DISTINCT actor_id) FROM public.energy_audit_sessions s WHERE(p_global AND o IS NULL OR s.organization_id=o) AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id::text=s.actor_id AND u.deleted_at IS NULL AND(u.banned_until IS NULL OR u.banned_until<now())) AND (s.organization_id IS NULL AND EXISTS(SELECT 1 FROM public.platform_team_members m WHERE m.user_id::text=s.actor_id AND m.active) OR EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=s.organization_id AND m.user_id::text=s.actor_id AND m.status='active')) AND ended_at IS NULL AND last_seen>now()-interval '5 minutes' AND expires_at>now()),
 'sessionTotal',(SELECT count(*) FROM public.energy_audit_sessions s WHERE(p_global AND o IS NULL OR s.organization_id=o) AND last_seen>=f),'openAlertCount',(SELECT count(*) FROM public.energy_audit_alerts a WHERE(p_global AND o IS NULL OR a.organization_id=o) AND last_at BETWEEN f AND u AND state IN('OPEN','ANALYSIS')),'alertTotal',(SELECT count(*) FROM public.energy_audit_alerts a WHERE(p_global AND o IS NULL OR a.organization_id=o) AND last_at BETWEEN f AND u),'decisions',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.energy_audit_alert_decisions d JOIN(SELECT id FROM public.energy_audit_alerts a WHERE(p_global AND o IS NULL OR a.organization_id=o) AND last_at BETWEEN f AND u ORDER BY last_at DESC,id DESC LIMIT sz OFFSET pg*sz)a ON a.id=d.alert_id),'[]'::jsonb),'sessions',coalesce((SELECT jsonb_agg(to_jsonb(x)-'session_id'-'scope_key') FROM(SELECT * FROM public.energy_audit_sessions s WHERE(p_global AND o IS NULL OR s.organization_id=o) AND last_seen>=f ORDER BY last_seen DESC,session_id DESC LIMIT sz OFFSET pg*sz)x),'[]'::jsonb),
 'alerts',coalesce((SELECT jsonb_agg(to_jsonb(x)-'subject') FROM(SELECT * FROM public.energy_audit_alerts a WHERE(p_global AND o IS NULL OR a.organization_id=o) AND last_at BETWEEN f AND u ORDER BY last_at DESC,id DESC LIMIT sz OFFSET pg*sz)x),'[]'::jsonb),
 'support',coalesce((SELECT jsonb_agg(jsonb_build_object('organization_id',c.organization_id,'cycle',public.central_support_summary(c.id),'expected_extra_minor',(SELECT coalesce(sum(m.extra_minor),0) FROM public.central_support_movements m WHERE m.cycle_id=c.id),'billing','PENDING_OR_SOURCE_SPECIFIC')) FROM public.central_support_cycles c WHERE(p_global AND o IS NULL OR c.organization_id=o) AND c.ends>=f::date AND c.starts<=u::date),'[]'::jsonb),
 'ai',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT organization_id,module,provider,state,count(*) calls,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,sum(actual_micro_usd) actual_micro_usd,sum(reserved_micro_usd) reserved_micro_usd FROM public.bot_energy_ai_usage a WHERE(p_global AND o IS NULL OR a.organization_id=o) AND created_at BETWEEN f AND u GROUP BY organization_id,module,provider,state)x),'[]'::jsonb),
 'api',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT organization_id,kind,state,count(*) jobs,sum(requests) requests FROM public.ccee_integration_jobs j WHERE(p_global AND o IS NULL OR j.organization_id=o) AND created_at BETWEEN f AND u GROUP BY organization_id,kind,state)x),'[]'::jsonb),
 'coverage',jsonb_build_object('http',(SELECT max(created_at) FROM public.energy_audit_events e WHERE(p_global AND o IS NULL OR e.organization_id=o)),'historical',(SELECT string_agg(substring(source from 12),', ' ORDER BY source) FROM public.energy_audit_health WHERE source LIKE 'projection:%'),'ip','Conexão do servidor ou origem histórica documentada. Headers encaminhados não confiados.','downloads','Solicitações autorizadas de link; transferência não comprovada.','ai','Ledger de IA por módulo/provedor; estados e valores conforme origem, sem prompts ou documentos.','api','Jobs CCEE com contagem de requests; outras APIs aparecem como requisições HTTP quando observadas, sem custo presumido.','deploy','SHA observado nas requisições; histórico completo do provedor não conectado.','retention','Janela técnica de 180 dias, sem exclusão automática.'));
END$$;
CREATE FUNCTION public.energy_audit_decide(p_org text,p_actor uuid,p_global boolean,p_id uuid,p_state text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.energy_audit_alerts;
BEGIN
 PERFORM public.energy_audit_authorize(p_org,p_actor,p_global,CASE WHEN p_global THEN 'dbb580ca-d940-4e80-97fb-e9f9619a0005' ELSE 'dbb580ca-d940-4e80-97fb-e9f9619a0003' END);
 PERFORM public.energy_audit_authorize(p_org,p_actor,p_global,CASE WHEN p_global THEN 'dbb580ca-d940-4e80-97fb-e9f9619a0004' ELSE 'dbb580ca-d940-4e80-97fb-e9f9619a0001' END);
 IF p_state NOT IN('ANALYSIS','RESOLVED','FALSE_POSITIVE') OR length(trim(p_reason)) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.energy_audit_alerts WHERE id=p_id AND(p_global OR organization_id=p_org) FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Alert unavailable' USING ERRCODE='42501';END IF;
 INSERT INTO public.energy_audit_alert_decisions(alert_id,actor_id,state,reason) VALUES(p_id,p_actor,p_state,public.energy_audit_text(p_reason));
 UPDATE public.energy_audit_alerts SET state=p_state,revision=revision+1 WHERE id=p_id;
 RETURN jsonb_build_object('id',p_id,'state',p_state);
END$$;
ALTER FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text) RENAME TO save_catalog_plan_before_organization_audit;
REVOKE ALL ON FUNCTION public.save_catalog_plan_before_organization_audit(uuid,integer,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_catalog_plan(target_id uuid,expected_version integer,definition jsonb,actor_id uuid,audit_ip text,audit_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; enabled boolean:=false;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 PERFORM pg_advisory_xact_lock(60405);
 IF definition ? 'organization_audit' AND jsonb_typeof(definition->'organization_audit') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid Audit flag' USING ERRCODE='22023';END IF;
 IF target_id IS NOT NULL THEN SELECT organization_audit INTO enabled FROM public.plan_catalog WHERE id=target_id FOR UPDATE;END IF;
 enabled:=CASE WHEN definition ? 'organization_audit' THEN (definition->>'organization_audit')::boolean ELSE coalesce(enabled,false) END;
 saved:=public.save_catalog_plan_before_organization_audit(target_id,expected_version,definition-'organization_audit',actor_id,audit_ip,audit_agent);
 UPDATE public.plan_catalog SET organization_audit=enabled WHERE id=(saved->>'id')::uuid RETURNING to_jsonb(plan_catalog.*) INTO saved;
 UPDATE public.platform_plan_audit SET changes=jsonb_set(changes,'{after}',saved) WHERE plan_id=(saved->>'id')::uuid AND (changes->'after'->>'version')::integer=(saved->>'version')::integer;
 RETURN saved;
END $$;

ALTER FUNCTION public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) RENAME TO save_plan_license_before_organization_audit;
REVOKE ALL ON FUNCTION public.save_plan_license_before_organization_audit(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_plan_license(target_organization text,target_license text,expected_revision integer,target_plan uuid,expected_version integer,starts date,ends date,renews date,next_status text,selected_modules jsonb,actor_id uuid,audit_ip text,audit_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved jsonb; enabled boolean:=false; available boolean; prior_actor text;
BEGIN
 PERFORM public.assert_license_platform_actor(actor_id);
 PERFORM pg_advisory_xact_lock(60405);
 PERFORM pg_advisory_xact_lock(hashtextextended(target_organization,315));
 IF selected_modules IS NOT NULL AND (jsonb_typeof(selected_modules) IS DISTINCT FROM 'object' OR selected_modules ? 'organization_audit' AND jsonb_typeof(selected_modules->'organization_audit') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'Invalid Audit selection' USING ERRCODE='22023';END IF;
 -- A legacy edit preserves an existing selection, but a new/legacy license never inherits the plan's flag.
 IF target_license IS NOT NULL THEN SELECT organization_audit INTO enabled FROM public.licenses WHERE id=target_license AND organization_id=target_organization FOR UPDATE;END IF;
 enabled:=CASE WHEN selected_modules ? 'organization_audit' THEN (selected_modules->>'organization_audit')::boolean ELSE coalesce(enabled,false) END;
 SELECT organization_audit INTO available FROM public.plan_catalog WHERE id=target_plan FOR SHARE;
 IF enabled AND available IS DISTINCT FROM true THEN RAISE EXCEPTION 'Audit unavailable in selected plan' USING ERRCODE='22023';END IF;
 saved:=public.save_plan_license_before_organization_audit(target_organization,target_license,expected_revision,target_plan,expected_version,starts,ends,renews,next_status,selected_modules-'organization_audit',actor_id,audit_ip,audit_agent);
 prior_actor:=current_setting('app.license_actor',true);
 PERFORM set_config('app.license_actor',actor_id::text,true);
 UPDATE public.licenses SET plan_snapshot=jsonb_set(coalesce(plan_snapshot,'{}'::jsonb),'{organization_audit}',to_jsonb(enabled)), organization_audit=enabled WHERE id=saved->>'id' AND organization_id=target_organization RETURNING to_jsonb(licenses.*) INTO saved;
 PERFORM set_config('app.license_actor',coalesce(prior_actor,''),true);
 UPDATE public.audit_logs SET changes=jsonb_set(changes,'{after}',saved)
 WHERE organization_id=target_organization AND user_id=actor_id AND resource_type='license' AND resource_id=saved->>'id'
 AND changes->'after'->>'governance_revision'=saved->>'governance_revision';
 RETURN saved;
END $$;


DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'energy_audit_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION public.energy_audit_capture(jsonb),public.energy_audit_read(text,uuid,boolean,jsonb),public.energy_audit_presence(text,uuid,text,timestamptz,text,boolean,boolean),public.energy_audit_decide(text,uuid,boolean,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_catalog_plan(uuid,integer,jsonb,uuid,text,text),public.save_plan_license(text,text,integer,uuid,integer,date,date,date,text,jsonb,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
