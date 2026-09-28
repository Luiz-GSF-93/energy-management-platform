-- F1.112: atomic OCR demand quantities and tariff drafts, with immutable provenance.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.document_ocr_split_demand_integrations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),document_id text NOT NULL REFERENCES public.documents(id),
 input_id uuid NOT NULL REFERENCES public.calculation_monthly_inputs(id) DEFERRABLE INITIALLY DEFERRED,parameter_ids uuid[] NOT NULL CHECK(cardinality(parameter_ids)=2),
 review_refs jsonb NOT NULL,demand_refs jsonb NOT NULL,source_snapshot jsonb NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(organization_id,document_id),UNIQUE(input_id));
ALTER TABLE public.document_ocr_split_demand_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_ocr_split_demand_integrations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.document_ocr_split_demand_integrations TO service_role;
CREATE TRIGGER preserve_ocr_split_demand BEFORE UPDATE OR DELETE ON public.document_ocr_split_demand_integrations FOR EACH ROW EXECUTE FUNCTION public.preserve_ocr_monthly_integration();
CREATE FUNCTION public.integrate_ocr_split_demand(p_org text,p_document text,p_actor text,p_input uuid,p_revision integer,p_refs jsonb,p_demand_refs jsonb,p_job uuid,p_file_hash text,p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.document_ocr_split_demand_integrations; old public.calculation_monthly_inputs; latest public.calculation_monthly_inputs; src jsonb; dem jsonb; row jsonb; rr public.document_ocr_demand_reviews; inputid uuid; ids uuid[]=ARRAY[gen_random_uuid(),gen_random_uuid()]; billed jsonb; context jsonb; i integer=0; startday date; endday date; quantity numeric; rate numeric; amount numeric; snapshot jsonb;
BEGIN
 IF nullif(btrim(p_actor),'') IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ocr-monthly:'||p_org||':'||p_document,0));
 SELECT * INTO existing FROM public.document_ocr_split_demand_integrations WHERE organization_id=p_org AND document_id=p_document;
 IF FOUND THEN RETURN jsonb_build_object('alreadyIntegrated',true,'inputId',existing.input_id,'parameterIds',existing.parameter_ids);END IF;
 src:=public.checked_ocr_monthly_source(p_org,p_document,p_refs);
 dem:=public.checked_ocr_billed_demand(p_org,p_document,p_demand_refs);
 IF src->>'fileHash' IS DISTINCT FROM p_file_hash THEN RAISE EXCEPTION 'File changed' USING ERRCODE='P4090';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||(src->>'unitId')||':'||(src->>'month'),134));
 SELECT * INTO old FROM public.calculation_monthly_inputs WHERE id=p_input AND organization_id=p_org FOR UPDATE;
 SELECT * INTO latest FROM public.calculation_monthly_inputs WHERE organization_id=p_org AND consumer_unit_id=src->>'unitId' AND month=src->>'month' ORDER BY version DESC LIMIT 1;
 IF old.id IS NULL OR latest.id IS DISTINCT FROM old.id OR old.revision IS DISTINCT FROM p_revision OR old.customer_id IS DISTINCT FROM src->>'customerId' OR old.unit_context IS DISTINCT FROM src->'unitContext' OR old.status NOT IN ('DRAFT','VALIDATED') OR old.origin<>'OCR_REVIEWED' OR old.source_ocr_document_id IS DISTINCT FROM p_document OR old.billed_demand#>>'{ACL,used}' IS NOT NULL OR old.billed_demand#>>'{ACL,unused}' IS NOT NULL THEN RAISE EXCEPTION 'Monthly record changed or split already exists' USING ERRCODE='P4091';END IF;
 IF old.measurements->'consumptionTotal' IS DISTINCT FROM src#>'{measurements,consumptionTotal}' OR old.measurements->'consumptionPeak' IS DISTINCT FROM src#>'{measurements,consumptionPeak}' OR old.measurements->'consumptionOffPeak' IS DISTINCT FROM src#>'{measurements,consumptionOffPeak}' THEN RAISE EXCEPTION 'Consumption changed' USING ERRCODE='P4091';END IF;
 IF old.billed_demand#>>'{ACL,single}' IS NOT NULL AND (old.billed_demand#>>'{ACL,single}')::numeric<>(dem->>'totalKw')::numeric THEN RAISE EXCEPTION 'Existing total differs' USING ERRCODE='P4091';END IF;
 startday:=((src->>'month')||'-01')::date;endday:=(startday+interval '1 month - 1 day')::date;
 PERFORM pg_advisory_xact_lock(hashtextextended('ocr-split-tariff:'||p_org||':'||(src->>'unitId')||':'||(src->>'month'),0));
 IF EXISTS(SELECT 1 FROM public.calculation_parameters WHERE organization_id=p_org AND consumer_unit_id=src->>'unitId' AND scenario='ACL' AND kind='TARIFF' AND component_code IN ('TUSD_DEMAND','TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED') AND status<>'RETIRED' AND start_date<=endday AND end_date>=startday) THEN RAISE EXCEPTION 'Existing demand tariff preserved' USING ERRCODE='P4091';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)<>2 OR (SELECT count(DISTINCT value->>'classification') FROM jsonb_array_elements(p_rows))<>2 OR (SELECT count(*) FROM jsonb_object_keys(p_demand_refs))<>2 THEN RAISE EXCEPTION 'Exactly two classified rows required' USING ERRCODE='P4090';END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF row->>'classification' NOT IN ('USED','UNUSED') OR coalesce(row->>'quantity','') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$' OR coalesce(row->>'rate','') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,9})?$' OR coalesce(row->>'amount','') !~ '^(0|[1-9][0-9]{0,11})[.][0-9]{2}$' OR coalesce(row->>'source','')='' THEN RAISE EXCEPTION 'Invalid financial source' USING ERRCODE='P4090';END IF;
  SELECT * INTO rr FROM public.document_ocr_demand_reviews WHERE id=(row->>'reviewId')::uuid AND organization_id=p_org AND document_id=p_document;
  IF NOT FOUND OR rr.job_id IS DISTINCT FROM p_job OR rr.source_hash IS DISTINCT FROM row->>'sourceHash' OR rr.decision IS DISTINCT FROM row->>'classification' OR NOT EXISTS(SELECT 1 FROM jsonb_each(p_demand_refs) ref WHERE ref.value->>'id'=rr.id::text) OR (rr.source_snapshot#>>'{field,decimal}')::numeric<>(row->>'quantity')::numeric THEN RAISE EXCEPTION 'Demand evidence mismatch' USING ERRCODE='P4090';END IF;
  quantity:=(row->>'quantity')::numeric;rate:=(row->>'rate')::numeric;amount:=(row->>'amount')::numeric;
  IF round(quantity*rate,2)<>amount OR jsonb_typeof(row->'taxCodes') IS DISTINCT FROM 'array' OR NOT (row->'taxCodes' @> '["PIS","COFINS"]'::jsonb) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(row->'taxCodes') code WHERE code NOT IN ('ICMS','PIS','COFINS')) THEN RAISE EXCEPTION 'Amount or embedded tax evidence invalid' USING ERRCODE='P4090';END IF;
 END LOOP;
 inputid:=CASE WHEN old.status='VALIDATED' THEN gen_random_uuid() ELSE old.id END;
 billed:=coalesce(old.billed_demand,'{}'::jsonb)||jsonb_build_object('ACL',jsonb_build_object('single',dem->>'totalKw','used',dem->>'usedKw','unused',dem->>'unusedKw','peak',NULL,'offPeak',NULL,'source','Parcelas e tarifas OCR conferidas · Documento '||p_document||' · SHA-256 '||p_file_hash));
 snapshot:=jsonb_build_object('format','ocr-split-demand-v1','fileHash',p_file_hash,'jobId',p_job,'rows',p_rows,'measurements',old.measurements,'billedDemand',billed,'unitContext',old.unit_context,'previousInputId',old.id,'previousRevision',old.revision,'targetVersion',old.version+CASE WHEN old.status='VALIDATED' THEN 1 ELSE 0 END);
 INSERT INTO public.document_ocr_split_demand_integrations(organization_id,document_id,input_id,parameter_ids,review_refs,demand_refs,source_snapshot,created_by) VALUES(p_org,p_document,inputid,ids,p_refs,p_demand_refs,snapshot,p_actor);
 IF old.status='VALIDATED' THEN
  INSERT INTO public.calculation_monthly_inputs(id,organization_id,customer_id,consumer_unit_id,month,previous_id,measurements,billed_demand,source_reference,notes,correction_reason,unit_context,origin,source_ocr_document_id,created_by,updated_by)
  VALUES(inputid,p_org,old.customer_id,old.consumer_unit_id,old.month,old.id,old.measurements,billed,old.source_reference,old.notes,'Integração automática das parcelas de demanda e tarifas conferidas da fatura '||p_document,old.unit_context,'OCR_REVIEWED',p_document,p_actor,p_actor);
 ELSE
  UPDATE public.calculation_monthly_inputs SET billed_demand=billed,correction_reason='Integração automática das parcelas de demanda conferidas da fatura '||p_document,updated_by=p_actor WHERE id=inputid AND organization_id=p_org;
 END IF;
 SELECT old.unit_context||jsonb_build_object('consumption_class',to_jsonb(u)->'consumption_class') INTO context FROM public.consumer_units u WHERE id=old.consumer_unit_id AND organization_id=p_org;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  i:=i+1;
  INSERT INTO public.calculation_parameters(id,organization_id,customer_id,consumer_unit_id,kind,component_code,label,scenario,time_band,measure,amount_text,treatment,embedded_tax_codes,included_taxes,base_rule,direction,source,notes,start_date,end_date,unit_context,created_by,updated_by)
  VALUES(ids[i],p_org,old.customer_id,old.consumer_unit_id,'TARIFF','TUSD_DEMAND_'||(row->>'classification'),CASE WHEN row->>'classification'='USED' THEN 'TUSD demanda utilizada' ELSE 'TUSD demanda não utilizada' END,'ACL','ALL','BRL_KW',row->>'rate','GROSS',row->'taxCodes','Tributos destacados na linha já incluídos na tarifa. Ausência de ICMS não significa zero ou isenção.','','DEBIT','OCR CPFL · documento '||p_document||' · SHA-256 '||p_file_hash||' · '||(row->>'source'),'Integração automática. Quantidade '||(row->>'quantity')||' kW; valor R$ '||(row->>'amount')||'. Aprovação pendente.',startday,endday,context,p_actor,p_actor);
 END LOOP;
 RETURN jsonb_build_object('alreadyIntegrated',false,'inputId',inputid,'parameterIds',ids);
END $$;
CREATE OR REPLACE FUNCTION public.guard_ocr_monthly_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE integration public.document_ocr_monthly_integrations; split public.document_ocr_split_demand_integrations;
BEGIN
 SELECT * INTO split FROM public.document_ocr_split_demand_integrations WHERE input_id=NEW.id AND organization_id=NEW.organization_id;
 IF FOUND THEN
  IF NEW.source_ocr_document_id IS DISTINCT FROM split.document_id OR NEW.origin<>'OCR_REVIEWED' THEN RAISE EXCEPTION 'Split origin mismatch' USING ERRCODE='P4090';END IF;
  IF TG_OP='INSERT' AND (NEW.measurements IS DISTINCT FROM split.source_snapshot->'measurements' OR NEW.billed_demand IS DISTINCT FROM split.source_snapshot->'billedDemand' OR NEW.created_by IS DISTINCT FROM split.created_by OR NEW.status<>'DRAFT') THEN RAISE EXCEPTION 'Split snapshot mismatch' USING ERRCODE='P4090';END IF;
  IF NEW.status='VALIDATED' THEN
   PERFORM public.checked_ocr_monthly_source(NEW.organization_id,split.document_id,split.review_refs);
   PERFORM public.checked_ocr_billed_demand(NEW.organization_id,split.document_id,split.demand_refs);
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.origin<>'OCR_REVIEWED' THEN RETURN NEW;END IF;
 SELECT * INTO integration FROM public.document_ocr_monthly_integrations WHERE input_id=NEW.id AND organization_id=NEW.organization_id AND document_id=NEW.source_ocr_document_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'OCR integration provenance required' USING ERRCODE='P4090';END IF;
 IF TG_OP='INSERT' AND (NEW.measurements IS DISTINCT FROM integration.source_snapshot->'measurements' OR NEW.created_by IS DISTINCT FROM integration.created_by OR NEW.status<>'DRAFT') THEN RAISE EXCEPTION 'OCR integration snapshot mismatch' USING ERRCODE='P4090';END IF;
 IF NEW.status='VALIDATED' THEN PERFORM public.checked_ocr_monthly_source(NEW.organization_id,NEW.source_ocr_document_id,integration.review_refs);END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.guard_ocr_split_tariff_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.document_ocr_split_demand_integrations;
BEGIN
 IF NEW.status='APPROVED' THEN
  SELECT * INTO s FROM public.document_ocr_split_demand_integrations WHERE organization_id=NEW.organization_id AND NEW.id=ANY(parameter_ids);
  IF FOUND THEN PERFORM public.checked_ocr_monthly_source(NEW.organization_id,s.document_id,s.review_refs);PERFORM public.checked_ocr_billed_demand(NEW.organization_id,s.document_id,s.demand_refs);END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER ocr_split_tariff_approval BEFORE UPDATE ON public.calculation_parameters FOR EACH ROW EXECUTE FUNCTION public.guard_ocr_split_tariff_approval();
REVOKE ALL ON FUNCTION public.integrate_ocr_split_demand(text,text,text,uuid,integer,jsonb,jsonb,uuid,text,jsonb),public.guard_ocr_split_tariff_approval() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.integrate_ocr_split_demand(text,text,text,uuid,integer,jsonb,jsonb,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
