-- Read-only effective status; never erase historical uncertain receipts or repeat a writer.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $install$ BEGIN
 IF obj_description('public.platform_eva_stability(uuid,text,integer)'::regprocedure,'pg_proc')='platform-eva:20261329:v1' THEN RETURN;END IF;
 IF to_regprocedure('public.platform_eva_stability_before_verified_publications(uuid,text,integer)') IS NOT NULL THEN RAISE EXCEPTION 'Review Owner stability projection';END IF;
 EXECUTE $schema$
CREATE INDEX IF NOT EXISTS eva_intake_unknown_publication_scope ON public.eva_automatic_intakes(organization_id,updated_at,id) WHERE state='UNKNOWN' AND lease_token IS NULL;
ALTER FUNCTION public.platform_eva_stability(uuid,text,integer) RENAME TO platform_eva_stability_before_verified_publications;
CREATE FUNCTION public.platform_eva_stability(p_actor uuid,p_search text DEFAULT '',p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' AS $$
DECLARE result jsonb;item jsonb;rows jsonb:='[]';ids uuid[];proof jsonb;published integer;technical integer;attention boolean;
BEGIN
 -- The unchanged original routine first authenticates an active platform Owner and selects licensed organizations.
 result:=public.platform_eva_stability_before_verified_publications(p_actor,p_search,p_offset);
 FOR item IN SELECT value FROM jsonb_array_elements(result->'rows') LOOP
  SELECT array_agg(id ORDER BY updated_at,id) INTO ids FROM(SELECT id,updated_at FROM public.eva_automatic_intakes WHERE organization_id=item->>'organizationId' AND state='UNKNOWN' AND lease_token IS NULL AND document_type='INVOICE_DISTRIBUTOR' AND document_id IS NOT NULL ORDER BY updated_at,id LIMIT 100) q;
  published:=0;
  IF cardinality(ids)>0 THEN
   proof:=public.eva_intake_published_completions(item->>'organizationId',ids);
   IF jsonb_typeof(proof) IS DISTINCT FROM 'array' OR jsonb_array_length(proof)>cardinality(ids) OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(proof)x)<>jsonb_array_length(proof) OR EXISTS(SELECT 1 FROM jsonb_array_elements(proof)x WHERE NOT coalesce(x->>'id'=ANY(ids::text[]),false)) THEN RAISE EXCEPTION 'Invalid verified completion projection';END IF;
   published:=jsonb_array_length(proof);
  END IF;
  technical:=greatest(0,(item#>>'{intakes,technical}')::integer-published);
  item:=jsonb_set(item,'{intakes,technical}',to_jsonb(technical));
  item:=jsonb_set(item,'{intakes,publishedHistorical}',to_jsonb(published));
  attention:=(item->>'closingReceipts')::bigint>0 OR(item->>'activeLicenses')::integer<>1 OR(item#>>'{manual,uncertain}')::bigint>0 OR(item#>>'{manual,failed30d}')::bigint>0 OR(item#>>'{manual,oldestQueueSeconds}')::bigint>300 OR technical>0;
  item:=jsonb_set(item,'{attention}',to_jsonb(attention));rows:=rows||jsonb_build_array(item);
 END LOOP;
 RETURN jsonb_set(result,'{rows}',rows);
END$$;
REVOKE ALL ON FUNCTION public.platform_eva_stability_before_verified_publications(uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.platform_eva_stability(uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.platform_eva_stability(uuid,text,integer) TO service_role;
COMMENT ON FUNCTION public.platform_eva_stability(uuid,text,integer) IS 'platform-eva:20261329:v1';
NOTIFY pgrst,'reload schema';
$schema$;
END $install$;
COMMIT;
