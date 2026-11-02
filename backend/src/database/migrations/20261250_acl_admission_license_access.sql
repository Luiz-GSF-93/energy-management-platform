-- Preserve actor/customer/workflow guards; add the contracted capability at the license boundary.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $$DECLARE fn regprocedure;body text;marker text:='AND free_market_management IS TRUE';BEGIN
 FOREACH fn IN ARRAY ARRAY['public.acl_assert_actor(text,text,text,boolean,boolean,text)'::regprocedure,'public.acl_portal(text,text,text,uuid)'::regprocedure] LOOP
 body:=pg_get_functiondef(fn);
 IF (length(body)-length(replace(body,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'ACL license source changed: %',fn;END IF;
 EXECUTE replace(body,marker,marker||' AND acl_admissions IS TRUE');
 END LOOP;
 IF to_regprocedure('public.validate_platform_sales_extras(jsonb)') IS NOT NULL THEN
 body:=pg_get_functiondef('public.validate_platform_sales_extras(jsonb)'::regprocedure);
 IF strpos(body,'''ccee_registrations''')=0 THEN RAISE EXCEPTION 'Commercial module source changed';END IF;
 EXECUTE replace(body,'''ccee_registrations''','''ccee_registrations'',''acl_admissions''');
 END IF;
 IF to_regprocedure('public.create_platform_sales_proposal(uuid,uuid,uuid,uuid,integer,text,jsonb,text)') IS NOT NULL THEN
 body:=pg_get_functiondef('public.create_platform_sales_proposal(uuid,uuid,uuid,uuid,integer,text,jsonb,text)'::regprocedure);
 IF strpos(body,'''ccee_registrations''] LOOP')=0 THEN RAISE EXCEPTION 'Commercial composition source changed';END IF;
 body:=replace(body,'''ccee_registrations''] LOOP','''ccee_registrations'',''acl_admissions''] LOOP');
 EXECUTE body;
 END IF;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
