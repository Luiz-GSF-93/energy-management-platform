BEGIN;
-- Opt-in queue projection. Default receipt history, audit and quota rules stay unchanged.
DO $$
DECLARE definition text; original text; replacement text;
BEGIN
 definition:=pg_get_functiondef('public.eva_intake_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 original:='AND (customer IS NULL OR customer_id=customer) ORDER BY created_at DESC LIMIT 100)s));';
 replacement:='AND (customer IS NULL OR customer_id=customer) AND (p_body->>''queueOnly'' IS DISTINCT FROM ''true'' OR state NOT IN (''AWAITING_SOURCES'',''PROPOSAL_READY'',''SOURCE_READY'',''PUBLISHED'')) ORDER BY created_at DESC LIMIT 100)s));';
 IF position(replacement IN definition)>0 THEN RETURN; END IF;
 IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Intake list definition changed; review migration before applying'; END IF;
 EXECUTE replace(definition,original,replacement);
END$$;
COMMIT;
