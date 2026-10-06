BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Preserve old API during rolling deployment. Existing paid jobs are never requeued.
ALTER TABLE public.energy_map_geocoding_jobs DROP CONSTRAINT energy_map_geocoding_jobs_status_check;
ALTER TABLE public.energy_map_geocoding_jobs ADD CONSTRAINT energy_map_geocoding_jobs_status_check
 CHECK(status IN ('QUEUED','PROCESSING','REVIEW','FAILED','STALE','CONFIRMED'));
CREATE INDEX energy_map_geocoding_queued ON public.energy_map_geocoding_jobs(created_at) WHERE status='QUEUED';
CREATE FUNCTION public.enqueue_energy_map_geocoding(p_org text,p_actor text,p_unit text,p_hash text,p_daily integer,p_monthly integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.consumer_units;j public.energy_map_geocoding_jobs;rev integer;
BEGIN
 PERFORM public.assert_energy_map_actor(p_org,p_actor,true);
 IF p_daily IS DISTINCT FROM 10 OR p_monthly IS DISTINCT FROM 100 OR p_hash !~ '^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'Invalid limits' USING ERRCODE='22023';END IF;
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
 VALUES(p_org,p_unit,u.customer_id,p_hash,rev,'QUEUED',p_actor) RETURNING * INTO j;
 RETURN jsonb_build_object('dispatch',false,'jobId',j.id);
END $$;


CREATE FUNCTION public.dispatch_energy_map_geocoding(p_orgs text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate public.energy_map_geocoding_jobs;j public.energy_map_geocoding_jobs;u public.consumer_units;
BEGIN
 IF p_orgs IS NULL OR cardinality(p_orgs) NOT BETWEEN 1 AND 100 OR array_position(p_orgs,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Invalid pilot scope' USING ERRCODE='22023'; END IF;
 -- Shared admission lock gives one atomic dispatch across replicas. No network in transaction.
 PERFORM pg_advisory_xact_lock(31610,1);
 FOR candidate IN SELECT * FROM public.energy_map_geocoding_jobs WHERE status='QUEUED'
  AND organization_id=ANY(p_orgs) ORDER BY created_at,id LIMIT 20 LOOP
  -- Parent-first order also used by location confirmation and provider completion.
  SELECT * INTO u FROM public.consumer_units WHERE organization_id=candidate.organization_id
   AND id=candidate.consumer_unit_id FOR UPDATE;
  SELECT * INTO j FROM public.energy_map_geocoding_jobs WHERE id=candidate.id AND status='QUEUED' FOR UPDATE;
  IF NOT FOUND THEN CONTINUE; END IF;
  IF u.id IS NULL OR u.customer_id IS DISTINCT FROM j.customer_id
   OR NOT EXISTS(SELECT 1 FROM public.customers WHERE organization_id=j.organization_id AND id=j.customer_id AND deleted_at IS NULL)
   OR public.energy_map_address_hash(u) IS DISTINCT FROM j.address_hash
   OR COALESCE((SELECT revision FROM public.consumer_unit_locations WHERE organization_id=j.organization_id AND consumer_unit_id=u.id),0)<>j.location_revision THEN
   UPDATE public.energy_map_geocoding_jobs SET status='STALE',finished_at=now(),error_code='ADDRESS_CHANGED' WHERE id=j.id;
   CONTINUE;
  END IF;
  BEGIN
   PERFORM public.assert_energy_map_actor(j.organization_id,j.requested_by,true);
  EXCEPTION WHEN insufficient_privilege THEN
   UPDATE public.energy_map_geocoding_jobs SET status='FAILED',finished_at=now(),error_code='ACCESS_REVOKED' WHERE id=j.id;
   CONTINUE;
  END;
  -- A request cannot survive for days and silently trigger a later paid call.
  IF j.created_at<now()-interval '24 hours' THEN
   UPDATE public.energy_map_geocoding_jobs SET status='FAILED',finished_at=now(),error_code='QUEUE_EXPIRED' WHERE id=j.id;
   CONTINUE;
  END IF;
  -- Commit PROCESSING before contacting provider; uncertainty must never cause automatic redispatch.
  UPDATE public.energy_map_geocoding_jobs SET status='PROCESSING',lease_id=gen_random_uuid(),lease_until=now()+interval '30 seconds'
   WHERE id=j.id RETURNING * INTO j;
  RETURN jsonb_build_object('jobId',j.id,'leaseId',j.lease_id,'organizationId',j.organization_id,'actorId',j.requested_by,
   'address',jsonb_build_object('address',u.address,'city',u.city,'state',upper(btrim(u.state))));
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_energy_map_geocoding(text,text,text,text,integer,integer),public.dispatch_energy_map_geocoding(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_energy_map_geocoding(text,text,text,text,integer,integer),public.dispatch_energy_map_geocoding(text[]) TO service_role;
COMMIT;
