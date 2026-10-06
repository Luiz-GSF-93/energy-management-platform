BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
ALTER TABLE public.consumer_units ADD COLUMN has_gd boolean,ADD COLUMN has_bess boolean;
-- Extend only the current registration audit allow-list, preserving deployed fixes.
DO $patch$
DECLARE definition text;needle text;replacement text;guard text;
BEGIN
 definition:=pg_get_functiondef('public.edit_registration(text,text,text,text,text,integer,uuid,jsonb)'::regprocedure);
 needle:='''free_market'',''last_demand_adjustment_date''] END;';
 replacement:='''free_market'',''last_demand_adjustment_date'',''has_gd'',''has_bess''] END;';
 IF strpos(definition,needle)=0 OR (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Registration definition changed; review migration before applying';END IF;
 definition:=replace(definition,needle,replacement);
 guard:=' IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) x WHERE NOT x=ANY(allowed))';
 IF strpos(definition,guard)=0 THEN RAISE EXCEPTION 'Registration validation changed';END IF;
 definition:=replace(definition,guard,$validation$
 IF p_kind='consumer_units' AND EXISTS(SELECT 1 FROM jsonb_each(p_changes) field WHERE field.key IN ('has_gd','has_bess') AND jsonb_typeof(field.value) NOT IN ('boolean','null')) THEN RAISE EXCEPTION 'Invalid GD/BESS classification' USING ERRCODE='22023';END IF;
$validation$||guard);
 EXECUTE definition;
END $patch$;
CREATE OR REPLACE FUNCTION public.read_energy_map_units(p_org text,p_actor text,p_query jsonb) RETURNS jsonb
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
   u.has_gd,u.has_bess,
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
   AND (p_query->>'bess' IS NULL OR (p_query->>'bess'='YES' AND s.has_bess IS TRUE) OR (p_query->>'bess'='NO' AND s.has_bess IS FALSE) OR (p_query->>'bess'='UNKNOWN' AND s.has_bess IS NULL))
   AND (p_query->>'gd' IS NULL OR (p_query->>'gd'='YES' AND s.has_gd IS TRUE) OR (p_query->>'gd'='NO' AND s.has_gd IS FALSE) OR (p_query->>'gd'='UNKNOWN' AND s.has_gd IS NULL))
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
   'name',name,'number',consumer_unit_number,'address',address,'city',city,'state',state,'distributor',distributor,'status',status,'market',market,'hasGd',has_gd,'hasBess',has_bess,
   'addressHash',fingerprint,'revision',COALESCE(revision,0),'locationStatus',location_status,
   'latitude',CASE WHEN location_status='CONFIRMED' THEN latitude END,'longitude',CASE WHEN location_status='CONFIRMED' THEN longitude END,
   'precision',precision,'updatedAt',updated_at) ORDER BY customer_name,id) FROM page),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.read_platform_energy_map(p_actor uuid,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;take integer;skip integer;
BEGIN
 IF p_actor IS NULL OR (SELECT count(*) FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id::text=p_actor::text AND r.scope='global')<>1
 OR NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id::text=p_actor::text AND r.name='admin_platform' AND r.scope='global' AND r.permissions ? '9a679254-bb1a-4353-9d17-cc2bd9eb5abd')
 THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501';END IF;
 take:=COALESCE((p_query->>'limit')::integer,200);skip:=COALESCE((p_query->>'offset')::integer,0);
 IF take NOT BETWEEN 1 AND 500 OR skip NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
 WITH inventory AS (
  SELECT COALESCE(u.id,'customer:'||c.id) AS id,u.id AS unit_id,o.id AS organization_id,o.name AS organization_name,
   c.id AS customer_id,COALESCE(c.trade_name,c.company_name) AS customer_name,c.economic_group,
   u.name,u.consumer_unit_number,u.address,u.city,u.state,u.distributor,u.status,
   CASE WHEN u.free_market IS TRUE THEN 'ACL' WHEN u.free_market IS FALSE THEN 'ACR' ELSE 'UNKNOWN' END AS market,
   u.has_gd,u.has_bess,
   l.latitude,l.longitude,l.precision,l.updated_at,
   CASE WHEN u.id IS NULL THEN 'NO_UNIT' WHEN l.consumer_unit_id IS NULL THEN 'PENDING' WHEN l.address_hash<>public.energy_map_address_hash(u) OR l.customer_id<>u.customer_id THEN 'STALE' ELSE 'CONFIRMED' END AS location_status
  FROM public.organizations o JOIN public.customers c ON c.organization_id=o.id AND c.deleted_at IS NULL
  LEFT JOIN public.consumer_units u ON u.customer_id=c.id AND u.organization_id=c.organization_id AND to_jsonb(u)->>'deleted_at' IS NULL
  LEFT JOIN public.consumer_unit_locations l ON l.consumer_unit_id=u.id AND l.organization_id=o.id
  WHERE o.deleted_at IS NULL
 ), filtered AS (
  SELECT * FROM inventory s WHERE
   (p_query->>'search' IS NULL OR strpos(lower(concat_ws(' ',s.name,s.consumer_unit_number,s.customer_name,s.city,s.distributor,s.economic_group,s.organization_name)),lower(p_query->>'search'))>0)
   AND (p_query->>'organizationId' IS NULL OR s.organization_id=p_query->>'organizationId')
   AND (p_query->>'state' IS NULL OR upper(s.state)=upper(p_query->>'state'))
   AND (p_query->>'bess' IS NULL OR (p_query->>'bess'='YES' AND s.has_bess IS TRUE) OR (p_query->>'bess'='NO' AND s.has_bess IS FALSE) OR (p_query->>'bess'='UNKNOWN' AND s.has_bess IS NULL))
   AND (p_query->>'gd' IS NULL OR (p_query->>'gd'='YES' AND s.has_gd IS TRUE) OR (p_query->>'gd'='NO' AND s.has_gd IS FALSE) OR (p_query->>'gd'='UNKNOWN' AND s.has_gd IS NULL))
   AND (p_query->>'market' IS NULL OR s.market=p_query->>'market')
   AND (p_query->>'location' IS NULL OR s.location_status=p_query->>'location')
 ), page AS (SELECT * FROM filtered ORDER BY organization_name,customer_name,id LIMIT take OFFSET skip)
 SELECT jsonb_build_object('scope','global','total',(SELECT count(*) FROM filtered),
  'customers',(SELECT count(DISTINCT customer_id) FROM filtered),'organizations',(SELECT count(DISTINCT organization_id) FROM filtered),
  'units',(SELECT count(unit_id) FROM filtered),'withoutUnits',(SELECT count(*) FROM filtered WHERE unit_id IS NULL),
  'confirmed',(SELECT count(*) FROM filtered WHERE location_status='CONFIRMED'),'pending',(SELECT count(*) FROM filtered WHERE location_status IN ('PENDING','STALE')),
  'offset',skip,'limit',take,
  'organizationOptions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) ORDER BY o.name,o.id) FROM public.organizations o WHERE o.deleted_at IS NULL),'[]'::jsonb),
  'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'hasUnit',unit_id IS NOT NULL,'organizationId',organization_id,'organizationName',organization_name,
   'customerId',customer_id,'customerName',customer_name,'group',economic_group,'name',name,'number',consumer_unit_number,
   'address',address,'city',city,'state',state,'distributor',distributor,'market',market,'status',status,'hasGd',has_gd,'hasBess',has_bess,'locationStatus',location_status,
   'latitude',CASE WHEN location_status='CONFIRMED' THEN latitude END,'longitude',CASE WHEN location_status='CONFIRMED' THEN longitude END,
   'precision',precision,'updatedAt',updated_at) ORDER BY organization_name,customer_name,id) FROM page),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
