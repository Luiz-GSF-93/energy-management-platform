BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.eva_closing_scope_match(p_report jsonb,p_unit text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(CASE WHEN current_setting('energyos.eva_closing_scope',true)='UNIT' THEN p_report#>>'{scope,kind}'='UNIT' AND p_report#>'{scope,unitIds}'=jsonb_build_array(p_unit) ELSE coalesce(p_report#>>'{scope,kind}','CUSTOMER')='CUSTOMER' END,false)
$$;
REVOKE ALL ON FUNCTION public.eva_closing_scope_match(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
-- Patch the actual guarded implementation, preserving outer tenant wrappers.
DO $patch$
DECLARE fn record;definition text;expected text;patched integer:=0;
BEGIN
 FOR fn IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','portal_scope') AND p.proname='eva_assisted_closing_action' LOOP
  definition:=pg_get_functiondef(fn.oid);
  IF strpos(definition,'Incomplete unit set')=0 THEN CONTINUE;END IF;
  expected:='SELECT jsonb_agg(id ORDER BY id) INTO expected FROM public.consumer_units WHERE organization_id=p_org AND customer_id=u.customer_id;';
  IF strpos(definition,expected)=0 OR strpos(definition,'next_version:=coalesce(old.version,0)+1;')=0 THEN RAISE EXCEPTION 'Closing baseline changed';END IF;
  definition:=replace(definition,expected,'IF current_setting(''energyos.eva_closing_scope'',true)=''UNIT'' THEN expected:=jsonb_build_array(p_unit); ELSE '||expected||' END IF;');
  definition:=regexp_replace(definition,'FROM public\.eva_assisted_closing_versions( ([tv]))? WHERE','FROM public.eva_assisted_closing_versions\1 WHERE public.eva_closing_scope_match(\2report,p_unit) AND','g');
  -- Qualify aliases; unaliased queries already use report directly.
  definition:=replace(replace(definition,'(treport,p_unit)','(t.report,p_unit)'),'(vreport,p_unit)','(v.report,p_unit)');
  definition:=replace(definition,'next_version:=coalesce(old.version,0)+1;','SELECT coalesce(max(version),0)+1 INTO next_version FROM public.eva_assisted_closing_versions WHERE organization_id=p_org AND customer_id=u.customer_id AND month=p_month;');
  EXECUTE definition;patched:=patched+1;
 END LOOP;
 IF patched<>1 THEN RAISE EXCEPTION 'Expected one closing implementation';END IF;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid) WHERE original_oid IN(SELECT oid FROM pg_proc WHERE proname='eva_assisted_closing_action');END IF;
END $patch$;
CREATE FUNCTION public.eva_scoped_closing_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_unit text,p_month text,p_id uuid,p_body jsonb,p_scope text,p_mode text,p_disclose boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='30s' AS $$
DECLARE previous_scope text:=current_setting('energyos.eva_closing_scope',true);result jsonb;r public.eva_assisted_closing_versions;
BEGIN
 IF p_scope IS NULL OR p_scope NOT IN('UNIT','CUSTOMER') OR p_mode IS NULL OR p_mode NOT IN('BASE','CONTRACT','DOCUMENTED') THEN RAISE EXCEPTION 'Invalid explicit closing scope' USING ERRCODE='22023';END IF;
 PERFORM set_config('energyos.eva_closing_scope',p_scope,true);
 IF p_action='reserve' AND (p_scope='UNIT' AND (p_body#>>'{report,scope,kind}' IS DISTINCT FROM 'UNIT' OR p_body#>'{report,scope,unitIds}' IS DISTINCT FROM jsonb_build_array(p_unit)) OR p_scope='CUSTOMER' AND coalesce(p_body#>>'{report,scope,kind}','CUSTOMER')<>'CUSTOMER') THEN RAISE EXCEPTION 'Report scope mismatch' USING ERRCODE='22023';END IF;
 IF p_action IN('finish','decide','publish','withdraw') THEN
  SELECT * INTO r FROM public.eva_assisted_closing_versions WHERE id=p_id AND organization_id=p_org AND month=p_month;
  IF NOT FOUND OR NOT public.eva_closing_scope_match(r.report,p_unit) OR NOT EXISTS(SELECT 1 FROM public.consumer_units u WHERE u.organization_id=p_org AND u.id=p_unit AND u.customer_id=r.customer_id) THEN RAISE EXCEPTION 'Closing scope unavailable' USING ERRCODE='42501';END IF;
  IF p_scope='UNIT' AND p_action IN('publish','decide') AND (p_action='publish' OR p_body->>'decision'='APPROVE') AND (SELECT count(*) FROM public.consumer_units WHERE organization_id=p_org AND customer_id=r.customer_id AND status='ACTIVE')>1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(r.source_snapshot#>'{financial,tables,management_contracts}','[]')) m WHERE coalesce(nullif(m->>'savings_percentage',''),'0')::numeric>0) THEN RAISE EXCEPTION 'Shared variable fee requires consolidated closing' USING ERRCODE='22023';END IF;
 END IF;
 IF p_mode='DOCUMENTED' THEN result:=public.eva_documented_closing_action(p_org,p_actor,p_role,p_platform,p_action,p_unit,p_month,p_id,p_body,p_disclose);
 ELSIF p_mode='CONTRACT' THEN result:=public.eva_contract_closing_action(p_org,p_actor,p_role,p_platform,p_action,p_unit,p_month,p_id,p_body,p_disclose);
 ELSIF p_disclose THEN result:=public.decide_eva_with_publication(p_org,p_actor,p_role,p_platform,p_unit,p_month,p_id,p_body);
 ELSIF p_action IN('publish','withdraw') THEN result:=public.eva_closing_publication_action(p_org,p_actor,p_role,p_platform,p_action,p_unit,p_month,p_id,p_body);
 ELSE result:=public.eva_assisted_closing_action(p_org,p_actor,p_role,p_platform,p_action,p_unit,p_month,p_id,p_body);END IF;
 PERFORM set_config('energyos.eva_closing_scope',coalesce(previous_scope,''),true);RETURN result;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('energyos.eva_closing_scope',coalesce(previous_scope,''),true);RAISE;
END$$;
REVOKE ALL ON FUNCTION public.eva_scoped_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_scoped_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,text,text,boolean) TO service_role;
-- A newer approval blocks publication only when it covers an overlapping unit.
DO $publication$
DECLARE fn record;d text;
BEGIN
 FOR fn IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','portal_scope') AND p.proname='eva_closing_publication_action' LOOP
  d:=pg_get_functiondef(fn.oid);IF strpos(d,'Newer approved version exists')=0 THEN CONTINUE;END IF;
  d:=replace(d,'v.version>r.version AND','v.version>r.version AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(v.report->''unitIds'') newer_unit WHERE r.report->''unitIds'' ? newer_unit) AND');EXECUTE d;
 END LOOP;
END $publication$;
-- Include verified demand evidence only in new unit captures; legacy snapshots stay compatible.
DO $demand_capture$
DECLARE fn record;d text;changed integer:=0;
BEGIN
 FOR fn IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','portal_scope') AND p.proname='capture_eva_assisted_closing_sources' LOOP
  d:=pg_get_functiondef(fn.oid);IF strpos(d,'RETURN base;')=0 THEN CONTINUE;END IF;
  d:=replace(d,'RETURN base;', $extra$IF current_setting('energyos.eva_closing_scope',true)='UNIT' THEN
   base:=base||jsonb_build_object('demandDocuments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'organization_id',d.organization_id,'customer_id',d.customer_id,'consumer_unit_id',d.consumer_unit_id,'file_hash',d.file_hash,'file_verified',d.file_verified) ORDER BY d.id),'[]') FROM public.documents d WHERE d.organization_id=p_org AND d.customer_id=p_customer AND EXISTS(SELECT 1 FROM public.unit_demand_periods period JOIN public.unit_demand_approvals approval ON approval.period_id=period.id AND approval.organization_id=period.organization_id AND approval.consumer_unit_id=period.consumer_unit_id WHERE period.organization_id=p_org AND period.customer_id=p_customer AND period.document_id=d.id AND period.document_hash=d.file_hash)));
  END IF;RETURN base;$extra$);EXECUTE d;changed:=changed+1;
 END LOOP;
 IF changed<>1 THEN RAISE EXCEPTION 'Expected demand capture implementation';END IF;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid) WHERE original_oid IN(SELECT oid FROM pg_proc WHERE proname IN('eva_assisted_closing_action','capture_eva_assisted_closing_sources','eva_closing_publication_action'));END IF;
END $demand_capture$;
NOTIFY pgrst,'reload schema';NOTIFY pgrst,'reload config';
COMMIT;
