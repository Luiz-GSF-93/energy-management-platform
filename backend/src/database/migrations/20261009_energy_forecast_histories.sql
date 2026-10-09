BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.energy_forecast_histories(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),document_id text NOT NULL REFERENCES public.documents(id),
 request_id uuid NOT NULL,source jsonb NOT NULL,source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 36),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 20 AND 1000),created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,request_id),UNIQUE(organization_id,id)
);
CREATE TABLE public.energy_forecast_history_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,history_id uuid NOT NULL,
 request_id uuid NOT NULL,note text NOT NULL CHECK(length(btrim(note)) BETWEEN 20 AND 1000),reviewed_by text NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,history_id) REFERENCES public.energy_forecast_histories(organization_id,id),UNIQUE(history_id),UNIQUE(organization_id,request_id)
);
ALTER TABLE public.energy_forecast_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.energy_forecast_history_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.energy_forecast_histories,public.energy_forecast_history_reviews FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER forecast_history_immutable BEFORE UPDATE OR DELETE ON public.energy_forecast_histories FOR EACH ROW EXECUTE FUNCTION public.reject_report_change();
CREATE TRIGGER forecast_history_review_immutable BEFORE UPDATE OR DELETE ON public.energy_forecast_history_reviews FOR EACH ROW EXECUTE FUNCTION public.reject_report_change();
CREATE FUNCTION public.energy_forecast_history_actor(p_org text,p_actor text,p_write boolean,p_approve boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE perms jsonb; role_name text;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,p_write);
 IF NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND document_management IS TRUE AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE)) THEN RAISE EXCEPTION 'Document license required' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN RETURN;END IF;
 SELECT r.permissions,r.name INTO perms,role_name FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';
 IF NOT COALESCE(perms ? '8f105b02-4443-49de-b188-847e0284e7ed',false) OR (p_approve AND (role_name NOT IN ('admin_org','gestor') OR NOT COALESCE(perms ? '613b71d0-67db-4761-9e11-61fdf63ac8d5',false))) THEN RAISE EXCEPTION 'Document review permission required' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION public.energy_forecast_document_source(p_org text,p_actor text,p_document text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.energy_forecast_history_actor(p_org,p_actor,false,false);
 SELECT jsonb_build_object('documentId',d.id,'organizationId',d.organization_id,'customerId',d.customer_id,'unitId',d.consumer_unit_id,'fileHash',d.file_hash,'version',c.version,'revision',c.revision,'referenceMonth',d.reference_month) INTO result
 FROM public.documents d JOIN public.document_catalog c ON c.document_id=d.id AND c.organization_id=d.organization_id
 JOIN public.consumer_units u ON u.id=d.consumer_unit_id AND u.organization_id=d.organization_id AND u.customer_id=d.customer_id AND u.status='ACTIVE'
 JOIN public.customers cu ON cu.id=d.customer_id AND cu.organization_id=d.organization_id AND cu.status='ACTIVE' AND cu.deleted_at IS NULL
 WHERE d.organization_id=p_org AND d.id=p_document AND d.document_type='INVOICE_DISTRIBUTOR' AND d.file_verified IS TRUE AND d.file_hash ~ '^[a-f0-9]{64}$' FOR SHARE OF d,c,u,cu;
 IF result IS NULL THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='P3862';END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.energy_forecast_history_record(p_org text,p_actor text,p_request uuid,p_source jsonb,p_hash text,p_rows jsonb,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.energy_forecast_histories; item jsonb; previous text='';
BEGIN
 PERFORM public.energy_forecast_history_actor(p_org,p_actor,true,false);
 IF p_source IS NULL OR public.energy_forecast_document_source(p_org,p_actor,p_source->>'documentId')<>p_source THEN RAISE EXCEPTION 'Document changed' USING ERRCODE='40001';END IF;
 IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 36 OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Invalid history' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>5 OR NOT item ?& ARRAY['month','consumptionKwh','days','page','source'] OR COALESCE(item->>'month','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' OR item->>'month'>=to_char(CURRENT_DATE,'YYYY-MM') OR COALESCE(item->>'consumptionKwh','') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$' OR COALESCE(item->>'days','') !~ '^[0-9]+$' OR (item->>'days')::int NOT BETWEEN 1 AND 62 OR COALESCE(item->>'page','') !~ '^[0-9]+$' OR (item->>'page')::int NOT BETWEEN 1 AND 1000 OR length(btrim(COALESCE(item->>'source',''))) NOT BETWEEN 3 AND 180 OR (previous<>'' AND item->>'month'<>to_char((previous||'-01')::date+interval '1 month','YYYY-MM')) THEN RAISE EXCEPTION 'Invalid historical row' USING ERRCODE='22023';END IF;
  previous:=item->>'month';
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||p_request::text,910));
 SELECT * INTO r FROM public.energy_forecast_histories WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF r.created_by<>p_actor OR r.source<>p_source OR r.source_hash<>p_hash OR r.rows<>p_rows OR r.note<>p_note THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;RETURN to_jsonb(r);END IF;
 INSERT INTO public.energy_forecast_histories(organization_id,customer_id,consumer_unit_id,document_id,request_id,source,source_hash,rows,note,created_by) VALUES(p_org,p_source->>'customerId',p_source->>'unitId',p_source->>'documentId',p_request,p_source,p_hash,p_rows,p_note,p_actor) RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION public.energy_forecast_history_approve(p_org text,p_actor text,p_history uuid,p_request uuid,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.energy_forecast_histories; ev public.energy_forecast_history_reviews;
BEGIN
 PERFORM public.energy_forecast_history_actor(p_org,p_actor,true,true);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||p_history::text,910));
 SELECT * INTO r FROM public.energy_forecast_histories WHERE organization_id=p_org AND id=p_history;
 IF NOT FOUND THEN RAISE EXCEPTION 'History unavailable' USING ERRCODE='P3862';END IF;
 IF public.energy_forecast_document_source(p_org,p_actor,r.document_id)<>r.source THEN RAISE EXCEPTION 'Document changed' USING ERRCODE='40001';END IF;
 SELECT * INTO ev FROM public.energy_forecast_history_reviews WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF ev.history_id<>p_history OR ev.reviewed_by<>p_actor OR ev.note<>p_note THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;RETURN to_jsonb(ev);END IF;
 INSERT INTO public.energy_forecast_history_reviews(organization_id,history_id,request_id,note,reviewed_by) VALUES(p_org,p_history,p_request,p_note,p_actor) RETURNING * INTO ev;
 RETURN to_jsonb(ev);
END $$;
CREATE FUNCTION public.energy_forecast_history_source(p_org text,p_actor text,p_history uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.energy_forecast_histories; review public.energy_forecast_history_reviews;
BEGIN
 PERFORM public.energy_forecast_history_actor(p_org,p_actor,false,false);
 SELECT * INTO r FROM public.energy_forecast_histories WHERE organization_id=p_org AND id=p_history;
 SELECT * INTO review FROM public.energy_forecast_history_reviews WHERE organization_id=p_org AND history_id=p_history;
 IF r.id IS NULL OR review.id IS NULL THEN RAISE EXCEPTION 'Reviewed history required' USING ERRCODE='P3862';END IF;
 IF public.energy_forecast_document_source(p_org,p_actor,r.document_id)<>r.source THEN RAISE EXCEPTION 'Document changed' USING ERRCODE='40001';END IF;
 RETURN jsonb_build_object('organizationId',p_org,'customerId',r.customer_id,'unitId',r.consumer_unit_id,'historyId',r.id,'evidenceId',r.id,'reviewedBy',review.reviewed_by,'reviewedAt',review.reviewed_at,'history',jsonb_build_object('sourceDocumentId',r.document_id,'rows',r.rows),'documents',jsonb_build_array(jsonb_build_object('id',r.document_id,'fileHash',r.source->>'fileHash','version',r.source->'version')),'ocrSourceHash',r.source_hash);
END $$;
CREATE FUNCTION public.energy_forecast_histories(p_org text,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.energy_forecast_history_actor(p_org,p_actor,false,false);
 RETURN (SELECT COALESCE(jsonb_agg(q.body),'[]'::jsonb) FROM (SELECT to_jsonb(h)||jsonb_build_object('reviewedAt',r.reviewed_at,'customerName',c.company_name,'unitName',u.name,'lastMonth',h.rows->(jsonb_array_length(h.rows)-1)->>'month') body
 FROM public.energy_forecast_histories h LEFT JOIN public.energy_forecast_history_reviews r ON r.organization_id=h.organization_id AND r.history_id=h.id
 JOIN public.consumer_units u ON u.id=h.consumer_unit_id AND u.organization_id=h.organization_id AND u.customer_id=h.customer_id AND u.status='ACTIVE'
 JOIN public.customers c ON c.id=h.customer_id AND c.organization_id=h.organization_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 WHERE h.organization_id=p_org ORDER BY h.created_at DESC LIMIT 100) q);
END $$;
REVOKE ALL ON FUNCTION public.energy_forecast_history_actor(text,text,boolean,boolean),public.energy_forecast_document_source(text,text,text),public.energy_forecast_history_record(text,text,uuid,jsonb,text,jsonb,text),public.energy_forecast_history_approve(text,text,uuid,uuid,text),public.energy_forecast_history_source(text,text,uuid),public.energy_forecast_histories(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.energy_forecast_history_actor(text,text,boolean,boolean),public.energy_forecast_document_source(text,text,text),public.energy_forecast_history_record(text,text,uuid,jsonb,text,jsonb,text),public.energy_forecast_history_approve(text,text,uuid,uuid,text),public.energy_forecast_history_source(text,text,uuid),public.energy_forecast_histories(text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
