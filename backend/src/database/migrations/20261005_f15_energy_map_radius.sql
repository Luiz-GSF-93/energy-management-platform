BEGIN;
-- Pure geodesic helper; private to database functions. No location is sent to an external service.
CREATE FUNCTION public.energy_map_distance_km(a_lat double precision,a_lng double precision,b_lat double precision,b_lng double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT 12742.0 * asin(sqrt(least(1.0,greatest(0.0,power(sin(radians(b_lat-a_lat)/2.0),2)+cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians(b_lng-a_lng)/2.0),2)))))
$$;
REVOKE ALL ON FUNCTION public.energy_map_distance_km(double precision,double precision,double precision,double precision) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.assert_energy_map_radius(q jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE parts integer;
BEGIN
 IF q IS NULL OR jsonb_typeof(q)<>'object' THEN RAISE EXCEPTION 'Invalid map query' USING ERRCODE='22023';END IF;
 parts:=num_nonnulls(q->>'radiusLatitude',q->>'radiusLongitude',q->>'radiusKm');
 IF parts=0 THEN RETURN;END IF;
 IF parts<>3 OR (q->>'radiusLatitude')!~'^-?[0-9]{1,3}(\.[0-9]{1,7})?$' OR (q->>'radiusLongitude')!~'^-?[0-9]{1,3}(\.[0-9]{1,7})?$' OR (q->>'radiusKm')!~'^[0-9]{1,3}(\.[0-9]{1,3})?$' THEN RAISE EXCEPTION 'Invalid radius' USING ERRCODE='22023';END IF;
 IF (q->>'radiusLatitude')::double precision NOT BETWEEN -90 AND 90 OR (q->>'radiusLongitude')::double precision NOT BETWEEN -180 AND 180 OR (q->>'radiusKm')::double precision NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Radius outside bounds' USING ERRCODE='22023';END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_energy_map_radius(jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Patch only the existing guarded read functions; preserve actor/tenant/license checks and grants.
DO $patch$
DECLARE signature text;definition text;needle text;replacement text;units_expr text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.read_energy_map_units(text,text,jsonb)','public.read_platform_energy_map(uuid,jsonb)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF signature LIKE '%read_energy_map_units%' THEN
   needle:='WHERE u.organization_id=p_org';
   IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Map tenant predicate changed';END IF;
   definition:=replace(definition,needle,needle||' AND to_jsonb(u)->>''deleted_at'' IS NULL');
  END IF;
  needle:=' take:=COALESCE';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Map read validation changed';END IF;
  definition:=replace(definition,needle,E' PERFORM public.assert_energy_map_radius(p_query);\n'||needle);
  needle:=' ), page AS (';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Map filter definition changed';END IF;
  replacement:=$radius$
   AND (p_query->>'radiusKm' IS NULL OR (s.location_status='CONFIRMED' AND public.energy_map_distance_km((p_query->>'radiusLatitude')::double precision,(p_query->>'radiusLongitude')::double precision,s.latitude,s.longitude)<=(p_query->>'radiusKm')::double precision))
 ), page AS ($radius$;
  definition:=replace(definition,needle,replacement);
  needle:='''precision'',precision,''updatedAt'',updated_at';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Map projection changed';END IF;
  definition:=replace(definition,needle,needle||$distance$,
   'distanceKm',CASE WHEN location_status='CONFIRMED' AND p_query->>'radiusKm' IS NOT NULL THEN round(public.energy_map_distance_km((p_query->>'radiusLatitude')::double precision,(p_query->>'radiusLongitude')::double precision,latitude,longitude)::numeric,3) END$distance$);
  units_expr:=CASE WHEN signature LIKE '%read_platform%' THEN 'count(unit_id)' ELSE 'count(*)' END;
  needle:='''offset'',skip,''limit'',take,';
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Map summary changed';END IF;
  replacement:=$summary$
  'radius',CASE WHEN p_query->>'radiusKm' IS NULL THEN NULL ELSE jsonb_build_object('latitude',(p_query->>'radiusLatitude')::double precision,'longitude',(p_query->>'radiusLongitude')::double precision,'km',(p_query->>'radiusKm')::double precision,'method','HAVERSINE_6371_V1') END,
  'territory',jsonb_build_object('coverage','FULL_FILTER','method','PORTFOLIO_COUNTS_V1',
   'states',COALESCE((SELECT jsonb_agg(v ORDER BY v->>'label') FROM (SELECT jsonb_build_object('label',COALESCE(NULLIF(upper(trim(state)),''),'Não informado'),'units',%UNITS%,'customers',count(DISTINCT (organization_id,customer_id)),'confirmed',count(*) FILTER(WHERE location_status='CONFIRMED')) v FROM filtered GROUP BY COALESCE(NULLIF(upper(trim(state)),''),'Não informado')) x),'[]'::jsonb),
   'distributors',COALESCE((SELECT jsonb_agg(v ORDER BY (v->>'units')::bigint DESC,v->>'label') FROM (SELECT jsonb_build_object('label',COALESCE(NULLIF(trim(distributor),''),'Não informada'),'units',%UNITS%,'customers',count(DISTINCT (organization_id,customer_id)),'confirmed',count(*) FILTER(WHERE location_status='CONFIRMED')) v FROM filtered GROUP BY COALESCE(NULLIF(trim(distributor),''),'Não informada') ORDER BY %UNITS% DESC,COALESCE(NULLIF(trim(distributor),''),'Não informada') LIMIT 20) x),'[]'::jsonb),
   'distributorGroups',(SELECT count(*) FROM (SELECT DISTINCT COALESCE(NULLIF(trim(distributor),''),'Não informada') FROM filtered) x),
   'profiles',COALESCE((SELECT jsonb_agg(v ORDER BY v->>'label') FROM (SELECT jsonb_build_object('label',market||' · GD '||CASE WHEN has_gd IS TRUE THEN 'sim' WHEN has_gd IS FALSE THEN 'não' ELSE '?' END||' · BESS '||CASE WHEN has_bess IS TRUE THEN 'sim' WHEN has_bess IS FALSE THEN 'não' ELSE '?' END,'units',%UNITS%,'customers',count(DISTINCT (organization_id,customer_id)),'confirmed',count(*) FILTER(WHERE location_status='CONFIRMED')) v FROM filtered GROUP BY market,has_gd,has_bess) x),'[]'::jsonb)),
  'offset',skip,'limit',take,$summary$;
  replacement:=replace(replacement,'%UNITS%',units_expr);
  definition:=replace(definition,needle,replacement);
  EXECUTE definition;
 END LOOP;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
