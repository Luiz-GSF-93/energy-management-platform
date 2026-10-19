BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_closing_publications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id), closing_id uuid NOT NULL,
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'), approval_event_id uuid NOT NULL,
 projection jsonb NOT NULL CHECK(jsonb_typeof(projection)='object' AND octet_length(projection::text)<=400000),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,closing_id) REFERENCES public.eva_assisted_closing_versions(organization_id,id),
 FOREIGN KEY(approval_event_id) REFERENCES public.eva_assisted_closing_events(id),
 UNIQUE(organization_id,id),UNIQUE(organization_id,closing_id));
CREATE TABLE public.eva_closing_publication_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,publication_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0),state text NOT NULL CHECK(state IN('PUBLISHED','WITHDRAWN')),
 actor_id text NOT NULL,note text NOT NULL CHECK(length(btrim(note)) BETWEEN 20 AND 2000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,publication_id) REFERENCES public.eva_closing_publications(organization_id,id),UNIQUE(publication_id,sequence));
CREATE INDEX eva_publication_scope ON public.eva_closing_publications(organization_id,customer_id,created_at DESC);
DO $$DECLARE n text;BEGIN FOREACH n IN ARRAY ARRAY['eva_closing_publications','eva_closing_publication_events'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',n);
 EXECUTE format('CREATE TRIGGER eva_publication_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.preserve_calculation_autofill()',n);
END LOOP;END$$;

-- Project only approved numeric results and display metadata. Never copy source_snapshot or notes.
CREATE FUNCTION public.project_eva_approved_publication(r public.eva_assisted_closing_versions) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE f jsonb:=r.report->'financial';u jsonb;items jsonb:='[]';names text[]:='{}';k text;unit_total numeric;sum_value numeric;result jsonb;customer_name text;
BEGIN
 IF r.report->>'formatVersion' IS DISTINCT FROM 'eva-assisted-closing-1.0' OR r.report->>'organizationId' IS DISTINCT FROM r.organization_id OR r.report->>'customerId' IS DISTINCT FROM r.customer_id OR r.report->>'month' IS DISTINCT FROM r.month OR r.report->'approvalEligible' IS DISTINCT FROM 'true'::jsonb OR f->>'status' IS DISTINCT FROM 'AVAILABLE' OR r.report->>'completeness' IS NULL OR jsonb_typeof(r.report->'missing') IS DISTINCT FROM 'array' OR r.report->>'completeness' NOT IN('COMPLETE','ESTIMATED') OR jsonb_array_length(r.report->'missing')<>0 OR jsonb_typeof(r.report->'units') IS DISTINCT FROM 'array' OR jsonb_array_length(r.report->'units') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Unapproved financial projection' USING ERRCODE='22023';END IF;
 FOR u IN SELECT value FROM jsonb_array_elements(r.report->'units') LOOP
  IF u->>'id' IS NULL OR u->>'id'=ANY(names) OR NOT EXISTS(SELECT 1 FROM public.consumer_units c WHERE c.id=u->>'id' AND c.organization_id=r.organization_id AND c.customer_id=r.customer_id) THEN RAISE EXCEPTION 'Publication unit scope' USING ERRCODE='42501';END IF;
  names:=array_append(names,u->>'id');
  FOREACH k IN ARRAY ARRAY['acr','aclBeforeFees','fixedFee','variableFee','totalFees','aclAfterFees','savings'] LOOP
   IF jsonb_typeof(u->k) IS DISTINCT FROM 'string' OR u->>k !~ '^-?(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN RAISE EXCEPTION 'Incomplete unit amounts' USING ERRCODE='22023';END IF;
   IF k<>'savings' AND (u->>k)::numeric<0 THEN RAISE EXCEPTION 'Negative cost' USING ERRCODE='22023';END IF;
  END LOOP;
  IF (u->>'aclBeforeFees')::numeric+(u->>'totalFees')::numeric<>(u->>'aclAfterFees')::numeric OR (u->>'fixedFee')::numeric+(u->>'variableFee')::numeric<>(u->>'totalFees')::numeric OR (u->>'acr')::numeric-(u->>'aclAfterFees')::numeric<>(u->>'savings')::numeric THEN RAISE EXCEPTION 'Unit conservation failed' USING ERRCODE='22023';END IF;
  items:=items||jsonb_build_array(jsonb_build_object('id',u->>'id','name',left(coalesce(u->>'name',u->>'id'),300),'acr',u->>'acr','aclBeforeFees',u->>'aclBeforeFees','fixedFee',u->>'fixedFee','variableFee',u->>'variableFee','totalFees',u->>'totalFees','aclAfterFees',u->>'aclAfterFees','savingsAfterFees',u->>'savings'));
 END LOOP;
 IF (SELECT array_agg(x ORDER BY x) FROM unnest(names)x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(r.report->'unitIds')x) THEN RAISE EXCEPTION 'Incomplete unit coverage' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['acr','aclBeforeFees','fixedFee','variableFee','totalFees','aclAfterFees','savings'] LOOP
  IF jsonb_typeof(f->k) IS DISTINCT FROM 'string' OR f->>k !~ '^-?(0|[1-9][0-9]{0,11})\.[0-9]{2}$' THEN RAISE EXCEPTION 'Incomplete consolidated amounts' USING ERRCODE='22023';END IF;
  SELECT sum((value->>k)::numeric) INTO sum_value FROM jsonb_array_elements(r.report->'units');
  IF sum_value<>(f->>k)::numeric THEN RAISE EXCEPTION 'Consolidated amounts differ' USING ERRCODE='22023';END IF;
 END LOOP;
 SELECT company_name INTO customer_name FROM public.customers WHERE id=r.customer_id AND organization_id=r.organization_id AND deleted_at IS NULL;
 IF customer_name IS NULL THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='42501';END IF;
 result:=jsonb_build_object('formatVersion','eva-approved-publication-1.0','organizationId',r.organization_id,'customerId',r.customer_id,'customerName',left(customer_name,300),'month',r.month,'version',r.version,'sourceHash',r.payload_hash,'estimated',r.report->>'completeness'='ESTIMATED','financial',jsonb_build_object('status','AVAILABLE','acr',f->>'acr','aclBeforeFees',f->>'aclBeforeFees','fixedFee',f->>'fixedFee','variableFee',f->>'variableFee','totalFees',f->>'totalFees','aclAfterFees',f->>'aclAfterFees','savingsAfterFees',f->>'savings','savingsBeforeFees',to_char((f->>'acr')::numeric-(f->>'aclBeforeFees')::numeric,'FM999999999999990.00'),'units',items));
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.project_eva_approved_publication(public.eva_assisted_closing_versions) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.eva_closing_publication_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_unit text,p_month text,p_id uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.eva_assisted_closing_versions;a public.eva_assisted_closing_events;p public.eva_closing_publications;e public.eva_closing_publication_events;rr record;projection jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('publish','withdraw') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['hash','note'] OR jsonb_typeof(p_body->'note') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'note')) NOT BETWEEN 20 AND 2000 THEN RAISE EXCEPTION 'Invalid publication action' USING ERRCODE='22023';END IF;
 PERFORM public.calculation_autofill_action(p_org,p_actor,p_role,p_platform,'access',p_unit,p_month,NULL,'{}');
 IF NOT p_platform THEN
  SELECT x.name,x.permissions INTO rr FROM public.organization_members m JOIN public.roles x ON x.id=m.role_id AND x.organization_id=m.organization_id AND x.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' FOR SHARE OF m,x;
  IF rr.name NOT IN('admin_org','gestor') OR NOT coalesce(rr.permissions ? 'fd8a932f-87c0-4f86-8389-9f30c50e95b7',false) THEN RAISE EXCEPTION 'Publication manager required' USING ERRCODE='42501';END IF;
 END IF;
 SELECT v.* INTO r FROM public.eva_assisted_closing_versions v JOIN public.consumer_units u ON u.organization_id=v.organization_id AND u.customer_id=v.customer_id AND u.id=p_unit WHERE v.id=p_id AND v.organization_id=p_org AND v.month=p_month FOR SHARE OF v;
 IF NOT FOUND OR p_body->>'hash' IS DISTINCT FROM r.payload_hash THEN RAISE EXCEPTION 'Publication source changed' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('eva-closing:'||p_org||':'||r.customer_id||':'||p_month,0));
 SELECT * INTO a FROM public.eva_assisted_closing_events WHERE organization_id=p_org AND closing_id=r.id ORDER BY sequence DESC LIMIT 1;
 IF a.state IS DISTINCT FROM 'APPROVED' THEN RAISE EXCEPTION 'Human approval required' USING ERRCODE='42501';END IF;
 SELECT * INTO p FROM public.eva_closing_publications WHERE organization_id=p_org AND closing_id=r.id;
 IF p.id IS NOT NULL THEN SELECT * INTO e FROM public.eva_closing_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 1;END IF;
 IF p_action='withdraw' THEN
  IF p.id IS NULL THEN RAISE EXCEPTION 'Publication unavailable' USING ERRCODE='22023';END IF;
  IF e.state<>'WITHDRAWN' THEN INSERT INTO public.eva_closing_publication_events(organization_id,publication_id,sequence,state,actor_id,note) VALUES(p_org,p.id,e.sequence+1,'WITHDRAWN',p_actor,btrim(p_body->>'note'));END IF;
  RETURN jsonb_build_object('id',p.id,'closingId',r.id,'state','WITHDRAWN');
 END IF;
 IF EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.organization_id=p_org AND v.customer_id=r.customer_id AND v.month=r.month AND v.version>r.version AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)='APPROVED') THEN RAISE EXCEPTION 'Newer approved version exists' USING ERRCODE='40001';END IF;
 IF p.id IS NOT NULL THEN
  IF e.state<>'PUBLISHED' THEN RAISE EXCEPTION 'Withdrawn publication requires a new approved version' USING ERRCODE='23505';END IF;
  RETURN jsonb_build_object('id',p.id,'closingId',r.id,'state',e.state);
 END IF;
 projection:=public.project_eva_approved_publication(r);
 INSERT INTO public.eva_closing_publications(organization_id,customer_id,closing_id,source_hash,approval_event_id,projection,created_by) VALUES(p_org,r.customer_id,r.id,r.payload_hash,a.id,projection,p_actor) RETURNING * INTO p;
 INSERT INTO public.eva_closing_publication_events(organization_id,publication_id,sequence,state,actor_id,note) VALUES(p_org,p.id,1,'PUBLISHED',p_actor,btrim(p_body->>'note'));
 RETURN jsonb_build_object('id',p.id,'closingId',r.id,'state','PUBLISHED');
END$$;
REVOKE ALL ON FUNCTION public.eva_closing_publication_action(text,text,text,boolean,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_closing_publication_action(text,text,text,boolean,text,text,text,uuid,jsonb) TO service_role;

CREATE FUNCTION public.decide_eva_with_publication(p_org text,p_actor text,p_role text,p_platform boolean,p_unit text,p_month text,p_id uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;p jsonb;
BEGIN
 IF p_body->'disclose' IS DISTINCT FROM 'true'::jsonb OR p_body->>'decision' IS DISTINCT FROM 'APPROVE' THEN RAISE EXCEPTION 'Explicit disclosure acknowledgment required' USING ERRCODE='22023';END IF;
 r:=public.eva_assisted_closing_action(p_org,p_actor,p_role,p_platform,'decide',p_unit,p_month,p_id,p_body-'disclose');
 p:=public.eva_closing_publication_action(p_org,p_actor,p_role,p_platform,'publish',p_unit,p_month,p_id,jsonb_build_object('hash',p_body->>'hash','note','Disponibilização ao cliente vinculada à aprovação explícita do fechamento.'));
 RETURN r||jsonb_build_object('publication',p);
END$$;
REVOKE ALL ON FUNCTION public.decide_eva_with_publication(text,text,text,boolean,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.decide_eva_with_publication(text,text,text,boolean,text,text,uuid,jsonb) TO service_role;

CREATE FUNCTION public.read_eva_closing_publications(p_org text,p_actor text,p_role text,p_platform boolean,p_portal boolean,p_from text,p_to text,p_customer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m record;result jsonb;n integer;
BEGIN
 IF p_org IS NULL OR p_actor IS NULL OR p_role IS NULL OR p_platform IS NULL OR p_portal IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR p_to !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR p_from>p_to OR (extract(year FROM (p_to||'-01')::date)*12+extract(month FROM (p_to||'-01')::date))-(extract(year FROM (p_from||'-01')::date)*12+extract(month FROM (p_from||'-01')::date))>=12 THEN RAISE EXCEPTION 'Invalid publication period' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) OR (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management) THEN RAISE EXCEPTION 'Publication license unavailable' USING ERRCODE='42501';END IF;
 IF p_platform THEN
  IF p_portal OR NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Platform publication session required' USING ERRCODE='42501';END IF;
  PERFORM public.assert_license_platform_actor(p_actor::uuid);
 ELSE
  IF (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND user_id::text=p_actor AND upper(status)='ACTIVE')<>1 THEN RAISE EXCEPTION 'Publication membership unavailable' USING ERRCODE='42501';END IF;
  SELECT mm.affiliation_type,mm.exclusive_customer_id,rr.name,rr.permissions INTO m FROM public.organization_members mm JOIN public.roles rr ON rr.id=mm.role_id AND rr.organization_id=mm.organization_id AND rr.scope='organization' WHERE mm.organization_id=p_org AND mm.user_id::text=p_actor AND mm.role_id::text=p_role AND upper(mm.status)='ACTIVE' FOR SHARE OF mm,rr;
  IF NOT FOUND OR jsonb_typeof(m.permissions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Publication role unavailable' USING ERRCODE='42501';END IF;
  IF p_portal THEN
   IF m.name<>'consulta' OR m.affiliation_type IS DISTINCT FROM 'external' OR p_customer IS NULL OR m.exclusive_customer_id IS DISTINCT FROM p_customer OR NOT(m.permissions ? '3ebadd32-6f30-459e-8ed3-0d2843d89946') OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND organization_id=p_org AND deleted_at IS NULL AND status='ACTIVE') THEN RAISE EXCEPTION 'Exclusive client scope required' USING ERRCODE='42501';END IF;
  ELSIF m.name NOT IN('admin_org','gestor','operacional') OR m.affiliation_type IS DISTINCT FROM 'internal' OR NOT(m.permissions ? '60f9690a-145b-4dba-b23f-9f945baca296') OR m.exclusive_customer_id IS NOT NULL AND m.exclusive_customer_id IS DISTINCT FROM p_customer THEN RAISE EXCEPTION 'Backoffice publication access denied' USING ERRCODE='42501';END IF;
 END IF;
 SELECT count(*) INTO n FROM public.eva_closing_publications p JOIN public.eva_assisted_closing_versions v ON v.organization_id=p.organization_id AND v.id=p.closing_id WHERE p.organization_id=p_org AND (p_customer IS NULL OR p.customer_id=p_customer) AND v.month BETWEEN p_from AND p_to;
 IF n>=500 THEN RAISE EXCEPTION 'Publication history too large' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'closingId',v.id,'sourceHash',p.source_hash,'publishedAt',p.created_at,'state',(SELECT state FROM public.eva_closing_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 1),'projection',p.projection) ORDER BY p.created_at,p.id),'[]') INTO result
 FROM public.eva_closing_publications p JOIN public.eva_assisted_closing_versions v ON v.organization_id=p.organization_id AND v.id=p.closing_id JOIN public.customers c ON c.id=p.customer_id AND c.organization_id=p.organization_id AND c.deleted_at IS NULL
 WHERE p.organization_id=p_org AND (p_customer IS NULL OR p.customer_id=p_customer) AND v.month BETWEEN p_from AND p_to AND p.source_hash=v.payload_hash AND p.projection->>'sourceHash'=v.payload_hash AND p.projection->>'organizationId'=p_org AND p.projection->>'customerId'=p.customer_id
  AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)='APPROVED';
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.read_eva_closing_publications(text,text,text,boolean,boolean,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_eva_closing_publications(text,text,text,boolean,boolean,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.capture_published_report(p_org text,p_actor text,p_request jsonb,p_body jsonb,p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c text;u text;req uuid;r public.published_report_snapshots;src jsonb;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,true);
 IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_request))<>6 OR NOT p_request ?& ARRAY['kind','customerId','unitId','from','to','requestId'] OR p_request->>'kind' NOT IN ('OPERATIONAL','EXECUTIVE')
 OR COALESCE(p_request->>'from','') !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR COALESCE(p_request->>'to','') !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR p_request->>'to'<p_request->>'from' OR (p_request->>'to'||'-01')::date>(p_request->>'from'||'-01')::date+interval '11 months'
 OR p_body IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR octet_length(p_body::text)>1000000
 THEN RAISE EXCEPTION 'Invalid report request' USING ERRCODE='22023';END IF;
 c:=p_request->>'customerId';u:=p_request->>'unitId';req:=(p_request->>'requestId')::uuid;
 PERFORM 1 FROM public.customers WHERE id=c AND organization_id=p_org AND deleted_at IS NULL AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report scope unavailable' USING ERRCODE='P3862';END IF;
 PERFORM 1 FROM public.consumer_units WHERE id=u AND customer_id=c AND organization_id=p_org AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report scope unavailable' USING ERRCODE='P3862';END IF;
 SELECT * INTO r FROM public.published_report_snapshots WHERE organization_id=p_org AND request_id=req;
 IF FOUND THEN IF r.created_by<>p_actor OR r.request<>p_request THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;RETURN to_jsonb(r);END IF;
 IF p_body->>'formatVersion' IS DISTINCT FROM 'energy-report-1.0' OR p_body->>'kind' IS DISTINCT FROM p_request->>'kind'
 OR p_body#>>'{header,organizationId}' IS DISTINCT FROM p_org OR p_body#>>'{header,customerId}' IS DISTINCT FROM c OR p_body#>>'{header,unitId}' IS DISTINCT FROM u
 OR p_body#>>'{period,from}' IS DISTINCT FROM p_request->>'from' OR p_body#>>'{period,to}' IS DISTINCT FROM p_request->>'to'
 OR jsonb_typeof(p_body->'publications') IS DISTINCT FROM 'array' OR jsonb_typeof(p_body->'totals') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid report body' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_body->'publications') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Invalid publication count' USING ERRCODE='22023';END IF;
 FOR src IN SELECT value FROM jsonb_array_elements(p_body->'publications') LOOP
  IF src->>'customerId' IS DISTINCT FROM c OR src->>'month'<p_request->>'from' OR src->>'month'>p_request->>'to' OR NOT EXISTS(SELECT 1 FROM public.monthly_energy_settlements s WHERE s.organization_id=p_org AND s.customer_id=c AND s.consumer_unit_id=u AND s.financial_group_id::text=src->>'id' AND s.status='PUBLISHED' AND s.validation_status='VALIDATED' AND s.financial_hash=src->>'payloadHash' AND s.version_number::text=src->>'version' AND to_char(s.month,'YYYY-MM')=src->>'month') AND NOT EXISTS(
   SELECT 1 FROM public.eva_closing_publications p JOIN public.eva_assisted_closing_versions v ON v.organization_id=p.organization_id AND v.id=p.closing_id
   WHERE p.organization_id=p_org AND p.customer_id=c AND p.id::text=src->>'id' AND p.source_hash=src->>'payloadHash' AND p.source_hash=v.payload_hash AND v.version::text=src->>'version' AND v.month=src->>'month'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.projection#>'{financial,units}') unit WHERE unit->>'id'=u)
   AND (SELECT state FROM public.eva_closing_publication_events WHERE publication_id=p.id ORDER BY sequence DESC LIMIT 1)='PUBLISHED'
   AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)='APPROVED'
  ) THEN RAISE EXCEPTION 'Published source changed' USING ERRCODE='40001';END IF;
 END LOOP;
 INSERT INTO public.published_report_snapshots(organization_id,customer_id,consumer_unit_id,kind,request_id,request,body,payload_hash,created_by) VALUES(p_org,c,u,p_request->>'kind',req,p_request,p_body,p_hash,p_actor) RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
COMMIT;
