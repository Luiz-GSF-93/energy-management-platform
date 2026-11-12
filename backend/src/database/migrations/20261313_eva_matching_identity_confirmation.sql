BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- A low OCR word-confidence review can have four matching identity fields.
-- Allow an explicit, audited attestation for that exact original/registration.
-- Reuse ADDRESS lineage; no customer, UC, source, tax or financial value is edited.
DO $patch$
DECLARE d text;old text;replacement text;matched text:=$condition$(d.diagnostic#>>'{fields,0,status}'='MATCH' AND d.diagnostic#>>'{fields,1,status}'='MATCH' AND d.diagnostic#>>'{fields,2,status}'='MATCH' AND d.diagnostic#>>'{fields,3,status}'='MATCH')$condition$;
BEGIN
 d:=pg_get_functiondef('public.eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 old:=$old$coalesce(d.diagnostic#>>'{fields,1,status}','') NOT IN('MISMATCH','INCONCLUSIVE')$old$;
 replacement:='('||old||' AND NOT '||matched||')';
 IF strpos(d,replacement)>0 THEN NULL;ELSIF strpos(d,old)>0 THEN d:=replace(d,old,replacement);ELSE RAISE EXCEPTION 'Review matching identity evidence baseline';END IF;
 -- The audit label must describe the attestation accurately when nothing differs.
 old:=$old$WHEN 'ADDRESS' THEN 'Endereço confirmado com justificativa'$old$;
 replacement:=$new$WHEN 'ADDRESS' THEN CASE WHEN r.diagnostic#>>'{fields,0,status}'='MATCH' AND r.diagnostic#>>'{fields,1,status}'='MATCH' AND r.diagnostic#>>'{fields,2,status}'='MATCH' AND r.diagnostic#>>'{fields,3,status}'='MATCH' THEN 'Identificação confirmada com justificativa' ELSE 'Endereço confirmado com justificativa' END$new$;
 IF strpos(d,replacement)>0 THEN NULL;ELSIF strpos(d,old)>0 THEN d:=replace(d,old,replacement);ELSE RAISE EXCEPTION 'Review matching identity audit baseline';END IF;
 EXECUTE d;
 d:=pg_get_functiondef('public.eva_intake_continue_requested(uuid,text)'::regprocedure);
 old:=$old$d.diagnostic#>>'{fields,1,status}' IN('MISMATCH','INCONCLUSIVE')$old$;
 replacement:='('||old||' OR '||matched||')';
 IF strpos(d,replacement)>0 THEN NULL;ELSIF strpos(d,old)>0 THEN EXECUTE replace(d,old,replacement);ELSE RAISE EXCEPTION 'Review matching identity continuation baseline';END IF;
END$patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
