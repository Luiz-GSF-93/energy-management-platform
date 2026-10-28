BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
ALTER TABLE public.client_portal_policies ADD COLUMN multi_customer_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.organization_members ADD COLUMN portal_scope_managed boolean NOT NULL DEFAULT false;
CREATE TABLE public.portal_customer_access (
 organization_id text NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL,customer_id text NOT NULL REFERENCES public.customers(id),
 unit_ids text[] NOT NULL DEFAULT '{}',all_units boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 origin text NOT NULL CHECK(origin IN('LEGACY','MANUAL')),
 updated_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,user_id,customer_id),
 CHECK(cardinality(unit_ids)<=100),CHECK(NOT active OR all_units OR cardinality(unit_ids)>0)
);
CREATE TABLE public.portal_customer_access_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL,customer_id text NOT NULL,actor_id text NOT NULL,request_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 previous jsonb,current_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,request_id)
);
ALTER TABLE public.portal_customer_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_customer_access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_customer_access,public.portal_customer_access_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.portal_customer_access,public.portal_customer_access_events TO service_role;
-- Carry forward only the existing explicit customer binding. No new company,
-- unit, role or financial permission is granted by migration.
INSERT INTO public.portal_customer_access(organization_id,user_id,customer_id,all_units,origin,updated_by)
SELECT m.organization_id,m.user_id,m.exclusive_customer_id,true,'LEGACY','migration:20261240'
FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id
JOIN public.customers c ON c.id=m.exclusive_customer_id AND c.organization_id=m.organization_id
WHERE m.affiliation_type='external' AND r.name='consulta' AND r.scope='organization' AND upper(m.status)='ACTIVE' AND c.deleted_at IS NULL;
INSERT INTO public.portal_customer_access_events(organization_id,user_id,customer_id,actor_id,request_id,reason,current_snapshot)
SELECT organization_id,user_id,customer_id,'migration:20261240',gen_random_uuid(),'Preservação do vínculo exclusivo anterior, sem ampliação de acesso.',to_jsonb(a) FROM public.portal_customer_access a;

CREATE FUNCTION public.portal_customer_scope(p_org text,p_actor text,p_role text,p_customer text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m record;g record;units jsonb;choices jsonb;sig text;
BEGIN
 IF NOT coalesce((SELECT multi_customer_enabled FROM public.client_portal_policies WHERE organization_id=p_org),false) THEN RETURN jsonb_build_object('enabled',false);END IF;
 SELECT om.*,r.name AS role_name,r.permissions INTO m FROM public.organization_members om JOIN public.roles r ON r.id=om.role_id AND r.organization_id=om.organization_id AND r.scope='organization'
 WHERE om.organization_id=p_org AND om.user_id::text=p_actor AND om.role_id::text=p_role AND upper(om.status)='ACTIVE' AND om.affiliation_type='external' AND r.name='consulta';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Portal membership revoked' USING ERRCODE='42501';END IF;
 PERFORM public.client_portal_parent_license(p_org);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.customer_id,'name',c.company_name) ORDER BY c.company_name,a.customer_id),'[]') INTO choices
 FROM public.portal_customer_access a JOIN public.customers c ON c.id=a.customer_id AND c.organization_id=a.organization_id AND c.status='ACTIVE' AND c.deleted_at IS NULL
 JOIN public.client_portal_licenses l ON l.organization_id=a.organization_id AND l.customer_id=a.customer_id AND l.status='ACTIVE' AND l.starts<=CURRENT_DATE AND l.ends>=CURRENT_DATE
 WHERE a.organization_id=p_org AND a.user_id::text=p_actor AND a.active AND EXISTS(SELECT 1 FROM public.consumer_units u WHERE u.organization_id=p_org AND u.customer_id=a.customer_id AND(a.all_units OR u.id=ANY(a.unit_ids)));
 IF jsonb_array_length(choices)>100 THEN RAISE EXCEPTION 'Portal scope too large' USING ERRCODE='22023';END IF;
 IF p_customer IS NULL THEN
  p_customer:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(choices)x WHERE x->>'id'=m.exclusive_customer_id) THEN m.exclusive_customer_id ELSE choices->0->>'id' END;
 END IF;
 IF p_customer IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(choices)x WHERE x->>'id'=p_customer) THEN RAISE EXCEPTION 'Portal customer unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT g FROM public.portal_customer_access WHERE organization_id=p_org AND user_id::text=p_actor AND customer_id=p_customer AND active;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'number',u.consumer_unit_number) ORDER BY u.name,u.id),'[]') INTO units FROM public.consumer_units u
 WHERE u.organization_id=p_org AND u.customer_id=p_customer AND(g.all_units OR u.id=ANY(g.unit_ids));
 IF jsonb_array_length(units) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Portal units unavailable' USING ERRCODE='42501';END IF;
 sig:=md5(jsonb_build_array(p_org,p_actor,p_role,p_customer,g.revision,units,m.permissions)::text);
 RETURN jsonb_build_object('enabled',true,'organizationId',p_org,'userId',p_actor,'roleId',p_role,'customerId',p_customer,'customers',choices,'units',units,'allUnits',(g.all_units OR NOT EXISTS(SELECT 1 FROM public.consumer_units u WHERE u.organization_id=p_org AND u.customer_id=p_customer AND NOT u.id=ANY(g.unit_ids))),'revision',sig);
END$$;

CREATE FUNCTION public.manage_portal_customer_access(p_org text,p_actor text,p_platform boolean,p_action text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m record;target record;old public.portal_customer_access;saved public.portal_customer_access;license public.client_portal_licenses;uid uuid;customer text;ids text[];used integer;existing public.portal_customer_access_events;
BEGIN
 IF NOT coalesce((SELECT multi_customer_enabled FROM public.client_portal_policies WHERE organization_id=p_org),false) THEN RAISE EXCEPTION 'Portal rollout unavailable' USING ERRCODE='42501';END IF;
 IF p_platform THEN
  PERFORM public.assert_license_platform_actor(p_actor::uuid);
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Organization session required' USING ERRCODE='42501';END IF;
 ELSE
  SELECT om.*,r.name,r.permissions INTO m FROM public.organization_members om JOIN public.roles r ON r.id=om.role_id AND r.organization_id=om.organization_id AND r.scope='organization'
  WHERE om.organization_id=p_org AND om.user_id::text=p_actor AND upper(om.status)='ACTIVE' AND om.affiliation_type='internal' AND r.name IN('admin_org','gestor');
  IF NOT FOUND OR NOT(m.permissions ?& ARRAY['94f57d38-0438-43c5-81bc-5544ab53912a','8c5673e4-115c-4ab7-bb11-3b410eddcad3']) THEN RAISE EXCEPTION 'Portal access management denied' USING ERRCODE='42501';END IF;
 END IF;
 IF p_action='list' THEN
  RETURN jsonb_build_object('organizationId',p_org,'members',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',om.user_id,'name',coalesce(nullif(om.display_name,''),om.user_id::text)) ORDER BY om.display_name),'[]') FROM public.organization_members om JOIN public.roles r ON r.id=om.role_id AND r.organization_id=om.organization_id WHERE om.organization_id=p_org AND om.affiliation_type='external' AND r.name='consulta' AND r.scope='organization'),
   'customers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',company_name) ORDER BY company_name),'[]') FROM public.customers WHERE organization_id=p_org AND status='ACTIVE' AND deleted_at IS NULL),
   'units',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'customerId',customer_id,'name',name,'number',consumer_unit_number) ORDER BY name),'[]') FROM public.consumer_units WHERE organization_id=p_org),
   'grants',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM public.portal_customer_access a WHERE organization_id=p_org),
   'history',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM(SELECT * FROM public.portal_customer_access_events WHERE organization_id=p_org ORDER BY created_at DESC LIMIT 50)e));
 END IF;
 IF p_body IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>20000 THEN RAISE EXCEPTION 'Invalid portal access change' USING ERRCODE='22023';END IF;
 IF p_action<>'save' OR p_body-ARRAY['userId','customerId','unitIds','active','revision','requestId','reason']<>'{}' OR NOT(p_body ?& ARRAY['userId','customerId','unitIds','active','revision','requestId','reason']) OR jsonb_typeof(p_body->'unitIds')<>'array' OR jsonb_array_length(p_body->'unitIds')>100 OR jsonb_typeof(p_body->'active')<>'boolean' OR length(btrim(p_body->>'reason')) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Invalid portal access change' USING ERRCODE='22023';END IF;
 uid:=(p_body->>'userId')::uuid;customer:=p_body->>'customerId';
 SELECT array_agg(x ORDER BY x) INTO ids FROM jsonb_array_elements_text(p_body->'unitIds')x;
 ids:=coalesce(ids,'{}');
 IF (SELECT count(DISTINCT x) FROM unnest(ids)x)<>cardinality(ids) OR ((p_body->>'active')::boolean AND cardinality(ids)=0) THEN RAISE EXCEPTION 'Select unique authorized units' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
 SELECT * INTO existing FROM public.portal_customer_access_events WHERE organization_id=p_org AND request_id=(p_body->>'requestId')::uuid;
 IF FOUND THEN
  IF existing.actor_id<>p_actor OR existing.user_id<>uid OR existing.customer_id<>customer OR existing.reason<>btrim(p_body->>'reason') OR existing.current_snapshot->'unit_ids'<>to_jsonb(ids) OR (existing.current_snapshot->>'active')::boolean<>(p_body->>'active')::boolean THEN RAISE EXCEPTION 'Access request changed' USING ERRCODE='40001';END IF;
  RETURN existing.current_snapshot;
 END IF;
 SELECT om.*,r.name INTO target FROM public.organization_members om JOIN public.roles r ON r.id=om.role_id AND r.organization_id=om.organization_id AND r.scope='organization' WHERE om.organization_id=p_org AND om.user_id=uid AND (NOT (p_body->>'active')::boolean OR (upper(om.status)='ACTIVE' AND om.affiliation_type='external' AND r.name='consulta'));
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.customers WHERE organization_id=p_org AND id=customer AND (NOT (p_body->>'active')::boolean OR (status='ACTIVE' AND deleted_at IS NULL))) OR EXISTS(SELECT 1 FROM unnest(ids)x WHERE NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE organization_id=p_org AND customer_id=customer AND id=x)) THEN RAISE EXCEPTION 'Access target unavailable in organization' USING ERRCODE='42501';END IF;
 SELECT * INTO old FROM public.portal_customer_access WHERE organization_id=p_org AND user_id=uid AND customer_id=customer FOR UPDATE;
 IF coalesce(old.revision,0) IS DISTINCT FROM (p_body->>'revision')::integer THEN RAISE EXCEPTION 'Portal access changed' USING ERRCODE='40001';END IF;
 IF (p_body->>'active')::boolean THEN
  PERFORM public.client_portal_parent_license(p_org);
  SELECT * INTO license FROM public.client_portal_licenses WHERE organization_id=p_org AND customer_id=customer AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer portal license required' USING ERRCODE='42501';END IF;
  SELECT count(DISTINCT a.user_id) INTO used FROM public.portal_customer_access a JOIN public.organization_members om ON om.organization_id=a.organization_id AND om.user_id=a.user_id AND upper(om.status)='ACTIVE' AND om.affiliation_type='external' JOIN public.roles r ON r.id=om.role_id AND r.organization_id=om.organization_id AND r.scope='organization' AND r.name='consulta' WHERE a.organization_id=p_org AND a.customer_id=customer AND a.active AND a.user_id<>uid;
  IF used>=license.max_users THEN RAISE EXCEPTION 'Customer portal capacity reached' USING ERRCODE='P3411';END IF;
 END IF;
 INSERT INTO public.portal_customer_access(organization_id,user_id,customer_id,unit_ids,all_units,active,revision,origin,updated_by)
 VALUES(p_org,uid,customer,ids,false,(p_body->>'active')::boolean,1,'MANUAL',p_actor)
 ON CONFLICT(organization_id,user_id,customer_id) DO UPDATE SET unit_ids=excluded.unit_ids,all_units=false,active=excluded.active,revision=portal_customer_access.revision+1,origin='MANUAL',updated_by=p_actor,updated_at=clock_timestamp() RETURNING * INTO saved;
 INSERT INTO public.portal_customer_access_events(organization_id,user_id,customer_id,actor_id,request_id,reason,previous,current_snapshot) VALUES(p_org,uid,customer,p_actor,(p_body->>'requestId')::uuid,btrim(p_body->>'reason'),CASE WHEN old.revision IS NULL THEN NULL ELSE to_jsonb(old) END,to_jsonb(saved));
 UPDATE public.organization_members SET portal_scope_managed=true WHERE organization_id=p_org AND user_id=uid;
 RETURN to_jsonb(saved);
END$$;

REVOKE ALL ON FUNCTION public.portal_customer_scope(text,text,text,text),public.manage_portal_customer_access(text,text,boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_customer_scope(text,text,text,text),public.manage_portal_customer_access(text,text,boolean,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
