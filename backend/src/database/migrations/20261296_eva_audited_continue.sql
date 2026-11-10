BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Reuse the existing permission-checked alias registration after explicit UC confirmation.
-- The original diagnostic, tax identity and financial approval rules remain unchanged.
DO $patch$
DECLARE definition text;needle text;addition text;
BEGIN
 definition:=pg_get_functiondef('public.eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 needle:=$needle$  INSERT INTO public.eva_intake_identity_reviews(organization_id,intake_id,fingerprint,source_hash,customer_id,unit_id,month,kind,diagnostic,reason,actor_id) VALUES(p_org,i.id,d.fingerprint,d.source_hash,d.customer_id,d.unit_id,d.month,decision,d.diagnostic,btrim(p_body->>'reason'),p_actor) RETURNING id INTO item;$needle$;
 addition:=$addition$  IF decision='CONTINUE' AND i.raw_result->>'content' IS NOT NULL AND EXISTS(SELECT 1 FROM public.roles WHERE id::text=p_role AND organization_id=p_org AND name IN('admin_org','gestor') AND permissions @> '["0f2e539d-03f9-4168-bc8c-55ac3a371628"]'::jsonb) THEN
   IF EXISTS(SELECT 1 FROM public.eva_intake_unit_aliases_audit h WHERE h.organization_id=p_org AND h.previous_code=d.diagnostic->>'unitCode' AND (h.customer_id<>d.customer_id OR h.unit_id<>d.unit_id OR h.current_code<>regexp_replace(d.diagnostic#>>'{registration,unitNumber}','[^0-9]','','g'))) THEN RAISE EXCEPTION 'Historical installation conflict' USING ERRCODE='40001';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.eva_intake_unit_aliases_audit h WHERE h.organization_id=p_org AND h.previous_code=d.diagnostic->>'unitCode') THEN
    PERFORM public.register_eva_intake_unit_alias(p_org,p_actor,p_role,i.id,d.diagnostic->>'unitCode',i.file_hash,btrim(p_body->>'reason'));
   END IF;
  END IF;
$addition$;
 IF strpos(definition,'Historical installation conflict')=0 THEN
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Identity continuation baseline changed';END IF;
  EXECUTE replace(definition,needle,addition||needle);
 END IF;
END$patch$;
-- Address decisions are document-bound: a shared fiscal address must never link
-- every future invoice to this installation or erase the full recipient CNPJ.
CREATE OR REPLACE FUNCTION public.eva_supplier_identity_lineage(p_org text,p_customer text,p_unit text,p_document text,p_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.ocr_identity_unit_lineage(p_org,p_customer,p_unit,u.consumer_unit_number)||jsonb_build_object('auditedAddresses',coalesce((
  SELECT jsonb_agg(DISTINCT r.diagnostic#>>'{fields,1,found,0}') FROM public.eva_intake_identity_reviews r JOIN public.eva_automatic_intakes i ON i.id=r.intake_id AND i.organization_id=r.organization_id
  WHERE r.organization_id=p_org AND r.customer_id=p_customer AND r.unit_id=p_unit AND r.source_hash=p_hash AND r.kind='ADDRESS'
   AND i.document_id=p_document AND i.file_hash=p_hash AND i.proof->>'state'='MATCH'
   AND public.eva_identity_registration_current(p_org,r.diagnostic->'registration')
 ),'[]'::jsonb))
 FROM public.documents d JOIN public.consumer_units u ON u.organization_id=d.organization_id AND u.customer_id=d.customer_id AND u.id=d.consumer_unit_id
 WHERE d.organization_id=p_org AND d.customer_id=p_customer AND d.consumer_unit_id=p_unit AND d.id=p_document AND d.file_hash=p_hash AND d.file_verified AND d.document_type='INVOICE_SUPPLIER' AND u.status='ACTIVE'
$$;
REVOKE ALL ON FUNCTION public.eva_supplier_identity_lineage(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_supplier_identity_lineage(text,text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
