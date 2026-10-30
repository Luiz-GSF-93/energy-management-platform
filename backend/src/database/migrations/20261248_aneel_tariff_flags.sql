BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.aneel_flag_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 month text NOT NULL CHECK(month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),version integer NOT NULL CHECK(version>0),
 previous_id uuid REFERENCES public.aneel_flag_versions(id),source_id uuid NOT NULL REFERENCES public.eva_official_sources(id),
 state text NOT NULL CHECK(state IN('VALIDATED','REVIEW_REQUIRED')),payload jsonb NOT NULL,reference_hash text NOT NULL CHECK(reference_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(organization_id,month,version));
CREATE TABLE public.aneel_flag_sync_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 kind text NOT NULL CHECK(kind IN('CONFIGURE','RUN','REQUEST','RESULT')),run_id uuid,token uuid,
 source_id uuid REFERENCES public.eva_official_sources(id),actor_id text,body jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX aneel_flag_events_scope ON public.aneel_flag_sync_events(organization_id,created_at DESC,id);
CREATE INDEX aneel_flag_month ON public.aneel_flag_versions(organization_id,month,version DESC);
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['aneel_flag_versions','aneel_flag_sync_events'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER aneel_flag_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_product_guide_immutable()',t);
END LOOP;END$$;
CREATE FUNCTION public.aneel_flag_source_active(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.eva_official_source_events e JOIN public.eva_official_source_revisions r ON r.id=e.revision_id WHERE e.source_id=p_id AND e.sequence=(SELECT max(x.sequence) FROM public.eva_official_source_events x WHERE x.source_id=p_id) AND e.state='REGISTERED' AND r.metadata->>'authority'='ANEEL' AND r.metadata->>'url'='https://www.gov.br/aneel/pt-br/assuntos/tarifas/bandeiras-tarifarias');$$;
CREATE FUNCTION public.aneel_flag_status(p_org text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cfg public.aneel_flag_sync_events;done public.aneel_flag_sync_events;run public.aneel_flag_sync_events;latest_month text;failures integer;next_at timestamptz;active boolean;
BEGIN
 SELECT * INTO cfg FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND kind='CONFIGURE' ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT * INTO done FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND kind='RESULT' AND created_at>=cfg.created_at ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT * INTO run FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND kind='RUN' ORDER BY created_at DESC,id DESC LIMIT 1;
 failures:=coalesce((done.body->>'failures')::integer,0);active:=coalesce((cfg.body->>'enabled')::boolean,false) AND public.aneel_flag_source_active(cfg.source_id) AND failures<3;
 next_at:=coalesce((done.body->>'nextUpdate')::timestamptz,cfg.created_at);
 SELECT max(month) INTO latest_month FROM public.aneel_flag_versions WHERE organization_id=p_org;
 RETURN jsonb_build_object('enabled',active,'state',CASE WHEN cfg.id IS NULL THEN 'DISABLED' WHEN failures>=3 THEN 'PAUSED' WHEN NOT active THEN 'DISABLED' WHEN run.id IS NOT NULL AND run.created_at>=cfg.created_at AND NOT EXISTS(SELECT 1 FROM public.aneel_flag_sync_events e WHERE e.organization_id=p_org AND e.kind='RESULT' AND e.run_id=run.id) THEN 'RUNNING' ELSE coalesce(done.body->>'state','SCHEDULED') END,'lastUpdate',(SELECT max(created_at) FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND kind='RESULT' AND body->>'state' IN('SUCCESS','REVIEW_REQUIRED')),'lastAttempt',run.created_at,'nextUpdate',CASE WHEN active THEN next_at ELSE NULL END,'latestMonth',latest_month,'pendingMonth',to_char((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date+interval '1 month','YYYY-MM'),'requestsToday',(SELECT count(*) FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND kind='REQUEST' AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date=(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date),'dailyLimit',4,'failures',failures,'note',coalesce(done.body->>'note','Aguardando a primeira atualização oficial.'),'rows',(SELECT coalesce(jsonb_agg(z ORDER BY z->>'month' DESC),'[]') FROM(SELECT DISTINCT ON(month) jsonb_build_object('month',month,'version',version,'state',state,'color',payload->'semantic'->>'color','rate',payload->'semantic'->>'rate','reason',payload->'semantic'->>'reason') z FROM public.aneel_flag_versions WHERE organization_id=p_org ORDER BY month DESC,version DESC LIMIT 36)s));
END$$;
CREATE FUNCTION public.aneel_flag_configure(p_org text,p_actor uuid,p_source uuid,p_enabled boolean,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.platform_team_owner(p_actor);
 IF p_org IS DISTINCT FROM 'org_default' OR p_enabled IS NULL OR length(btrim(p_reason)) NOT BETWEEN 20 AND 1000 OR NOT public.aneel_flag_source_active(p_source) THEN RAISE EXCEPTION 'Approved source and pilot organization required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('aneel-flags:'||p_org,0));
 INSERT INTO public.aneel_flag_sync_events(organization_id,kind,source_id,actor_id,body) VALUES(p_org,'CONFIGURE',p_source,p_actor::text,jsonb_build_object('enabled',p_enabled,'reason',p_reason,'cadenceHours',24,'dailyLimit',4));
 RETURN public.aneel_flag_status(p_org);
END$$;
CREATE FUNCTION public.aneel_flag_reference(p_org text,p_month text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cfg public.aneel_flag_sync_events;v public.aneel_flag_versions;
BEGIN
 IF p_month IS NULL OR p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';END IF;
 SELECT * INTO cfg FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND kind='CONFIGURE' ORDER BY created_at DESC,id DESC LIMIT 1;
 IF coalesce((cfg.body->>'enabled')::boolean,false)=false OR NOT public.aneel_flag_source_active(cfg.source_id) THEN RETURN NULL;END IF;
 SELECT * INTO v FROM public.aneel_flag_versions WHERE organization_id=p_org AND month=p_month AND source_id=cfg.source_id ORDER BY version DESC LIMIT 1;
 IF v.id IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('organizationId',p_org,'id',v.id,'month',v.month,'version',v.version,'state',v.state,'hash',v.reference_hash,'color',v.payload->'semantic'->>'color','rate',v.payload->'semantic'->>'rate','reason',v.payload->'semantic'->>'reason','urls',v.payload->'urls','sourceId',v.source_id);
END$$;
CREATE FUNCTION public.aneel_flag_worker(p_action text,p_org text,p_run uuid,p_token uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cfg public.aneel_flag_sync_events;last_done public.aneel_flag_sync_events;job public.aneel_flag_sync_events;v public.aneel_flag_versions;rec public.aneel_flag_versions;i public.eva_automatic_intakes;
 req integer;failed integer;docs jsonb;r jsonb;sem jsonb;payload jsonb;urls jsonb;changed integer:=0;reviews integer:=0;day_start timestamptz;job_id uuid;lease uuid;
BEGIN
 IF p_org IS DISTINCT FROM 'org_default' OR p_action IS NULL OR p_action NOT IN('claim','request','finish') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>6000000 THEN RAISE EXCEPTION 'Invalid sync scope' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('aneel-flags:'||p_org,0));
 SELECT * INTO cfg FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND kind='CONFIGURE' ORDER BY created_at DESC,id DESC LIMIT 1;
 IF coalesce((cfg.body->>'enabled')::boolean,false)=false OR NOT public.aneel_flag_source_active(cfg.source_id) OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management) THEN RETURN NULL;END IF;
 SELECT * INTO last_done FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND kind='RESULT' AND created_at>=cfg.created_at ORDER BY created_at DESC,id DESC LIMIT 1;
 failed:=coalesce((last_done.body->>'failures')::integer,0);
 day_start:=date_trunc('day',clock_timestamp() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
 SELECT count(*) INTO req FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND kind='REQUEST' AND created_at>=day_start;
 IF p_action='claim' THEN
  IF p_run IS NOT NULL OR p_token IS NOT NULL OR p_body<>'{}' THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='22023';END IF;
  IF failed>=3 OR req>2 OR coalesce((last_done.body->>'nextUpdate')::timestamptz,cfg.created_at)>clock_timestamp() THEN RETURN NULL;END IF;
  SELECT * INTO job FROM public.aneel_flag_sync_events e WHERE e.organization_id=p_org AND e.kind='RUN' AND NOT EXISTS(SELECT 1 FROM public.aneel_flag_sync_events x WHERE x.organization_id=p_org AND x.kind='RESULT' AND x.run_id=e.id) ORDER BY e.created_at DESC LIMIT 1;
  IF job.id IS NOT NULL THEN
   IF job.created_at>clock_timestamp()-interval '15 minutes' THEN RETURN NULL;END IF;
   INSERT INTO public.aneel_flag_sync_events(organization_id,kind,run_id,source_id,body) VALUES(p_org,'RESULT',job.id,cfg.source_id,jsonb_build_object('state','FAILED','failures',failed+1,'note','Execução interrompida; fonte anterior preservada.','nextUpdate',clock_timestamp()+interval '24 hours'));RETURN NULL;
  END IF;
  job_id:=gen_random_uuid();lease:=gen_random_uuid();INSERT INTO public.aneel_flag_sync_events(id,organization_id,kind,run_id,token,source_id,actor_id,body) VALUES(job_id,p_org,'RUN',job_id,lease,cfg.source_id,cfg.actor_id,jsonb_build_object('configuration',cfg.id));
  RETURN jsonb_build_object('organizationId',p_org,'runId',job_id,'token',lease,'today',to_char(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD'));
 END IF;
 SELECT * INTO job FROM public.aneel_flag_sync_events WHERE id=p_run AND organization_id=p_org AND kind='RUN' AND token=p_token AND source_id=cfg.source_id AND body->>'configuration'=cfg.id::text AND created_at>clock_timestamp()-interval '15 minutes';
 IF job.id IS NULL OR EXISTS(SELECT 1 FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND run_id=job.id AND kind='RESULT') THEN RAISE EXCEPTION 'Sync already closed or changed' USING ERRCODE='40001';END IF;
 IF p_action='request' THEN
  IF p_body<>'{}' OR req>=4 OR (SELECT count(*) FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND run_id=job.id AND kind='REQUEST')>=2 THEN RAISE EXCEPTION 'Daily request budget exhausted' USING ERRCODE='54000';END IF;
  INSERT INTO public.aneel_flag_sync_events(organization_id,kind,run_id,source_id,body) VALUES(p_org,'REQUEST',job.id,cfg.source_id,'{}');RETURN jsonb_build_object('reserved',true);
 END IF;
 IF p_body ? 'error' THEN
  INSERT INTO public.aneel_flag_sync_events(organization_id,kind,run_id,source_id,body) VALUES(p_org,'RESULT',job.id,cfg.source_id,jsonb_build_object('state','FAILED','failures',failed+1,'note','Falha na consulta oficial: '||left(p_body->>'error',80)||'. Referências anteriores preservadas.','nextUpdate',clock_timestamp()+interval '24 hours'));RETURN public.aneel_flag_status(p_org);
 END IF;
 docs:=p_body->'documents';
 urls:='["https://dadosabertos.aneel.gov.br/dataset/7f43a020-6dc5-44b8-80b4-d97eaa94436c/resource/0591b8f6-fe54-437b-b72b-1aa2efd46e42/download/bandeira-tarifaria-acionamento.csv","https://dadosabertos.aneel.gov.br/dataset/7f43a020-6dc5-44b8-80b4-d97eaa94436c/resource/5879ca80-b3bd-45b1-a135-d9b77c1d5b36/download/bandeira-tarifaria-adicional.csv"]'::jsonb;
 IF jsonb_typeof(docs) IS DISTINCT FROM 'array' OR jsonb_array_length(docs)<>2 OR jsonb_typeof(p_body->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'rows') NOT BETWEEN 1 AND 600 OR (SELECT count(*) FROM public.aneel_flag_sync_events WHERE organization_id=p_org AND run_id=job.id AND kind='REQUEST')<>2 THEN RAISE EXCEPTION 'Incomplete official sources' USING ERRCODE='22023';END IF;
 FOR req IN 0..1 LOOP
  IF docs->req->>'url' IS DISTINCT FROM urls->>req OR coalesce(docs->req->>'hash','!') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(docs->req->'raw') IS DISTINCT FROM 'string' OR length(docs->req->>'raw') NOT BETWEEN 20 AND 2700000 OR encode(sha256(decode(docs->req->>'raw','base64')),'hex') IS DISTINCT FROM docs->req->>'hash' THEN RAISE EXCEPTION 'Invalid official source hash' USING ERRCODE='22023';END IF;
 END LOOP;
 IF (SELECT count(DISTINCT(x->>'month')) FROM jsonb_array_elements(p_body->'rows') x)<>jsonb_array_length(p_body->'rows') THEN RAISE EXCEPTION 'Duplicate source month' USING ERRCODE='22023';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_body->'rows') LOOP
  IF r->>'month' IS NULL OR r->>'month' !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' OR r->>'month'<'2024-04' OR r->>'month'>to_char((clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date+interval '1 month','YYYY-MM') OR coalesce(r->>'state','!') NOT IN('VALIDATED','REVIEW_REQUIRED') OR coalesce(r->>'color','!') NOT IN('VERDE','AMARELA','VERMELHA 1','VERMELHA 2','ESCASSEZ HIDRICA') OR coalesce(r->>'rate','!') !~ '^\d{1,3}\.\d{6}$' OR (r->>'rate')::numeric>1 OR r->>'color'='VERDE' AND r->>'rate'<>'0.000000' OR coalesce(r->>'generationDate','!') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' OR (r->>'generationDate')::date>(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'Invalid monthly evidence' USING ERRCODE='22023';END IF;
  sem:=jsonb_build_object('month',r->>'month','color',r->>'color','rate',r->>'rate','reason',r->>'reason','tariffDate',r->>'tariffDate','resolution',r->>'resolution');
  SELECT * INTO v FROM public.aneel_flag_versions WHERE organization_id=p_org AND month=r->>'month' ORDER BY version DESC LIMIT 1;
  IF v.id IS NOT NULL AND v.source_id=cfg.source_id AND ((v.payload->'semantic'=sem AND v.state=r->>'state') OR v.state='REVIEW_REQUIRED' AND v.payload->'semantic'->>'color'=r->>'color' AND v.payload->'semantic'->>'rate'=r->>'rate') THEN CONTINUE;END IF;
  IF v.id IS NOT NULL AND r->>'state'='VALIDATED' AND (v.state='REVIEW_REQUIRED' OR (v.payload->'semantic'->>'color' IS DISTINCT FROM r->>'color' OR v.payload->'semantic'->>'rate' IS DISTINCT FROM r->>'rate')) THEN r:=jsonb_set(r,'{state}','"REVIEW_REQUIRED"');sem:=jsonb_set(sem,'{reason}','"Retificação da fonte oficial; requer conferência antes de substituir o valor."');END IF;
  payload:=jsonb_build_object('semantic',sem,'activation',r->'activation','additional',r->'additional','generationDate',r->>'generationDate','urls',urls,'documents',jsonb_build_array((docs->0)-'raw',(docs->1)-'raw'));
  INSERT INTO public.aneel_flag_versions(organization_id,month,version,previous_id,source_id,state,payload,reference_hash) VALUES(p_org,r->>'month',coalesce(v.version,0)+1,v.id,cfg.source_id,r->>'state',payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex')) RETURNING * INTO rec;
  changed:=changed+1;IF rec.state='REVIEW_REQUIRED' THEN reviews:=reviews+1;END IF;
  FOR i IN SELECT q.* FROM public.eva_automatic_intakes q WHERE q.organization_id=p_org AND q.month=rec.month AND q.state IN('AWAITING_SOURCES','PROPOSAL_READY') AND q.lease_token IS NULL AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions cv JOIN public.eva_assisted_closing_events ce ON ce.closing_id=cv.id WHERE cv.organization_id=q.organization_id AND cv.customer_id=q.customer_id AND cv.month=q.month AND ce.state='APPROVED') FOR UPDATE LOOP
   UPDATE public.eva_automatic_intakes SET next_attempt_at=clock_timestamp(),updated_at=clock_timestamp(),note='Referência mensal ANEEL atualizada; reconferindo a proposta com a leitura preservada.' WHERE id=i.id;
   PERFORM public.eva_intake_event(i.id,'OFFICIAL_FLAG_UPDATED',jsonb_build_object('referenceId',rec.id,'version',rec.version,'hash',rec.reference_hash,'repeatOcr',false,'repeatAi',false),cfg.actor_id);
  END LOOP;
 END LOOP;
 SELECT count(*) INTO reviews FROM (SELECT DISTINCT ON(month) state FROM public.aneel_flag_versions WHERE organization_id=p_org ORDER BY month,version DESC) current_refs WHERE state='REVIEW_REQUIRED';
 INSERT INTO public.aneel_flag_sync_events(organization_id,kind,run_id,source_id,body) VALUES(p_org,'RESULT',job.id,cfg.source_id,jsonb_build_object('state',CASE WHEN reviews>0 THEN 'REVIEW_REQUIRED' ELSE 'SUCCESS' END,'failures',0,'changed',changed,'reviews',reviews,'documents',docs,'note',CASE WHEN reviews>0 THEN 'Há referências divergentes para revisão.' ELSE 'Fontes oficiais consultadas. Somente competências divulgadas foram registradas.' END,'nextUpdate',clock_timestamp()+interval '24 hours'));
 RETURN public.aneel_flag_status(p_org);
END$$;
REVOKE ALL ON FUNCTION public.aneel_flag_source_active(uuid),public.aneel_flag_status(text),public.aneel_flag_configure(text,uuid,uuid,boolean,text),public.aneel_flag_reference(text,text),public.aneel_flag_worker(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aneel_flag_status(text),public.aneel_flag_configure(text,uuid,uuid,boolean,text),public.aneel_flag_reference(text,text),public.aneel_flag_worker(text,text,uuid,uuid,jsonb) TO service_role;
COMMIT;
