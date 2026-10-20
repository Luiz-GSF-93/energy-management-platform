BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.revalidate_portal_invoice_automation(p_id uuid,p_reservation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.portal_document_intakes; policy public.portal_service_routing; actor record; reservation public.portal_document_events; role_id text;
BEGIN
 SELECT * INTO i FROM public.portal_document_intakes WHERE id=p_id;
 SELECT * INTO reservation FROM public.portal_document_events WHERE id=p_reservation AND intake_id=p_id AND organization_id=i.organization_id AND state='AUTOMATION_RESERVED';
 IF NOT FOUND OR NOT i.consent OR i.document_id IS NULL THEN RAISE EXCEPTION 'Automation reservation unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO policy FROM public.portal_service_routing WHERE organization_id=i.organization_id AND kind='ROUTING' AND owner_user_id='organization' ORDER BY revision DESC LIMIT 1;
 IF policy.body->>'enabled' IS DISTINCT FROM 'true' OR policy.body->>'automationEnabled' IS DISTINCT FROM 'true' OR policy.id::text IS DISTINCT FROM split_part(reservation.source_id,':',1) THEN RAISE EXCEPTION 'Delegation changed' USING ERRCODE='42501';END IF;
 SELECT m.user_id::text AS user_id,m.role_id::text AS role_id,r.name,r.permissions INTO actor FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 WHERE m.organization_id=i.organization_id AND m.user_id::text=policy.body->>'automationActor' AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND r.name IN('admin_org','gestor');
 IF NOT FOUND THEN RAISE EXCEPTION 'Delegated actor revoked' USING ERRCODE='42501';END IF;
 SELECT m.role_id::text INTO role_id FROM public.organization_members m WHERE m.organization_id=i.organization_id AND m.user_id::text=i.actor_id AND upper(m.status)='ACTIVE' AND m.exclusive_customer_id=i.customer_id;
 PERFORM public.portal_workspace_actor(i.organization_id,i.actor_id,role_id,false,'documents');
 PERFORM public.assert_operation_actor(i.organization_id,actor.user_id,'requests',true);
 IF NOT EXISTS(SELECT 1 FROM public.documents d JOIN public.consumer_units u ON u.id=d.consumer_unit_id AND u.organization_id=d.organization_id AND u.customer_id=d.customer_id AND u.status='ACTIVE' WHERE d.organization_id=i.organization_id AND d.id=i.document_id AND d.customer_id=i.customer_id AND d.consumer_unit_id=i.consumer_unit_id AND d.file_hash=i.file_hash AND d.file_verified) THEN RAISE EXCEPTION 'Invoice source changed' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('userId',actor.user_id,'roleId',actor.role_id,'role',actor.name,'permissions',actor.permissions);
END$$;
CREATE FUNCTION public.claim_portal_invoice_automation() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.portal_document_intakes; policy public.portal_service_routing; reserved public.portal_document_events; stage text; job_state text;
BEGIN
 FOR i IN SELECT intake.* FROM public.portal_document_intakes intake
 WHERE intake.kind='INVOICE' AND intake.consent AND intake.document_id IS NOT NULL
 AND ((NOT EXISTS(SELECT 1 FROM public.document_ocr_jobs j WHERE j.organization_id=intake.organization_id AND j.document_id=intake.document_id) AND NOT EXISTS(SELECT 1 FROM public.portal_document_events e WHERE e.intake_id=intake.id AND e.event_key='automation:OCR')) OR (EXISTS(SELECT 1 FROM public.document_ocr_jobs j WHERE j.organization_id=intake.organization_id AND j.document_id=intake.document_id AND j.state='SUCCEEDED') AND NOT EXISTS(SELECT 1 FROM public.portal_document_events e WHERE e.intake_id=intake.id AND e.event_key='automation:PREPARE')))
 AND EXISTS(SELECT 1 FROM public.portal_service_routing p WHERE p.organization_id=intake.organization_id AND p.kind='ROUTING' AND p.owner_user_id='organization' AND p.body->>'enabled'='true' AND p.body->>'automationEnabled'='true' AND NOT EXISTS(SELECT 1 FROM public.portal_service_routing later WHERE later.organization_id=p.organization_id AND later.kind=p.kind AND later.owner_user_id=p.owner_user_id AND later.revision>p.revision))
 AND NOT EXISTS(SELECT 1 FROM public.portal_document_events e WHERE e.intake_id=intake.id AND e.state='AUTOMATION_STOPPED') ORDER BY intake.created_at LIMIT 20 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('portal-automation:'||i.id,0)) THEN CONTINUE;END IF;
  SELECT state INTO job_state FROM public.document_ocr_jobs WHERE organization_id=i.organization_id AND document_id=i.document_id;
  stage:=CASE WHEN job_state IS NULL THEN 'OCR' WHEN job_state='SUCCEEDED' THEN 'PREPARE' ELSE NULL END;
  IF stage IS NULL OR EXISTS(SELECT 1 FROM public.portal_document_events WHERE intake_id=i.id AND event_key='automation:'||stage) THEN CONTINUE;END IF;
  SELECT * INTO policy FROM public.portal_service_routing WHERE organization_id=i.organization_id AND kind='ROUTING' AND owner_user_id='organization' ORDER BY revision DESC LIMIT 1;
  INSERT INTO public.portal_document_events(organization_id,intake_id,event_key,state,source_id,note) VALUES(i.organization_id,i.id,'automation:'||stage,'AUTOMATION_RESERVED',policy.id||':'||stage,'Etapa reservada antes do processamento. Resultado incerto exige conferência.') RETURNING * INTO reserved;
  BEGIN PERFORM public.revalidate_portal_invoice_automation(i.id,reserved.id);
  EXCEPTION WHEN SQLSTATE '42501' THEN
   INSERT INTO public.portal_document_events(organization_id,intake_id,event_key,state,note) VALUES(i.organization_id,i.id,'finish:'||reserved.id,'AUTOMATION_STOPPED','Autorização ou fonte indisponível.');CONTINUE;
  END;
  RETURN jsonb_build_object('id',i.id,'organizationId',i.organization_id,'documentId',i.document_id,'fileHash',i.file_hash,'unitId',i.consumer_unit_id,'month',i.month,'stage',stage,'reservation',reserved.id);
 END LOOP;RETURN NULL;
END$$;
CREATE FUNCTION public.finish_portal_invoice_automation(p_id uuid,p_reservation uuid,p_state text,p_note text,p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.portal_document_intakes; prior public.portal_document_events;
BEGIN
 SELECT * INTO i FROM public.portal_document_intakes WHERE id=p_id;
 IF p_state NOT IN('ANALYSING','VALIDATING','AUTOMATION_STOPPED') OR length(p_note) NOT BETWEEN 3 AND 500 OR NOT EXISTS(SELECT 1 FROM public.portal_document_events WHERE id=p_reservation AND intake_id=p_id AND state='AUTOMATION_RESERVED') THEN RAISE EXCEPTION 'Invalid automation receipt' USING ERRCODE='22023';END IF;
 IF p_state='VALIDATING' AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.id::text=p_source AND v.organization_id=i.organization_id AND v.customer_id=i.customer_id AND v.month=i.month AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)='READY_FOR_REVIEW' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units') unit WHERE unit->>'id'=i.consumer_unit_id AND unit->>'documentId'=i.document_id AND unit->>'sourceHash'=i.file_hash)) THEN RAISE EXCEPTION 'Validated preparation source required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-automation:'||i.id,0));
 SELECT * INTO prior FROM public.portal_document_events WHERE intake_id=p_id AND event_key='finish:'||p_reservation;
 IF FOUND THEN IF prior.state<>p_state OR prior.source_id IS DISTINCT FROM p_source THEN RAISE EXCEPTION 'Receipt changed' USING ERRCODE='40001';END IF;RETURN;END IF;
 INSERT INTO public.portal_document_events(organization_id,intake_id,event_key,state,source_id,note) VALUES(i.organization_id,i.id,'finish:'||p_reservation,p_state,p_source,p_note);
END$$;
REVOKE ALL ON FUNCTION public.revalidate_portal_invoice_automation(uuid,uuid),public.claim_portal_invoice_automation(),public.finish_portal_invoice_automation(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revalidate_portal_invoice_automation(uuid,uuid),public.claim_portal_invoice_automation(),public.finish_portal_invoice_automation(uuid,uuid,text,text,text) TO service_role;
COMMIT;
