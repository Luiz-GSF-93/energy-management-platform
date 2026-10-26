BEGIN;
-- Opt-in queue projection. Default receipt history, audit and quota rules stay unchanged.
DO $$
DECLARE definition text; original text; replacement text; list_start text; list_revision text;
BEGIN
 definition:=pg_get_functiondef('public.eva_intake_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 original:='AND (customer IS NULL OR customer_id=customer) ORDER BY created_at DESC LIMIT 100)s));';
 replacement:='AND (customer IS NULL OR customer_id=customer) AND (p_body->>''queueOnly'' IS DISTINCT FROM ''true'' OR state NOT IN (''AWAITING_SOURCES'',''PROPOSAL_READY'',''SOURCE_READY'',''PUBLISHED'')) ORDER BY created_at DESC LIMIT 100)s));';
 IF position(replacement IN definition)=0 THEN
  IF position(original IN definition)=0 THEN RAISE EXCEPTION 'Intake list definition changed; review migration before applying'; END IF;
  definition:=replace(definition,original,replacement);
 END IF;
 -- Completed work can occur between two polls. Its scoped revision refreshes
 -- the document catalog even when both pending queue responses are empty.
 list_start:='RETURN jsonb_build_object(''rows'',(SELECT';
 list_revision:='RETURN jsonb_build_object(''revision'',(SELECT max(updated_at)::text FROM public.eva_automatic_intakes WHERE organization_id=p_org AND (a->>''external''<>''true'' OR customer_id=customer) AND (customer IS NULL OR customer_id=customer)),''rows'',(SELECT';
 IF position(list_revision IN definition)=0 THEN
  IF position(list_start IN definition)=0 THEN RAISE EXCEPTION 'Intake revision projection changed; review migration'; END IF;
  definition:=replace(definition,list_start,list_revision);
 END IF;
 EXECUTE definition;
END$$;
COMMIT;
