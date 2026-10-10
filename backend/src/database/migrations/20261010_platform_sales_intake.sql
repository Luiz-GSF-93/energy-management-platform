-- Sales intake only: no charges, identity creation, tenant grants or license changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.platform_sales_leads(
 receipt uuid PRIMARY KEY,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 requester_hash text NOT NULL CHECK(requester_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 consent_version text NOT NULL DEFAULT 'sales-contact-v1' CHECK(consent_version='sales-contact-v1'),
 status text NOT NULL DEFAULT 'RECEIVED' CHECK(status='RECEIVED')
);
CREATE INDEX IF NOT EXISTS platform_sales_leads_requester ON public.platform_sales_leads(requester_hash,created_at);
CREATE INDEX IF NOT EXISTS platform_sales_leads_date ON public.platform_sales_leads(created_at DESC,receipt);
ALTER TABLE public.platform_sales_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_sales_leads FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.submit_platform_sales_lead(p_receipt uuid,p_payload jsonb,p_hash text,p_requester text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous public.platform_sales_leads;
BEGIN
 IF p_receipt IS NULL OR p_hash IS NULL OR p_requester IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_requester !~ '^[a-f0-9]{64}$' OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>6000 OR (p_payload->>'consent') IS DISTINCT FROM 'true' OR (p_payload->>'consentVersion') IS DISTINCT FROM 'sales-contact-v1' OR (p_payload->>'requestId') IS DISTINCT FROM p_receipt::text THEN RAISE EXCEPTION 'Invalid intake' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-receipt:'||p_receipt::text,0));
 SELECT * INTO previous FROM public.platform_sales_leads WHERE receipt=p_receipt;
 IF FOUND THEN
  IF previous.payload_hash<>p_hash OR previous.requester_hash<>p_requester THEN RAISE EXCEPTION 'Receipt conflict' USING ERRCODE='P3601'; END IF;
  RETURN jsonb_build_object('receipt',p_receipt);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-requester:'||p_requester,0));
 IF (SELECT count(*) FROM public.platform_sales_leads WHERE requester_hash=p_requester AND created_at>now()-interval '1 hour')>=5 OR (SELECT count(*) FROM public.platform_sales_leads WHERE requester_hash=p_requester AND created_at>now()-interval '24 hours')>=20 THEN RAISE EXCEPTION 'Intake limit' USING ERRCODE='P3602'; END IF;
 INSERT INTO public.platform_sales_leads(receipt,payload,payload_hash,requester_hash) VALUES(p_receipt,p_payload,p_hash,p_requester);
 RETURN jsonb_build_object('receipt',p_receipt);
END $$;
REVOKE ALL ON FUNCTION public.submit_platform_sales_lead(uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_platform_sales_lead(uuid,jsonb,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.read_platform_sales_leads(p_actor uuid,p_page integer DEFAULT 0,p_search text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; total bigint;
BEGIN
 PERFORM public.platform_team_owner(p_actor);
 IF p_page IS NULL OR p_page<0 OR p_page>1000 OR p_search IS NULL OR length(p_search)>120 THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO total FROM public.platform_sales_leads WHERE p_search='' OR strpos(lower(payload->>'company'),lower(p_search))>0 OR strpos(lower(payload->>'email'),lower(p_search))>0;
 SELECT coalesce(jsonb_agg(jsonb_build_object('receipt',receipt,'createdAt',created_at,'status',status,'data',payload) ORDER BY created_at DESC,receipt),'[]'::jsonb) INTO result FROM
 (SELECT receipt,created_at,status,payload FROM public.platform_sales_leads WHERE p_search='' OR strpos(lower(payload->>'company'),lower(p_search))>0 OR strpos(lower(payload->>'email'),lower(p_search))>0 ORDER BY created_at DESC,receipt LIMIT 25 OFFSET p_page*25) q;
 RETURN jsonb_build_object('rows',result,'total',total,'page',p_page);
END $$;
REVOKE ALL ON FUNCTION public.read_platform_sales_leads(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_platform_sales_leads(uuid,integer,text) TO service_role;
CREATE OR REPLACE FUNCTION public.platform_sales_intake_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Preserved sales intake' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION public.platform_sales_intake_immutable() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS platform_sales_intake_immutable ON public.platform_sales_leads;
CREATE TRIGGER platform_sales_intake_immutable BEFORE UPDATE OR DELETE ON public.platform_sales_leads FOR EACH ROW EXECUTE FUNCTION public.platform_sales_intake_immutable();
COMMIT;
