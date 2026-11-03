BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- The approved batch is 30 requests in total: at most 24 registrations and 6 financial reads.
-- Preserve functions, grants and existing receipts; reduce only the registration sub-budget.
DO $migration$
DECLARE signature text; source text; before_source text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'public.ccee_customer_discovery_control(text,text,boolean,text,uuid)',
 'public.ccee_customer_discovery_read(text,text,integer)',
 'public.ccee_customer_discovery_claim()',
 'public.ccee_customer_discovery_reserve(uuid,uuid)',
 'public.ccee_customer_discovery_finish(uuid,uuid,jsonb,text)'] LOOP
  source:=pg_get_functiondef(signature::regprocedure); before_source:=source;
  source:=replace(source,'''homologationLimit'',30','''homologationLimit'',24');
  source:=replace(source,'>=30','>=24');
  IF source=before_source THEN RAISE EXCEPTION 'Registration batch source changed: %',signature; END IF;
  IF signature='public.ccee_customer_discovery_read(text,text,integer)' THEN
   source:=replace(source,'''policy'',coalesce(policy,jsonb_build_object(''enabled'',false,''homologationLimit'',24))','''policy'',coalesce(policy,jsonb_build_object(''enabled'',false))||jsonb_build_object(''homologationLimit'',24)');
  END IF;
  EXECUTE source;
 END LOOP;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
