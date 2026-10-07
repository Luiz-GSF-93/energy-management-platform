BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.energy_price_baselines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,customer_id text NOT NULL,consumer_unit_id text NOT NULL,
 study_id uuid NOT NULL,study_hash text NOT NULL CHECK(study_hash~'^[a-f0-9]{64}$'),payload jsonb NOT NULL,payload_hash text NOT NULL,
 published_by text NOT NULL,published_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,
 FOREIGN KEY(organization_id,study_id) REFERENCES public.acl_economic_studies(organization_id,id),
 FOREIGN KEY(organization_id,customer_id,consumer_unit_id) REFERENCES public.consumer_units(organization_id,customer_id,id),UNIQUE(organization_id,request_id)
);
CREATE INDEX energy_price_baseline_scope ON public.energy_price_baselines(organization_id,customer_id,consumer_unit_id,published_at DESC);
CREATE TABLE public.energy_price_pld_monthly(
 organization_id text NOT NULL REFERENCES public.organizations(id),month date NOT NULL CHECK(extract(day FROM month)=1),
 submarket text NOT NULL CHECK(submarket IN ('SE_CO','S','NE','N')),mean_brl_mwh numeric(14,6) NOT NULL CHECK(mean_brl_mwh>=0),
 source text NOT NULL CHECK(length(source)>10),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 hours integer NOT NULL CHECK(hours BETWEEN 672 AND 744),published_at timestamptz NOT NULL,provider text NOT NULL CHECK(provider='CCEE'),
 PRIMARY KEY(organization_id,month,submarket)
);
ALTER TABLE public.energy_price_baselines ENABLE ROW LEVEL SECURITY;ALTER TABLE public.energy_price_pld_monthly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.energy_price_baselines,public.energy_price_pld_monthly FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER energy_price_baseline_immutable BEFORE UPDATE OR DELETE ON public.energy_price_baselines FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE FUNCTION public.energy_price_actor(p_org text,p_actor text,p_role text,p_platform boolean,p_portal boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE customer text;
BEGIN
 IF p_org IS NULL OR p_actor IS NULL OR p_role IS NULL OR p_platform IS NULL OR p_portal IS NULL THEN RAISE EXCEPTION 'Price actor required' USING ERRCODE='42501';END IF;
 IF NOT p_portal THEN RETURN public.acl_assert_actor(p_org,p_actor,p_role,p_platform,false);END IF;
 IF p_platform OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL)
 OR (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management)
 OR (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND user_id::text=p_actor AND upper(status)='ACTIVE')<>1 THEN RAISE EXCEPTION 'Price portal unavailable' USING ERRCODE='42501';END IF;
 SELECT m.exclusive_customer_id INTO customer FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND m.affiliation_type='external' AND r.name='consulta' AND r.permissions ? '3ebadd32-6f30-459e-8ed3-0d2843d89946';
 IF customer IS NULL OR NOT EXISTS(SELECT 1 FROM public.customers WHERE organization_id=p_org AND id=customer AND status='ACTIVE' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Price customer binding unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('customerId',customer,'canApprove',false);
END $$;
CREATE FUNCTION public.energy_price_read(p_org text,p_actor text,p_role text,p_platform boolean,p_portal boolean,p_year integer,p_customer text DEFAULT NULL,p_unit text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;customer text;units jsonb;ids text[];studies jsonb;baselines jsonb;financial jsonb;pld jsonb;
BEGIN
 access:=public.energy_price_actor(p_org,p_actor,p_role,p_platform,p_portal);
 IF p_year NOT BETWEEN 2000 AND 2100 OR p_year IS NULL THEN RAISE EXCEPTION 'Invalid price year' USING ERRCODE='22023';END IF;
 IF p_customer IS NOT NULL AND access->>'customerId' IS NOT NULL AND access->>'customerId'<>p_customer THEN RAISE EXCEPTION 'Foreign price customer' USING ERRCODE='42501';END IF;
 customer:=coalesce(p_customer,access->>'customerId');
 IF p_unit IS NOT NULL AND customer IS NULL THEN RAISE EXCEPTION 'Select one customer' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'customerId',c.id,'customerName',c.company_name) ORDER BY c.company_name,u.name),'[]'::jsonb),array_agg(u.id) INTO units,ids
 FROM public.consumer_units u JOIN public.customers c ON c.organization_id=u.organization_id AND c.id=u.customer_id
 WHERE u.organization_id=p_org AND u.status='ACTIVE' AND c.status='ACTIVE' AND c.deleted_at IS NULL AND (access->>'customerId' IS NULL OR c.id=access->>'customerId') AND (customer IS NULL OR c.id=customer) AND (p_unit IS NULL OR u.id=p_unit);
 IF jsonb_array_length(units)>1000 THEN RAISE EXCEPTION 'Price scope too large' USING ERRCODE='22023';END IF;
 IF (customer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers WHERE organization_id=p_org AND id=customer AND status='ACTIVE' AND deleted_at IS NULL)) OR (p_unit IS NOT NULL AND NOT(p_unit=ANY(coalesce(ids,ARRAY[]::text[])))) THEN RAISE EXCEPTION 'Price scope unavailable' USING ERRCODE='42501';END IF;
 IF customer IS NULL THEN RETURN jsonb_build_object('units',units,'customerId',NULL,'studies','[]'::jsonb,'baselines','[]'::jsonb,'financial','[]'::jsonb,'pld','[]'::jsonb,'canPublish',false);END IF;
 IF NOT p_portal THEN
 SELECT coalesce(jsonb_agg(q.body),'[]'::jsonb) INTO studies FROM (SELECT DISTINCT ON(s.consumer_unit_id) jsonb_build_object('id',s.id,'unitId',s.consumer_unit_id,'hash',s.payload_hash,'body',s.body,'reviewed',r.study_id IS NOT NULL,'version',s.version) body FROM public.acl_economic_studies s LEFT JOIN public.acl_financial_reviews r ON r.organization_id=s.organization_id AND r.study_id=s.id WHERE s.organization_id=p_org AND s.customer_id=customer AND s.consumer_unit_id=ANY(ids) AND s.payload_hash=encode(sha256(convert_to(s.body::text,'UTF8')),'hex') AND s.body->'source'=public.acl_history_simulation_source(p_org,p_actor,p_role,p_platform,s.admission_id,s.evidence_id) ORDER BY s.consumer_unit_id,s.created_at DESC,s.version DESC)q;
 ELSE studies:='[]'::jsonb;END IF;
 SELECT coalesce(jsonb_agg(q.body),'[]'::jsonb) INTO baselines FROM (SELECT DISTINCT ON(b.consumer_unit_id) jsonb_build_object('unitId',b.consumer_unit_id,'payload',b.payload,'publishedAt',b.published_at) body FROM public.energy_price_baselines b WHERE b.organization_id=p_org AND b.customer_id=customer AND b.consumer_unit_id=ANY(ids) AND b.payload_hash=encode(sha256(convert_to(b.payload::text,'UTF8')),'hex') ORDER BY b.consumer_unit_id,b.published_at DESC,b.id DESC)q;
 SELECT coalesce(jsonb_agg(q.body),'[]'::jsonb) INTO financial FROM (SELECT DISTINCT ON(f.consumer_unit_id,f.month) jsonb_build_object('unitId',f.consumer_unit_id,'month',to_char(f.month,'YYYY-MM'),'payload',f.financial_payload,'hash',f.financial_hash) body FROM public.monthly_energy_settlements f WHERE f.organization_id=p_org AND f.customer_id=customer AND f.consumer_unit_id=ANY(ids) AND extract(year FROM f.month)=p_year AND f.status='PUBLISHED' AND f.validation_status='VALIDATED' AND f.financial_format='financial-settlement-1.0' AND f.approved_at IS NOT NULL AND f.published_at IS NOT NULL ORDER BY f.consumer_unit_id,f.month,f.version_number DESC)q;
 IF jsonb_array_length(financial)>12000 THEN RAISE EXCEPTION 'Price publication scope too large' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('month',to_char(month,'YYYY-MM'),'submarket',submarket,'value',mean_brl_mwh::text,'source',source,'publishedAt',published_at,'hours',hours)),'[]'::jsonb) INTO pld FROM public.energy_price_pld_monthly WHERE organization_id=p_org AND extract(year FROM month)=p_year;
 RETURN jsonb_build_object('units',units,'customerId',customer,'studies',studies,'baselines',baselines,'financial',financial,'pld',pld,'canPublish',NOT p_portal AND (access->>'canApprove')::boolean);
END $$;
CREATE FUNCTION public.energy_price_publish(p_org text,p_actor text,p_role text,p_platform boolean,p_study uuid,p_hash text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s record;access jsonb;source jsonb;prior record;new_id uuid;
BEGIN
 access:=public.acl_assert_actor(p_org,p_actor,p_role,p_platform,false);
 IF NOT coalesce((access->>'canApprove')::boolean,false) OR p_request IS NULL OR p_payload->>'state' IS DISTINCT FROM 'AVAILABLE' OR p_payload->>'method' IS DISTINCT FROM 'ANNUAL_ENERGY_WEIGHTED_GD_TE' OR jsonb_typeof(p_payload->'months') IS DISTINCT FROM 'array' OR coalesce(jsonb_array_length(p_payload->'months'),0)<>12 OR octet_length(p_payload::text)>30000 THEN RAISE EXCEPTION 'Reviewed price publication required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('energy-price:'||p_org,0));
 SELECT * INTO s FROM public.acl_economic_studies WHERE organization_id=p_org AND id=p_study;
 IF NOT FOUND OR s.payload_hash IS DISTINCT FROM p_hash OR s.payload_hash<>encode(sha256(convert_to(s.body::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Price study unavailable' USING ERRCODE='42501';END IF;
 PERFORM public.acl_assert_actor(p_org,p_actor,p_role,p_platform,false,s.customer_id);
 IF NOT EXISTS(SELECT 1 FROM public.acl_financial_reviews f JOIN public.acl_economic_study_reviews r ON r.organization_id=f.organization_id AND r.study_id=f.study_id AND r.reviewed_by=f.reviewed_by WHERE f.organization_id=p_org AND f.study_id=s.id AND f.payload_hash=s.payload_hash AND r.payload_hash=s.payload_hash AND r.decision='REVIEWED' AND f.reviewed_by<>s.created_by) THEN RAISE EXCEPTION 'Independent price source review required' USING ERRCODE='42501';END IF;
 source:=public.acl_history_simulation_source(p_org,p_actor,p_role,p_platform,s.admission_id,s.evidence_id);
 IF source IS DISTINCT FROM s.body->'source' THEN RAISE EXCEPTION 'Price source changed' USING ERRCODE='40001';END IF;
 SELECT * INTO prior FROM public.energy_price_baselines WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF prior.study_id<>s.id OR prior.study_hash<>p_hash OR prior.payload<>p_payload OR prior.published_by<>p_actor THEN RAISE EXCEPTION 'Price request changed' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('id',prior.id,'replayed',true);END IF;
 INSERT INTO public.energy_price_baselines(organization_id,customer_id,consumer_unit_id,study_id,study_hash,payload,payload_hash,published_by,request_id) VALUES(p_org,s.customer_id,s.consumer_unit_id,s.id,s.payload_hash,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),p_actor,p_request) RETURNING energy_price_baselines.id INTO new_id;
 RETURN jsonb_build_object('id',new_id,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.energy_price_actor(text,text,text,boolean,boolean),public.energy_price_read(text,text,text,boolean,boolean,integer,text,text),public.energy_price_publish(text,text,text,boolean,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.energy_price_read(text,text,text,boolean,boolean,integer,text,text),public.energy_price_publish(text,text,text,boolean,uuid,text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';COMMIT;
