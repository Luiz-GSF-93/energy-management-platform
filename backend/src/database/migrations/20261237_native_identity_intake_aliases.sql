BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.ocr_identity_native_lineage(p_org text,p_customer text,p_unit text,p_document text,p_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.ocr_identity_unit_lineage(p_org,p_customer,p_unit,u.consumer_unit_number)
 FROM public.documents d JOIN public.consumer_units u ON u.organization_id=d.organization_id AND u.customer_id=d.customer_id AND u.id=d.consumer_unit_id
 JOIN public.customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
 WHERE d.organization_id=p_org AND d.customer_id=p_customer AND d.consumer_unit_id=p_unit AND d.id=p_document AND d.file_hash=p_hash AND d.file_verified AND d.document_type='INVOICE_DISTRIBUTOR' AND upper(u.status)='ACTIVE' AND upper(c.status)='ACTIVE' AND c.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.ocr_identity_native_lineage(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ocr_identity_native_lineage(text,text,text,text,text) TO service_role;
-- Apply the same previously approved, immutable alias evidence to the first
-- native preflight as to the automatic intake's source inspection.
CREATE OR REPLACE FUNCTION public.ocr_identity_proof_current(p_org text,p_document text,p_proof jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.documents;reg jsonb;lineage jsonb;
BEGIN
 SELECT * INTO d FROM public.documents WHERE organization_id=p_org AND id=p_document AND file_verified AND document_type='INVOICE_DISTRIBUTOR';
 IF NOT FOUND OR p_proof IS NULL OR jsonb_typeof(p_proof)<>'object' OR p_proof->>'version' IS DISTINCT FROM 'invoice-identity-preflight-v1' OR p_proof->>'fileHash' IS DISTINCT FROM d.file_hash THEN RETURN false;END IF;
 reg:=public.invoice_identity_registration(p_org,p_document);
 IF reg IS NULL THEN RETURN false;END IF;
 IF NOT (p_proof ? 'registrationEditIds') AND NOT (p_proof ? 'registrationAliasIds') AND NOT ((p_proof->'registration') ? 'auditedUnitNumbers') THEN RETURN coalesce(p_proof->'registration'=reg,false);END IF;
 IF ((p_proof->'registration')-'auditedUnitNumbers') IS DISTINCT FROM reg OR p_proof->>'state' IS DISTINCT FROM 'MATCH' OR EXISTS(SELECT 1 FROM unnest(ARRAY['unit','taxId','address','period']) k WHERE p_proof#>>ARRAY['checks',k] IS DISTINCT FROM 'MATCH') THEN RETURN false;END IF;
 lineage:=public.ocr_identity_unit_lineage(p_org,d.customer_id,d.consumer_unit_id,reg->>'unitNumber');
 RETURN coalesce((jsonb_array_length(lineage->'editIds')>0 OR jsonb_array_length(lineage->'aliasIds')>0)
  AND coalesce(p_proof->'registrationEditIds','[]'::jsonb)=coalesce(lineage->'editIds','[]'::jsonb)
  AND coalesce(p_proof->'registrationAliasIds','[]'::jsonb)=coalesce(lineage->'aliasIds','[]'::jsonb)
  AND p_proof#>'{registration,auditedUnitNumbers}'=lineage->'codes',false);
END$$;
-- Keep all actor, quota, source, pre-submission and acknowledgement guards of
-- the existing audited recovery. Only its evidence projection is corrected.
DO $$DECLARE d text;old text;replacement text;BEGIN
 d:=pg_get_functiondef('public.ocr_identity_resume_action(text,text,text,text,boolean,text,uuid,text,jsonb)'::regprocedure);
 old:=$old$AND jsonb_array_length(lineage->'editIds')>0;$old$;
 replacement:=$new$AND (jsonb_array_length(lineage->'editIds')>0 OR jsonb_array_length(lineage->'aliasIds')>0);$new$;
 IF position(old IN d)=0 THEN RAISE EXCEPTION 'Review identity resume evidence baseline';END IF;
 d:=replace(d,old,replacement);
 old:=$old$p_proof->'registrationEditIds'=lineage->'editIds' AND p_proof#>'{registration,auditedUnitNumbers}'=lineage->'codes' AND public.ocr_identity_proof_current(p_org,p_document,p_proof)$old$;
 IF position(old IN d)=0 THEN RAISE EXCEPTION 'Review identity resume proof baseline';END IF;
 d:=replace(d,old,'public.ocr_identity_proof_current(p_org,p_document,p_proof)');
 EXECUTE d;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
