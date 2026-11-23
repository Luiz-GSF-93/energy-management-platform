-- Preserve source-bound supplier address confirmation across audited UC changes.
-- No new access grants, no cross-unit aliasing, no modification to originals.
BEGIN;
CREATE OR REPLACE FUNCTION public.eva_supplier_identity_lineage(p_org text, p_customer text, p_unit text, p_document text, p_hash text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT public.ocr_identity_unit_lineage(p_org,p_customer,p_unit,u.consumer_unit_number)||jsonb_build_object('auditedAddresses',coalesce((
  SELECT jsonb_agg(DISTINCT r.diagnostic#>>'{fields,1,found,0}') FROM public.eva_intake_identity_reviews r JOIN public.eva_automatic_intakes i ON i.id=r.intake_id AND i.organization_id=r.organization_id
  WHERE r.organization_id=p_org AND r.customer_id=p_customer AND r.unit_id=p_unit AND r.source_hash=p_hash AND r.kind='ADDRESS'
   AND i.document_id=p_document AND i.file_hash=p_hash AND i.proof->>'state'='MATCH'
   -- The source-bound address decision survives only a proven UC edit chain.
   -- Every other registered identity field must still match the current unit.
   AND regexp_replace(r.diagnostic#>>'{registration,unitNumber}','[^A-Z0-9]','','gi') IN
    (SELECT jsonb_array_elements_text(public.ocr_identity_unit_lineage(p_org,p_customer,p_unit,u.consumer_unit_number)->'codes'))
   AND public.eva_identity_registration_current(p_org,jsonb_set(r.diagnostic->'registration','{unitNumber}',to_jsonb(u.consumer_unit_number)))
 ),'[]'::jsonb))
 FROM public.documents d JOIN public.consumer_units u ON u.organization_id=d.organization_id AND u.customer_id=d.customer_id AND u.id=d.consumer_unit_id
 WHERE d.organization_id=p_org AND d.customer_id=p_customer AND d.consumer_unit_id=p_unit AND d.id=p_document AND d.file_hash=p_hash AND d.file_verified AND d.document_type='INVOICE_SUPPLIER' AND u.status='ACTIVE'
$function$;
COMMIT;
