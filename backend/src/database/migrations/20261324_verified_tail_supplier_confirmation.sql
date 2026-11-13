-- A later, verified supplier allocation does not change the canonical ACR tail.
-- Only the later run may contain this confirmation; the unknown original stays untouched.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE source text;updated text;
BEGIN
 source:=pg_get_functiondef('public.calculation_preparation_saved_tail_proof(text,uuid)'::regprocedure);
 IF position('supplierInvoiceAllocation' IN source)>0 THEN RETURN;END IF;
 IF position($old$coalesce(n.plan->'manualOverrides','{}')='{}'::jsonb$old$ IN source)=0 THEN RAISE EXCEPTION 'Unexpected receipt proof definition' USING ERRCODE='55000';END IF;
 updated:=replace(source,$old$coalesce(n.plan->'manualOverrides','{}')='{}'::jsonb$old$,$new$(coalesce(n.plan->'manualOverrides','{}')='{}'::jsonb OR (
   jsonb_typeof(n.plan->'manualOverrides')='object' AND (n.plan->'manualOverrides')-'supplierInvoiceAllocation'='{}'::jsonb
   AND n.plan#>>'{manualOverrides,supplierInvoiceAllocation,coverage}'='FULL'
   AND length(btrim(coalesce(n.plan#>>'{manualOverrides,supplierInvoiceAllocation,reason}','')))>=20
   AND EXISTS(SELECT 1 FROM public.documents sd WHERE sd.organization_id=p_org AND sd.customer_id=r.customer_id
    AND (sd.consumer_unit_id=r.consumer_unit_id OR sd.consumer_unit_id IS NULL) AND sd.document_type='INVOICE_SUPPLIER'
    AND to_char(sd.reference_month,'YYYY-MM')=r.month AND sd.file_verified
    AND sd.id=n.plan#>>'{manualOverrides,supplierInvoiceAllocation,documentId}'
    AND sd.file_hash=n.plan#>>'{manualOverrides,supplierInvoiceAllocation,fileHash}')))$new$);
 EXECUTE updated;
END $migration$;
REVOKE ALL ON FUNCTION public.calculation_preparation_saved_tail_proof(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
