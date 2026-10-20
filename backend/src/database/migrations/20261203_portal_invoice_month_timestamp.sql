BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Production documents.reference_month is timestamp without time zone.
-- Keep the existing date-based month guard and all duplicate protections.
CREATE OR REPLACE FUNCTION public.guard_invoice_month_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conflict text; parent public.documents;
BEGIN
 IF NEW.document_type<>'INVOICE_DISTRIBUTOR' OR NEW.file_verified IS DISTINCT FROM true THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.organization_id,NEW.customer_id,NEW.consumer_unit_id,NEW.reference_month,NEW.document_type,NEW.file_verified,NEW.catalog_previous_id) IS NOT DISTINCT FROM ROW(OLD.organization_id,OLD.customer_id,OLD.consumer_unit_id,OLD.reference_month,OLD.document_type,OLD.file_verified,OLD.catalog_previous_id) THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('invoice-month:'||jsonb_build_array(NEW.organization_id,NEW.customer_id,NEW.consumer_unit_id,to_char(NEW.reference_month,'YYYY-MM'))::text,0));
 IF NEW.catalog_previous_id IS NOT NULL THEN
  SELECT * INTO parent FROM public.documents WHERE id=NEW.catalog_previous_id AND organization_id=NEW.organization_id AND customer_id=NEW.customer_id AND consumer_unit_id=NEW.consumer_unit_id AND reference_month=NEW.reference_month AND document_type=NEW.document_type AND file_verified;
  IF NOT FOUND OR parent.id=NEW.id OR EXISTS(SELECT 1 FROM public.documents WHERE catalog_previous_id=parent.id AND id<>NEW.id) THEN RAISE EXCEPTION 'Current audited original required' USING ERRCODE='P2072';END IF;
 ELSE
  conflict:=public.invoice_month_conflict(NEW.organization_id,NEW.customer_id,NEW.consumer_unit_id,NEW.reference_month::date,NEW.id);
  IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Invoice already registered for unit and month' USING ERRCODE=conflict;END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.portal_document_intakes WHERE organization_id=NEW.organization_id AND customer_id=NEW.customer_id AND consumer_unit_id=NEW.consumer_unit_id AND month=to_char(NEW.reference_month,'YYYY-MM') AND kind='INVOICE' AND document_id IS NULL AND file_hash<>NEW.file_hash) THEN RAISE EXCEPTION 'Portal invoice month reserved; use support' USING ERRCODE='P2091';END IF;
 RETURN NEW;
END$$;
COMMIT;
