BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Confirm receipt of an already archived PDF. Never approve a contract or regenerate a report.
CREATE OR REPLACE FUNCTION public.legal_audit_confirm_review(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' AS $$
DECLARE ctx jsonb;j public.legal_audit_jobs;d public.documents;previous_event bigint;
BEGIN
 ctx:=public.legal_audit_actor(p_org,p_actor,p_role,p_platform,false);
 IF NOT (ctx->'permissions') ? '92e1b670-ab10-483a-b825-c6e16799496d' THEN RAISE EXCEPTION 'Document review permission required' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM public.legal_audit_jobs WHERE id=p_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Analysis unavailable in scope' USING ERRCODE='42501';END IF;
 IF j.state NOT IN('NEEDS_REVIEW','COMPLETED') OR j.report IS NULL OR j.report_hash IS NULL OR j.report_hash !~ '^[a-f0-9]{64}$' OR p_hash IS NULL OR p_hash IS DISTINCT FROM j.source_hash THEN RAISE EXCEPTION 'Completed report and matching original required' USING ERRCODE='40001';END IF;
 SELECT * INTO d FROM public.documents WHERE organization_id=p_org AND id=j.report_document_id;
 IF NOT FOUND OR d.customer_id IS DISTINCT FROM j.customer_id OR d.consumer_unit_id IS DISTINCT FROM j.unit_id OR d.document_type IS DISTINCT FROM 'COMPLIANCE_REPORT' OR d.file_hash IS DISTINCT FROM j.report_hash OR d.file_verified IS DISTINCT FROM true OR d.storage_bucket IS DISTINCT FROM 'energy-documents-private' THEN RAISE EXCEPTION 'Archived report integrity required' USING ERRCODE='40001';END IF;
 SELECT id INTO previous_event FROM public.legal_audit_events WHERE job_id=j.id AND organization_id=p_org AND kind='REPORT_REVIEWED' ORDER BY id LIMIT 1;
 IF previous_event IS NOT NULL THEN RETURN jsonb_build_object('id',j.id,'state',j.state,'reportDocumentId',d.id,'replayed',true);END IF;
 UPDATE public.legal_audit_jobs SET state='COMPLETED',note='Conferência registrada. Relatório de conformidade arquivado em Documentos; ressalvas e recomendações preservadas.',updated_at=clock_timestamp() WHERE id=j.id;
 INSERT INTO public.legal_audit_events(job_id,organization_id,state,kind,body,actor_id) VALUES(j.id,p_org,'COMPLETED','REPORT_REVIEWED',jsonb_build_object('reportDocumentId',d.id,'reportHash',d.file_hash,'sourceHash',j.source_hash,'contractApproved',false,'additionalDocumentCredits',0),p_actor);
 RETURN jsonb_build_object('id',j.id,'state','COMPLETED','reportDocumentId',d.id,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.legal_audit_confirm_review(text,text,text,boolean,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.legal_audit_confirm_review(text,text,text,boolean,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
