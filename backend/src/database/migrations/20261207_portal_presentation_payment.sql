BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.portal_invoice_payment_declarations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 intake_id uuid NOT NULL REFERENCES public.portal_document_intakes(id), customer_id text NOT NULL, consumer_unit_id text NOT NULL,
 document_id text NOT NULL REFERENCES public.documents(id), file_hash text NOT NULL CHECK(file_hash~'^[a-f0-9]{64}$'),
 revision integer NOT NULL CHECK(revision>0), state text NOT NULL CHECK(state IN('PAID','UNPAID')),
 actor_id text NOT NULL, request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_id), UNIQUE(intake_id,revision)
);
ALTER TABLE public.portal_invoice_payment_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_invoice_payment_declarations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_invoice_payment_declarations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER preserve_portal_payment_history BEFORE UPDATE OR DELETE ON public.portal_invoice_payment_declarations FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();
CREATE INDEX portal_payment_scope ON public.portal_invoice_payment_declarations(organization_id,customer_id,consumer_unit_id,intake_id,revision DESC);

-- Private gateway: raw OCR is returned only to the backend, never directly to the customer.
CREATE FUNCTION public.portal_presentation_action(p_org text,p_actor text,p_role text,p_action text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a jsonb; customer text; i public.portal_document_intakes; source_document public.documents; prior public.portal_invoice_payment_declarations; portal_module text;
 n integer; result jsonb; binding jsonb; chosen text; pub jsonb;
BEGIN
 IF p_org IS NULL OR p_actor IS NULL OR p_role IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>2000 THEN RAISE EXCEPTION 'Invalid context' USING ERRCODE='42501';END IF;
 IF p_action='identity' THEN
  FOREACH portal_module IN ARRAY ARRAY['reports','documents','notifications'] LOOP
   BEGIN binding:=public.client_portal_entitlement(p_org,p_actor,p_role,portal_module);EXCEPTION WHEN SQLSTATE '42501' THEN binding:=NULL;END;
   IF binding->>'enabled'='true' AND binding->>'organizationId'=p_org AND binding->>'customerId' IS NOT NULL THEN customer:=binding->>'customerId';EXIT;END IF;
  END LOOP;
  IF customer IS NULL THEN RAISE EXCEPTION 'Portal required' USING ERRCODE='42501';END IF;
 ELSIF p_action IN('usage','payment_evidence') THEN
  binding:=public.client_portal_entitlement(p_org,p_actor,p_role,'reports');
  IF binding->>'enabled' IS DISTINCT FROM 'true' OR binding->>'organizationId' IS DISTINCT FROM p_org OR binding->>'customerId' IS NULL THEN RAISE EXCEPTION 'Portal required' USING ERRCODE='42501';END IF;
  customer:=binding->>'customerId';
 ELSE
  a:=public.portal_workspace_actor(p_org,p_actor,p_role,false,CASE WHEN p_action IN('notices','requests') THEN 'notifications' ELSE 'documents' END);
  IF a->>'external' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'External portal required' USING ERRCODE='42501';END IF;
  customer:=a->>'customerId';
 END IF;
 IF p_action='identity' THEN
  IF p_body<>'{}' OR p_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023';END IF;
  SELECT jsonb_build_object('organizationId',p_org,'customerId',customer,'companyName',c.company_name,'units',
   (SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'installation',u.consumer_unit_number,'address',u.address) ORDER BY u.name,u.id),'[]') FROM public.consumer_units u WHERE u.organization_id=p_org AND u.customer_id=customer AND u.status='ACTIVE')) INTO result
   FROM public.customers c WHERE c.organization_id=p_org AND c.id=customer AND c.status='ACTIVE';
  IF result IS NULL THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='42501';END IF;
  RETURN result;
 ELSIF p_action='requests' THEN
  IF p_body-ARRAY['offset']<>'{}' OR coalesce(p_body->>'offset','0')!~'^[0-9]{1,5}$' THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  n:=coalesce((p_body->>'offset')::integer,0);
  SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM(SELECT r.id,r.operation_number AS number,r.title,r.status,r.portal_sector AS sector,r.due_at AS "dueAt",r.consumer_unit_id AS "unitId",r.created_at AS "openedAt" FROM public.operation_records r
   WHERE r.organization_id=p_org AND r.customer_id=customer AND(r.portal_origin='CLIENT' OR EXISTS(SELECT 1 FROM public.operation_client_messages m WHERE m.organization_id=p_org AND m.record_id=r.id AND m.direction='OUTBOUND'))
   ORDER BY r.created_at DESC,r.id DESC OFFSET n LIMIT 101)x;
  RETURN jsonb_build_object('rows',result,'hasMore',jsonb_array_length(result)>100);
 ELSIF p_action='notices' THEN
  IF p_body-ARRAY['offset']<>'{}' OR coalesce(p_body->>'offset','0')!~'^[0-9]{1,5}$' THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  n:=coalesce((p_body->>'offset')::integer,0);
  SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM(SELECT o.id,o.title,o.href,o.record_id AS "recordId",o.document_id AS "documentId",coalesce((SELECT d.consumer_unit_id FROM public.documents d WHERE d.id=o.document_id AND d.organization_id=p_org AND d.customer_id=customer),(SELECT r.consumer_unit_id FROM public.operation_records r WHERE r.id=o.record_id AND r.organization_id=p_org AND r.customer_id=customer)) AS "unitId",o.created_at AS date,(SELECT min(first_notice.created_at) FROM public.portal_notification_outbox first_notice WHERE first_notice.organization_id=p_org AND first_notice.customer_id=customer AND first_notice.recipient_id=p_actor AND(CASE WHEN o.record_id IS NOT NULL THEN first_notice.record_id=o.record_id WHEN o.document_id IS NOT NULL THEN first_notice.document_id=o.document_id AND first_notice.record_id IS NULL ELSE first_notice.id=o.id END)) AS "firstDate",(SELECT first_notice.title FROM public.portal_notification_outbox first_notice WHERE first_notice.organization_id=p_org AND first_notice.customer_id=customer AND first_notice.recipient_id=p_actor AND(CASE WHEN o.record_id IS NOT NULL THEN first_notice.record_id=o.record_id WHEN o.document_id IS NOT NULL THEN first_notice.document_id=o.document_id AND first_notice.record_id IS NULL ELSE first_notice.id=o.id END) ORDER BY first_notice.created_at,first_notice.id LIMIT 1) AS "firstTitle",
   EXISTS(SELECT 1 FROM public.operation_notification_reads r WHERE r.organization_id=p_org AND r.user_id=p_actor AND r.notification_key='portal:'||o.id) AS read
   FROM public.portal_notification_outbox o WHERE o.organization_id=p_org AND o.customer_id=customer AND o.recipient_id=p_actor ORDER BY o.created_at DESC,o.id DESC OFFSET n LIMIT 101)x;
  RETURN jsonb_build_object('rows',result,'offset',n,'hasMore',jsonb_array_length(result)>100);
 ELSIF p_action IN('invoice','declare') THEN
  SELECT * INTO i FROM public.portal_document_intakes WHERE id=p_id AND organization_id=p_org AND customer_id=customer AND kind='INVOICE' FOR SHARE;
  IF NOT FOUND OR i.document_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE id=i.consumer_unit_id AND organization_id=p_org AND customer_id=customer AND status='ACTIVE') THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
  SELECT * INTO source_document FROM public.documents WHERE id=i.document_id AND organization_id=p_org AND customer_id=customer AND consumer_unit_id=i.consumer_unit_id AND file_hash=i.file_hash AND file_verified=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice source changed' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-payment:'||p_org||i.id::text,0));
  SELECT coalesce(max(revision),0) INTO n FROM public.portal_invoice_payment_declarations WHERE intake_id=i.id AND organization_id=p_org;
  IF p_action='declare' THEN
   IF p_body-ARRAY['requestId','revision','state']<>'{}' OR p_body->>'state' NOT IN('PAID','UNPAID') OR p_body->>'state' IS NULL OR coalesce(p_body->>'requestId','')!~'^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$' OR coalesce(p_body->>'revision','')!~'^[0-9]{1,9}$' THEN RAISE EXCEPTION 'Invalid declaration' USING ERRCODE='22023';END IF;
   SELECT * INTO prior FROM public.portal_invoice_payment_declarations WHERE organization_id=p_org AND request_id=(p_body->>'requestId')::uuid;
   IF FOUND THEN
    IF prior.intake_id<>i.id OR prior.actor_id<>p_actor OR prior.state<>p_body->>'state' OR prior.revision<>(p_body->>'revision')::integer+1 THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;
   ELSE
    IF n<>(p_body->>'revision')::integer THEN RAISE EXCEPTION 'Declaration changed' USING ERRCODE='40001';END IF;
    INSERT INTO public.portal_invoice_payment_declarations(organization_id,intake_id,customer_id,consumer_unit_id,document_id,file_hash,revision,state,actor_id,request_id)
    VALUES(p_org,i.id,customer,i.consumer_unit_id,i.document_id,i.file_hash,n+1,p_body->>'state',p_actor,(p_body->>'requestId')::uuid);
   END IF;
  ELSIF p_body<>'{}' THEN RAISE EXCEPTION 'Invalid invoice query' USING ERRCODE='22023';END IF;
  SELECT jsonb_build_object('revision',x.revision,'state',x.state,'actorId',x.actor_id,'declaredAt',x.created_at) INTO result FROM public.portal_invoice_payment_declarations x WHERE x.organization_id=p_org AND x.intake_id=i.id ORDER BY x.revision DESC LIMIT 1;
  RETURN jsonb_build_object('id',i.id,'documentId',i.document_id,'sourceHash',i.file_hash,'declaration',result,'raw',
   CASE WHEN p_action='invoice' THEN(SELECT r.raw_result FROM public.document_ocr_results r JOIN public.document_ocr_jobs j ON j.id=r.job_id AND j.organization_id=p_org AND j.document_id=i.document_id AND j.state='SUCCEEDED' WHERE r.organization_id=p_org AND r.document_id=i.document_id AND r.file_hash=i.file_hash LIMIT 1) ELSE NULL END);
 ELSIF p_action IN('usage','payment_evidence') THEN
  IF p_body-ARRAY['from','to','unitId']<>'{}' OR coalesce(p_body->>'from','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' OR coalesce(p_body->>'to','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' OR p_body->>'from'>p_body->>'to' OR (left(p_body->>'to',4)::integer-left(p_body->>'from',4)::integer)*12+right(p_body->>'to',2)::integer-right(p_body->>'from',2)::integer>11 THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023';END IF;
  chosen:=nullif(p_body->>'unitId','');
  IF chosen IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE id=chosen AND organization_id=p_org AND customer_id=customer AND status='ACTIVE') THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='42501';END IF;
  IF p_action='payment_evidence' THEN
   SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM(SELECT DISTINCT ON(e.intake_id) e.intake_id AS id,pi.month,e.consumer_unit_id AS "unitId",e.state,e.revision,e.actor_id AS "actorId",e.created_at AS "declaredAt",'CLIENT_DECLARATION_NOT_BANK_CONFIRMATION' AS basis
   FROM public.portal_invoice_payment_declarations e JOIN public.portal_document_intakes pi ON pi.id=e.intake_id AND pi.organization_id=p_org AND pi.customer_id=customer AND pi.document_id=e.document_id AND pi.file_hash=e.file_hash
   JOIN public.consumer_units u ON u.id=e.consumer_unit_id AND u.organization_id=p_org AND u.customer_id=customer AND u.status='ACTIVE'
   JOIN public.documents d ON d.id=e.document_id AND d.organization_id=p_org AND d.customer_id=customer AND d.consumer_unit_id=u.id AND d.file_hash=e.file_hash AND d.file_verified=true
   WHERE e.organization_id=p_org AND e.customer_id=customer AND pi.month BETWEEN p_body->>'from' AND p_body->>'to' AND(chosen IS NULL OR e.consumer_unit_id=chosen) ORDER BY e.intake_id,e.revision DESC)x;
   RETURN result;
  END IF;
  pub:=public.read_portal_financial_components_v2(p_org,p_actor,p_role,false,true,p_body->>'from',p_body->>'to',customer);
  SELECT coalesce(jsonb_agg(r||CASE WHEN r?'legacyPayload' THEN '{}'::jsonb ELSE jsonb_build_object('usageFields',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('key',f->>'key','value',f->'value')),'[]') FROM public.eva_closing_publications p JOIN public.eva_assisted_closing_versions v ON v.id=p.closing_id AND v.organization_id=p_org AND v.payload_hash=r->>'sourceHash'
     CROSS JOIN LATERAL jsonb_array_elements(v.report->'units')u CROSS JOIN LATERAL jsonb_array_elements(coalesce(u->'fields','[]'))f
     WHERE p.id=(r->>'publicationId')::uuid AND p.organization_id=p_org AND p.customer_id=customer AND u->>'id'=r->>'unitId' AND f->>'state'='FILLED' AND f->>'key' IN('consumptionPeak','consumptionOffPeak','demandSingle','demandPeak','demandOffPeak','unit:contracted_demand','unit:contracted_demand_peak','unit:contracted_demand_off_peak'))
   ) END),'[]') INTO result FROM jsonb_array_elements(pub)r WHERE chosen IS NULL OR r->>'unitId'=chosen;
  RETURN jsonb_build_object('organizationId',p_org,'customerId',customer,'rows',result);
 END IF;
 RAISE EXCEPTION 'Unknown presentation action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.portal_presentation_action(text,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_presentation_action(text,text,text,text,uuid,jsonb) TO service_role;
COMMIT;
