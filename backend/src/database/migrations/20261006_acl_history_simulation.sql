BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.acl_history_simulation_source(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_evidence uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e public.acl_admission_evidence; result jsonb;
BEGIN
 PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,false,false);
 SELECT * INTO e FROM public.acl_admission_evidence WHERE organization_id=p_org AND admission_id=p_id AND id=p_evidence AND stage_key='invoices' AND kind='COMPLETE';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.acl_admission_evidence_reviews WHERE organization_id=p_org AND evidence_id=e.id AND decision='APPROVED') THEN RAISE EXCEPTION 'Approved history unavailable' USING ERRCODE='22023';END IF;
 PERFORM public.acl_check_evidence_sources(p_org,e.id);
 PERFORM public.acl_validate_invoice_history(e.facts,ARRAY[(e.facts->'history'->>'sourceDocumentId')],(SELECT reference_month FROM public.acl_admission_evidence_documents WHERE organization_id=p_org AND evidence_id=e.id AND document_id=e.facts->'history'->>'sourceDocumentId'));
 SELECT jsonb_build_object('evidenceId',e.id,'history',e.facts->'history','documents',jsonb_agg(jsonb_build_object('id',d.document_id,'fileHash',d.file_hash,'version',d.catalog_version))) INTO result FROM public.acl_admission_evidence_documents d WHERE d.organization_id=p_org AND d.evidence_id=e.id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.acl_history_simulation_source(text,text,text,boolean,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_history_simulation_source(text,text,text,boolean,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
