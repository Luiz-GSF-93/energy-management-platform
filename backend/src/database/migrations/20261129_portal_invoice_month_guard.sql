BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- New receipts have one canonical invoice per tenant/customer/unit/month.
-- Historical documents and their audited revision chains are never deleted.
DO $$BEGIN IF EXISTS(SELECT 1 FROM public.portal_document_intakes WHERE kind='INVOICE' GROUP BY organization_id,customer_id,consumer_unit_id,month HAVING count(*)>1) THEN RAISE EXCEPTION 'Review existing Portal month conflicts before migration';END IF;END$$;
CREATE UNIQUE INDEX portal_invoice_month_scope ON public.portal_document_intakes(organization_id,customer_id,consumer_unit_id,month) WHERE kind='INVOICE';

CREATE FUNCTION public.invoice_month_conflict(p_org text,p_customer text,p_unit text,p_month date,p_except text DEFAULT NULL) RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.documents d JOIN public.document_ocr_jobs j ON j.organization_id=d.organization_id AND j.document_id=d.id AND j.state='SUCCEEDED' WHERE d.organization_id=p_org AND d.customer_id=p_customer AND d.consumer_unit_id=p_unit AND date_trunc('month',d.reference_month)=date_trunc('month',p_month) AND d.document_type='INVOICE_DISTRIBUTOR' AND d.file_verified AND d.id IS DISTINCT FROM p_except) THEN 'P2092'
 WHEN EXISTS(SELECT 1 FROM public.documents d WHERE d.organization_id=p_org AND d.customer_id=p_customer AND d.consumer_unit_id=p_unit AND date_trunc('month',d.reference_month)=date_trunc('month',p_month) AND d.document_type='INVOICE_DISTRIBUTOR' AND d.file_verified AND d.id IS DISTINCT FROM p_except) THEN 'P2091' ELSE NULL END;
$$;

CREATE FUNCTION public.guard_invoice_month_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE conflict text; parent public.documents;
BEGIN
 IF NEW.document_type<>'INVOICE_DISTRIBUTOR' OR NEW.file_verified IS DISTINCT FROM true THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.organization_id,NEW.customer_id,NEW.consumer_unit_id,NEW.reference_month,NEW.document_type,NEW.file_verified,NEW.catalog_previous_id) IS NOT DISTINCT FROM ROW(OLD.organization_id,OLD.customer_id,OLD.consumer_unit_id,OLD.reference_month,OLD.document_type,OLD.file_verified,OLD.catalog_previous_id) THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('invoice-month:'||jsonb_build_array(NEW.organization_id,NEW.customer_id,NEW.consumer_unit_id,to_char(NEW.reference_month,'YYYY-MM'))::text,0));
 IF NEW.catalog_previous_id IS NOT NULL THEN
  SELECT * INTO parent FROM public.documents WHERE id=NEW.catalog_previous_id AND organization_id=NEW.organization_id AND customer_id=NEW.customer_id AND consumer_unit_id=NEW.consumer_unit_id AND reference_month=NEW.reference_month AND document_type=NEW.document_type AND file_verified;
  IF NOT FOUND OR parent.id=NEW.id OR EXISTS(SELECT 1 FROM public.documents WHERE catalog_previous_id=parent.id AND id<>NEW.id) THEN RAISE EXCEPTION 'Current audited original required' USING ERRCODE='P2072';END IF;
 ELSE
  conflict:=public.invoice_month_conflict(NEW.organization_id,NEW.customer_id,NEW.consumer_unit_id,NEW.reference_month,NEW.id);
  IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Invoice already registered for unit and month' USING ERRCODE=conflict;END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.portal_document_intakes WHERE organization_id=NEW.organization_id AND customer_id=NEW.customer_id AND consumer_unit_id=NEW.consumer_unit_id AND month=to_char(NEW.reference_month,'YYYY-MM') AND kind='INVOICE' AND document_id IS NULL AND file_hash<>NEW.file_hash) THEN RAISE EXCEPTION 'Portal invoice month reserved; use support' USING ERRCODE='P2091';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER guard_invoice_month_document BEFORE INSERT OR UPDATE OF organization_id,customer_id,consumer_unit_id,reference_month,document_type,file_verified,catalog_previous_id ON public.documents FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_month_document();

ALTER FUNCTION public.portal_workspace_action(text,text,text,boolean,text,uuid,jsonb) RENAME TO portal_workspace_action_before_month_guard;
REVOKE ALL ON FUNCTION public.portal_workspace_action_before_month_guard(text,text,text,boolean,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.portal_workspace_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_id uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor jsonb; customer text; old public.portal_document_intakes; conflict text; response jsonb; rows jsonb;
BEGIN
 IF p_action='reserve_upload' AND p_body->>'kind'='INVOICE' THEN
  actor:=public.portal_workspace_actor(p_org,p_actor,p_role,p_platform,'documents'); customer:=actor->>'customerId';
  IF actor->>'external'<>'true' OR customer IS NULL OR NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE organization_id=p_org AND customer_id=customer AND id=p_body->>'unitId' AND status='ACTIVE') THEN RAISE EXCEPTION 'Portal unit required' USING ERRCODE='42501';END IF;
  IF p_body->>'month' !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('invoice-month:'||jsonb_build_array(p_org,customer,p_body->>'unitId',p_body->>'month')::text,0));
  IF NOT EXISTS(SELECT 1 FROM public.portal_document_intakes WHERE organization_id=p_org AND request_id=(p_body->>'requestId')::uuid) THEN
   SELECT * INTO old FROM public.portal_document_intakes WHERE organization_id=p_org AND customer_id=customer AND consumer_unit_id=p_body->>'unitId' AND month=p_body->>'month' AND kind='INVOICE';
   IF FOUND AND old.file_hash IS DISTINCT FROM p_body->>'fileHash' THEN RAISE EXCEPTION 'Invoice month already received; request support' USING ERRCODE='P2091';END IF;
   IF NOT FOUND THEN
    conflict:=public.invoice_month_conflict(p_org,customer,p_body->>'unitId',(p_body->>'month'||'-01')::date);
    IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Invoice month already registered; request support' USING ERRCODE=conflict;END IF;
   END IF;
  END IF;
 END IF;
 response:=public.portal_workspace_action_before_month_guard(p_org,p_actor,p_role,p_platform,p_action,p_id,p_body);
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(r||jsonb_build_object('ocrErrorCode',(SELECT j.error_code FROM public.document_ocr_jobs j WHERE j.organization_id=p_org AND j.document_id=r->>'documentId' AND j.error_code IN('IDENTITY_MISMATCH','IDENTITY_REVIEW_REQUIRED','IDENTITY_REGISTRATION_UNAVAILABLE','INVOICE_ALREADY_RECEIVED','SOURCE_HASH_MISMATCH')))),'[]') INTO rows FROM jsonb_array_elements(response->'rows')r;
  RETURN jsonb_set(response,'{rows}',rows);
 END IF;
 RETURN response;
END$$;

CREATE FUNCTION public.assert_invoice_month_ocr(p_org text,p_document text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.documents;
BEGIN
 SELECT * INTO d FROM public.documents WHERE organization_id=p_org AND id=p_document AND document_type='INVOICE_DISTRIBUTOR' AND file_verified;
 IF NOT FOUND THEN RAISE EXCEPTION 'Verified invoice required' USING ERRCODE='P2073';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('invoice-month:'||jsonb_build_array(p_org,d.customer_id,d.consumer_unit_id,to_char(d.reference_month,'YYYY-MM'))::text,0));
 IF EXISTS(SELECT 1 FROM public.documents WHERE organization_id=p_org AND catalog_previous_id=d.id AND file_verified) THEN RAISE EXCEPTION 'Superseded invoice version' USING ERRCODE='P2091';END IF;
 IF EXISTS(WITH RECURSIVE ancestors AS(SELECT id,catalog_previous_id,0 AS depth FROM public.documents WHERE id=d.id AND organization_id=p_org UNION ALL SELECT p.id,p.catalog_previous_id,a.depth+1 FROM public.documents p JOIN ancestors a ON p.id=a.catalog_previous_id WHERE p.organization_id=p_org AND p.customer_id=d.customer_id AND p.consumer_unit_id=d.consumer_unit_id AND p.reference_month=d.reference_month AND a.depth<100) SELECT 1 FROM public.documents other WHERE other.organization_id=p_org AND other.customer_id=d.customer_id AND other.consumer_unit_id=d.consumer_unit_id AND other.reference_month=d.reference_month AND other.document_type='INVOICE_DISTRIBUTOR' AND other.file_verified AND NOT EXISTS(SELECT 1 FROM ancestors WHERE id=other.id)) THEN RAISE EXCEPTION 'Duplicate invoice source requires review' USING ERRCODE='P2091';END IF;
END$$;
CREATE FUNCTION public.guard_invoice_month_ocr() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF NEW.state IN('QUEUED','SUBMITTING') THEN PERFORM public.assert_invoice_month_ocr(NEW.organization_id,NEW.document_id);END IF;RETURN NEW;END$$;
CREATE TRIGGER guard_invoice_month_ocr BEFORE INSERT OR UPDATE OF state ON public.document_ocr_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_month_ocr();
REVOKE ALL ON FUNCTION public.invoice_month_conflict(text,text,text,date,text),public.guard_invoice_month_document(),public.guard_invoice_month_ocr(),public.assert_invoice_month_ocr(text,text),public.portal_workspace_action(text,text,text,boolean,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.invoice_month_conflict(text,text,text,date,text),public.assert_invoice_month_ocr(text,text),public.portal_workspace_action(text,text,text,boolean,text,uuid,jsonb) TO service_role;
-- Only the latest verified member of an audited chain is an operational input.
-- Published versions retain their immutable document ids and source snapshots.
CREATE OR REPLACE VIEW public.eva_operational_invoices AS SELECT d.* FROM public.documents d
 WHERE NOT EXISTS(SELECT 1 FROM public.document_catalog c WHERE c.document_id=d.id AND c.organization_id=d.organization_id AND c.tag='MODEL')
 AND NOT EXISTS(SELECT 1 FROM public.documents newer WHERE newer.organization_id=d.organization_id AND newer.customer_id=d.customer_id AND newer.consumer_unit_id=d.consumer_unit_id AND newer.reference_month=d.reference_month AND newer.document_type=d.document_type AND newer.catalog_previous_id=d.id AND newer.file_verified);
REVOKE ALL ON public.eva_operational_invoices FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.eva_operational_invoices TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
