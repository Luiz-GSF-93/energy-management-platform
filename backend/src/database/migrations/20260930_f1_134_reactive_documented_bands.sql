-- F1.134: independent billed reactive bands; absence is not zero.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.guard_monthly_input() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prior public.calculation_monthly_inputs%ROWTYPE; k text; v jsonb; total numeric; peak numeric; offpeak numeric;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Preserve monthly input history';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=NEW.consumer_unit_id AND u.organization_id=NEW.organization_id AND c.id=NEW.customer_id AND c.deleted_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P3403',MESSAGE='Invalid organization scope';END IF;
 IF nullif(btrim(NEW.created_by),'') IS NULL OR nullif(btrim(NEW.updated_by),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Actor required';END IF;
 IF jsonb_typeof(NEW.measurements) IS DISTINCT FROM 'object' OR NOT (NEW.measurements ?& ARRAY['consumptionTotal','consumptionPeak','consumptionOffPeak','demandSingle','demandPeak','demandOffPeak','reactiveTotal']) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Invalid measurement structure';END IF;
 FOR k,v IN SELECT * FROM jsonb_each(NEW.measurements) LOOP
  IF k NOT IN ('consumptionTotal','consumptionPeak','consumptionOffPeak','demandSingle','demandPeak','demandOffPeak','reactiveTotal','reactiveBilledPeakKwh','reactiveBilledOffPeakKwh') OR (v<>'null'::jsonb AND (jsonb_typeof(v)<>'string' OR (v#>>'{}') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$')) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Use explicit decimal strings or null';END IF;
 END LOOP;
 total:=(NEW.measurements->>'consumptionTotal')::numeric;peak:=(NEW.measurements->>'consumptionPeak')::numeric;offpeak:=(NEW.measurements->>'consumptionOffPeak')::numeric;
 IF total IS NOT NULL AND peak IS NOT NULL AND offpeak IS NOT NULL AND total<>peak+offpeak THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Consumption sum differs';END IF;
 IF NEW.measurements->>'demandSingle' IS NOT NULL AND (NEW.measurements->>'demandPeak' IS NOT NULL OR NEW.measurements->>'demandOffPeak' IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Do not mix single and time-band demand';END IF;
 IF NEW.measurements->>'reactiveTotal' IS NOT NULL AND (NEW.measurements->>'reactiveBilledPeakKwh' IS NOT NULL OR NEW.measurements->>'reactiveBilledOffPeakKwh' IS NOT NULL) THEN RAISE EXCEPTION 'Do not mix reactive units' USING ERRCODE='P3401';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Create draft before validation';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id||':'||NEW.consumer_unit_id||':'||NEW.month,134));
  SELECT * INTO prior FROM public.calculation_monthly_inputs WHERE organization_id=NEW.organization_id AND consumer_unit_id=NEW.consumer_unit_id AND month=NEW.month ORDER BY version DESC LIMIT 1;
  IF FOUND THEN
   IF prior.status<>'VALIDATED' OR NEW.previous_id IS DISTINCT FROM prior.id THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Use current version; only one draft';END IF;
   IF nullif(btrim(NEW.correction_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Correction reason required';END IF;
   NEW.version:=prior.version+1;
  ELSE
   IF NEW.previous_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Invalid prior version';END IF;
   NEW.version:=1;
  END IF;
  NEW.revision:=1;NEW.created_at:=now();NEW.validated_by:=NULL;NEW.validated_at:=NULL;
 ELSE
  IF OLD.status='VALIDATED' THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Validated input is immutable';END IF;
  IF (to_jsonb(NEW)-ARRAY['billed_demand','measurements','source_reference','notes','correction_reason','status','revision','updated_at','updated_by','validated_by','validated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['billed_demand','measurements','source_reference','notes','correction_reason','status','revision','updated_at','updated_by','validated_by','validated_at']) THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Immutable scope and version';END IF;
  IF NEW.status='VALIDATED' AND (NEW.billed_demand IS DISTINCT FROM OLD.billed_demand OR NEW.measurements IS DISTINCT FROM OLD.measurements OR NEW.source_reference<>OLD.source_reference OR NEW.notes<>OLD.notes OR NEW.correction_reason<>OLD.correction_reason) THEN RAISE EXCEPTION USING ERRCODE='P3402',MESSAGE='Save changes before validating';END IF;
  NEW.revision:=OLD.revision+1;
 END IF;
 IF NEW.previous_id IS NOT NULL AND nullif(btrim(NEW.correction_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Correction reason required';END IF;
 IF NEW.status='VALIDATED' THEN
  IF (total IS NULL AND (peak IS NULL OR offpeak IS NULL)) OR ((peak IS NULL)<>(offpeak IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='P3401',MESSAGE='Complete consumption measurement';END IF;
  NEW.validated_by:=NEW.updated_by;NEW.validated_at:=now();
 ELSE NEW.validated_by:=NULL;NEW.validated_at:=NULL;END IF;
 NEW.updated_at:=now();RETURN NEW;
END $$;



ALTER TABLE public.document_ocr_reactive_integrations DROP CONSTRAINT document_ocr_reactive_integrations_parameter_ids_check;
ALTER TABLE public.document_ocr_reactive_integrations ADD CONSTRAINT document_ocr_reactive_integrations_parameter_ids_check CHECK(cardinality(parameter_ids) IN (1,2));
CREATE OR REPLACE FUNCTION public.integrate_ocr_reactive(p_org text,p_document text,p_actor text,p_input uuid,p_revision integer,p_refs jsonb,p_job uuid,p_file_hash text,p_rows jsonb,p_evidence jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.document_ocr_reactive_integrations; old public.calculation_monthly_inputs; latest public.calculation_monthly_inputs; src jsonb; row jsonb; inputid uuid; ids uuid[]=ARRAY[]::uuid[]; context jsonb; i integer=0; startday date; endday date; snapshot jsonb; new_measurements jsonb;
BEGIN
 IF nullif(btrim(p_actor),'') IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ocr-monthly:'||p_org||':'||p_document,0));
 SELECT * INTO existing FROM public.document_ocr_reactive_integrations WHERE organization_id=p_org AND document_id=p_document;
 IF FOUND THEN RETURN jsonb_build_object('alreadyIntegrated',true,'inputId',existing.input_id,'parameterIds',existing.parameter_ids);END IF;
 src:=public.checked_ocr_monthly_source(p_org,p_document,p_refs);
 IF src->>'fileHash' IS DISTINCT FROM p_file_hash OR NOT EXISTS(SELECT 1 FROM public.document_ocr_jobs WHERE id=p_job AND organization_id=p_org AND document_id=p_document AND file_hash=p_file_hash AND state='SUCCEEDED') THEN RAISE EXCEPTION 'OCR source changed' USING ERRCODE='P4090';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||(src->>'unitId')||':'||(src->>'month'),134));
 SELECT * INTO old FROM public.calculation_monthly_inputs WHERE id=p_input AND organization_id=p_org FOR UPDATE;
 SELECT * INTO latest FROM public.calculation_monthly_inputs WHERE organization_id=p_org AND consumer_unit_id=src->>'unitId' AND month=src->>'month' ORDER BY version DESC LIMIT 1;
 IF old.id IS NULL OR latest.id IS DISTINCT FROM old.id OR old.revision IS DISTINCT FROM p_revision OR old.customer_id IS DISTINCT FROM src->>'customerId' OR old.unit_context IS DISTINCT FROM src->'unitContext' OR old.status NOT IN ('DRAFT','VALIDATED') OR old.unit_context->>'tariff_group' IS DISTINCT FROM 'A' OR old.unit_context->>'free_market' IS DISTINCT FROM 'true' OR old.measurements->>'reactiveTotal' IS NOT NULL OR old.measurements->>'reactiveBilledPeakKwh' IS NOT NULL OR old.measurements->>'reactiveBilledOffPeakKwh' IS NOT NULL THEN RAISE EXCEPTION 'Monthly record changed or reactive already exists' USING ERRCODE='P4091';END IF;
 IF (old.measurements->>'consumptionTotal')::numeric IS DISTINCT FROM (src#>>'{measurements,consumptionTotal}')::numeric OR (old.measurements->>'consumptionPeak')::numeric IS DISTINCT FROM (src#>>'{measurements,consumptionPeak}')::numeric OR (old.measurements->>'consumptionOffPeak')::numeric IS DISTINCT FROM (src#>>'{measurements,consumptionOffPeak}')::numeric THEN RAISE EXCEPTION 'Consumption changed' USING ERRCODE='P4091';END IF;
 startday:=((src->>'month')||'-01')::date;endday:=(startday+interval '1 month - 1 day')::date;
 IF EXISTS(SELECT 1 FROM public.calculation_parameters WHERE organization_id=p_org AND consumer_unit_id=src->>'unitId' AND scenario='ACL' AND kind='TARIFF' AND component_code='REACTIVE' AND status<>'RETIRED' AND start_date<=endday AND end_date>=startday) THEN RAISE EXCEPTION 'Existing reactive tariff preserved' USING ERRCODE='P4091';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT IN (1,2) OR (SELECT count(DISTINCT value->>'band') FROM jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) THEN RAISE EXCEPTION 'One or two distinct documented reactive rows required' USING ERRCODE='P4090';END IF;
 IF jsonb_array_length(p_rows)=1 AND (jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence)<>1 OR p_evidence->0->>'layoutId' IS DISTINCT FROM 'neoenergia-elektro-verde' OR p_evidence->0->>'source' IS DISTINCT FROM p_rows->0->>'source' OR p_evidence->0->>'band' IS DISTINCT FROM p_rows->0->>'band') THEN RAISE EXCEPTION 'Single reactive band requires Elektro evidence' USING ERRCODE='P4090';END IF;
 new_measurements:=old.measurements;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF coalesce(row->>'band','') NOT IN ('PEAK','OFF_PEAK') OR row->>'ready' IS DISTINCT FROM 'true' OR coalesce(row->>'quantity','') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$' OR coalesce(row->>'rateMwh','') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$' OR coalesce(row->>'rateKwh','') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,9})?$' OR coalesce(row->>'amount','') !~ '^(0|[1-9][0-9]{0,11})[.][0-9]{2}$' OR coalesce(row->>'source','')='' THEN RAISE EXCEPTION 'Invalid financial source' USING ERRCODE='P4090';END IF;
  IF (row->>'rateMwh')::numeric<>(row->>'rateKwh')::numeric*1000 OR round((row->>'quantity')::numeric*(row->>'rateMwh')::numeric/1000,2)<>(row->>'amount')::numeric THEN RAISE EXCEPTION 'Reactive amount mismatch' USING ERRCODE='P4090';END IF;
  ids:=array_append(ids,gen_random_uuid());
  new_measurements:=new_measurements||jsonb_build_object(CASE row->>'band' WHEN 'PEAK' THEN 'reactiveBilledPeakKwh' ELSE 'reactiveBilledOffPeakKwh' END,row->>'quantity');
 END LOOP;
 inputid:=CASE WHEN old.status='VALIDATED' THEN gen_random_uuid() ELSE old.id END;
 snapshot:=jsonb_build_object('format','ocr-reactive-v1','fileHash',p_file_hash,'jobId',p_job,'rows',p_rows,'taxHighlights',p_evidence,'measurements',new_measurements,'billedDemand',old.billed_demand,'unitContext',old.unit_context,'previousInputId',old.id,'previousRevision',old.revision,'targetVersion',old.version+CASE WHEN old.status='VALIDATED' THEN 1 ELSE 0 END);
 INSERT INTO public.document_ocr_reactive_integrations(organization_id,document_id,input_id,parameter_ids,review_refs,source_snapshot,created_by) VALUES(p_org,p_document,inputid,ids,p_refs,snapshot,p_actor);
 IF old.status='VALIDATED' THEN
  INSERT INTO public.calculation_monthly_inputs(id,organization_id,customer_id,consumer_unit_id,month,previous_id,measurements,billed_demand,source_reference,notes,correction_reason,unit_context,origin,source_ocr_document_id,created_by,updated_by)
  VALUES(inputid,p_org,old.customer_id,old.consumer_unit_id,old.month,old.id,new_measurements,old.billed_demand,old.source_reference,old.notes,'Integração automática dos reativos faturados em kWh por posto da fatura '||p_document,old.unit_context,'OCR_REVIEWED',p_document,p_actor,p_actor);
 ELSE
  UPDATE public.calculation_monthly_inputs SET measurements=new_measurements,correction_reason='Integração automática dos reativos faturados da fatura '||p_document,updated_by=p_actor WHERE id=inputid AND organization_id=p_org;
 END IF;
 SELECT old.unit_context||jsonb_build_object('consumption_class',to_jsonb(u)->'consumption_class') INTO context FROM public.consumer_units u WHERE id=old.consumer_unit_id AND organization_id=p_org;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  i:=i+1;
  INSERT INTO public.calculation_parameters(id,organization_id,customer_id,consumer_unit_id,kind,component_code,label,scenario,time_band,measure,amount_text,treatment,embedded_tax_codes,included_taxes,base_rule,direction,source,notes,start_date,end_date,unit_context,created_by,updated_by)
  VALUES(ids[i],p_org,old.customer_id,old.consumer_unit_id,'TARIFF','REACTIVE','Energia reativa '||CASE WHEN row->>'band'='PEAK' THEN 'ponta' ELSE 'fora ponta' END,'ACL',row->>'band','BRL_MWH',row->>'rateMwh','GROSS','["ICMS","PIS","COFINS"]'::jsonb,'Tarifa da coluna com tributos da fatura; conferir declarações tributárias.','','DEBIT','OCR · documento '||p_document||' · SHA-256 '||p_file_hash||' · '||(row->>'source'),'Rascunho OCR. Quantidade '||(row->>'quantity')||' kWh; tarifa original '||(row->>'rateKwh')||' R$/kWh; valor R$ '||(row->>'amount')||'. Conversão exata da tarifa para R$/MWh. Tributo sem destaque permanece não identificado, nunca zero. Aprovação pendente.',startday,endday,context,p_actor,p_actor);
 END LOOP;
 RETURN jsonb_build_object('alreadyIntegrated',false,'inputId',inputid,'parameterIds',ids);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
