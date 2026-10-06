-- Preserve ACL customer/role/license checks through generic Operations and Evidence routes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.acl_operation_allowed(p_org text,p_actor text,p_record uuid,p_write boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE admission uuid;role_id text;platform boolean;
BEGIN
 SELECT admission_id INTO admission FROM public.acl_admission_requests WHERE organization_id=p_org AND (request_record_id=p_record OR agenda_record_id=p_record);
 IF NOT FOUND THEN RETURN true;END IF;
 SELECT m.role_id::text INTO role_id FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.status='ACTIVE';
 platform:=EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL);
 IF platform THEN role_id:=coalesce(role_id,'platform');END IF;
 BEGIN
  PERFORM public.acl_request_access(p_org,p_actor,role_id,platform,admission,p_write);
 EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE 'P4102' OR SQLSTATE 'P2031' THEN RETURN false;
 END;
 RETURN true;
END $$;
CREATE FUNCTION public.acl_operation_visible(p_org text,p_actor text,p_records uuid[],p_write boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ids uuid[];
BEGIN
 IF p_records IS NULL OR cardinality(p_records)>201 THEN RAISE EXCEPTION 'Invalid bounded read' USING ERRCODE='22023';END IF;
 SELECT array_agg(r.id) INTO ids FROM public.operation_records r WHERE r.organization_id=p_org AND r.id=ANY(p_records) AND public.acl_operation_allowed(p_org,p_actor,r.id,p_write);
 RETURN to_jsonb(coalesce(ids,'{}'::uuid[]));
END $$;
-- Renamed implementations retain their audited/idempotent behavior but are no longer callable by the API role.
ALTER FUNCTION public.save_operation_record(text,text,text,uuid,uuid,integer,text,jsonb) RENAME TO save_operation_record_acl_internal;
ALTER FUNCTION public.transition_operation_record(text,text,text,uuid,uuid,integer,text,text) RENAME TO transition_operation_record_acl_internal;
ALTER FUNCTION public.append_operation_client_message(text,text,uuid,uuid,text,text,text,text[]) RENAME TO append_operation_client_message_acl_internal;
REVOKE ALL ON FUNCTION public.save_operation_record_acl_internal(text,text,text,uuid,uuid,integer,text,jsonb),public.transition_operation_record_acl_internal(text,text,text,uuid,uuid,integer,text,text),public.append_operation_client_message_acl_internal(text,text,uuid,uuid,text,text,text,text[]) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.save_operation_record(p_org text,p_actor text,p_kind text,p_id uuid,p_request uuid,p_revision integer,p_reason text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous uuid;
BEGIN
 SELECT record_id INTO previous FROM public.operation_record_history WHERE organization_id=p_org AND request_id=p_request;
 IF (p_id IS NOT NULL AND NOT public.acl_operation_allowed(p_org,p_actor,p_id,true)) OR (previous IS NOT NULL AND NOT public.acl_operation_allowed(p_org,p_actor,previous,true)) THEN RAISE EXCEPTION 'ACL request unavailable' USING ERRCODE='42501';END IF;
 RETURN public.save_operation_record_acl_internal(p_org,p_actor,p_kind,p_id,p_request,p_revision,p_reason,p_data);
END $$;
CREATE FUNCTION public.transition_operation_record(p_org text,p_actor text,p_kind text,p_id uuid,p_request uuid,p_revision integer,p_reason text,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous uuid;
BEGIN
 SELECT record_id INTO previous FROM public.operation_record_history WHERE organization_id=p_org AND request_id=p_request;
 IF NOT public.acl_operation_allowed(p_org,p_actor,p_id,true) OR (previous IS NOT NULL AND NOT public.acl_operation_allowed(p_org,p_actor,previous,true)) THEN RAISE EXCEPTION 'ACL request unavailable' USING ERRCODE='42501';END IF;
 RETURN public.transition_operation_record_acl_internal(p_org,p_actor,p_kind,p_id,p_request,p_revision,p_reason,p_status);
END $$;
CREATE FUNCTION public.append_operation_client_message(p_org text,p_actor text,p_record uuid,p_request uuid,p_direction text,p_subject text,p_body text,p_documents text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_direction='OUTBOUND' AND NOT public.acl_operation_allowed(p_org,p_actor,p_record,true) THEN RAISE EXCEPTION 'ACL request unavailable' USING ERRCODE='42501';END IF;
 RETURN public.append_operation_client_message_acl_internal(p_org,p_actor,p_record,p_request,p_direction,p_subject,p_body,p_documents);
END $$;
REVOKE ALL ON FUNCTION public.acl_operation_allowed(text,text,uuid,boolean),public.acl_operation_visible(text,text,uuid[],boolean),public.save_operation_record(text,text,text,uuid,uuid,integer,text,jsonb),public.transition_operation_record(text,text,text,uuid,uuid,integer,text,text),public.append_operation_client_message(text,text,uuid,uuid,text,text,text,text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_operation_visible(text,text,uuid[],boolean),public.save_operation_record(text,text,text,uuid,uuid,integer,text,jsonb),public.transition_operation_record(text,text,text,uuid,uuid,integer,text,text),public.append_operation_client_message(text,text,uuid,uuid,text,text,text,text[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
