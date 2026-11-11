BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- An operator may confirm an already matching supplier address when the NF
-- prints no UC. This attests the selected installation only, not its amounts.
DO $patch$
DECLARE d text;old text;replacement text;optional_supplier text:=$condition$(d.diagnostic->>'documentType'='INVOICE_SUPPLIER' AND d.diagnostic#>>'{fields,1,status}'='MATCH' AND d.diagnostic#>>'{fields,2,status}'='INCONCLUSIVE' AND d.diagnostic#>'{fields,2,found}'='[]'::jsonb)$condition$;
BEGIN
 d:=pg_get_functiondef('public.eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 old:=$old$coalesce(d.diagnostic#>>'{fields,1,status}','') NOT IN('MISMATCH','INCONCLUSIVE')$old$;
 replacement:='('||old||' AND NOT '||optional_supplier||')';
 IF strpos(d,replacement)>0 THEN NULL;ELSIF strpos(d,old)>0 THEN EXECUTE replace(d,old,replacement);ELSE RAISE EXCEPTION 'Review optional supplier UC evidence baseline';END IF;
 d:=pg_get_functiondef('public.eva_intake_continue_requested(uuid,text)'::regprocedure);
 old:=$old$d.diagnostic#>>'{fields,1,status}' IN('MISMATCH','INCONCLUSIVE')$old$;
 replacement:='('||old||' OR '||optional_supplier||')';
 IF strpos(d,replacement)>0 THEN NULL;ELSIF strpos(d,old)>0 THEN EXECUTE replace(d,old,replacement);ELSE RAISE EXCEPTION 'Review optional supplier UC continuation baseline';END IF;
END$patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
