BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.platform_sales_evidence_validate_diagnostics(d jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE x jsonb;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid diagnostics' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(d)>4 THEN RAISE EXCEPTION 'Too many diagnostics' USING ERRCODE='22023';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(d) LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR x-ARRAY['scope','code','httpStatus']<>'{}' OR NOT x ?& ARRAY['scope','code']
   OR jsonb_typeof(x->'scope') IS DISTINCT FROM 'string' OR x->>'scope' NOT IN ('PAYMENT','REFUNDS','INVOICES','RECHECK','COLLECTION')
   OR jsonb_typeof(x->'code') IS DISTINCT FROM 'string' OR x->>'code' NOT IN ('QUERY_FAILED','CONFIG_INVALID','TIMEOUT','NETWORK_ERROR','HTTP_ERROR','RESPONSE_LIMIT','JSON_INVALID','PAYMENT_SCHEMA_INVALID','REFUNDS_ENVELOPE_INVALID','REFUNDS_NOT_OBJECT','REFUNDS_DATA_MISSING','REFUNDS_DATA_INVALID','REFUNDS_PAGE_OVERSIZED','REFUNDS_HAS_MORE_MISSING','REFUNDS_HAS_MORE_INVALID','REFUNDS_TOTAL_MISSING','REFUNDS_TOTAL_INVALID','REFUNDS_INTERMEDIATE_INCOMPLETE','REFUNDS_FINAL_TOTAL_MISMATCH','REFUND_ROW_INVALID','INVOICES_ENVELOPE_INVALID','INVOICE_ROW_INVALID','BINDING_MISMATCH','DUPLICATE_ITEMS','HISTORY_TRUNCATED','PAGINATION_CHANGED','COLLECTION_DEADLINE','SOURCE_CHANGED')
   OR x ? 'httpStatus' AND (x->>'code'<>'HTTP_ERROR' OR jsonb_typeof(x->'httpStatus') IS DISTINCT FROM 'number' OR x->>'httpStatus' !~ '^[3-5][0-9]{2}$')
   THEN RAISE EXCEPTION 'Invalid diagnostic item' USING ERRCODE='22023';END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(d))<>(SELECT count(DISTINCT value->>'scope') FROM jsonb_array_elements(d)) THEN RAISE EXCEPTION 'Duplicate diagnostic scope' USING ERRCODE='22023';END IF;
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_evidence_validate_diagnostics(jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
