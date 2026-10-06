-- Phase 1 registry. No roles are expanded, and no workflow/clock write RPC is
-- exposed until evidence validation and atomic transitions are implemented.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
INSERT INTO public.permissions(id,code,name,module,resource,action) VALUES
 ('2c933fdf-0bbf-406a-915c-03e7921e54d8','acl_admissions.view','Consultar adesões ACL','acl','admissions','view'),
 ('820dc44f-15a0-4c2a-871e-2c1d2d443d9e','acl_admissions.manage','Gerenciar adesões ACL','acl','admissions','manage'),
 ('26cadaa7-2eea-4080-91f6-1f26f87ca809','acl_admissions.approve','Aprovar adesões ACL','acl','admissions','approve');

CREATE UNIQUE INDEX acl_customer_tenant_key ON public.customers(organization_id,id);
CREATE UNIQUE INDEX acl_unit_customer_tenant_key ON public.consumer_units(organization_id,customer_id,id);
CREATE TABLE public.acl_admissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 customer_id text NOT NULL REFERENCES public.customers(id), consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 state jsonb NOT NULL CHECK(jsonb_typeof(state)='object' AND octet_length(state::text)<=2000000),
 revision integer NOT NULL CHECK(revision>0), status text NOT NULL CHECK(status IN ('DRAFT','IN_PROGRESS','COMPLETED')),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,customer_id) REFERENCES public.customers(organization_id,id),
 FOREIGN KEY(organization_id,customer_id,consumer_unit_id) REFERENCES public.consumer_units(organization_id,customer_id,id),
 UNIQUE(organization_id,id), UNIQUE(organization_id,consumer_unit_id),
 CHECK(coalesce(state ?& ARRAY['id','organizationId','customerId','unitId','status','revision','stages','events','workflowVersion','createdAt']
   AND state->>'organizationId'=organization_id AND state->>'customerId'=customer_id AND state->>'unitId'=consumer_unit_id
   AND state->>'id'=id::text AND state->>'status'=status AND (state->>'revision')::integer=revision
   AND state->>'workflowVersion'='acl-admission/1' AND jsonb_typeof(state->'stages')='array'
   AND jsonb_array_length(state->'stages')=12 AND jsonb_typeof(state->'events')='array',false))
);
CREATE INDEX acl_admissions_scope ON public.acl_admissions(organization_id,status,created_at DESC,id);
CREATE TABLE public.acl_admission_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,admission_id uuid NOT NULL,
 revision integer NOT NULL,request_id uuid NOT NULL,request_payload jsonb NOT NULL,
 action text NOT NULL,actor_id text NOT NULL,snapshot jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,admission_id) REFERENCES public.acl_admissions(organization_id,id),
 UNIQUE(organization_id,request_id),UNIQUE(admission_id,revision)
);
CREATE TABLE public.acl_admission_work_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,admission_id uuid NOT NULL,
 stage_key text NOT NULL CHECK(stage_key IN ('registration','invoices','feasibility','modality','contracts','termination','metering','custody','technical','contract-registration','validation','supply')),actor_id text NOT NULL,started_at timestamptz NOT NULL,
 heartbeat_at timestamptz NOT NULL,ended_at timestamptz,reason text,
 FOREIGN KEY(organization_id,admission_id) REFERENCES public.acl_admissions(organization_id,id),
 CHECK(heartbeat_at>=started_at AND (ended_at IS NULL OR ended_at>=heartbeat_at))
);
CREATE UNIQUE INDEX acl_one_actor_work ON public.acl_admission_work_sessions(organization_id,actor_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX acl_one_stage_work ON public.acl_admission_work_sessions(admission_id,stage_key) WHERE ended_at IS NULL;
CREATE TABLE public.acl_admission_performance_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,admission_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),body jsonb NOT NULL CHECK(coalesce(jsonb_typeof(body)='object' AND octet_length(body::text)<=2000000
   AND body->>'organizationId'=organization_id AND body->>'admissionId'=admission_id::text,false)),payload_hash text NOT NULL CHECK(payload_hash~'^[0-9a-f]{64}$'),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,admission_id) REFERENCES public.acl_admissions(organization_id,id),UNIQUE(admission_id,version),UNIQUE(organization_id,admission_id,id)
);
CREATE TABLE public.acl_admission_public_summaries (
 organization_id text NOT NULL,admission_id uuid PRIMARY KEY,performance_id uuid NOT NULL,
 modality text NOT NULL CHECK(modality IN ('RETAIL','OWN_AGENT')),supply_date date NOT NULL,
 conclusion text NOT NULL CHECK(length(btrim(conclusion)) BETWEEN 10 AND 1000),published_by text NOT NULL,published_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,admission_id) REFERENCES public.acl_admissions(organization_id,id),
 FOREIGN KEY(organization_id,admission_id,performance_id) REFERENCES public.acl_admission_performance_versions(organization_id,admission_id,id)
);
ALTER TABLE public.acl_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acl_admission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acl_admission_work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acl_admission_performance_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acl_admission_public_summaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.acl_admissions,public.acl_admission_events,public.acl_admission_work_sessions,
 public.acl_admission_performance_versions,public.acl_admission_public_summaries FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.acl_admissions,public.acl_admission_events,public.acl_admission_work_sessions,
 public.acl_admission_performance_versions,public.acl_admission_public_summaries TO service_role;

CREATE FUNCTION public.acl_preserve_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Immutable ACL evidence' USING ERRCODE='23514';END $$;
CREATE TRIGGER acl_events_immutable BEFORE UPDATE OR DELETE ON public.acl_admission_events FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER acl_performance_immutable BEFORE UPDATE OR DELETE ON public.acl_admission_performance_versions FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER acl_summary_immutable BEFORE UPDATE OR DELETE ON public.acl_admission_public_summaries FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE FUNCTION public.acl_protect_closed() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.status='COMPLETED' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'Closed ACL admission cannot be overwritten/deleted' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER acl_closed_immutable BEFORE UPDATE OR DELETE ON public.acl_admissions FOR EACH ROW EXECUTE FUNCTION public.acl_protect_closed();
CREATE FUNCTION public.acl_require_completed_summary() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.acl_admissions WHERE organization_id=NEW.organization_id AND id=NEW.admission_id AND status='COMPLETED')
 THEN RAISE EXCEPTION 'ACL summary requires completed admission' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER acl_summary_completion BEFORE INSERT ON public.acl_admission_public_summaries FOR EACH ROW EXECUTE FUNCTION public.acl_require_completed_summary();

CREATE FUNCTION public.acl_assert_actor(p_org text,p_actor text,p_role text,p_platform boolean,p_write boolean,p_customer text DEFAULT NULL)
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
 IF p_platform THEN
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor
    AND expires_at>now() AND revoked_at IS NULL) THEN RAISE EXCEPTION 'ACL platform session required' USING ERRCODE='42501';END IF;
  PERFORM public.assert_license_platform_actor(p_actor::uuid);
  RETURN jsonb_build_object('organizationId',p_org,'actorId',p_actor,'actorName','Administrador da plataforma','canWork',true,'canApprove',true,'customerId',NULL);
 END IF;
 SELECT m.exclusive_customer_id,m.affiliation_type,m.display_name,role_row.name,role_row.permissions INTO member_info
 FROM public.organization_members m JOIN public.roles role_row ON role_row.id=m.role_id AND role_row.organization_id=m.organization_id AND role_row.scope='organization'
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE';
 IF NOT FOUND OR member_info.name NOT IN ('admin_org','gestor','operacional') OR NOT coalesce(member_info.permissions ? '2c933fdf-0bbf-406a-915c-03e7921e54d8',false)
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

CREATE FUNCTION public.acl_candidates(p_org text,p_actor text,p_role text,p_platform boolean,p_after text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;result jsonb;
BEGIN
 access:=public.acl_assert_actor(p_org,p_actor,p_role,p_platform,false);
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q."unitId"),'[]'::jsonb) INTO result FROM (
  SELECT u.id AS "unitId",u.customer_id AS "customerId",u.name AS "unitName",c.company_name AS "customerName"
  FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id
  WHERE u.organization_id=p_org AND c.status='ACTIVE' AND c.deleted_at IS NULL AND u.status='ACTIVE' AND u.free_market IS FALSE
  AND u.tariff_subgroup IN ('A1','A2','A3','A3a','A4','AS') AND u.id>coalesce(p_after,'')
  AND (access->>'customerId' IS NULL OR c.id=access->>'customerId')
  AND NOT EXISTS(SELECT 1 FROM public.acl_admissions a WHERE a.organization_id=p_org AND a.consumer_unit_id=u.id)
  ORDER BY u.id LIMIT 51
 ) q;
 RETURN result;
END $$;

CREATE FUNCTION public.acl_create(p_org text,p_actor text,p_role text,p_platform boolean,p_request uuid,p_customer text,p_unit text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;payload jsonb;previous public.acl_admission_events;r public.acl_admissions;stages jsonb;now_ms bigint;new_id uuid;
BEGIN
 access:=public.acl_assert_actor(p_org,p_actor,p_role,p_platform,true,p_customer);
 IF p_request IS NULL OR p_customer IS NULL OR p_unit IS NULL OR length(p_customer)>100 OR length(p_unit)>100
 THEN RAISE EXCEPTION 'Invalid ACL request' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id
   WHERE u.organization_id=p_org AND u.id=p_unit AND c.id=p_customer AND c.status='ACTIVE' AND c.deleted_at IS NULL AND u.status='ACTIVE')
 THEN RAISE EXCEPTION 'ACL unit unavailable' USING ERRCODE='P4102';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||p_request::text,0));
 payload:=jsonb_build_object('actor',p_actor,'customer',p_customer,'unit',p_unit);
 SELECT * INTO previous FROM public.acl_admission_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF previous.request_payload<>payload THEN RAISE EXCEPTION 'ACL request changed' USING ERRCODE='40001';END IF;
  SELECT * INTO r FROM public.acl_admissions WHERE organization_id=p_org AND id=previous.admission_id;RETURN r.state;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE organization_id=p_org AND id=p_unit AND free_market IS FALSE
   AND tariff_subgroup IN ('A1','A2','A3','A3a','A4','AS')) THEN RAISE EXCEPTION 'Confirm ACR and Group A eligibility' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(jsonb_build_object('key',k,'status','NOT_STARTED','elapsedMs',0) ORDER BY n) INTO stages
 FROM unnest(ARRAY['registration','invoices','feasibility','modality','contracts','termination','metering','custody','technical','contract-registration','validation','supply']) WITH ORDINALITY s(k,n);
 new_id:=gen_random_uuid();now_ms:=floor(extract(epoch FROM clock_timestamp())*1000);
 INSERT INTO public.acl_admissions(id,organization_id,customer_id,consumer_unit_id,revision,status,created_by,state)
 VALUES(new_id,p_org,p_customer,p_unit,1,'DRAFT',p_actor,jsonb_build_object('id',new_id,'organizationId',p_org,
   'customerId',p_customer,'unitId',p_unit,'workflowVersion','acl-admission/1','status','DRAFT','revision',1,'createdAt',now_ms,'stages',stages,'events','[]'::jsonb)) RETURNING * INTO r;
 INSERT INTO public.acl_admission_events(organization_id,admission_id,revision,request_id,request_payload,action,actor_id,snapshot)
 VALUES(p_org,r.id,1,p_request,payload,'CREATE',p_actor,jsonb_build_object('state',r.state,'actorName',access->>'actorName'));
 RETURN r.state;
END $$;

CREATE FUNCTION public.acl_read(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid DEFAULT NULL,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;result jsonb;
BEGIN
 access:=public.acl_assert_actor(p_org,p_actor,p_role,p_platform,false);
 SELECT coalesce(jsonb_agg(q.state ORDER BY q.id),'[]'::jsonb) INTO result FROM (
 SELECT a.id,CASE WHEN p_id IS NOT NULL THEN a.state ELSE jsonb_build_object('id',a.id,'customerId',a.customer_id,
 'customerName',c.company_name,'unitId',u.id,'unitName',u.name,'status',a.status,'revision',a.revision,'createdAt',a.state->'createdAt') END AS state FROM public.acl_admissions a
 JOIN public.customers c ON c.id=a.customer_id AND c.organization_id=a.organization_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 JOIN public.consumer_units u ON u.id=a.consumer_unit_id AND u.customer_id=a.customer_id AND u.organization_id=a.organization_id AND u.status='ACTIVE'
 WHERE a.organization_id=p_org AND (p_id IS NULL OR a.id=p_id) AND (p_after IS NULL OR a.id>p_after)
 AND (access->>'customerId' IS NULL OR a.customer_id=access->>'customerId') ORDER BY a.id LIMIT 51
 ) q;
 IF p_id IS NOT NULL AND jsonb_array_length(result)=0 THEN RAISE EXCEPTION 'ACL process unavailable' USING ERRCODE='P4102';END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.acl_portal(p_org text,p_actor text,p_role text,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer text;result jsonb;
BEGIN
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management IS TRUE)
 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ACL portal license unavailable' USING ERRCODE='42501';END IF;
 SELECT m.exclusive_customer_id INTO customer FROM public.organization_members m JOIN public.roles r
 ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE'
 AND m.affiliation_type='external' AND r.name='consulta' AND r.permissions ? '3ebadd32-6f30-459e-8ed3-0d2843d89946';
 IF customer IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=customer AND organization_id=p_org AND status='ACTIVE' AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'Explicit external customer binding required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(q.body ORDER BY q.id),'[]'::jsonb) INTO result FROM (
 SELECT a.id,jsonb_build_object('cursor',a.id,'unitId',u.id,'unitName',u.name,'status',CASE a.status WHEN 'COMPLETED' THEN 'CONCLUDED' WHEN 'DRAFT' THEN 'NOT_STARTED' ELSE 'IN_PROGRESS' END)
 || CASE WHEN a.status='COMPLETED' AND s.admission_id IS NOT NULL THEN jsonb_build_object('summary',jsonb_build_object(
   'modality',s.modality,'supplyDate',s.supply_date,'conclusion',s.conclusion,'publishedAt',s.published_at)) ELSE '{}'::jsonb END AS body
 FROM public.acl_admissions a JOIN public.consumer_units u ON u.id=a.consumer_unit_id AND u.organization_id=a.organization_id AND u.customer_id=customer AND u.status='ACTIVE'
 LEFT JOIN public.acl_admission_public_summaries s ON s.admission_id=a.id AND s.organization_id=a.organization_id
 WHERE a.organization_id=p_org AND a.customer_id=customer AND (p_after IS NULL OR a.id>p_after) ORDER BY a.id LIMIT 51
 ) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.acl_preserve_record(),public.acl_protect_closed(),public.acl_require_completed_summary(),public.acl_assert_actor(text,text,text,boolean,boolean,text),public.acl_candidates(text,text,text,boolean,text),
 public.acl_create(text,text,text,boolean,uuid,text,text),public.acl_read(text,text,text,boolean,uuid,uuid),public.acl_portal(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_assert_actor(text,text,text,boolean,boolean,text),public.acl_candidates(text,text,text,boolean,text),
 public.acl_create(text,text,text,boolean,uuid,text,text),public.acl_read(text,text,text,boolean,uuid,uuid),public.acl_portal(text,text,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
