BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $install_20261266$ BEGIN
 IF to_regprocedure('public.trading_formalization_assert(text,boolean)') IS NOT NULL THEN
  IF obj_description(to_regprocedure('public.trading_formalization_assert(text,boolean)'),'pg_proc') IS DISTINCT FROM 'trading-workflow:20261266:03bfae259786c26f0270a2ff5e7647252f6b8d4029900c216d8db898a0257212' THEN RAISE EXCEPTION 'Review existing Trading workflow schema before migration';END IF;RETURN;
 END IF;
 EXECUTE $schema_20261266$
CREATE FUNCTION public.trading_formalization_assert(p_hash text,p_session boolean) RETURNS public.trading_formalization_access
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.trading_formalization_access;w public.trading_approval_workflows;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_session IS NULL THEN RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM public.trading_formalization_access WHERE CASE WHEN p_session THEN session_hash ELSE token_hash END=p_hash AND revoked_at IS NULL;
 IF a.id IS NULL OR(p_session AND(a.session_expires_at IS NULL OR a.session_expires_at<=now())) OR NOT public.trading_license_active(a.organization_id) THEN RAISE EXCEPTION 'Access expired or revoked' USING ERRCODE='42501';END IF;
 SELECT * INTO w FROM public.trading_approval_workflows WHERE id=a.workflow_id AND organization_id=a.organization_id;
 IF w.state NOT IN('SUPPLIER_PENDING','FORMALIZING') OR NOT EXISTS(SELECT 1 FROM public.trading_records p WHERE p.id=w.proposal_id AND p.organization_id=w.organization_id AND p.status='CLIENT_APPROVED' AND p.data=w.proposal_data AND p.revision=w.proposal_revision)
 OR NOT EXISTS(SELECT 1 FROM public.trading_records s WHERE s.id=w.supplier_id AND s.organization_id=w.organization_id AND s.status='ACTIVE')
 OR NOT EXISTS(SELECT 1 FROM public.customers c JOIN public.consumer_units u ON u.organization_id=c.organization_id AND u.customer_id=c.id WHERE c.organization_id=w.organization_id AND c.id=w.customer_id AND u.id=w.unit_id AND c.status='ACTIVE' AND c.deleted_at IS NULL AND u.status='ACTIVE') THEN RAISE EXCEPTION 'Negotiation unavailable or changed' USING ERRCODE='42501';END IF;
 RETURN a;
END$$;
CREATE FUNCTION public.trading_formalization_auth(p_hash text,p_action text,p_otp text,p_session text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.trading_formalization_access;
BEGIN
 a:=public.trading_formalization_assert(p_hash,false);
 SELECT * INTO a FROM public.trading_formalization_access WHERE id=a.id FOR UPDATE;
 IF p_otp IS NULL OR p_otp !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid verification' USING ERRCODE='22023';END IF;
 IF p_action='CHALLENGE' THEN
  IF a.otp_sent_at>now()-interval '1 minute' THEN RETURN jsonb_build_object('allowed',false);END IF;
  UPDATE public.trading_formalization_access SET otp_hash=p_otp,otp_expires_at=now()+interval '10 minutes',otp_sent_at=now(),otp_attempts=0 WHERE id=a.id;
  RETURN jsonb_build_object('allowed',true,'id',a.id,'email',a.email);
 ELSIF p_action='VERIFY' THEN
  IF a.otp_expires_at IS NULL OR a.otp_expires_at<=now() OR a.otp_attempts>=5 OR a.otp_hash IS DISTINCT FROM p_otp THEN
   UPDATE public.trading_formalization_access SET otp_attempts=otp_attempts+1 WHERE id=a.id;RETURN jsonb_build_object('allowed',false);
  END IF;
  IF p_session IS NULL OR p_session !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid session' USING ERRCODE='22023';END IF;
  UPDATE public.trading_formalization_access SET session_hash=p_session,session_expires_at=now()+interval '15 minutes',otp_hash=NULL,otp_expires_at=NULL WHERE id=a.id;
  RETURN jsonb_build_object('allowed',true);
 END IF;
 RAISE EXCEPTION 'Invalid verification action' USING ERRCODE='22023';
END$$;
CREATE FUNCTION public.trading_formalization_view(p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.trading_formalization_access;w public.trading_approval_workflows;
BEGIN
 a:=public.trading_formalization_assert(p_hash,true);SELECT * INTO w FROM public.trading_approval_workflows WHERE id=a.workflow_id AND organization_id=a.organization_id;
 RETURN jsonb_build_object('organizationId',a.organization_id,'workflowId',w.id,'revision',w.revision,'proposal',w.proposal_data,'state',w.state,'documentRequest',w.document_request,
 'customer',(SELECT company_name FROM public.customers WHERE organization_id=w.organization_id AND id=w.customer_id),'unit',(SELECT name FROM public.consumer_units WHERE organization_id=w.organization_id AND id=w.unit_id),
 'pendingBatches',(SELECT coalesce(jsonb_agg(DISTINCT f.batch_id),'[]') FROM public.trading_formalization_files f WHERE f.organization_id=w.organization_id AND f.workflow_id=w.id AND f.state='RESERVED' AND f.origin='SUPPLIER' AND f.uploaded_by='supplier:'||a.email),
 'files',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.filename,'size',f.size_bytes,'origin',f.origin)),'[]') FROM public.trading_formalization_files f WHERE f.organization_id=w.organization_id AND f.workflow_id=w.id AND f.state='ARCHIVED' AND(f.origin='SUPPLIER' OR f.shared)));
END$$;
CREATE FUNCTION public.trading_formalization_accept(p_hash text,p_revision integer,p_request uuid,p_reason text,p_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.trading_formalization_access;w public.trading_approval_workflows;e public.trading_approval_events;answer jsonb;input jsonb;
BEGIN
 a:=public.trading_formalization_assert(p_hash,true);
 IF p_request IS NULL OR p_confirmed IS DISTINCT FROM true OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Confirm acceptance and requested documents' USING ERRCODE='22023';END IF;
 SELECT * INTO w FROM public.trading_approval_workflows WHERE organization_id=a.organization_id AND id=a.workflow_id FOR UPDATE;
 input:=jsonb_build_object('revision',p_revision,'documents',p_reason);
 SELECT * INTO e FROM public.trading_approval_events WHERE organization_id=a.organization_id AND request_id=p_request;
 IF FOUND THEN IF e.workflow_id<>w.id OR e.actor_id<>'supplier:'||a.email OR e.input IS DISTINCT FROM input THEN RAISE EXCEPTION 'Changed acceptance request' USING ERRCODE='40001';END IF;RETURN e.response;END IF;
 IF w.revision IS DISTINCT FROM p_revision OR w.state<>'SUPPLIER_PENDING' THEN RAISE EXCEPTION 'Negotiation changed' USING ERRCODE='40001';END IF;
 UPDATE public.trading_approval_workflows SET state='FORMALIZING',document_request=p_reason,revision=revision+1,updated_at=clock_timestamp() WHERE id=w.id RETURNING * INTO w;
 answer:=jsonb_build_object('state',w.state,'revision',w.revision);
 INSERT INTO public.trading_approval_events(organization_id,workflow_id,actor_id,request_id,input,action,reason,snapshot,response)VALUES(w.organization_id,w.id,'supplier:'||a.email,p_request,input,'SUPPLIER_ACCEPT','Aceite e solicitação de documentos pelo contato convidado.',to_jsonb(w),answer);
 INSERT INTO public.trading_approval_deliveries(organization_id,workflow_id,workflow_revision,recipient_id,channel,state,title,href)VALUES(w.organization_id,w.id,w.revision,w.requester_id,'INAPP','ACCEPTED','Trading: fornecedor confirmou aceite e solicitou documentos','/backoffice/trading-hub#aprovacoes');
 RETURN answer;
END$$;

CREATE FUNCTION public.trading_workflow_files(p_org text,p_actor text,p_workflow uuid,p_session text,p_action text,p_batch uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.trading_formalization_access;w public.trading_approval_workflows;f public.trading_formalization_files;item jsonb;origin text;files jsonb;actor text;total bigint;old public.trading_approval_events;
BEGIN
 IF p_session IS NOT NULL THEN a:=public.trading_formalization_assert(p_session,true);p_org:=a.organization_id;p_workflow:=a.workflow_id;actor:='supplier:'||a.email;origin:='SUPPLIER';
 ELSE PERFORM public.assert_trading_actor(p_org,p_actor,p_action<>'DOWNLOAD');actor:=p_actor;origin:='BACKOFFICE';END IF;
 SELECT * INTO w FROM public.trading_approval_workflows WHERE organization_id=p_org AND id=p_workflow FOR UPDATE;
 IF w.id IS NULL OR w.state NOT IN('SUPPLIER_PENDING','FORMALIZING') THEN RAISE EXCEPTION 'File exchange closed' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.trading_records p WHERE p.id=w.proposal_id AND p.organization_id=p_org AND p.data=w.proposal_data AND p.revision=w.proposal_revision AND p.status='CLIENT_APPROVED') THEN RAISE EXCEPTION 'Proposal source changed' USING ERRCODE='42501';END IF;
 IF p_action='CONTEXT' THEN RETURN jsonb_build_object('organizationId',p_org,'workflowId',w.id);END IF;
 IF p_action='DOWNLOAD' THEN
  SELECT ff.* INTO f FROM public.trading_formalization_files ff WHERE ff.organization_id=p_org AND ff.workflow_id=w.id AND ff.id=(p_body->>'id')::uuid AND ff.state='ARCHIVED' AND(p_session IS NULL OR ff.shared OR ff.origin='SUPPLIER');
  IF f.id IS NULL THEN RAISE EXCEPTION 'Document not shared' USING ERRCODE='42501';END IF;
  INSERT INTO public.trading_approval_events(organization_id,workflow_id,actor_id,request_id,input,action,reason,snapshot,response)VALUES(p_org,w.id,actor,gen_random_uuid(),jsonb_build_object('fileId',f.id),'DOWNLOAD','Download autorizado do arquivo da negociação.',jsonb_build_object('fileId',f.id,'sha256',f.sha256),'{}');
  RETURN to_jsonb(f);
 ELSIF p_action='SHARE' AND p_session IS NULL THEN
  IF p_body->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Confirm document sharing' USING ERRCODE='22023';END IF;
  UPDATE public.trading_formalization_files SET shared=true WHERE organization_id=p_org AND workflow_id=w.id AND id=(p_body->>'id')::uuid AND state='ARCHIVED' RETURNING * INTO f;
  IF f.id IS NULL THEN RAISE EXCEPTION 'File unavailable' USING ERRCODE='42501';END IF;
  INSERT INTO public.trading_approval_events(organization_id,workflow_id,actor_id,request_id,input,action,reason,snapshot,response)VALUES(p_org,w.id,actor,gen_random_uuid(),jsonb_build_object('fileId',f.id),'SHARE','Compartilhamento explícito com o fornecedor desta negociação.',jsonb_build_object('fileId',f.id,'sha256',f.sha256),'{}');RETURN jsonb_build_object('shared',true);
 END IF;
 IF p_batch IS NULL THEN RAISE EXCEPTION 'Batch required' USING ERRCODE='22023';END IF;
 IF p_action='RESERVE' THEN
  files:=p_body->'files';
  IF jsonb_typeof(files) IS DISTINCT FROM 'array' OR jsonb_array_length(files) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Select 1 to 20 files totaling up to 20 MB' USING ERRCODE='22023';END IF;
  SELECT sum((x->>'size')::bigint) INTO total FROM jsonb_array_elements(files)x;
  IF total IS NULL OR total<=0 OR total>20971520 OR(SELECT count(DISTINCT x->>'hash') FROM jsonb_array_elements(files)x)<>jsonb_array_length(files) THEN RAISE EXCEPTION 'Batch above 20 MB or duplicate files' USING ERRCODE='40001';END IF;
  IF EXISTS(SELECT 1 FROM public.trading_formalization_files WHERE organization_id=p_org AND batch_id=p_batch) THEN
   IF(SELECT count(*) FROM public.trading_formalization_files WHERE organization_id=p_org AND workflow_id=w.id AND batch_id=p_batch AND uploaded_by=actor)<>jsonb_array_length(files)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(files)x WHERE NOT EXISTS(SELECT 1 FROM public.trading_formalization_files ff WHERE ff.organization_id=p_org AND ff.workflow_id=w.id AND ff.batch_id=p_batch AND ff.uploaded_by=actor AND ff.sha256=x->>'hash' AND ff.filename=x->>'name' AND ff.mime=x->>'mime' AND ff.size_bytes=(x->>'size')::bigint)) THEN RAISE EXCEPTION 'Retry batch changed' USING ERRCODE='40001';END IF;
  ELSE
  FOR item IN SELECT value FROM jsonb_array_elements(files) LOOP
   IF (item->>'size')::bigint<=0 OR length(coalesce(item->>'name','')) NOT BETWEEN 1 AND 200 OR item->>'hash' !~ '^[a-f0-9]{64}$' OR item->>'mime' NOT IN('application/pdf','image/jpeg','image/png') THEN RAISE EXCEPTION 'Invalid verified file' USING ERRCODE='22023';END IF;
   INSERT INTO public.trading_formalization_files(id,organization_id,workflow_id,batch_id,path,filename,mime,size_bytes,sha256,uploaded_by,origin)
   VALUES((item->>'id')::uuid,p_org,w.id,p_batch,p_org||'/trading/'||w.id||'/'||(item->>'id'),item->>'name',item->>'mime',(item->>'size')::bigint,item->>'hash',actor,origin);
  END LOOP;
  END IF;
 ELSIF p_action='FINISH' THEN
  FOR f IN SELECT * FROM public.trading_formalization_files WHERE organization_id=p_org AND workflow_id=w.id AND batch_id=p_batch AND uploaded_by=actor FOR UPDATE LOOP
   IF f.state='ARCHIVED' THEN CONTINUE;END IF;
   IF f.state<>'RESERVED' THEN RAISE EXCEPTION 'File batch unavailable' USING ERRCODE='40001';END IF;
   INSERT INTO public.documents(id,organization_id,customer_id,consumer_unit_id,document_type,reference_month,original_filename,mime_type,file_hash,file_size_bytes,file_path,storage_bucket,file_verified,file_verified_at,uploaded_by_auth_user_id,license_check_passed,processing_status,ocr_status,description)
   VALUES(f.id::text,p_org,w.customer_id,w.unit_id,'OTHER',NULL,f.filename,f.mime,f.sha256,f.size_bytes,f.path,'energy-documents-private',true,clock_timestamp(),w.requester_id::uuid,true,'PENDING','PENDING','Formalização Trading · origem '||f.origin||' · autor '||f.uploaded_by||' · proposta '||w.proposal_id);
   UPDATE public.trading_formalization_files SET state='ARCHIVED',document_id=f.id::text WHERE id=f.id;
  END LOOP;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'Invalid file action' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',filename,'path',path,'state',state,'hash',sha256)),'[]') INTO files FROM public.trading_formalization_files WHERE organization_id=p_org AND workflow_id=w.id AND batch_id=p_batch AND uploaded_by=actor;
 INSERT INTO public.trading_approval_events(organization_id,workflow_id,actor_id,request_id,input,action,reason,snapshot,response)VALUES(p_org,w.id,actor,gen_random_uuid(),jsonb_build_object('batchId',p_batch),p_action||'_FILES','Lote documental da negociação; preserva os originais e o histórico.',jsonb_build_object('batchId',p_batch,'files',files),'{}');
 RETURN jsonb_build_object('organizationId',p_org,'workflowId',w.id,'files',files);
END$$;
DO $$DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure AS name FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('trading_formalization_assert','trading_formalization_auth','trading_formalization_view','trading_formalization_accept','trading_workflow_files') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.name);IF f.name::text NOT LIKE 'trading_formalization_assert%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.name);END IF;
END LOOP;END$$;
NOTIFY pgrst,'reload schema';

COMMENT ON FUNCTION public.trading_formalization_assert(text,boolean) IS 'trading-workflow:20261266:03bfae259786c26f0270a2ff5e7647252f6b8d4029900c216d8db898a0257212';
$schema_20261266$;
END $install_20261266$;
COMMIT;
