-- Complete the scoped-runtime compatibility of the already approved Adesão ACL license requirement.
-- Never acknowledge an unreviewed source change, remove isolation or refresh unrelated routine hashes.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $repair$
DECLARE signature regprocedure;original record;copied record;tracked record;dep record;
 marker constant text:='AND free_market_management IS TRUE';
 upgraded constant text:='AND free_market_management IS TRUE AND acl_admissions IS TRUE';
 expected_old text;expected_copy text;declarations text;definition text;view_definition text;changed text[];repaired integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-runtime-acl-20261254',0));
 SELECT array_agg(r.original_name ORDER BY r.original_name) INTO changed FROM portal_scope.routines r WHERE r.source_hash IS DISTINCT FROM portal_scope.function_signature(r.original_oid);
 IF changed IS DISTINCT FROM ARRAY['acl_assert_actor','acl_portal'] THEN RAISE EXCEPTION 'Unexpected portal runtime changes; reviewed ACL-only repair required' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.licenses'::regclass AND attname='acl_admissions' AND atttypid='boolean'::regtype AND NOT attisdropped) THEN RAISE EXCEPTION 'Approved ACL license column missing';END IF;
 -- Extend the existing private projection; preserve its exact row predicate and all earlier expressions.
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='portal_scope.licenses'::regclass AND attname='acl_admissions' AND NOT attisdropped) THEN
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='portal_scope.licenses'::regclass AND relkind='v' AND reloptions @> ARRAY['security_barrier=true','check_option=local']) THEN RAISE EXCEPTION 'Scoped license view protection changed';END IF;
  view_definition:=pg_get_viewdef('portal_scope.licenses'::regclass,true);
  IF (SELECT count(*) FROM regexp_matches(view_definition,'[[:space:]]FROM[[:space:]]+public[.]licenses[[:space:]]+x([[:space:]]|$)','g'))<>1 OR position('portal_scope.row_allowed' in view_definition)=0 THEN RAISE EXCEPTION 'Scoped license projection changed';END IF;
  view_definition:=regexp_replace(view_definition,'([[:space:]]FROM[[:space:]]+public[.]licenses[[:space:]]+x([[:space:]]|$))',', x.acl_admissions AS acl_admissions\1');
  EXECUTE 'CREATE OR REPLACE VIEW portal_scope.licenses WITH (security_barrier=true) AS '||rtrim(view_definition,E'; \n\r')||' WITH LOCAL CHECK OPTION';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='portal_scope.licenses'::regclass AND attname='acl_admissions' AND atttypid='boolean'::regtype AND NOT attisdropped) THEN RAISE EXCEPTION 'Scoped ACL capability projection unavailable';END IF;
 REVOKE ALL ON portal_scope.licenses FROM PUBLIC,anon,authenticated,service_role;
 FOREACH signature IN ARRAY ARRAY['public.acl_assert_actor(text,text,text,boolean,boolean,text)'::regprocedure,'public.acl_portal(text,text,text,uuid)'::regprocedure] LOOP
  SELECT * INTO original FROM pg_proc WHERE oid=signature;
  SELECT * INTO STRICT tracked FROM portal_scope.routines WHERE original_oid=original.oid;
  IF (length(original.prosrc)-length(replace(original.prosrc,upgraded,'')))/length(upgraded)<>1 THEN RAISE EXCEPTION 'ACL source differs from approved license-only change';END IF;
  expected_old:=md5(jsonb_build_array(replace(original.prosrc,upgraded,marker),original.proargtypes::text,original.proallargtypes,original.prorettype,original.proargnames,original.proargmodes,original.pronargdefaults,original.proargdefaults::text,original.prosecdef,original.proconfig,original.provolatile,original.prokind)::text);
  IF tracked.source_hash IS DISTINCT FROM expected_old THEN RAISE EXCEPTION 'ACL source contains another unreviewed change' USING ERRCODE='55000';END IF;
  SELECT p.* INTO copied FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='portal_scope' AND p.proname=original.proname AND p.proargtypes=original.proargtypes;
  IF copied.oid IS NULL OR copied.prosecdef IS DISTINCT FROM original.prosecdef OR copied.proconfig IS DISTINCT FROM original.proconfig OR copied.provolatile IS DISTINCT FROM original.provolatile OR copied.prorettype IS DISTINCT FROM original.prorettype OR copied.proargnames IS DISTINCT FROM original.proargnames OR copied.proargmodes IS DISTINCT FROM original.proargmodes OR copied.proargdefaults::text IS DISTINCT FROM original.proargdefaults::text THEN RAISE EXCEPTION 'Scoped ACL routine metadata differs';END IF;
  -- Reconstruct the prior reviewed scoped transformation and compare it to the installed private copy.
  expected_copy:=replace(original.prosrc,upgraded,marker);
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
  IF replace(copied.prosrc,E'\r','') IS DISTINCT FROM replace(expected_copy,E'\r','') THEN RAISE EXCEPTION 'Private ACL copy differs from reviewed scoped source' USING ERRCODE='55000';END IF;
  definition:=pg_get_functiondef(copied.oid);
  IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Scoped ACL license marker changed';END IF;
  EXECUTE replace(definition,marker,upgraded);
  EXECUTE format('REVOKE ALL ON FUNCTION portal_scope.%I(%s) FROM PUBLIC,anon,authenticated,service_role',original.proname,pg_get_function_identity_arguments(original.oid));
  UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original.oid) WHERE original_oid=original.oid AND source_hash=expected_old;
  IF NOT FOUND THEN RAISE EXCEPTION 'Runtime snapshot changed during repair' USING ERRCODE='40001';END IF;
  repaired:=repaired+1;
 END LOOP;
 IF repaired<>2 OR EXISTS(SELECT 1 FROM portal_scope.routines r WHERE r.source_hash IS DISTINCT FROM portal_scope.function_signature(r.original_oid)) THEN RAISE EXCEPTION 'Portal runtime still has unreviewed changes' USING ERRCODE='55000';END IF;
END $repair$;
NOTIFY pgrst,'reload schema';
COMMIT;
