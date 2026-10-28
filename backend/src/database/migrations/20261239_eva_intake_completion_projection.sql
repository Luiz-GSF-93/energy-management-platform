BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.eva_intake_published_completions(p_org text,p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF p_org IS NULL OR length(btrim(p_org))=0 OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM unnest(p_ids)x WHERE x IS NULL) OR (SELECT count(DISTINCT x) FROM unnest(p_ids)x)<>cardinality(p_ids) THEN RAISE EXCEPTION 'Invalid completion scope' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'closingId',v.id,'publicationId',p.id,'publishedAt',p.created_at) ORDER BY i.id),'[]') INTO result
 FROM public.eva_automatic_intakes i
 JOIN public.documents d ON d.organization_id=i.organization_id AND d.id=i.document_id AND d.customer_id=i.customer_id AND d.consumer_unit_id=i.unit_id AND d.file_verified AND d.file_hash=i.file_hash AND d.document_type='INVOICE_DISTRIBUTOR'
 JOIN public.customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 JOIN public.consumer_units u ON u.organization_id=i.organization_id AND u.id=i.unit_id AND u.customer_id=i.customer_id AND u.status='ACTIVE'
 JOIN public.eva_assisted_closing_versions v ON v.organization_id=i.organization_id AND v.customer_id=i.customer_id AND v.month=i.month
 JOIN public.eva_closing_publications p ON p.organization_id=v.organization_id AND p.customer_id=v.customer_id AND p.closing_id=v.id AND p.source_hash=v.payload_hash
 JOIN public.eva_assisted_closing_events a ON a.id=p.approval_event_id AND a.organization_id=v.organization_id AND a.closing_id=v.id AND a.state='APPROVED'
 WHERE i.organization_id=p_org AND i.id=ANY(p_ids) AND i.document_type='INVOICE_DISTRIBUTOR' AND i.document_id IS NOT NULL AND i.lease_token IS NULL AND i.state IN('UNKNOWN','AWAITING_SOURCES','PROPOSAL_READY')
 AND a.id=(SELECT e.id FROM public.eva_assisted_closing_events e WHERE e.organization_id=v.organization_id AND e.closing_id=v.id ORDER BY e.sequence DESC LIMIT 1)
 AND (SELECT e.state FROM public.eva_closing_publication_events e WHERE e.organization_id=p.organization_id AND e.publication_id=p.id ORDER BY e.sequence DESC LIMIT 1)='PUBLISHED'
 AND (SELECT count(*) FROM jsonb_array_elements(v.report->'units')x WHERE x->>'id'=i.unit_id)=1
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units')x WHERE x->>'id'=i.unit_id AND x->>'documentId'=i.document_id::text AND x->>'sourceHash'=i.file_hash)
 AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions newer WHERE newer.organization_id=v.organization_id AND newer.customer_id=v.customer_id AND newer.month=v.month AND newer.version>v.version AND (SELECT e.state FROM public.eva_assisted_closing_events e WHERE e.organization_id=newer.organization_id AND e.closing_id=newer.id ORDER BY e.sequence DESC LIMIT 1)='APPROVED');
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_published_completions(text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_intake_published_completions(text,uuid[]) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
