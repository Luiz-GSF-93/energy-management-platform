BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.platform_cost_service_revisions(
 id uuid PRIMARY KEY,service_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<16000),
 actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(service_id,version),UNIQUE(id,service_id));
CREATE TABLE public.platform_cost_service_events(
 id uuid PRIMARY KEY,service_id uuid NOT NULL,revision_id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence>0),
 action text NOT NULL CHECK(action IN ('create','revise')),actor_id uuid NOT NULL,actor_name text NOT NULL,
 justification text NOT NULL CHECK(length(btrim(justification)) BETWEEN 20 AND 1000 AND justification !~ '[[:cntrl:]]'),
 input jsonb NOT NULL CHECK(octet_length(input::text)<18000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(service_id,sequence),FOREIGN KEY(revision_id,service_id) REFERENCES public.platform_cost_service_revisions(id,service_id));
CREATE FUNCTION public.platform_cost_service_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'Cost service history is immutable' USING ERRCODE='42501';END$$;
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_cost_service_revisions','platform_cost_service_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER platform_cost_service_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_cost_service_immutable()',t);
 END LOOP;
END$$;
CREATE FUNCTION public.platform_cost_service_action(p_actor uuid,p_action text,p_service uuid,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE profile text;rev public.platform_cost_service_revisions;old public.platform_cost_service_events;
 req uuid;service uuid;d jsonb;fields text[];x text;limit_size integer;pg integer;m date;result jsonb;version_no integer;expected uuid;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Financial actor required' USING ERRCODE='42501';END IF;
 SELECT t.profile INTO profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
 IF profile IS NULL OR profile NOT IN ('OWNER','FINANCE') THEN RAISE EXCEPTION 'Cost access denied' USING ERRCODE='42501';END IF;
 profile:=public.platform_workflow_actor(p_actor,CASE WHEN profile='OWNER' THEN 'e23a5c98-8b68-4ed2-aef8-70a7166407e4' ELSE '699703af-10ba-43a3-8eb8-9f0d9e477498' END);
 PERFORM 1 FROM public.user_roles ur JOIN public.roles rr ON rr.id=ur.role_id JOIN public.platform_team_members tm ON tm.user_id::text=ur.user_id::text WHERE ur.user_id::text=p_actor::text FOR SHARE OF ur,rr,tm;
 IF p_action IS NULL OR p_action NOT IN ('list','detail','create','revise') OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>18000 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023';END IF;
 IF p_action IN ('list','detail') THEN
  IF jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR p_body->>'page' !~ '^\d{1,4}$' OR (p_body->>'page')::integer>1000 OR jsonb_typeof(p_body->'month') IS DISTINCT FROM 'string' OR p_body->>'month' !~ '^(20|21)\d{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023';END IF;
  pg:=(p_body->>'page')::integer;m:=((p_body->>'month')||'-01')::date;
  IF p_action='detail' THEN
   IF p_service IS NULL OR p_body-ARRAY['page','month']<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid detail' USING ERRCODE='22023';END IF;
   SELECT * INTO rev FROM public.platform_cost_service_revisions WHERE service_id=p_service ORDER BY version DESC LIMIT 1;
   IF rev.id IS NULL THEN RAISE EXCEPTION 'Service unavailable' USING ERRCODE='22023';END IF;
   RETURN jsonb_build_object('id',p_service,'revisionId',rev.id,'version',rev.version,'definition',rev.definition,'month',p_body->>'month','canManage',profile='OWNER',
    'expenses',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY month DESC,id),'[]'::jsonb) FROM public.platform_infrastructure_costs c WHERE rev.definition->'expenseIds' ? c.id::text),
    'historyTotal',(SELECT count(*) FROM public.platform_cost_service_events WHERE service_id=p_service),
    'history',(SELECT coalesce(jsonb_agg(j ORDER BY sequence DESC),'[]'::jsonb) FROM(SELECT e.sequence,jsonb_build_object('id',e.id,'at',e.created_at,'actorId',e.actor_id,'actorName',e.actor_name,'justification',e.justification,'version',r.version,'definition',r.definition) j FROM public.platform_cost_service_events e JOIN public.platform_cost_service_revisions r ON r.id=e.revision_id WHERE e.service_id=p_service ORDER BY e.sequence DESC LIMIT 10 OFFSET pg*10)x));
  END IF;
  fields:=ARRAY['page','month','search','provider','category','environment','state','costSource'];
  IF p_service IS NOT NULL OR NOT p_body ?& fields OR p_body-fields<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  FOREACH x IN ARRAY fields[3:8] LOOP IF jsonb_typeof(p_body->x) IS DISTINCT FROM 'string' OR length(p_body->>x)>100 OR p_body->>x ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023';END IF;END LOOP;
  IF p_body->>'category' NOT IN ('','AI','OCR','STORAGE','DATABASE','SERVER','NETWORK','BACKUP','WEB','COMMUNICATIONS','SIGNATURE','PAYMENT','OTHER') OR p_body->>'environment' NOT IN ('','PRODUCTION','SANDBOX','SHARED','PLANNED') OR p_body->>'state' NOT IN ('','ACTIVE','PLANNED','DISABLED') OR p_body->>'costSource' NOT IN ('','TELEMETRY','PROVIDER_INVOICE','MANUAL_ESTIMATE','NOT_CONNECTED') THEN RAISE EXCEPTION 'Invalid filter enum' USING ERRCODE='22023';END IF;
  WITH latest AS(SELECT DISTINCT ON(service_id) * FROM public.platform_cost_service_revisions ORDER BY service_id,version DESC),filtered AS(SELECT * FROM latest r WHERE
   (p_body->>'search'='' OR strpos(lower(concat_ws(' ',r.definition->>'code',r.definition->>'name',r.definition->>'provider',r.definition->>'resourceReference')),lower(p_body->>'search'))>0)
   AND(p_body->>'provider'='' OR strpos(lower(r.definition->>'provider'),lower(p_body->>'provider'))>0)
   AND(p_body->>'category'='' OR r.definition->>'category'=p_body->>'category') AND(p_body->>'environment'='' OR r.definition->>'environment'=p_body->>'environment')
   AND(p_body->>'state'='' OR r.definition->>'state'=p_body->>'state') AND(p_body->>'costSource'='' OR r.definition->>'costSource'=p_body->>'costSource')),
   monetary AS(SELECT DISTINCT c.id,c.currency,c.basis,c.amount_minor FROM filtered r JOIN public.platform_infrastructure_costs c ON r.definition->'expenseIds' ? c.id::text WHERE c.month=m),
   grouped AS(SELECT currency,basis,sum(amount_minor)::text amount_minor,count(*) count FROM monetary GROUP BY currency,basis),
   paged AS(SELECT * FROM filtered ORDER BY lower(definition->>'name'),service_id LIMIT 25 OFFSET pg*25)
  SELECT jsonb_build_object('month',p_body->>'month','page',pg,'pageSize',25,'canManage',profile='OWNER','total',(SELECT count(*) FROM filtered),
   'subtotals',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY currency,basis) FROM grouped g),'[]'::jsonb),
   'unpriced',(SELECT count(*) FROM filtered r WHERE NOT EXISTS(SELECT 1 FROM public.platform_infrastructure_costs c WHERE c.month=m AND r.definition->'expenseIds' ? c.id::text)),
   'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.service_id,'revisionId',r.id,'version',r.version,'definition',r.definition,'cost',(SELECT to_jsonb(c) FROM public.platform_infrastructure_costs c WHERE c.month=m AND r.definition->'expenseIds' ? c.id::text)) ORDER BY lower(r.definition->>'name'),r.service_id) FROM paged r),'[]'::jsonb)) INTO result;
  RETURN result;
 END IF;
 IF profile<>'OWNER' THEN RAISE EXCEPTION 'Owner required for cost catalog changes' USING ERRCODE='42501';END IF;
 PERFORM public.platform_team_owner(p_actor);PERFORM public.platform_workflow_actor(p_actor,'af285642-16b0-405a-982c-58de1a10f987');
 fields:=ARRAY['requestId','expectedRevisionId','justification','definition'];
 IF NOT p_body ?& fields OR p_body-fields<>'{}'::jsonb OR jsonb_typeof(p_body->'requestId') IS DISTINCT FROM 'string' OR p_body->>'requestId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 1000 OR p_body->>'justification' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023';END IF;
 req:=(p_body->>'requestId')::uuid;service:=CASE WHEN p_action='create' THEN req ELSE p_service END;
 IF service IS NULL OR (p_action='create' AND(p_service IS NOT NULL OR p_body->'expectedRevisionId'<>'null'::jsonb)) OR(p_action='revise' AND(jsonb_typeof(p_body->'expectedRevisionId') IS DISTINCT FROM 'string' OR p_body->>'expectedRevisionId' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')) THEN RAISE EXCEPTION 'Invalid version' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('platform-cost-service-catalog',0));
 SELECT * INTO old FROM public.platform_cost_service_events WHERE id=req;
 IF old.id IS NOT NULL THEN IF old.actor_id<>p_actor OR old.input<>jsonb_build_object('action',p_action,'serviceId',p_service,'body',p_body) THEN RAISE EXCEPTION 'Conflicting retry' USING ERRCODE='23505';END IF;RETURN jsonb_build_object('id',old.service_id,'revisionId',old.revision_id,'replayed',true);END IF;
 SELECT * INTO rev FROM public.platform_cost_service_revisions WHERE service_id=service ORDER BY version DESC LIMIT 1;
 IF(p_action='create' AND rev.id IS NOT NULL) OR(p_action='revise' AND(rev.id IS NULL OR rev.id IS DISTINCT FROM(p_body->>'expectedRevisionId')::uuid)) THEN RAISE EXCEPTION 'Stale version' USING ERRCODE='23505';END IF;
 d:=p_body->'definition';fields:=ARRAY['code','name','provider','category','environment','state','costSource','resourceReference','sourceUrl','notes','checkedOn','budgetMinor','budgetCurrency','expenseIds'];
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR NOT d ?& fields OR d-fields<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid definition' USING ERRCODE='22023';END IF;
 FOREACH x IN ARRAY fields[1:10] LOOP
  IF jsonb_typeof(d->x) IS DISTINCT FROM 'string' OR d->>x ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid text' USING ERRCODE='22023';END IF;
  limit_size:=CASE x WHEN 'name' THEN 120 WHEN 'provider' THEN 80 WHEN 'code' THEN 80 WHEN 'resourceReference' THEN 800 WHEN 'sourceUrl' THEN 1024 WHEN 'notes' THEN 1000 ELSE 40 END;
  IF length(d->>x)>limit_size THEN RAISE EXCEPTION 'Oversize text' USING ERRCODE='22023';END IF;
 END LOOP;
 IF d->>'code' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(d->>'code')<3 OR length(btrim(d->>'name'))<3 OR length(btrim(d->>'provider'))<1 OR length(btrim(d->>'notes'))<20
 OR d->>'category' NOT IN ('AI','OCR','STORAGE','DATABASE','SERVER','NETWORK','BACKUP','WEB','COMMUNICATIONS','SIGNATURE','PAYMENT','OTHER') OR d->>'environment' NOT IN ('PRODUCTION','SANDBOX','SHARED','PLANNED') OR d->>'state' NOT IN ('ACTIVE','PLANNED','DISABLED') OR d->>'costSource' NOT IN ('TELEMETRY','PROVIDER_INVOICE','MANUAL_ESTIMATE','NOT_CONNECTED')
 OR(d->>'sourceUrl'<>'' AND d->>'sourceUrl' !~ '^https://[a-zA-Z0-9.-]+(:443)?(/[^?#@[:cntrl:]]*)?$') THEN RAISE EXCEPTION 'Invalid definition values' USING ERRCODE='22023';END IF;
 IF d->'checkedOn'<>'null'::jsonb THEN
  IF jsonb_typeof(d->'checkedOn') IS DISTINCT FROM 'string' OR d->>'checkedOn' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid check date' USING ERRCODE='22023';END IF;
  BEGIN IF to_char((d->>'checkedOn')::date,'YYYY-MM-DD')<>d->>'checkedOn' THEN RAISE EXCEPTION 'Invalid check date';END IF;EXCEPTION WHEN others THEN RAISE EXCEPTION 'Invalid check date' USING ERRCODE='22023';END;
 END IF;
 IF d->'budgetMinor'='null'::jsonb THEN IF d->'budgetCurrency'<>'null'::jsonb THEN RAISE EXCEPTION 'Budget currency without amount' USING ERRCODE='22023';END IF;
 ELSE IF jsonb_typeof(d->'budgetMinor') IS DISTINCT FROM 'number' OR d->>'budgetMinor' !~ '^\d{1,13}$' OR(d->>'budgetMinor')::numeric>1000000000000 OR coalesce(d->>'budgetCurrency','') NOT IN ('BRL','USD') THEN RAISE EXCEPTION 'Invalid budget' USING ERRCODE='22023';END IF;END IF;
 IF jsonb_typeof(d->'expenseIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid ledger selection' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(d->'expenseIds')>24 OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'expenseIds') z WHERE jsonb_typeof(z) IS DISTINCT FROM 'string' OR z#>>'{}' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') OR(SELECT count(*) FROM jsonb_array_elements(d->'expenseIds'))<>(SELECT count(DISTINCT z#>>'{}') FROM jsonb_array_elements(d->'expenseIds') z) THEN RAISE EXCEPTION 'Invalid ledger identifiers' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'expenseIds') z WHERE NOT EXISTS(SELECT 1 FROM public.platform_infrastructure_costs c WHERE c.id=z::uuid))
 OR EXISTS(SELECT 1 FROM public.platform_infrastructure_costs c WHERE d->'expenseIds' ? c.id::text GROUP BY month HAVING count(*)>1) THEN RAISE EXCEPTION 'Select one reviewed ledger record per month' USING ERRCODE='22023';END IF;
 IF p_action='revise' AND d->>'code'<>rev.definition->>'code' THEN RAISE EXCEPTION 'Stable service code required' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM(SELECT DISTINCT ON(service_id)* FROM public.platform_cost_service_revisions ORDER BY service_id,version DESC) r WHERE r.service_id<>service AND(r.definition->>'code'=d->>'code' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'expenseIds') z WHERE r.definition->'expenseIds' ? z))) THEN RAISE EXCEPTION 'Code or ledger record already registered' USING ERRCODE='23505';END IF;
 version_no:=coalesce(rev.version,0)+1;
 INSERT INTO public.platform_cost_service_revisions(id,service_id,version,definition,actor_id) VALUES(req,service,version_no,d,p_actor);
 INSERT INTO public.platform_cost_service_events(id,service_id,revision_id,sequence,action,actor_id,actor_name,justification,input) VALUES(req,service,req,version_no,p_action,p_actor,public.platform_workflow_name(p_actor),btrim(p_body->>'justification'),jsonb_build_object('action',p_action,'serviceId',p_service,'body',p_body));
 RETURN jsonb_build_object('id',service,'revisionId',req,'version',version_no,'replayed',false);
END$$;
CREATE INDEX platform_cost_service_latest ON public.platform_cost_service_revisions(service_id,version DESC);
REVOKE ALL ON FUNCTION public.platform_cost_service_action(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.platform_cost_service_action(uuid,text,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.platform_cost_service_immutable() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
