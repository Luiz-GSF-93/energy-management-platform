-- 20261288 and 20261289 updated both public and private implementations.
-- Acknowledge only those exact changes after verifying the scoped copies.
-- No grants, function bodies, views, customer bindings or financial rows change.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $repair$
DECLARE signature regprocedure;original record;copied record;tracked record;dep record;
 old_source text;expected_old text;expected_copy text;declarations text;changed text[];
 old_mime constant text:=$a$NOT IN('application/pdf','image/png','image/jpeg')$a$;
 new_mime constant text:=$a$NOT IN('application/pdf','image/png','image/jpeg','application/xml')$a$;
 old_extension constant text:=$a$CASE i.mime WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' ELSE '.jpg' END$a$;
 new_extension constant text:=$a$CASE i.mime WHEN 'application/xml' THEN '.xml' WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' ELSE '.jpg' END$a$;
 old_ocr constant text:=$a$IF i.document_type='INVOICE_DISTRIBUTOR' AND i.raw_result IS NOT NULL THEN$a$;
 new_ocr constant text:=$a$IF i.document_type='INVOICE_DISTRIBUTOR' AND i.raw_result IS NOT NULL AND i.mime<>'application/xml' THEN$a$;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-runtime-xml-conflicts-20261307',0));
 SELECT array_agg(r.original_name ORDER BY r.original_name) INTO changed
 FROM portal_scope.routines r WHERE r.source_hash IS DISTINCT FROM portal_scope.function_signature(r.original_oid);
 IF changed IS NOT NULL AND changed IS DISTINCT FROM ARRAY['eva_intake_action','transition_eva_automatic_intake'] THEN
  RAISE EXCEPTION 'Unexpected portal runtime changes; XML/conflict-only repair required' USING ERRCODE='55000';
 END IF;
 FOREACH signature IN ARRAY ARRAY[
  'public.eva_intake_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure,
  'public.transition_eva_automatic_intake(uuid,uuid,text,jsonb)'::regprocedure
 ] LOOP
  SELECT * INTO STRICT original FROM pg_proc WHERE oid=signature;
  SELECT * INTO STRICT tracked FROM portal_scope.routines WHERE original_oid=original.oid FOR UPDATE;
  old_source:=original.prosrc;
  IF original.proname='eva_intake_action' THEN
   IF (length(old_source)-length(replace(old_source,new_mime,'')))/length(new_mime)<>1 THEN
    RAISE EXCEPTION 'Reviewed XML admission marker missing' USING ERRCODE='55000';
   END IF;
   old_source:=replace(old_source,new_mime,old_mime);
  ELSE
   IF (length(old_source)-length(replace(old_source,new_extension,'')))/length(new_extension)<>1
    OR (length(old_source)-length(replace(old_source,new_ocr,'')))/length(new_ocr)<>1 THEN
    RAISE EXCEPTION 'Reviewed XML transition markers missing' USING ERRCODE='55000';
   END IF;
   old_source:=replace(replace(old_source,new_extension,old_extension),new_ocr,old_ocr);
  END IF;
  old_source:=replace(replace(old_source,$a$ERRCODE='PT409'$a$,$a$ERRCODE='40001'$a$),$a$SQLSTATE '40001' OR SQLSTATE 'PT409'$a$,$a$SQLSTATE '40001'$a$);
  expected_old:=md5(jsonb_build_array(old_source,original.proargtypes::text,original.proallargtypes,original.prorettype,original.proargnames,original.proargmodes,original.pronargdefaults,original.proargdefaults::text,original.prosecdef,original.proconfig,original.provolatile,original.prokind)::text);
  IF tracked.source_hash IS DISTINCT FROM expected_old AND tracked.source_hash IS DISTINCT FROM portal_scope.function_signature(original.oid) THEN
   RAISE EXCEPTION 'Intake source contains another unreviewed change' USING ERRCODE='55000';
  END IF;
  SELECT p.* INTO copied FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='portal_scope' AND p.proname=original.proname AND p.proargtypes=original.proargtypes;
  IF copied.oid IS NULL OR copied.prosecdef IS DISTINCT FROM original.prosecdef
   OR copied.proconfig IS DISTINCT FROM original.proconfig OR copied.provolatile IS DISTINCT FROM original.provolatile
   OR copied.prolang IS DISTINCT FROM original.prolang OR copied.prorettype IS DISTINCT FROM original.prorettype
   OR copied.proallargtypes IS DISTINCT FROM original.proallargtypes OR copied.proargnames IS DISTINCT FROM original.proargnames
   OR copied.proargmodes IS DISTINCT FROM original.proargmodes OR copied.pronargdefaults IS DISTINCT FROM original.pronargdefaults
   OR copied.proargdefaults::text IS DISTINCT FROM original.proargdefaults::text THEN
   RAISE EXCEPTION 'Scoped intake routine metadata differs' USING ERRCODE='55000';
  END IF;
  expected_copy:=original.prosrc;
  FOR dep IN SELECT DISTINCT original_name AS name FROM portal_scope.routines LOOP
   expected_copy:=regexp_replace(expected_copy,'public[.]'||dep.name||'([[:space:]]*[(])','portal_scope.'||dep.name||'\1','g');
  END LOOP;
  FOR dep IN SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='portal_scope' AND c.relkind='v' LOOP
   expected_copy:=regexp_replace(expected_copy,'public[.]'||dep.name||'([[:space:];,%)]|$)','portal_scope.'||dep.name||'\1','g');
  END LOOP;
  declarations:=left(expected_copy,greatest(strpos(expected_copy,'BEGIN')-1,0));
  FOR dep IN SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='portal_scope' AND c.relkind='v' LOOP
   declarations:=replace(declarations,'portal_scope.'||dep.name,'public.'||dep.name);
   expected_copy:=replace(expected_copy,'::portal_scope.'||dep.name,'::public.'||dep.name);
  END LOOP;
  IF declarations<>'' THEN expected_copy:=declarations||substr(expected_copy,strpos(expected_copy,'BEGIN'));END IF;
  IF replace(copied.prosrc,E'\r','') IS DISTINCT FROM replace(expected_copy,E'\r','') THEN
   RAISE EXCEPTION 'Private intake copy differs from reviewed scoped source' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM aclexplode(coalesce(copied.proacl,acldefault('f',copied.proowner))) a
   WHERE a.grantee=0 OR a.grantee IN(SELECT oid FROM pg_roles WHERE rolname IN('anon','authenticated','service_role'))) THEN
   RAISE EXCEPTION 'Private intake routine unexpectedly callable' USING ERRCODE='55000';
  END IF;
  UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original.oid)
  WHERE original_oid=original.oid AND source_hash=expected_old;
 END LOOP;
 IF EXISTS(SELECT 1 FROM portal_scope.routines r WHERE r.source_hash IS DISTINCT FROM portal_scope.function_signature(r.original_oid)) THEN
  RAISE EXCEPTION 'Portal runtime still has unreviewed changes' USING ERRCODE='55000';
 END IF;
END $repair$;
NOTIFY pgrst,'reload schema';
COMMIT;
