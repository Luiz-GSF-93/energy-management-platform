-- F1.51: supplier invoices and extra purchases retain immutable monthly history.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.guard_monthly_cost() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prior public.calculation_monthly_costs%ROWTYPE; item jsonb; item_count integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='P3602',MESSAGE='Preserve monthly input history';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id WHERE u.id=NEW.consumer_unit_id AND u.organization_id=NEW.organization_id AND c.id=NEW.customer_id AND c.deleted_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P3603',MESSAGE='Invalid organization scope';END IF;
 IF nullif(btrim(NEW.created_by),'') IS NULL OR nullif(btrim(NEW.updated_by),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Actor required';END IF;
 IF jsonb_typeof(NEW.costs) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW.costs))<>2 OR NOT (NEW.costs ?& ARRAY['items','noCosts']) OR jsonb_typeof(NEW.costs->'items') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.costs->'noCosts') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Invalid cost structure';END IF;
 item_count:=jsonb_array_length(NEW.costs->'items');
 IF item_count>100 OR ((NEW.costs->>'noCosts')::boolean AND item_count>0) THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Invalid absence declaration or item limit';END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(NEW.costs->'items'))<>item_count THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Duplicate item identifier';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.costs->'items') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Invalid item';END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(item))<>8 OR NOT(item ?& ARRAY['id','label','category','scenario','effect','amount','source','taxTreatment']) OR EXISTS(SELECT 1 FROM jsonb_each(item) WHERE jsonb_typeof(value)<>'string') THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Invalid item fields';END IF;
  IF (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 200 OR length(btrim(item->>'source')) NOT BETWEEN 1 AND 1000 OR item->>'category' NOT IN ('CCEE','EXPOSURE','CHARGE','OTHER','SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY') OR item->>'scenario' NOT IN ('ACL','ACR') OR item->>'effect' NOT IN ('COST','CREDIT') OR item->>'taxTreatment' NOT IN ('INCLUDED','EXCLUDED','NOT_APPLICABLE','UNSPECIFIED') OR item->>'amount' !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$' THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Invalid cost value or classification';END IF;
  IF item->>'category' IN ('SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY') AND item->>'scenario'<>'ACL' THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Supplier invoices and extra energy require ACL';END IF;
 END LOOP;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' THEN RAISE EXCEPTION USING ERRCODE='P3602',MESSAGE='Create draft before validation';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id||':'||NEW.consumer_unit_id||':'||NEW.month,136));
  SELECT * INTO prior FROM public.calculation_monthly_costs WHERE organization_id=NEW.organization_id AND consumer_unit_id=NEW.consumer_unit_id AND month=NEW.month ORDER BY version DESC LIMIT 1;
  IF FOUND THEN
   IF prior.status<>'VALIDATED' OR NEW.previous_id IS DISTINCT FROM prior.id THEN RAISE EXCEPTION USING ERRCODE='P3602',MESSAGE='Use current version; only one draft';END IF;
   IF nullif(btrim(NEW.correction_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Correction reason required';END IF;
   NEW.version:=prior.version+1;
  ELSE
   IF NEW.previous_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3602',MESSAGE='Invalid prior version';END IF;
   NEW.version:=1;
  END IF;
  NEW.revision:=1;NEW.created_at:=now();NEW.validated_by:=NULL;NEW.validated_at:=NULL;
 ELSE
  IF OLD.status='VALIDATED' THEN RAISE EXCEPTION USING ERRCODE='P3602',MESSAGE='Validated input is immutable';END IF;
  IF (to_jsonb(NEW)-ARRAY['costs','source_reference','notes','correction_reason','status','revision','updated_at','updated_by','validated_by','validated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['costs','source_reference','notes','correction_reason','status','revision','updated_at','updated_by','validated_by','validated_at']) THEN RAISE EXCEPTION USING ERRCODE='P3602',MESSAGE='Immutable scope and version';END IF;
  IF NEW.status='VALIDATED' AND (NEW.costs IS DISTINCT FROM OLD.costs OR NEW.source_reference<>OLD.source_reference OR NEW.notes<>OLD.notes OR NEW.correction_reason<>OLD.correction_reason) THEN RAISE EXCEPTION USING ERRCODE='P3602',MESSAGE='Save changes before validating';END IF;
  NEW.revision:=OLD.revision+1;
 END IF;
 IF NEW.previous_id IS NOT NULL AND nullif(btrim(NEW.correction_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Correction reason required';END IF;
 IF NEW.status='VALIDATED' THEN
  IF (item_count=0 AND NOT (NEW.costs->>'noCosts')::boolean) OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.costs->'items') WHERE value->>'taxTreatment'='UNSPECIFIED') THEN RAISE EXCEPTION USING ERRCODE='P3601',MESSAGE='Review costs and tax treatment';END IF;
  NEW.validated_by:=NEW.updated_by;NEW.validated_at:=now();
 ELSE NEW.validated_by:=NULL;NEW.validated_at:=NULL;END IF;
 NEW.updated_at:=now();RETURN NEW;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
