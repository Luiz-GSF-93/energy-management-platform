BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Read-only tracking: a completed report is not a financial approval. Never
-- rewrite an uncertain execution or replay OCR to recover its visible receipt.
CREATE OR REPLACE FUNCTION public.eva_intake_prepared_completions(p_org text,p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF p_org IS NULL OR length(btrim(p_org))=0 OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM unnest(p_ids)x WHERE x IS NULL) OR (SELECT count(DISTINCT x) FROM unnest(p_ids)x)<>cardinality(p_ids) THEN RAISE EXCEPTION 'Invalid tracking scope' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'closingId',v.id,'preparedAt',v.created_at,'stage',e.state,'eligible',v.report->'approvalEligible','missing',coalesce(v.report->'missing','[]'::jsonb),'reason',CASE WHEN e.state='REJECTED' THEN e.note END) ORDER BY i.id),'[]') INTO result
 FROM public.eva_automatic_intakes i
 JOIN public.documents d ON d.organization_id=i.organization_id AND d.id=i.document_id AND d.customer_id=i.customer_id AND d.consumer_unit_id=i.unit_id AND to_char(d.reference_month,'YYYY-MM')=i.month AND d.file_verified AND d.file_hash=i.file_hash AND d.document_type='INVOICE_DISTRIBUTOR'
 JOIN public.customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 JOIN public.consumer_units u ON u.organization_id=i.organization_id AND u.id=i.unit_id AND u.customer_id=i.customer_id AND u.status='ACTIVE'
 JOIN LATERAL(SELECT r.* FROM public.eva_assisted_closing_versions r WHERE r.organization_id=i.organization_id AND r.customer_id=i.customer_id AND r.month=i.month AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.report->'units')x WHERE x->>'id'=i.unit_id) ORDER BY r.version DESC,r.created_at DESC,r.id DESC LIMIT 1)v ON true
 JOIN LATERAL(SELECT a.state,a.note FROM public.eva_assisted_closing_events a WHERE a.organization_id=i.organization_id AND a.closing_id=v.id ORDER BY a.sequence DESC LIMIT 1)e ON true
 WHERE i.organization_id=p_org AND i.id=ANY(p_ids) AND i.state='UNKNOWN' AND i.lease_token IS NULL AND i.document_type='INVOICE_DISTRIBUTOR'
 AND e.state IN('READY_FOR_REVIEW','INCOMPLETE','REJECTED','APPROVED')
 AND (SELECT count(*) FROM jsonb_array_elements(v.report->'units')x WHERE x->>'id'=i.unit_id)=1
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units')x WHERE x->>'id'=i.unit_id AND x->>'documentId'=i.document_id::text AND x->>'sourceHash'=i.file_hash)
 AND NOT EXISTS(SELECT 1 FROM public.eva_manual_preparations m WHERE m.organization_id=i.organization_id AND m.customer_id=i.customer_id AND m.month=i.month AND (m.consumer_unit_id=i.unit_id OR m.scope_kind='CUSTOMER') AND m.state IN('QUEUED','RUNNING'));
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_prepared_completions(text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_intake_prepared_completions(text,uuid[]) TO service_role;
CREATE OR REPLACE FUNCTION public.eva_closing_event_authors(p_org text,p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_org IS NULL OR length(btrim(p_org))=0 OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Invalid author scope' USING ERRCODE='22023';END IF;
 RETURN(SELECT coalesce(jsonb_agg(jsonb_build_object('closingId',e.closing_id,'sequence',e.sequence,'actorId',e.actor_id,'actorName',u.name)),'[]') FROM public.eva_assisted_closing_events e JOIN public.eva_assisted_closing_versions v ON v.organization_id=e.organization_id AND v.id=e.closing_id LEFT JOIN public.users u ON u.auth_user_id::text=e.actor_id::text WHERE e.organization_id=p_org AND v.id=ANY(p_ids));
END$$;
REVOKE ALL ON FUNCTION public.eva_closing_event_authors(text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_closing_event_authors(text,uuid[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
