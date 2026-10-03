-- Additive operational module. Existing legacy notifications/financial data remain untouched.
-- Precondition: production catalog inspected; no existing operation_* tables; permission IDs already exist.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.operation_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 kind text NOT NULL CHECK(kind IN ('agenda','requests','events')), customer_id text REFERENCES public.customers(id), consumer_unit_id text REFERENCES public.consumer_units(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 160),description text NOT NULL CHECK(length(btrim(description)) BETWEEN 3 AND 10000),
 priority text NOT NULL CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),status text NOT NULL,
 responsible_id text NOT NULL,due_at timestamptz,starts_at timestamptz,ends_at timestamptz,effective_date date NOT NULL,
 document_id text REFERENCES public.documents(id),request_type text CHECK(request_type IN ('INVOICE','DOCUMENT','INFORMATION','VALIDATION','ACTIVITY')),table_text text CHECK(length(table_text)<=6000),
 revision integer NOT NULL CHECK(revision>0),created_by text NOT NULL,updated_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at IS NULL OR starts_at IS NOT NULL AND ends_at>starts_at),CHECK(consumer_unit_id IS NULL OR customer_id IS NOT NULL),
 CHECK((kind='events' AND status IN ('DRAFT','REVIEW','PUBLISHED','ARCHIVED')) OR (kind IN ('agenda','requests') AND status IN ('OPEN','IN_PROGRESS','WAITING','DONE','CANCELLED'))),
 CHECK(kind<>'agenda' OR starts_at IS NOT NULL),CHECK(kind<>'requests' OR customer_id IS NOT NULL AND due_at IS NOT NULL AND request_type IS NOT NULL)
);
CREATE INDEX operation_scope_date ON public.operation_records(organization_id,kind,effective_date,id);
CREATE TABLE public.operation_record_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,record_id uuid NOT NULL REFERENCES public.operation_records(id),revision integer NOT NULL,
 request_id uuid NOT NULL,request_payload jsonb NOT NULL,action text NOT NULL,actor_id text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),snapshot jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,request_id),UNIQUE(record_id,revision)
);
CREATE TABLE public.operation_notification_reads(organization_id text NOT NULL REFERENCES public.organizations(id),user_id text NOT NULL,notification_key text NOT NULL,read_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,user_id,notification_key));
CREATE TABLE public.operation_module_versions(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.operation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_record_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_module_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_records,public.operation_record_history,public.operation_notification_reads,public.operation_module_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_records,public.operation_record_history,public.operation_notification_reads,public.operation_module_versions TO service_role;
CREATE FUNCTION public.assert_operation_actor(p_org text,p_actor text,p_kind text,p_write boolean,p_publish boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE perm text;name text;permissions jsonb;
BEGIN
 IF p_kind NOT IN ('agenda','requests','events') OR nullif(p_actor,'') IS NULL OR nullif(p_org,'') IS NULL THEN RAISE EXCEPTION 'Invalid scope' USING ERRCODE='P2031';END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions s WHERE s.organization_id=p_org AND s.user_id::text=p_actor AND s.expires_at>now() AND s.revoked_at IS NULL) THEN RETURN;END IF;
 SELECT r.name,r.permissions INTO name,permissions FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.status='ACTIVE';
 perm:=CASE p_kind WHEN 'agenda' THEN CASE WHEN p_write THEN '6da45eb4-810c-4e40-9933-d9cda66a8841' ELSE 'cb949e2a-e01d-4cf0-8c69-6ca74fe4d627' END WHEN 'requests' THEN CASE WHEN p_write THEN 'd1f1b3be-a842-41e7-aeb1-45fefeb2f4c1' ELSE '1479c0b7-9608-4e95-bd83-7e6899255a78' END ELSE CASE WHEN p_write THEN 'd617b0f0-0fba-42f8-8707-811070346ef0' ELSE '489e6387-d5fc-4cb0-81f9-d7a76269dca5' END END;
 IF name IS NULL OR name NOT IN ('admin_org','gestor','operacional') OR NOT coalesce(permissions ? perm,false) OR (p_publish AND name NOT IN ('admin_org','gestor')) THEN RAISE EXCEPTION 'Unauthorized operation actor' USING ERRCODE='P2031';END IF;
END $$;
CREATE FUNCTION public.save_operation_record(p_org text,p_actor text,p_kind text,p_id uuid,p_request uuid,p_revision integer,p_reason text,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old public.operation_records%ROWTYPE;r public.operation_records%ROWTYPE;previous public.operation_record_history%ROWTYPE;payload jsonb;
BEGIN
 PERFORM public.assert_operation_actor(p_org,p_actor,p_kind,true);
 IF p_request IS NULL OR p_revision IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 OR jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'Invalid write' USING ERRCODE='P2031';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||p_request::text,0));payload:=jsonb_build_object('id',p_id,'actor',p_actor,'kind',p_kind,'revision',p_revision,'reason',p_reason,'data',p_data);
 SELECT * INTO previous FROM public.operation_record_history WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF previous.request_payload<>payload THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='P2032';END IF;RETURN previous.snapshot;END IF;
 IF p_id IS NOT NULL THEN SELECT * INTO old FROM public.operation_records WHERE id=p_id AND organization_id=p_org AND kind=p_kind FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Missing operation' USING ERRCODE='P2033';END IF;IF old.revision<>p_revision OR old.status IN ('PUBLISHED','ARCHIVED','DONE','CANCELLED') THEN RAISE EXCEPTION 'Immutable or changed version' USING ERRCODE='P2032';END IF;ELSIF p_revision<>0 THEN RAISE EXCEPTION 'Invalid initial revision' USING ERRCODE='P2031';END IF;
 IF nullif(p_data->>'customerId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers WHERE organization_id=p_org AND id=p_data->>'customerId' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid customer' USING ERRCODE='P2031';END IF;
 IF nullif(p_data->>'unitId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE organization_id=p_org AND id=p_data->>'unitId' AND customer_id=p_data->>'customerId') THEN RAISE EXCEPTION 'Invalid unit' USING ERRCODE='P2031';END IF;
 IF p_data->>'responsibleId' IS NULL OR (p_data->>'responsibleId'<>p_actor AND NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles rr ON rr.id=m.role_id AND rr.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_data->>'responsibleId' AND m.status='ACTIVE' AND rr.name IN ('admin_org','gestor','operacional'))) THEN RAISE EXCEPTION 'Invalid responsible user' USING ERRCODE='P2031';END IF;
 IF nullif(p_data->>'documentId','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.documents WHERE organization_id=p_org AND id=p_data->>'documentId' AND file_verified AND customer_id=p_data->>'customerId' AND (nullif(p_data->>'unitId','') IS NULL OR consumer_unit_id=p_data->>'unitId')) THEN RAISE EXCEPTION 'Invalid private document' USING ERRCODE='P2031';END IF;
 INSERT INTO public.operation_records(id,organization_id,kind,customer_id,consumer_unit_id,title,description,priority,status,responsible_id,due_at,starts_at,ends_at,effective_date,document_id,request_type,table_text,revision,created_by,updated_by,created_at)
 VALUES(coalesce(p_id,gen_random_uuid()),p_org,p_kind,nullif(p_data->>'customerId',''),nullif(p_data->>'unitId',''),btrim(p_data->>'title'),btrim(p_data->>'description'),p_data->>'priority',coalesce(old.status,CASE WHEN p_kind='events' THEN 'DRAFT' ELSE 'OPEN' END),p_data->>'responsibleId',nullif(p_data->>'dueAt','')::timestamptz,nullif(p_data->>'startsAt','')::timestamptz,nullif(p_data->>'endsAt','')::timestamptz,(coalesce(nullif(p_data->>'startsAt','')::timestamptz,nullif(p_data->>'dueAt','')::timestamptz,now()) AT TIME ZONE 'America/Sao_Paulo')::date,nullif(p_data->>'documentId',''),nullif(p_data->>'requestType',''),nullif(p_data->>'tableText',''),coalesce(old.revision,0)+1,coalesce(old.created_by,p_actor),p_actor,coalesce(old.created_at,now()))
 ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,consumer_unit_id=excluded.consumer_unit_id,title=excluded.title,description=excluded.description,priority=excluded.priority,responsible_id=excluded.responsible_id,due_at=excluded.due_at,starts_at=excluded.starts_at,ends_at=excluded.ends_at,effective_date=excluded.effective_date,document_id=excluded.document_id,request_type=excluded.request_type,table_text=excluded.table_text,revision=excluded.revision,updated_by=p_actor,updated_at=now() RETURNING * INTO r;
 INSERT INTO public.operation_record_history(organization_id,record_id,revision,request_id,request_payload,action,actor_id,reason,snapshot) VALUES(p_org,r.id,r.revision,p_request,payload,CASE WHEN p_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END,p_actor,p_reason,to_jsonb(r));RETURN to_jsonb(r);
END $$;
CREATE FUNCTION public.transition_operation_record(p_org text,p_actor text,p_kind text,p_id uuid,p_request uuid,p_revision integer,p_reason text,p_status text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.operation_records%ROWTYPE;previous public.operation_record_history%ROWTYPE;payload jsonb;valid boolean;
BEGIN
 PERFORM public.assert_operation_actor(p_org,p_actor,p_kind,true,p_status='PUBLISHED');
 IF p_request IS NULL OR p_revision IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='P2031';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||p_request::text,0));payload:=jsonb_build_object('id',p_id,'actor',p_actor,'kind',p_kind,'revision',p_revision,'reason',p_reason,'status',p_status);
 SELECT * INTO previous FROM public.operation_record_history WHERE organization_id=p_org AND request_id=p_request;IF FOUND THEN IF previous.request_payload<>payload THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='P2032';END IF;RETURN previous.snapshot;END IF;
 SELECT * INTO r FROM public.operation_records WHERE id=p_id AND organization_id=p_org AND kind=p_kind FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Missing operation' USING ERRCODE='P2033';END IF;IF r.revision<>p_revision THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='P2032';END IF;
 valid:=CASE WHEN p_kind='events' THEN (r.status='DRAFT' AND p_status='REVIEW') OR (r.status='REVIEW' AND p_status IN ('DRAFT','PUBLISHED')) OR (r.status='PUBLISHED' AND p_status='ARCHIVED') ELSE (r.status='OPEN' AND p_status IN ('IN_PROGRESS','WAITING','DONE','CANCELLED')) OR (r.status='IN_PROGRESS' AND p_status IN ('WAITING','DONE','CANCELLED')) OR (r.status='WAITING' AND p_status IN ('IN_PROGRESS','DONE','CANCELLED')) END;
 IF NOT coalesce(valid,false) THEN RAISE EXCEPTION 'Invalid state transition' USING ERRCODE='P2031';END IF;
 UPDATE public.operation_records SET status=p_status,revision=revision+1,updated_by=p_actor,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.operation_record_history(organization_id,record_id,revision,request_id,request_payload,action,actor_id,reason,snapshot) VALUES(p_org,r.id,r.revision,p_request,payload,p_status,p_actor,p_reason,to_jsonb(r));RETURN to_jsonb(r);
END $$;
CREATE FUNCTION public.read_operation_notification(p_org text,p_actor text,p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.operation_records%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.operation_records WHERE organization_id=p_org AND id::text||':'||revision::text=p_key AND status NOT IN ('DONE','CANCELLED','ARCHIVED');IF NOT FOUND THEN RAISE EXCEPTION 'Missing notification' USING ERRCODE='P2033';END IF;
 PERFORM public.assert_operation_actor(p_org,p_actor,r.kind,false);
 INSERT INTO public.operation_notification_reads(organization_id,user_id,notification_key) VALUES(p_org,p_actor,p_key) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION public.preserve_operation_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN RAISE EXCEPTION 'Immutable operation history' USING ERRCODE='P2032';END $$;
CREATE TRIGGER preserve_operation_history BEFORE UPDATE OR DELETE ON public.operation_record_history FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();
REVOKE ALL ON FUNCTION public.assert_operation_actor(text,text,text,boolean,boolean),public.save_operation_record(text,text,text,uuid,uuid,integer,text,jsonb),public.transition_operation_record(text,text,text,uuid,uuid,integer,text,text),public.read_operation_notification(text,text,text),public.preserve_operation_history() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_operation_record(text,text,text,uuid,uuid,integer,text,jsonb),public.transition_operation_record(text,text,text,uuid,uuid,integer,text,text),public.read_operation_notification(text,text,text) TO service_role;
INSERT INTO public.operation_module_versions(version) VALUES('20261003_f3_1_operations');
NOTIFY pgrst,'reload schema';
COMMIT;
