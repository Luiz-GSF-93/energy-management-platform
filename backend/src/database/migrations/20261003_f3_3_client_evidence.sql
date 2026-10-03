-- Additive exchange. No internal description or existing file becomes client-visible automatically.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.operation_records ADD COLUMN operation_number bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.operation_records ADD COLUMN requested_by_name text;
CREATE FUNCTION public.operation_requester_name() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 SELECT coalesce(nullif(m.display_name,''),nullif(u.name,''),NEW.created_by) INTO NEW.requested_by_name FROM (SELECT 1) seed LEFT JOIN public.organization_members m ON m.organization_id=NEW.organization_id AND m.user_id::text=NEW.created_by LEFT JOIN public.users u ON u.auth_user_id::text=NEW.created_by AND (u.organization_id=NEW.organization_id OR u.organization_id IS NULL);
 RETURN NEW;
END $$;
CREATE TRIGGER operation_requester_name BEFORE INSERT ON public.operation_records FOR EACH ROW EXECUTE FUNCTION public.operation_requester_name();
CREATE TABLE public.operation_client_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),record_id uuid NOT NULL REFERENCES public.operation_records(id),customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 direction text NOT NULL CHECK(direction IN ('OUTBOUND','INBOUND')),subject text NOT NULL CHECK(length(btrim(subject)) BETWEEN 3 AND 160),body text NOT NULL CHECK(length(btrim(body)) BETWEEN 3 AND 6000),document_ids text[] NOT NULL DEFAULT '{}',
 actor_id text NOT NULL,actor_name text NOT NULL,request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,request_id),CHECK(cardinality(document_ids)<=5)
);
CREATE INDEX operation_client_message_scope ON public.operation_client_messages(organization_id,customer_id,record_id,created_at,id);
CREATE FUNCTION public.preserve_shared_operation_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.operation_number IS DISTINCT FROM OLD.operation_number OR NEW.requested_by_name IS DISTINCT FROM OLD.requested_by_name OR (EXISTS(SELECT 1 FROM public.operation_client_messages WHERE record_id=OLD.id) AND (NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.consumer_unit_id IS DISTINCT FROM OLD.consumer_unit_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)) THEN RAISE EXCEPTION 'Shared binding and opening identity are immutable' USING ERRCODE='P2032';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_shared_operation_binding BEFORE UPDATE ON public.operation_records FOR EACH ROW EXECUTE FUNCTION public.preserve_shared_operation_binding();
CREATE TABLE public.operation_client_reads(message_id uuid NOT NULL REFERENCES public.operation_client_messages(id),organization_id text NOT NULL,actor_id text NOT NULL,opened_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(message_id,actor_id));
ALTER TABLE public.operation_client_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_client_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_client_messages,public.operation_client_reads FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_client_messages,public.operation_client_reads TO service_role;
CREATE FUNCTION public.assert_client_evidence_actor(p_org text,p_actor text,p_customer text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' JOIN public.customers c ON c.id=m.exclusive_customer_id AND c.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND m.affiliation_type='external' AND m.exclusive_customer_id=p_customer AND r.name='consulta' AND r.permissions ? '3ebadd32-6f30-459e-8ed3-0d2843d89946' AND c.status='ACTIVE' AND c.deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Client scope unavailable' USING ERRCODE='P2031';END IF;
END $$;
CREATE FUNCTION public.append_operation_client_message(p_org text,p_actor text,p_record uuid,p_request uuid,p_direction text,p_subject text,p_body text,p_documents text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.operation_records%ROWTYPE;old public.operation_client_messages%ROWTYPE;saved public.operation_client_messages%ROWTYPE;doc text;actor_name text;permissions jsonb;
BEGIN
 SELECT * INTO r FROM public.operation_records WHERE organization_id=p_org AND id=p_record FOR UPDATE;
 IF NOT FOUND OR r.customer_id IS NULL OR r.consumer_unit_id IS NULL THEN RAISE EXCEPTION 'Record requires client and unit' USING ERRCODE='P2033';END IF;
 IF p_direction='OUTBOUND' THEN
  PERFORM public.assert_operation_actor(p_org,p_actor,r.kind,true);
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN SELECT rr.permissions INTO permissions FROM public.organization_members m JOIN public.roles rr ON rr.id=m.role_id AND rr.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';IF NOT coalesce(permissions ? '8f105b02-4443-49de-b188-847e0284e7ed',false) THEN RAISE EXCEPTION 'Documents required' USING ERRCODE='P2031';END IF;END IF;
 ELSIF p_direction='INBOUND' THEN
  PERFORM public.assert_client_evidence_actor(p_org,p_actor,r.customer_id);
  IF NOT EXISTS(SELECT 1 FROM public.operation_client_messages WHERE organization_id=p_org AND record_id=p_record AND direction='OUTBOUND' AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id) THEN RAISE EXCEPTION 'Not shared' USING ERRCODE='P2033';END IF;
 ELSE RAISE EXCEPTION 'Invalid direction' USING ERRCODE='P2031';END IF;
 IF p_request IS NULL OR p_documents IS NULL OR cardinality(p_documents)>5 OR length(btrim(p_body)) NOT BETWEEN 3 AND 6000 OR length(btrim(p_subject)) NOT BETWEEN 3 AND 160 THEN RAISE EXCEPTION 'Invalid message' USING ERRCODE='P2031';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||p_request::text,0));
 SELECT * INTO old FROM public.operation_client_messages WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF old.record_id<>p_record OR old.actor_id<>p_actor OR old.direction<>p_direction OR old.subject<>btrim(p_subject) OR old.body<>btrim(p_body) OR old.document_ids<>p_documents THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='P2032';END IF;RETURN to_jsonb(old);END IF;
 IF r.status IN ('DONE','CANCELLED','ARCHIVED') THEN RAISE EXCEPTION 'Exchange closed' USING ERRCODE='P2032';END IF;
 FOREACH doc IN ARRAY p_documents LOOP
  IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=doc AND organization_id=p_org AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id AND file_verified AND (p_direction='OUTBOUND' OR uploaded_by_auth_user_id::text=p_actor AND document_type='OTHER')) THEN RAISE EXCEPTION 'Invalid private attachment' USING ERRCODE='P2031';END IF;
 END LOOP;
 SELECT coalesce(nullif(m.display_name,''),nullif(u.name,''),p_actor) INTO actor_name FROM (SELECT 1) seed LEFT JOIN public.organization_members m ON m.organization_id=p_org AND m.user_id::text=p_actor LEFT JOIN public.users u ON u.auth_user_id::text=p_actor AND (u.organization_id=p_org OR u.organization_id IS NULL);
 INSERT INTO public.operation_client_messages(organization_id,record_id,customer_id,consumer_unit_id,direction,subject,body,document_ids,actor_id,actor_name,request_id) VALUES(p_org,p_record,r.customer_id,r.consumer_unit_id,p_direction,btrim(p_subject),btrim(p_body),p_documents,p_actor,actor_name,p_request) RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;
CREATE FUNCTION public.open_operation_client_message(p_org text,p_actor text,p_message uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.operation_client_messages%ROWTYPE;
BEGIN
 SELECT * INTO m FROM public.operation_client_messages WHERE organization_id=p_org AND id=p_message AND direction='OUTBOUND';IF NOT FOUND THEN RAISE EXCEPTION 'Missing message' USING ERRCODE='P2033';END IF;
 PERFORM public.assert_client_evidence_actor(p_org,p_actor,m.customer_id);
 IF NOT EXISTS(SELECT 1 FROM public.operation_records WHERE id=m.record_id AND organization_id=p_org AND customer_id=m.customer_id AND consumer_unit_id=m.consumer_unit_id) THEN RAISE EXCEPTION 'Record binding changed' USING ERRCODE='P2032';END IF;
 INSERT INTO public.operation_client_reads(message_id,organization_id,actor_id) VALUES(m.id,p_org,p_actor) ON CONFLICT DO NOTHING;
END $$;
CREATE TRIGGER preserve_client_message BEFORE UPDATE OR DELETE ON public.operation_client_messages FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();
CREATE TRIGGER preserve_client_read BEFORE UPDATE OR DELETE ON public.operation_client_reads FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();
REVOKE ALL ON FUNCTION public.operation_requester_name(),public.preserve_shared_operation_binding(),public.assert_client_evidence_actor(text,text,text),public.append_operation_client_message(text,text,uuid,uuid,text,text,text,text[]),public.open_operation_client_message(text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.append_operation_client_message(text,text,uuid,uuid,text,text,text,text[]),public.open_operation_client_message(text,text,uuid) TO service_role;
-- Existing private bucket, same byte limit. Spreadsheets are attachments, never OCR inputs.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='energy-documents-private' AND NOT public) THEN RAISE EXCEPTION 'Private bucket precondition failed';END IF;END $$;
UPDATE storage.buckets SET allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] WHERE id='energy-documents-private' AND NOT public;
INSERT INTO public.operation_module_versions(version) VALUES('20261003_f3_3_client_evidence');
NOTIFY pgrst,'reload schema';
COMMIT;
