-- Preparation/review only. No remote write, receipt or closure can be asserted by a user.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
INSERT INTO public.permissions(id,code,name,module,resource,action) VALUES
 ('f5364101-4486-42c2-a90f-807937ac3001','ccee_registrations.view','Consultar registros CCEE','ccee','registrations','view'),
 ('f5364101-4486-42c2-a90f-807937ac3002','ccee_registrations.manage','Preparar registros CCEE','ccee','registrations','manage'),
 ('f5364101-4486-42c2-a90f-807937ac3003','ccee_registrations.approve','Revisar registros CCEE','ccee','registrations','approve');
CREATE TABLE public.ccee_registration_records (
 id uuid PRIMARY KEY, organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL, consumer_unit_id text NOT NULL, agenda_id uuid REFERENCES public.operation_records(id),
 month date NOT NULL CHECK(extract(day from month)=1), operation text NOT NULL CHECK(operation IN ('REGISTER_CONTRACT','VALIDATE_AMOUNTS')),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 160), notes text NOT NULL CHECK(length(btrim(notes)) BETWEEN 3 AND 6000),
 deadline timestamptz NOT NULL, evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 3 AND 500),
 status text NOT NULL CHECK(status IN ('DRAFT','REVIEW','APPROVED','CANCELLED')), revision integer NOT NULL CHECK(revision>0),
 created_by text NOT NULL, updated_by text NOT NULL, reviewed_by text, reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,customer_id) REFERENCES public.customers(organization_id,id),
 FOREIGN KEY(organization_id,customer_id,consumer_unit_id) REFERENCES public.consumer_units(organization_id,customer_id,id),
 CHECK(status<>'APPROVED' OR reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL)
);
CREATE INDEX ccee_registration_scope ON public.ccee_registration_records(organization_id,month,deadline);
CREATE TABLE public.ccee_registration_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, record_id uuid NOT NULL REFERENCES public.ccee_registration_records(id),
 revision integer NOT NULL, request_id uuid NOT NULL, actor_id text NOT NULL, request_payload jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500), snapshot jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_id), UNIQUE(record_id,revision)
);
ALTER TABLE public.ccee_registration_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ccee_registration_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_registration_records,public.ccee_registration_history FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ccee_registration_history_immutable BEFORE UPDATE OR DELETE ON public.ccee_registration_history FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE FUNCTION public.assert_ccee_registration_actor(p_org text,p_actor text,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n text; perms jsonb; permission text;
BEGIN
 IF p_action NOT IN ('view','manage','approve') OR nullif(p_org,'') IS NULL OR nullif(p_actor,'') IS NULL THEN RAISE EXCEPTION 'Invalid context' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND ccee_registrations AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE)) THEN RAISE EXCEPTION 'CCEE module not licensed' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN PERFORM public.assert_license_platform_actor(p_actor::uuid); RETURN; END IF;
 SELECT r.name,r.permissions INTO n,perms FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';
 permission:=CASE p_action WHEN 'view' THEN 'f5364101-4486-42c2-a90f-807937ac3001' WHEN 'manage' THEN 'f5364101-4486-42c2-a90f-807937ac3002' ELSE 'f5364101-4486-42c2-a90f-807937ac3003' END;
 IF n IS NULL OR n NOT IN ('admin_org','gestor','operacional') OR NOT COALESCE(perms ? permission,false) OR NOT COALESCE(perms ? 'f5364101-4486-42c2-a90f-807937ac3001',false) OR (p_action='approve' AND n NOT IN ('admin_org','gestor')) THEN RAISE EXCEPTION 'CCEE permission denied' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public.read_ccee_registrations(p_org text,p_actor text,p_id uuid DEFAULT NULL,p_history boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; n integer;
BEGIN
 PERFORM public.assert_ccee_registration_actor(p_org,p_actor,'view');
 IF p_history THEN
  IF p_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.ccee_registration_records WHERE id=p_id AND organization_id=p_org AND (agenda_id IS NULL OR public.acl_operation_allowed(p_org,p_actor,agenda_id,false))) THEN RAISE EXCEPTION 'Unavailable record' USING ERRCODE='42501'; END IF;
  SELECT count(*) INTO n FROM public.ccee_registration_history WHERE organization_id=p_org AND record_id=p_id;
  IF n>200 THEN RAISE EXCEPTION 'History exceeds bounded read' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY revision DESC),'[]'::jsonb) INTO result FROM public.ccee_registration_history h WHERE organization_id=p_org AND record_id=p_id;
 ELSE
  SELECT count(*) INTO n FROM public.ccee_registration_records WHERE organization_id=p_org AND (p_id IS NULL OR id=p_id) AND (agenda_id IS NULL OR public.acl_operation_allowed(p_org,p_actor,agenda_id,false));
  IF n>200 THEN RAISE EXCEPTION 'Reduce read scope' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY deadline),'[]'::jsonb) INTO result FROM public.ccee_registration_records r WHERE organization_id=p_org AND (p_id IS NULL OR id=p_id) AND (agenda_id IS NULL OR public.acl_operation_allowed(p_org,p_actor,agenda_id,false));
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.save_ccee_registration(p_org text,p_actor text,p_id uuid,p_request uuid,p_revision integer,p_status text,p_reason text,p_data jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.ccee_registration_records; previous public.ccee_registration_history; payload jsonb; a public.operation_records;
BEGIN
 PERFORM public.assert_ccee_registration_actor(p_org,p_actor,CASE WHEN p_status='APPROVED' THEN 'approve' ELSE 'manage' END);
 IF p_request IS NULL OR p_id IS NULL OR p_revision IS NULL OR p_revision<0 OR p_status NOT IN ('DRAFT','REVIEW','APPROVED','CANCELLED') OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid write' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||p_request::text,0));
 payload:=jsonb_build_object('actor',p_actor,'id',p_id,'revision',p_revision,'status',p_status,'reason',p_reason,'data',p_data);
 SELECT * INTO previous FROM public.ccee_registration_history WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF previous.request_payload<>payload THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='40001'; END IF; RETURN previous.snapshot; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,892));
 SELECT * INTO r FROM public.ccee_registration_records WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF r.organization_id<>p_org OR (r.agenda_id IS NOT NULL AND NOT public.acl_operation_allowed(p_org,p_actor,r.agenda_id,false)) THEN RAISE EXCEPTION 'Foreign record' USING ERRCODE='42501'; END IF;
  IF r.revision<>p_revision OR r.status IN ('APPROVED','CANCELLED') THEN RAISE EXCEPTION 'Immutable or changed revision' USING ERRCODE='40001'; END IF;
  IF p_data IS NULL THEN
   IF NOT ((r.status='DRAFT' AND p_status IN ('REVIEW','CANCELLED')) OR (r.status='REVIEW' AND p_status IN ('DRAFT','APPROVED','CANCELLED'))) THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
   IF p_status='APPROVED' AND (p_actor IN (r.created_by,r.updated_by) OR r.deadline<=now() OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=r.customer_id AND organization_id=p_org AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'Independent review/current deadline required' USING ERRCODE='42501'; END IF;
   IF p_status='APPROVED' AND r.agenda_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.operation_records WHERE id=r.agenda_id AND organization_id=p_org AND kind='agenda' AND status NOT IN ('DONE','CANCELLED') AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id AND COALESCE(due_at,ends_at,starts_at)=r.deadline) THEN RAISE EXCEPTION 'Agenda changed' USING ERRCODE='40001'; END IF;
   UPDATE public.ccee_registration_records SET status=p_status,revision=revision+1,updated_by=p_actor,updated_at=now(),reviewed_by=CASE WHEN p_status='APPROVED' THEN p_actor ELSE NULL END,reviewed_at=CASE WHEN p_status='APPROVED' THEN now() ELSE NULL END WHERE id=p_id RETURNING * INTO r;
  ELSIF r.status<>'DRAFT' OR p_status<>'DRAFT' THEN RAISE EXCEPTION 'Only draft editable' USING ERRCODE='40001'; END IF;
 ELSE
  IF p_revision<>0 OR p_data IS NULL OR p_status<>'DRAFT' THEN RAISE EXCEPTION 'Invalid initial draft' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_data IS NOT NULL THEN
  IF jsonb_typeof(p_data)<>'object' OR p_data-'customerId'-'unitId'-'agendaId'-'month'-'operation'-'title'-'notes'-'deadline'-'evidenceReference'<>'{}'::jsonb OR p_data->>'month' !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid fields' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_data->>'customerId' AND organization_id=p_org AND deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE id=p_data->>'unitId' AND organization_id=p_org AND customer_id=p_data->>'customerId') THEN RAISE EXCEPTION 'Foreign customer/unit' USING ERRCODE='42501';END IF;
  IF nullif(p_data->>'agendaId','') IS NOT NULL THEN
   PERFORM public.assert_operation_actor(p_org,p_actor,'agenda',false);
   SELECT * INTO a FROM public.operation_records WHERE id=(p_data->>'agendaId')::uuid AND organization_id=p_org AND kind='agenda' AND customer_id=p_data->>'customerId' AND consumer_unit_id=p_data->>'unitId' AND status NOT IN ('DONE','CANCELLED');
   IF NOT FOUND OR NOT public.acl_operation_allowed(p_org,p_actor,a.id,false) OR COALESCE(a.due_at,a.ends_at,a.starts_at) IS DISTINCT FROM (p_data->>'deadline')::timestamptz THEN RAISE EXCEPTION 'Agenda binding/deadline mismatch' USING ERRCODE='42501'; END IF;
  END IF;
  INSERT INTO public.ccee_registration_records(id,organization_id,customer_id,consumer_unit_id,agenda_id,month,operation,title,notes,deadline,evidence_reference,status,revision,created_by,updated_by)
  VALUES(p_id,p_org,p_data->>'customerId',p_data->>'unitId',nullif(p_data->>'agendaId','')::uuid,(p_data->>'month'||'-01')::date,p_data->>'operation',btrim(p_data->>'title'),btrim(p_data->>'notes'),(p_data->>'deadline')::timestamptz,btrim(p_data->>'evidenceReference'),'DRAFT',COALESCE(r.revision,0)+1,COALESCE(r.created_by,p_actor),p_actor)
  ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,consumer_unit_id=excluded.consumer_unit_id,agenda_id=excluded.agenda_id,month=excluded.month,operation=excluded.operation,title=excluded.title,notes=excluded.notes,deadline=excluded.deadline,evidence_reference=excluded.evidence_reference,revision=excluded.revision,updated_by=p_actor,updated_at=now() RETURNING * INTO r;
 END IF;
 INSERT INTO public.ccee_registration_history(organization_id,record_id,revision,request_id,actor_id,request_payload,reason,snapshot) VALUES(p_org,r.id,r.revision,p_request,p_actor,payload,p_reason,to_jsonb(r));
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.assert_ccee_registration_actor(text,text,text),public.read_ccee_registrations(text,text,uuid,boolean),public.save_ccee_registration(text,text,uuid,uuid,integer,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_ccee_registrations(text,text,uuid,boolean),public.save_ccee_registration(text,text,uuid,uuid,integer,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
