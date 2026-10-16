BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_assisted_closing_versions(
 id uuid PRIMARY KEY,organization_id text NOT NULL REFERENCES public.organizations(id),customer_id text NOT NULL REFERENCES public.customers(id),
 consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),month text NOT NULL CHECK(month ~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$'),
 version integer NOT NULL CHECK(version>0),previous_id uuid REFERENCES public.eva_assisted_closing_versions(id),
 basis text NOT NULL CHECK(basis ~ '^[a-f0-9]{64}$'),payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 report jsonb NOT NULL CHECK(jsonb_typeof(report)='object' AND octet_length(report::text)<=2000000),
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object' AND octet_length(source_snapshot::text)<=16000000),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,customer_id,month,version),UNIQUE(organization_id,customer_id,month,basis));
CREATE TABLE public.eva_assisted_closing_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,closing_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0),state text NOT NULL CHECK(state IN('PREPARING','READY_FOR_REVIEW','INCOMPLETE','APPROVED','REJECTED','SUPERSEDED','UNKNOWN')),
 actor_id text NOT NULL,note text NOT NULL CHECK(length(note)<=2000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,closing_id) REFERENCES public.eva_assisted_closing_versions(organization_id,id),UNIQUE(closing_id,sequence));
CREATE INDEX eva_assisted_closing_scope ON public.eva_assisted_closing_versions(organization_id,customer_id,month,version DESC);
DO $$DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['eva_assisted_closing_versions','eva_assisted_closing_events'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',name);
 EXECUTE format('CREATE TRIGGER eva_closing_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.preserve_calculation_autofill()',name);
END LOOP;END$$;
CREATE FUNCTION public.capture_eva_assisted_closing_sources(p_org text,p_customer text,p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE base jsonb;libraries jsonb;prior jsonb;commercial jsonb;
BEGIN
 base:=public.capture_financial_sources(p_org,p_customer,p_month);
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') INTO libraries FROM public.tariff_library_versions t WHERE organization_id=p_org;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'unit',consumer_unit_id,'month',month,'version',version_number,'hash',financial_hash,'status',status,'validation',validation_status,'approvedAt',approved_at,'publishedAt',published_at) ORDER BY month,id),'[]') INTO prior FROM public.monthly_energy_settlements WHERE organization_id=p_org AND customer_id=p_customer AND month<(p_month||'-01')::date AND financial_format='financial-settlement-1.0' AND status IN('APPROVED','PUBLISHED') AND validation_status='VALIDATED';
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY consumer_unit_id),'[]') INTO commercial FROM(
  SELECT DISTINCT ON(consumer_unit_id) consumer_unit_id,id,source_hash,source_basis,plan->'manualOverrides' manual,plan->'manualAuthor' author,(SELECT state FROM public.calculation_preparation_run_events WHERE run_id=r.id ORDER BY sequence DESC LIMIT 1) state FROM public.calculation_preparation_runs r WHERE organization_id=p_org AND customer_id=p_customer AND month=p_month ORDER BY consumer_unit_id,created_at DESC,id DESC
 )s;
 base:=jsonb_build_object('financial',base,'libraries',libraries,'previous',prior,'commercial',commercial);
 IF octet_length(base::text)>16000000 THEN RAISE EXCEPTION 'Assisted capture too large' USING ERRCODE='22023';END IF;
 RETURN base;
END$$;
REVOKE ALL ON FUNCTION public.capture_eva_assisted_closing_sources(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.capture_eva_assisted_closing_sources(text,text,text) FROM service_role;
CREATE FUNCTION public.eva_assisted_closing_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_unit text,p_month text,p_id uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.consumer_units;member record;r public.eva_assisted_closing_versions;old public.eva_assisted_closing_versions;ev public.eva_assisted_closing_events;last_state text;desired text;pg integer;manager boolean:=false;writer boolean:=false;result jsonb;next_version integer;expected jsonb;f jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('capture','history','reserve','finish','decide') OR p_org IS NULL OR p_actor IS NULL OR p_role IS NULL OR p_platform IS NULL OR p_unit IS NULL OR p_month IS NULL OR p_month !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>18500000 THEN RAISE EXCEPTION 'Invalid closing request' USING ERRCODE='22023';END IF;
 PERFORM public.calculation_autofill_action(p_org,p_actor,p_role,p_platform,'access',p_unit,p_month,NULL,'{}');
 SELECT * INTO u FROM public.consumer_units WHERE id=p_unit AND organization_id=p_org;
 IF p_platform THEN manager:=true;writer:=true;
 ELSE
  SELECT rr.name,rr.permissions INTO member FROM public.organization_members m JOIN public.roles rr ON rr.id=m.role_id AND rr.organization_id=m.organization_id AND rr.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' FOR SHARE OF m,rr;
  manager:=member.name IN('admin_org','gestor') AND member.permissions ? 'fd8a932f-87c0-4f86-8389-9f30c50e95b7';
  writer:=member.permissions ? '92e1b670-ab10-483a-b825-c6e16799496d' AND (member.permissions ? 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce' OR member.name='operacional' AND member.permissions ? 'fd8a932f-87c0-4f86-8389-9f30c50e95b7');
 END IF;
 IF p_action IN('reserve','finish') AND NOT coalesce(writer,false) OR p_action='decide' AND NOT coalesce(manager,false) THEN RAISE EXCEPTION 'Closing permission denied' USING ERRCODE='42501';END IF;
 IF p_action='capture' THEN
  IF p_id IS NOT NULL OR p_body<>'{}' THEN RAISE EXCEPTION 'Invalid capture' USING ERRCODE='22023';END IF;
  RETURN public.capture_eva_assisted_closing_sources(p_org,u.customer_id,p_month);
 END IF;
 IF p_action='history' THEN
  IF p_id IS NOT NULL OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['page'] OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,3}$' THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;
  SELECT coalesce(jsonb_agg(v ORDER BY (v->>'version')::integer DESC),'[]') INTO result FROM(SELECT to_jsonb(t)-'source_snapshot'||jsonb_build_object('state',(SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=t.id ORDER BY sequence DESC LIMIT 1),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY sequence) FROM public.eva_assisted_closing_events e WHERE closing_id=t.id))v FROM public.eva_assisted_closing_versions t WHERE organization_id=p_org AND customer_id=u.customer_id AND month=p_month ORDER BY version DESC LIMIT 10 OFFSET pg*10)s;
  RETURN jsonb_build_object('rows',result,'total',(SELECT count(*) FROM public.eva_assisted_closing_versions WHERE organization_id=p_org AND customer_id=u.customer_id AND month=p_month),'canManage',manager,'canPrepare',writer);
 END IF;
 IF p_id IS NULL THEN RAISE EXCEPTION 'Closing id required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-closing:'||p_org||':'||u.customer_id||':'||p_month,0));
 IF p_action='reserve' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['basis','hash','report','sources'] OR p_body->>'basis' IS NULL OR p_body->>'basis' !~ '^[a-f0-9]{64}$' OR p_body->>'hash' IS NULL OR p_body->>'hash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_body->'report') IS DISTINCT FROM 'object' OR jsonb_typeof(p_body->'sources') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid closing candidate' USING ERRCODE='22023';END IF;
  IF p_body#>>'{report,formatVersion}' IS DISTINCT FROM 'eva-assisted-closing-1.0' OR p_body#>>'{report,organizationId}' IS DISTINCT FROM p_org OR p_body#>>'{report,customerId}' IS DISTINCT FROM u.customer_id OR p_body#>>'{report,month}' IS DISTINCT FROM p_month OR p_body#>'{report,publicationAllowed}' IS DISTINCT FROM 'false'::jsonb OR p_body#>'{report,automaticApproval}' IS DISTINCT FROM 'false'::jsonb OR p_body#>>'{report,completeness}' IS NULL OR p_body#>>'{report,completeness}' NOT IN('COMPLETE','ESTIMATED','INCOMPLETE') OR jsonb_typeof(p_body#>'{report,approvalEligible}') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid report scope' USING ERRCODE='22023';END IF;
  SELECT jsonb_agg(id ORDER BY id) INTO expected FROM public.consumer_units WHERE organization_id=p_org AND customer_id=u.customer_id;
  IF expected IS DISTINCT FROM p_body#>'{report,unitIds}' OR jsonb_typeof(p_body#>'{report,units}') IS DISTINCT FROM 'array' OR (SELECT jsonb_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(p_body#>'{report,units}')x) IS DISTINCT FROM expected OR jsonb_typeof(p_body#>'{report,missing}') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete unit set' USING ERRCODE='22023';END IF;
  IF (p_body#>>'{report,approvalEligible}')::boolean THEN
   IF p_body#>>'{report,completeness}' NOT IN('COMPLETE','ESTIMATED') OR p_body#>>'{report,financial,status}' IS DISTINCT FROM 'AVAILABLE' OR jsonb_array_length(p_body#>'{report,missing}')<>0 THEN RAISE EXCEPTION 'Unready closing' USING ERRCODE='22023';END IF;
   f:=p_body#>'{report,financial}';
   IF EXISTS(SELECT 1 FROM unnest(ARRAY['acr','aclBeforeFees','fixedFee','variableFee','totalFees','aclAfterFees','savings'])k WHERE jsonb_typeof(f->k) IS DISTINCT FROM 'string' OR f->>k !~ '^-?(0|[1-9][0-9]{0,11})\.[0-9]{2}$') THEN RAISE EXCEPTION 'Invalid financial figures' USING ERRCODE='22023';END IF;
   IF (f->>'totalFees')::numeric<>(f->>'fixedFee')::numeric+(f->>'variableFee')::numeric OR (f->>'aclAfterFees')::numeric<>(f->>'aclBeforeFees')::numeric+(f->>'totalFees')::numeric OR (f->>'savings')::numeric<>(f->>'acr')::numeric-(f->>'aclAfterFees')::numeric OR EXISTS(SELECT 1 FROM unnest(ARRAY['acr','fixedFee','variableFee','totalFees'])k WHERE (f->>k)::numeric<0) THEN RAISE EXCEPTION 'Inconsistent totals' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT 1 FROM unnest(ARRAY['acr','aclBeforeFees','fixedFee','variableFee','totalFees','aclAfterFees','savings'])k WHERE (SELECT sum((x->>k)::numeric) FROM jsonb_array_elements(p_body#>'{report,units}')x) IS DISTINCT FROM (f->>k)::numeric) THEN RAISE EXCEPTION 'Unit amounts do not reconcile' USING ERRCODE='22023';END IF;
  ELSIF p_body#>>'{report,completeness}' IS DISTINCT FROM 'INCOMPLETE' OR p_body#>>'{report,financial,status}' IS DISTINCT FROM 'INCOMPLETE' OR jsonb_array_length(p_body#>'{report,missing}')=0 THEN RAISE EXCEPTION 'Incomplete state mismatch' USING ERRCODE='22023';END IF;
  SELECT * INTO r FROM public.eva_assisted_closing_versions WHERE id=p_id;
  IF FOUND AND (r.organization_id<>p_org OR r.customer_id<>u.customer_id OR r.month<>p_month OR r.basis<>p_body->>'basis' OR r.created_by<>p_actor) THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505';END IF;
  SELECT * INTO r FROM public.eva_assisted_closing_versions WHERE organization_id=p_org AND customer_id=u.customer_id AND month=p_month AND basis=p_body->>'basis';
  IF FOUND THEN RETURN jsonb_build_object('acquired',false,'row',to_jsonb(r)-'source_snapshot'||jsonb_build_object('state',(SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=r.id ORDER BY sequence DESC LIMIT 1)));END IF;
  SELECT * INTO old FROM public.eva_assisted_closing_versions WHERE organization_id=p_org AND customer_id=u.customer_id AND month=p_month ORDER BY version DESC LIMIT 1;
  IF FOUND THEN
   SELECT e.state INTO last_state FROM public.eva_assisted_closing_events e WHERE closing_id=old.id ORDER BY sequence DESC LIMIT 1;
   IF last_state IN('PREPARING','UNKNOWN') THEN RETURN jsonb_build_object('acquired',false,'row',to_jsonb(old)-'source_snapshot'||jsonb_build_object('state',last_state));END IF;
  END IF;
  IF p_body->'sources' IS DISTINCT FROM public.capture_eva_assisted_closing_sources(p_org,u.customer_id,p_month) THEN RAISE EXCEPTION 'Sources changed' USING ERRCODE='40001';END IF;
  next_version:=coalesce(old.version,0)+1;
  INSERT INTO public.eva_assisted_closing_versions(id,organization_id,customer_id,consumer_unit_id,month,version,previous_id,basis,payload_hash,report,source_snapshot,created_by) VALUES(p_id,p_org,u.customer_id,p_unit,p_month,next_version,old.id,p_body->>'basis',p_body->>'hash',p_body->'report',p_body->'sources',p_actor) RETURNING * INTO r;
  IF old.id IS NOT NULL AND last_state IN('READY_FOR_REVIEW','INCOMPLETE') THEN INSERT INTO public.eva_assisted_closing_events(organization_id,closing_id,sequence,state,actor_id,note) SELECT p_org,old.id,coalesce(max(sequence),0)+1,'SUPERSEDED',p_actor,'Nova captura de fontes preservada em outra versão.' FROM public.eva_assisted_closing_events WHERE closing_id=old.id;END IF;
  INSERT INTO public.eva_assisted_closing_events(organization_id,closing_id,sequence,state,actor_id,note) VALUES(p_org,r.id,1,'PREPARING',p_actor,'Preparação automática EVA; sem decisão humana.');
  RETURN jsonb_build_object('acquired',true,'row',to_jsonb(r)-'source_snapshot'||jsonb_build_object('state','PREPARING'));
 END IF;
 SELECT * INTO r FROM public.eva_assisted_closing_versions WHERE id=p_id AND organization_id=p_org AND customer_id=u.customer_id AND month=p_month FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Closing unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO ev FROM public.eva_assisted_closing_events WHERE closing_id=r.id ORDER BY sequence DESC LIMIT 1;
 IF p_action='finish' THEN
  IF p_body<>'{}'::jsonb OR r.created_by<>p_actor THEN RAISE EXCEPTION 'Invalid finish' USING ERRCODE='42501';END IF;
  IF ev.state<>'PREPARING' THEN RETURN to_jsonb(r)-'source_snapshot'||jsonb_build_object('state',ev.state);END IF;
  desired:=CASE WHEN r.source_snapshot IS DISTINCT FROM public.capture_eva_assisted_closing_sources(p_org,r.customer_id,p_month) THEN 'INCOMPLETE' WHEN (r.report->>'approvalEligible')::boolean THEN 'READY_FOR_REVIEW' ELSE 'INCOMPLETE' END;
  INSERT INTO public.eva_assisted_closing_events(organization_id,closing_id,sequence,state,actor_id,note) VALUES(p_org,r.id,ev.sequence+1,desired,p_actor,CASE WHEN desired='READY_FOR_REVIEW' THEN 'Preenchido pela EVA; aguardando decisão do usuário autorizado.' ELSE 'Preparação incompleta ou fontes alteradas. Confira as evidências no resumo antes de decidir.' END);
 ELSE
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['acknowledge','decision','hash','note'] OR p_body->>'hash' IS DISTINCT FROM r.payload_hash OR p_body->>'decision' IS NULL OR p_body->>'decision' NOT IN('APPROVE','REJECT') OR p_body->'acknowledge' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(p_body->'note') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'note')) NOT BETWEEN 20 AND 2000 THEN RAISE EXCEPTION 'Invalid closing decision' USING ERRCODE='22023';END IF;
  desired:=CASE p_body->>'decision' WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END;
  IF ev.state=desired AND ev.actor_id=p_actor AND ev.note=p_body->>'note' THEN RETURN to_jsonb(r)-'source_snapshot'||jsonb_build_object('state',ev.state);END IF;
  IF ev.state IN('APPROVED','REJECTED','SUPERSEDED') OR (SELECT max(version) FROM public.eva_assisted_closing_versions WHERE organization_id=p_org AND customer_id=u.customer_id AND month=p_month)<>r.version THEN RAISE EXCEPTION 'Immutable or superseded decision' USING ERRCODE='23505';END IF;
  IF desired='APPROVED' THEN
   IF ev.state<>'READY_FOR_REVIEW' OR r.report->'approvalEligible' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Closing is not ready' USING ERRCODE='22023';END IF;
   IF r.source_snapshot IS DISTINCT FROM public.capture_eva_assisted_closing_sources(p_org,r.customer_id,p_month) THEN RAISE EXCEPTION 'Sources changed; prepare a new revision' USING ERRCODE='40001';END IF;
  ELSIF ev.state='PREPARING' AND r.created_at>clock_timestamp()-interval '90 seconds' THEN RAISE EXCEPTION 'Preparation still running' USING ERRCODE='40001';END IF;
  INSERT INTO public.eva_assisted_closing_events(organization_id,closing_id,sequence,state,actor_id,note) VALUES(p_org,r.id,ev.sequence+1,desired,p_actor,p_body->>'note');
 END IF;
 RETURN to_jsonb(r)-'source_snapshot'||jsonb_build_object('state',desired);
END$$;
REVOKE ALL ON FUNCTION public.eva_assisted_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_assisted_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb) TO service_role;
COMMIT;
