BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
CREATE TABLE public.eva_intake_identity_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,intake_id uuid NOT NULL REFERENCES public.eva_automatic_intakes(id),
 fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 customer_id text NOT NULL,unit_id text NOT NULL,month text NOT NULL CHECK(month~'^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 kind text NOT NULL CHECK(kind IN('DIAGNOSTIC','CONTINUE','STOP','REJECTED','ADDRESS')),diagnostic jsonb NOT NULL,reason text,actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(intake_id,fingerprint,kind),
 CHECK(kind='DIAGNOSTIC' OR reason IS NOT NULL AND length(btrim(reason)) BETWEEN 20 AND 1000)
);
CREATE INDEX eva_identity_review_scope ON public.eva_intake_identity_reviews(organization_id,intake_id,created_at DESC);
ALTER TABLE public.eva_intake_identity_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eva_intake_identity_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.eva_intake_identity_reviews FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_eva_identity_review BEFORE UPDATE OR DELETE ON public.eva_intake_identity_reviews FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();

CREATE FUNCTION public.eva_identity_registration_current(p_org text,p_registration jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.organization_id=u.organization_id AND c.id=u.customer_id
 WHERE u.organization_id=p_org AND u.id=p_registration->>'unitId' AND u.customer_id=p_registration->>'customerId'
 AND upper(u.status)='ACTIVE' AND upper(c.status)='ACTIVE' AND c.deleted_at IS NULL
 AND u.consumer_unit_number IS NOT DISTINCT FROM p_registration->>'unitNumber' AND u.address IS NOT DISTINCT FROM p_registration->>'address' AND c.document IS NOT DISTINCT FROM p_registration->>'taxId');
$$;

CREATE FUNCTION public.eva_intake_identity_work(p_id uuid,p_token uuid,p_diagnostic jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;ctx jsonb;r jsonb;old public.eva_intake_identity_reviews;actor text;reason text;
BEGIN
 IF to_regprocedure('public.portal_intake_work_context_scoped(uuid,uuid)') IS NOT NULL THEN EXECUTE 'SELECT public.portal_intake_work_context_scoped($1,$2)' INTO ctx USING p_id,p_token;ELSE ctx:=public.eva_intake_work_context(p_id,p_token);END IF; SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id;
 IF p_diagnostic->>'version' IS DISTINCT FROM 'intake-identity-triage-1' OR p_diagnostic->>'fileHash' IS DISTINCT FROM i.file_hash
 OR coalesce(p_diagnostic->>'fingerprint','')!~'^[a-f0-9]{64}$' OR jsonb_typeof(p_diagnostic->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(p_diagnostic->'fields')<>4 OR octet_length(p_diagnostic::text)>24000
 OR i.hints->>'unitId' IS DISTINCT FROM p_diagnostic#>>'{registration,unitId}' OR i.customer_id IS DISTINCT FROM p_diagnostic#>>'{registration,customerId}' OR i.hints->>'month' IS DISTINCT FROM p_diagnostic#>>'{registration,month}'
 OR NOT public.eva_identity_registration_current(i.organization_id,p_diagnostic->'registration') THEN RAISE EXCEPTION 'Identity diagnostic source changed' USING ERRCODE='40001';END IF;
 actor:=ctx#>>'{delegate,userId}';r:=p_diagnostic->'registration';
 INSERT INTO public.eva_intake_identity_reviews(organization_id,intake_id,fingerprint,source_hash,customer_id,unit_id,month,kind,diagnostic,actor_id)
 VALUES(i.organization_id,i.id,p_diagnostic->>'fingerprint',i.file_hash,r->>'customerId',r->>'unitId',r->>'month','DIAGNOSTIC',p_diagnostic,actor) ON CONFLICT DO NOTHING;
 SELECT * INTO old FROM public.eva_intake_identity_reviews WHERE intake_id=i.id AND fingerprint=p_diagnostic->>'fingerprint' AND kind IN('CONTINUE','ADDRESS');
 IF FOUND THEN RETURN jsonb_build_object('accepted',true,'reviewId',old.id,'unitCode',CASE WHEN old.kind='CONTINUE' THEN old.diagnostic->>'unitCode' END,'address',CASE WHEN old.kind='ADDRESS' THEN old.diagnostic#>>'{fields,1,found,0}' END);END IF;
 IF p_diagnostic->>'action'='REJECT' THEN
  IF i.document_id IS NOT NULL OR i.closing_id IS NOT NULL OR EXISTS(SELECT 1 FROM generate_series(0,2) n WHERE p_diagnostic#>>ARRAY['fields',n::text,'status'] IS DISTINCT FROM 'MISMATCH' OR jsonb_typeof(p_diagnostic#>ARRAY['fields',n::text,'found']) IS DISTINCT FROM 'array' OR jsonb_array_length(p_diagnostic#>ARRAY['fields',n::text,'found'])<>1) THEN RAISE EXCEPTION 'Automatic rejection evidence incomplete' USING ERRCODE='22023';END IF;
  reason:='Documento incompatível: CNPJ, endereço e UC do destinatário comprovadamente diferentes do recorte selecionado.';
  INSERT INTO public.eva_intake_identity_reviews(organization_id,intake_id,fingerprint,source_hash,customer_id,unit_id,month,kind,diagnostic,reason,actor_id) VALUES(i.organization_id,i.id,p_diagnostic->>'fingerprint',i.file_hash,r->>'customerId',r->>'unitId',r->>'month','REJECTED',p_diagnostic,reason,actor) ON CONFLICT DO NOTHING;
  UPDATE public.eva_automatic_intakes SET state='DISMISSED',note=reason,lease_token=NULL,lease_until=NULL,next_attempt_at='infinity',updated_at=clock_timestamp() WHERE id=i.id;
  PERFORM public.eva_intake_event(i.id,'DISMISSED',jsonb_build_object('reason',reason,'automatic',true,'diagnostic',p_diagnostic,'financialApproval',false),actor);
  RETURN jsonb_build_object('rejected',true);
 END IF;
 RETURN jsonb_build_object('accepted',false);
END$$;

CREATE FUNCTION public.eva_intake_identity_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;i public.eva_automatic_intakes;d public.eva_intake_identity_reviews;decision text;item uuid;
BEGIN
 a:=public.eva_intake_actor(p_org,p_actor,p_role,p_platform,NULL);
 IF a->>'external' IS DISTINCT FROM 'false' OR NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND lower(m.status)='active' AND m.affiliation_type='internal' AND r.name IN('admin_org','gestor','operacional')) THEN RAISE EXCEPTION 'Internal documents access required' USING ERRCODE='42501';END IF;
 IF p_action='list' THEN
  IF p_id IS NOT NULL OR p_body-ARRAY['ids']<>'{}' OR jsonb_typeof(p_body->'ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'ids')>25 THEN RAISE EXCEPTION 'Invalid identity list' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT DISTINCT ON(v.intake_id) jsonb_build_object('id',v.intake_id,'fingerprint',v.fingerprint,'diagnostic',v.diagnostic,'reason',e.body->>'reason') x FROM public.eva_intake_identity_reviews v JOIN public.eva_automatic_intakes t ON t.id=v.intake_id AND t.organization_id=v.organization_id LEFT JOIN LATERAL(SELECT body FROM public.eva_automatic_intake_events WHERE intake_id=t.id AND event='SOURCE_REVIEW' ORDER BY sequence DESC LIMIT 1)e ON true WHERE v.organization_id=p_org AND v.kind='DIAGNOSTIC' AND p_body->'ids' ? v.intake_id::text AND t.state='REVIEW_REQUIRED' AND v.source_hash=t.file_hash AND public.eva_identity_registration_current(p_org,v.diagnostic->'registration') ORDER BY v.intake_id,v.created_at DESC)q));
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

CREATE FUNCTION public.eva_intake_identity_refs(p_org text,p_sources jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(DISTINCT r.id ORDER BY r.id),'[]') FROM public.eva_intake_identity_reviews r JOIN public.eva_automatic_intakes i ON i.id=r.intake_id AND i.organization_id=r.organization_id
 WHERE r.organization_id=p_org AND r.kind IN('CONTINUE','ADDRESS') AND r.source_hash=i.file_hash AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_sources)s WHERE s->>'id'=i.unit_id AND s->>'documentId'=i.document_id AND s->>'sourceHash'=i.file_hash) AND public.eva_identity_registration_current(p_org,r.diagnostic->'registration');
$$;
CREATE FUNCTION public.eva_intake_identity_lineage(p_org text,p_customer text,p_unit text,p_document text,p_hash text,p_base jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH valid AS(SELECT r.id,r.diagnostic->>'unitCode' code FROM public.eva_intake_identity_reviews r JOIN public.eva_automatic_intakes i ON i.id=r.intake_id AND i.organization_id=r.organization_id WHERE r.organization_id=p_org AND r.customer_id=p_customer AND r.unit_id=p_unit AND r.source_hash=p_hash AND r.kind='CONTINUE' AND i.document_id=p_document AND i.file_hash=p_hash AND i.month=r.month AND i.proof->>'state'='MATCH' AND public.eva_identity_registration_current(p_org,r.diagnostic->'registration'))
 SELECT CASE WHEN p_base IS NULL THEN NULL ELSE p_base||jsonb_build_object('codes',(SELECT coalesce(jsonb_agg(DISTINCT code ORDER BY code),'[]') FROM(SELECT jsonb_array_elements_text(p_base->'codes') code UNION ALL SELECT code FROM valid)x),'reviewIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM valid)) END;
$$;
-- Preserve existing source and portal guards before adding document-bound lineage.
DO $migration$DECLARE ns text;d text;signature text;BEGIN
 FOREACH ns IN ARRAY ARRAY['public','portal_scope'] LOOP
  signature:=ns||'.ocr_identity_native_lineage(text,text,text,text,text)';
  IF to_regprocedure(signature) IS NULL THEN CONTINUE;END IF;
  d:=pg_get_functiondef(to_regprocedure(signature));EXECUTE replace(d,'FUNCTION '||ns||'.ocr_identity_native_lineage(','FUNCTION '||ns||'.ocr_identity_native_lineage_before_triage(');
  EXECUTE format('REVOKE ALL ON FUNCTION %I.ocr_identity_native_lineage_before_triage(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role',ns);
  EXECUTE format('CREATE OR REPLACE FUNCTION %I.ocr_identity_native_lineage(p_org text,p_customer text,p_unit text,p_document text,p_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $wrap$ SELECT public.eva_intake_identity_lineage(p_org,p_customer,p_unit,p_document,p_hash,%I.ocr_identity_native_lineage_before_triage(p_org,p_customer,p_unit,p_document,p_hash)) $wrap$',ns,ns);
 END LOOP;
END$migration$;
DO $migration$DECLARE ns text;d text;BEGIN
 FOREACH ns IN ARRAY ARRAY['public','portal_scope'] LOOP
  IF to_regprocedure(ns||'.ocr_identity_proof_current(text,text,jsonb)') IS NULL THEN CONTINUE;END IF;
  d:=pg_get_functiondef(to_regprocedure(ns||'.ocr_identity_proof_current(text,text,jsonb)'));EXECUTE replace(d,'FUNCTION '||ns||'.ocr_identity_proof_current(','FUNCTION '||ns||'.ocr_identity_proof_current_before_triage(');
  EXECUTE format('REVOKE ALL ON FUNCTION %I.ocr_identity_proof_current_before_triage(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role',ns);
  EXECUTE format($wrap$CREATE OR REPLACE FUNCTION %I.ocr_identity_proof_current(p_org text,p_document text,p_proof jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
  DECLARE d public.documents;reg jsonb;lineage jsonb;BEGIN
   IF NOT(p_proof?'registrationReviewIds') THEN RETURN %I.ocr_identity_proof_current_before_triage(p_org,p_document,p_proof);END IF;
   SELECT * INTO d FROM public.documents WHERE organization_id=p_org AND id=p_document AND file_verified AND document_type='INVOICE_DISTRIBUTOR';IF NOT FOUND THEN RETURN false;END IF;
   reg:=public.invoice_identity_registration(p_org,p_document);lineage:=%I.ocr_identity_native_lineage(p_org,d.customer_id,d.consumer_unit_id,p_document,d.file_hash);
   RETURN coalesce(p_proof->>'version'='invoice-identity-preflight-v1' AND p_proof->>'fileHash'=d.file_hash AND p_proof->>'state'='MATCH'
   AND ((p_proof->'registration')-'auditedUnitNumbers')=reg AND p_proof#>'{registration,auditedUnitNumbers}'=lineage->'codes' AND jsonb_array_length(lineage->'reviewIds')>0
   AND p_proof->'registrationReviewIds'=lineage->'reviewIds' AND coalesce(p_proof->'registrationEditIds','[]')=lineage->'editIds' AND coalesce(p_proof->'registrationAliasIds','[]')=lineage->'aliasIds'
   AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['unit','taxId','address','period'])k WHERE p_proof#>>ARRAY['checks',k] IS DISTINCT FROM 'MATCH'),false);
  END$body$$wrap$,ns,ns,ns);
 END LOOP;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid) WHERE original_oid IN('public.ocr_identity_native_lineage(text,text,text,text,text)'::regprocedure,'public.ocr_identity_proof_current(text,text,jsonb)'::regprocedure);END IF;
END$migration$;
REVOKE ALL ON FUNCTION public.eva_identity_registration_current(text,jsonb),public.eva_intake_identity_work(uuid,uuid,jsonb),public.eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb),public.eva_intake_identity_refs(text,jsonb),public.eva_intake_identity_lineage(text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_identity_work(uuid,uuid,jsonb),public.eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb),public.eva_intake_identity_refs(text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
