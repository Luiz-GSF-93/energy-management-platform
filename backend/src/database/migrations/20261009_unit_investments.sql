BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.unit_investment_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,customer_id text NOT NULL,consumer_unit_id text NOT NULL,
 version integer NOT NULL CHECK(version>0),request_id uuid NOT NULL,body jsonb NOT NULL,payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),
 created_by text NOT NULL,actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_id),UNIQUE(organization_id,consumer_unit_id,version),UNIQUE(organization_id,id)
);
CREATE TABLE public.unit_investment_validations(
 organization_id text NOT NULL,investment_id uuid PRIMARY KEY,request_id uuid NOT NULL,payload_hash text NOT NULL,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 20 AND 1000),validated_by text NOT NULL,actor_name text NOT NULL,validated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,investment_id) REFERENCES public.unit_investment_versions(organization_id,id),UNIQUE(organization_id,request_id)
);
ALTER TABLE public.unit_investment_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_investment_validations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unit_investment_versions,public.unit_investment_validations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.unit_investment_versions,public.unit_investment_validations TO service_role;
CREATE TRIGGER investment_version_immutable BEFORE UPDATE OR DELETE ON public.unit_investment_versions FOR EACH ROW EXECUTE FUNCTION public.reject_report_change();
CREATE TRIGGER investment_validation_immutable BEFORE UPDATE OR DELETE ON public.unit_investment_validations FOR EACH ROW EXECUTE FUNCTION public.reject_report_change();
CREATE FUNCTION public.assert_investment_actor(p_org text,p_actor text,p_write boolean,p_validate boolean DEFAULT false) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE role_name text;perms jsonb;actor text;
BEGIN
 PERFORM public.assert_report_actor(p_org,p_actor,p_write);
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN RETURN 'Administrador da plataforma'; END IF;
 SELECT r.name,r.permissions,m.display_name INTO role_name,perms,actor FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';
 IF (p_write AND NOT coalesce(perms ? 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce',false)) OR (p_validate AND (role_name NOT IN ('admin_org','gestor') OR NOT coalesce(perms ? 'fd8a932f-87c0-4f86-8389-9f30c50e95b7',false))) THEN RAISE EXCEPTION 'Investment permission required' USING ERRCODE='42501';END IF;
 RETURN coalesce(nullif(btrim(actor),''),'Usuário autorizado');
END $$;
CREATE FUNCTION public.read_unit_investments(p_org text,p_actor text,p_customer text,p_unit text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE versions jsonb;documents jsonb;studies jsonb;
BEGIN
 PERFORM public.assert_investment_actor(p_org,p_actor,false,false);
 IF NOT EXISTS(SELECT 1 FROM public.customers c JOIN public.consumer_units u ON u.customer_id=c.id AND u.organization_id=c.organization_id WHERE c.organization_id=p_org AND c.id=p_customer AND u.id=p_unit AND c.status='ACTIVE' AND c.deleted_at IS NULL AND u.status='ACTIVE') THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='P3862';END IF;
 SELECT coalesce(jsonb_agg(j ORDER BY (j->>'version')::integer DESC),'[]'::jsonb) INTO versions FROM (SELECT to_jsonb(v)||jsonb_build_object('validated',a.investment_id IS NOT NULL,'validation',to_jsonb(a)) j FROM public.unit_investment_versions v LEFT JOIN public.unit_investment_validations a ON a.investment_id=v.id AND a.organization_id=v.organization_id WHERE v.organization_id=p_org AND v.customer_id=p_customer AND v.consumer_unit_id=p_unit ORDER BY v.version DESC LIMIT 100) q;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.original_filename)),'[]'::jsonb) INTO documents FROM public.documents d WHERE d.organization_id=p_org AND d.customer_id=p_customer AND d.consumer_unit_id=p_unit AND d.file_verified IS TRUE;
 SELECT coalesce(jsonb_agg(j),'[]'::jsonb) INTO studies FROM (SELECT jsonb_build_object('id',s.id,'version',s.version,'payload_hash',s.payload_hash,'amount',s.body#>>'{result,proposal,costPremises,migrationInvestmentBrl}') j FROM public.acl_economic_studies s JOIN public.acl_economic_study_reviews a ON a.organization_id=s.organization_id AND a.study_id=s.id AND a.decision='REVIEWED' WHERE s.organization_id=p_org AND s.customer_id=p_customer AND s.consumer_unit_id=p_unit AND s.body#>>'{result,proposal,costPremises,migrationInvestmentBrl}' IS NOT NULL ORDER BY s.created_at DESC LIMIT 100) q;
 RETURN jsonb_build_object('versions',versions,'documents',documents,'studies',studies);
END $$;
CREATE FUNCTION public.record_unit_investments(p_org text,p_actor text,p_customer text,p_unit text,p_request uuid,p_expected integer,p_body jsonb,p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text;current_version integer;r public.unit_investment_versions;item jsonb;total numeric:=0;
BEGIN
 actor:=public.assert_investment_actor(p_org,p_actor,true,false);
 PERFORM public.read_unit_investments(p_org,p_actor,p_customer,p_unit);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||p_unit,461));
 SELECT * INTO r FROM public.unit_investment_versions WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN IF r.created_by<>p_actor OR r.customer_id<>p_customer OR r.consumer_unit_id<>p_unit OR r.payload_hash<>p_hash OR r.body<>p_body THEN RAISE EXCEPTION 'Request conflict' USING ERRCODE='40001';END IF;RETURN to_jsonb(r);END IF;
 SELECT coalesce(max(version),0) INTO current_version FROM public.unit_investment_versions WHERE organization_id=p_org AND consumer_unit_id=p_unit;
 IF p_expected IS NULL OR current_version<>p_expected THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001';END IF;
 IF p_body IS NULL OR NOT p_body ?& ARRAY['schemaVersion','organizationId','customerId','unitId','startMonth','items','total','sourceStudy','note'] OR (SELECT count(*) FROM jsonb_object_keys(p_body))<>9 OR p_body->>'schemaVersion'<>'unit-investments/1' OR p_body->>'organizationId'<>p_org OR p_body->>'customerId'<>p_customer OR p_body->>'unitId'<>p_unit OR coalesce(p_body->>'startMonth','') !~ '^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR jsonb_typeof(p_body->'items')<>'array' OR jsonb_array_length(p_body->'items') NOT BETWEEN 1 AND 30 OR length(btrim(p_body->>'note')) NOT BETWEEN 20 AND 1000 OR coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid investments' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_body->'items') LOOP
  IF item->>'category' NOT IN ('MIGRATION','CCEE','ADAPTATION','OTHER') OR item->>'classification' NOT IN ('ESTIMATED','REALIZED') OR coalesce(item->>'amount','') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$' OR length(btrim(item->>'source')) NOT BETWEEN 20 AND 500 OR length(btrim(item->>'description')) NOT BETWEEN 3 AND 160 OR coalesce(item->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid item' USING ERRCODE='22023';END IF;
  PERFORM (item->>'date')::date;
  IF item->>'classification'='REALIZED' AND NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id::text=item->>'documentId' AND d.organization_id=p_org AND d.customer_id=p_customer AND d.consumer_unit_id=p_unit AND d.file_verified IS TRUE) THEN RAISE EXCEPTION 'Evidence required' USING ERRCODE='22023';END IF;
  total:=total+(item->>'amount')::numeric;
 END LOOP;
 IF total<>(p_body->>'total')::numeric OR total>=1000000000000 THEN RAISE EXCEPTION 'Invalid investment total' USING ERRCODE='22023';END IF;
 IF p_body->'sourceStudy'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM public.acl_economic_studies s JOIN public.acl_economic_study_reviews a ON a.study_id=s.id AND a.organization_id=s.organization_id AND a.decision='REVIEWED' WHERE s.id::text=p_body#>>'{sourceStudy,id}' AND s.organization_id=p_org AND s.customer_id=p_customer AND s.consumer_unit_id=p_unit AND s.payload_hash=p_body#>>'{sourceStudy,payloadHash}' AND s.version=(p_body#>>'{sourceStudy,version}')::integer) THEN RAISE EXCEPTION 'Study unavailable' USING ERRCODE='P3862';END IF;
 INSERT INTO public.unit_investment_versions(organization_id,customer_id,consumer_unit_id,version,request_id,body,payload_hash,created_by,actor_name) VALUES(p_org,p_customer,p_unit,current_version+1,p_request,p_body,p_hash,p_actor,actor) RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
CREATE FUNCTION public.validate_unit_investments(p_org text,p_actor text,p_id uuid,p_request uuid,p_hash text,p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text;r public.unit_investment_versions;a public.unit_investment_validations;
BEGIN
 actor:=public.assert_investment_actor(p_org,p_actor,true,true);
 SELECT * INTO r FROM public.unit_investment_versions WHERE organization_id=p_org AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Investment unavailable' USING ERRCODE='P3862';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||r.consumer_unit_id,461));
 PERFORM public.read_unit_investments(p_org,p_actor,r.customer_id,r.consumer_unit_id);
 IF r.payload_hash<>p_hash OR r.version<>(SELECT max(version) FROM public.unit_investment_versions WHERE organization_id=p_org AND consumer_unit_id=r.consumer_unit_id) THEN RAISE EXCEPTION 'Stale investment' USING ERRCODE='40001';END IF;
 SELECT * INTO a FROM public.unit_investment_validations WHERE investment_id=p_id;
 IF FOUND THEN IF a.request_id=p_request AND a.validated_by=p_actor AND a.payload_hash=p_hash AND a.note=p_note THEN RETURN to_jsonb(a);END IF;RAISE EXCEPTION 'Already validated' USING ERRCODE='40001';END IF;
 INSERT INTO public.unit_investment_validations(organization_id,investment_id,request_id,payload_hash,note,validated_by,actor_name) VALUES(p_org,p_id,p_request,p_hash,p_note,p_actor,actor) RETURNING * INTO a;
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.assert_investment_actor(text,text,boolean,boolean),public.read_unit_investments(text,text,text,text),public.record_unit_investments(text,text,text,text,uuid,integer,jsonb,text),public.validate_unit_investments(text,text,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_unit_investments(text,text,text,text),public.record_unit_investments(text,text,text,text,uuid,integer,jsonb,text),public.validate_unit_investments(text,text,uuid,uuid,text,text) TO service_role;
COMMIT;
