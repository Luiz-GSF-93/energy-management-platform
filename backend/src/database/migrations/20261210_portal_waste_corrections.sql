BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.portal_waste_corrections(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),customer_id text NOT NULL,consumer_unit_id text NOT NULL,
 month text NOT NULL CHECK(month~'^20[0-9]{2}-(0[1-9]|1[0-2])$'),publication_id text NOT NULL,source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
 indicator_key text NOT NULL CHECK(length(indicator_key) BETWEEN 3 AND 80),label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),amount numeric(14,2) NOT NULL CHECK(amount>0),
 corrected boolean NOT NULL,revision integer NOT NULL CHECK(revision>0),actor_id text NOT NULL,request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_id),UNIQUE(organization_id,publication_id,consumer_unit_id,source_hash,indicator_key,revision)
);
ALTER TABLE public.portal_waste_corrections ENABLE ROW LEVEL SECURITY;ALTER TABLE public.portal_waste_corrections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_waste_corrections FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER preserve_waste_correction_history BEFORE UPDATE OR DELETE ON public.portal_waste_corrections FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();
CREATE INDEX portal_waste_customer ON public.portal_waste_corrections(organization_id,customer_id,month,consumer_unit_id);
CREATE FUNCTION public.portal_waste_correction_action(p_org text,p_actor text,p_role text,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE binding jsonb;customer text;old public.portal_waste_corrections;result jsonb;n integer;pub jsonb;
BEGIN
 binding:=public.client_portal_entitlement(p_org,p_actor,p_role,'reports');
 IF binding->>'enabled' IS DISTINCT FROM 'true' OR binding->>'organizationId' IS DISTINCT FROM p_org OR binding->>'customerId' IS NULL THEN RAISE EXCEPTION 'Portal report required' USING ERRCODE='42501';END IF;customer:=binding->>'customerId';
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>4000 THEN RAISE EXCEPTION 'Invalid correction' USING ERRCODE='22023';END IF;
 IF p_action='read' THEN
  IF p_body-ARRAY['from','to','unitId']<>'{}' OR coalesce(p_body->>'from','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' OR coalesce(p_body->>'to','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' OR p_body->>'from'>p_body->>'to' THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023';END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO result FROM(SELECT DISTINCT ON(publication_id,consumer_unit_id,source_hash,indicator_key) publication_id AS "publicationId",consumer_unit_id AS "unitId",source_hash AS "sourceHash",indicator_key AS key,month,label,amount::text,corrected,revision,actor_id AS "actorId",created_at AS "declaredAt" FROM public.portal_waste_corrections c
   WHERE c.organization_id=p_org AND c.customer_id=customer AND c.month BETWEEN p_body->>'from' AND p_body->>'to' AND (nullif(p_body->>'unitId','') IS NULL OR c.consumer_unit_id=p_body->>'unitId') AND EXISTS(SELECT 1 FROM public.consumer_units u WHERE u.id=c.consumer_unit_id AND u.organization_id=p_org AND u.customer_id=customer AND u.status='ACTIVE') ORDER BY publication_id,consumer_unit_id,source_hash,indicator_key,revision DESC)x;
  RETURN result;
 ELSIF p_action<>'save' THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';END IF;
 IF p_body-ARRAY['publicationId','unitId','sourceHash','key','month','label','amount','corrected','revision','requestId']<>'{}' OR jsonb_typeof(p_body->'corrected') IS DISTINCT FROM 'boolean' OR coalesce(p_body->>'revision','')!~'^[0-9]{1,8}$' OR coalesce(p_body->>'month','')!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' OR coalesce(p_body->>'requestId','')!~'^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$' OR coalesce(p_body->>'amount','')!~'^[0-9]{1,12}\.[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid correction fields' USING ERRCODE='22023';END IF;
 pub:=public.read_portal_financial_components_v2(p_org,p_actor,p_role,false,true,p_body->>'month',p_body->>'month',customer);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pub)r WHERE r->>'publicationId'=p_body->>'publicationId' AND r->>'unitId'=p_body->>'unitId' AND coalesce(r->>'sourceHash',r->>'legacyHash')=p_body->>'sourceHash' AND r->>'customerId'=customer) THEN RAISE EXCEPTION 'Published source changed' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-waste:'||jsonb_build_array(p_org,p_body->>'publicationId',p_body->>'unitId',p_body->>'sourceHash',p_body->>'key')::text,0));
 SELECT * INTO old FROM public.portal_waste_corrections WHERE organization_id=p_org AND request_id=(p_body->>'requestId')::uuid;
 IF FOUND THEN
  IF old.actor_id<>p_actor OR old.publication_id<>p_body->>'publicationId' OR old.consumer_unit_id<>p_body->>'unitId' OR old.source_hash<>p_body->>'sourceHash' OR old.indicator_key<>p_body->>'key' OR old.corrected<>(p_body->>'corrected')::boolean OR old.revision<>(p_body->>'revision')::integer+1 OR old.amount<>(p_body->>'amount')::numeric THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;
  RETURN to_jsonb(old);
 END IF;
 SELECT coalesce(max(revision),0) INTO n FROM public.portal_waste_corrections WHERE organization_id=p_org AND publication_id=p_body->>'publicationId' AND consumer_unit_id=p_body->>'unitId' AND source_hash=p_body->>'sourceHash' AND indicator_key=p_body->>'key';
 IF n<>(p_body->>'revision')::integer THEN RAISE EXCEPTION 'Correction changed' USING ERRCODE='40001';END IF;
 INSERT INTO public.portal_waste_corrections(organization_id,customer_id,consumer_unit_id,month,publication_id,source_hash,indicator_key,label,amount,corrected,revision,actor_id,request_id)
 VALUES(p_org,customer,p_body->>'unitId',p_body->>'month',p_body->>'publicationId',p_body->>'sourceHash',p_body->>'key',p_body->>'label',(p_body->>'amount')::numeric,(p_body->>'corrected')::boolean,n+1,p_actor,(p_body->>'requestId')::uuid) RETURNING * INTO old;
 RETURN to_jsonb(old);
END$$;
REVOKE ALL ON FUNCTION public.portal_waste_correction_action(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.portal_waste_correction_action(text,text,text,text,jsonb) TO service_role;
COMMIT;
