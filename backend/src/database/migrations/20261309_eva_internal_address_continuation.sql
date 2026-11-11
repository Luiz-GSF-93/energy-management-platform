BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- One printed address, preserving the original and every installation digit.
CREATE OR REPLACE FUNCTION public.eva_identity_single_address(p_found jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(p_found)='array' THEN
  jsonb_array_length(p_found)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_found) v WHERE jsonb_typeof(v)<>'string' OR length(v#>>'{}')<12)
  AND (SELECT count(DISTINCT regexp_replace(upper(v),'[^A-Z0-9]','','g'))=1 FROM jsonb_array_elements_text(p_found) v)
 ELSE false END;
$$;
REVOKE ALL ON FUNCTION public.eva_identity_single_address(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_identity_single_address(jsonb) TO service_role;
DO $patch$
DECLARE d text;old text;replacement text;
BEGIN
 d:=pg_get_functiondef('public.eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 old:=$old$name='admin_org'$old$;replacement:=$new$name IN('admin_org','gestor','operacional')$new$;
 IF strpos(d,old)>0 THEN d:=replace(d,old,replacement);ELSIF strpos(d,replacement)=0 THEN RAISE EXCEPTION 'Review address role baseline';END IF;
 old:=$old$d.diagnostic#>>'{fields,1,status}' IS DISTINCT FROM 'MISMATCH' OR jsonb_array_length(d.diagnostic#>'{fields,1,found}')<>1$old$;
 replacement:=$new$coalesce(d.diagnostic#>>'{fields,1,status}','') NOT IN('MISMATCH','INCONCLUSIVE') OR NOT public.eva_identity_single_address(d.diagnostic#>'{fields,1,found}')$new$;
 IF strpos(d,old)>0 THEN d:=replace(d,old,replacement);ELSIF strpos(d,replacement)=0 THEN RAISE EXCEPTION 'Review address evidence baseline';END IF;
 d:=replace(d,'Specific administrator address evidence required','Specific internal address evidence required');
 d:=replace(d,'Endereço confirmado pelo administrador','Endereço confirmado com justificativa');EXECUTE d;
 d:=pg_get_functiondef('public.eva_intake_continue_requested(uuid,text)'::regprocedure);
 old:=$old$role_name='admin_org'$old$;replacement:=$new$role_name IN('admin_org','gestor','operacional')$new$;
 IF strpos(d,old)>0 THEN d:=replace(d,old,replacement);ELSIF strpos(d,replacement)=0 THEN RAISE EXCEPTION 'Review requested role baseline';END IF;
 old:=$old$d.diagnostic#>>'{fields,1,status}'='MISMATCH'
  AND jsonb_array_length(d.diagnostic#>'{fields,1,found}')=1 AND length(d.diagnostic#>>'{fields,1,found,0}')>=12$old$;
 replacement:=$new$d.diagnostic#>>'{fields,1,status}' IN('MISMATCH','INCONCLUSIVE')
  AND public.eva_identity_single_address(d.diagnostic#>'{fields,1,found}')$new$;
 IF strpos(d,old)>0 THEN d:=replace(d,old,replacement);ELSIF strpos(d,replacement)=0 THEN RAISE EXCEPTION 'Review requested evidence baseline';END IF;EXECUTE d;
END$patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
