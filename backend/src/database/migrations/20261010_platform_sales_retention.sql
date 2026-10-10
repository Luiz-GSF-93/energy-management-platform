-- Approved policy: manual Owner-only erasure; never touches tenant records.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.platform_sales_erasure_events(
 receipt uuid PRIMARY KEY,
 received_at timestamptz NOT NULL,
 consent_version text NOT NULL,
 erased_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid NOT NULL,
 basis text NOT NULL CHECK(basis IN ('RETENTION_90_DAYS','DATA_SUBJECT_REQUEST')),
 erasure_transaction bigint NOT NULL DEFAULT txid_current()
);
ALTER TABLE public.platform_sales_erasure_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_sales_erasure_events FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.platform_sales_intake_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.platform_sales_erasure_events e WHERE e.receipt=OLD.receipt AND e.erasure_transaction=txid_current()) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Preserved sales intake' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_intake_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.erase_platform_sales_lead(p_actor uuid,p_receipt uuid,p_confirmation uuid,p_basis text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lead public.platform_sales_leads;
BEGIN
 PERFORM public.platform_team_owner(p_actor);
 IF p_receipt IS NULL OR p_confirmation IS DISTINCT FROM p_receipt OR p_basis IS NULL OR p_basis NOT IN ('RETENTION_90_DAYS','DATA_SUBJECT_REQUEST') THEN RAISE EXCEPTION 'Invalid erasure confirmation' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-receipt:'||p_receipt::text,0));
 SELECT * INTO lead FROM public.platform_sales_leads WHERE receipt=p_receipt FOR UPDATE;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.platform_sales_erasure_events WHERE receipt=p_receipt) THEN RETURN jsonb_build_object('receipt',p_receipt,'status','ERASED'); END IF;
  RAISE EXCEPTION 'Receipt not found' USING ERRCODE='P3604';
 END IF;
 IF p_basis='RETENTION_90_DAYS' AND lead.created_at>now()-interval '90 days' THEN RAISE EXCEPTION 'Retention period not reached' USING ERRCODE='22023'; END IF;
 INSERT INTO public.platform_sales_erasure_events(receipt,received_at,consent_version,actor_id,basis) VALUES(p_receipt,lead.created_at,lead.consent_version,p_actor,p_basis);
 DELETE FROM public.platform_sales_leads WHERE receipt=p_receipt;
 RETURN jsonb_build_object('receipt',p_receipt,'status','ERASED');
END $$;
REVOKE ALL ON FUNCTION public.erase_platform_sales_lead(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.erase_platform_sales_lead(uuid,uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.platform_sales_erasure_log_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Preserved erasure event' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION public.platform_sales_erasure_log_immutable() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS platform_sales_erasure_events_immutable ON public.platform_sales_erasure_events;
CREATE TRIGGER platform_sales_erasure_events_immutable BEFORE UPDATE OR DELETE ON public.platform_sales_erasure_events FOR EACH ROW EXECUTE FUNCTION public.platform_sales_erasure_log_immutable();
-- Lock ordering is shared with receipt submission. Retired receipts cannot restore personal data.
CREATE OR REPLACE FUNCTION public.platform_sales_receipt_not_retired() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.platform_sales_erasure_events WHERE receipt=NEW.receipt) THEN RAISE EXCEPTION 'Receipt retired' USING ERRCODE='P3603'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_receipt_not_retired() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS platform_sales_receipt_not_retired ON public.platform_sales_leads;
CREATE TRIGGER platform_sales_receipt_not_retired BEFORE INSERT ON public.platform_sales_leads FOR EACH ROW EXECUTE FUNCTION public.platform_sales_receipt_not_retired();
COMMIT;
