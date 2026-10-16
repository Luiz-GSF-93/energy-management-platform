BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.calculation_preparation_runs(
 id uuid PRIMARY KEY,organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 month text NOT NULL CHECK(month ~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$'),document_id text NOT NULL REFERENCES public.documents(id),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),source_basis text NOT NULL CHECK(source_basis ~ '^[a-f0-9]{64}$'),
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object' AND octet_length(plan::text)<=200000),actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(organization_id,consumer_unit_id,month,source_basis),UNIQUE(organization_id,id));
CREATE TABLE public.calculation_preparation_run_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES public.calculation_preparation_runs(id),
 organization_id text NOT NULL,sequence integer NOT NULL CHECK(sequence IN(1,2)),
 state text NOT NULL CHECK(state IN('RUNNING','PREPARED','PARTIAL','UNKNOWN')),actor_id text NOT NULL,
 receipts jsonb NOT NULL CHECK(jsonb_typeof(receipts)='array' AND octet_length(receipts::text)<=50000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(run_id,sequence),FOREIGN KEY(organization_id,run_id) REFERENCES public.calculation_preparation_runs(organization_id,id),CHECK((sequence=1 AND state='RUNNING' AND receipts='[]') OR (sequence=2 AND state<>'RUNNING')));
CREATE INDEX preparation_runs_scope ON public.calculation_preparation_runs(organization_id,consumer_unit_id,month,created_at DESC,id);
CREATE FUNCTION public.preserve_calculation_autofill() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Immutable preparation history' USING ERRCODE='23514';END$$;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['calculation_preparation_runs','calculation_preparation_run_events'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER preparation_history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.preserve_calculation_autofill()',t);
END LOOP;END$$;
REVOKE ALL ON FUNCTION public.preserve_calculation_autofill() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.calculation_autofill_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_unit text,p_month text,p_run uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.consumer_units;d public.documents;member record;r public.calculation_preparation_runs;ev public.calculation_preparation_run_events;pg integer;result jsonb;
BEGIN
 IF p_org IS NULL OR p_actor IS NULL OR p_role IS NULL OR p_platform IS NULL OR p_action IS NULL OR p_action NOT IN('access','history','reserve','finish') OR p_unit IS NULL OR p_month IS NULL OR p_month !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>220000 THEN RAISE EXCEPTION 'Invalid preparation scope' USING ERRCODE='22023';END IF;
 SELECT * INTO u FROM public.consumer_units WHERE id=p_unit AND organization_id=p_org FOR SHARE;
 IF NOT FOUND OR u.status<>'ACTIVE' OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=u.customer_id AND organization_id=p_org AND deleted_at IS NULL AND status='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management AND document_management) THEN RAISE EXCEPTION 'License unavailable' USING ERRCODE='42501';END IF;
 IF p_platform THEN
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Platform organization session required' USING ERRCODE='42501';END IF;
  PERFORM public.assert_license_platform_actor(p_actor::uuid);
 ELSE
  IF (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND user_id::text=p_actor AND upper(status)='ACTIVE')<>1 THEN RAISE EXCEPTION 'Membership unavailable' USING ERRCODE='42501';END IF;
  SELECT m.exclusive_customer_id,m.affiliation_type,rr.name,rr.permissions INTO member FROM public.organization_members m JOIN public.roles rr ON rr.id=m.role_id AND rr.organization_id=m.organization_id AND rr.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' FOR SHARE OF m,rr;
  IF NOT FOUND OR member.name NOT IN('operacional','gestor','admin_org') OR jsonb_typeof(member.permissions) IS DISTINCT FROM 'array' OR NOT(member.permissions ?& ARRAY['8f105b02-4443-49de-b188-847e0284e7ed','60f9690a-145b-4dba-b23f-9f945baca296']) OR (member.exclusive_customer_id IS NOT NULL AND member.exclusive_customer_id<>u.customer_id) OR (member.affiliation_type='external' AND member.exclusive_customer_id IS NULL) THEN RAISE EXCEPTION 'Preparation access denied' USING ERRCODE='42501';END IF;
  IF p_action NOT IN('access','history') AND (NOT(member.permissions ? '92e1b670-ab10-483a-b825-c6e16799496d') OR NOT(member.permissions ? 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce' OR member.name='operacional' AND member.permissions ? 'fd8a932f-87c0-4f86-8389-9f30c50e95b7')) THEN RAISE EXCEPTION 'Draft permission required' USING ERRCODE='42501';END IF;
 END IF;
 IF p_action='access' THEN
  IF p_run IS NOT NULL OR p_body<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid access check' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('allowed',true);
 END IF;
 IF p_action='history' THEN
  IF p_run IS NOT NULL OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['page'] OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR (p_body->>'page') !~ '^\d{1,3}$' THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;
  SELECT coalesce(jsonb_agg(v ORDER BY v->>'created_at' DESC,v->>'id'),'[]') INTO result FROM(SELECT to_jsonb(x)||jsonb_build_object('state',(SELECT state FROM public.calculation_preparation_run_events WHERE run_id=x.id ORDER BY sequence DESC LIMIT 1),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY sequence) FROM public.calculation_preparation_run_events e WHERE run_id=x.id))v FROM public.calculation_preparation_runs x WHERE organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month ORDER BY created_at DESC,id LIMIT 10 OFFSET pg*10)s;
  RETURN jsonb_build_object('rows',result,'total',(SELECT count(*) FROM public.calculation_preparation_runs WHERE organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month));
 END IF;
 IF p_run IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('calculation-autofill:'||p_org||':'||p_unit||':'||p_month,0));
 IF p_action='reserve' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['basis','documentId','plan','sourceHash'] OR jsonb_typeof(p_body->'basis') IS DISTINCT FROM 'string' OR jsonb_typeof(p_body->'sourceHash') IS DISTINCT FROM 'string' OR jsonb_typeof(p_body->'documentId') IS DISTINCT FROM 'string' OR p_body->>'basis' !~ '^[a-f0-9]{64}$' OR p_body->>'sourceHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_body->'plan') IS DISTINCT FROM 'object' OR jsonb_typeof(p_body->'plan'->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'plan'->'fields') NOT BETWEEN 1 AND 200 OR p_body->'plan'->'canPublish' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Invalid candidate' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_body->'plan'->'fields')f WHERE jsonb_typeof(f) IS DISTINCT FROM 'object' OR jsonb_typeof(f->'key') IS DISTINCT FROM 'string' OR length(f->>'key') NOT BETWEEN 1 AND 120 OR f->>'state' IS NULL OR f->>'state' NOT IN('FILLED','PENDING') OR f->>'state'='FILLED' AND (f->'value' IS NULL OR f->'value'='null' OR coalesce(length(btrim(f->>'source')),0)=0)) OR
   (SELECT count(*)<>count(DISTINCT f->>'key') FROM jsonb_array_elements(p_body->'plan'->'fields')f) OR
   jsonb_typeof(p_body->'plan'->'percent') IS DISTINCT FROM 'number' OR jsonb_typeof(p_body->'plan'->'total') IS DISTINCT FROM 'number' OR jsonb_typeof(p_body->'plan'->'filled') IS DISTINCT FROM 'number' OR jsonb_typeof(p_body->'plan'->'pending') IS DISTINCT FROM 'number' OR jsonb_typeof(p_body->'plan'->'readyForValidation') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid field coverage' USING ERRCODE='22023';END IF;
  IF (p_body->'plan'->>'total')::numeric<>jsonb_array_length(p_body->'plan'->'fields') OR (p_body->'plan'->>'filled')::numeric<>(SELECT count(*) FROM jsonb_array_elements(p_body->'plan'->'fields')f WHERE f->>'state'='FILLED') OR (p_body->'plan'->>'pending')::numeric<>(SELECT count(*) FROM jsonb_array_elements(p_body->'plan'->'fields')f WHERE f->>'state'='PENDING') OR (p_body->'plan'->>'percent')::numeric<0 OR (p_body->'plan'->>'percent')::numeric>floor(100*(p_body->'plan'->>'filled')::numeric/(p_body->'plan'->>'total')::numeric) OR (p_body->'plan'->>'readyForValidation')::boolean AND ((p_body->'plan'->>'pending')::numeric<>0 OR (p_body->'plan'->>'percent')::numeric<>100) THEN RAISE EXCEPTION 'Inconsistent percentage' USING ERRCODE='22023';END IF;
  SELECT * INTO d FROM public.documents WHERE id=p_body->>'documentId' AND organization_id=p_org AND customer_id=u.customer_id AND consumer_unit_id=u.id AND document_type='INVOICE_DISTRIBUTOR' AND to_char(reference_month,'YYYY-MM')=p_month AND file_verified AND file_hash=p_body->>'sourceHash' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document changed' USING ERRCODE='40001';END IF;
  IF (SELECT count(*) FROM public.documents WHERE organization_id=p_org AND customer_id=u.customer_id AND consumer_unit_id=u.id AND document_type='INVOICE_DISTRIBUTOR' AND to_char(reference_month,'YYYY-MM')=p_month)<>1 THEN RAISE EXCEPTION 'Ambiguous invoice' USING ERRCODE='40001';END IF;
  SELECT * INTO r FROM public.calculation_preparation_runs WHERE id=p_run;
  IF FOUND AND (r.organization_id<>p_org OR r.consumer_unit_id<>p_unit OR r.month<>p_month OR r.source_basis<>p_body->>'basis') THEN RAISE EXCEPTION 'Request scope changed' USING ERRCODE='23505';END IF;
  SELECT * INTO r FROM public.calculation_preparation_runs WHERE organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month AND source_basis=p_body->>'basis';
  IF FOUND THEN RETURN jsonb_build_object('acquired',false,'run',to_jsonb(r)||jsonb_build_object('state',(SELECT state FROM public.calculation_preparation_run_events WHERE run_id=r.id ORDER BY sequence DESC LIMIT 1)));END IF;
  INSERT INTO public.calculation_preparation_runs(id,organization_id,customer_id,consumer_unit_id,month,document_id,source_hash,source_basis,plan,actor_id) VALUES(p_run,p_org,u.customer_id,p_unit,p_month,d.id,d.file_hash,p_body->>'basis',p_body->'plan',p_actor) RETURNING * INTO r;
  INSERT INTO public.calculation_preparation_run_events(run_id,organization_id,sequence,state,actor_id,receipts) VALUES(r.id,p_org,1,'RUNNING',p_actor,'[]');
  RETURN jsonb_build_object('acquired',true,'run',to_jsonb(r)||jsonb_build_object('state','RUNNING'));
 END IF;
 SELECT * INTO r FROM public.calculation_preparation_runs WHERE id=p_run AND organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month AND actor_id=p_actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Preparation unavailable' USING ERRCODE='42501';END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['receipts','status'] OR p_body->>'status' NOT IN('PREPARED','PARTIAL','UNKNOWN') OR jsonb_typeof(p_body->'receipts') IS DISTINCT FROM 'array' OR octet_length((p_body->'receipts')::text)>50000 THEN RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='22023';END IF;
 SELECT * INTO ev FROM public.calculation_preparation_run_events WHERE run_id=r.id AND sequence=2;
 IF FOUND THEN
  IF ev.state<>p_body->>'status' OR ev.receipts<>p_body->'receipts' THEN RAISE EXCEPTION 'Immutable result' USING ERRCODE='23505';END IF;
 ELSE INSERT INTO public.calculation_preparation_run_events(run_id,organization_id,sequence,state,actor_id,receipts) VALUES(r.id,p_org,2,p_body->>'status',p_actor,p_body->'receipts');END IF;
 RETURN to_jsonb(r)||jsonb_build_object('state',p_body->>'status');
END$$;
REVOKE ALL ON FUNCTION public.calculation_autofill_action(text,text,text,boolean,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.calculation_autofill_action(text,text,text,boolean,text,text,text,uuid,jsonb) TO service_role;
COMMIT;
