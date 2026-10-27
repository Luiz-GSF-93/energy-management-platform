BEGIN;
ALTER TABLE public.ccee_calendar_items ADD COLUMN due_date date, ADD COLUMN deadline_precision text NOT NULL DEFAULT 'HOUR';
ALTER TABLE public.ccee_calendar_items ALTER COLUMN due_at DROP NOT NULL, ALTER COLUMN month DROP NOT NULL;
ALTER TABLE public.ccee_calendar_items ADD CONSTRAINT ccee_calendar_precision CHECK ((deadline_precision='DATE' AND due_at IS NULL AND due_date IS NOT NULL) OR (deadline_precision='HOUR' AND due_at IS NOT NULL AND (due_date IS NULL OR due_date=(due_at AT TIME ZONE 'America/Sao_Paulo')::date)));
CREATE OR REPLACE FUNCTION public.ccee_calendar_action(p_actor uuid,p_action text,p_id uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE profile text;v public.ccee_calendar_versions;x jsonb;r jsonb;pg integer;req uuid;
BEGIN
 profile:=public.platform_workflow_actor(p_actor,'82e7fc71-479a-4dd6-8b22-4fba6eaa6841');
 IF profile IS DISTINCT FROM 'OWNER' OR p_action NOT IN('list','create','approve','reject') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>2097152 THEN RAISE EXCEPTION 'Calendar owner action unavailable' USING ERRCODE='42501';END IF;
 IF p_action='list' THEN
  pg:=COALESCE((p_body->>'page')::integer,0);IF pg NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('page',pg,'versions',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]')FROM(SELECT * FROM public.ccee_calendar_versions ORDER BY created_at DESC,id LIMIT 10 OFFSET pg*10)t),'items',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.source_row),'[]')FROM(SELECT * FROM public.ccee_calendar_items WHERE version_id=p_id ORDER BY source_row,id LIMIT 25 OFFSET pg*25)t),
   'differences',(SELECT jsonb_build_object('comparedWith',older.id,
    'added',(SELECT count(*) FROM public.ccee_calendar_items n WHERE n.version_id=current.id AND NOT EXISTS(SELECT 1 FROM public.ccee_calendar_items o WHERE o.version_id=older.id AND o.code=n.code)),
    'removed',(SELECT count(*) FROM public.ccee_calendar_items o WHERE o.version_id=older.id AND NOT EXISTS(SELECT 1 FROM public.ccee_calendar_items n WHERE n.version_id=current.id AND n.code=o.code)),
    'deadlinesChanged',(SELECT count(*) FROM public.ccee_calendar_items n JOIN public.ccee_calendar_items o ON o.code=n.code WHERE n.version_id=current.id AND o.version_id=older.id AND (n.due_at IS DISTINCT FROM o.due_at OR n.due_date IS DISTINCT FROM o.due_date)))
    FROM public.ccee_calendar_versions current LEFT JOIN LATERAL(SELECT id FROM public.ccee_calendar_versions WHERE source_url=current.source_url AND state='APPROVED' AND created_at<current.created_at ORDER BY created_at DESC,id LIMIT 1)older ON true WHERE current.id=p_id));
 END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(req::text,193));
 SELECT details INTO r FROM public.ccee_integration_events WHERE organization_id IS NULL AND details->>'requestId'=req::text AND event LIKE 'CALENDAR_%' LIMIT 1;
 IF FOUND THEN
  IF r->>'actor' IS DISTINCT FROM p_actor::text OR r->>'action' IS DISTINCT FROM p_action OR r->>'requestHash' IS DISTINCT FROM md5(p_body::text) THEN RAISE EXCEPTION 'Calendar request changed' USING ERRCODE='40001';END IF;
  SELECT * INTO v FROM public.ccee_calendar_versions WHERE id=(r->>'id')::uuid;RETURN to_jsonb(v);
 END IF;
 IF p_action='create' THEN
  IF p_body->>'sourceUrl'!~'^https://www[.]ccee[.]org[.]br/(documents/|o/ccee/documentos/)[A-Za-z0-9%_./() -]+$' OR p_body-ARRAY['requestId','sourceUrl','sourceHash','normalizedHash','year','mapping','coverage','issues','items','reason']<>'{}'::jsonb OR jsonb_typeof(p_body->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'items')>5000 OR jsonb_typeof(p_body->'issues') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid calendar' USING ERRCODE='22023';END IF;
  SELECT * INTO v FROM public.ccee_calendar_versions WHERE request_id=req;
  IF FOUND THEN IF v.source_hash IS DISTINCT FROM p_body->>'sourceHash' OR v.normalized_hash IS DISTINCT FROM p_body->>'normalizedHash' OR v.created_by<>p_actor::text THEN RAISE EXCEPTION 'Calendar request changed' USING ERRCODE='40001';END IF;RETURN to_jsonb(v);END IF;
  INSERT INTO public.ccee_calendar_versions(source_url,source_hash,normalized_hash,year,mapping,coverage,issues,created_by,reason,request_id)
  VALUES(p_body->>'sourceUrl',p_body->>'sourceHash',p_body->>'normalizedHash',(p_body->>'year')::integer,p_body->'mapping',p_body->'coverage',p_body->'issues',p_actor::text,p_body->>'reason',req) RETURNING * INTO v;
  FOR x IN SELECT value FROM jsonb_array_elements(p_body->'items') LOOP
   INSERT INTO public.ccee_calendar_items(version_id,code,title,month,due_at,source_row,source_sheet,applicability,due_date,deadline_precision)VALUES(v.id,x->>'code',x->>'title',((x->>'month')||'-01')::date,(x->>'dueAt')::timestamptz,(x->>'sourceRow')::integer,x->>'sourceSheet',x->>'applicability',COALESCE((x->>'dueDate')::date,((x->>'dueAt')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date),CASE WHEN x->>'dueAt' IS NULL THEN 'DATE' ELSE 'HOUR' END);
  END LOOP;
 ELSE
  SELECT * INTO v FROM public.ccee_calendar_versions WHERE id=p_id FOR UPDATE;
  IF v.id IS NULL OR v.created_by=p_actor::text OR COALESCE(length(p_body->>'reason'),0) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Independent calendar review required' USING ERRCODE='42501';END IF;
  IF v.state<>'DRAFT' THEN RAISE EXCEPTION 'Calendar preserved' USING ERRCODE='40001';END IF;
  IF p_action='approve' AND(jsonb_array_length(v.issues)>0 OR NOT EXISTS(SELECT 1 FROM public.ccee_calendar_items WHERE version_id=v.id)) THEN RAISE EXCEPTION 'Calendar coverage requires review' USING ERRCODE='22023';END IF;
  UPDATE public.ccee_calendar_versions SET state=CASE WHEN p_action='approve' THEN 'APPROVED' ELSE 'REJECTED' END,reviewed_by=p_actor::text,reviewed_at=now() WHERE id=v.id RETURNING * INTO v;
 END IF;
 INSERT INTO public.ccee_integration_events(actor_id,event,details)VALUES(p_actor::text,'CALENDAR_'||upper(p_action),jsonb_build_object('id',v.id,'hash',v.normalized_hash,'reason',p_body->>'reason','requestId',req,'actor',p_actor,'action',p_action,'requestHash',md5(p_body::text)));RETURN to_jsonb(v);
END$$;

CREATE OR REPLACE FUNCTION public.ccee_apply_calendar(p_org text,p_actor text,p_version uuid,p_item uuid,p_binding uuid,p_responsible text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v public.ccee_calendar_versions;i public.ccee_calendar_items;b jsonb;req uuid;d jsonb;r jsonb;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'manage');
 SELECT * INTO v FROM public.ccee_calendar_versions WHERE id=p_version AND state='APPROVED' FOR SHARE;
 SELECT * INTO i FROM public.ccee_calendar_items WHERE id=p_item AND version_id=p_version;
 IF v.id IS NULL OR i.id IS NULL OR i.due_at IS NULL OR i.month IS NULL OR EXISTS(SELECT 1 FROM public.ccee_calendar_versions WHERE source_url=v.source_url AND state='APPROVED' AND created_at>v.created_at) OR i.due_at<=now() OR COALESCE(length(p_reason),0) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Calendar source changed or overdue' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||(SELECT consumer_unit_id FROM public.ccee_unit_authorizations WHERE id=p_binding AND organization_id=p_org),192));
 b:=public.assert_ccee_data_binding(p_org,p_binding,i.month,'AGENDA');
 req:=md5(p_org||p_version::text||p_item::text||p_binding::text)::uuid;
 d:=jsonb_build_object('requestId',req,'revision',0,'reason',p_reason,'title',i.title,'description','Fonte CCEE: '||v.source_url||' · versão '||v.id||' · linha '||i.source_row||' · SHA-256 '||v.source_hash||'. Aplicabilidade conferida pelo operador: '||i.applicability||'. Não comprova cumprimento da obrigação na CCEE.','priority','HIGH','customerId',b->>'customer_id','unitId',b->>'consumer_unit_id','responsibleId',p_responsible,'startsAt',i.due_at,'endsAt',NULL,'dueAt',i.due_at);
 -- Reuse authoritative Operations RBAC, responsible membership, ACL, license and idempotency in the same transaction.
 r:=public.save_operation_record(p_org,p_actor,'agenda',NULL,req,0,p_reason,d);
 IF NOT EXISTS(SELECT 1 FROM public.ccee_integration_events WHERE organization_id=p_org AND request_id=req) THEN INSERT INTO public.ccee_integration_events(organization_id,actor_id,event,request_id,details)VALUES(p_org,p_actor,'CALENDAR_ASSIGNED',req,jsonb_build_object('versionId',v.id,'itemId',i.id,'bindingId',p_binding));END IF;
 RETURN r;
END$$;

COMMIT;
