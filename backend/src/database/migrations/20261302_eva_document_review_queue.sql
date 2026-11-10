BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_closing_review_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,organization_id text NOT NULL REFERENCES public.organizations(id),
 closing_id uuid NOT NULL,closing_hash text NOT NULL,request_id uuid NOT NULL,actor_id text NOT NULL,
 action text NOT NULL CHECK(action IN('SUBMIT','RETURN')),reason text NOT NULL CHECK(length(reason) BETWEEN 20 AND 1000),
 command jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,closing_id) REFERENCES public.eva_assisted_closing_versions(organization_id,id),
 UNIQUE(organization_id,request_id));
CREATE INDEX eva_closing_review_latest ON public.eva_closing_review_events(organization_id,closing_id,sequence DESC);
ALTER TABLE public.eva_closing_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eva_closing_review_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.eva_closing_review_events FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER eva_review_immutable BEFORE UPDATE OR DELETE ON public.eva_closing_review_events FOR EACH ROW EXECUTE FUNCTION public.preserve_calculation_autofill();

-- Current snapshots only. A newer overlapping snapshot invalidates a handoff;
-- unrelated units in the same CNPJ never hide one another.
CREATE FUNCTION public.eva_document_review_rows(p_org text) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',v.id,'hash',v.payload_hash,'customerId',v.customer_id,'customer',c.company_name,
  'unitId',v.consumer_unit_id,'unit',CASE WHEN coalesce(v.report#>>'{scope,kind}','CUSTOMER')='UNIT' THEN u.name ELSE 'Consolidado do cliente' END,
  'unitIds',v.report->'unitIds','units',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'uc',x.consumer_unit_number) ORDER BY x.id),'[]') FROM public.consumer_units x WHERE x.organization_id=p_org AND x.customer_id=v.customer_id AND v.report->'unitIds' ? x.id),
  'month',v.month,'version',v.version,'scopeKind',coalesce(v.report#>>'{scope,kind}','CUSTOMER'),
  'stage',CASE WHEN e.state='APPROVED' THEN 'PUBLICATION' WHEN e.state='READY_FOR_REVIEW' AND v.report->'approvalEligible'='true'::jsonb AND handoff.action='SUBMIT' THEN 'APPROVAL'
   WHEN handoff.action='RETURN' THEN 'RETURNED' WHEN v.report->'approvalEligible'='true'::jsonb OR v.report#>>'{preparation,percent}'='100' THEN 'OPERATOR' ELSE 'INPUT' END,
  'approvalEligible',e.state='READY_FOR_REVIEW' AND v.report->'approvalEligible'='true'::jsonb,
  'pendingCount',jsonb_array_length(coalesce(v.report->'pendingActions','[]')),
  'returnReason',CASE WHEN handoff.action='RETURN' THEN handoff.reason END,
  'submittedAt',CASE WHEN handoff.action='SUBMIT' THEN handoff.created_at END,
  'updatedAt',coalesce(handoff.created_at,e.created_at),'handoffId',handoff.id)
 FROM public.eva_assisted_closing_versions v
 JOIN public.customers c ON c.organization_id=v.organization_id AND c.id=v.customer_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 JOIN public.consumer_units u ON u.organization_id=v.organization_id AND u.customer_id=v.customer_id AND u.id=v.consumer_unit_id AND u.status='ACTIVE'
 JOIN LATERAL(SELECT state,created_at FROM public.eva_assisted_closing_events WHERE organization_id=p_org AND closing_id=v.id ORDER BY sequence DESC LIMIT 1)e ON true
 LEFT JOIN LATERAL(SELECT action,reason,created_at,id FROM(
  SELECT action,reason,created_at,id,sequence FROM public.eva_closing_review_events WHERE organization_id=p_org AND closing_id=v.id AND closing_hash=v.payload_hash
  UNION ALL SELECT 'SUBMIT','Encaminhamento do protocolo operacional preservado.',coalesce(submitted_at,updated_at),id,0::bigint FROM public.eva_operational_reviews WHERE organization_id=p_org AND closing_id=v.id AND closing_hash=v.payload_hash AND state='SUBMITTED'
 )history ORDER BY sequence DESC LIMIT 1)handoff ON true
 WHERE v.organization_id=p_org AND (e.state IN('INCOMPLETE','READY_FOR_REVIEW') OR e.state='APPROVED' AND NOT EXISTS(SELECT 1 FROM public.eva_closing_publications pub JOIN LATERAL(SELECT state FROM public.eva_closing_publication_events WHERE organization_id=p_org AND publication_id=pub.id ORDER BY sequence DESC LIMIT 1)pe ON true WHERE pub.organization_id=p_org AND pub.closing_id=v.id AND pe.state IN('PUBLISHED','WITHDRAWN')))
 AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions n WHERE n.organization_id=p_org AND n.customer_id=v.customer_id AND n.month=v.month AND n.version>v.version AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(n.report->'unitIds') nu WHERE v.report->'unitIds' ? nu))
$$;
REVOKE ALL ON FUNCTION public.eva_document_review_rows(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_document_review_queue(p_org text,p_actor text,p_role text,p_action text,p_body jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='10s' AS $$
DECLARE rights jsonb;r jsonb;reply jsonb;prior public.eva_closing_review_events;v public.eva_assisted_closing_versions;req uuid;stage text;page integer;items jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL) THEN RAISE EXCEPTION 'Internal membership required' USING ERRCODE='42501';END IF;
 rights:=public.eva_flow_actor(p_org,p_actor,p_action='submit');
 IF p_action IS NULL OR p_action NOT IN('list','status','submit','return','notifications','read_notification') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid queue action' USING ERRCODE='22023';END IF;
 IF p_action='list' THEN
  IF p_body-ARRAY['stage','page']<>'{}' THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023';END IF;
  stage:=coalesce(p_body->>'stage','ALL');page:=coalesce((p_body->>'page')::integer,0);
  IF stage NOT IN('ALL','OPERATOR','APPROVAL','INPUT','RETURNED','PUBLICATION') OR page NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023';END IF;
  WITH rows AS MATERIALIZED(SELECT x FROM public.eva_document_review_rows(p_org)x)
  SELECT jsonb_build_object('enabled',true,'organizationId',p_org,'canSubmit',rights->'canPrepare','canManage',rights->'canManage','pageSize',25,'page',page,'generatedAt',clock_timestamp(),
   'summary',jsonb_build_object('operator',(SELECT count(*) FROM rows WHERE x->>'stage' IN('OPERATOR','RETURNED')),'approval',(SELECT count(*) FROM rows WHERE x->>'stage' IN('APPROVAL','PUBLICATION')),'input',(SELECT count(*) FROM rows WHERE x->>'stage'='INPUT')),
   'total',(SELECT count(*) FROM rows WHERE stage='ALL' OR x->>'stage'=stage OR stage='APPROVAL' AND x->>'stage'='PUBLICATION' OR stage='OPERATOR' AND x->>'stage'='RETURNED'),
   'rows',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'updatedAt',x->>'id'),'[]') FROM(SELECT x FROM rows WHERE stage='ALL' OR x->>'stage'=stage OR stage='APPROVAL' AND x->>'stage'='PUBLICATION' OR stage='OPERATOR' AND x->>'stage'='RETURNED' ORDER BY x->>'updatedAt',x->>'id' LIMIT 25 OFFSET page*25)p)) INTO reply;RETURN reply;
 END IF;
 IF p_action IN('notifications','read_notification') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('key','eva-review:'||(x->>'id')||':'||(x->>'stage')||':'||coalesce(x->>'handoffId',x->>'hash'),'id',x->>'id','origin','eva-review','status',x->>'stage','priority','HIGH','date',x->>'updatedAt','dueAt',NULL,'overdue',false,'read',false,
   'title',CASE WHEN x->>'stage'='PUBLICATION' THEN 'EVA · fechamento aprovado aguardando publicação' WHEN x->>'stage'='APPROVAL' THEN 'EVA · fechamento aguardando aprovação' ELSE 'EVA · preenchimento disponível para conferência' END||' · '||(x->>'customer')||' · '||(x->>'unit')||' · '||(x->>'month'),
   'href','/backoffice/documents?reviewClosing='||(x->>'id'))),'[]') INTO items FROM(SELECT x FROM public.eva_document_review_rows(p_org)x
  WHERE x->>'stage' IN('APPROVAL','PUBLICATION') AND rights->'canManage'='true'::jsonb OR x->>'stage' IN('OPERATOR','RETURNED') AND rights->'canPrepare'='true'::jsonb
  ORDER BY CASE WHEN x->>'stage' IN('APPROVAL','PUBLICATION') THEN 0 ELSE 1 END,x->>'updatedAt',x->>'id' LIMIT 100)notices;
  IF p_action='read_notification' THEN
   IF p_body-ARRAY['key']<>'{}' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items)n WHERE n->>'key'=p_body->>'key') THEN RAISE EXCEPTION 'Notification unavailable' USING ERRCODE='42501';END IF;
   INSERT INTO public.operation_notification_reads(organization_id,user_id,notification_key) VALUES(p_org,p_actor,p_body->>'key') ON CONFLICT DO NOTHING;
  END IF;RETURN jsonb_build_object('rows',items);
 END IF;
 IF p_action='status' THEN
  IF p_body-ARRAY['closingId']<>'{}' THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023';END IF;
  SELECT x INTO r FROM public.eva_document_review_rows(p_org)x WHERE x->>'id'=p_body->>'closingId';
  RETURN jsonb_build_object('enabled',true,'row',r,'canSubmit',rights->'canPrepare','canManage',rights->'canManage');
 END IF;
 IF p_body-ARRAY['closingId','hash','requestId','reason','confirmed']<>'{}' OR p_body->'confirmed' IS DISTINCT FROM 'true'::jsonb OR length(coalesce(btrim(p_body->>'reason'),'')) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Explicit review required' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;IF req IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-document-review:'||p_org||':'||(p_body->>'closingId'),0));
 SELECT * INTO prior FROM public.eva_closing_review_events WHERE organization_id=p_org AND request_id=req;
 IF FOUND THEN IF prior.actor_id<>p_actor OR prior.command IS DISTINCT FROM jsonb_build_object('action',p_action,'body',p_body) THEN RAISE EXCEPTION 'Changed command' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('id',prior.id,'replayed',true);END IF;
 SELECT * INTO v FROM public.eva_assisted_closing_versions WHERE organization_id=p_org AND id=(p_body->>'closingId')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Preparation unavailable' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-closing:'||p_org||':'||v.customer_id||':'||v.month,0));
 SELECT * INTO v FROM public.eva_assisted_closing_versions WHERE organization_id=p_org AND id=v.id FOR UPDATE;
 SELECT x INTO r FROM public.eva_document_review_rows(p_org)x WHERE x->>'id'=v.id::text;
 IF r IS NULL OR v.payload_hash IS DISTINCT FROM p_body->>'hash' OR r->'approvalEligible' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Current complete preparation required' USING ERRCODE='40001';END IF;
 IF p_action='submit' AND r->>'stage' NOT IN('OPERATOR','RETURNED') OR p_action='return' AND (r->>'stage'<>'APPROVAL' OR rights->'canManage' IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'Review stage unavailable' USING ERRCODE='42501';END IF;
 INSERT INTO public.eva_closing_review_events(organization_id,closing_id,closing_hash,request_id,actor_id,action,reason,command)
 VALUES(p_org,v.id,v.payload_hash,req,p_actor,upper(p_action),btrim(p_body->>'reason'),jsonb_build_object('action',p_action,'body',p_body)) RETURNING * INTO prior;
 RETURN jsonb_build_object('id',prior.id,'closingId',v.id,'stage',CASE WHEN p_action='submit' THEN 'APPROVAL' ELSE 'RETURNED' END,'financialApproval',false,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.eva_document_review_queue(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_document_review_queue(text,text,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
