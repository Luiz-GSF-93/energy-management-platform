BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- A customer registration is a lookup candidate, never a representation grant.
CREATE TABLE public.ccee_customer_discovery(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),customer_id text NOT NULL REFERENCES public.customers(id),
 tax_id text NOT NULL,input_hash text NOT NULL,state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','INVALID_CNPJ','NOT_FOUND','NOT_CURRENT','NOT_ADHERED','AMBIGUOUS','REPRESENTATION_PENDING','FAILED','SUPERSEDED')),
 reason text NOT NULL DEFAULT 'Cadastro aguardando consulta CCEE.',result jsonb NOT NULL DEFAULT '{}',requests integer NOT NULL DEFAULT 0 CHECK(requests>=0),
 lease_id uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 CHECK(length(tax_id)<=30),CHECK(octet_length(result::text)<=64000)
);
ALTER TABLE public.ccee_customer_discovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_customer_discovery FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ccee_customer_discovery_due ON public.ccee_customer_discovery(organization_id,created_at) WHERE state='QUEUED';
CREATE INDEX ccee_customer_discovery_history ON public.ccee_customer_discovery(organization_id,customer_id,created_at DESC);

CREATE FUNCTION public.ccee_customer_discovery_seed(p_org text,p_customer text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.customers;fingerprint text;tax text;j public.ccee_customer_discovery;
BEGIN
 IF p_org<>'org_default' THEN RETURN;END IF;
 SELECT * INTO c FROM public.customers WHERE organization_id=p_org AND id=p_customer FOR UPDATE;
 IF c.id IS NULL THEN RETURN;END IF;
 -- Include identity fields only: contact edits do not restart external lookup.
 tax:=regexp_replace(coalesce(c.document,''),'[^0-9A-Za-z]','','g');
 fingerprint:=md5(jsonb_build_array(tax,c.status,c.deleted_at,(SELECT coalesce(jsonb_agg(jsonb_build_array(u.id,u.consumer_unit_number,u.status) ORDER BY u.id),'[]') FROM public.consumer_units u WHERE u.organization_id=p_org AND u.customer_id=p_customer))::text);
 IF fingerprint IS NOT DISTINCT FROM (SELECT input_hash FROM public.ccee_customer_discovery WHERE organization_id=p_org AND customer_id=p_customer ORDER BY created_at DESC,id DESC LIMIT 1) THEN RETURN;END IF;
 UPDATE public.ccee_customer_discovery SET state='SUPERSEDED',reason='Cadastro alterado; nova revisão de identidade será conferida.',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE organization_id=p_org AND customer_id=p_customer AND state IN('QUEUED','RUNNING');
 INSERT INTO public.ccee_customer_discovery(organization_id,customer_id,tax_id,input_hash,state,reason)
 VALUES(p_org,p_customer,tax,fingerprint,CASE WHEN tax!~'^[0-9]{14}$' THEN 'INVALID_CNPJ' ELSE 'QUEUED' END,CASE WHEN tax!~'^[0-9]{14}$' THEN 'CNPJ numérico completo necessário para este serviço CCEE; confira o cadastro.' ELSE 'Cadastro aguardando consulta CCEE; o cadastro não autoriza serviços privados.' END)
 ON CONFLICT DO NOTHING RETURNING * INTO j;
 IF j.id IS NOT NULL THEN INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details)VALUES(p_org,'system:ccee-cadastro','CUSTOMER_DISCOVERY_QUEUED',jsonb_build_object('discoveryId',j.id,'customerId',p_customer,'inputHash',fingerprint));END IF;
END$$;
CREATE FUNCTION public.ccee_customer_discovery_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='customers' THEN PERFORM public.ccee_customer_discovery_seed(NEW.organization_id,NEW.id);
 ELSE PERFORM public.ccee_customer_discovery_seed(NEW.organization_id,NEW.customer_id);IF TG_OP='UPDATE' AND (OLD.customer_id,OLD.organization_id) IS DISTINCT FROM (NEW.customer_id,NEW.organization_id) THEN PERFORM public.ccee_customer_discovery_seed(OLD.organization_id,OLD.customer_id);END IF;END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER ccee_customer_registered AFTER INSERT OR UPDATE OF document,status,deleted_at ON public.customers FOR EACH ROW EXECUTE FUNCTION public.ccee_customer_discovery_trigger();
CREATE TRIGGER ccee_unit_registered AFTER INSERT OR UPDATE OF customer_id,consumer_unit_number,status ON public.consumer_units FOR EACH ROW EXECUTE FUNCTION public.ccee_customer_discovery_trigger();

CREATE FUNCTION public.ccee_customer_discovery_control(p_org text,p_actor text,p_enabled boolean,p_reason text,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old public.ccee_integration_events;v jsonb;
BEGIN
 PERFORM public.ccee_permanent_automation_actor(p_org,p_actor);
 IF p_org<>'org_default' OR p_enabled IS NULL OR p_request IS NULL OR length(coalesce(p_reason,'')) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Invalid customer policy' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-discovery-control:'||p_org,0));
 SELECT * INTO old FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=p_request;
 v:=jsonb_build_object('organizationId',p_org,'actorId',p_actor,'enabled',p_enabled,'reason',p_reason,'homologationLimit',30);
 IF FOUND THEN IF old.event<>'CUSTOMER_DISCOVERY_POLICY' OR old.details IS DISTINCT FROM v THEN RAISE EXCEPTION 'Changed request' USING ERRCODE='40001';END IF;RETURN old.details;END IF;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details)VALUES(p_org,p_actor,'CUSTOMER_DISCOVERY_POLICY',p_request,v);RETURN v;
END$$;
CREATE FUNCTION public.ccee_customer_discovery_read(p_org text,p_actor text,p_page integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy jsonb;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'view');IF p_page IS NULL OR p_page<0 OR p_page>1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 SELECT details INTO policy FROM public.ccee_integration_events WHERE organization_id=p_org AND event='CUSTOMER_DISCOVERY_POLICY' ORDER BY recorded_at DESC,id DESC LIMIT 1;
 RETURN jsonb_build_object('organizationId',p_org,'page',p_page,'policy',coalesce(policy,jsonb_build_object('enabled',false,'homologationLimit',30)),
 'requestsUsed',(SELECT count(*) FROM public.ccee_integration_events WHERE organization_id=p_org AND event='CUSTOMER_DISCOVERY_REQUEST_RESERVED'),
 'rows',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.customer_name,x.customer_id),'[]') FROM(
 SELECT j.id,j.customer_id,c.company_name customer_name,j.tax_id,j.state,j.reason,j.result,j.requests,j.created_at,j.updated_at,j.finished_at,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'installation',u.consumer_unit_number,'binding',
 (SELECT jsonb_build_object('id',a.id,'status',a.status,'revision',a.revision,'profile',a.profile_code,'point',a.measurement_point,'validFrom',a.valid_from,'validTo',a.valid_to) FROM public.ccee_unit_authorizations a WHERE a.organization_id=p_org AND a.customer_id=c.id AND a.consumer_unit_id=u.id ORDER BY a.revision DESC LIMIT 1)) ORDER BY u.name),'[]') FROM public.consumer_units u WHERE u.organization_id=p_org AND u.customer_id=c.id) units
 FROM public.customers c JOIN LATERAL(SELECT * FROM public.ccee_customer_discovery q WHERE q.organization_id=c.organization_id AND q.customer_id=c.id ORDER BY q.created_at DESC,q.id DESC LIMIT 1)j ON true
 WHERE c.organization_id=p_org AND c.deleted_at IS NULL ORDER BY c.company_name,c.id LIMIT 25 OFFSET p_page*25)x));
END$$;
CREATE FUNCTION public.ccee_customer_discovery_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy public.ccee_integration_events;j public.ccee_customer_discovery;abandoned integer;
BEGIN
 SELECT * INTO policy FROM public.ccee_integration_events WHERE organization_id='org_default' AND event='CUSTOMER_DISCOVERY_POLICY' ORDER BY recorded_at DESC,id DESC LIMIT 1;
 IF policy.id IS NULL OR policy.details->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN NULL;END IF;
 PERFORM public.ccee_permanent_automation_actor('org_default',policy.actor_id);
 IF (SELECT count(*) FROM public.ccee_integration_events WHERE organization_id='org_default' AND event='CUSTOMER_DISCOVERY_REQUEST_RESERVED')>=30 THEN RETURN NULL;END IF;
 -- An abandoned lease is uncertain, never silently repeated.
 UPDATE public.ccee_customer_discovery SET state='FAILED',reason='Execução interrompida sem confirmação. Confira os protocolos antes de reconciliar.',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE organization_id='org_default' AND state='RUNNING' AND lease_until<=now();
 GET DIAGNOSTICS abandoned=ROW_COUNT;
 IF abandoned>0 THEN INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details)VALUES('org_default','system:ccee-cadastro','CUSTOMER_DISCOVERY_POLICY',jsonb_build_object('enabled',false,'reason','Execução interrompida; confira os efeitos antes de retomar.','homologationLimit',30));RETURN NULL;END IF;
 SELECT q.* INTO j FROM public.ccee_customer_discovery q JOIN public.customers c ON c.id=q.customer_id AND c.organization_id=q.organization_id WHERE q.organization_id='org_default' AND q.state='QUEUED' AND c.deleted_at IS NULL AND c.status='ACTIVE' AND EXISTS(SELECT 1 FROM public.consumer_units u WHERE u.organization_id=q.organization_id AND u.customer_id=q.customer_id AND u.status='ACTIVE') ORDER BY q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1;
 IF j.id IS NULL THEN RETURN NULL;END IF;
 UPDATE public.ccee_customer_discovery SET state='RUNNING',reason='Consultando o CNPJ na CCEE; nenhuma autorização privada foi concedida.',lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j)||jsonb_build_object('as_of',to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD'));
END$$;
CREATE FUNCTION public.ccee_customer_discovery_assert(p_id uuid,p_lease uuid) RETURNS public.ccee_customer_discovery LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_customer_discovery;policy public.ccee_integration_events;
BEGIN
 SELECT * INTO j FROM public.ccee_customer_discovery WHERE id=p_id AND lease_id=p_lease AND lease_until>now() AND state='RUNNING' FOR UPDATE;
 IF j.id IS NULL OR j.organization_id<>'org_default' OR NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.organization_id=j.organization_id AND c.id=j.customer_id AND c.deleted_at IS NULL AND c.status='ACTIVE' AND regexp_replace(c.document,'[^0-9A-Za-z]','','g')=j.tax_id) THEN RAISE EXCEPTION 'Discovery source changed' USING ERRCODE='42501';END IF;
 SELECT * INTO policy FROM public.ccee_integration_events WHERE organization_id=j.organization_id AND event='CUSTOMER_DISCOVERY_POLICY' ORDER BY recorded_at DESC,id DESC LIMIT 1;
 IF policy.details->'enabled' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Discovery paused' USING ERRCODE='42501';END IF;
 PERFORM public.ccee_permanent_automation_actor(j.organization_id,policy.actor_id);RETURN j;
END$$;
CREATE FUNCTION public.ccee_customer_discovery_reserve(p_id uuid,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_customer_discovery;total bigint;private_total bigint;used bigint;day_start timestamptz;
BEGIN
 j:=public.ccee_customer_discovery_assert(p_id,p_lease);
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-communication-budget:'||j.organization_id,0));
 SELECT count(*) INTO used FROM public.ccee_integration_events WHERE organization_id=j.organization_id AND event='CUSTOMER_DISCOVERY_REQUEST_RESERVED';
 IF used>=30 OR j.requests>=10 THEN RAISE EXCEPTION 'CUSTOMER_BUDGET_EXHAUSTED' USING ERRCODE='P0001';END IF;
 day_start:=date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
 WITH counts AS(
 SELECT CASE WHEN i.kind='PLD' THEN 'PLD' WHEN i.kind LIKE 'DRI_%' THEN 'DRI' ELSE 'PRIVATE' END family,greatest(CASE WHEN i.finished_at>=day_start THEN i.requests ELSE 0 END,(SELECT count(*) FROM public.ccee_integration_events e WHERE e.job_id=i.id AND e.organization_id=j.organization_id AND e.event='COMMUNICATION_REQUEST_RESERVED' AND e.recorded_at>=day_start)) requests FROM public.ccee_integration_jobs i WHERE i.organization_id=j.organization_id AND(i.finished_at>=day_start OR EXISTS(SELECT 1 FROM public.ccee_integration_events e WHERE e.job_id=i.id AND e.event='COMMUNICATION_REQUEST_RESERVED' AND e.recorded_at>=day_start))
 UNION ALL SELECT CASE WHEN s.kind='PLD_HOURLY' THEN 'PLD' ELSE 'PRIVATE' END,count(*) FROM public.ccee_integration_events e JOIN public.ccee_sync_schedules s ON s.id::text=e.details->>'scheduleId' AND s.organization_id=e.organization_id WHERE e.organization_id=j.organization_id AND e.event='MARKET_REQUEST_RESERVED' AND e.recorded_at>=day_start GROUP BY 1
 UNION ALL SELECT 'PRIVATE',count(*) FROM public.ccee_integration_events e WHERE e.organization_id=j.organization_id AND e.event='CUSTOMER_DISCOVERY_REQUEST_RESERVED' AND e.recorded_at>=day_start)
 SELECT coalesce(sum(requests),0),coalesce(sum(requests) FILTER(WHERE family='PRIVATE'),0) INTO total,private_total FROM counts;
 IF total>=200 OR private_total>=100 THEN RAISE EXCEPTION 'CUSTOMER_DAILY_BUDGET_EXHAUSTED' USING ERRCODE='P0001';END IF;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details)VALUES(j.organization_id,'system:ccee-cadastro','CUSTOMER_DISCOVERY_REQUEST_RESERVED',jsonb_build_object('discoveryId',j.id,'leaseId',p_lease));
 UPDATE public.ccee_customer_discovery SET requests=requests+1,updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('reserved',true,'total',total+1,'homologationUsed',used+1);
END$$;
CREATE FUNCTION public.ccee_customer_discovery_finish(p_id uuid,p_lease uuid,p_result jsonb,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.ccee_customer_discovery;state_name text;reason_text text;
BEGIN
 j:=public.ccee_customer_discovery_assert(p_id,p_lease);
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>64000 THEN RAISE EXCEPTION 'Invalid discovery result' USING ERRCODE='22023';END IF;
 IF p_error IS NOT NULL THEN
  IF p_error!~'^[A-Z_]{3,80}$' THEN RAISE EXCEPTION 'Invalid error' USING ERRCODE='22023';END IF;
  state_name:='FAILED';reason_text:='Consulta não confirmada: '||p_error||'. Fontes existentes preservadas; confira diagnóstico antes de retomar.';
  -- Stop this discovery policy on unexpected functional failure; other existing services are untouched.
  INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details)VALUES(j.organization_id,'system:ccee-cadastro','CUSTOMER_DISCOVERY_POLICY',jsonb_build_object('enabled',false,'reason',reason_text,'homologationLimit',30));
 ELSE
  state_name:=p_result->>'state';reason_text:=p_result->>'reason';
  IF state_name IS NULL OR state_name NOT IN('NOT_FOUND','NOT_CURRENT','NOT_ADHERED','AMBIGUOUS','REPRESENTATION_PENDING') OR p_result->'complete' IS DISTINCT FROM 'true'::jsonb OR length(coalesce(reason_text,'')) NOT BETWEEN 10 AND 1000 OR jsonb_typeof(p_result->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete discovery' USING ERRCODE='22023';END IF;
 END IF;
 UPDATE public.ccee_customer_discovery SET state=state_name,reason=reason_text,result=p_result,lease_id=NULL,lease_until=NULL,finished_at=now(),updated_at=now() WHERE id=j.id;
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,details)VALUES(j.organization_id,'system:ccee-cadastro','CUSTOMER_DISCOVERY_FINISHED',jsonb_build_object('discoveryId',j.id,'customerId',j.customer_id,'state',state_name,'result',p_result));
 RETURN jsonb_build_object('organizationId',j.organization_id,'id',j.id,'state',state_name);
END$$;
-- Include discovery reservations in all existing communication budgets atomically.
DO $$DECLARE source text;marker text:='counts AS(SELECT * FROM private_counts UNION ALL SELECT * FROM market_counts)';BEGIN
 source:=pg_get_functiondef('public.ccee_communication_reserve(uuid,uuid,boolean)'::regprocedure);
 IF position(marker IN source)=0 THEN RAISE EXCEPTION 'Communication budget definition changed';END IF;
 source:=replace(source,marker,'counts AS(SELECT * FROM private_counts UNION ALL SELECT * FROM market_counts UNION ALL SELECT ''PRIVATE'',count(*) FROM public.ccee_integration_events WHERE organization_id=org AND event=''CUSTOMER_DISCOVERY_REQUEST_RESERVED'' AND recorded_at>=day_start)');EXECUTE source;
END$$;
REVOKE ALL ON FUNCTION public.ccee_customer_discovery_seed(text,text),public.ccee_customer_discovery_trigger(),public.ccee_customer_discovery_assert(uuid,uuid),public.ccee_customer_discovery_control(text,text,boolean,text,uuid),public.ccee_customer_discovery_read(text,text,integer),public.ccee_customer_discovery_claim(),public.ccee_customer_discovery_reserve(uuid,uuid),public.ccee_customer_discovery_finish(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ccee_customer_discovery_control(text,text,boolean,text,uuid),public.ccee_customer_discovery_read(text,text,integer),public.ccee_customer_discovery_claim(),public.ccee_customer_discovery_reserve(uuid,uuid),public.ccee_customer_discovery_finish(uuid,uuid,jsonb,text) TO service_role;
DO $$DECLARE c record;BEGIN FOR c IN SELECT organization_id,id FROM public.customers WHERE organization_id='org_default' AND deleted_at IS NULL LOOP PERFORM public.ccee_customer_discovery_seed(c.organization_id,c.id);END LOOP;END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
