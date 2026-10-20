BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Existing evidence routes stay unchanged. The additional inbound path is limited
-- to client-origin requests or files explicitly received in this exact thread.
ALTER FUNCTION public.append_operation_client_message(text,text,uuid,uuid,text,text,text,text[]) RENAME TO append_operation_client_message_legacy;
CREATE FUNCTION public.append_operation_client_message(p_org text,p_actor text,p_record uuid,p_request uuid,p_direction text,p_subject text,p_body text,p_documents text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.operation_records; old public.operation_client_messages; saved public.operation_client_messages; doc text; role_id text;
BEGIN
 SELECT * INTO r FROM public.operation_records WHERE organization_id=p_org AND id=p_record FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501';END IF;
 IF p_direction<>'INBOUND' OR NOT(r.portal_origin='CLIENT' OR EXISTS(SELECT 1 FROM public.portal_document_intakes i WHERE i.organization_id=p_org AND i.record_id=r.id AND i.actor_id=p_actor)) THEN
  RETURN public.append_operation_client_message_legacy(p_org,p_actor,p_record,p_request,p_direction,p_subject,p_body,p_documents);
 END IF;
 SELECT m.role_id::text INTO role_id FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';
 PERFORM public.portal_workspace_actor(p_org,p_actor,role_id,false,'notifications');
 PERFORM public.assert_client_evidence_actor(p_org,p_actor,r.customer_id);
 IF r.status IN('DONE','CANCELLED','ARCHIVED') OR p_request IS NULL OR p_documents IS NULL OR cardinality(p_documents)>5 OR length(btrim(p_subject)) NOT BETWEEN 3 AND 160 OR length(btrim(p_body)) NOT BETWEEN 3 AND 6000 THEN RAISE EXCEPTION 'Invalid reply' USING ERRCODE='22023';END IF;
 FOREACH doc IN ARRAY p_documents LOOP
  IF NOT EXISTS(SELECT 1 FROM public.portal_document_intakes i JOIN public.documents d ON d.organization_id=p_org AND d.id=i.document_id AND d.file_hash=i.file_hash AND d.file_verified WHERE i.organization_id=p_org AND i.customer_id=r.customer_id AND i.consumer_unit_id=r.consumer_unit_id AND i.record_id=r.id AND i.actor_id=p_actor AND i.document_id=doc) THEN RAISE EXCEPTION 'Attachment not received in this request' USING ERRCODE='42501';END IF;
 END LOOP;
 SELECT * INTO old FROM public.operation_client_messages WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF old.record_id<>p_record OR old.actor_id<>p_actor OR old.subject<>btrim(p_subject) OR old.body<>btrim(p_body) OR old.document_ids<>p_documents THEN RAISE EXCEPTION 'Reply changed' USING ERRCODE='40001';END IF;RETURN to_jsonb(old);
 END IF;
 INSERT INTO public.operation_client_messages(organization_id,record_id,customer_id,consumer_unit_id,direction,subject,body,document_ids,actor_id,actor_name,request_id)
 VALUES(p_org,r.id,r.customer_id,r.consumer_unit_id,'INBOUND',btrim(p_subject),btrim(p_body),p_documents,p_actor,'Cliente',p_request) RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END$$;
REVOKE ALL ON FUNCTION public.append_operation_client_message(text,text,uuid,uuid,text,text,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.append_operation_client_message(text,text,uuid,uuid,text,text,text,text[]) TO service_role;

CREATE FUNCTION public.portal_notify_client_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org text; customer text; key text; notice_kind text; title text; href text; rec uuid; config jsonb; member record; binding jsonb; direction text;
BEGIN
 org:=to_jsonb(NEW)->>'organization_id';
 SELECT body INTO config FROM public.portal_service_routing WHERE organization_id=org AND kind='ROUTING' AND owner_user_id='organization' ORDER BY revision DESC LIMIT 1;
 IF config->>'enabled' IS DISTINCT FROM 'true' THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='operation_client_messages' THEN
  customer:=NEW.customer_id; rec:=NEW.record_id; direction:=NEW.direction;
  key:='message:'||NEW.id;notice_kind:='REPLY';title:='Nova mensagem no atendimento';href:='/portal#notificacoes';
  IF direction='INBOUND' THEN
   INSERT INTO public.portal_notification_outbox(organization_id,customer_id,recipient_id,event_key,kind,title,href,record_id)
   SELECT org,customer,r.responsible_id,key,notice_kind,'Cliente respondeu ao atendimento','/backoffice/operation/notifications',rec FROM public.operation_records r WHERE r.organization_id=org AND r.id=rec ON CONFLICT DO NOTHING;
   RETURN NEW;
  END IF;
 ELSIF TG_TABLE_NAME='portal_document_events' THEN
  IF NEW.state NOT IN('RECEIVED','ANALYSING','VALIDATING','AUTOMATION_STOPPED','REJECTED') THEN RETURN NEW;END IF;
  SELECT i.customer_id INTO customer FROM public.portal_document_intakes i WHERE i.id=NEW.intake_id AND i.organization_id=org;
  key:='document-state:'||NEW.id;notice_kind:='DOCUMENT';title:='Atualização do processamento da fatura';href:='/portal#minhas-faturas';
 ELSIF TG_TABLE_NAME='eva_closing_publication_events' THEN
  IF NEW.state<>'PUBLISHED' THEN RETURN NEW;END IF;
  SELECT p.customer_id INTO customer FROM public.eva_closing_publications p JOIN public.eva_assisted_closing_versions v ON v.id=p.closing_id AND v.organization_id=org WHERE p.organization_id=org AND p.id=NEW.publication_id AND v.payload_hash=p.source_hash AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)='APPROVED';
  key:='publication:'||NEW.publication_id;notice_kind:='PUBLICATION';title:='Novo resultado publicado';href:='/portal#financeiro';
 ELSIF TG_TABLE_NAME='monthly_energy_settlements' THEN
  IF NEW.status<>'PUBLISHED' OR NEW.validation_status<>'VALIDATED' OR NEW.financial_format<>'financial-settlement-1.0' OR NEW.published_at IS NULL OR (TG_OP='UPDATE' AND OLD.status='PUBLISHED') THEN RETURN NEW;END IF;
  customer:=NEW.customer_id;key:='legacy-publication:'||NEW.financial_group_id;notice_kind:='PUBLICATION';title:='Novo resultado publicado';href:='/portal#financeiro';
 ELSIF TG_TABLE_NAME='energy_forecast_events' THEN
  IF NEW.action<>'PUBLISHED' THEN RETURN NEW;END IF;
  SELECT r.customer_id INTO customer FROM public.energy_forecast_runs r WHERE r.organization_id=org AND r.id=NEW.run_id;
  key:='forecast:'||NEW.run_id;notice_kind:='PUBLICATION';title:='Nova projeção de consumo publicada';href:='/portal#financeiro';
 END IF;
 IF customer IS NULL THEN RETURN NEW;END IF;
 FOR member IN SELECT m.user_id::text AS actor,m.role_id::text AS role FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=org AND r.scope='organization' WHERE m.organization_id=org AND upper(m.status)='ACTIVE' AND m.affiliation_type='external' AND m.exclusive_customer_id=customer AND r.name='consulta' LOOP
  BEGIN binding:=public.client_portal_entitlement(org,member.actor,member.role,'notifications');EXCEPTION WHEN SQLSTATE '42501' THEN CONTINUE;END;
  IF binding->>'enabled'='true' AND binding->>'customerId'=customer THEN
   INSERT INTO public.portal_notification_outbox(organization_id,customer_id,recipient_id,event_key,kind,title,href,record_id) VALUES(org,customer,member.actor,key,notice_kind,title,href,rec) ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
 RETURN NEW;
END$$;
CREATE TRIGGER portal_document_state_notice AFTER INSERT ON public.portal_document_events FOR EACH ROW EXECUTE FUNCTION public.portal_notify_client_event();
CREATE TRIGGER portal_message_notice AFTER INSERT ON public.operation_client_messages FOR EACH ROW EXECUTE FUNCTION public.portal_notify_client_event();
CREATE TRIGGER portal_publication_notice AFTER INSERT ON public.eva_closing_publication_events FOR EACH ROW EXECUTE FUNCTION public.portal_notify_client_event();
CREATE TRIGGER portal_legacy_notice AFTER INSERT OR UPDATE OF status ON public.monthly_energy_settlements FOR EACH ROW EXECUTE FUNCTION public.portal_notify_client_event();
CREATE TRIGGER portal_forecast_notice AFTER INSERT ON public.energy_forecast_events FOR EACH ROW EXECUTE FUNCTION public.portal_notify_client_event();
REVOKE ALL ON FUNCTION public.portal_notify_client_event() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.portal_document_origins(p_org text,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now()) THEN
  IF NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND r.permissions?'8f105b02-4443-49de-b188-847e0284e7ed') THEN RAISE EXCEPTION 'Internal document permission required' USING ERRCODE='42501';END IF;
 ELSE PERFORM public.assert_license_platform_actor(p_actor::uuid);END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('documentId',document_id,'receivedAt',created_at,'kind',kind)),'[]') FROM public.portal_document_intakes WHERE organization_id=p_org AND document_id IS NOT NULL);
END$$;
REVOKE ALL ON FUNCTION public.portal_document_origins(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_document_origins(text,text) TO service_role;
COMMIT;
