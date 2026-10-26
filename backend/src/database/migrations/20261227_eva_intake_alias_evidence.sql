BEGIN;
SET LOCAL lock_timeout='5s';
DO $$DECLARE d text;old text;replacement text;BEGIN
 d:=pg_get_functiondef('public.ocr_identity_unit_lineage(text,text,text,text)'::regprocedure);
 old:=' FROM public.ocr_identity_unit_lineage_before_intake_alias($1,$2,$3,$4)original';
 replacement:=$patch$ || jsonb_build_object('aliasIds',coalesce((SELECT jsonb_agg(h.id ORDER BY h.created_at,h.id) FROM public.eva_intake_unit_aliases_audit h WHERE h.organization_id=$1 AND h.customer_id=$2 AND h.unit_id=$3 AND h.current_code IN(SELECT jsonb_array_elements_text(original->'codes'))),'[]'::jsonb)) FROM public.ocr_identity_unit_lineage_before_intake_alias($1,$2,$3,$4)original$patch$;
 IF position(replacement IN d)=0 THEN
  IF position(old IN d)=0 THEN RAISE EXCEPTION 'Review immutable alias evidence projection';END IF;
  d:=replace(d,old,replacement);
 END IF;
 EXECUTE d;
END$$;
COMMIT;
