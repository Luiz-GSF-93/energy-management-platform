BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_tariff_model_evaluations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),import_id uuid NOT NULL,model_key text NOT NULL,quota_units integer NOT NULL CHECK(quota_units IN(0,1)),
 evaluation jsonb NOT NULL CHECK(jsonb_typeof(evaluation)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.eva_tariff_imports(
 id uuid PRIMARY KEY,organization_id text NOT NULL REFERENCES public.organizations(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),customer_id text NOT NULL REFERENCES public.customers(id),month text NOT NULL,
 document_id text NOT NULL REFERENCES public.documents(id),source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(organization_id,id));
CREATE TABLE public.eva_tariff_candidates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,import_id uuid NOT NULL,position integer NOT NULL,
 candidate jsonb NOT NULL CHECK(jsonb_typeof(candidate)='object'),FOREIGN KEY(organization_id,import_id) REFERENCES public.eva_tariff_imports(organization_id,id),UNIQUE(import_id,position));
CREATE TABLE public.eva_tariff_events(
 id uuid PRIMARY KEY,organization_id text NOT NULL REFERENCES public.organizations(id),kind text NOT NULL CHECK(kind IN('IMPORT','REVIEW','QUALIFY','ADVICERESERVE','ADVICEFINISH','RESERVEMODEL')),
 subject_id uuid NOT NULL,payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.eva_tariff_model_evaluations ADD FOREIGN KEY(organization_id,import_id) REFERENCES public.eva_tariff_imports(organization_id,id);
CREATE INDEX eva_tariff_import_scope ON public.eva_tariff_imports(organization_id,consumer_unit_id,month,created_at DESC);
CREATE INDEX eva_tariff_event_scope ON public.eva_tariff_events(organization_id,created_at DESC);
DO $$DECLARE n text;BEGIN FOREACH n IN ARRAY ARRAY['eva_tariff_model_evaluations','eva_tariff_imports','eva_tariff_candidates','eva_tariff_events'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',n);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.preserve_calculation_autofill()',n||'_immutable',n);
END LOOP;END$$;
CREATE FUNCTION public.eva_tariff_workbench_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_unit text,p_month text,p_id uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE unit_row public.consumer_units;rights jsonb;member record;writer boolean:=false;pg integer;data jsonb;imp public.eva_tariff_imports;event public.eva_tariff_events;doc public.documents;lib jsonb;candidate jsonb;pos integer;result jsonb;profile jsonb;library_id uuid;lic record;used bigint;charge integer;revision_count integer;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('inspect','checkDocument','import','review','qualify','adviceReserve','adviceFinish','reserveModel') OR p_org IS NULL OR p_actor IS NULL OR p_role IS NULL OR p_platform IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>500000 THEN RAISE EXCEPTION 'Invalid tariff request' USING ERRCODE='22023';END IF;
 rights:=public.eva_assisted_closing_action(p_org,p_actor,p_role,p_platform,'history',p_unit,p_month,NULL,'{"page":0}');
 SELECT * INTO STRICT unit_row FROM public.consumer_units WHERE organization_id=p_org AND id=p_unit;
 IF p_platform THEN writer:=true;ELSE
  SELECT rr.permissions INTO member FROM public.organization_members m JOIN public.roles rr ON rr.id=m.role_id AND rr.organization_id=m.organization_id AND rr.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' FOR SHARE OF m,rr;
  writer:=coalesce((rights->>'canPrepare')::boolean,false) AND member.permissions ? 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce' AND member.permissions ? 'fd8a932f-87c0-4f86-8389-9f30c50e95b7';
 END IF;
 IF p_action='inspect' THEN
  IF p_id IS NOT NULL OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['page'] OR p_body->>'page' !~ '^\d{1,3}$' OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;
  RETURN jsonb_build_object('canWrite',writer,'canManage',rights->'canManage','page',pg,'libraries',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY created_at DESC),'[]') FROM(SELECT * FROM public.tariff_library_versions WHERE organization_id=p_org ORDER BY created_at DESC,id LIMIT 25 OFFSET pg*25)v),
   'total',(SELECT count(*) FROM public.tariff_library_versions WHERE organization_id=p_org),
   'documents',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',original_filename,'verified',file_verified)),'[]') FROM(SELECT * FROM public.documents WHERE organization_id=p_org AND customer_id=unit_row.customer_id AND consumer_unit_id=p_unit AND document_type='INVOICE_DISTRIBUTOR' AND left(reference_month::text,7)=p_month AND to_jsonb(documents)->>'deleted_at' IS NULL ORDER BY created_at DESC LIMIT 100)v),
   'imports',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM(SELECT * FROM public.eva_tariff_imports WHERE organization_id=p_org AND customer_id=unit_row.customer_id AND consumer_unit_id=p_unit AND month=p_month ORDER BY created_at DESC LIMIT 10)v),
   'evaluations',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM(SELECT * FROM public.eva_tariff_model_evaluations e WHERE e.organization_id=p_org AND EXISTS(SELECT 1 FROM public.eva_tariff_imports i WHERE i.id=e.import_id AND i.organization_id=p_org AND i.consumer_unit_id=p_unit AND i.customer_id=unit_row.customer_id AND i.month=p_month) ORDER BY created_at DESC LIMIT 1000)v),
   'events',(SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') FROM(SELECT * FROM public.eva_tariff_events e WHERE e.organization_id=p_org AND EXISTS(SELECT 1 FROM public.eva_tariff_imports i WHERE i.id=e.subject_id AND i.organization_id=p_org AND i.consumer_unit_id=p_unit AND i.customer_id=unit_row.customer_id AND i.month=p_month) OR e.organization_id=p_org AND e.kind='RESERVEMODEL' AND EXISTS(SELECT 1 FROM public.documents d WHERE d.id=e.subject_id::text AND d.organization_id=p_org AND d.consumer_unit_id=p_unit AND left(d.reference_month::text,7)=p_month) ORDER BY created_at DESC LIMIT 25 OFFSET pg*25)v));
 END IF;
 IF p_action='checkDocument' THEN
  IF p_id IS NOT NULL OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['documentId'] THEN RAISE EXCEPTION 'Invalid document request' USING ERRCODE='22023';END IF;
  PERFORM 1 FROM public.documents WHERE id=p_body->>'documentId' AND organization_id=p_org AND customer_id=unit_row.customer_id AND consumer_unit_id=p_unit AND left(reference_month::text,7)=p_month AND document_type='INVOICE_DISTRIBUTOR' AND to_jsonb(documents)->>'deleted_at' IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document denied' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('allowed',true);
 END IF;
 IF NOT coalesce(writer,false) THEN RAISE EXCEPTION 'Tariff write denied' USING ERRCODE='42501';END IF;
 IF p_id IS NULL OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['hash','payload'] OR p_body->>'hash' IS NULL OR p_body->>'hash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_body->'payload') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-tariff:'||p_org,0));
 SELECT * INTO event FROM public.eva_tariff_events WHERE id=p_id;
 IF FOUND THEN
  IF event.organization_id<>p_org OR event.actor_id<>p_actor OR event.kind<>upper(p_action) OR event.payload->>'requestHash' IS DISTINCT FROM p_body->>'hash' THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('event',to_jsonb(event),'replayed',true);
 END IF;
 data:=p_body->'payload';
 IF p_action='reserveModel' THEN
  PERFORM 1 FROM public.documents WHERE id=data->>'documentId' AND organization_id=p_org AND customer_id=unit_row.customer_id AND consumer_unit_id=p_unit AND left(reference_month::text,7)=p_month AND file_verified=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document denied' USING ERRCODE='42501';END IF;
  IF data->>'modelKey' IS NULL OR data->>'modelKey' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid model' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM public.eva_tariff_events WHERE organization_id=p_org AND kind='RESERVEMODEL' AND subject_id=(data->>'documentId')::uuid) THEN RETURN jsonb_build_object('acquired',false);END IF;
  SELECT (SELECT count(*) FROM public.eva_tariff_model_evaluations WHERE organization_id=p_org AND model_key=data->>'modelKey')+(SELECT count(*) FROM public.eva_tariff_events e WHERE e.organization_id=p_org AND e.kind='RESERVEMODEL' AND e.payload->>'modelKey'=data->>'modelKey' AND NOT EXISTS(SELECT 1 FROM public.eva_tariff_imports i WHERE i.organization_id=p_org AND i.document_id=e.subject_id::text)) INTO revision_count;
  IF revision_count>=6 THEN RAISE EXCEPTION 'Model revision limit: 6' USING ERRCODE='22023';END IF;
  INSERT INTO public.eva_tariff_events(id,organization_id,kind,subject_id,payload,actor_id) VALUES(p_id,p_org,'RESERVEMODEL',(data->>'documentId')::uuid,jsonb_build_object('requestHash',p_body->>'hash','modelKey',data->>'modelKey'),p_actor) RETURNING * INTO event;
  RETURN jsonb_build_object('acquired',true,'event',to_jsonb(event),'replayed',false);
 ELSIF p_action IN('qualify','adviceReserve','adviceFinish','reserveModel') THEN
  SELECT * INTO imp FROM public.eva_tariff_imports WHERE id=(data->>'importId')::uuid AND organization_id=p_org AND customer_id=unit_row.customer_id AND consumer_unit_id=p_unit AND month=p_month FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import denied' USING ERRCODE='42501';END IF;
  IF p_action='qualify' THEN
   PERFORM 1 FROM public.documents WHERE id=imp.document_id AND organization_id=p_org AND customer_id=unit_row.customer_id AND consumer_unit_id=p_unit AND file_hash=imp.source_hash AND file_verified=true AND document_type='INVOICE_DISTRIBUTOR' FOR SHARE;
   IF NOT FOUND OR unit_row.distributor IS DISTINCT FROM imp.payload#>>'{profile,distributor}' OR unit_row.tariff_group IS DISTINCT FROM imp.payload#>>'{profile,group}' OR unit_row.tariff_subgroup IS DISTINCT FROM imp.payload#>>'{profile,subgroup}' OR unit_row.tariff_modality IS DISTINCT FROM imp.payload#>>'{profile,modality}' THEN RAISE EXCEPTION 'Model registration changed' USING ERRCODE='40001';END IF;

   IF rights->>'canManage' IS DISTINCT FROM 'true' OR data->'acknowledge' IS DISTINCT FROM 'true'::jsonb OR length(btrim(data->>'note')) NOT BETWEEN 20 AND 1500 THEN RAISE EXCEPTION 'Model decision denied' USING ERRCODE='42501';END IF;
   IF EXISTS(SELECT 1 FROM public.eva_tariff_events WHERE organization_id=p_org AND subject_id=imp.id AND kind='QUALIFY') THEN RAISE EXCEPTION 'Already homologated' USING ERRCODE='23505';END IF;
   IF imp.payload#>>'{evaluation,state}' IS DISTINCT FROM 'READY_FOR_REVIEW' OR NOT EXISTS(SELECT 1 FROM public.eva_tariff_events WHERE organization_id=p_org AND subject_id=imp.id AND kind='ADVICEFINISH' AND payload#>>'{result,advice,state}'='READY') THEN RAISE EXCEPTION 'OCR and AI quality not ready' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT 1 FROM public.eva_tariff_imports n WHERE n.organization_id=p_org AND n.payload->>'modelKey'=imp.payload->>'modelKey' AND n.created_at>imp.created_at) THEN RAISE EXCEPTION 'New model revision exists' USING ERRCODE='40001';END IF;
   result:=jsonb_build_object('importId',imp.id,'state','HOMOLOGATED','note',data->>'note');
  ELSIF p_action='adviceReserve' THEN
   IF EXISTS(SELECT 1 FROM public.eva_tariff_events WHERE organization_id=p_org AND subject_id=imp.id AND kind='ADVICERESERVE') THEN RETURN jsonb_build_object('acquired',false);END IF;
   result:=jsonb_build_object('importId',imp.id,'state','REQUESTED');
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.eva_tariff_events WHERE id=(data->>'reservationId')::uuid AND organization_id=p_org AND subject_id=imp.id AND actor_id=p_actor AND kind='ADVICERESERVE') OR EXISTS(SELECT 1 FROM public.eva_tariff_events WHERE organization_id=p_org AND subject_id=imp.id AND kind='ADVICEFINISH') THEN RAISE EXCEPTION 'Advice reservation mismatch' USING ERRCODE='40001';END IF;
   result:=data;
  END IF;
  INSERT INTO public.eva_tariff_events(id,organization_id,kind,subject_id,payload,actor_id) VALUES(p_id,p_org,upper(p_action),imp.id,jsonb_build_object('requestHash',p_body->>'hash','result',result),p_actor) RETURNING * INTO event;
  RETURN jsonb_build_object('acquired',p_action='adviceReserve','event',to_jsonb(event),'replayed',false);
 ELSIF p_action='import' THEN
  IF data->>'documentId' IS NULL OR data->>'sourceHash' IS NULL OR jsonb_typeof(data->'candidates') IS DISTINCT FROM 'array' OR jsonb_array_length(data->'candidates')>200 THEN RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='22023';END IF;
  SELECT * INTO doc FROM public.documents WHERE id=data->>'documentId' AND organization_id=p_org AND customer_id=unit_row.customer_id AND consumer_unit_id=p_unit AND left(reference_month::text,7)=p_month AND document_type='INVOICE_DISTRIBUTOR' AND file_verified=true AND file_hash=data->>'sourceHash' AND to_jsonb(documents)->>'deleted_at' IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document changed' USING ERRCODE='40001';END IF;
  INSERT INTO public.eva_tariff_imports(id,organization_id,consumer_unit_id,customer_id,month,document_id,source_hash,payload_hash,payload,created_by) VALUES(p_id,p_org,p_unit,unit_row.customer_id,p_month,doc.id,doc.file_hash,p_body->>'hash',data,p_actor);
  pos:=0;FOR candidate IN SELECT value FROM jsonb_array_elements(data->'candidates') LOOP
   INSERT INTO public.eva_tariff_candidates(organization_id,import_id,position,candidate) VALUES(p_org,p_id,pos,candidate);pos:=pos+1;
  END LOOP;
  IF data->>'modelKey' IS NULL OR data->>'modelKey' !~ '^[a-f0-9]{64}$' OR (data#>>'{evaluation,threshold}')::numeric NOT BETWEEN 0.9 AND 1 THEN RAISE EXCEPTION 'Invalid model' USING ERRCODE='22023';END IF;
  SELECT (SELECT count(*) FROM public.eva_tariff_model_evaluations WHERE organization_id=p_org AND model_key=data->>'modelKey')+(SELECT count(*) FROM public.eva_tariff_events e WHERE e.organization_id=p_org AND e.kind='RESERVEMODEL' AND e.payload->>'modelKey'=data->>'modelKey' AND NOT EXISTS(SELECT 1 FROM public.eva_tariff_imports i WHERE i.organization_id=p_org AND i.document_id=e.subject_id::text)) INTO revision_count;
  IF revision_count>=6 THEN RAISE EXCEPTION 'Model revision limit: 6' USING ERRCODE='22023';END IF;
  -- Upload already consumes one document. Re-evaluating a retained document consumes an additional unit.
  charge:=CASE WHEN EXISTS(SELECT 1 FROM public.eva_tariff_imports WHERE organization_id=p_org AND document_id=doc.id AND id<>p_id) THEN 1 ELSE 0 END;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
  SELECT * INTO lic FROM public.licenses WHERE organization_id=p_org AND active=true AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE);
  IF NOT FOUND THEN RAISE EXCEPTION 'Active license required' USING ERRCODE='42501';END IF;
  used:=(public.organization_resource_usage(p_org)->>'documents')::bigint;
  IF charge>0 AND NOT coalesce(lic.documents_unlimited,false) AND (lic.documents_limit IS NULL OR used+charge>lic.documents_limit) THEN RAISE EXCEPTION 'Document quota exceeded' USING ERRCODE='22023';END IF;
  INSERT INTO public.eva_tariff_model_evaluations(organization_id,import_id,model_key,quota_units,evaluation) VALUES(p_org,p_id,data->>'modelKey',charge,data->'evaluation');
  IF charge>0 THEN UPDATE public.licenses SET documents_used=used+charge WHERE id=lic.id;END IF;
  result:=jsonb_build_object('importId',p_id);
 ELSE
  IF data->>'importId' IS NULL OR data->>'importId' !~ '^[a-f0-9-]{36}$' OR length(btrim(data->>'reason')) NOT BETWEEN 20 AND 1500 OR jsonb_typeof(data->'library') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE='22023';END IF;
  SELECT * INTO imp FROM public.eva_tariff_imports WHERE id=(data->>'importId')::uuid AND organization_id=p_org AND customer_id=unit_row.customer_id AND consumer_unit_id=p_unit AND month=p_month FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import denied' USING ERRCODE='42501';END IF;
  IF EXISTS(SELECT 1 FROM public.eva_tariff_events WHERE organization_id=p_org AND kind='REVIEW' AND subject_id=imp.id) THEN RAISE EXCEPTION 'Import already reviewed; prepare new version' USING ERRCODE='23505';END IF;
  PERFORM 1 FROM public.documents WHERE id=imp.document_id AND organization_id=p_org AND file_hash=imp.source_hash AND file_verified=true AND to_jsonb(documents)->>'deleted_at' IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='40001';END IF;
  profile:=data->'library';
  lib:=public.save_tariff_library(p_org,p_actor,profile-'previousId'-'reason',data->>'reason',nullif(profile->>'previousId','')::uuid);
  library_id:=(lib->>'id')::uuid;result:=jsonb_build_object('importId',imp.id,'library',lib,'corrections',profile);
 END IF;
 INSERT INTO public.eva_tariff_events(id,organization_id,kind,subject_id,payload,actor_id) VALUES(p_id,p_org,upper(p_action),CASE WHEN p_action='review' THEN imp.id ELSE p_id END,jsonb_build_object('requestHash',p_body->>'hash','result',result,'reason',data->>'reason'),p_actor) RETURNING * INTO event;
 RETURN jsonb_build_object('event',to_jsonb(event),'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.eva_tariff_workbench_action(text,text,text,boolean,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_tariff_workbench_action(text,text,text,boolean,text,text,text,uuid,jsonb) TO service_role;

-- Retained files and explicit model re-evaluations share the contracted document allowance.
CREATE OR REPLACE FUNCTION public.organization_resource_usage(org text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('users',(SELECT count(*) FROM public.organization_members WHERE organization_id=org AND status='active'),
 'units',(SELECT count(*) FROM public.consumer_units u WHERE organization_id=org AND to_jsonb(u)->>'deleted_at' IS NULL),
 'documents',(SELECT count(*) FROM public.documents WHERE organization_id=org)+(SELECT coalesce(sum(quota_units),0) FROM public.eva_tariff_model_evaluations WHERE organization_id=org));
$$;
CREATE OR REPLACE FUNCTION public.refresh_document_usage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org text;BEGIN org:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
 PERFORM pg_advisory_xact_lock(hashtextextended(org,315));
 UPDATE public.licenses SET documents_used=(public.organization_resource_usage(org)->>'documents')::bigint WHERE organization_id=org;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END$$;

CREATE VIEW public.eva_operational_invoices AS SELECT d.* FROM public.documents d WHERE NOT EXISTS(SELECT 1 FROM public.document_catalog c WHERE c.document_id=d.id AND c.organization_id=d.organization_id AND c.tag='MODEL');
REVOKE ALL ON public.eva_operational_invoices FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.eva_operational_invoices TO service_role;
COMMIT;
