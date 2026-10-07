BEGIN;
CREATE TABLE public.platform_whatsapp_renewal (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 issued_on date, expires_on date, no_expiry boolean NOT NULL DEFAULT false,
 reminder_days integer NOT NULL DEFAULT 15 CHECK(reminder_days BETWEEN 1 AND 60),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((no_expiry AND expires_on IS NULL AND issued_on IS NOT NULL) OR (NOT no_expiry AND ((issued_on IS NULL AND expires_on IS NULL) OR (issued_on IS NOT NULL AND expires_on IS NOT NULL AND expires_on>issued_on))))
);
INSERT INTO public.platform_whatsapp_renewal(id) VALUES(true);
CREATE TABLE public.platform_whatsapp_renewal_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid NOT NULL,
 before_value jsonb NOT NULL, after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.platform_whatsapp_renewal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_whatsapp_renewal_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_whatsapp_renewal,public.platform_whatsapp_renewal_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.platform_whatsapp_renewal TO service_role;
CREATE FUNCTION public.save_platform_whatsapp_renewal(p_definition jsonb,p_actor uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous jsonb; saved jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE u.user_id=p_actor AND r.scope='global' AND r.permissions @> '["ede45b9c-8af4-4b47-8490-9d386a3efb13"]'::jsonb) THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501'; END IF;
 IF p_definition - ARRAY['revision','issued_on','expires_on','no_expiry','reminder_days'] <> '{}'::jsonb THEN RAISE EXCEPTION 'Unsupported metadata' USING ERRCODE='22023'; END IF;
 SELECT to_jsonb(p) INTO previous FROM public.platform_whatsapp_renewal p WHERE id FOR UPDATE;
 IF (previous->>'revision')::integer IS DISTINCT FROM (p_definition->>'revision')::integer THEN RAISE EXCEPTION 'Renewal changed' USING ERRCODE='P3151'; END IF;
 IF p_definition->>'issued_on' IS NULL OR (NOT (p_definition->>'no_expiry')::boolean AND p_definition->>'expires_on' IS NULL) THEN RAISE EXCEPTION 'Dates required' USING ERRCODE='22023'; END IF;
 UPDATE public.platform_whatsapp_renewal SET issued_on=(p_definition->>'issued_on')::date,expires_on=(p_definition->>'expires_on')::date,no_expiry=(p_definition->>'no_expiry')::boolean,reminder_days=(p_definition->>'reminder_days')::integer,revision=revision+1,updated_at=clock_timestamp() WHERE id RETURNING to_jsonb(platform_whatsapp_renewal.*) INTO saved;
 INSERT INTO public.platform_whatsapp_renewal_audit(actor_id,before_value,after_value) VALUES(p_actor,previous,saved);
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.save_platform_whatsapp_renewal(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_platform_whatsapp_renewal(jsonb,uuid) TO service_role;
COMMIT;
