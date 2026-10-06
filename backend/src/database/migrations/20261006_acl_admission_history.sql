BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
ALTER TABLE public.acl_admissions DROP CONSTRAINT acl_admissions_organization_id_consumer_unit_id_key;
ALTER TABLE public.acl_admissions ADD COLUMN generation integer NOT NULL DEFAULT 1 CHECK(generation>0),ADD COLUMN previous_id uuid,ADD COLUMN root_id uuid;
ALTER TABLE public.acl_admissions ADD CONSTRAINT acl_history_parent_scope FOREIGN KEY(organization_id,previous_id,customer_id,consumer_unit_id) REFERENCES public.acl_admissions(organization_id,id,customer_id,consumer_unit_id),
 ADD CONSTRAINT acl_history_root_scope FOREIGN KEY(organization_id,root_id,customer_id,consumer_unit_id) REFERENCES public.acl_admissions(organization_id,id,customer_id,consumer_unit_id),
 ADD CONSTRAINT acl_history_generation UNIQUE(organization_id,consumer_unit_id,generation),ADD CONSTRAINT acl_history_one_successor UNIQUE(previous_id),
 ADD CONSTRAINT acl_history_shape CHECK((generation=1 AND previous_id IS NULL AND root_id IS NULL) OR (generation>1 AND previous_id IS NOT NULL AND root_id IS NOT NULL AND previous_id<>id AND root_id<>id));
CREATE UNIQUE INDEX acl_history_one_open ON public.acl_admissions(organization_id,consumer_unit_id) WHERE status<>'COMPLETED';
CREATE OR REPLACE FUNCTION public.acl_assert_actor(p_org text,p_actor text,p_role text,p_platform boolean,p_write boolean,p_customer text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE member_info record;
BEGIN
 IF p_org IS NULL OR p_actor IS NULL OR p_role IS NULL OR p_platform IS NULL OR p_write IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL)
 OR (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active'
   AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active'
   AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management IS TRUE)
 THEN RAISE EXCEPTION 'ACL organization/license unavailable' USING ERRCODE='42501';END IF;
 IF NOT p_platform AND (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND user_id::text=p_actor AND upper(status)='ACTIVE')<>1 THEN RAISE EXCEPTION 'Ambiguous ACL membership' USING ERRCODE='42501';END IF;
 IF p_platform THEN
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor
    AND expires_at>now() AND revoked_at IS NULL) THEN RAISE EXCEPTION 'ACL platform session required' USING ERRCODE='42501';END IF;
  PERFORM public.assert_license_platform_actor(p_actor::uuid);
  RETURN jsonb_build_object('organizationId',p_org,'actorId',p_actor,'actorName','Administrador da plataforma','canWork',true,'canApprove',true,'customerId',NULL);
 END IF;
 SELECT m.exclusive_customer_id,m.affiliation_type,m.display_name,role_row.name,role_row.permissions INTO member_info
 FROM public.organization_members m JOIN public.roles role_row ON role_row.id=m.role_id AND role_row.organization_id=m.organization_id AND role_row.scope='organization'
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE';
 IF NOT FOUND OR jsonb_typeof(member_info.permissions) IS DISTINCT FROM 'array' OR member_info.name NOT IN ('admin_org','gestor','operacional') OR NOT coalesce(member_info.permissions ? '2c933fdf-0bbf-406a-915c-03e7921e54d8',false)
 OR NOT coalesce(member_info.permissions ? 'cbb2e904-0718-4eec-9396-dba899118cdd',false)
 OR (p_write AND NOT coalesce(member_info.permissions ? '820dc44f-15a0-4c2a-871e-2c1d2d443d9e',false))
 OR (member_info.affiliation_type='external' AND member_info.exclusive_customer_id IS NULL)
 OR (p_customer IS NOT NULL AND member_info.exclusive_customer_id IS NOT NULL AND member_info.exclusive_customer_id<>p_customer)
 THEN RAISE EXCEPTION 'ACL actor unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('organizationId',p_org,'actorId',p_actor,'actorName',coalesce(nullif(member_info.display_name,''),'Consultor'),
   'canWork',coalesce(member_info.permissions ? '820dc44f-15a0-4c2a-871e-2c1d2d443d9e',false),
   'canApprove',member_info.name IN ('admin_org','gestor') AND coalesce(member_info.permissions ? '26cadaa7-2eea-4080-91f6-1f26f87ca809',false),
   'customerId',member_info.exclusive_customer_id);
END $$;
CREATE FUNCTION public.acl_reopen(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_request uuid,p_revision integer,p_reason text,p_checked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;r record;prior record;payload jsonb;stages jsonb;v jsonb;instant timestamptz;new_id uuid;
BEGIN
 IF p_id IS NULL OR p_request IS NULL OR p_revision IS NULL OR p_revision<1 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 20 AND 1000 OR p_checked IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Reviewed reopening reason required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('acl-work:'||p_org,0));
 access:=public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,true,true);
 payload:=jsonb_build_object('previousId',p_id,'actorId',p_actor,'revision',p_revision,'reason',p_reason,'checked',p_checked);
 SELECT * INTO prior FROM public.acl_admission_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF prior.request_payload<>payload THEN RAISE EXCEPTION 'ACL request changed' USING ERRCODE='40001';END IF;
  SELECT state INTO v FROM public.acl_admissions WHERE organization_id=p_org AND id=prior.admission_id;
  RETURN jsonb_build_object('ok',true,'admission',v,'replayed',true);
 END IF;
 SELECT * INTO r FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF r.revision<>p_revision THEN RETURN jsonb_build_object('ok',false,'code','CONFLICT');END IF;
 IF r.status<>'COMPLETED' OR EXISTS(SELECT 1 FROM public.acl_admissions WHERE organization_id=p_org AND previous_id=p_id)
 OR NOT EXISTS(SELECT 1 FROM public.acl_admission_performance_versions WHERE organization_id=p_org AND admission_id=p_id)
 THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
 instant:=date_trunc('milliseconds',clock_timestamp());
 IF instant<r.updated_at OR EXISTS(SELECT 1 FROM public.acl_admission_events WHERE organization_id=p_org AND admission_id=p_id AND recorded_at>instant) THEN RAISE EXCEPTION 'ACL clock moved backwards' USING ERRCODE='23514';END IF;
 SELECT jsonb_agg(jsonb_build_object('key',k,'status','NOT_STARTED','elapsedMs',0) ORDER BY n) INTO stages
 FROM unnest(ARRAY['registration','invoices','feasibility','modality','contracts','termination','metering','custody','technical','contract-registration','validation','supply']) WITH ORDINALITY s(k,n);
 new_id:=gen_random_uuid();
 v:=jsonb_build_object('id',new_id,'organizationId',p_org,'customerId',r.customer_id,'unitId',r.consumer_unit_id,'workflowVersion','acl-admission/1',
  'status','DRAFT','revision',1,'createdAt',floor(extract(epoch FROM instant)*1000)::bigint,'stages',stages,'events','[]'::jsonb,
  'generation',r.generation+1,'previousId',r.id,'rootId',coalesce(r.root_id,r.id),'reopenReason',btrim(p_reason));
 INSERT INTO public.acl_admissions(id,organization_id,customer_id,consumer_unit_id,revision,status,created_by,created_at,updated_at,state,generation,previous_id,root_id)
 VALUES(new_id,p_org,r.customer_id,r.consumer_unit_id,1,'DRAFT',p_actor,instant,instant,v,r.generation+1,r.id,coalesce(r.root_id,r.id));
 INSERT INTO public.acl_admission_events(organization_id,admission_id,revision,request_id,request_payload,action,actor_id,snapshot,recorded_at)
 VALUES(p_org,new_id,1,p_request,payload,'REOPEN',p_actor,jsonb_build_object('previousId',r.id,'generation',r.generation+1,'reason',btrim(p_reason),'actorName',access->>'actorName'),instant);
 RETURN jsonb_build_object('ok',true,'admission',v,'replayed',false);
END $$;
-- Comparisons read closed immutable versions, never current mutable work state.
-- Activity is effort. Calendar duration includes pauses and is not productivity.
CREATE FUNCTION public.acl_performance_read(p_org text,p_actor text,p_role text,p_platform boolean,p_after uuid DEFAULT NULL,p_unit text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;result jsonb;candidate record;
BEGIN
 access:=public.acl_assert_actor(p_org,p_actor,p_role,p_platform,false);
 IF NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND document_management)
 OR (NOT p_platform AND NOT EXISTS(SELECT 1 FROM public.roles WHERE id::text=p_role AND organization_id=p_org AND jsonb_typeof(permissions)='array' AND permissions ? '8f105b02-4443-49de-b188-847e0284e7ed')) THEN RAISE EXCEPTION 'ACL performance documents access required' USING ERRCODE='42501';END IF;
 IF p_unit IS NOT NULL AND (length(p_unit) NOT BETWEEN 1 AND 100 OR p_unit!~'^[A-Za-z0-9_-]+$') THEN RAISE EXCEPTION 'Invalid unit filter' USING ERRCODE='22023';END IF;
 result:='[]'::jsonb;
 FOR candidate IN SELECT a.id,a.consumer_unit_id,a.generation,a.previous_id,c.company_name,u.name,v.id AS performance_id,v.version,v.body,v.payload_hash,v.created_at,a.created_at AS started_at
  FROM public.acl_admissions a JOIN public.customers c ON c.organization_id=a.organization_id AND c.id=a.customer_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
  JOIN public.consumer_units u ON u.organization_id=a.organization_id AND u.customer_id=a.customer_id AND u.id=a.consumer_unit_id AND u.status='ACTIVE'
  JOIN public.acl_admission_performance_versions v ON v.organization_id=a.organization_id AND v.admission_id=a.id
  WHERE a.organization_id=p_org AND a.status='COMPLETED' AND (access->>'customerId' IS NULL OR a.customer_id=access->>'customerId')
   AND (p_unit IS NULL OR a.consumer_unit_id=p_unit) AND (p_after IS NULL OR v.id>p_after)
  ORDER BY v.id LIMIT 51 LOOP
  PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,candidate.id,false,false);
  result:=result||jsonb_build_array(jsonb_build_object('id',candidate.performance_id,'admissionId',candidate.id,'unitId',candidate.consumer_unit_id,
   'unitName',candidate.name,'customerName',candidate.company_name,'generation',candidate.generation,'previousId',candidate.previous_id,'version',candidate.version,'hash',candidate.payload_hash,'closedAt',candidate.created_at,
   'calendarMs',floor(extract(epoch FROM candidate.created_at-candidate.started_at)*1000)::bigint,
   'activeMs',(SELECT coalesce(sum((x->>'elapsedMs')::bigint),0) FROM jsonb_array_elements(candidate.body->'stages') x),
   'stages',candidate.body->'stages','responsibles',(
    SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g."actorId"),'[]'::jsonb) FROM (
     SELECT effort.*,coalesce((SELECT ev->>'actorName' FROM jsonb_array_elements(candidate.body->'events') ev WHERE ev->>'actorId'=effort."actorId" AND ev->>'action' IN ('START','RESUME') ORDER BY (ev->>'at')::bigint LIMIT 1),'Consultor') AS "actorName" FROM (
      SELECT s->>'actorId' AS "actorId",sum(floor(extract(epoch FROM (s->>'endedAt')::timestamptz-(s->>'startedAt')::timestamptz)*1000)::bigint) AS "activeMs"
      FROM jsonb_array_elements(candidate.body->'sessions') s GROUP BY s->>'actorId') effort) g)));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.acl_reopen(text,text,text,boolean,uuid,uuid,integer,text,boolean),public.acl_performance_read(text,text,text,boolean,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_reopen(text,text,text,boolean,uuid,uuid,integer,text,boolean),public.acl_performance_read(text,text,text,boolean,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.acl_portal(p_org text,p_actor text,p_role text,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer text;result jsonb;
BEGIN
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management IS TRUE)
 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ACL portal license unavailable' USING ERRCODE='42501';END IF;
 SELECT m.exclusive_customer_id INTO customer FROM public.organization_members m JOIN public.roles r
 ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE'
 AND m.affiliation_type='external' AND r.name='consulta' AND jsonb_typeof(r.permissions)='array' AND r.permissions ? '3ebadd32-6f30-459e-8ed3-0d2843d89946';
 IF (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND user_id::text=p_actor AND upper(status)='ACTIVE')<>1 OR customer IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=customer AND organization_id=p_org AND status='ACTIVE' AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'Explicit external customer binding required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(q.body ORDER BY q.id),'[]'::jsonb) INTO result FROM (
 SELECT a.id,jsonb_build_object('cursor',a.id,'unitId',u.id,'unitName',u.name,'status',CASE a.status WHEN 'COMPLETED' THEN 'CONCLUDED' WHEN 'DRAFT' THEN CASE WHEN a.previous_id IS NULL THEN 'NOT_STARTED' ELSE 'IN_PROGRESS' END ELSE 'IN_PROGRESS' END)
 || CASE WHEN a.status='COMPLETED' AND s.admission_id IS NOT NULL THEN jsonb_build_object('summary',jsonb_build_object(
   'modality',s.modality,'supplyDate',s.supply_date,'conclusion',s.conclusion,'publishedAt',s.published_at)) ELSE '{}'::jsonb END AS body
 FROM public.acl_admissions a JOIN public.consumer_units u ON u.id=a.consumer_unit_id AND u.organization_id=a.organization_id AND u.customer_id=customer AND u.status='ACTIVE'
 LEFT JOIN public.acl_admission_public_summaries s ON s.admission_id=a.id AND s.organization_id=a.organization_id
 WHERE a.organization_id=p_org AND a.customer_id=customer AND NOT EXISTS(SELECT 1 FROM public.acl_admissions newer WHERE newer.organization_id=a.organization_id AND newer.previous_id=a.id) AND (p_after IS NULL OR a.id>p_after) ORDER BY a.id LIMIT 51
 ) q;
 RETURN result;
END $$;
NOTIFY pgrst,'reload schema';COMMIT;
