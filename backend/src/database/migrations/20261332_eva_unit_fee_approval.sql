BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.eva_unit_fee_requires_consolidation(p_snapshot jsonb,p_org text,p_customer text,p_month text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $fn$
DECLARE c jsonb; a jsonb; candidates jsonb; first_day date; last_day date;
BEGIN
 IF p_org IS NULL OR p_customer IS NULL OR p_month IS NULL OR p_month !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR jsonb_typeof(p_snapshot#>'{financial,tables,management_contracts}') IS DISTINCT FROM 'array' THEN RETURN true; END IF;
 first_day:=(p_month||'-01')::date;last_day:=(first_day+interval '1 month - 1 day')::date;
 FOR c IN SELECT value FROM jsonb_array_elements(p_snapshot#>'{financial,tables,management_contracts}') LOOP
  IF coalesce(nullif(c->>'savings_percentage',''),'0')::numeric<=0 THEN CONTINUE; END IF;
  IF c->>'status' IS NULL THEN RETURN true; END IF;
  IF c->>'status'<>'ACTIVE' THEN CONTINUE; END IF;
  IF c->>'start_date' IS NULL THEN RETURN true; END IF;
  IF (c->>'start_date')::date>last_day OR coalesce(nullif(c->>'end_date','')::date,'9999-12-31'::date)<first_day THEN CONTINUE; END IF;
  IF c->>'organization_id' IS DISTINCT FROM p_org OR c->>'customer_id' IS DISTINCT FROM p_customer OR nullif(c->>'id','') IS NULL OR jsonb_typeof(p_snapshot#>'{financial,tables,management_fee_allocations}') IS DISTINCT FROM 'array' THEN RETURN true; END IF;
  SELECT jsonb_agg(value ORDER BY (value->>'version')::integer DESC) INTO candidates
   FROM jsonb_array_elements(p_snapshot#>'{financial,tables,management_fee_allocations}')
   WHERE value->>'contract_id'=c->>'id' AND value->>'organization_id'=p_org AND value->>'customer_id'=p_customer AND value->>'month'=p_month;
  a:=candidates->0;
  IF a IS NULL OR nullif(btrim(a->>'source'),'') IS NULL OR a->>'fixed_fee_basis' IS DISTINCT FROM 'PER_UNIT' OR a->>'variable_fee_basis' IS DISTINCT FROM 'PER_UNIT' OR a->'allocations' IS DISTINCT FROM '[]'::jsonb OR coalesce((a->>'version')::integer,0)<1 OR (SELECT count(*) FROM jsonb_array_elements(candidates) x WHERE x->>'version'=a->>'version')<>1 THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $fn$;
REVOKE ALL ON FUNCTION public.eva_unit_fee_requires_consolidation(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE d text; patched text; guard text;
BEGIN
 d:=pg_get_functiondef('public.eva_scoped_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,text,text,boolean)'::regprocedure);
 guard:=substring(d from $seam$IF\s+p_scope\s*=\s*'UNIT'\s+AND\s+p_action\s+IN\s*\(\s*'publish'\s*,\s*'decide'\s*\)[^;]*Shared variable fee requires consolidated closing[^;]*;\s*END\s+IF;$seam$);
 IF guard IS NULL OR regexp_replace(guard,'\s','','g') IS DISTINCT FROM regexp_replace($expected$IF p_scope='UNIT' AND p_action IN('publish','decide') AND (p_action='publish' OR p_body->>'decision'='APPROVE') AND (SELECT count(*) FROM public.consumer_units WHERE organization_id=p_org AND customer_id=r.customer_id AND status='ACTIVE')>1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(r.source_snapshot#>'{financial,tables,management_contracts}','[]')) m WHERE coalesce(nullif(m->>'savings_percentage',''),'0')::numeric>0) THEN RAISE EXCEPTION 'Shared variable fee requires consolidated closing' USING ERRCODE='22023';END IF;$expected$,'\s','','g') THEN RAISE EXCEPTION 'Review changed unit approval guard'; END IF;
 patched:=replace(d,guard,$replacement$IF p_scope='UNIT' AND p_action IN('publish','decide') AND (p_action='publish' OR p_body->>'decision'='APPROVE') AND (SELECT count(*) FROM public.consumer_units WHERE organization_id=p_org AND customer_id=r.customer_id AND status='ACTIVE')>1 AND public.eva_unit_fee_requires_consolidation(r.source_snapshot,p_org,r.customer_id,p_month) THEN RAISE EXCEPTION 'Shared variable fee requires consolidated closing' USING ERRCODE='22023';END IF;$replacement$);
 IF patched=d OR position('eva_unit_fee_requires_consolidation' in patched)=0 THEN RAISE EXCEPTION 'Review changed unit approval baseline'; END IF;
 EXECUTE patched;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid) WHERE original_oid='public.eva_scoped_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb,text,text,boolean)'::regprocedure; END IF;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
