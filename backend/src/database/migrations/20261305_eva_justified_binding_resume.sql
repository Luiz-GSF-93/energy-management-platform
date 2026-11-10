BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Explicit human intent is immutable and bound to this original and registration.
CREATE OR REPLACE FUNCTION public.eva_intake_resolve_justified(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;i public.eva_automatic_intakes;registration jsonb;
BEGIN
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR p_body-ARRAY['customerId','unitId','month','reason']<>'{}' OR coalesce(length(btrim(p_body->>'reason')),0) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Explicit justified binding required' USING ERRCODE='22023';END IF;
 PERFORM public.eva_intake_identity_action(p_org,p_actor,p_role,p_platform,'list',NULL,jsonb_build_object('ids',jsonb_build_array(p_id)));
 r:=public.eva_intake_action(p_org,p_actor,p_role,p_platform,'resolve',p_id,p_body);
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND organization_id=p_org FOR UPDATE;
 SELECT jsonb_build_object('customerId',c.id,'unitId',u.id,'taxId',c.document,'address',u.address,'unitNumber',u.consumer_unit_number,'month',p_body->>'month') INTO STRICT registration
 FROM public.consumer_units u JOIN public.customers c ON c.organization_id=u.organization_id AND c.id=u.customer_id
 WHERE u.organization_id=p_org AND u.id=p_body->>'unitId' AND c.id=p_body->>'customerId';
 PERFORM public.eva_intake_event(i.id,'CONTINUATION_REQUESTED',jsonb_build_object('fileHash',i.file_hash,'registration',registration,'reason',btrim(p_body->>'reason'),'roleId',p_role,'platform',p_platform,'financialApproval',false),p_actor);
 RETURN r||jsonb_build_object('continuationRequested',true);
END$$;

-- Only the existing, permission-checked decisions can resolve an identification.
-- The worker calls this after releasing its lease into REVIEW_REQUIRED.
CREATE OR REPLACE FUNCTION public.eva_intake_continue_requested(p_id uuid,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;d public.eva_intake_identity_reviews;e public.eva_automatic_intake_events;action text;role_name text;r jsonb;
BEGIN
 SELECT * INTO i FROM public.eva_automatic_intakes WHERE id=p_id FOR UPDATE;
 IF i.id IS NULL OR i.state<>'REVIEW_REQUIRED' OR i.document_id IS NOT NULL OR i.closing_id IS NOT NULL OR i.lease_token IS NOT NULL THEN RETURN jsonb_build_object('continued',false);END IF;
 SELECT * INTO e FROM public.eva_automatic_intake_events WHERE organization_id=i.organization_id AND intake_id=i.id AND event='CONTINUATION_REQUESTED' ORDER BY sequence DESC LIMIT 1;
 IF e.id IS NULL OR e.body->>'fileHash' IS DISTINCT FROM i.file_hash OR NOT public.eva_identity_registration_current(i.organization_id,e.body->'registration')
 OR EXISTS(SELECT 1 FROM public.eva_automatic_intake_events x WHERE x.intake_id=i.id AND x.organization_id=i.organization_id AND x.sequence>e.sequence AND x.event IN('SOURCE_REVIEW','DISMISSED','RESTORED')) THEN RETURN jsonb_build_object('continued',false);END IF;
 SELECT * INTO d FROM public.eva_intake_identity_reviews WHERE organization_id=i.organization_id AND intake_id=i.id AND kind='DIAGNOSTIC' ORDER BY created_at DESC LIMIT 1;
 IF d.id IS NULL OR d.fingerprint IS DISTINCT FROM p_fingerprint OR d.source_hash IS DISTINCT FROM i.file_hash OR d.diagnostic->'registration' IS DISTINCT FROM e.body->'registration' THEN RETURN jsonb_build_object('continued',false);END IF;
 SELECT name INTO role_name FROM public.roles WHERE organization_id=i.organization_id AND id::text=e.body->>'roleId';
 IF d.diagnostic->>'action'='CONTINUE_JUSTIFIED' THEN action:='decide';
 ELSIF role_name='admin_org' AND d.diagnostic->>'documentType' IN('INVOICE_SUPPLIER','INVOICE_DISTRIBUTOR')
  AND d.diagnostic#>>'{fields,0,status}'='MATCH' AND d.diagnostic#>>'{fields,1,status}'='MISMATCH'
  AND jsonb_array_length(d.diagnostic#>'{fields,1,found}')=1 AND length(d.diagnostic#>>'{fields,1,found,0}')>=12
  AND d.diagnostic#>>'{fields,3,status}'='MATCH' AND d.diagnostic#>>'{fields,2,status}' IN('MATCH','INCONCLUSIVE')
  AND(d.diagnostic->>'documentType'='INVOICE_SUPPLIER' OR d.diagnostic#>>'{fields,2,status}'='MATCH') THEN action:='address';
 ELSE RETURN jsonb_build_object('continued',false);END IF;
 BEGIN
  r:=public.eva_intake_identity_action(i.organization_id,e.actor_id,e.body->>'roleId',coalesce((e.body->>'platform')::boolean,false),action,i.id,jsonb_build_object('fingerprint',d.fingerprint,'decision','CONTINUE','reason',e.body->>'reason'));
 EXCEPTION WHEN insufficient_privilege OR serialization_failure THEN RETURN jsonb_build_object('continued',false,'requiresReview',true);END;
 RETURN jsonb_build_object('continued',true,'decision',r->>'decision');
END$$;

-- Registering a historical UC makes the next diagnostic MATCH instead of
-- MISMATCH. Preserve the accepted decision for the same immutable original.
CREATE OR REPLACE FUNCTION public.eva_intake_identity_resume_proof(p_id uuid,p_token uuid,p_diagnostic jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;i public.eva_automatic_intakes;old public.eva_intake_identity_reviews;
BEGIN
 r:=public.eva_intake_identity_work(p_id,p_token,p_diagnostic);
 IF coalesce((r->>'accepted')::boolean,false) OR coalesce((r->>'rejected')::boolean,false) THEN RETURN r;END IF;
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id;
 IF p_diagnostic#>>'{fields,0,status}' IS DISTINCT FROM 'MATCH' OR p_diagnostic#>>'{fields,1,status}' IS DISTINCT FROM 'MATCH' OR p_diagnostic#>>'{fields,2,status}' IS DISTINCT FROM 'MATCH' OR p_diagnostic#>>'{fields,3,status}' IS DISTINCT FROM 'MATCH' THEN RETURN r;END IF;
 SELECT * INTO old FROM public.eva_intake_identity_reviews WHERE organization_id=i.organization_id AND intake_id=i.id AND kind='CONTINUE' AND source_hash=i.file_hash
  AND diagnostic->'registration'=p_diagnostic->'registration' AND public.eva_identity_registration_current(i.organization_id,diagnostic->'registration')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_diagnostic#>'{fields,2,found}') code(value) WHERE regexp_replace(code.value,'[^0-9]','','g')=diagnostic->>'unitCode') ORDER BY created_at DESC LIMIT 1;
 IF old.id IS NOT NULL THEN RETURN jsonb_build_object('accepted',true,'reviewId',old.id,'unitCode',old.diagnostic->>'unitCode');END IF;
 RETURN r;
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_resolve_justified(text,text,text,boolean,uuid,jsonb),public.eva_intake_continue_requested(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_resolve_justified(text,text,text,boolean,uuid,jsonb),public.eva_intake_continue_requested(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.eva_intake_identity_resume_proof(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_identity_resume_proof(uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
