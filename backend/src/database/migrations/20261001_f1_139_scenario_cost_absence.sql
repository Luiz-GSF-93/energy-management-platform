BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.calculation_cost_absences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id), customer_id text NOT NULL REFERENCES public.customers(id), consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 month text NOT NULL CHECK(month ~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$'),scenario text NOT NULL CHECK(scenario IN ('ACL','ACR')),absent boolean NOT NULL,
 version integer NOT NULL DEFAULT 1,previous_id uuid REFERENCES public.calculation_cost_absences(id),cost_id uuid REFERENCES public.calculation_monthly_costs(id),cost_revision integer,
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 2000),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 20 AND 2000),unit_context jsonb NOT NULL,
 created_by text NOT NULL CHECK(length(btrim(created_by))>0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,consumer_unit_id,month,scenario,version)
);
ALTER TABLE public.calculation_cost_absences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calculation_cost_absences FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.calculation_cost_absences TO service_role;
CREATE OR REPLACE FUNCTION public.guard_cost_absence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prior public.calculation_cost_absences; latest public.calculation_monthly_costs; u public.consumer_units;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION USING ERRCODE='P3602',MESSAGE='Preserve declaration history';END IF;
 SELECT x.* INTO u FROM public.consumer_units x JOIN public.customers c ON c.id=x.customer_id AND c.organization_id=x.organization_id WHERE x.id=NEW.consumer_unit_id AND x.organization_id=NEW.organization_id AND c.id=NEW.customer_id AND c.deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P3603',MESSAGE='Invalid organization scope';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id||':'||NEW.consumer_unit_id||':'||NEW.month,136));
 SELECT * INTO latest FROM public.calculation_monthly_costs WHERE organization_id=NEW.organization_id AND consumer_unit_id=NEW.consumer_unit_id AND month=NEW.month ORDER BY version DESC LIMIT 1 FOR UPDATE;
 IF NEW.cost_id IS DISTINCT FROM latest.id OR NEW.cost_revision IS DISTINCT FROM latest.revision THEN RAISE EXCEPTION USING ERRCODE='P3602',MESSAGE='Costs changed; reload';END IF;
 IF NEW.absent AND EXISTS(SELECT 1 FROM public.calculation_monthly_costs c CROSS JOIN LATERAL jsonb_array_elements(c.costs->'items') i WHERE c.organization_id=NEW.organization_id AND c.consumer_unit_id=NEW.consumer_unit_id AND c.month=NEW.month AND (c.id=latest.id OR c.id=(SELECT id FROM public.calculation_monthly_costs WHERE organization_id=NEW.organization_id AND consumer_unit_id=NEW.consumer_unit_id AND month=NEW.month AND status='VALIDATED' ORDER BY version DESC LIMIT 1)) AND i->>'scenario'=NEW.scenario AND i->>'category' NOT IN ('SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY')) THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Scenario contains additional costs';END IF;
 SELECT * INTO prior FROM public.calculation_cost_absences WHERE organization_id=NEW.organization_id AND consumer_unit_id=NEW.consumer_unit_id AND month=NEW.month AND scenario=NEW.scenario ORDER BY version DESC LIMIT 1;
 IF NEW.previous_id IS DISTINCT FROM prior.id THEN RAISE EXCEPTION USING ERRCODE='P3602',MESSAGE='Declaration changed; reload';END IF;
 NEW.version:=coalesce(prior.version,0)+1;NEW.created_at:=now();
 NEW.unit_context:=jsonb_build_object('distributor',u.distributor,'tariff_group',u.tariff_group,'tariff_subgroup',u.tariff_subgroup,'tariff_modality',u.tariff_modality,'state',u.state,'free_market',u.free_market);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_cost_absence() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER cost_absence_guard BEFORE INSERT OR UPDATE OR DELETE ON public.calculation_cost_absences FOR EACH ROW EXECUTE FUNCTION public.guard_cost_absence();
NOTIFY pgrst,'reload schema';
COMMIT;
