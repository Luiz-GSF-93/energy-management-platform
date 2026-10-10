BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Internal commercial records only. No relation to licenses, billing or tenant data.
CREATE TABLE IF NOT EXISTS public.platform_sales_policies(
 plan_id uuid NOT NULL, version integer NOT NULL CHECK(version>0), plan_version integer NOT NULL,
 definition jsonb NOT NULL, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 request_id uuid NOT NULL UNIQUE, actor_name text, PRIMARY KEY(plan_id,version)
);
CREATE TABLE IF NOT EXISTS public.platform_sales_proposals(
 id uuid PRIMARY KEY, receipt uuid NOT NULL, snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), actor_name text
);
-- receipt intentionally has no FK: erasure of a contact must remain possible.
CREATE TABLE IF NOT EXISTS public.platform_sales_proposal_events(
 proposal_id uuid NOT NULL REFERENCES public.platform_sales_proposals(id), version integer NOT NULL,
 status text NOT NULL CHECK(status IN ('DRAFT','CHECKED','APPROVED_INTERNAL')),
 actor_id uuid NOT NULL, justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 5 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(), request_id uuid NOT NULL UNIQUE, actor_name text,
 PRIMARY KEY(proposal_id,version)
);
ALTER TABLE public.platform_sales_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sales_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sales_proposal_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_sales_policies,public.platform_sales_proposals,public.platform_sales_proposal_events FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.platform_sales_commercial_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Preserved commercial record' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION public.platform_sales_commercial_immutable() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_policies','platform_sales_proposals','platform_sales_proposal_events'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.platform_sales_actor_name(p_actor uuid) RETURNS text
LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT coalesce(nullif(btrim(concat_ws(' ',to_jsonb(t)->>'first_name',to_jsonb(t)->>'last_name')),''),nullif(btrim(to_jsonb(p)->>'full_name'),''))
 FROM public.platform_team_members t LEFT JOIN public.user_profiles p ON p.user_id=t.user_id WHERE t.user_id=p_actor;
$$;
REVOKE ALL ON FUNCTION public.platform_sales_actor_name(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.save_platform_sales_policy(p_actor uuid,p_request uuid,p_plan uuid,p_expected integer,p_plan_version integer,p_definition jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE plan public.plan_catalog; previous public.platform_sales_policies; saved public.platform_sales_policies; current_version integer; extra jsonb; n integer;
BEGIN
 PERFORM 1 FROM public.platform_team_members WHERE user_id=p_actor FOR SHARE;
 PERFORM public.platform_team_owner(p_actor);
 IF p_request IS NULL OR p_plan IS NULL OR p_expected IS NULL OR p_expected<0 OR p_definition IS NULL OR jsonb_typeof(p_definition)<>'object' THEN RAISE EXCEPTION 'Invalid policy' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('commercial-policy:'||p_plan::text,0));
 SELECT * INTO saved FROM public.platform_sales_policies WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.actor_id<>p_actor OR saved.plan_id<>p_plan OR saved.version<>p_expected+1 OR saved.plan_version<>p_plan_version OR saved.definition<>p_definition THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='P3611'; END IF;
  RETURN to_jsonb(saved);
 END IF;
 SELECT * INTO plan FROM public.plan_catalog WHERE id=p_plan FOR SHARE;
 IF NOT FOUND OR NOT plan.active THEN RAISE EXCEPTION 'Active plan missing' USING ERRCODE='P3610'; END IF;
 IF plan.version IS DISTINCT FROM p_plan_version THEN RAISE EXCEPTION 'Plan changed' USING ERRCODE='P3611'; END IF;
 SELECT coalesce(max(version),0) INTO current_version FROM public.platform_sales_policies WHERE plan_id=p_plan;
 IF current_version<>p_expected THEN RAISE EXCEPTION 'Policy changed' USING ERRCODE='P3611'; END IF;
 IF p_definition - ARRAY['basis','minUnits','maxUnits','maxUsers','monthlyCents','annualDiscountBps','starts','ends','extras','taxTerms','justification'] <> '{}'::jsonb
 OR NOT p_definition ?& ARRAY['basis','minUnits','maxUnits','maxUsers','monthlyCents','annualDiscountBps','starts','ends','extras','taxTerms','justification']
 OR p_definition->>'basis' NOT IN ('PACKAGE','UNIT') OR jsonb_typeof(p_definition->'basis')<>'string'
 OR jsonb_typeof(p_definition->'extras')<>'array' OR jsonb_array_length(p_definition->'extras')>20
 OR jsonb_typeof(p_definition->'taxTerms')<>'string' OR length(btrim(p_definition->>'taxTerms')) NOT BETWEEN 5 AND 1000
 OR jsonb_typeof(p_definition->'justification')<>'string' OR length(btrim(p_definition->>'justification')) NOT BETWEEN 5 AND 1000
 OR jsonb_typeof(p_definition->'starts')<>'string' OR p_definition->>'starts' !~ '^\d{4}-\d{2}-\d{2}$'
 OR jsonb_typeof(p_definition->'ends')<>'string' OR p_definition->>'ends' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid policy fields' USING ERRCODE='22023'; END IF;
 FOREACH extra IN ARRAY ARRAY[p_definition->'minUnits',p_definition->'maxUnits',p_definition->'maxUsers',p_definition->'monthlyCents',p_definition->'annualDiscountBps'] LOOP
  IF jsonb_typeof(extra)<>'number' OR extra::text !~ '^\d+$' OR extra::numeric>1000000000 THEN RAISE EXCEPTION 'Integer required' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF (p_definition->>'minUnits')::integer<1 OR (p_definition->>'maxUnits')::integer<(p_definition->>'minUnits')::integer
 OR (p_definition->>'maxUnits')::integer>plan.max_consumer_units OR (p_definition->>'maxUsers')::integer NOT BETWEEN 1 AND plan.max_users
 OR (p_definition->>'monthlyCents')::integer<1 OR (p_definition->>'annualDiscountBps')::integer>10000
 OR (p_definition->>'ends')::date<(p_definition->>'starts')::date THEN RAISE EXCEPTION 'Invalid policy limits' USING ERRCODE='22023'; END IF;
 FOR extra IN SELECT value FROM jsonb_array_elements(p_definition->'extras') LOOP
  IF jsonb_typeof(extra)<>'object' OR extra - ARRAY['code','label','cents','recurrence'] <> '{}'::jsonb
  OR NOT extra ?& ARRAY['code','label','cents','recurrence'] OR jsonb_typeof(extra->'code')<>'string' OR extra->>'code' !~ '^[a-z0-9_-]{1,40}$'
  OR jsonb_typeof(extra->'label')<>'string' OR length(btrim(extra->>'label')) NOT BETWEEN 2 AND 120
  OR jsonb_typeof(extra->'cents')<>'number' OR (extra->'cents')::text !~ '^\d+$' OR (extra->>'cents')::numeric>1000000000
  OR jsonb_typeof(extra->'recurrence')<>'string' OR extra->>'recurrence' NOT IN ('MONTHLY','ONCE') THEN RAISE EXCEPTION 'Invalid extra' USING ERRCODE='22023'; END IF;
 END LOOP;
 SELECT count(DISTINCT value->>'code') INTO n FROM jsonb_array_elements(p_definition->'extras');
 IF n<>jsonb_array_length(p_definition->'extras') THEN RAISE EXCEPTION 'Duplicate extra' USING ERRCODE='22023'; END IF;
 INSERT INTO public.platform_sales_policies VALUES(p_plan,current_version+1,p_plan_version,p_definition,p_actor,now(),p_request,public.platform_sales_actor_name(p_actor)) RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;
CREATE OR REPLACE FUNCTION public.create_platform_sales_proposal(p_actor uuid,p_id uuid,p_receipt uuid,p_plan uuid,p_policy_version integer,p_cycle text,p_extras jsonb,p_justification text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy public.platform_sales_policies; plan public.plan_catalog; lead public.platform_sales_leads; saved public.platform_sales_proposals;
 units integer; users integer; base numeric; monthly_extra numeric; once_extra numeric; annual numeric; snapshot jsonb; selected jsonb; modules jsonb; required text[]; goal text;
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
 SELECT * INTO policy FROM public.platform_sales_policies WHERE plan_id=p_plan ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Policy missing' USING ERRCODE='P3610'; END IF;
 IF policy.version<>p_policy_version THEN RAISE EXCEPTION 'Policy changed' USING ERRCODE='P3611'; END IF;
 SELECT * INTO plan FROM public.plan_catalog WHERE id=p_plan FOR SHARE;
 IF NOT FOUND OR NOT plan.active THEN RAISE EXCEPTION 'Active plan missing' USING ERRCODE='P3610'; END IF;
 IF plan.version<>policy.plan_version THEN RAISE EXCEPTION 'Plan changed' USING ERRCODE='P3611'; END IF;
 units:=(lead.payload->>'units')::integer; users:=(lead.payload->>'users')::integer;
 IF units IS NULL OR users IS NULL OR units NOT BETWEEN (policy.definition->>'minUnits')::integer AND (policy.definition->>'maxUnits')::integer OR users NOT BETWEEN 1 AND (policy.definition->>'maxUsers')::integer OR CURRENT_DATE NOT BETWEEN (policy.definition->>'starts')::date AND (policy.definition->>'ends')::date THEN RAISE EXCEPTION 'Profile outside policy' USING ERRCODE='22023'; END IF;
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
 FOREACH goal IN ARRAY required LOOP
  IF modules->goal IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Required module missing' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_extras) e WHERE jsonb_typeof(e)<>'string') OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_extras))<>jsonb_array_length(p_extras) THEN RAISE EXCEPTION 'Invalid selected extras' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(e),'[]'::jsonb),coalesce(sum(CASE WHEN e->>'recurrence'='MONTHLY' THEN (e->>'cents')::numeric ELSE 0 END),0),coalesce(sum(CASE WHEN e->>'recurrence'='ONCE' THEN (e->>'cents')::numeric ELSE 0 END),0) INTO selected,monthly_extra,once_extra FROM jsonb_array_elements(policy.definition->'extras') e WHERE p_extras ? (e->>'code');
 IF jsonb_array_length(selected)<>jsonb_array_length(p_extras) THEN RAISE EXCEPTION 'Unknown extra' USING ERRCODE='22023'; END IF;
 base:=(policy.definition->>'monthlyCents')::numeric*CASE WHEN policy.definition->>'basis'='UNIT' THEN units ELSE 1 END;
 -- Discount applies to base subscription only; recurring extras have no implicit discount.
 annual:=round(base*12*(10000-(policy.definition->>'annualDiscountBps')::numeric)/10000,0)+monthly_extra*12;
 IF greatest(base+monthly_extra+once_extra,annual+once_extra)>9000000000000 THEN RAISE EXCEPTION 'Amount limit exceeded' USING ERRCODE='22023'; END IF;
 snapshot:=jsonb_build_object('engineVersion','commercial-cents-v1','planId',p_plan,'planName',plan.name,'planVersion',plan.version,'policyVersion',policy.version,'policy',policy.definition,'units',units,'users',users,'modules',modules,'solarReviewRequired',coalesce((lead.payload->>'solar')::boolean,false),'cycle',p_cycle,'extraCodes',p_extras,'extras',selected,'currency','BRL','monthlyBaseCents',base,'monthlyRecurringCents',base+monthly_extra,'annualRecurringCents',annual,'oneTimeCents',once_extra,'initialTotalCents',CASE WHEN p_cycle='ANNUAL' THEN annual ELSE base+monthly_extra END+once_extra,'justification',p_justification,'methodology','Base anual: mensal × 12 com desconto em pontos-base, arredondamento half-up em centavos; adicionais recorrentes sem desconto e únicos somados uma vez.');
 INSERT INTO public.platform_sales_proposals VALUES(p_id,p_receipt,snapshot,p_actor,now(),public.platform_sales_actor_name(p_actor)) RETURNING * INTO saved;
 INSERT INTO public.platform_sales_proposal_events VALUES(p_id,1,'DRAFT',p_actor,p_justification,now(),p_id,public.platform_sales_actor_name(p_actor));
 RETURN to_jsonb(saved);
END $$;
CREATE OR REPLACE FUNCTION public.transition_platform_sales_proposal(p_actor uuid,p_request uuid,p_id uuid,p_expected integer,p_status text,p_justification text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_event public.platform_sales_proposal_events; saved public.platform_sales_proposal_events;
BEGIN
 PERFORM 1 FROM public.platform_team_members WHERE user_id=p_actor FOR SHARE;
 PERFORM public.platform_team_owner(p_actor);
 IF p_request IS NULL OR p_id IS NULL OR p_expected IS NULL OR p_status IS NULL OR p_justification IS NULL OR length(btrim(p_justification)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('commercial-proposal:'||p_id::text,0));
 SELECT * INTO saved FROM public.platform_sales_proposal_events WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.actor_id<>p_actor OR saved.proposal_id<>p_id OR saved.version<>p_expected+1 OR saved.status<>p_status OR saved.justification<>p_justification THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='P3611'; END IF;
  RETURN to_jsonb(saved);
 END IF;
 SELECT * INTO current_event FROM public.platform_sales_proposal_events WHERE proposal_id=p_id ORDER BY version DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Proposal missing' USING ERRCODE='P3610'; END IF;
 IF current_event.version<>p_expected THEN RAISE EXCEPTION 'Proposal changed' USING ERRCODE='P3611'; END IF;
 IF NOT ((current_event.status='DRAFT' AND p_status='CHECKED') OR (current_event.status='CHECKED' AND p_status='APPROVED_INTERNAL')) THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
 INSERT INTO public.platform_sales_proposal_events VALUES(p_id,p_expected+1,p_status,p_actor,p_justification,now(),p_request,public.platform_sales_actor_name(p_actor)) RETURNING * INTO saved;
 RETURN to_jsonb(saved);
END $$;
CREATE OR REPLACE FUNCTION public.read_platform_sales_commercial(p_actor uuid,p_receipt uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policies jsonb; plans jsonb; proposals jsonb;
BEGIN
 PERFORM 1 FROM public.platform_team_members WHERE user_id=p_actor FOR SHARE;
 PERFORM public.platform_team_owner(p_actor);
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.plan_id,p.version DESC),'[]'::jsonb) INTO policies FROM (SELECT DISTINCT ON(plan_id) * FROM public.platform_sales_policies ORDER BY plan_id,version DESC) p;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'version',version,'maxUnits',max_consumer_units,'maxUsers',max_users) ORDER BY name),'[]'::jsonb) INTO plans FROM public.plan_catalog WHERE active;
 SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY version) FROM public.platform_sales_proposal_events e WHERE e.proposal_id=p.id)) ORDER BY p.created_at DESC),'[]'::jsonb) INTO proposals FROM (SELECT * FROM public.platform_sales_proposals WHERE receipt=p_receipt ORDER BY created_at DESC LIMIT 50) p;
 RETURN jsonb_build_object('plans',plans,'policies',policies,'proposals',proposals);
END $$;
REVOKE ALL ON FUNCTION public.save_platform_sales_policy(uuid,uuid,uuid,integer,integer,jsonb),public.create_platform_sales_proposal(uuid,uuid,uuid,uuid,integer,text,jsonb,text),public.transition_platform_sales_proposal(uuid,uuid,uuid,integer,text,text),public.read_platform_sales_commercial(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_platform_sales_policy(uuid,uuid,uuid,integer,integer,jsonb),public.create_platform_sales_proposal(uuid,uuid,uuid,uuid,integer,text,jsonb,text),public.transition_platform_sales_proposal(uuid,uuid,uuid,integer,text,text),public.read_platform_sales_commercial(uuid,uuid) TO service_role;
COMMIT;
