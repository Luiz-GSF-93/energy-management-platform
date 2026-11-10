BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- An explicit administrator decision for one invoice, never address normalization.
DO $patch$
DECLARE d text;needle text;replacement text;ns text;
BEGIN
 d:=pg_get_functiondef('public.eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 needle:=$needle$d.diagnostic->>'documentType' IS DISTINCT FROM 'INVOICE_SUPPLIER'$needle$;
 replacement:=$replace$(coalesce(d.diagnostic->>'documentType','') NOT IN('INVOICE_SUPPLIER','INVOICE_DISTRIBUTOR') OR coalesce(d.diagnostic#>>'{fields,2,status}','') NOT IN('MATCH','INCONCLUSIVE') OR (d.diagnostic->>'documentType'='INVOICE_DISTRIBUTOR' AND d.diagnostic#>>'{fields,2,status}' IS DISTINCT FROM 'MATCH'))$replace$;
 IF strpos(d,needle)>0 THEN EXECUTE replace(d,needle,replacement);
 ELSIF strpos(d,replacement)=0 THEN RAISE EXCEPTION 'Review identity decision baseline';END IF;
 FOREACH ns IN ARRAY ARRAY['public','portal_scope'] LOOP
  IF to_regprocedure(ns||'.ocr_identity_proof_current(text,text,jsonb)') IS NULL THEN CONTINUE;END IF;
  d:=pg_get_functiondef(to_regprocedure(ns||'.ocr_identity_proof_current(text,text,jsonb)'));
  needle:=$needle$((p_proof->'registration')-'auditedUnitNumbers')=reg$needle$;
  replacement:=$replace$((p_proof->'registration')-ARRAY['auditedUnitNumbers','auditedAddresses'])=reg
   AND coalesce(p_proof#>'{registration,auditedAddresses}','[]'::jsonb)=coalesce(lineage->'auditedAddresses','[]'::jsonb)$replace$;
  IF strpos(d,needle)>0 THEN EXECUTE replace(d,needle,replacement);
  ELSIF strpos(d,replacement)=0 THEN RAISE EXCEPTION 'Review current invoice proof baseline';END IF;
 END LOOP;
END$patch$;
CREATE OR REPLACE FUNCTION public.eva_intake_identity_lineage(p_org text,p_customer text,p_unit text,p_document text,p_hash text,p_base jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH valid AS(SELECT r.id,r.kind,r.diagnostic->>'unitCode' code,r.diagnostic#>>'{fields,1,found,0}' address FROM public.eva_intake_identity_reviews r JOIN public.eva_automatic_intakes i ON i.id=r.intake_id AND i.organization_id=r.organization_id WHERE r.organization_id=p_org AND r.customer_id=p_customer AND r.unit_id=p_unit AND r.source_hash=p_hash AND (r.kind='CONTINUE' OR r.kind='ADDRESS' AND r.diagnostic->>'documentType'='INVOICE_DISTRIBUTOR' AND r.diagnostic#>>'{fields,2,status}'='MATCH') AND i.document_id=p_document AND i.file_hash=p_hash AND i.month=r.month AND i.proof->>'state'='MATCH' AND public.eva_identity_registration_current(p_org,r.diagnostic->'registration'))
 SELECT CASE WHEN p_base IS NULL THEN NULL ELSE p_base||jsonb_build_object('codes',(SELECT coalesce(jsonb_agg(DISTINCT code ORDER BY code),'[]') FROM(SELECT jsonb_array_elements_text(p_base->'codes') code UNION ALL SELECT code FROM valid WHERE kind='CONTINUE')x),'reviewIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM valid),'auditedAddresses',(SELECT coalesce(jsonb_agg(DISTINCT address ORDER BY address),'[]') FROM valid WHERE kind='ADDRESS')) END;
$$;
DO $signature$BEGIN
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid) WHERE original_oid IN('public.ocr_identity_native_lineage(text,text,text,text,text)'::regprocedure,'public.ocr_identity_proof_current(text,text,jsonb)'::regprocedure);END IF;
END$signature$;
NOTIFY pgrst,'reload schema';
COMMIT;
