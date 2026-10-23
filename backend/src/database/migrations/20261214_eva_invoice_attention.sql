BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_invoice_attention_events(
 id uuid PRIMARY KEY,organization_id text NOT NULL REFERENCES public.organizations(id),actor_id text NOT NULL,
 document_id text NOT NULL REFERENCES public.documents(id),source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('OPENED','DEFERRED','SCHEDULED','PAUSED')),
 note text NOT NULL CHECK(length(note) BETWEEN 3 AND 500),agenda_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX eva_invoice_attention_scope ON public.eva_invoice_attention_events(organization_id,actor_id,document_id,created_at DESC,id);
ALTER TABLE public.eva_invoice_attention_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eva_invoice_attention_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.eva_invoice_attention_events FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER eva_invoice_attention_immutable BEFORE UPDATE OR DELETE ON public.eva_invoice_attention_events FOR EACH ROW EXECUTE FUNCTION public.preserve_calculation_autofill();
CREATE FUNCTION public.eva_invoice_attention(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_document text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d record;r public.eva_invoice_attention_events;result jsonb:='[]';item jsonb;counted integer:=0;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('list','record') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>3000 THEN RAISE EXCEPTION 'Invalid invoice attention' USING ERRCODE='22023';END IF;
 IF p_org IS NULL OR p_actor IS NULL OR p_role IS NULL OR p_platform IS NULL THEN RAISE EXCEPTION 'Organization context required' USING ERRCODE='42501';END IF;
 IF p_action='list' AND (p_document IS NOT NULL OR p_body<>'{}') THEN RAISE EXCEPTION 'Invalid inbox request' USING ERRCODE='22023';END IF;
 FOR d IN SELECT DISTINCT ON(doc.id) doc.id,doc.file_hash,doc.customer_id,doc.consumer_unit_id,to_char(doc.reference_month,'YYYY-MM') AS ref_month,doc.original_filename,doc.created_at,u.name unit_name,c.company_name customer_name,
  CASE WHEN EXISTS(SELECT 1 FROM public.portal_document_events pe WHERE pe.intake_id=i.id AND pe.event_key='backoffice-library') THEN 'BACKOFFICE' ELSE 'PORTAL' END origin,
  (SELECT j.state FROM public.document_ocr_jobs j WHERE j.organization_id=p_org AND j.document_id=doc.id ORDER BY j.created_at DESC,j.id DESC LIMIT 1) ocr_state
  FROM public.documents doc JOIN public.portal_document_intakes i ON i.document_id=doc.id AND i.organization_id=p_org AND i.file_hash=doc.file_hash AND i.kind='INVOICE'
  JOIN public.consumer_units u ON u.id=doc.consumer_unit_id AND u.organization_id=p_org AND u.customer_id=doc.customer_id
  JOIN public.customers c ON c.id=doc.customer_id AND c.organization_id=p_org
  WHERE doc.organization_id=p_org AND doc.file_verified AND doc.document_type='INVOICE_DISTRIBUTOR' AND doc.reference_month IS NOT NULL
   AND (p_action='record' AND doc.id=p_document OR p_action='list' AND (i.created_at>=now()-interval '30 days' OR EXISTS(SELECT 1 FROM public.eva_invoice_attention_events a WHERE a.organization_id=p_org AND a.actor_id=p_actor AND a.document_id=doc.id AND a.state IN('SCHEDULED','PAUSED','DEFERRED','OPENED'))))
  ORDER BY doc.id,doc.created_at DESC,i.created_at DESC,i.id DESC LIMIT 202
 LOOP
  counted:=counted+1;IF counted>200 THEN RAISE EXCEPTION 'Invoice inbox too large; consult documents' USING ERRCODE='22023';END IF;
  BEGIN PERFORM public.calculation_autofill_action(p_org,p_actor,p_role,p_platform,'access',d.consumer_unit_id,d.ref_month,null,'{}');
  EXCEPTION WHEN insufficient_privilege THEN CONTINUE;END;
  SELECT * INTO r FROM public.eva_invoice_attention_events WHERE organization_id=p_org AND actor_id=p_actor AND document_id=d.id AND source_hash=d.file_hash ORDER BY created_at DESC,id DESC LIMIT 1;
  item:=jsonb_build_object('documentId',d.id,'sourceHash',d.file_hash,'customerId',d.customer_id,'unitId',d.consumer_unit_id,'unitName',d.unit_name,'customerName',d.customer_name,'month',d.ref_month,'filename',d.original_filename,'createdAt',d.created_at,'ocrState',d.ocr_state,'origin',d.origin,'state',r.state,'agendaId',r.agenda_id);
  IF p_action='record' THEN
   IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['agendaId','note','requestId','sourceHash','state'] OR jsonb_typeof(p_body->'requestId') IS DISTINCT FROM 'string' OR p_body->>'requestId' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR p_body->>'sourceHash' IS DISTINCT FROM d.file_hash OR p_body->>'state' IS NULL OR p_body->>'state' NOT IN('OPENED','DEFERRED','SCHEDULED','PAUSED') OR jsonb_typeof(p_body->'note') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'note')) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Attention source changed or invalid decision' USING ERRCODE='40001';END IF;
   IF p_body->>'state'='SCHEDULED' THEN
    IF NOT EXISTS(SELECT 1 FROM public.operation_records o WHERE o.id=(p_body->>'agendaId')::uuid AND o.organization_id=p_org AND o.kind='agenda' AND o.document_id=d.id AND o.consumer_unit_id=d.consumer_unit_id AND o.customer_id=d.customer_id AND o.created_by=p_actor AND o.status NOT IN('CANCELLED','DONE')) THEN RAISE EXCEPTION 'Agenda proof required' USING ERRCODE='42501';END IF;
   ELSIF p_body->'agendaId'<>'null'::jsonb THEN RAISE EXCEPTION 'Unexpected agenda' USING ERRCODE='22023';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('eva-attention:'||p_org||':'||p_actor||':'||(p_body->>'requestId'),0));
   SELECT * INTO r FROM public.eva_invoice_attention_events WHERE id=(p_body->>'requestId')::uuid;
   IF FOUND THEN
    IF r.organization_id<>p_org OR r.actor_id<>p_actor OR r.document_id<>d.id OR r.source_hash<>d.file_hash OR r.state<>p_body->>'state' OR r.note<>btrim(p_body->>'note') OR r.agenda_id IS DISTINCT FROM (p_body->>'agendaId')::uuid THEN RAISE EXCEPTION 'Immutable attention result' USING ERRCODE='23505';END IF;
   ELSE
    INSERT INTO public.eva_invoice_attention_events(id,organization_id,actor_id,document_id,source_hash,state,note,agenda_id) VALUES((p_body->>'requestId')::uuid,p_org,p_actor,d.id,d.file_hash,p_body->>'state',btrim(p_body->>'note'),(p_body->>'agendaId')::uuid) RETURNING * INTO r;
   END IF;
   RETURN item||jsonb_build_object('state',r.state,'agendaId',r.agenda_id,'recorded',true);
  END IF;
  result:=result||jsonb_build_array(item);
 END LOOP;
 IF p_action='record' THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('rows',result,'checkedAt',clock_timestamp());
END$$;
REVOKE ALL ON FUNCTION public.eva_invoice_attention(text,text,text,boolean,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_invoice_attention(text,text,text,boolean,text,text,jsonb) TO service_role;
COMMIT;
