-- Private intake foundation. No browser or service-role direct access, and no
-- private provider is enabled until its adapter and authorized binding are verified.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.ccee_unit_authorizations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 profile_code text NOT NULL CHECK(profile_code~'^[0-9]{1,20}$'),measurement_point text NOT NULL CHECK(length(measurement_point) BETWEEN 1 AND 200),
 revision integer NOT NULL CHECK(revision>0),status text NOT NULL CHECK(status IN ('DRAFT','APPROVED','REVOKED')),
 evidence_reference text NOT NULL CHECK(length(evidence_reference) BETWEEN 10 AND 2000),created_by text NOT NULL,
 reviewed_by text,created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,
 CHECK(status='DRAFT' OR reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL),
 UNIQUE(organization_id,consumer_unit_id,revision),UNIQUE(id,organization_id,customer_id,consumer_unit_id,revision)
);
CREATE TABLE public.ccee_normalized_intake(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 authorization_id uuid NOT NULL,authorization_revision integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('CONSUMPTION','CHARGE','FEE','CREDIT','SHORT_TERM_MARKET','AGENDA','OTHER')),
 service text NOT NULL CHECK(length(service) BETWEEN 1 AND 200),external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 200),provider_revision text NOT NULL CHECK(length(provider_revision) BETWEEN 1 AND 200),
 month date NOT NULL CHECK(extract(day FROM month)=1),finality text NOT NULL CHECK(finality IN ('PROVISIONAL','FINAL')),
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),normalized_payload jsonb NOT NULL CHECK(jsonb_typeof(normalized_payload)='object' AND octet_length(normalized_payload::text)<=2097152),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','READY_FOR_REVIEW')),retrieved_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(authorization_id,organization_id,customer_id,consumer_unit_id,authorization_revision) REFERENCES public.ccee_unit_authorizations(id,organization_id,customer_id,consumer_unit_id,revision),
 UNIQUE(organization_id,consumer_unit_id,kind,service,external_id,provider_revision,source_hash),
 CHECK(finality='FINAL' OR state='PENDING')
);
CREATE FUNCTION public.ccee_assert_intake_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.customers c JOIN public.consumer_units u ON u.customer_id=c.id AND u.organization_id=c.organization_id WHERE c.id=NEW.customer_id AND u.id=NEW.consumer_unit_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL)
 THEN RAISE EXCEPTION 'CCEE unit binding mismatch' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='ccee_normalized_intake' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ccee_unit_authorizations a WHERE a.id=NEW.authorization_id AND a.organization_id=NEW.organization_id AND a.customer_id=NEW.customer_id AND a.consumer_unit_id=NEW.consumer_unit_id AND a.revision=NEW.authorization_revision AND a.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM public.ccee_unit_authorizations newer WHERE newer.organization_id=a.organization_id AND newer.consumer_unit_id=a.consumer_unit_id AND newer.revision>a.revision))
  THEN RAISE EXCEPTION 'CCEE representation not approved' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ccee_authorization_binding BEFORE INSERT OR UPDATE ON public.ccee_unit_authorizations FOR EACH ROW EXECUTE FUNCTION public.ccee_assert_intake_binding();
CREATE TRIGGER ccee_authorization_preserved BEFORE UPDATE OR DELETE ON public.ccee_unit_authorizations FOR EACH ROW WHEN(OLD.status IN ('APPROVED','REVOKED')) EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER ccee_intake_binding BEFORE INSERT ON public.ccee_normalized_intake FOR EACH ROW EXECUTE FUNCTION public.ccee_assert_intake_binding();
CREATE TRIGGER ccee_intake_immutable BEFORE UPDATE OR DELETE ON public.ccee_normalized_intake FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
ALTER TABLE public.ccee_unit_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ccee_normalized_intake ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_unit_authorizations,public.ccee_normalized_intake FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ccee_assert_intake_binding() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
