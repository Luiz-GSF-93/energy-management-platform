-- F1.138: atomic class-only reapproval, preserving approved snapshots and exact values.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.review_parameter_class(p_org text,p_unit text,p_month text,p_class text,p_refs jsonb,p_reason text,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE u public.consumer_units; p public.calculation_parameters; b public.calculation_parameters; context jsonb; refs jsonb; mapping jsonb='{}'; ids uuid[]='{}'; new_id uuid; basis jsonb; item jsonb; items jsonb; first_day date; last_day date; expected integer;
BEGIN
 IF nullif(btrim(p_actor),'') IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 1000 OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Actor, month and justification required' USING ERRCODE='P3301';END IF;
 first_day:=(p_month||'-01')::date;last_day:=(first_day+interval '1 month - 1 day')::date;
 SELECT cu.* INTO u FROM public.consumer_units cu JOIN public.customers c ON c.id=cu.customer_id AND c.organization_id=cu.organization_id WHERE cu.id=p_unit AND cu.organization_id=p_org AND c.deleted_at IS NULL FOR SHARE OF cu,c;
 IF u.id IS NULL THEN RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='P3303';END IF;
 IF u.consumption_class IS DISTINCT FROM p_class OR nullif(p_class,'') IS NULL THEN RAISE EXCEPTION 'Class changed' USING ERRCODE='40001';END IF;
 SELECT jsonb_object_agg(k,to_jsonb(u)->k) INTO context FROM unnest(ARRAY['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market']) k;
 PERFORM pg_advisory_xact_lock(hashtextextended('parameter-class:'||p_org||':'||p_unit,0));
 -- Serialize each ordinary approval scope before taking row locks.
 FOR p IN SELECT DISTINCT ON (kind,component_code,scenario) * FROM public.calculation_parameters WHERE organization_id=p_org AND consumer_unit_id=p_unit AND status='APPROVED' AND start_date<=last_day AND end_date>=first_day ORDER BY kind,component_code,scenario LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(p.organization_id||':'||p.consumer_unit_id||':'||p.kind||':'||p.component_code||':'||p.scenario,0));
 END LOOP;
 PERFORM 1 FROM public.calculation_parameters WHERE organization_id=p_org AND consumer_unit_id=p_unit AND status<>'RETIRED' AND start_date<=last_day AND end_date>=first_day ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.calculation_parameters WHERE organization_id=p_org AND consumer_unit_id=p_unit AND status='DRAFT' AND start_date<=last_day AND end_date>=first_day) THEN RAISE EXCEPTION 'Resolve drafts first' USING ERRCODE='P3302';END IF;
 SELECT jsonb_agg(jsonb_build_object('id',id,'revision',revision) ORDER BY id),count(*) INTO refs,expected FROM public.calculation_parameters WHERE organization_id=p_org AND consumer_unit_id=p_unit AND status='APPROVED' AND start_date<=last_day AND end_date>=first_day AND unit_context IS DISTINCT FROM context;
 IF expected=0 OR jsonb_typeof(p_refs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_refs)<>expected OR NOT(refs @> p_refs AND p_refs @> refs) THEN RAISE EXCEPTION 'Refresh review references' USING ERRCODE='40001';END IF;
 FOR p IN SELECT * FROM public.calculation_parameters WHERE id IN(SELECT (x->>'id')::uuid FROM jsonb_array_elements(refs) x) ORDER BY id LOOP
  IF p.customer_id<>u.customer_id OR (p.unit_context-'consumption_class') IS DISTINCT FROM (context-'consumption_class') OR p.unit_context->>'consumption_class' IS NOT NULL OR p.kind NOT IN('TARIFF','TAX') OR (p.kind='TAX' AND (p.treatment<>'INCLUDED' OR p.tax_basis IS NULL OR p.tax_basis-ARRAY['version','items']<>'{}'::jsonb)) THEN RAISE EXCEPTION 'Only missing-class completion with unchanged electrical context supported' USING ERRCODE='P3311';END IF;
  mapping:=mapping||jsonb_build_object(p.id::text,gen_random_uuid());
 END LOOP;
 -- Each original tax reference must still match its approved source revision.
 FOR p IN SELECT * FROM public.calculation_parameters WHERE id IN(SELECT (x->>'id')::uuid FROM jsonb_array_elements(refs) x) AND kind='TAX' LOOP
  FOR item IN SELECT * FROM jsonb_array_elements(p.tax_basis->'items') LOOP
   SELECT * INTO b FROM public.calculation_parameters WHERE id=(item->>'parameterId')::uuid AND organization_id=p_org FOR SHARE;
   IF b.id IS NULL OR b.status<>'APPROVED' OR b.revision::text IS DISTINCT FROM item->>'revision' OR b.consumer_unit_id<>p_unit OR b.customer_id<>u.customer_id OR b.scenario<>p.scenario OR b.kind<>'TARIFF' OR b.start_date>p.start_date OR b.end_date<p.end_date THEN RAISE EXCEPTION 'Stale tax basis' USING ERRCODE='P3311';END IF;
  END LOOP;
 END LOOP;
 -- Retirement and successor approvals are atomic; any failure rolls back the entire batch.
 UPDATE public.calculation_parameters SET status='RETIRED',updated_by=p_actor,retirement_reason='Revisão de classe para '||p_class||'; sucessor '||(mapping->>id::text)||'. '||btrim(p_reason) WHERE id IN(SELECT (x->>'id')::uuid FROM jsonb_array_elements(refs) x) AND organization_id=p_org;
 FOR p IN SELECT * FROM public.calculation_parameters WHERE id IN(SELECT (x->>'id')::uuid FROM jsonb_array_elements(refs) x) ORDER BY CASE WHEN kind='TARIFF' THEN 0 ELSE 1 END,id LOOP
  new_id:=(mapping->>p.id::text)::uuid;basis:=p.tax_basis;
  IF basis IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(CASE WHEN mapping ? (x->>'parameterId') THEN x||jsonb_build_object('parameterId',mapping->>(x->>'parameterId'),'revision',2) ELSE x END),'[]'::jsonb) INTO items FROM jsonb_array_elements(basis->'items') x;
   basis:=jsonb_set(basis,'{items}',items);
  END IF;
  INSERT INTO public.calculation_parameters(id,organization_id,customer_id,consumer_unit_id,kind,component_code,label,scenario,time_band,measure,amount_text,treatment,included_taxes,base_rule,direction,source,notes,start_date,end_date,unit_context,created_by,updated_by,embedded_tax_codes,tax_basis,monetary_source,supersedes_parameter_id)
  VALUES(new_id,p.organization_id,p.customer_id,p.consumer_unit_id,p.kind,p.component_code,p.label,p.scenario,p.time_band,p.measure,p.amount_text,p.treatment,p.included_taxes,p.base_rule,p.direction,p.source,p.notes||E'
Revisão de classe, sem alteração financeira. Anterior: '||p.id||'. Justificativa: '||btrim(p_reason),p.start_date,p.end_date,context,p_actor,p_actor,p.embedded_tax_codes,basis,p.monetary_source,p.id);
  UPDATE public.calculation_parameters SET status='APPROVED',updated_by=p_actor WHERE id=new_id AND organization_id=p_org;
  ids:=array_append(ids,new_id);
 END LOOP; RETURN jsonb_build_object('count',expected,'successors',mapping,'class',p_class);
END $$;
REVOKE ALL ON FUNCTION public.review_parameter_class(text,text,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_parameter_class(text,text,text,text,jsonb,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
