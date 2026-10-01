BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.tariff_library_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 root_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),previous_id uuid REFERENCES public.tariff_library_versions(id),
 profile jsonb NOT NULL CHECK(jsonb_typeof(profile)='object'),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1500),
 created_by text NOT NULL CHECK(length(btrim(created_by))>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,root_id,version)
);
CREATE INDEX tariff_library_org ON public.tariff_library_versions(organization_id,root_id,version DESC);
CREATE TABLE public.tariff_library_applications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 library_id uuid NOT NULL REFERENCES public.tariff_library_versions(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 request_hash text NOT NULL,parameter_ids uuid[] NOT NULL,monthly_cost_id uuid REFERENCES public.calculation_monthly_costs(id),settings jsonb NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,consumer_unit_id,request_hash)
);
ALTER TABLE public.tariff_library_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tariff_library_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tariff_library_versions,public.tariff_library_applications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.tariff_library_versions,public.tariff_library_applications TO service_role;
CREATE FUNCTION public.preserve_tariff_library() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P1352',MESSAGE='Immutable tariff library history'; END $$;
CREATE TRIGGER tariff_library_immutable BEFORE UPDATE OR DELETE ON public.tariff_library_versions FOR EACH ROW EXECUTE FUNCTION public.preserve_tariff_library();
CREATE TRIGGER tariff_library_application_immutable BEFORE UPDATE OR DELETE ON public.tariff_library_applications FOR EACH ROW EXECUTE FUNCTION public.preserve_tariff_library();
CREATE FUNCTION public.save_tariff_library(p_org text,p_actor text,p_profile jsonb,p_reason text,p_previous uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old public.tariff_library_versions; result public.tariff_library_versions; root uuid; n integer;
BEGIN
 IF nullif(btrim(p_actor),'') IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1351',MESSAGE='Actor and reason required'; END IF;
 IF p_previous IS NULL THEN root:=gen_random_uuid();n:=1;
 ELSE
  SELECT * INTO old FROM public.tariff_library_versions WHERE id=p_previous AND organization_id=p_org;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1353',MESSAGE='Library not found'; END IF;
  root:=old.root_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':tariff-library:'||root::text,0));
  IF EXISTS(SELECT 1 FROM public.tariff_library_versions WHERE organization_id=p_org AND root_id=root AND version>old.version) THEN RAISE EXCEPTION USING ERRCODE='P1352',MESSAGE='Stale library version'; END IF;
  n:=old.version+1;
 END IF;
 INSERT INTO public.tariff_library_versions(organization_id,root_id,version,previous_id,profile,reason,created_by) VALUES(p_org,root,n,p_previous,p_profile,p_reason,p_actor) RETURNING * INTO result;
 RETURN to_jsonb(result);
END $$;
CREATE FUNCTION public.apply_tariff_library(p_org text,p_actor text,p_library uuid,p_unit text,p_hash text,p_settings jsonb,p_rows jsonb,p_context jsonb,p_costs jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE lib public.tariff_library_versions; u public.consumer_units; app public.tariff_library_applications; prior public.calculation_monthly_costs; r jsonb; ids uuid[]:='{}'; context jsonb; cost_id uuid; cost_month text; cost_body jsonb;
BEGIN
 IF nullif(btrim(p_actor),'') IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION USING ERRCODE='P1351',MESSAGE='Invalid application'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':tariff-library-unit:'||p_unit,0));
 SELECT * INTO lib FROM public.tariff_library_versions WHERE id=p_library AND organization_id=p_org;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1353',MESSAGE='Library not found'; END IF;
 SELECT * INTO u FROM public.consumer_units WHERE id=p_unit AND organization_id=p_org FOR SHARE;
 IF NOT FOUND OR u.status<>'ACTIVE' OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=u.customer_id AND organization_id=p_org AND deleted_at IS NULL AND status='ACTIVE') THEN RAISE EXCEPTION USING ERRCODE='P1353',MESSAGE='Unit not found'; END IF;
 context:=jsonb_build_object('distributor',u.distributor,'tariff_group',u.tariff_group,'tariff_subgroup',u.tariff_subgroup,'tariff_modality',u.tariff_modality,'state',u.state,'consumption_class',u.consumption_class,'free_market',u.free_market);
 IF context IS DISTINCT FROM p_context THEN RAISE EXCEPTION USING ERRCODE='P1352',MESSAGE='Unit changed'; END IF;
 SELECT * INTO app FROM public.tariff_library_applications WHERE organization_id=p_org AND consumer_unit_id=p_unit AND request_hash=p_hash;
 IF FOUND THEN RETURN to_jsonb(app);END IF;
 IF (p_settings->>'startDate')::date<(lib.profile->>'startDate')::date OR (p_settings->>'endDate')::date>(lib.profile->>'endDate')::date THEN RAISE EXCEPTION USING ERRCODE='P1351',MESSAGE='Validity not covered'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  IF EXISTS(SELECT 1 FROM public.calculation_parameters x WHERE x.organization_id=p_org AND x.consumer_unit_id=p_unit AND x.status<>'RETIRED' AND x.kind=r->>'kind' AND x.component_code=r->>'component_code' AND x.scenario=r->>'scenario' AND (x.time_band=r->>'time_band' OR x.time_band='ALL' OR r->>'time_band'='ALL') AND x.start_date<=(r->>'end_date')::date AND x.end_date>=(r->>'start_date')::date) THEN RAISE EXCEPTION USING ERRCODE='P1354',MESSAGE='Existing parameters overlap; review existing versions';END IF;
  IF (r->>'start_date')::date<>(p_settings->>'startDate')::date OR (r->>'end_date')::date<>(p_settings->>'endDate')::date THEN RAISE EXCEPTION USING ERRCODE='P1351',MESSAGE='Invalid row dates'; END IF;
  INSERT INTO public.calculation_parameters(id,organization_id,customer_id,consumer_unit_id,kind,component_code,label,scenario,time_band,measure,amount_text,treatment,included_taxes,base_rule,direction,source,notes,start_date,end_date,unit_context,created_by,updated_by,status,embedded_tax_codes,tax_basis)
  VALUES((r->>'id')::uuid,p_org,u.customer_id,p_unit,r->>'kind',r->>'component_code',r->>'label',r->>'scenario',r->>'time_band',r->>'measure',r->>'amount_text',r->>'treatment',r->>'included_taxes',r->>'base_rule',r->>'direction',r->>'source',r->>'notes',(r->>'start_date')::date,(r->>'end_date')::date,context,p_actor,p_actor,'DRAFT',r->'embedded_tax_codes',nullif(r->'tax_basis','null'::jsonb));
  ids:=array_append(ids,(r->>'id')::uuid);
 END LOOP;
 IF jsonb_typeof(p_costs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_costs)>2 THEN RAISE EXCEPTION USING ERRCODE='P1351',MESSAGE='Invalid monthly costs';END IF;
 IF jsonb_array_length(p_costs)>0 THEN
  cost_month:=left(p_settings->>'startDate',7);
  IF cost_month<>left(p_settings->>'endDate',7) THEN RAISE EXCEPTION USING ERRCODE='P1351',MESSAGE='Monthly costs require one month';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||p_unit||':'||cost_month,136));
  SELECT * INTO prior FROM public.calculation_monthly_costs WHERE organization_id=p_org AND consumer_unit_id=p_unit AND month=cost_month ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND ((prior.costs->>'noCosts')::boolean OR EXISTS(SELECT 1 FROM jsonb_array_elements(prior.costs->'items') x WHERE x->>'scenario'=p_settings->>'scenario' AND x->>'category' IN ('OTHER','CHARGE'))) THEN RAISE EXCEPTION USING ERRCODE='P1354',MESSAGE='Review existing additional costs before importing'; END IF;
  cost_body:=jsonb_build_object('noCosts',false,'items',coalesce(prior.costs->'items','[]'::jsonb)||p_costs);
  IF prior.id IS NOT NULL AND prior.status='DRAFT' THEN
   IF prior.unit_context IS DISTINCT FROM (context-'consumption_class') THEN RAISE EXCEPTION USING ERRCODE='P1352',MESSAGE='Monthly cost context changed';END IF;
   UPDATE public.calculation_monthly_costs SET costs=cost_body,updated_by=p_actor,correction_reason=left('Biblioteca tarifária: '||(p_settings->>'reason'),2000) WHERE id=prior.id RETURNING id INTO cost_id;
  ELSE
   INSERT INTO public.calculation_monthly_costs(organization_id,customer_id,consumer_unit_id,month,previous_id,costs,source_reference,notes,correction_reason,unit_context,created_by,updated_by)
   VALUES(p_org,u.customer_id,p_unit,cost_month,prior.id,cost_body,'Biblioteca tarifária '||p_library::text||' v'||lib.version,left(p_settings->>'reason',2000),left('Importação da biblioteca: '||(p_settings->>'reason'),2000),context-'consumption_class',p_actor,p_actor) RETURNING id INTO cost_id;
  END IF;
 END IF;
 INSERT INTO public.tariff_library_applications(organization_id,library_id,consumer_unit_id,request_hash,parameter_ids,monthly_cost_id,settings,created_by) VALUES(p_org,p_library,p_unit,p_hash,ids,cost_id,p_settings,p_actor) RETURNING * INTO app;
 RETURN to_jsonb(app);
END $$;
REVOKE ALL ON FUNCTION public.preserve_tariff_library(),public.save_tariff_library(text,text,jsonb,text,uuid),public.apply_tariff_library(text,text,uuid,text,text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_tariff_library(text,text,jsonb,text,uuid),public.apply_tariff_library(text,text,uuid,text,text,jsonb,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
