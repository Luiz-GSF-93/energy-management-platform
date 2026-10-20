BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.contract_index_memories(
 id uuid PRIMARY KEY,organization_id text NOT NULL REFERENCES public.organizations(id),customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),contract_id text NOT NULL REFERENCES public.energy_contracts(id),
 version integer NOT NULL CHECK(version>0),previous_id uuid REFERENCES public.contract_index_memories(id),
 parameters jsonb NOT NULL CHECK(jsonb_typeof(parameters)='object' AND octet_length(parameters::text)<5000),contract_snapshot jsonb NOT NULL,source_document jsonb,
 plan jsonb NOT NULL,payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('DRAFT','FETCHING','COMPLETE','FAILED','CANCELLED')),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
 consent_at timestamptz,consent_note text,finished_at timestamptz,result jsonb,
 UNIQUE(organization_id,contract_id,version));
ALTER TABLE public.contract_index_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_index_memories FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_index_memories FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.preserve_contract_index_memory() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preserve index history' USING ERRCODE='23514';END IF;
 IF (to_jsonb(NEW)-ARRAY['state','consent_at','consent_note','finished_at','result']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','consent_at','consent_note','finished_at','result']) OR
 NOT ((OLD.state='DRAFT' AND NEW.state IN('FETCHING','CANCELLED') AND OLD.result IS NOT DISTINCT FROM NEW.result AND ((NEW.state='FETCHING' AND NEW.consent_at IS NOT NULL AND NEW.consent_note IS NOT NULL AND NEW.finished_at IS NULL) OR (NEW.state='CANCELLED' AND NEW.consent_at IS NULL AND NEW.consent_note IS NULL AND NEW.finished_at IS NOT NULL))) OR
 (OLD.state='FETCHING' AND NEW.state IN('COMPLETE','FAILED') AND NEW.consent_at IS NOT DISTINCT FROM OLD.consent_at AND NEW.consent_note IS NOT DISTINCT FROM OLD.consent_note AND NEW.finished_at IS NOT NULL AND NEW.result IS NOT NULL)) THEN RAISE EXCEPTION 'Immutable index memory' USING ERRCODE='23514';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER preserve_contract_index_memory BEFORE UPDATE OR DELETE ON public.contract_index_memories FOR EACH ROW EXECUTE FUNCTION public.preserve_contract_index_memory();
CREATE FUNCTION public.contract_index_memory_action(p_org text,p_actor text,p_role text,p_platform boolean,p_contract text,p_action text,p_id uuid DEFAULT NULL,p_body jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.energy_contracts;r public.contract_index_memories;latest public.contract_index_memories;doc jsonb;writer boolean;privileged boolean;
BEGIN
 IF p_action NOT IN('history','preview','claim','cancel','finish') OR nullif(p_actor,'') IS NULL OR nullif(p_org,'') IS NULL THEN RAISE EXCEPTION 'Invalid memory scope' USING ERRCODE='22023';END IF;
 privileged:=p_platform IS TRUE AND EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now());
 IF NOT privileged AND NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles x ON x.id=m.role_id AND x.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND x.scope='organization' AND x.name IN('admin_org','gestor','operacional') AND x.permissions?'60f9690a-145b-4dba-b23f-9f945baca296') THEN RAISE EXCEPTION 'Internal contract actor required' USING ERRCODE='42501';END IF;
 writer:=privileged OR EXISTS(SELECT 1 FROM public.roles WHERE id=p_role AND organization_id=p_org AND permissions?'fd8a932f-87c0-4f86-8389-9f30c50e95b7');
 IF p_action<>'history' AND NOT writer THEN RAISE EXCEPTION 'Contract update permission required' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=current_date AND (end_date IS NULL OR end_date>=current_date) AND free_market_management)=0 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Active contract license required' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM public.energy_contracts WHERE organization_id=p_org AND id=p_contract AND contract_type='ENERGY_PURCHASE' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=c.customer_id AND organization_id=p_org AND deleted_at IS NULL AND upper(status)='ACTIVE') OR NOT EXISTS(SELECT 1 FROM public.consumer_units WHERE id=c.consumer_unit_id AND organization_id=p_org AND customer_id=c.customer_id AND upper(status)='ACTIVE') THEN RAISE EXCEPTION 'Contract unavailable' USING ERRCODE='42501';END IF;
 IF p_action='history' THEN RETURN jsonb_build_object('contract',to_jsonb(c),'canWrite',writer,'rows',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY version DESC) FROM(SELECT * FROM public.contract_index_memories WHERE organization_id=p_org AND contract_id=p_contract ORDER BY version DESC LIMIT 100)a),'[]'));END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':contract-index:'||p_contract,0));
 SELECT * INTO r FROM public.contract_index_memories WHERE id=p_id AND organization_id=p_org AND contract_id=p_contract FOR UPDATE;
 IF p_action='preview' THEN
  IF r.id IS NOT NULL THEN IF r.created_by<>p_actor OR r.payload_hash IS DISTINCT FROM p_body->>'hash' THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('row',to_jsonb(r),'replayed',true);END IF;
  IF p_id IS NULL OR jsonb_typeof(p_body->'parameters') IS DISTINCT FROM 'object' OR p_body->>'hash'!~'^[a-f0-9]{64}$' OR p_body->'contract' IS DISTINCT FROM to_jsonb(c) OR octet_length(p_body::text)>200000 OR (p_body#>>'{parameters,month}')!~'^(20|21)[0-9]{2}-(0[1-9]|1[0-2])$' OR p_body#>>'{parameters,index}' IS DISTINCT FROM 'IPCA' OR p_body#>>'{plan,host}' IS DISTINCT FROM 'apisidra.ibge.gov.br' THEN RAISE EXCEPTION 'Invalid memory parameters' USING ERRCODE='22023';END IF;
  IF c.status NOT IN('ACTIVE','APPROVED','DRAFT') OR (p_body#>>'{parameters,month}')<left(c.start_date::text,7) OR (p_body#>>'{parameters,month}')>left(c.end_date::text,7) THEN RAISE EXCEPTION 'Contract period mismatch' USING ERRCODE='22023';END IF;
  IF nullif(p_body#>>'{parameters,sourceDocumentId}','') IS NOT NULL THEN
   SELECT jsonb_build_object('id',d.id,'fileHash',d.file_hash) INTO doc FROM public.documents d WHERE d.id=p_body#>>'{parameters,sourceDocumentId}' AND d.organization_id=p_org AND d.customer_id=c.customer_id AND d.consumer_unit_id=c.consumer_unit_id AND d.energy_contract_id=c.id AND d.file_verified AND d.file_hash~'^[a-f0-9]{64}$' FOR SHARE;
   IF doc IS NULL THEN RAISE EXCEPTION 'Verified linked contract document required' USING ERRCODE='42501';END IF;
  END IF;
  SELECT * INTO latest FROM public.contract_index_memories WHERE organization_id=p_org AND contract_id=p_contract ORDER BY version DESC LIMIT 1;
  IF coalesce(p_body->>'previousId','') IS DISTINCT FROM coalesce(latest.id::text,'') THEN RAISE EXCEPTION 'Refresh latest revision' USING ERRCODE='40001';END IF;
  INSERT INTO public.contract_index_memories(id,organization_id,customer_id,consumer_unit_id,contract_id,version,previous_id,parameters,contract_snapshot,source_document,plan,payload_hash,state,created_by) VALUES(p_id,p_org,c.customer_id,c.consumer_unit_id,c.id,coalesce(latest.version,0)+1,latest.id,p_body->'parameters',to_jsonb(c),doc,p_body->'plan',p_body->>'hash','DRAFT',p_actor) RETURNING * INTO r;
  RETURN jsonb_build_object('row',to_jsonb(r),'replayed',false);
 END IF;
 IF r.id IS NULL OR r.created_by<>p_actor THEN RAISE EXCEPTION 'Memory owner required' USING ERRCODE='42501';END IF;
 IF p_action='claim' THEN
  IF p_body->>'hash' IS DISTINCT FROM r.payload_hash OR p_body->'acknowledge' IS DISTINCT FROM 'true'::jsonb OR length(btrim(p_body->>'note')) NOT BETWEEN 20 AND 1000 OR p_body->>'note' IS NULL THEN RAISE EXCEPTION 'Explicit source and period consent required' USING ERRCODE='22023';END IF;
  IF r.state<>'DRAFT' THEN RETURN jsonb_build_object('row',to_jsonb(r),'acquired',false);END IF;
  IF r.expires_at<=clock_timestamp() OR r.contract_snapshot IS DISTINCT FROM to_jsonb(c) OR (r.source_document IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=r.source_document->>'id' AND d.organization_id=p_org AND d.customer_id=c.customer_id AND d.consumer_unit_id=c.consumer_unit_id AND d.energy_contract_id=c.id AND d.file_verified AND d.file_hash=r.source_document->>'fileHash')) THEN RAISE EXCEPTION 'Consent expired or source changed' USING ERRCODE='40001';END IF;
  UPDATE public.contract_index_memories SET state='FETCHING',consent_at=clock_timestamp(),consent_note=p_body->>'note' WHERE id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('row',to_jsonb(r),'acquired',true);
 ELSIF p_action='cancel' THEN
  IF r.state='DRAFT' THEN UPDATE public.contract_index_memories SET state='CANCELLED',finished_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;END IF;RETURN jsonb_build_object('row',to_jsonb(r));
 ELSIF p_action='finish' THEN
  IF r.state IN('COMPLETE','FAILED') THEN RETURN jsonb_build_object('row',to_jsonb(r));END IF;
  IF r.state<>'FETCHING' OR p_body->>'state' NOT IN('COMPLETE','FAILED') OR jsonb_typeof(p_body->'result') IS DISTINCT FROM 'object' OR octet_length(p_body::text)>200000 THEN RAISE EXCEPTION 'Claimed lookup required' USING ERRCODE='22023';END IF;
  UPDATE public.contract_index_memories SET state=p_body->>'state',result=p_body->'result',finished_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;RETURN jsonb_build_object('row',to_jsonb(r));
 END IF;
 RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.preserve_contract_index_memory(),public.contract_index_memory_action(text,text,text,boolean,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.contract_index_memory_action(text,text,text,boolean,text,text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
