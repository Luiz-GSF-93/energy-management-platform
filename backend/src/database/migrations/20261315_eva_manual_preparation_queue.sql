BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.eva_manual_preparations(
 id uuid PRIMARY KEY,organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 month text NOT NULL CHECK(month~'^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$'),scope_kind text NOT NULL CHECK(scope_kind IN('UNIT','CUSTOMER')),scope_key text NOT NULL,
 actor_id text NOT NULL,role_id text NOT NULL,execution_id uuid NOT NULL UNIQUE,generation integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','SUCCEEDED','FAILED','UNKNOWN')),
 write_started boolean NOT NULL DEFAULT false,lease_token uuid,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,
 closing_id uuid REFERENCES public.eva_assisted_closing_versions(id),error_code text,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((lease_token IS NULL)=(lease_until IS NULL)),UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS eva_manual_one_active_scope ON public.eva_manual_preparations(organization_id,customer_id,month,scope_kind,scope_key) WHERE state IN('QUEUED','RUNNING','UNKNOWN');
CREATE INDEX IF NOT EXISTS eva_manual_due ON public.eva_manual_preparations(created_at,id) WHERE state='QUEUED';
CREATE INDEX IF NOT EXISTS eva_manual_scope_history ON public.eva_manual_preparations(organization_id,customer_id,month,scope_kind,scope_key,created_at DESC);
CREATE TABLE IF NOT EXISTS public.eva_manual_preparation_requests(
 id uuid PRIMARY KEY,organization_id text NOT NULL,job_id uuid NOT NULL,actor_id text NOT NULL,role_id text NOT NULL,consumer_unit_id text NOT NULL,month text NOT NULL,scope_kind text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,job_id) REFERENCES public.eva_manual_preparations(organization_id,id)
);
CREATE TABLE IF NOT EXISTS public.eva_manual_preparation_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,job_id uuid NOT NULL,
 sequence integer NOT NULL,event text NOT NULL,state text NOT NULL,actor_id text NOT NULL,
 body jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,job_id) REFERENCES public.eva_manual_preparations(organization_id,id),UNIQUE(job_id,sequence)
);
ALTER TABLE public.eva_manual_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eva_manual_preparations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.eva_manual_preparation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eva_manual_preparation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.eva_manual_preparation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eva_manual_preparation_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.eva_manual_preparations,public.eva_manual_preparation_events,public.eva_manual_preparation_requests FROM PUBLIC,anon,authenticated,service_role;
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.eva_manual_preparation_events'::regclass AND tgname='preserve_eva_manual_preparation_events') THEN
 CREATE TRIGGER preserve_eva_manual_preparation_events BEFORE UPDATE OR DELETE ON public.eva_manual_preparation_events FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();
END IF;END$$;
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.eva_manual_preparation_requests'::regclass AND tgname='preserve_eva_manual_preparation_requests') THEN
 CREATE TRIGGER preserve_eva_manual_preparation_requests BEFORE UPDATE OR DELETE ON public.eva_manual_preparation_requests FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();
END IF;END$$;

-- Shared transaction lock + durable state coordinate the three draft producers.
-- The lock is held only while reserving the execution slot, never during calculations.
CREATE OR REPLACE FUNCTION public.eva_preparation_conflict(p_org text,p_customer text,p_month text,p_kind text,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.eva_manual_preparations j WHERE j.organization_id=p_org AND j.customer_id=p_customer AND j.month=p_month AND(j.state='UNKNOWN' OR j.state='RUNNING' AND j.write_started) AND(p_kind<>'MANUAL' OR j.id<>p_id))
 OR EXISTS(SELECT 1 FROM public.eva_automatic_intakes i WHERE i.organization_id=p_org AND i.customer_id=p_customer AND i.month=p_month AND i.state='PREPARING' AND i.lease_until>clock_timestamp() AND(p_kind<>'INTAKE' OR i.id<>p_id))
 OR EXISTS(SELECT 1 FROM public.eva_operational_runs r WHERE r.organization_id=p_org AND r.customer_id=p_customer AND r.month=p_month AND r.kind='CLOSING' AND r.state='RUNNING' AND r.write_started AND r.lease_until>clock_timestamp() AND(p_kind<>'FLOW' OR r.id<>p_id))
$$;
CREATE OR REPLACE FUNCTION public.eva_coordinated_intake_begin(p_name text,p_args jsonb,p_scoped boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;result jsonb;
BEGIN
 IF p_name IS NULL OR p_name NOT IN('transition_eva_automatic_intake','eva_intake_revision_transition') OR p_args->>'p_action' IS DISTINCT FROM 'begin_prepare' OR p_args-ARRAY['p_id','p_token','p_action','p_body','p_revision']<>'{}' OR p_scoped IS NULL THEN RAISE EXCEPTION 'Invalid coordinated intake step' USING ERRCODE='22023';END IF;
 SELECT * INTO i FROM public.eva_automatic_intakes WHERE id=(p_args->>'p_id')::uuid AND lease_token=(p_args->>'p_token')::uuid AND lease_until>clock_timestamp();
 IF i.id IS NULL OR i.customer_id IS NULL OR i.month IS NULL THEN RAISE EXCEPTION 'Intake lease unavailable' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-preparation:'||i.organization_id||':'||i.customer_id||':'||i.month,0));
 IF public.eva_preparation_conflict(i.organization_id,i.customer_id,i.month,'INTAKE',i.id) THEN RETURN jsonb_build_object('deferred',true);END IF;
 IF p_scoped THEN EXECUTE 'SELECT public.portal_intake_scoped_rpc($1,$2)' INTO result USING p_name,p_args;
 ELSIF p_name='transition_eva_automatic_intake' THEN result:=public.transition_eva_automatic_intake(i.id,i.lease_token,'begin_prepare',coalesce(p_args->'p_body','{}'));
 ELSE EXECUTE 'SELECT public.eva_intake_revision_transition($1,$2,$3,$4,$5)' INTO result USING i.id,i.lease_token,'begin_prepare',coalesce(p_args->'p_body','{}'),(p_args->>'p_revision')::bigint;
 END IF;
 RETURN result;
END$$;
CREATE OR REPLACE FUNCTION public.eva_coordinated_flow_begin(p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.eva_operational_runs;result jsonb;
BEGIN
 SELECT * INTO r FROM public.eva_operational_runs WHERE id=p_id AND lease_id=p_lease AND lease_until>clock_timestamp() AND state='RUNNING';
 IF r.id IS NULL THEN RAISE EXCEPTION 'Flow lease unavailable' USING ERRCODE='40001';END IF;
 IF r.kind='CLOSING' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-preparation:'||r.organization_id||':'||r.customer_id||':'||r.month,0));
  IF public.eva_preparation_conflict(r.organization_id,r.customer_id,r.month,'FLOW',r.id) THEN RETURN jsonb_build_object('deferred',true);END IF;
 END IF;
 RETURN public.eva_flow_worker('begin_write',p_id,p_lease,'{}');
END$$;

CREATE OR REPLACE FUNCTION public.eva_manual_preparation_actor(p_org text,p_actor text,p_role text,p_unit text,p_month text,p_scope text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE member record;permissions jsonb;
BEGIN
 IF p_scope IS NULL OR p_scope NOT IN('UNIT','CUSTOMER') THEN RAISE EXCEPTION 'Invalid preparation scope' USING ERRCODE='22023';END IF;
 -- The established access gate checks unit/customer, current license and membership.
 PERFORM public.calculation_autofill_action(p_org,p_actor,p_role,false,'access',p_unit,p_month,NULL,'{}');
 SELECT r.name,r.permissions,m.permission_limit INTO member FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL FOR SHARE OF m,r;
 IF NOT FOUND OR member.name NOT IN('admin_org','gestor','operacional') THEN RAISE EXCEPTION 'Internal preparation actor required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(x),'[]') INTO permissions FROM jsonb_array_elements(member.permissions)x WHERE member.permission_limit IS NULL OR member.permission_limit @> jsonb_build_array(x);
 IF NOT(permissions ?& ARRAY['8f105b02-4443-49de-b188-847e0284e7ed','60f9690a-145b-4dba-b23f-9f945baca296','92e1b670-ab10-483a-b825-c6e16799496d'])
 OR NOT(permissions?'beb6ec90-8ba8-40ce-a156-aeef6cc75cce' OR member.name='operacional' AND permissions?'fd8a932f-87c0-4f86-8389-9f30c50e95b7') THEN RAISE EXCEPTION 'Preparation permission unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('userId',p_actor,'roleId',p_role,'role',member.name,'permissions',permissions);
END$$;
CREATE OR REPLACE FUNCTION public.eva_manual_preparation_event(p_id uuid,p_event text,p_body jsonb DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.eva_manual_preparations;
BEGIN
 SELECT * INTO STRICT j FROM public.eva_manual_preparations WHERE id=p_id FOR UPDATE;
 INSERT INTO public.eva_manual_preparation_events(organization_id,job_id,sequence,event,state,actor_id,body)
 SELECT j.organization_id,j.id,coalesce(max(sequence),0)+1,p_event,j.state,j.actor_id,p_body||jsonb_build_object('financialApproval',false) FROM public.eva_manual_preparation_events WHERE job_id=j.id;
END$$;
CREATE OR REPLACE FUNCTION public.eva_manual_preparation_public(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',j.id,'state',CASE WHEN j.state='RUNNING' AND j.lease_until<clock_timestamp() THEN CASE WHEN j.write_started THEN 'UNKNOWN' ELSE 'QUEUED' END ELSE j.state END,
 'consumerUnitId',j.consumer_unit_id,'customerId',j.customer_id,'month',j.month,'scopeKind',j.scope_kind,'generation',j.generation,'closingId',j.closing_id,'errorCode',j.error_code,'createdAt',j.created_at,'updatedAt',j.updated_at,'heartbeatAt',CASE WHEN j.state='RUNNING' THEN j.lease_until-interval '5 minutes' ELSE NULL END)
 FROM public.eva_manual_preparations j WHERE j.id=p_id
$$;
CREATE OR REPLACE FUNCTION public.eva_manual_preparation_action(p_org text,p_actor text,p_role text,p_action text,p_unit text,p_month text,p_scope text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' AS $$
DECLARE actor jsonb;j public.eva_manual_preparations;request public.eva_manual_preparation_requests;customer text;selected_key text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('request','status','reconcile') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>4000 THEN RAISE EXCEPTION 'Invalid queue command' USING ERRCODE='22023';END IF;
 actor:=public.eva_manual_preparation_actor(p_org,p_actor,p_role,p_unit,p_month,p_scope);
 SELECT customer_id INTO STRICT customer FROM public.consumer_units WHERE organization_id=p_org AND id=p_unit;
 selected_key:=CASE WHEN p_scope='CUSTOMER' THEN customer ELSE p_unit END;
 IF p_action='status' THEN
  IF p_body<>'{}' THEN RAISE EXCEPTION 'Status has no mutation fields' USING ERRCODE='22023';END IF;
  SELECT * INTO j FROM public.eva_manual_preparations q WHERE q.organization_id=p_org AND q.customer_id=customer AND q.month=p_month AND q.scope_kind=p_scope AND q.scope_key=selected_key AND(p_id IS NULL OR q.id=p_id OR q.id=(SELECT a.job_id FROM public.eva_manual_preparation_requests a WHERE a.organization_id=p_org AND a.id=p_id))
  ORDER BY CASE WHEN q.state IN('QUEUED','RUNNING','UNKNOWN') THEN 0 ELSE 1 END,q.created_at DESC,q.id DESC LIMIT 1;
  IF p_id IS NOT NULL AND j.id IS NULL THEN RAISE EXCEPTION 'Preparation unavailable in scope' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('job',public.eva_manual_preparation_public(j.id));
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-manual-queue:'||p_org,0));
 IF p_action='request' THEN
  IF p_id IS NULL OR p_body<>'{}' THEN RAISE EXCEPTION 'Request protocol required' USING ERRCODE='22023';END IF;
  SELECT * INTO request FROM public.eva_manual_preparation_requests WHERE id=p_id;
  IF FOUND THEN
   IF request.organization_id<>p_org OR request.actor_id<>p_actor OR request.role_id<>p_role OR request.consumer_unit_id<>p_unit OR request.month<>p_month OR request.scope_kind<>p_scope THEN RAISE EXCEPTION 'Request protocol has another scope' USING ERRCODE='40001';END IF;
   RETURN jsonb_build_object('job',public.eva_manual_preparation_public(request.job_id),'replayed',true);
  END IF;
  SELECT * INTO j FROM public.eva_manual_preparations WHERE id=p_id FOR UPDATE;
  IF FOUND THEN
   IF j.organization_id<>p_org OR j.actor_id<>p_actor OR j.role_id<>p_role OR j.consumer_unit_id<>p_unit OR j.month<>p_month OR j.scope_kind<>p_scope THEN RAISE EXCEPTION 'Request protocol has another scope' USING ERRCODE='40001';END IF;
   INSERT INTO public.eva_manual_preparation_requests(id,organization_id,job_id,actor_id,role_id,consumer_unit_id,month,scope_kind) VALUES(p_id,p_org,j.id,p_actor,p_role,p_unit,p_month,p_scope);
   RETURN jsonb_build_object('job',public.eva_manual_preparation_public(j.id),'replayed',true);
  END IF;
  SELECT * INTO j FROM public.eva_manual_preparations q WHERE q.organization_id=p_org AND q.customer_id=customer AND q.month=p_month AND q.scope_kind=p_scope AND q.scope_key=selected_key AND q.state IN('QUEUED','RUNNING','UNKNOWN') FOR UPDATE;
  IF FOUND THEN
   INSERT INTO public.eva_manual_preparation_requests(id,organization_id,job_id,actor_id,role_id,consumer_unit_id,month,scope_kind) VALUES(p_id,p_org,j.id,p_actor,p_role,p_unit,p_month,p_scope);
   RETURN jsonb_build_object('job',public.eva_manual_preparation_public(j.id),'replayed',true);
  END IF;
  IF(SELECT count(*) FROM public.eva_manual_preparations WHERE organization_id=p_org AND state IN('QUEUED','RUNNING'))>=20 THEN RAISE EXCEPTION 'Organization preparation queue full' USING ERRCODE='P3410';END IF;
  INSERT INTO public.eva_manual_preparations(id,organization_id,customer_id,consumer_unit_id,month,scope_kind,scope_key,actor_id,role_id,execution_id)
  VALUES(p_id,p_org,customer,p_unit,p_month,p_scope,selected_key,p_actor,p_role,p_id);
  INSERT INTO public.eva_manual_preparation_requests(id,organization_id,job_id,actor_id,role_id,consumer_unit_id,month,scope_kind) VALUES(p_id,p_org,p_id,p_actor,p_role,p_unit,p_month,p_scope);
  PERFORM public.eva_manual_preparation_event(p_id,'REQUESTED');
  RETURN jsonb_build_object('job',public.eva_manual_preparation_public(p_id),'replayed',false);
 END IF;
 IF actor->>'role'<>'admin_org' OR p_id IS NULL OR p_body-ARRAY['reason','confirmed']<>'{}' OR p_body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(p_body->'reason') IS DISTINCT FROM 'string' OR length(coalesce(p_body->>'reason','')) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Audited administrator confirmation required' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM public.eva_manual_preparations q WHERE q.id=p_id AND q.organization_id=p_org AND q.customer_id=customer AND q.month=p_month AND q.scope_kind=p_scope AND q.scope_key=selected_key FOR UPDATE;
 IF NOT FOUND OR NOT(j.state='UNKNOWN' OR j.state='RUNNING' AND j.lease_until<clock_timestamp() AND j.write_started) THEN RAISE EXCEPTION 'Only uncertain preparation can be reconciled' USING ERRCODE='40001';END IF;
 -- Unknown financial acknowledgements need their own evidence reconciliation first.
 IF EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=p_org AND r.customer_id=customer AND r.month=p_month AND(p_scope='CUSTOMER' OR r.consumer_unit_id=p_unit) AND coalesce(public.calculation_preparation_effective_state(p_org,r.id),'RUNNING') NOT IN('PREPARED','PARTIAL'))
 OR EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.organization_id=p_org AND v.customer_id=customer AND v.month=p_month AND(p_scope='CUSTOMER' OR v.report->'unitIds'?p_unit) AND coalesce((SELECT e.state FROM public.eva_assisted_closing_events e WHERE e.closing_id=v.id ORDER BY sequence DESC LIMIT 1),'UNKNOWN') IN('PREPARING','UNKNOWN')) THEN RAISE EXCEPTION 'Financial effects require separate reconciliation' USING ERRCODE='40001';END IF;
 UPDATE public.eva_manual_preparations SET state='QUEUED',execution_id=gen_random_uuid(),generation=generation+1,actor_id=p_actor,role_id=p_role,write_started=false,lease_token=NULL,lease_until=NULL,error_code=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=j.id;
 PERFORM public.eva_manual_preparation_event(j.id,'RECONCILED',jsonb_build_object('reason',p_body->>'reason','previousGeneration',j.generation));
 RETURN jsonb_build_object('job',public.eva_manual_preparation_public(j.id));
END$$;

CREATE OR REPLACE FUNCTION public.eva_manual_preparation_worker(p_action text,p_id uuid DEFAULT NULL,p_token uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' AS $$
DECLARE j public.eva_manual_preparations;actor jsonb;v public.eva_assisted_closing_versions;closing_state text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('claim','context','begin','defer','heartbeat','finish') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>4000 THEN RAISE EXCEPTION 'Invalid private queue command' USING ERRCODE='22023';END IF;
 IF p_action='claim' THEN
  IF p_id IS NOT NULL OR p_token IS NOT NULL OR p_body<>'{}' THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-manual-queue-claim',0));
  FOR j IN SELECT * FROM public.eva_manual_preparations WHERE state='RUNNING' AND lease_until<clock_timestamp() FOR UPDATE SKIP LOCKED LOOP
   UPDATE public.eva_manual_preparations SET state=CASE WHEN write_started THEN 'UNKNOWN' WHEN attempts>=5 THEN 'FAILED' ELSE 'QUEUED' END,lease_token=NULL,lease_until=NULL,error_code=CASE WHEN write_started THEN 'WRITE_ACK_PENDING' ELSE 'WORKER_INTERRUPTED' END,updated_at=clock_timestamp() WHERE id=j.id;
   PERFORM public.eva_manual_preparation_event(j.id,'LEASE_EXPIRED');
  END LOOP;
  SELECT q.* INTO j FROM public.eva_manual_preparations q WHERE q.state='QUEUED' AND q.next_attempt_at<=clock_timestamp()
  AND NOT EXISTS(SELECT 1 FROM public.eva_manual_preparations other WHERE other.organization_id=q.organization_id AND other.customer_id=q.customer_id AND other.month=q.month AND other.state IN('RUNNING','UNKNOWN'))
  ORDER BY q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL;END IF;
  UPDATE public.eva_manual_preparations SET state='RUNNING',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1,write_started=false,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
  PERFORM public.eva_manual_preparation_event(j.id,'CLAIMED');RETURN jsonb_build_object('id',j.id,'token',j.lease_token);
 END IF;
 SELECT * INTO j FROM public.eva_manual_preparations WHERE id=p_id AND state='RUNNING' AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Preparation lease unavailable' USING ERRCODE='40001';END IF;
 IF p_action IN('context','begin') THEN
  IF p_body<>'{}' OR j.write_started THEN RAISE EXCEPTION 'Preparation already started' USING ERRCODE='40001';END IF;
  actor:=public.eva_manual_preparation_actor(j.organization_id,j.actor_id,j.role_id,j.consumer_unit_id,j.month,j.scope_kind);
  IF p_action='context' THEN RETURN jsonb_build_object('job',jsonb_build_object('id',j.id,'organizationId',j.organization_id,'customerId',j.customer_id,'consumerUnitId',j.consumer_unit_id,'month',j.month,'scopeKind',j.scope_kind,'executionId',j.execution_id),'delegate',actor);END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-preparation:'||j.organization_id||':'||j.customer_id||':'||j.month,0));
  IF public.eva_preparation_conflict(j.organization_id,j.customer_id,j.month,'MANUAL',j.id) THEN RETURN jsonb_build_object('deferred',true);END IF;
  UPDATE public.eva_manual_preparations SET write_started=true,updated_at=clock_timestamp() WHERE id=j.id;PERFORM public.eva_manual_preparation_event(j.id,'PREPARATION_STARTED');RETURN jsonb_build_object('accepted',true);
 ELSIF p_action='defer' THEN
  IF p_body<>'{}' OR j.write_started THEN RAISE EXCEPTION 'Cannot defer a started write' USING ERRCODE='40001';END IF;
  UPDATE public.eva_manual_preparations SET state='QUEUED',next_attempt_at=clock_timestamp()+interval '30 seconds',lease_token=NULL,lease_until=NULL,error_code='PREPARATION_SLOT_BUSY',updated_at=clock_timestamp() WHERE id=j.id;
  PERFORM public.eva_manual_preparation_event(j.id,'WAITING_FOR_PREPARATION_SLOT');RETURN public.eva_manual_preparation_public(j.id);
 ELSIF p_action='heartbeat' THEN
  IF p_body<>'{}' THEN RAISE EXCEPTION 'Invalid heartbeat' USING ERRCODE='22023';END IF;
  UPDATE public.eva_manual_preparations SET lease_until=clock_timestamp()+interval '5 minutes' WHERE id=j.id;RETURN jsonb_build_object('alive',true);
 END IF;
 IF p_body-ARRAY['state','closingId','code']<>'{}' OR p_body->>'state' IS NULL OR p_body->>'state' NOT IN('SUCCEEDED','FAILED','UNKNOWN') THEN RAISE EXCEPTION 'Invalid completion receipt' USING ERRCODE='22023';END IF;
 IF p_body->>'state'='SUCCEEDED' THEN
  SELECT * INTO v FROM public.eva_assisted_closing_versions WHERE id=(p_body->>'closingId')::uuid AND organization_id=j.organization_id AND customer_id=j.customer_id AND month=j.month AND report->'unitIds'?j.consumer_unit_id AND coalesce(report#>>'{scope,kind}','CUSTOMER')=j.scope_kind;
  SELECT e.state INTO closing_state FROM public.eva_assisted_closing_events e WHERE e.closing_id=v.id ORDER BY e.sequence DESC LIMIT 1;
  IF NOT j.write_started OR v.id IS NULL OR closing_state IS NULL OR closing_state NOT IN('READY_FOR_REVIEW','INCOMPLETE','APPROVED','REJECTED','SUPERSEDED') THEN RAISE EXCEPTION 'Closing result unconfirmed' USING ERRCODE='40001';END IF;
 ELSIF p_body->>'state'='FAILED' AND j.write_started THEN RAISE EXCEPTION 'Uncertain write is not a known failure' USING ERRCODE='40001';END IF;
 IF p_body ? 'code' AND coalesce(p_body->>'code','') !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN RAISE EXCEPTION 'Sanitized error code required' USING ERRCODE='22023';END IF;
 UPDATE public.eva_manual_preparations SET state=p_body->>'state',closing_id=v.id,error_code=p_body->>'code',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=j.id;
 PERFORM public.eva_manual_preparation_event(j.id,'FINISHED',jsonb_build_object('closingId',v.id,'code',p_body->>'code'));
 RETURN public.eva_manual_preparation_public(j.id);
END$$;
REVOKE ALL ON FUNCTION public.eva_manual_preparation_actor(text,text,text,text,text,text),public.eva_manual_preparation_event(uuid,text,jsonb),public.eva_manual_preparation_public(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.eva_preparation_conflict(text,text,text,text,uuid),public.eva_coordinated_intake_begin(text,jsonb,boolean),public.eva_coordinated_flow_begin(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_coordinated_intake_begin(text,jsonb,boolean),public.eva_coordinated_flow_begin(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.eva_manual_preparation_action(text,text,text,text,text,text,text,uuid,jsonb),public.eva_manual_preparation_worker(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_manual_preparation_action(text,text,text,text,text,text,text,uuid,jsonb),public.eva_manual_preparation_worker(text,uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
