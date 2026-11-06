BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='45s';
CREATE OR REPLACE FUNCTION public.eva_intake_identity_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;i public.eva_automatic_intakes;d public.eva_intake_identity_reviews;decision text;item uuid;
BEGIN
 a:=public.eva_intake_actor(p_org,p_actor,p_role,p_platform,NULL);
 IF a->>'external' IS DISTINCT FROM 'false' OR NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND lower(m.status)='active' AND m.affiliation_type='internal' AND r.name IN('admin_org','gestor','operacional')) THEN RAISE EXCEPTION 'Internal documents access required' USING ERRCODE='42501';END IF;
 IF p_action='list' THEN
  IF p_id IS NOT NULL OR p_body-ARRAY['ids']<>'{}' OR jsonb_typeof(p_body->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'ids')>25 THEN RAISE EXCEPTION 'Invalid identity list' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT DISTINCT ON(v.intake_id) jsonb_build_object('id',v.intake_id,'fingerprint',v.fingerprint,'diagnostic',v.diagnostic,'reason',e.body->>'reason') x FROM public.eva_intake_identity_reviews v JOIN public.eva_automatic_intakes t ON t.id=v.intake_id AND t.organization_id=v.organization_id LEFT JOIN LATERAL(SELECT body FROM public.eva_automatic_intake_events WHERE intake_id=t.id AND event='SOURCE_REVIEW' ORDER BY sequence DESC LIMIT 1)e ON true WHERE v.organization_id=p_org AND v.kind='DIAGNOSTIC' AND p_body->'ids' ? v.intake_id::text AND t.state='REVIEW_REQUIRED' AND t.document_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.eva_intake_identity_reviews decision WHERE decision.intake_id=v.intake_id AND decision.fingerprint=v.fingerprint AND decision.kind IN('CONTINUE','ADDRESS','STOP','REJECTED')) AND v.source_hash=t.file_hash AND public.eva_identity_registration_current(p_org,v.diagnostic->'registration') ORDER BY v.intake_id,v.created_at DESC)q));
 ELSIF p_action IN('decide','address') THEN
  IF p_id IS NULL OR p_body-ARRAY['fingerprint','decision','reason']<>'{}' OR p_body->>'decision' NOT IN('CONTINUE','STOP') OR coalesce(length(btrim(p_body->>'reason')),0) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Identity decision and reason required' USING ERRCODE='22023';END IF;
  SELECT * INTO i FROM public.eva_automatic_intakes WHERE id=p_id AND organization_id=p_org FOR UPDATE;
  IF FOUND AND EXISTS(SELECT 1 FROM public.eva_intake_identity_reviews v WHERE v.intake_id=i.id AND v.source_hash=i.file_hash AND v.fingerprint=p_body->>'fingerprint' AND v.actor_id=p_actor AND v.reason=btrim(p_body->>'reason') AND v.kind=CASE WHEN p_action='address' THEN 'ADDRESS' ELSE p_body->>'decision' END AND public.eva_identity_registration_current(p_org,v.diagnostic->'registration')) THEN RETURN jsonb_build_object('id',i.id,'replayed',true);END IF;
  IF NOT FOUND OR i.state<>'REVIEW_REQUIRED' OR i.document_id IS NOT NULL OR i.closing_id IS NOT NULL OR i.lease_token IS NOT NULL THEN RAISE EXCEPTION 'Identity review state changed' USING ERRCODE='40001';END IF;
  SELECT * INTO d FROM public.eva_intake_identity_reviews WHERE intake_id=i.id AND kind='DIAGNOSTIC' ORDER BY created_at DESC LIMIT 1;
  IF d.id IS NULL OR d.fingerprint IS DISTINCT FROM p_body->>'fingerprint' OR d.source_hash<>i.file_hash OR NOT public.eva_identity_registration_current(p_org,d.diagnostic->'registration') OR d.unit_id IS DISTINCT FROM i.hints->>'unitId' OR d.month IS DISTINCT FROM i.hints->>'month' OR d.customer_id IS DISTINCT FROM i.customer_id THEN RAISE EXCEPTION 'Identity evidence changed' USING ERRCODE='40001';END IF;
  decision:=p_body->>'decision';
  IF p_action='address' THEN
   IF NOT EXISTS(SELECT 1 FROM public.roles WHERE id::text=p_role AND organization_id=p_org AND name='admin_org') OR decision<>'CONTINUE' OR d.diagnostic->>'documentType' IS DISTINCT FROM 'INVOICE_SUPPLIER' OR d.diagnostic#>>'{fields,0,status}' IS DISTINCT FROM 'MATCH' OR d.diagnostic#>>'{fields,1,status}' IS DISTINCT FROM 'MISMATCH' OR jsonb_array_length(d.diagnostic#>'{fields,1,found}')<>1 OR d.diagnostic#>>'{fields,3,status}' IS DISTINCT FROM 'MATCH' THEN RAISE EXCEPTION 'Specific administrator address evidence required' USING ERRCODE='42501';END IF;decision:='ADDRESS';
  END IF;
  IF decision='CONTINUE' AND(d.diagnostic->>'action' IS DISTINCT FROM 'CONTINUE_JUSTIFIED' OR coalesce(d.diagnostic->>'unitCode','')!~'^[0-9]{5,20}$' OR d.diagnostic#>>'{fields,0,status}' IS DISTINCT FROM 'MATCH' OR d.diagnostic#>>'{fields,1,status}' IS DISTINCT FROM 'MATCH' OR d.diagnostic#>>'{fields,2,status}' IS DISTINCT FROM 'MISMATCH' OR d.diagnostic#>>'{fields,3,status}' IS DISTINCT FROM 'MATCH') THEN RAISE EXCEPTION 'Only justified UC difference may continue' USING ERRCODE='42501';END IF;
  INSERT INTO public.eva_intake_identity_reviews(organization_id,intake_id,fingerprint,source_hash,customer_id,unit_id,month,kind,diagnostic,reason,actor_id) VALUES(p_org,i.id,d.fingerprint,d.source_hash,d.customer_id,d.unit_id,d.month,decision,d.diagnostic,btrim(p_body->>'reason'),p_actor) RETURNING id INTO item;
  UPDATE public.eva_automatic_intakes SET state=CASE WHEN decision IN('CONTINUE','ADDRESS') THEN 'RECOGNIZING' ELSE 'DISMISSED' END,note=CASE WHEN decision IN('CONTINUE','ADDRESS') THEN 'Correspondência documental justificada; retomando as fontes existentes, sem aprovação financeira.' ELSE 'Preenchimento descontinuado pelo operador; original e histórico preservados.' END,next_attempt_at=CASE WHEN decision IN('CONTINUE','ADDRESS') THEN clock_timestamp() ELSE 'infinity'::timestamptz END,updated_at=clock_timestamp() WHERE id=i.id;
  PERFORM public.eva_intake_event(i.id,CASE WHEN decision IN('CONTINUE','ADDRESS') THEN 'IDENTITY_CONTINUED' ELSE 'DISMISSED' END,jsonb_build_object('reviewId',item,'reason',btrim(p_body->>'reason'),'fingerprint',d.fingerprint,'financialApproval',false),p_actor);
  RETURN jsonb_build_object('id',i.id,'decision',decision,'reviewId',item);
 ELSIF p_action='justifications' THEN
  IF p_id IS NOT NULL OR p_body-ARRAY['refs']<>'{}' OR jsonb_typeof(p_body->'refs') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'refs')>100 THEN RAISE EXCEPTION 'Invalid review refs' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'reason',r.reason,'createdAt',r.created_at,'actor',coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),u.email),'field',CASE r.kind WHEN 'ADDRESS' THEN 'Endereço confirmado pelo administrador' ELSE 'UC / instalação' END,'expected',CASE r.kind WHEN 'ADDRESS' THEN r.diagnostic#>>'{fields,1,expected}' ELSE r.diagnostic#>>'{fields,2,expected}' END,'found',CASE r.kind WHEN 'ADDRESS' THEN r.diagnostic#>'{fields,1,found}' ELSE r.diagnostic#>'{fields,2,found}' END,'filename',i.filename,'sourceHash',r.source_hash,'unitId',r.unit_id,'month',r.month)),'[]') FROM public.eva_intake_identity_reviews r JOIN public.eva_automatic_intakes i ON i.id=r.intake_id AND i.organization_id=r.organization_id LEFT JOIN auth.users u ON u.id::text=r.actor_id WHERE r.organization_id=p_org AND r.kind IN('CONTINUE','ADDRESS') AND p_body->'refs' ? r.id::text));
 END IF;
 RAISE EXCEPTION 'Invalid identity action' USING ERRCODE='22023';
END$$;


CREATE FUNCTION public.eva_intake_preserved_ocr(p_job uuid,p_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.document_ocr_jobs;i public.eva_automatic_intakes;
BEGIN
 SELECT * INTO j FROM public.document_ocr_jobs WHERE id=p_job AND lease_token=p_token AND p_token IS NOT NULL AND lease_until>clock_timestamp() AND state='POLLING';
 IF NOT FOUND THEN RAISE EXCEPTION 'OCR lease unavailable' USING ERRCODE='42501';END IF;
 SELECT t.* INTO i FROM public.eva_automatic_intakes t JOIN public.documents d ON d.id=t.document_id AND d.organization_id=t.organization_id
 WHERE t.organization_id=j.organization_id AND t.document_id=j.document_id AND t.file_hash=j.file_hash AND t.operation_url=j.operation_url AND t.proof->>'state'='MATCH'
 AND t.document_type='INVOICE_DISTRIBUTOR' AND d.file_verified AND d.file_hash=t.file_hash AND d.customer_id=t.customer_id AND d.consumer_unit_id=t.unit_id
 AND jsonb_typeof(t.raw_result->'pages')='array' AND jsonb_array_length(t.raw_result->'pages')>0;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM public.assert_invoice_month_ocr(j.organization_id,j.document_id);
 RETURN jsonb_build_object('result',i.raw_result,'intakeId',i.id,'fileHash',i.file_hash);
END$$;
CREATE FUNCTION public.eva_intake_recover_preserved_ocr(p_id uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;i public.eva_automatic_intakes;j public.document_ocr_jobs;
BEGIN
 IF to_regprocedure('public.portal_intake_work_context_scoped(uuid,uuid)') IS NOT NULL THEN EXECUTE 'SELECT public.portal_intake_work_context_scoped($1,$2)' INTO ctx USING p_id,p_token;ELSE ctx:=public.eva_intake_work_context(p_id,p_token);END IF;
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id;
 IF i.state<>'WAITING_OCR' OR i.closing_id IS NOT NULL OR i.proof->>'state' IS DISTINCT FROM 'MATCH' OR i.document_type IS DISTINCT FROM 'INVOICE_DISTRIBUTOR' OR i.operation_url IS NULL OR jsonb_typeof(i.raw_result->'pages') IS DISTINCT FROM 'array' OR jsonb_array_length(i.raw_result->'pages')=0 THEN RETURN false;END IF;
 SELECT * INTO j FROM public.document_ocr_jobs WHERE organization_id=i.organization_id AND document_id=i.document_id AND file_hash=i.file_hash FOR UPDATE;
 IF NOT FOUND OR j.state<>'FAILED' OR j.error_code IS DISTINCT FROM 'PROVIDER_REJECTED' OR j.submission_started_at IS NOT NULL OR j.operation_url IS DISTINCT FROM i.operation_url OR j.lease_token IS NOT NULL OR EXISTS(SELECT 1 FROM public.document_ocr_results WHERE job_id=j.id) OR NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=i.document_id AND d.organization_id=i.organization_id AND d.customer_id=i.customer_id AND d.consumer_unit_id=i.unit_id AND d.file_hash=i.file_hash AND d.file_verified) THEN RETURN false;END IF;
 PERFORM public.assert_invoice_month_ocr(i.organization_id,i.document_id);
 UPDATE public.document_ocr_jobs SET state='POLLING',error_code=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=j.id;
 PERFORM public.eva_intake_event(i.id,'PRESERVED_READ_RECOVERY',jsonb_build_object('jobId',j.id,'previousState',j.state,'previousError',j.error_code,'sourceHash',i.file_hash,'newProviderSubmission',false),ctx#>>'{delegate,userId}');
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_preserved_ocr(uuid,uuid),public.eva_intake_recover_preserved_ocr(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_preserved_ocr(uuid,uuid),public.eva_intake_recover_preserved_ocr(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
