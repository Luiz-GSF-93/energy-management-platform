BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Private operational locations. No backfill, geocoding, or public client layer.
CREATE TABLE public.consumer_unit_locations (
 organization_id text NOT NULL REFERENCES public.organizations(id),
 consumer_unit_id text PRIMARY KEY REFERENCES public.consumer_units(id),
 customer_id text NOT NULL REFERENCES public.customers(id),
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 precision text NOT NULL CHECK(precision IN ('ADDRESS','STREET','POSTCODE','CITY')),
 address_hash text NOT NULL CHECK(length(address_hash)=32),
 revision integer NOT NULL CHECK(revision>0),
 updated_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(latitude<>0 OR longitude<>0),UNIQUE(organization_id,consumer_unit_id)
);
CREATE TABLE public.consumer_unit_location_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,
 consumer_unit_id text NOT NULL,revision integer NOT NULL,
 request_id uuid NOT NULL,actor_id text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 location jsonb NOT NULL,request jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_id),UNIQUE(consumer_unit_id,revision),
 FOREIGN KEY(organization_id,consumer_unit_id) REFERENCES public.consumer_unit_locations(organization_id,consumer_unit_id)
);
ALTER TABLE public.consumer_unit_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumer_unit_location_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consumer_unit_locations,public.consumer_unit_location_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.consumer_unit_locations,public.consumer_unit_location_history TO service_role;

CREATE FUNCTION public.reject_energy_map_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Location history is immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER energy_map_history_immutable BEFORE UPDATE OR DELETE ON public.consumer_unit_location_history FOR EACH ROW EXECUTE FUNCTION public.reject_energy_map_history_change();
REVOKE ALL ON FUNCTION public.reject_energy_map_history_change() FROM PUBLIC,anon,authenticated,service_role;

-- MD5 is a change fingerprint, not an authentication secret or security hash.
CREATE FUNCTION public.energy_map_address_hash(u public.consumer_units) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT md5(jsonb_build_array(u.organization_id,u.customer_id,u.address,u.city,u.state)::text)
$$;

CREATE FUNCTION public.assert_energy_map_actor(p_org text,p_actor text,p_write boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE role_name text;perms jsonb;
BEGIN
 IF (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE))<>1
 OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'Active organization and license required' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN
  PERFORM public.assert_license_platform_actor(p_actor::uuid);RETURN;
 END IF;
 SELECT r.name,r.permissions INTO role_name,perms FROM public.organization_members m JOIN public.roles r
 ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE';
 IF role_name IS NULL OR role_name NOT IN ('admin_org','gestor','operacional')
 OR NOT COALESCE(perms ? 'b142bd7b-05a3-45ee-befd-e593066c2775',false)
 OR NOT COALESCE(perms ? 'cbb2e904-0718-4eec-9396-dba899118cdd',false)
 OR (p_write AND NOT COALESCE(perms ? '0f2e539d-03f9-4168-bc8c-55ac3a371628',false))
 THEN RAISE EXCEPTION 'Backoffice access required' USING ERRCODE='42501';END IF;
END $$;

CREATE FUNCTION public.save_energy_map_location(p_org text,p_actor text,p_unit text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.consumer_units;l public.consumer_unit_locations;h public.consumer_unit_location_history;
 lat double precision;lng double precision;expected integer;req uuid;fingerprint text;
BEGIN
 PERFORM public.assert_energy_map_actor(p_org,p_actor,true);
 IF jsonb_typeof(p_data)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_data))<>8
 OR NOT p_data ?& ARRAY['latitude','longitude','precision','reason','revision','requestId','checkedAddress','addressHash']
 OR jsonb_typeof(p_data->'latitude')<>'number' OR jsonb_typeof(p_data->'longitude')<>'number'
 OR jsonb_typeof(p_data->'revision')<>'number' OR p_data->>'revision' !~ '^[0-9]{1,9}$'
 OR p_data->'checkedAddress' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(p_data->'reason')<>'string' OR length(btrim(p_data->>'reason')) NOT BETWEEN 3 AND 500
 OR p_data->>'precision' NOT IN ('ADDRESS','STREET','POSTCODE','CITY')
 OR p_data->>'addressHash' !~ '^[a-f0-9]{32}$'
 THEN RAISE EXCEPTION 'Invalid location' USING ERRCODE='22023';END IF;
 lat:=(p_data->>'latitude')::double precision;lng:=(p_data->>'longitude')::double precision;
 expected:=(p_data->>'revision')::integer;req:=(p_data->>'requestId')::uuid;
 IF NOT(lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180) OR (lat=0 AND lng=0) THEN RAISE EXCEPTION 'Invalid coordinates' USING ERRCODE='22023';END IF;
 -- Lock the parent first: registration/address changes cannot race a confirmation.
 SELECT * INTO u FROM public.consumer_units WHERE organization_id=p_org AND id=p_unit FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='P3162';END IF;
 PERFORM 1 FROM public.customers WHERE id=u.customer_id AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='P3162';END IF;
 SELECT * INTO h FROM public.consumer_unit_location_history WHERE organization_id=p_org AND request_id=req;
 IF FOUND THEN
  IF h.consumer_unit_id<>p_unit OR h.actor_id<>p_actor OR h.request<>p_data THEN RAISE EXCEPTION 'Request already used' USING ERRCODE='P3161';END IF;
  RETURN h.location;
 END IF;
 SELECT * INTO l FROM public.consumer_unit_locations WHERE consumer_unit_id=p_unit AND organization_id=p_org FOR UPDATE;
 fingerprint:=public.energy_map_address_hash(u);
 IF COALESCE(l.revision,0)<>expected OR fingerprint<>p_data->>'addressHash' THEN RAISE EXCEPTION 'Location or address changed' USING ERRCODE='P3161';END IF;
 INSERT INTO public.consumer_unit_locations(organization_id,consumer_unit_id,customer_id,latitude,longitude,precision,address_hash,revision,updated_by)
 VALUES(p_org,p_unit,u.customer_id,lat,lng,p_data->>'precision',fingerprint,expected+1,p_actor)
 ON CONFLICT(consumer_unit_id) DO UPDATE SET customer_id=excluded.customer_id,latitude=excluded.latitude,longitude=excluded.longitude,precision=excluded.precision,address_hash=excluded.address_hash,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now()
 WHERE consumer_unit_locations.organization_id=p_org RETURNING * INTO l;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='P3162';END IF;
 INSERT INTO public.consumer_unit_location_history(organization_id,consumer_unit_id,revision,request_id,actor_id,reason,location,request)
 VALUES(p_org,p_unit,l.revision,req,p_actor,btrim(p_data->>'reason'),to_jsonb(l),p_data);
 RETURN to_jsonb(l);
END $$;

CREATE FUNCTION public.read_energy_map_units(p_org text,p_actor text,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;take integer;skip integer;
BEGIN
 PERFORM public.assert_energy_map_actor(p_org,p_actor,false);
 take:=COALESCE((p_query->>'limit')::integer,200);skip:=COALESCE((p_query->>'offset')::integer,0);
 IF take NOT BETWEEN 1 AND 500 OR skip NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 WITH scoped AS (
  SELECT u.id,u.organization_id,u.customer_id,u.name,u.consumer_unit_number,u.address,u.city,u.state,u.distributor,u.status,
   COALESCE(c.trade_name,c.company_name) AS customer_name,c.economic_group,
   CASE WHEN u.free_market IS TRUE THEN 'ACL' WHEN u.free_market IS FALSE THEN 'ACR' ELSE 'UNKNOWN' END AS market,
   public.energy_map_address_hash(u) AS fingerprint,l.revision,l.latitude,l.longitude,l.precision,l.updated_at,
   CASE WHEN l.consumer_unit_id IS NULL THEN 'PENDING' WHEN l.address_hash<>public.energy_map_address_hash(u) OR l.customer_id<>u.customer_id THEN 'STALE' ELSE 'CONFIRMED' END AS location_status
  FROM public.consumer_units u JOIN public.customers c ON c.id=u.customer_id AND c.organization_id=u.organization_id AND c.deleted_at IS NULL
  LEFT JOIN public.consumer_unit_locations l ON l.consumer_unit_id=u.id AND l.organization_id=u.organization_id
  WHERE u.organization_id=p_org
 ), filtered AS (
  SELECT * FROM scoped s WHERE
   (p_query->>'search' IS NULL OR strpos(lower(concat_ws(' ',s.name,s.consumer_unit_number,s.customer_name,s.city,s.distributor,s.economic_group)),lower(p_query->>'search'))>0)
   AND (p_query->>'state' IS NULL OR upper(s.state)=upper(p_query->>'state'))
   AND (p_query->>'city' IS NULL OR lower(s.city)=lower(p_query->>'city'))
   AND (p_query->>'distributor' IS NULL OR s.distributor=p_query->>'distributor')
   AND (p_query->>'customerId' IS NULL OR s.customer_id=p_query->>'customerId')
   AND (p_query->>'market' IS NULL OR s.market=p_query->>'market')
   AND (p_query->>'location' IS NULL OR s.location_status=p_query->>'location')
   AND (p_query->>'status' IS NULL OR s.status=p_query->>'status')
 ), page AS (
  SELECT * FROM filtered ORDER BY customer_name,id LIMIT take OFFSET skip
 ) SELECT jsonb_build_object(
  'total',(SELECT count(*) FROM filtered),'customers',(SELECT count(DISTINCT customer_id) FROM filtered),
  'confirmed',(SELECT count(*) FROM filtered WHERE location_status='CONFIRMED'),
  'pending',(SELECT count(*) FROM filtered WHERE location_status='PENDING'),
  'stale',(SELECT count(*) FROM filtered WHERE location_status='STALE'),
  'offset',skip,'limit',take,
  'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'organizationId',organization_id,'customerId',customer_id,'customerName',customer_name,'group',economic_group,
   'name',name,'number',consumer_unit_number,'address',address,'city',city,'state',state,'distributor',distributor,'status',status,'market',market,
   'addressHash',fingerprint,'revision',COALESCE(revision,0),'locationStatus',location_status,
   'latitude',CASE WHEN location_status='CONFIRMED' THEN latitude END,'longitude',CASE WHEN location_status='CONFIRMED' THEN longitude END,
   'precision',precision,'updatedAt',updated_at) ORDER BY customer_name,id) FROM page),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.energy_map_address_hash(public.consumer_units),public.assert_energy_map_actor(text,text,boolean),public.read_energy_map_units(text,text,jsonb),public.save_energy_map_location(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_energy_map_actor(text,text,boolean),public.read_energy_map_units(text,text,jsonb),public.save_energy_map_location(text,text,text,jsonb) TO service_role;
COMMIT;
