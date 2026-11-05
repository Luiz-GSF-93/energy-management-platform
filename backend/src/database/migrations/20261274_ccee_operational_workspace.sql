BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Add display names only to rows already allowed by the authoritative registration ACL.
DO $$DECLARE d text;old text:='to_jsonb(r)';BEGIN
 d:=pg_get_functiondef('public.read_ccee_registrations(text,text,uuid,boolean)'::regprocedure);
 IF strpos(d,'CCEE_REGISTRATION_NAMES')=0 THEN
  IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Registration projection changed';END IF;
  d:=replace(d,old,$replacement$(to_jsonb(r)||jsonb_build_object('customer_name',(SELECT company_name FROM public.customers c WHERE c.organization_id=p_org AND c.id=r.customer_id),'unit_name',(SELECT name FROM public.consumer_units u WHERE u.organization_id=p_org AND u.customer_id=r.customer_id AND u.id=r.consumer_unit_id),'consumer_unit_number',(SELECT consumer_unit_number FROM public.consumer_units u WHERE u.organization_id=p_org AND u.customer_id=r.customer_id AND u.id=r.consumer_unit_id))) /* CCEE_REGISTRATION_NAMES */$replacement$);EXECUTE d;
 END IF;
END$$;
ALTER TABLE public.operation_records ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false;
ALTER TABLE public.operation_records ADD COLUMN IF NOT EXISTS source_due_date date;
CREATE OR REPLACE FUNCTION public.ccee_preserve_day_only_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF OLD.all_day AND (NEW.starts_at,NEW.due_at,NEW.source_due_date,NEW.all_day) IS DISTINCT FROM (OLD.starts_at,OLD.due_at,OLD.source_due_date,OLD.all_day) THEN RAISE EXCEPTION 'Review the official calendar source before changing a date-only obligation' USING ERRCODE='42501';END IF;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.ccee_preserve_day_only_source() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS ccee_preserve_day_only_source ON public.operation_records;
CREATE TRIGGER ccee_preserve_day_only_source BEFORE UPDATE ON public.operation_records FOR EACH ROW EXECUTE FUNCTION public.ccee_preserve_day_only_source();
CREATE TABLE IF NOT EXISTS public.ccee_calendar_assignments(
 organization_id text NOT NULL REFERENCES public.organizations(id),item_code text NOT NULL,binding_id uuid NOT NULL REFERENCES public.ccee_unit_authorizations(id),
 version_id uuid NOT NULL REFERENCES public.ccee_calendar_versions(id),item_id uuid NOT NULL REFERENCES public.ccee_calendar_items(id),
 operation_id uuid NOT NULL REFERENCES public.operation_records(id),title text NOT NULL,month date NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,item_code,binding_id)
);
ALTER TABLE public.ccee_calendar_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_calendar_assignments FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ccee_apply_calendar(p_org text,p_actor text,p_version uuid,p_item uuid,p_binding uuid,p_responsible text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v public.ccee_calendar_versions;i public.ccee_calendar_items;b jsonb;req uuid;d jsonb;r jsonb;existing public.ccee_calendar_assignments;day date;anchor timestamptz;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'manage');
 SELECT * INTO v FROM public.ccee_calendar_versions WHERE id=p_version AND state='APPROVED' FOR SHARE;
 SELECT * INTO i FROM public.ccee_calendar_items WHERE id=p_item AND version_id=p_version;
 day:=coalesce(i.due_date,(i.due_at AT TIME ZONE 'America/Sao_Paulo')::date);
 IF v.id IS NULL OR i.id IS NULL OR i.month IS NULL OR day IS NULL OR EXISTS(SELECT 1 FROM public.ccee_calendar_versions WHERE source_url=v.source_url AND state='APPROVED' AND created_at>v.created_at) OR coalesce(length(p_reason),0) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Calendar source changed or missing competence' USING ERRCODE='40001';END IF;
 b:=public.assert_ccee_data_binding(p_org,p_binding,i.month,'AGENDA');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||p_binding::text||i.code,192));
 SELECT * INTO existing FROM public.ccee_calendar_assignments WHERE organization_id=p_org AND item_code=i.code AND binding_id=p_binding;
 IF existing.operation_id IS NOT NULL THEN
  IF NOT public.acl_operation_allowed(p_org,p_actor,existing.operation_id,false) THEN RAISE EXCEPTION 'Agenda unavailable' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('id',existing.operation_id,'preserved',true,'versionId',existing.version_id);
 END IF;
 IF EXISTS(SELECT 1 FROM public.ccee_calendar_assignments a WHERE a.organization_id=p_org AND a.binding_id=p_binding AND a.title=i.title AND a.month=i.month) THEN RAISE EXCEPTION 'Previous obligation already associated; review its source and deadline before another association' USING ERRCODE='40001';END IF;
 IF i.deadline_precision='HOUR' AND i.due_at<=now() OR i.deadline_precision='DATE' AND day<(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'Calendar obligation is overdue; review source' USING ERRCODE='40001';END IF;
 -- Midnight is only the all-day positioning anchor. It is never stored as a deadline.
 anchor:=CASE WHEN i.deadline_precision='DATE' THEN day::timestamp AT TIME ZONE 'America/Sao_Paulo' ELSE i.due_at END;
 req:=md5(p_org||p_version::text||p_item::text||p_binding::text)::uuid;
 d:=jsonb_build_object('requestId',req,'revision',0,'reason',p_reason,'title',i.title,'description','Fonte CCEE: '||v.source_url||' · versão '||v.id||' · linha '||i.source_row||' · SHA-256 '||v.source_hash||'. Aplicabilidade conferida pelo operador: '||i.applicability||CASE WHEN i.deadline_precision='DATE' THEN '. Data oficial: '||day||'; horário limite não informado.' ELSE '' END||'. Não comprova cumprimento na CCEE.','priority','HIGH','customerId',b->>'customer_id','unitId',b->>'consumer_unit_id','responsibleId',p_responsible,'startsAt',anchor,'endsAt',NULL,'dueAt',i.due_at);
 r:=public.save_operation_record(p_org,p_actor,'agenda',NULL,req,0,p_reason,d);
 IF NOT EXISTS(SELECT 1 FROM public.operation_records WHERE id=(r->>'id')::uuid AND organization_id=p_org) THEN RAISE EXCEPTION 'Agenda result unconfirmed';END IF;
 UPDATE public.operation_records SET all_day=i.deadline_precision='DATE',source_due_date=day WHERE id=(r->>'id')::uuid AND organization_id=p_org;
 INSERT INTO public.ccee_calendar_assignments VALUES(p_org,i.code,p_binding,p_version,p_item,(r->>'id')::uuid,i.title,i.month,now());
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details)VALUES(p_org,p_actor,'CALENDAR_ASSIGNED',req,jsonb_build_object('versionId',v.id,'itemId',i.id,'bindingId',p_binding,'precision',i.deadline_precision,'dueDate',day)) ON CONFLICT(request_id) DO NOTHING;
 RETURN r||jsonb_build_object('all_day',i.deadline_precision='DATE','source_due_date',day);
END$$;
CREATE OR REPLACE FUNCTION public.ccee_calendar_assign_batch(p_org text,p_actor text,p_version uuid,p_item uuid,p_bindings uuid[],p_responsible text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b uuid;r jsonb:='[]';BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'manage');
 IF p_bindings IS NULL OR cardinality(p_bindings) NOT BETWEEN 1 AND 20 OR cardinality(p_bindings)<>(SELECT count(DISTINCT x) FROM unnest(p_bindings)x) THEN RAISE EXCEPTION 'Invalid calendar batch' USING ERRCODE='22023';END IF;
 FOREACH b IN ARRAY p_bindings LOOP r:=r||jsonb_build_array(public.ccee_apply_calendar(p_org,p_actor,p_version,p_item,b,p_responsible,p_reason));END LOOP;
 RETURN jsonb_build_object('organizationId',p_org,'rows',r);
END$$;
-- CNPJ lookup budget: legacy policies remain bounded; recurring mode is explicit and organization-scoped.
CREATE OR REPLACE FUNCTION public.ccee_customer_discovery_budget(p_org text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p jsonb;total integer;used integer;lim integer;mode text;start_day timestamptz;
BEGIN
 SELECT details INTO p FROM public.ccee_integration_events WHERE organization_id=p_org AND event='CUSTOMER_DISCOVERY_POLICY' ORDER BY recorded_at DESC,id DESC LIMIT 1;
 mode:=coalesce(p->>'mode','LEGACY');start_day:=((now() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo';
 SELECT count(*) INTO total FROM public.ccee_integration_events WHERE organization_id=p_org AND event='CUSTOMER_DISCOVERY_REQUEST_RESERVED';
 IF mode='DAILY' THEN lim:=20;SELECT count(*) INTO used FROM public.ccee_integration_events WHERE organization_id=p_org AND event='CUSTOMER_DISCOVERY_REQUEST_RESERVED' AND recorded_at>=start_day;
 ELSIF mode='HOMOLOGATION' THEN lim:=10;used:=greatest(0,total-coalesce((p->>'baseline')::integer,total));
 ELSE lim:=23;used:=total;END IF;
 RETURN jsonb_build_object('mode',mode,'limit',lim,'used',used,'remaining',greatest(0,lim-used),'totalReserved',total,'nextBudgetAt',CASE WHEN mode='DAILY' THEN start_day+interval '1 day' ELSE NULL END);
END$$;
CREATE OR REPLACE FUNCTION public.ccee_customer_discovery_recurring_control(p_org text,p_actor text,p_enabled boolean,p_mode text,p_reason text,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d jsonb;old public.ccee_integration_events;baseline integer;BEGIN
 PERFORM public.ccee_permanent_automation_actor(p_org,p_actor);
 IF p_org<>'org_default' OR p_mode NOT IN('DAILY','HOMOLOGATION') OR p_enabled IS NULL OR p_request IS NULL OR length(coalesce(p_reason,'')) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Invalid recurring lookup policy' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-discovery-control:'||p_org,0));
 SELECT * INTO old FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF old.actor_id<>p_actor OR old.event<>'CUSTOMER_DISCOVERY_POLICY' OR old.details->>'mode'<>p_mode OR old.details->>'reason'<>p_reason OR (old.details->>'enabled')::boolean<>p_enabled THEN RAISE EXCEPTION 'Changed policy request' USING ERRCODE='40001';END IF;RETURN old.details;END IF;
 IF p_mode='DAILY' AND NOT EXISTS(SELECT 1 FROM public.ccee_customer_discovery WHERE organization_id=p_org AND result->'complete'='true' AND state='REPRESENTATION_PENDING') THEN RAISE EXCEPTION 'Confirmed participant lookup required before recurring mode' USING ERRCODE='42501';END IF;
 SELECT count(*) INTO baseline FROM public.ccee_integration_events WHERE organization_id=p_org AND event='CUSTOMER_DISCOVERY_REQUEST_RESERVED';
 IF p_mode='HOMOLOGATION' AND EXISTS(SELECT 1 FROM public.ccee_integration_events WHERE organization_id=p_org AND event='CUSTOMER_DISCOVERY_POLICY' AND details->>'mode'='HOMOLOGATION') THEN RAISE EXCEPTION 'Homologation batch already configured; retain its baseline' USING ERRCODE='40001';END IF;
 d:=jsonb_build_object('enabled',p_enabled,'reason',p_reason,'mode',p_mode,'baseline',baseline,'dailyLimit',20,'homologationLimit',10,'actorId',p_actor,'requestId',p_request);
 INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details)VALUES(p_org,p_actor,'CUSTOMER_DISCOVERY_POLICY',p_request,d);RETURN d;
END$$;
DO $$DECLARE d text;sig text;before text;BEGIN
 FOREACH sig IN ARRAY ARRAY['public.ccee_customer_discovery_claim()','public.ccee_customer_discovery_reserve(uuid,uuid)','public.ccee_customer_discovery_retry(text,text,uuid,text,uuid,boolean)'] LOOP
  d:=pg_get_functiondef(sig::regprocedure);before:=d;
  IF strpos(d,'CCEE_LOOKUP_BUDGET_V2')=0 THEN
   IF sig LIKE '%claim%' THEN d:=replace(d,$frag$(SELECT count(*) FROM public.ccee_integration_events WHERE organization_id='org_default' AND event='CUSTOMER_DISCOVERY_REQUEST_RESERVED')>=23$frag$,$frag$(public.ccee_customer_discovery_budget('org_default')->>'remaining')::integer<=0 /* CCEE_LOOKUP_BUDGET_V2 */$frag$);
   ELSIF sig LIKE '%reserve%' THEN d:=replace(d,'used>=23',$frag$(public.ccee_customer_discovery_budget(j.organization_id)->>'remaining')::integer<=0 /* CCEE_LOOKUP_BUDGET_V2 */$frag$);
   ELSE d:=replace(d,$frag$(SELECT count(*) FROM public.ccee_integration_events WHERE organization_id=p_org AND event='CUSTOMER_DISCOVERY_REQUEST_RESERVED')>=23$frag$,$frag$(public.ccee_customer_discovery_budget(p_org)->>'remaining')::integer<=0 /* CCEE_LOOKUP_BUDGET_V2 */$frag$);END IF;
   IF d=before THEN RAISE EXCEPTION 'Lookup budget definition changed: %',sig;END IF;EXECUTE d;
  END IF;
 END LOOP;
 -- Preserve recurring mode and its original baseline whenever a functional failure pauses the worker.
 FOREACH sig IN ARRAY ARRAY['public.ccee_customer_discovery_claim()','public.ccee_customer_discovery_finish(uuid,uuid,jsonb,text)'] LOOP
  d:=pg_get_functiondef(sig::regprocedure);
  d:=replace(d,$frag$jsonb_build_object('enabled',false,'reason',reason_text,'homologationLimit',23)$frag$,$frag$coalesce((SELECT details FROM public.ccee_integration_events WHERE organization_id=j.organization_id AND event='CUSTOMER_DISCOVERY_POLICY' ORDER BY recorded_at DESC,id DESC LIMIT 1),'{}'::jsonb)||jsonb_build_object('enabled',false,'reason',reason_text)$frag$);
  d:=replace(d,$frag$jsonb_build_object('enabled',false,'reason','Execução interrompida; confira os efeitos antes de retomar.','homologationLimit',23)$frag$,$frag$policy.details||jsonb_build_object('enabled',false,'reason','Execução interrompida; confira os efeitos antes de retomar.')$frag$);EXECUTE d;
 END LOOP;
 d:=pg_get_functiondef('public.ccee_customer_discovery_read(text,text,integer)'::regprocedure);
 IF strpos(d,'lookupBudget')=0 THEN d:=replace(d,$frag$'page',p_page$frag$, $frag$'page',p_page,'lookupBudget',public.ccee_customer_discovery_budget(p_org)$frag$);EXECUTE d;END IF;
END$$;
DO $$DECLARE d text;old text;replacement text;BEGIN
 d:=pg_get_functiondef('public.ccee_customer_discovery_control(text,text,boolean,text,uuid)'::regprocedure);
 old:=$old$v:=jsonb_build_object('organizationId',p_org,'actorId',p_actor,'enabled',p_enabled,'reason',p_reason,'homologationLimit',23);$old$;
 replacement:=$new$v:=jsonb_build_object('homologationLimit',23)||coalesce((SELECT details FROM public.ccee_integration_events WHERE organization_id=p_org AND event='CUSTOMER_DISCOVERY_POLICY' ORDER BY recorded_at DESC,id DESC LIMIT 1),'{}'::jsonb)||jsonb_build_object('organizationId',p_org,'actorId',p_actor,'enabled',p_enabled,'reason',p_reason,'requestId',p_request); /* Preserve authorized budget mode and baseline */$new$;
 IF strpos(d,'Preserve authorized budget')=0 THEN IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Discovery control changed';END IF;EXECUTE replace(d,old,replacement);END IF;
END$$;
REVOKE ALL ON FUNCTION public.ccee_customer_discovery_budget(text),public.ccee_customer_discovery_recurring_control(text,text,boolean,text,text,uuid),public.ccee_calendar_assign_batch(text,text,uuid,uuid,uuid[],text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ccee_customer_discovery_recurring_control(text,text,boolean,text,text,uuid),public.ccee_calendar_assign_batch(text,text,uuid,uuid,uuid[],text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
