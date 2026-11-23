BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';

-- A unit closing does not consume sibling preparation receipts. Keep the entire
-- financial capture and shared evidence exact, plus the selected unit receipt.
CREATE OR REPLACE FUNCTION public.eva_closing_sources_match(p_saved jsonb,p_current jsonb,p_scope text,p_unit text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE saved_unit jsonb;current_unit jsonb;
BEGIN
 IF jsonb_typeof(p_saved) IS DISTINCT FROM 'object' OR jsonb_typeof(p_current) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF p_scope='CUSTOMER' THEN RETURN p_saved=p_current;END IF;
 IF p_scope IS DISTINCT FROM 'UNIT' OR nullif(btrim(p_unit),'') IS NULL THEN RETURN false;END IF;
 IF jsonb_typeof(p_saved->'commercial') IS DISTINCT FROM 'array' OR jsonb_typeof(p_current->'commercial') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF (p_saved-'commercial') IS DISTINCT FROM (p_current-'commercial') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements((p_saved->'commercial')||(p_current->'commercial')) entry WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object' OR jsonb_typeof(entry->'consumer_unit_id') IS DISTINCT FROM 'string' OR nullif(btrim(entry->>'consumer_unit_id'),'') IS NULL) THEN RETURN false;END IF;
 SELECT coalesce(jsonb_agg(entry ORDER BY entry->>'id'),'[]') INTO saved_unit FROM jsonb_array_elements(p_saved->'commercial') entry WHERE entry->>'consumer_unit_id'=p_unit;
 SELECT coalesce(jsonb_agg(entry ORDER BY entry->>'id'),'[]') INTO current_unit FROM jsonb_array_elements(p_current->'commercial') entry WHERE entry->>'consumer_unit_id'=p_unit;
 IF jsonb_array_length(saved_unit)>1 OR jsonb_array_length(current_unit)>1 THEN RETURN false;END IF;
 RETURN saved_unit=current_unit;
END$$;
REVOKE ALL ON FUNCTION public.eva_closing_sources_match(jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE fn record;definition text;reserve_check text;existing_check text;replacement text;patched integer:=0;calls integer;
BEGIN
 reserve_check:=$old$p_body->'sources' IS DISTINCT FROM public.capture_eva_assisted_closing_sources(p_org,u.customer_id,p_month)$old$;
 existing_check:=$old$r.source_snapshot IS DISTINCT FROM public.capture_eva_assisted_closing_sources(p_org,r.customer_id,p_month)$old$;
 FOR fn IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','portal_scope') AND p.proname='eva_assisted_closing_action' LOOP
  definition:=pg_get_functiondef(fn.oid);
  IF strpos(definition,'Sources changed; prepare a new revision')=0 THEN CONTINUE;END IF;
  IF strpos(definition,reserve_check)>0 AND strpos(definition,existing_check)>0 THEN
   replacement:=$new$NOT public.eva_closing_sources_match(p_body->'sources',public.capture_eva_assisted_closing_sources(p_org,u.customer_id,p_month),CASE WHEN current_setting('energyos.eva_closing_scope',true)='UNIT' THEN 'UNIT' ELSE 'CUSTOMER' END,p_unit)$new$;
   definition:=replace(definition,reserve_check,replacement);
   replacement:=$new$NOT public.eva_closing_sources_match(r.source_snapshot,public.capture_eva_assisted_closing_sources(p_org,r.customer_id,p_month),CASE WHEN current_setting('energyos.eva_closing_scope',true)='UNIT' THEN 'UNIT' ELSE 'CUSTOMER' END,p_unit)$new$;
   definition:=replace(definition,existing_check,replacement);
  END IF;
  calls:=(length(definition)-length(replace(definition,'public.eva_closing_sources_match(','')))/length('public.eva_closing_sources_match(');
  IF calls<>3 OR strpos(definition,reserve_check)>0 OR strpos(definition,existing_check)>0 THEN RAISE EXCEPTION 'Unit closing source guard baseline changed';END IF;
  EXECUTE definition;patched:=patched+1;
 END LOOP;
 IF patched<>1 THEN RAISE EXCEPTION 'Expected one guarded closing implementation';END IF;
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid) WHERE original_oid IN(SELECT oid FROM pg_proc WHERE proname='eva_assisted_closing_action');END IF;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
