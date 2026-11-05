BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.build_platform_sales_snapshot(p_receipt uuid,p_plan uuid,p_policy_version integer,p_cycle text,p_extras jsonb,p_justification text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy public.platform_sales_policies; plan public.plan_catalog; lead public.platform_sales_leads;
 units integer; users integer; base numeric; monthly_extra numeric; once_extra numeric; annual numeric; snapshot jsonb; selected jsonb; modules jsonb; required text[]; goal text; extra jsonb; base_modules jsonb; documents_limit integer;
BEGIN
 IF p_cycle IS NULL OR p_cycle NOT IN ('MONTHLY','ANNUAL') OR p_extras IS NULL OR jsonb_typeof(p_extras)<>'array' OR jsonb_array_length(p_extras)>20 THEN RAISE EXCEPTION 'Invalid cycle/extras' USING ERRCODE='22023'; END IF;
 SELECT * INTO lead FROM public.platform_sales_leads WHERE receipt=p_receipt FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Receipt missing' USING ERRCODE='P3610'; END IF;
 SELECT * INTO plan FROM public.plan_catalog WHERE id=p_plan AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active plan missing' USING ERRCODE='P3610'; END IF;
 SELECT * INTO policy FROM public.platform_sales_policies WHERE plan_id=p_plan AND plan_version=plan.version
 AND ((now() AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN (definition->>'starts')::date AND (definition->>'ends')::date ORDER BY version DESC LIMIT 1;
 IF NOT FOUND OR policy.version IS DISTINCT FROM p_policy_version THEN RAISE EXCEPTION 'Effective policy changed' USING ERRCODE='P3611'; END IF;
 units:=(lead.payload->>'units')::integer; users:=(lead.payload->>'users')::integer;
 IF units IS NULL OR users IS NULL OR units NOT BETWEEN (policy.definition->>'minUnits')::integer AND (policy.definition->>'maxUnits')::integer OR users NOT BETWEEN 1 AND (policy.definition->>'maxUsers')::integer OR ((now() AT TIME ZONE 'America/Sao_Paulo')::date) NOT BETWEEN (policy.definition->>'starts')::date AND (policy.definition->>'ends')::date THEN RAISE EXCEPTION 'Profile outside policy' USING ERRCODE='22023'; END IF;
 required:=ARRAY[]::text[];
 FOR goal IN SELECT jsonb_array_elements_text(lead.payload->'goals') LOOP
  CASE goal WHEN 'costs','reports' THEN required:=required||ARRAY['report_generation']; WHEN 'automation' THEN required:=required||ARRAY['bot_energy_rag']; WHEN 'ocr' THEN required:=required||ARRAY['document_management','advanced_analytics']; WHEN 'free_market' THEN required:=required||ARRAY['free_market_management']; WHEN 'trading' THEN required:=required||ARRAY['trading_hub']; WHEN 'documents' THEN required:=required||ARRAY['document_management']; WHEN 'multiunit' THEN NULL; ELSE RAISE EXCEPTION 'Invalid goals' USING ERRCODE='22023'; END CASE;
 END LOOP;
 IF lead.payload->>'freeMarket' IN ('yes','partial') THEN required:=required||ARRAY['free_market_management']; END IF;
 IF lead.payload->>'buysEnergy'='true' THEN required:=required||ARRAY['trading_hub']; END IF;
 modules:='{}'::jsonb;
 FOREACH goal IN ARRAY ARRAY['client_portal','document_management','advanced_analytics','report_generation','free_market_management','bot_energy_rag','trading_hub','ccee_registrations'] LOOP
  modules:=modules||jsonb_build_object(goal,coalesce(to_jsonb(plan)->goal,'false'::jsonb));
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_extras) e WHERE jsonb_typeof(e)<>'string') OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_extras))<>jsonb_array_length(p_extras) THEN RAISE EXCEPTION 'Invalid selected extras' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(e),'[]'::jsonb),coalesce(sum(CASE WHEN e->>'recurrence'='MONTHLY' THEN (e->>'cents')::numeric ELSE 0 END),0),coalesce(sum(CASE WHEN e->>'recurrence'='ONCE' THEN (e->>'cents')::numeric ELSE 0 END),0) INTO selected,monthly_extra,once_extra FROM jsonb_array_elements(policy.definition->'extras') e WHERE p_extras ? (e->>'code');
 IF jsonb_array_length(selected)<>jsonb_array_length(p_extras) THEN RAISE EXCEPTION 'Unknown extra' USING ERRCODE='22023'; END IF;
 -- Legacy extras remain price-only. Structured extras compose this offer, never a license.
 base_modules:=modules;
 documents_limit:=CASE WHEN coalesce((to_jsonb(plan)->>'documents_unlimited')::boolean,false) THEN NULL ELSE (to_jsonb(plan)->>'documents_limit')::integer END;
 FOR extra IN SELECT value FROM jsonb_array_elements(selected) LOOP
  IF extra ? 'requires' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(extra->'requires') d WHERE NOT p_extras ? d) THEN RAISE EXCEPTION 'Required extra missing' USING ERRCODE='22023'; END IF;
  IF extra ? 'module' THEN modules:=modules||jsonb_build_object(extra->>'module',true); END IF;
  IF extra ? 'documentsLimit' THEN
   IF documents_limit IS NULL OR (extra->>'documentsLimit')::integer<=documents_limit THEN RAISE EXCEPTION 'Invalid document upgrade' USING ERRCODE='22023'; END IF;
   documents_limit:=(extra->>'documentsLimit')::integer;
  END IF;
 END LOOP;
 -- OCR add-on requires an explicitly selected, priced document package of at least 800.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(selected) x WHERE x->>'module'='advanced_analytics') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(selected) x WHERE (x->>'documentsLimit')::integer>=800) THEN RAISE EXCEPTION 'OCR requires documents 800' USING ERRCODE='22023'; END IF;
 FOREACH goal IN ARRAY required LOOP
  IF modules->goal IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Required module missing' USING ERRCODE='22023'; END IF;
 END LOOP;
 base:=(policy.definition->>'monthlyCents')::numeric*CASE WHEN policy.definition->>'basis'='UNIT' THEN units ELSE 1 END;
 -- Discount applies to base subscription only; recurring extras have no implicit discount.
 annual:=round(base*12*(10000-(policy.definition->>'annualDiscountBps')::numeric)/10000,0)+monthly_extra*12;
 IF greatest(base+monthly_extra+once_extra,annual+once_extra)>9000000000000 THEN RAISE EXCEPTION 'Amount limit exceeded' USING ERRCODE='22023'; END IF;
 snapshot:=jsonb_build_object('engineVersion','commercial-composition-v2','baseModules',base_modules,'documentsLimit',documents_limit,'leadRequirements',jsonb_build_object('goals',lead.payload->'goals','freeMarket',lead.payload->'freeMarket','buysEnergy',lead.payload->'buysEnergy'),'optionalModules',(SELECT coalesce(jsonb_agg(x->>'module'),'[]'::jsonb) FROM jsonb_array_elements(selected) x WHERE x ? 'module'),'planId',p_plan,'planName',plan.name,'planVersion',plan.version,'policyVersion',policy.version,'policy',policy.definition,'units',units,'users',users,'modules',modules,'solarReviewRequired',coalesce((lead.payload->>'solar')::boolean,false),'cycle',p_cycle,'extraCodes',p_extras,'extras',selected,'currency','BRL','monthlyBaseCents',base,'monthlyRecurringCents',base+monthly_extra,'annualRecurringCents',annual,'oneTimeCents',once_extra,'initialTotalCents',CASE WHEN p_cycle='ANNUAL' THEN annual ELSE base+monthly_extra END+once_extra,'justification',p_justification,'methodology','Base anual: mensal × 12 com desconto em pontos-base, arredondamento half-up em centavos; adicionais recorrentes sem desconto e únicos somados uma vez.');
 RETURN snapshot;
END $$;
REVOKE ALL ON FUNCTION public.build_platform_sales_snapshot(uuid,uuid,integer,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.create_platform_sales_proposal(p_actor uuid,p_id uuid,p_receipt uuid,p_plan uuid,p_policy_version integer,p_cycle text,p_extras jsonb,p_justification text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy public.platform_sales_policies; plan public.plan_catalog; lead public.platform_sales_leads; saved public.platform_sales_proposals;
 units integer; users integer; base numeric; monthly_extra numeric; once_extra numeric; annual numeric; snapshot jsonb; selected jsonb; modules jsonb; required text[]; goal text; extra jsonb; base_modules jsonb; documents_limit integer;
BEGIN
 PERFORM 1 FROM public.platform_team_members WHERE user_id=p_actor FOR SHARE;
 PERFORM public.platform_team_owner(p_actor);
 IF p_id IS NULL OR p_receipt IS NULL OR p_plan IS NULL OR p_policy_version IS NULL OR p_cycle IS NULL OR p_cycle NOT IN ('MONTHLY','ANNUAL') OR p_extras IS NULL OR jsonb_typeof(p_extras)<>'array' OR jsonb_array_length(p_extras)>20 OR p_justification IS NULL OR length(btrim(p_justification)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Invalid proposal' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('commercial-proposal:'||p_id::text,0));
 SELECT * INTO saved FROM public.platform_sales_proposals WHERE id=p_id;
 IF FOUND THEN
  IF saved.actor_id<>p_actor OR saved.receipt<>p_receipt OR saved.snapshot->>'planId'<>p_plan::text OR (saved.snapshot->>'policyVersion')::integer<>p_policy_version OR saved.snapshot->>'cycle'<>p_cycle OR saved.snapshot->'extraCodes'<>p_extras OR saved.snapshot->>'justification'<>p_justification THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='P3611'; END IF;
  RETURN to_jsonb(saved);
 END IF;
 -- Same lock as erasure/submission: no proposal can mint from a retired contact.
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-receipt:'||p_receipt::text,0));
 SELECT * INTO lead FROM public.platform_sales_leads WHERE receipt=p_receipt FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Receipt missing' USING ERRCODE='P3610'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('commercial-policy:'||p_plan::text,0));
 snapshot:=public.build_platform_sales_snapshot(p_receipt,p_plan,p_policy_version,p_cycle,p_extras,p_justification);
 INSERT INTO public.platform_sales_proposals VALUES(p_id,p_receipt,snapshot,p_actor,now(),public.platform_sales_actor_name(p_actor)) RETURNING * INTO saved;
 INSERT INTO public.platform_sales_proposal_events VALUES(p_id,1,'DRAFT',p_actor,p_justification,now(),p_id,public.platform_sales_actor_name(p_actor));
 RETURN to_jsonb(saved);
END $$;
CREATE OR REPLACE FUNCTION public.read_platform_sales_commercial(p_actor uuid,p_receipt uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policies jsonb; plans jsonb; proposals jsonb;
BEGIN
 PERFORM 1 FROM public.platform_team_members WHERE user_id=p_actor FOR SHARE;
 PERFORM public.platform_team_owner(p_actor);
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.plan_id,p.version DESC),'[]'::jsonb) INTO policies FROM (SELECT DISTINCT ON(plan_id) * FROM public.platform_sales_policies ORDER BY plan_id,version DESC) p;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'version',version,'maxUnits',max_consumer_units,'maxUsers',max_users,'documentsLimit',CASE WHEN coalesce((to_jsonb(plan_catalog)->>'documents_unlimited')::boolean,false) THEN NULL ELSE (to_jsonb(plan_catalog)->>'documents_limit')::integer END) ORDER BY name),'[]'::jsonb) INTO plans FROM public.plan_catalog WHERE active;
 SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY version) FROM public.platform_sales_proposal_events e WHERE e.proposal_id=p.id)) ORDER BY p.created_at DESC),'[]'::jsonb) INTO proposals FROM (SELECT * FROM public.platform_sales_proposals WHERE receipt=p_receipt ORDER BY created_at DESC LIMIT 50) p;
 RETURN jsonb_build_object('plans',plans,'policies',policies,'proposals',proposals,'effectivePolicies',(SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (SELECT DISTINCT ON(s.plan_id) s.* FROM public.platform_sales_policies s JOIN public.plan_catalog c ON c.id=s.plan_id AND c.version=s.plan_version AND c.active WHERE ((now() AT TIME ZONE 'America/Sao_Paulo')::date) BETWEEN (s.definition->>'starts')::date AND (s.definition->>'ends')::date ORDER BY s.plan_id,s.version DESC) q));
END $$;

COMMIT;
