BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.ccee_calendar_sync(
 organization_id text PRIMARY KEY REFERENCES public.organizations(id),actor_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,year integer NOT NULL CHECK(year BETWEEN 2021 AND 2099),
 next_run_at timestamptz NOT NULL DEFAULT now(),last_attempt_at timestamptz,last_success_at timestamptz,last_error text,
 day date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,requests integer NOT NULL DEFAULT 0 CHECK(requests BETWEEN 0 AND 2),
 lease_id uuid,lease_until timestamptz,source_url text,source_hash text,version_id uuid REFERENCES public.ccee_calendar_versions(id),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(organization_id='org_default')
);
ALTER TABLE public.ccee_calendar_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_calendar_sync FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ccee_calendar_sync_owner(p_actor uuid,p_action text,p_enabled boolean DEFAULT NULL,p_year integer DEFAULT NULL,p_reason text DEFAULT NULL,p_request uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior public.ccee_integration_events;r public.ccee_calendar_sync;payload jsonb;BEGIN
 IF public.platform_workflow_actor(p_actor,'82e7fc71-479a-4dd6-8b22-4fba6eaa6841') IS DISTINCT FROM 'OWNER' OR p_action NOT IN('read','configure') THEN RAISE EXCEPTION 'Calendar Owner required' USING ERRCODE='42501';END IF;
 IF p_action='configure' THEN
  IF p_enabled IS NULL OR p_year NOT BETWEEN 2021 AND 2099 OR p_year IS NULL OR p_request IS NULL OR length(coalesce(p_reason,'')) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Invalid calendar policy' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ccee-calendar-policy',0));
  payload:=jsonb_build_object('enabled',p_enabled,'year',p_year,'reason',p_reason,'actor',p_actor);
  SELECT * INTO prior FROM public.ccee_integration_events WHERE request_id=p_request;
  IF FOUND THEN IF prior.event<>'CALENDAR_SYNC_POLICY' OR prior.details IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Changed policy request' USING ERRCODE='40001';END IF;
  ELSE
   INSERT INTO public.ccee_calendar_sync(organization_id,actor_id,enabled,year)VALUES('org_default',p_actor,p_enabled,p_year)
   ON CONFLICT(organization_id) DO UPDATE SET actor_id=excluded.actor_id,enabled=excluded.enabled,year=excluded.year,next_run_at=CASE WHEN public.ccee_calendar_sync.year<>excluded.year THEN now() ELSE public.ccee_calendar_sync.next_run_at END,updated_at=now();
   INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details)VALUES('org_default',p_actor::text,'CALENDAR_SYNC_POLICY',p_request,payload);
  END IF;
 END IF;
 SELECT * INTO r FROM public.ccee_calendar_sync WHERE organization_id='org_default';RETURN coalesce(to_jsonb(r)-'lease_id'-'lease_until','{}'::jsonb);
END$$;
CREATE OR REPLACE FUNCTION public.ccee_calendar_sync_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ccee_calendar_sync;BEGIN
 SELECT * INTO r FROM public.ccee_calendar_sync WHERE enabled AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now()) FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 BEGIN
  IF public.platform_workflow_actor(r.actor_id,'82e7fc71-479a-4dd6-8b22-4fba6eaa6841') IS DISTINCT FROM 'OWNER' THEN RAISE EXCEPTION 'Owner unavailable';END IF;
 EXCEPTION WHEN OTHERS THEN UPDATE public.ccee_calendar_sync SET enabled=false,last_error='Responsável Owner indisponível; reconfigure a coleta oficial.',updated_at=now() WHERE organization_id=r.organization_id;RETURN NULL;END;
 IF r.day=(now() AT TIME ZONE 'America/Sao_Paulo')::date AND r.requests>=2 THEN UPDATE public.ccee_calendar_sync SET next_run_at=((r.day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') WHERE organization_id=r.organization_id;RETURN NULL;END IF;
 UPDATE public.ccee_calendar_sync SET lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',last_attempt_at=now(),next_run_at=now()+interval '1 day',updated_at=now() WHERE organization_id=r.organization_id RETURNING * INTO r;
 RETURN to_jsonb(r);
END$$;
CREATE OR REPLACE FUNCTION public.ccee_calendar_sync_reserve(p_org text,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ccee_calendar_sync;today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;BEGIN
 SELECT * INTO r FROM public.ccee_calendar_sync WHERE organization_id=p_org AND lease_id=p_lease AND lease_until>now() AND enabled FOR UPDATE;
 IF NOT FOUND OR p_org<>'org_default' THEN RAISE EXCEPTION 'Calendar lease unavailable' USING ERRCODE='42501';END IF;
 IF public.platform_workflow_actor(r.actor_id,'82e7fc71-479a-4dd6-8b22-4fba6eaa6841') IS DISTINCT FROM 'OWNER' THEN RAISE EXCEPTION 'Owner unavailable' USING ERRCODE='42501';END IF;
 IF r.day=today AND r.requests>=2 THEN RAISE EXCEPTION 'Calendar public daily budget exhausted' USING ERRCODE='P0001';END IF;
 UPDATE public.ccee_calendar_sync SET requests=CASE WHEN day=today THEN requests+1 ELSE 1 END,day=today WHERE organization_id=p_org;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details)VALUES(p_org,r.actor_id::text,'CALENDAR_PUBLIC_REQUEST_RESERVED',jsonb_build_object('lease',p_lease));RETURN jsonb_build_object('reserved',true);
END$$;
CREATE OR REPLACE FUNCTION public.ccee_calendar_sync_lookup(p_org text,p_lease uuid,p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ccee_calendar_sync;v public.ccee_calendar_versions;BEGIN
 SELECT * INTO r FROM public.ccee_calendar_sync WHERE organization_id=p_org AND lease_id=p_lease AND lease_until>now() AND enabled;
 IF NOT FOUND OR p_org<>'org_default' OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Calendar lease unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO v FROM public.ccee_calendar_versions WHERE source_hash=p_hash AND year=r.year ORDER BY created_at DESC,id DESC LIMIT 1;RETURN CASE WHEN v.id IS NULL THEN NULL ELSE to_jsonb(v) END;
END$$;
CREATE OR REPLACE FUNCTION public.ccee_calendar_sync_finish(p_org text,p_lease uuid,p_source text,p_hash text,p_version uuid,p_error text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ccee_calendar_sync;BEGIN
 SELECT * INTO r FROM public.ccee_calendar_sync WHERE organization_id=p_org AND lease_id=p_lease FOR UPDATE;
 IF NOT FOUND OR p_org<>'org_default' OR p_error IS NOT NULL AND length(p_error)>500 THEN RAISE EXCEPTION 'Calendar completion changed' USING ERRCODE='42501';END IF;
 IF p_error IS NULL AND NOT EXISTS(SELECT 1 FROM public.ccee_calendar_versions WHERE id=p_version AND source_hash=p_hash AND source_url=p_source AND year=r.year) THEN RAISE EXCEPTION 'Calendar result not proven';END IF;
 UPDATE public.ccee_calendar_sync SET last_error=p_error,last_success_at=CASE WHEN p_error IS NULL THEN now() ELSE last_success_at END,source_url=coalesce(p_source,source_url),source_hash=coalesce(p_hash,source_hash),version_id=coalesce(p_version,version_id),lease_id=NULL,lease_until=NULL,updated_at=now() WHERE organization_id=p_org RETURNING * INTO r;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details)VALUES(p_org,r.actor_id::text,'CALENDAR_SYNC_FINISHED',jsonb_build_object('versionId',p_version,'hash',p_hash,'error',p_error,'nextRunAt',r.next_run_at));
 RETURN jsonb_build_object('organizationId',p_org,'completed',p_error IS NULL);
END$$;
CREATE OR REPLACE FUNCTION public.ccee_calendar_workspace(p_org text,p_actor text,p_year integer,p_version uuid DEFAULT NULL,p_page integer DEFAULT 0,p_month date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected public.ccee_calendar_versions;s public.ccee_calendar_sync;versions jsonb;items jsonb;total integer;BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'view');
 IF p_year NOT BETWEEN 2021 AND 2099 OR p_year IS NULL OR p_page NOT BETWEEN 0 AND 1000 OR p_page IS NULL OR p_month IS NOT NULL AND extract(year FROM p_month)<>p_year THEN RAISE EXCEPTION 'Invalid calendar filters' USING ERRCODE='22023';END IF;
 IF p_version IS NOT NULL THEN SELECT * INTO selected FROM public.ccee_calendar_versions WHERE id=p_version AND year=p_year AND state='APPROVED';IF NOT FOUND THEN RAISE EXCEPTION 'Calendar version unavailable' USING ERRCODE='42501';END IF;
 ELSE SELECT * INTO selected FROM public.ccee_calendar_versions WHERE year=p_year AND state='APPROVED' ORDER BY reviewed_at DESC,id DESC LIMIT 1;END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.reviewed_at DESC,x.id DESC),'[]') INTO versions FROM(SELECT id,year,source_url,created_at,reviewed_at FROM public.ccee_calendar_versions WHERE year=p_year AND state='APPROVED' ORDER BY reviewed_at DESC,id DESC LIMIT 100)x;
 SELECT count(*) INTO total FROM public.ccee_calendar_items WHERE version_id=selected.id AND(p_month IS NULL OR month=p_month OR date_trunc('month',due_date)::date=p_month);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY coalesce(x.due_date,(x.due_at AT TIME ZONE 'America/Sao_Paulo')::date),x.due_at,x.id),'[]') INTO items FROM(SELECT * FROM public.ccee_calendar_items WHERE version_id=selected.id AND(p_month IS NULL OR month=p_month OR date_trunc('month',due_date)::date=p_month) ORDER BY coalesce(due_date,(due_at AT TIME ZONE 'America/Sao_Paulo')::date),due_at,id LIMIT 25 OFFSET p_page*25)x;
 SELECT * INTO s FROM public.ccee_calendar_sync WHERE organization_id=p_org;
 RETURN jsonb_build_object('organizationId',p_org,'selectedVersion',selected.id,'source',CASE WHEN selected.id IS NULL THEN NULL ELSE jsonb_build_object('source_url',selected.source_url,'created_at',selected.created_at,'source_hash',selected.source_hash) END,'versions',versions,'items',items,'total',total,'page',p_page,'pendingReview',(SELECT count(*) FROM public.ccee_calendar_versions WHERE year=p_year AND state='DRAFT'),'sync',CASE WHEN s.organization_id IS NULL THEN jsonb_build_object('enabled',false) ELSE to_jsonb(s)-'actor_id'-'lease_id'-'lease_until' END);
END$$;
DO $$DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND(p.proname LIKE 'ccee_calendar_sync_%' OR p.proname='ccee_calendar_workspace') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);END LOOP;
END$$;
NOTIFY pgrst,'reload schema';COMMIT;
