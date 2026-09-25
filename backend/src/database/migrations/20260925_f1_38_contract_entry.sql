-- F1.38: resumable contract entry, separate from operational records.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS public.contract_entry_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),customer_id text NOT NULL REFERENCES public.customers(id),kind text NOT NULL CHECK(kind IN ('distributor','supply','management','services')),
 deferred_steps jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(deferred_steps)='array'),payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=150000),issues jsonb NOT NULL CHECK(jsonb_typeof(issues)='array'),status text NOT NULL CHECK(status IN ('INCOMPLETE','DRAFT','REGISTERED')),
 revision integer NOT NULL DEFAULT 1,created_by text NOT NULL,updated_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),target_id text,registered_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.contract_entry_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entry_id uuid NOT NULL REFERENCES public.contract_entry_drafts(id),organization_id text NOT NULL,revision integer NOT NULL,actor_id text NOT NULL,snapshot jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),UNIQUE(entry_id,revision));
ALTER TABLE public.contract_entry_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_entry_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_entry_drafts,public.contract_entry_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.contract_entry_drafts TO service_role;
GRANT SELECT ON public.contract_entry_events TO service_role;
CREATE OR REPLACE FUNCTION public.guard_contract_entry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='P3802',MESSAGE='Preserve entry history';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=NEW.customer_id AND organization_id=NEW.organization_id AND deleted_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P3801',MESSAGE='Invalid customer scope';END IF;
 IF nullif(btrim(NEW.created_by),'') IS NULL OR nullif(btrim(NEW.updated_by),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3801',MESSAGE='Actor required';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status='REGISTERED' OR NEW.target_id IS NOT NULL OR NEW.registered_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3802',MESSAGE='Create entry first';END IF;
  NEW.revision:=1;NEW.created_at:=now();
 ELSE
  IF OLD.status='REGISTERED' OR ROW(NEW.id,NEW.organization_id,NEW.customer_id,NEW.kind,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.customer_id,OLD.kind,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION USING ERRCODE='P3802',MESSAGE='Immutable entry identity or registered entry';END IF;
  IF NEW.status='REGISTERED' THEN
   IF pg_trigger_depth()<2 OR OLD.status<>'DRAFT' OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.target_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3802',MESSAGE='Register through target insert';END IF;
  ELSIF NEW.target_id IS NOT NULL OR NEW.registered_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3802',MESSAGE='Invalid target';END IF;
  NEW.revision:=OLD.revision+1;
 END IF;
 IF NEW.status='DRAFT' AND jsonb_array_length(NEW.issues)<>0 OR NEW.status='INCOMPLETE' AND jsonb_array_length(NEW.issues)=0 THEN RAISE EXCEPTION USING ERRCODE='P3801',MESSAGE='Invalid pending state';END IF;
 NEW.updated_at:=now();RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_contract_entry ON public.contract_entry_drafts;
CREATE TRIGGER guard_contract_entry BEFORE INSERT OR UPDATE OR DELETE ON public.contract_entry_drafts FOR EACH ROW EXECUTE FUNCTION public.guard_contract_entry();
CREATE OR REPLACE FUNCTION public.audit_contract_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN INSERT INTO public.contract_entry_events(entry_id,organization_id,revision,actor_id,snapshot) VALUES(NEW.id,NEW.organization_id,NEW.revision,NEW.updated_by,to_jsonb(NEW));RETURN NEW;END $$;
DROP TRIGGER IF EXISTS audit_contract_entry ON public.contract_entry_drafts;
CREATE TRIGGER audit_contract_entry AFTER INSERT OR UPDATE ON public.contract_entry_drafts FOR EACH ROW EXECUTE FUNCTION public.audit_contract_entry();
CREATE OR REPLACE FUNCTION public.seal_contract_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.contract_entry_drafts%ROWTYPE; expected text;
BEGIN
 IF TG_OP='DELETE' THEN IF OLD.entry_draft_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3802',MESSAGE='Preserve guided entry history';END IF;RETURN OLD;END IF;
 IF TG_OP='UPDATE' THEN IF ROW(NEW.entry_draft_id,NEW.entry_draft_revision,NEW.entry_draft_actor) IS DISTINCT FROM ROW(OLD.entry_draft_id,OLD.entry_draft_revision,OLD.entry_draft_actor) THEN RAISE EXCEPTION USING ERRCODE='P3802',MESSAGE='Immutable entry link';END IF;RETURN NEW;END IF;
 IF NEW.entry_draft_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO d FROM public.contract_entry_drafts WHERE id=NEW.entry_draft_id FOR UPDATE;
 expected:=CASE TG_TABLE_NAME WHEN 'consumer_units' THEN 'distributor' WHEN 'energy_contracts' THEN 'supply' WHEN 'management_contracts' THEN 'management' WHEN 'service_agreements' THEN 'services' END;
 IF d.id IS NULL OR d.status<>'DRAFT' OR d.revision IS DISTINCT FROM NEW.entry_draft_revision OR d.kind<>expected OR d.organization_id<>NEW.organization_id OR d.customer_id<>NEW.customer_id OR nullif(btrim(NEW.entry_draft_actor),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3802',MESSAGE='Entry changed or scope mismatch';END IF;
 UPDATE public.contract_entry_drafts SET status='REGISTERED',target_id=NEW.id::text,registered_at=now(),updated_by=NEW.entry_draft_actor WHERE id=d.id;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['consumer_units','energy_contracts','management_contracts','service_agreements'] LOOP
 EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS entry_draft_id uuid UNIQUE REFERENCES public.contract_entry_drafts(id), ADD COLUMN IF NOT EXISTS entry_draft_revision integer, ADD COLUMN IF NOT EXISTS entry_draft_actor text',t);
 EXECUTE format('DROP TRIGGER IF EXISTS seal_contract_entry ON public.%I',t);
 EXECUTE format('CREATE TRIGGER seal_contract_entry BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.seal_contract_entry()',t);
 END LOOP;END $$;
REVOKE ALL ON FUNCTION public.guard_contract_entry(),public.audit_contract_entry(),public.seal_contract_entry() FROM PUBLIC,anon,authenticated;
COMMIT;
