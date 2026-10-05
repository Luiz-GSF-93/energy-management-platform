BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.documents DROP CONSTRAINT documents_document_type_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check CHECK(document_type IN ('INVOICE_DISTRIBUTOR','INVOICE_SUPPLIER','CONTRACT_ENERGY','CONTRACT_CUSD','CONTRACT_CCER','CONTRACT_MANAGEMENT','CCEE_SETTLEMENT','CCEE_CHARGES','TAX_DOCUMENT','COMPLIANCE_REPORT','OTHER'));
CREATE OR REPLACE FUNCTION public.record_document_catalog_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE correction jsonb;kind text;
BEGIN
 SELECT document_type INTO kind FROM public.documents WHERE id=NEW.document_id AND organization_id=NEW.organization_id;
 correction:=NULLIF(current_setting('app.document_type_correction',true),'')::jsonb;
 IF correction->>'document_id' IS DISTINCT FROM NEW.document_id THEN correction:=NULL;END IF;
 INSERT INTO public.document_catalog_events(organization_id,document_id,revision,actor_id,reason,snapshot) VALUES(NEW.organization_id,NEW.document_id,NEW.revision,NEW.actor_id,NEW.reason,to_jsonb(NEW)||jsonb_build_object('document_type',kind,'type_change',correction));
 RETURN NULL;
END $$;
CREATE FUNCTION public.guard_document_type_correction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE correction jsonb;
BEGIN
 IF NEW.document_type IS NOT DISTINCT FROM OLD.document_type THEN RETURN NEW;END IF;
 correction:=NULLIF(current_setting('app.document_type_correction',true),'')::jsonb;
 IF correction IS NULL OR correction->>'document_id' IS DISTINCT FROM OLD.id OR correction->>'organization_id' IS DISTINCT FROM OLD.organization_id OR correction->>'before' IS DISTINCT FROM OLD.document_type OR correction->>'after' IS DISTINCT FROM NEW.document_type THEN RAISE EXCEPTION 'Audited document type correction required' USING ERRCODE='P2072';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_document_type_correction BEFORE UPDATE OF document_type ON public.documents FOR EACH ROW EXECUTE FUNCTION public.guard_document_type_correction();
CREATE FUNCTION public.correct_document_type(p_org text,p_actor text,p_document text,p_revision integer,p_type text,p_reason text,p_checked boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.documents;c public.document_catalog;ref record;used boolean;
BEGIN
 PERFORM public.assert_document_catalog_actor(p_org,p_actor,true,false);
 IF p_type NOT IN ('INVOICE_DISTRIBUTOR','INVOICE_SUPPLIER','CONTRACT_ENERGY','CONTRACT_CUSD','CONTRACT_CCER','CONTRACT_MANAGEMENT','CCEE_SETTLEMENT','CCEE_CHARGES','TAX_DOCUMENT','COMPLIANCE_REPORT','OTHER') OR p_type IS NULL OR p_checked IS DISTINCT FROM true OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Reviewed type and reason required' USING ERRCODE='P2071';END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_document AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR NOT d.file_verified THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='P2073';END IF;
 SELECT * INTO c FROM public.document_catalog WHERE document_id=p_document AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR c.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Document changed' USING ERRCODE='P2072';END IF;
 IF c.tag IN ('APPROVED','RELEASED') OR d.invoice_id IS NOT NULL OR d.energy_contract_id IS NOT NULL OR d.processing_status<>'PENDING' OR d.ocr_status<>'PENDING' OR d.document_type=p_type OR d.catalog_previous_id IS NOT NULL THEN RAISE EXCEPTION 'Document already used or unchanged; review required' USING ERRCODE='P2072';END IF;
 IF EXISTS(SELECT 1 FROM public.document_catalog WHERE series_id=c.series_id AND document_id<>p_document) OR EXISTS(SELECT 1 FROM public.document_ocr_jobs WHERE document_id=p_document AND state NOT IN ('SUCCEEDED','FAILED')) OR EXISTS(SELECT 1 FROM public.operation_client_messages WHERE p_document=ANY(document_ids)) THEN RAISE EXCEPTION 'Document has an active workflow or shared lineage' USING ERRCODE='P2072';END IF;
 -- Every relational derivative blocks reclassification. Raw completed OCR remains historical and is no longer accepted as invoice evidence after the type changes.
 FOR ref IN SELECT n.nspname AS schema_name,t.relname AS table_name,a.attname AS column_name FROM pg_constraint fk JOIN pg_class t ON t.oid=fk.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=fk.conkey[1] JOIN pg_attribute target ON target.attrelid=fk.confrelid AND target.attnum=fk.confkey[1] WHERE fk.contype='f' AND fk.confrelid='public.documents'::regclass AND target.attname='id' AND cardinality(fk.conkey)=1 AND t.relname NOT IN ('document_ocr_jobs','document_ocr_results','document_catalog','document_catalog_events','document_favorites') LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I::text=$1)',ref.schema_name,ref.table_name,ref.column_name) INTO used USING p_document;
  IF used THEN RAISE EXCEPTION 'Document has derived records; review required' USING ERRCODE='P2072';END IF;
 END LOOP;
 PERFORM set_config('app.document_type_correction',jsonb_build_object('document_id',p_document,'organization_id',p_org,'before',d.document_type,'after',p_type)::text,true);
 UPDATE public.documents SET document_type=p_type WHERE id=p_document AND organization_id=p_org;
 UPDATE public.document_catalog SET reason=btrim(p_reason),actor_id=p_actor WHERE document_id=p_document AND organization_id=p_org RETURNING * INTO c;
 PERFORM set_config('app.document_type_correction','',true);
 RETURN to_jsonb(c)||jsonb_build_object('document_type',p_type);
END $$;
-- Serialize future OCR enqueueing with corrections so a reclassified contract cannot re-enter invoice processing.
ALTER FUNCTION public.enqueue_document_ocr(text,text,text) RENAME TO enqueue_document_ocr_before_type_correction;
REVOKE ALL ON FUNCTION public.enqueue_document_ocr_before_type_correction(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.enqueue_document_ocr(p_org text,p_document text,p_actor text) RETURNS public.document_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public.documents WHERE id=p_document AND organization_id=p_org AND document_type='INVOICE_DISTRIBUTOR' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice type required' USING ERRCODE='P2073';END IF;
 RETURN public.enqueue_document_ocr_before_type_correction(p_org,p_document,p_actor);
END $$;
REVOKE ALL ON FUNCTION public.correct_document_type(text,text,text,integer,text,text,boolean),public.guard_document_type_correction(),public.record_document_catalog_event(),public.enqueue_document_ocr(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.correct_document_type(text,text,text,integer,text,text,boolean),public.enqueue_document_ocr(text,text,text) TO service_role;
INSERT INTO public.document_catalog_versions(version) VALUES('20261005_f8_document_type_correction');
NOTIFY pgrst,'reload schema';
COMMIT;
