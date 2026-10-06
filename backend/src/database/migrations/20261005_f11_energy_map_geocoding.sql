BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Durable, single-dispatch requests. No address backfill or provider calls in migration.
CREATE TABLE public.energy_map_geocoding_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),customer_id text NOT NULL REFERENCES public.customers(id),
 address_hash text NOT NULL CHECK(length(address_hash)=32),location_revision integer NOT NULL CHECK(location_revision>=0),
 provider text NOT NULL DEFAULT 'MAPBOX_V6_PERMANENT' CHECK(provider='MAPBOX_V6_PERMANENT'),
 status text NOT NULL CHECK(status IN ('PROCESSING','REVIEW','FAILED','STALE','CONFIRMED')),
 requested_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 lease_id uuid NOT NULL DEFAULT gen_random_uuid(),lease_until timestamptz NOT NULL DEFAULT now()+interval '30 seconds',
 candidates jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(candidates)='array' AND jsonb_array_length(candidates)<=5),
 error_code text,confirmed_revision integer,confirmed_by text,
 UNIQUE(organization_id,consumer_unit_id,address_hash,provider)
);
CREATE INDEX energy_map_geocoding_usage ON public.energy_map_geocoding_jobs(created_at,organization_id);
ALTER TABLE public.energy_map_geocoding_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.energy_map_geocoding_jobs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.energy_map_geocoding_jobs TO service_role;

CREATE FUNCTION public.read_energy_map_geocoding(p_org text,p_actor text,p_unit text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.consumer_units;j public.energy_map_geocoding_jobs;
BEGIN
 PERFORM public.assert_energy_map_actor(p_org,p_actor,false);
 SELECT * INTO u FROM public.consumer_units WHERE organization_id=p_org AND id=p_unit;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.customers WHERE organization_id=p_org AND id=u.customer_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='P3162';END IF;
 SELECT * INTO j FROM public.energy_map_geocoding_jobs WHERE organization_id=p_org AND consumer_unit_id=p_unit AND address_hash=public.energy_map_address_hash(u);
 IF NOT FOUND THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',j.id,'status',CASE WHEN j.customer_id<>u.customer_id OR j.location_revision<>COALESCE((SELECT revision FROM public.consumer_unit_locations WHERE organization_id=p_org AND consumer_unit_id=p_unit),0) AND j.status<>'CONFIRMED' THEN 'STALE' WHEN j.status='PROCESSING' AND j.lease_until<now() THEN 'FAILED' ELSE j.status END,
  'errorCode',CASE WHEN j.status='PROCESSING' AND j.lease_until<now() THEN 'OUTCOME_UNKNOWN' ELSE j.error_code END,
  'candidates',CASE WHEN j.status='REVIEW' AND j.customer_id=u.customer_id AND j.location_revision=COALESCE((SELECT revision FROM public.consumer_unit_locations WHERE organization_id=p_org AND consumer_unit_id=p_unit),0) THEN j.candidates ELSE '[]'::jsonb END,
  'addressHash',j.address_hash,'revision',j.location_revision,'createdAt',j.created_at);
END $$;

CREATE FUNCTION public.claim_energy_map_geocoding(p_org text,p_actor text,p_unit text,p_hash text,p_daily integer,p_monthly integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.consumer_units;j public.energy_map_geocoding_jobs;rev integer;
BEGIN
 PERFORM public.assert_energy_map_actor(p_org,p_actor,true);
 IF p_daily NOT BETWEEN 1 AND 100 OR p_monthly NOT BETWEEN 1 AND 1000 OR p_hash !~ '^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'Invalid limits' USING ERRCODE='22023';END IF;
 -- Serialize budget admission across all replicas and tenants; never trust an in-memory counter.
 PERFORM pg_advisory_xact_lock(31610,1);
 SELECT * INTO u FROM public.consumer_units WHERE organization_id=p_org AND id=p_unit FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.customers WHERE organization_id=p_org AND id=u.customer_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='P3162';END IF;
 IF public.energy_map_address_hash(u)<>p_hash THEN RAISE EXCEPTION 'Address changed' USING ERRCODE='P3161';END IF;
 IF length(btrim(COALESCE(u.address,''))) NOT BETWEEN 5 AND 180 OR length(btrim(COALESCE(u.city,''))) NOT BETWEEN 1 AND 60 OR upper(btrim(u.state)) NOT IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') THEN RAISE EXCEPTION 'Address incomplete' USING ERRCODE='22023';END IF;
 SELECT * INTO j FROM public.energy_map_geocoding_jobs WHERE organization_id=p_org AND consumer_unit_id=p_unit AND address_hash=p_hash;
 IF FOUND THEN RETURN jsonb_build_object('dispatch',false,'job',public.read_energy_map_geocoding(p_org,p_actor,p_unit));END IF;
 IF (SELECT count(*) FROM public.energy_map_geocoding_jobs WHERE organization_id=p_org AND created_at>=date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')>=p_daily
 OR (SELECT count(*) FROM public.energy_map_geocoding_jobs WHERE created_at>=date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')>=p_monthly
 THEN RAISE EXCEPTION 'Geocoding budget exhausted' USING ERRCODE='P3163';END IF;
 SELECT COALESCE((SELECT revision FROM public.consumer_unit_locations WHERE organization_id=p_org AND consumer_unit_id=p_unit),0) INTO rev;
 INSERT INTO public.energy_map_geocoding_jobs(organization_id,consumer_unit_id,customer_id,address_hash,location_revision,status,requested_by)
 VALUES(p_org,p_unit,u.customer_id,p_hash,rev,'PROCESSING',p_actor) RETURNING * INTO j;
 RETURN jsonb_build_object('dispatch',true,'jobId',j.id,'leaseId',j.lease_id,'address',jsonb_build_object('address',u.address,'city',u.city,'state',upper(btrim(u.state))));
END $$;

CREATE FUNCTION public.finish_energy_map_geocoding(p_org text,p_actor text,p_job uuid,p_lease uuid,p_candidates jsonb,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.energy_map_geocoding_jobs;u public.consumer_units;c jsonb;valid boolean;
BEGIN
 PERFORM public.assert_energy_map_actor(p_org,p_actor,true);
 SELECT * INTO j FROM public.energy_map_geocoding_jobs WHERE id=p_job AND organization_id=p_org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='P3162';END IF;
 SELECT * INTO u FROM public.consumer_units WHERE organization_id=p_org AND id=j.consumer_unit_id FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.customers WHERE organization_id=p_org AND id=u.customer_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='P3162';END IF;
 SELECT * INTO j FROM public.energy_map_geocoding_jobs WHERE id=p_job AND organization_id=p_org FOR UPDATE;
 IF j.requested_by<>p_actor OR j.lease_id<>p_lease OR j.status<>'PROCESSING' THEN RAISE EXCEPTION 'Dispatch changed' USING ERRCODE='P3161';END IF;
 IF p_candidates IS NULL OR jsonb_typeof(p_candidates)<>'array' OR jsonb_array_length(p_candidates)>5 OR (p_error IS NOT NULL AND p_error NOT IN ('ADDRESS_INCOMPLETE','RATE_LIMIT','PROVIDER_AUTH','PROVIDER_UNAVAILABLE','INVALID_RESPONSE','TIMEOUT','NOT_CONFIGURED')) THEN RAISE EXCEPTION 'Invalid outcome' USING ERRCODE='22023';END IF;
 FOR c IN SELECT * FROM jsonb_array_elements(p_candidates) LOOP
  IF c IS NULL OR NOT c ?& ARRAY['latitude','longitude','precision','label','providerId'] OR jsonb_typeof(c->'latitude') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'longitude') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'precision') IS DISTINCT FROM 'string' OR jsonb_typeof(c->'label') IS DISTINCT FROM 'string' OR jsonb_typeof(c->'providerId') IS DISTINCT FROM 'string' OR NOT((c->>'latitude')::double precision BETWEEN -34 AND 6 AND (c->>'longitude')::double precision BETWEEN -74 AND -28) OR c->>'precision' NOT IN ('ADDRESS','STREET','POSTCODE','CITY') OR length(c->>'label') NOT BETWEEN 1 AND 500 OR length(c->>'providerId') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid candidate' USING ERRCODE='22023';END IF;
 END LOOP;
 valid:=public.energy_map_address_hash(u)=j.address_hash AND u.customer_id=j.customer_id AND COALESCE((SELECT revision FROM public.consumer_unit_locations WHERE organization_id=p_org AND consumer_unit_id=u.id),0)=j.location_revision AND j.lease_until>=now();
 UPDATE public.energy_map_geocoding_jobs SET status=CASE WHEN NOT valid THEN 'STALE' WHEN p_error IS NOT NULL OR jsonb_array_length(p_candidates)=0 THEN 'FAILED' ELSE 'REVIEW' END,
 candidates=CASE WHEN valid AND p_error IS NULL THEN p_candidates ELSE '[]'::jsonb END,error_code=CASE WHEN p_error IS NOT NULL THEN p_error WHEN jsonb_array_length(p_candidates)=0 THEN 'NO_MATCH' END,finished_at=now() WHERE id=j.id;
END $$;

CREATE FUNCTION public.confirm_energy_map_geocoding(p_org text,p_actor text,p_unit text,p_job uuid,p_index integer,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.energy_map_geocoding_jobs;c jsonb;result jsonb;payload jsonb;
BEGIN
 PERFORM public.assert_energy_map_actor(p_org,p_actor,true);
 -- Use same parent-first lock order as manual confirmation and provider completion.
 PERFORM 1 FROM public.consumer_units WHERE organization_id=p_org AND id=p_unit FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='P3162';END IF;
 SELECT * INTO j FROM public.energy_map_geocoding_jobs WHERE id=p_job AND organization_id=p_org AND consumer_unit_id=p_unit FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='P3162';END IF;
 IF p_index IS NULL OR p_data IS NULL OR p_index NOT BETWEEN 0 AND 4 OR p_index>=jsonb_array_length(j.candidates) OR j.status NOT IN ('REVIEW','CONFIRMED') OR jsonb_typeof(p_data)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_data))<>5 OR NOT p_data ?& ARRAY['reason','revision','requestId','checkedAddress','addressHash'] THEN RAISE EXCEPTION 'Invalid confirmation' USING ERRCODE='22023';END IF;
 IF p_data->>'addressHash'<>j.address_hash OR (p_data->>'revision')::integer<>j.location_revision THEN RAISE EXCEPTION 'Location changed' USING ERRCODE='P3161';END IF;
 c:=j.candidates->p_index;
 payload:=p_data||jsonb_build_object('latitude',c->'latitude','longitude',c->'longitude','precision',c->'precision','reason','Mapbox · '||COALESCE(p_data->>'reason',''));
 result:=public.save_energy_map_location(p_org,p_actor,p_unit,payload);
 UPDATE public.energy_map_geocoding_jobs SET status='CONFIRMED',confirmed_revision=(result->>'revision')::integer,confirmed_by=p_actor WHERE id=j.id;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.read_energy_map_geocoding(text,text,text),public.claim_energy_map_geocoding(text,text,text,text,integer,integer),public.finish_energy_map_geocoding(text,text,uuid,uuid,jsonb,text),public.confirm_energy_map_geocoding(text,text,text,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_energy_map_geocoding(text,text,text),public.claim_energy_map_geocoding(text,text,text,text,integer,integer),public.finish_energy_map_geocoding(text,text,uuid,uuid,jsonb,text),public.confirm_energy_map_geocoding(text,text,text,uuid,integer,jsonb) TO service_role;
COMMIT;
