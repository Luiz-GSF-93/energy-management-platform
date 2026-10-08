BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.ccee_pld_publications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 month date NOT NULL,payload jsonb NOT NULL,payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,
 UNIQUE(organization_id,month),UNIQUE(organization_id,request_id),CHECK(extract(day FROM month)=1)
);
ALTER TABLE public.ccee_pld_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ccee_pld_publications FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ccee_pld_publication_immutable BEFORE UPDATE OR DELETE ON public.ccee_pld_publications FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE FUNCTION public.ccee_publish_pld_month(p_org text,p_actor text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target date;expected_hours integer;item jsonb;prior record;new_id uuid;digest text;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE u.user_id::text=p_actor AND r.scope='global' AND r.permissions ? 'ede45b9c-8af4-4b47-8490-9d386a3efb13')
 OR p_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL)
 OR (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND free_market_management)
 THEN RAISE EXCEPTION 'CCEE publisher unavailable' USING ERRCODE='42501';END IF;
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>30000
 OR p_payload-ARRAY['organizationId','state','provider','source','method','taxesIncluded','months','sourceHashes','imported','digest']<>'{}'::jsonb
 OR p_payload->>'organizationId' IS DISTINCT FROM p_org OR p_payload->>'state' IS DISTINCT FROM 'DRAFT'
 OR p_payload->>'provider' IS DISTINCT FROM 'CCEE' OR p_payload->>'source' IS DISTINCT FROM 'https://servicos.ccee.org.br/ws/prec/PLDBSv1'
 OR p_payload->>'method' IS DISTINCT FROM 'HOURLY_ARITHMETIC_MEAN' OR p_payload->'taxesIncluded' IS DISTINCT FROM 'false'::jsonb OR p_payload->'imported' IS DISTINCT FROM 'false'::jsonb
 OR jsonb_typeof(p_payload->'months') IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload->'sourceHashes') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Invalid CCEE publication' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_payload->'months')<>4 OR jsonb_array_length(p_payload->'sourceHashes') NOT BETWEEN 1 AND 20
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_payload->'sourceHashes') h WHERE h !~ '^[a-f0-9]{64}$')
 OR coalesce(p_payload->>'digest','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Incomplete CCEE provenance' USING ERRCODE='22023';END IF;
 IF coalesce(p_payload->'months'->0->>'month','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid CCEE month' USING ERRCODE='22023';END IF;
 target:=(p_payload->'months'->0->>'month'||'-01')::date;
 IF target<'2021-01-01'::date OR target>=date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'Closed CCEE month required' USING ERRCODE='22023';END IF;
 expected_hours:=extract(day FROM target+interval '1 month'-interval '1 day')::integer*24;
 IF (SELECT count(DISTINCT r->>'submarket') FROM jsonb_array_elements(p_payload->'months') r)<>4 THEN RAISE EXCEPTION 'Four CCEE markets required' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'months') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['month','submarket','hours','meanBrlMwh']<>'{}'::jsonb
  OR item->>'month' IS DISTINCT FROM to_char(target,'YYYY-MM') OR coalesce(item->>'submarket','') NOT IN ('SE_CO','S','NE','N')
  OR coalesce(item->>'hours','')<>expected_hours::text OR coalesce(item->>'meanBrlMwh','') !~ '^[0-9]{1,8}(\.[0-9]{1,6})?$'
  THEN RAISE EXCEPTION 'Invalid normalized CCEE value' USING ERRCODE='22023';END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('ccee-pld:'||p_org,0));
 SELECT * INTO prior FROM public.ccee_pld_publications WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF prior.month<>target OR prior.created_by<>p_actor OR prior.payload->>'digest' IS DISTINCT FROM p_payload->>'digest' THEN RAISE EXCEPTION 'CCEE request changed' USING ERRCODE='40001';END IF;
  RETURN jsonb_build_object('id',prior.id,'organizationId',p_org,'month',to_char(target,'YYYY-MM'),'published',true,'replayed',true);
 END IF;
 SELECT * INTO prior FROM public.ccee_pld_publications WHERE organization_id=p_org AND month=target;
 IF FOUND THEN
  IF prior.payload->>'digest' IS DISTINCT FROM p_payload->>'digest' THEN RAISE EXCEPTION 'CCEE publication changed' USING ERRCODE='40001';END IF;
  RETURN jsonb_build_object('id',prior.id,'organizationId',p_org,'month',to_char(target,'YYYY-MM'),'published',true,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.energy_price_pld_monthly WHERE organization_id=p_org AND month=target) THEN RAISE EXCEPTION 'Existing PLD requires explicit revision' USING ERRCODE='40001';END IF;
 digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 INSERT INTO public.ccee_pld_publications(organization_id,month,payload,payload_hash,created_by,request_id) VALUES(p_org,target,p_payload,digest,p_actor,p_request) RETURNING id INTO new_id;
 INSERT INTO public.energy_price_pld_monthly(organization_id,month,submarket,mean_brl_mwh,source,source_hash,hours,published_at,provider)
 SELECT p_org,target,r->>'submarket',(r->>'meanBrlMwh')::numeric,p_payload->>'source',digest,expected_hours,now(),'CCEE' FROM jsonb_array_elements(p_payload->'months') r;
 RETURN jsonb_build_object('id',new_id,'organizationId',p_org,'month',to_char(target,'YYYY-MM'),'published',true,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.ccee_publish_pld_month(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ccee_publish_pld_month(text,text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';COMMIT;
