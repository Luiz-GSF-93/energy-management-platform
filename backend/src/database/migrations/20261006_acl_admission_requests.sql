-- Atomic ACL request, agenda deadline and public portal message. No external delivery.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE UNIQUE INDEX acl_operation_tenant_key ON public.operation_records(organization_id,id);
CREATE TABLE public.acl_admission_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL,
 admission_id uuid NOT NULL, stage_key text NOT NULL,
 request_record_id uuid NOT NULL, agenda_record_id uuid NOT NULL, message_id uuid NOT NULL,
 request_id uuid NOT NULL, actor_id text NOT NULL, request_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,admission_id) REFERENCES public.acl_admissions(organization_id,id),
 FOREIGN KEY(organization_id,request_record_id) REFERENCES public.operation_records(organization_id,id),
 FOREIGN KEY(organization_id,agenda_record_id) REFERENCES public.operation_records(organization_id,id),
 FOREIGN KEY(message_id) REFERENCES public.operation_client_messages(id),
 UNIQUE(organization_id,request_id), UNIQUE(request_record_id), UNIQUE(agenda_record_id),
 CHECK(stage_key IN ('registration','invoices','feasibility','modality','contracts','termination','metering','custody','technical','contract-registration','validation','supply'))
);
ALTER TABLE public.acl_admission_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.acl_admission_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.acl_admission_requests TO service_role;
CREATE TRIGGER acl_requests_immutable BEFORE UPDATE OR DELETE ON public.acl_admission_requests FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();

-- Shared deadlines remain consistent: cancel and create a corrected request rather
-- than silently changing the information already sent to the client.
CREATE FUNCTION public.acl_protect_request_context() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.acl_admission_requests WHERE request_record_id=OLD.id OR agenda_record_id=OLD.id)
 AND ROW(NEW.organization_id,NEW.customer_id,NEW.consumer_unit_id,NEW.kind,NEW.title,NEW.description,NEW.responsible_id,NEW.due_at,NEW.starts_at,NEW.ends_at,NEW.request_type,NEW.document_id)
 IS DISTINCT FROM ROW(OLD.organization_id,OLD.customer_id,OLD.consumer_unit_id,OLD.kind,OLD.title,OLD.description,OLD.responsible_id,OLD.due_at,OLD.starts_at,OLD.ends_at,OLD.request_type,OLD.document_id)
 THEN RAISE EXCEPTION 'Cancel and replace the linked ACL request to correct its context' USING ERRCODE='P2032';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER acl_request_context BEFORE UPDATE ON public.operation_records FOR EACH ROW EXECUTE FUNCTION public.acl_protect_request_context();

CREATE FUNCTION public.acl_require_closed_requests() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='COMPLETED' AND EXISTS(SELECT 1 FROM public.acl_admission_requests l JOIN public.operation_records r ON r.organization_id=l.organization_id AND (r.id=l.request_record_id OR r.id=l.agenda_record_id) WHERE l.organization_id=NEW.organization_id AND l.admission_id=NEW.id AND r.status NOT IN ('DONE','CANCELLED'))
 THEN RAISE EXCEPTION 'Finish linked requests and deadlines before closing the admission' USING ERRCODE='P4103';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER acl_closed_requests BEFORE UPDATE ON public.acl_admissions FOR EACH ROW EXECUTE FUNCTION public.acl_require_closed_requests();

CREATE FUNCTION public.acl_request_access(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_write boolean)
RETURNS public.acl_admissions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.acl_admissions;
BEGIN
 PERFORM public.acl_assert_actor(p_org,p_actor,p_role,p_platform,p_write);
 SELECT * INTO a FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACL admission unavailable' USING ERRCODE='P4102';END IF;
 PERFORM public.acl_assert_actor(p_org,p_actor,p_role,p_platform,p_write,a.customer_id);
 IF NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active'
 AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND document_management IS TRUE)
 THEN RAISE EXCEPTION 'Documents license required' USING ERRCODE='42501';END IF;
 IF NOT p_platform AND NOT EXISTS(SELECT 1 FROM public.roles WHERE id=p_role AND organization_id=p_org AND scope='organization' AND permissions ? '8f105b02-4443-49de-b188-847e0284e7ed')
 THEN RAISE EXCEPTION 'Documents permission required' USING ERRCODE='42501';END IF;
 PERFORM public.assert_operation_actor(p_org,p_actor,'requests',false);
 PERFORM public.assert_operation_actor(p_org,p_actor,'agenda',false);
 IF p_write THEN
  PERFORM public.assert_operation_actor(p_org,p_actor,'requests',true);
  PERFORM public.assert_operation_actor(p_org,p_actor,'agenda',true);
 END IF;
 RETURN a;
END $$;

CREATE FUNCTION public.acl_request_create(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_request uuid,p_revision integer,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.acl_admissions;prev public.acl_admission_requests;link public.acl_admission_requests;
 payload jsonb;req jsonb;agenda jsonb;msg jsonb;due timestamptz;stage jsonb;info text;
BEGIN
 a:=public.acl_request_access(p_org,p_actor,p_role,p_platform,p_id,true);
 IF p_request IS NULL OR p_revision IS NULL OR p_data IS NULL OR jsonb_typeof(p_data)<>'object'
 OR NOT (p_data ?& ARRAY['stageKey','subject','body','dueAt','responsibleId','priority','requestType','reason','checked'])
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('stageKey','subject','body','dueAt','responsibleId','priority','requestType','reason','checked'))
 OR EXISTS(SELECT 1 FROM jsonb_each(p_data) e WHERE e.key<>'checked' AND jsonb_typeof(e.value)<>'string')
 OR p_data->'checked' IS DISTINCT FROM 'true'::jsonb OR length(btrim(p_data->>'subject')) NOT BETWEEN 3 AND 160
 OR length(btrim(p_data->>'body')) NOT BETWEEN 10 AND 5000 OR length(btrim(p_data->>'reason')) NOT BETWEEN 10 AND 500
 OR p_data->>'priority' NOT IN ('LOW','NORMAL','HIGH','URGENT')
 OR p_data->>'requestType' NOT IN ('INVOICE','DOCUMENT','INFORMATION')
 OR nullif(p_data->>'responsibleId','') IS NULL OR nullif(p_data->>'dueAt','') IS NULL
 THEN RAISE EXCEPTION 'Invalid ACL request' USING ERRCODE='22023';END IF;
 due:=(p_data->>'dueAt')::timestamptz;
 IF NOT isfinite(due) THEN RAISE EXCEPTION 'Invalid deadline' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('acl-request:'||p_org||p_request::text,0));
 SELECT * INTO a FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 PERFORM public.acl_request_access(p_org,p_actor,p_role,p_platform,p_id,true);
 payload:=jsonb_build_object('actor',p_actor,'admission',p_id,'revision',p_revision,'data',p_data);
 SELECT * INTO prev FROM public.acl_admission_requests WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF prev.request_payload<>payload THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001';END IF;
  RETURN jsonb_build_object('id',prev.id,'requestRecordId',prev.request_record_id,'agendaRecordId',prev.agenda_record_id,'messageId',prev.message_id);
 END IF;
 IF a.revision<>p_revision OR a.status='COMPLETED' THEN RAISE EXCEPTION 'Admission changed or closed' USING ERRCODE='40001';END IF;
 SELECT value INTO stage FROM jsonb_array_elements(a.state->'stages') WHERE value->>'key'=p_data->>'stageKey';
 IF stage IS NULL OR stage->>'status' IN ('COMPLETED','SKIPPED') THEN RAISE EXCEPTION 'Select an unfinished stage' USING ERRCODE='22023';END IF;
 IF due<=now() THEN RAISE EXCEPTION 'Deadline must be in the future' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customers c JOIN public.consumer_units u ON u.organization_id=c.organization_id AND u.customer_id=c.id
 WHERE c.organization_id=p_org AND c.id=a.customer_id AND c.status='ACTIVE' AND c.deleted_at IS NULL AND u.id=a.consumer_unit_id AND u.status='ACTIVE')
 THEN RAISE EXCEPTION 'Client or unit unavailable' USING ERRCODE='P4102';END IF;
 info:='[Adesão ACL '||p_id::text||' / '||(p_data->>'stageKey')||']';
 req:=public.save_operation_record(p_org,p_actor,'requests',NULL,gen_random_uuid(),0,p_data->>'reason',jsonb_build_object(
 'customerId',a.customer_id,'unitId',a.consumer_unit_id,'title',btrim(p_data->>'subject'),
 'description',info||E'\n'||btrim(p_data->>'body'),'priority',p_data->>'priority','responsibleId',p_data->>'responsibleId',
 'dueAt',due,'requestType',p_data->>'requestType'));
 agenda:=public.save_operation_record(p_org,p_actor,'agenda',NULL,gen_random_uuid(),0,p_data->>'reason',jsonb_build_object(
 'customerId',a.customer_id,'unitId',a.consumer_unit_id,'title',left('Prazo ACL · '||btrim(p_data->>'subject'),160),
 'description',info||E'\nSolicitação: '||(req->>'id'),'priority',p_data->>'priority','responsibleId',p_data->>'responsibleId','dueAt',due,'startsAt',due));
 msg:=public.append_operation_client_message(p_org,p_actor,(req->>'id')::uuid,gen_random_uuid(),'OUTBOUND',btrim(p_data->>'subject'),
 btrim(p_data->>'body')||E'\n\nPrazo: '||to_char(due AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' (Brasília). Responda nesta solicitação pelo portal.',ARRAY[]::text[]);
 INSERT INTO public.acl_admission_requests(organization_id,admission_id,stage_key,request_record_id,agenda_record_id,message_id,request_id,actor_id,request_payload)
 VALUES(p_org,p_id,p_data->>'stageKey',(req->>'id')::uuid,(agenda->>'id')::uuid,(msg->>'id')::uuid,p_request,p_actor,payload) RETURNING * INTO link;
 RETURN jsonb_build_object('id',link.id,'requestRecordId',link.request_record_id,'agendaRecordId',link.agenda_record_id,'messageId',link.message_id);
END $$;

CREATE FUNCTION public.acl_request_read(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.acl_admissions;result jsonb;
BEGIN
 a:=public.acl_request_access(p_org,p_actor,p_role,p_platform,p_id,false);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]'::jsonb) INTO result FROM (
 SELECT l.id,l.stage_key AS "stageKey",r.id AS "requestRecordId",g.id AS "agendaRecordId",r.operation_number AS number,
 r.title,r.status,r.due_at AS "dueAt",r.responsible_id AS "responsibleId",l.created_at AS "createdAt",
 (SELECT count(*) FROM public.operation_client_messages m WHERE m.organization_id=p_org AND m.record_id=r.id AND m.customer_id=a.customer_id AND m.consumer_unit_id=a.consumer_unit_id AND m.direction='INBOUND') AS "responseCount"
 FROM public.acl_admission_requests l JOIN public.operation_records r ON r.organization_id=l.organization_id AND r.id=l.request_record_id AND r.kind='requests' AND r.customer_id=a.customer_id AND r.consumer_unit_id=a.consumer_unit_id
 JOIN public.operation_records g ON g.organization_id=l.organization_id AND g.id=l.agenda_record_id AND g.kind='agenda' AND g.customer_id=a.customer_id AND g.consumer_unit_id=a.consumer_unit_id
 WHERE l.organization_id=p_org AND l.admission_id=p_id AND (p_after IS NULL OR l.id>p_after) ORDER BY l.id LIMIT 51) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.acl_protect_request_context(),public.acl_require_closed_requests(),public.acl_request_access(text,text,text,boolean,uuid,boolean),public.acl_request_create(text,text,text,boolean,uuid,uuid,integer,jsonb),public.acl_request_read(text,text,text,boolean,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_request_create(text,text,text,boolean,uuid,uuid,integer,jsonb),public.acl_request_read(text,text,text,boolean,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
