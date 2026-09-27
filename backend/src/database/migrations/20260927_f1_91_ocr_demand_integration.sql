-- F1.91: integrate reviewed billed demand into the same OCR draft; never measured demand.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.document_ocr_demand_integrations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 document_id text NOT NULL REFERENCES public.documents(id), input_id uuid NOT NULL REFERENCES public.calculation_monthly_inputs(id),
 review_refs jsonb NOT NULL, source_snapshot jsonb NOT NULL, created_by text NOT NULL CHECK(length(btrim(created_by))>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,document_id), UNIQUE(input_id)
);
ALTER TABLE public.document_ocr_demand_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_ocr_demand_integrations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.document_ocr_demand_integrations TO service_role;
CREATE TRIGGER preserve_ocr_demand_integration BEFORE UPDATE OR DELETE ON public.document_ocr_demand_integrations FOR EACH ROW EXECUTE FUNCTION public.preserve_ocr_monthly_integration();
CREATE FUNCTION public.checked_ocr_billed_demand(p_org text,p_document text,p_refs jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d public.documents; u public.consumer_units; k text; ref jsonb; r record; used_kw numeric=0; unused_kw numeric=0; evidence jsonb='[]'::jsonb;
BEGIN
 IF jsonb_typeof(p_refs) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_refs)) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid demand references' USING ERRCODE='P4090';END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_document AND organization_id=p_org FOR SHARE;
 IF NOT FOUND OR d.file_verified IS DISTINCT FROM true OR d.document_type IS DISTINCT FROM 'INVOICE_DISTRIBUTOR' THEN RAISE EXCEPTION 'Invalid document' USING ERRCODE='P4090';END IF;
 SELECT * INTO u FROM public.consumer_units WHERE id=d.consumer_unit_id AND organization_id=p_org AND customer_id=d.customer_id FOR SHARE;
 IF NOT FOUND OR u.status IS DISTINCT FROM 'ACTIVE' OR u.tariff_group IS DISTINCT FROM 'A' OR u.tariff_modality IS DISTINCT FROM 'GREEN' OR u.free_market IS DISTINCT FROM true THEN RAISE EXCEPTION 'Only ACL Group A green supported' USING ERRCODE='P4090';END IF;
 FOR k,ref IN SELECT * FROM jsonb_each(p_refs) ORDER BY key LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('ocr-demand-review:'||p_org||':'||p_document||':'||k,0));
  SELECT * INTO r FROM public.document_ocr_demand_reviews WHERE organization_id=p_org AND document_id=p_document AND field_key=k ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR r.id::text IS DISTINCT FROM ref->>'id' OR r.source_hash IS DISTINCT FROM ref->>'sourceHash' OR r.decision NOT IN ('USED','UNUSED') OR r.file_hash IS DISTINCT FROM d.file_hash OR r.source_snapshot#>>'{field,state}' IS DISTINCT FROM 'BILLED_UNCLASSIFIED' OR r.source_snapshot#>>'{field,unit}' IS DISTINCT FROM 'kW' OR r.source_snapshot#>>'{field,period}' IS DISTINCT FROM 'UNSPECIFIED' OR coalesce(r.source_snapshot#>>'{field,decimal}','') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$' THEN RAISE EXCEPTION 'Demand review changed' USING ERRCODE='P4090';END IF;
  IF r.source_snapshot#>>'{document,customerId}' IS DISTINCT FROM d.customer_id OR r.source_snapshot#>>'{document,unitId}' IS DISTINCT FROM d.consumer_unit_id OR r.source_snapshot#>>'{document,month}' IS DISTINCT FROM left(d.reference_month::text,7) THEN RAISE EXCEPTION 'Demand scope changed' USING ERRCODE='P4090';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.document_ocr_jobs j JOIN public.document_ocr_results x ON x.job_id=j.id AND x.organization_id=j.organization_id AND x.document_id=j.document_id AND x.file_hash=j.file_hash WHERE j.id=r.job_id AND j.organization_id=p_org AND j.document_id=p_document AND j.file_hash=d.file_hash AND j.state='SUCCEEDED') THEN RAISE EXCEPTION 'Demand source unavailable' USING ERRCODE='P4090';END IF;
  IF r.decision='USED' THEN used_kw:=used_kw+(r.source_snapshot#>>'{field,decimal}')::numeric;ELSE unused_kw:=unused_kw+(r.source_snapshot#>>'{field,decimal}')::numeric;END IF;
  evidence:=evidence||jsonb_build_array(to_jsonb(r));
 END LOOP;
 IF used_kw+unused_kw>=1000000000000 THEN RAISE EXCEPTION 'Demand range exceeded' USING ERRCODE='P4090';END IF;
 RETURN jsonb_build_object('usedKw',used_kw::text,'unusedKw',unused_kw::text,'totalKw',(used_kw+unused_kw)::text,'reviews',evidence,'fileHash',d.file_hash,'billedDemand',jsonb_build_object('ACL',jsonb_build_object('single',(used_kw+unused_kw)::text,'peak',NULL,'offPeak',NULL,'source','Parcelas faturadas conferidas no OCR · Documento '||p_document||' · SHA-256 '||d.file_hash||'. Não representa demanda medida nem aprova tributos.')));
END $$;
CREATE FUNCTION public.integrate_ocr_billed_demand(p_org text,p_document text,p_actor text,p_refs jsonb,p_revision integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.document_ocr_demand_integrations; consumption public.document_ocr_monthly_integrations; monthly public.calculation_monthly_inputs; source jsonb; origin jsonb;
BEGIN
 IF nullif(btrim(p_actor),'') IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ocr-monthly:'||p_org||':'||p_document,0));
 SELECT * INTO existing FROM public.document_ocr_demand_integrations WHERE organization_id=p_org AND document_id=p_document;
 IF FOUND THEN RETURN jsonb_build_object('inputId',existing.input_id,'alreadyIntegrated',true);END IF;
 SELECT * INTO consumption FROM public.document_ocr_monthly_integrations WHERE organization_id=p_org AND document_id=p_document;
 IF NOT FOUND THEN RAISE EXCEPTION 'Integrate consumption first' USING ERRCODE='P4091';END IF;
 SELECT * INTO monthly FROM public.calculation_monthly_inputs WHERE id=consumption.input_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR monthly.status IS DISTINCT FROM 'DRAFT' OR monthly.revision IS DISTINCT FROM p_revision OR monthly.billed_demand IS NOT NULL OR monthly.origin IS DISTINCT FROM 'OCR_REVIEWED' OR monthly.source_ocr_document_id IS DISTINCT FROM p_document THEN RAISE EXCEPTION 'Existing or changed monthly record preserved' USING ERRCODE='P4091';END IF;
 origin:=public.checked_ocr_monthly_source(p_org,p_document,consumption.review_refs);
 IF monthly.unit_context IS DISTINCT FROM origin->'unitContext' OR monthly.measurements IS DISTINCT FROM origin->'measurements' THEN RAISE EXCEPTION 'Changed OCR draft preserved' USING ERRCODE='P4091';END IF;
 source:=public.checked_ocr_billed_demand(p_org,p_document,p_refs);
 INSERT INTO public.document_ocr_demand_integrations(organization_id,document_id,input_id,review_refs,source_snapshot,created_by) VALUES(p_org,p_document,monthly.id,p_refs,source,p_actor);
 UPDATE public.calculation_monthly_inputs SET billed_demand=source->'billedDemand',updated_by=p_actor WHERE id=monthly.id AND organization_id=p_org;
 RETURN jsonb_build_object('inputId',monthly.id,'alreadyIntegrated',false);
END $$;
CREATE FUNCTION public.guard_ocr_billed_demand_validation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE integration public.document_ocr_demand_integrations;
BEGIN
 IF NEW.status='VALIDATED' THEN
  SELECT * INTO integration FROM public.document_ocr_demand_integrations WHERE input_id=NEW.id AND organization_id=NEW.organization_id;
  IF FOUND THEN PERFORM public.checked_ocr_billed_demand(NEW.organization_id,integration.document_id,integration.review_refs);END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ocr_billed_demand_validation BEFORE UPDATE ON public.calculation_monthly_inputs FOR EACH ROW EXECUTE FUNCTION public.guard_ocr_billed_demand_validation();
REVOKE ALL ON FUNCTION public.checked_ocr_billed_demand(text,text,jsonb),public.integrate_ocr_billed_demand(text,text,text,jsonb,integer),public.guard_ocr_billed_demand_validation() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.integrate_ocr_billed_demand(text,text,text,jsonb,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
