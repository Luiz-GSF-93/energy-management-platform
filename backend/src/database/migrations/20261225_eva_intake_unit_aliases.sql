BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.eva_intake_unit_aliases_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,customer_id text NOT NULL,unit_id text NOT NULL,
 previous_code text NOT NULL CHECK(previous_code ~ '^[0-9]{5,20}$'),current_code text NOT NULL,
 source_intake_id uuid NOT NULL REFERENCES public.eva_automatic_intakes(id),source_hash text NOT NULL,source_month text NOT NULL,
 actor_id text NOT NULL,reason text NOT NULL CHECK(length(reason) BETWEEN 20 AND 1000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,previous_code),CHECK(previous_code<>current_code)
);
ALTER TABLE public.eva_intake_unit_aliases_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eva_intake_unit_aliases_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.eva_intake_unit_aliases_audit FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_eva_intake_unit_alias BEFORE UPDATE OR DELETE ON public.eva_intake_unit_aliases_audit FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();
CREATE FUNCTION public.register_eva_intake_unit_alias(p_org text,p_actor text,p_role text,p_source uuid,p_code text,p_hash text,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb;i public.eva_automatic_intakes;u public.consumer_units;existing public.eva_intake_unit_aliases_audit;result uuid;current_code text;
BEGIN
 a:=public.eva_intake_actor(p_org,p_actor,p_role,false,NULL);
 IF a->>'external' IS DISTINCT FROM 'false' OR NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND r.name IN('gestor','admin_org') AND r.permissions @> '["0f2e539d-03f9-4168-bc8c-55ac3a371628"]'::jsonb) THEN RAISE EXCEPTION 'Unit update permission required' USING ERRCODE='42501';END IF;
 SELECT * INTO i FROM public.eva_automatic_intakes WHERE id=p_source AND organization_id=p_org AND stored AND consent AND file_hash=p_hash AND raw_result IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR p_code !~ '^[0-9]{5,20}$' OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 20 AND 1000 OR coalesce(position(p_code IN regexp_replace(i.raw_result->>'content','[^0-9]','','g')),0)=0 THEN RAISE EXCEPTION 'Original printed code and hash required' USING ERRCODE='22023';END IF;
 SELECT * INTO u FROM public.consumer_units WHERE id=i.hints->>'unitId' AND organization_id=p_org AND customer_id=i.customer_id AND status='ACTIVE';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.eva_automatic_intake_events e WHERE e.intake_id=i.id AND e.event='SOURCE_REVIEW' AND e.body->>'customerId'=i.customer_id AND e.body->>'unitId'=u.id AND e.body->>'month'=i.hints->>'month') THEN RAISE EXCEPTION 'Confirmed source scope required' USING ERRCODE='42501';END IF;
 current_code:=regexp_replace(u.consumer_unit_number,'[^0-9]','','g');
 IF p_code=current_code OR current_code='' THEN RAISE EXCEPTION 'Historical code required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||p_code,316));
 SELECT * INTO existing FROM public.eva_intake_unit_aliases_audit WHERE organization_id=p_org AND previous_code=p_code;
 IF FOUND THEN
  IF existing.customer_id<>i.customer_id OR existing.unit_id<>u.id OR existing.source_hash<>p_hash OR existing.current_code<>current_code THEN RAISE EXCEPTION 'Historical code conflict' USING ERRCODE='40001';END IF;
  RETURN existing.id;
 END IF;
 INSERT INTO public.eva_intake_unit_aliases_audit(organization_id,customer_id,unit_id,previous_code,current_code,source_intake_id,source_hash,source_month,actor_id,reason)
 VALUES(p_org,i.customer_id,u.id,p_code,current_code,i.id,p_hash,i.hints->>'month',p_actor,p_reason) RETURNING id INTO result;
 PERFORM public.eva_intake_event(i.id,'HISTORICAL_UNIT_CODE_CONFIRMED',jsonb_build_object('aliasId',result,'previousCode',p_code,'currentCode',current_code,'sourceHash',p_hash,'reason',p_reason),p_actor);
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.register_eva_intake_unit_alias(text,text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_eva_intake_unit_alias(text,text,text,uuid,text,text,text) TO service_role;
-- Preserve existing configuration-edit evidence and the original function OID.
DO $$DECLARE d text;BEGIN
 d:=pg_get_functiondef('public.ocr_identity_unit_lineage(text,text,text,text)'::regprocedure);
 IF to_regprocedure('public.ocr_identity_unit_lineage_before_intake_alias(text,text,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'Lineage backup exists; review migration';END IF;
 d:=replace(d,'public.ocr_identity_unit_lineage(','public.ocr_identity_unit_lineage_before_intake_alias(');
 EXECUTE d;
END$$;
REVOKE ALL ON FUNCTION public.ocr_identity_unit_lineage_before_intake_alias(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
-- Argument names must match the deployed function; replace only its body.
DO $$DECLARE d text;start_at int;BEGIN
 d:=pg_get_functiondef('public.ocr_identity_unit_lineage(text,text,text,text)'::regprocedure);
 -- CREATE OR REPLACE with positional SQL arguments avoids changing parameter names.
 start_at:=position('AS $function$' IN d);
 IF start_at=0 THEN RAISE EXCEPTION 'Review lineage function formatting';END IF;
 d:=left(d,start_at-1);
 d:=regexp_replace(d,'LANGUAGE [a-zA-Z]+','LANGUAGE sql');
 EXECUTE d||$body$ AS $function$
 SELECT jsonb_set(original,'{codes}',coalesce((SELECT jsonb_agg(DISTINCT code) FROM(
 SELECT jsonb_array_elements_text(original->'codes') code UNION ALL
 SELECT h.previous_code FROM public.eva_intake_unit_aliases_audit h WHERE h.organization_id=$1 AND h.customer_id=$2 AND h.unit_id=$3 AND h.current_code IN(SELECT jsonb_array_elements_text(original->'codes'))
 )codes),'[]'::jsonb)) FROM public.ocr_identity_unit_lineage_before_intake_alias($1,$2,$3,$4)original
 $function$ $body$;
END$$;
COMMIT;

