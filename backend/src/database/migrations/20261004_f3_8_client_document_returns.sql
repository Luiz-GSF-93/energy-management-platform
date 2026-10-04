-- Returned contracts remain private, reviewed versions; no OCR or financial approval.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.append_operation_client_message(p_org text,p_actor text,p_record uuid,p_request uuid,p_direction text,p_subject text,p_body text,p_documents text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
  IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=doc AND organization_id=p_org AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id AND file_verified AND (p_direction='OUTBOUND' OR uploaded_by_auth_user_id::text=p_actor AND (document_type='OTHER' OR (document_type IN ('CONTRACT_ENERGY','CONTRACT_MANAGEMENT','COMPLIANCE_REPORT') AND EXISTS(SELECT 1 FROM public.documents parent JOIN public.operation_client_messages shared ON parent.id=ANY(shared.document_ids) WHERE parent.id=documents.catalog_previous_id AND parent.organization_id=p_org AND parent.customer_id=r.customer_id AND parent.consumer_unit_id=r.consumer_unit_id AND parent.document_type=documents.document_type AND parent.reference_month=documents.reference_month AND parent.file_verified AND shared.organization_id=p_org AND shared.record_id=p_record AND shared.customer_id=r.customer_id AND shared.consumer_unit_id=r.consumer_unit_id))))) THEN RAISE EXCEPTION 'Invalid private attachment' USING ERRCODE='P2031';END IF;
 END LOOP;
 SELECT coalesce(nullif(m.display_name,''),nullif(u.name,''),p_actor) INTO actor_name FROM (SELECT 1) seed LEFT JOIN public.organization_members m ON m.organization_id=p_org AND m.user_id::text=p_actor LEFT JOIN public.users u ON u.auth_user_id::text=p_actor AND (u.organization_id=p_org OR u.organization_id IS NULL);
 INSERT INTO public.operation_client_messages(organization_id,record_id,customer_id,consumer_unit_id,direction,subject,body,document_ids,actor_id,actor_name,request_id) VALUES(p_org,p_record,r.customer_id,r.consumer_unit_id,p_direction,btrim(p_subject),btrim(p_body),p_documents,p_actor,actor_name,p_request) RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;
INSERT INTO public.document_catalog_versions(version) VALUES('f3_8_client_document_returns');
NOTIFY pgrst,'reload schema';
COMMIT;
