BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s';
SET LOCAL check_function_bodies=false;
CREATE SCHEMA portal_scope;
REVOKE ALL ON SCHEMA portal_scope FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE portal_scope.routines(original_oid oid PRIMARY KEY,original_name text NOT NULL,source_hash text NOT NULL,root boolean NOT NULL);
ALTER TABLE portal_scope.routines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_scope.routines FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION portal_scope.function_signature(fn oid) RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$SELECT md5(jsonb_build_array(p.prosrc,p.proargtypes::text,p.proallargtypes,p.prorettype,p.proargnames,p.proargmodes,p.pronargdefaults,p.proargdefaults::text,p.prosecdef,p.proconfig,p.provolatile,p.prokind)::text) FROM pg_proc p WHERE p.oid=fn$$;
CREATE FUNCTION portal_scope.context() RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$SELECT nullif(current_setting('energyos.portal_scope',true),'')::jsonb$$;
CREATE FUNCTION portal_scope.member_customer(org text,actor text,legacy text) RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN portal_scope.context()->>'organizationId'=org AND portal_scope.context()->>'userId'=actor THEN portal_scope.context()->>'customerId' ELSE legacy END
$$;
CREATE FUNCTION portal_scope.row_allowed(org text,customer text,unit text,has_customer boolean,has_unit boolean,pending boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE s jsonb:=portal_scope.context();
BEGIN
 IF s IS NULL THEN RETURN true;END IF;
 IF org IS NOT NULL AND org IS DISTINCT FROM s->>'organizationId' THEN RETURN false;END IF;
 IF has_customer AND customer IS DISTINCT FROM s->>'customerId' THEN RETURN false;END IF;
 IF has_unit THEN RETURN CASE WHEN unit IS NOT NULL THEN (s->'unitIds') ? unit ELSE pending OR coalesce((s->>'allUnits')::boolean,false) END;END IF;
 RETURN true;
END$$;
CREATE FUNCTION portal_scope.notice_allowed(notice uuid) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE s jsonb:=portal_scope.context();n public.portal_notification_outbox;unit text;items jsonb;
BEGIN
 IF s IS NULL THEN RETURN true;END IF;
 SELECT * INTO n FROM public.portal_notification_outbox WHERE id=notice;
 IF NOT FOUND OR n.organization_id IS DISTINCT FROM s->>'organizationId' OR n.customer_id IS DISTINCT FROM s->>'customerId' OR n.recipient_id IS DISTINCT FROM s->>'userId' THEN RETURN false;END IF;
 IF coalesce((s->>'allUnits')::boolean,false) THEN RETURN true;END IF;
 IF n.document_id IS NOT NULL THEN SELECT consumer_unit_id INTO unit FROM public.documents WHERE id=n.document_id AND organization_id=n.organization_id AND customer_id=n.customer_id;RETURN unit IS NOT NULL AND (s->'unitIds') ? unit;END IF;
 IF n.record_id IS NOT NULL THEN SELECT consumer_unit_id INTO unit FROM public.operation_records WHERE id=n.record_id AND organization_id=n.organization_id AND customer_id=n.customer_id;RETURN unit IS NOT NULL AND (s->'unitIds') ? unit;END IF;
 IF split_part(n.event_key,':',2) !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN RETURN false;END IF;
 IF n.event_key LIKE 'publication:%' THEN SELECT projection#>'{financial,units}' INTO items FROM public.eva_closing_publications WHERE id=split_part(n.event_key,':',2)::uuid AND organization_id=n.organization_id AND customer_id=n.customer_id;
 ELSIF n.event_key LIKE 'legacy-publication:%' THEN SELECT financial_payload#>'{financial,units}' INTO items FROM public.monthly_energy_settlements WHERE financial_group_id=split_part(n.event_key,':',2)::uuid AND organization_id=n.organization_id AND customer_id=n.customer_id LIMIT 1;
 END IF;
 RETURN jsonb_typeof(items)='array' AND jsonb_array_length(items)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(items)u WHERE NOT (s->'unitIds') ? (u->>'id'));
END$$;
CREATE FUNCTION portal_scope.report_units(body jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN portal_scope.context() IS NULL OR jsonb_typeof(body->'units')<>'array' THEN body ELSE jsonb_set(body,'{units}',coalesce((SELECT jsonb_agg(u) FROM jsonb_array_elements(body->'units')u WHERE (portal_scope.context()->'unitIds') ? (u->>'id')),'[]')) END
$$;
CREATE FUNCTION portal_scope.publication_projection(body jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE s jsonb:=portal_scope.context();units jsonb;f jsonb;key text;value numeric;
BEGIN
 IF s IS NULL THEN RETURN body;END IF;
 IF body->>'organizationId' IS DISTINCT FROM s->>'organizationId' OR body->>'customerId' IS DISTINCT FROM s->>'customerId' OR jsonb_typeof(body#>'{financial,units}') IS DISTINCT FROM 'array' THEN RETURN NULL;END IF;
 SELECT coalesce(jsonb_agg(u),'[]') INTO units FROM jsonb_array_elements(body#>'{financial,units}')u WHERE (s->'unitIds') ? (u->>'id');
 IF jsonb_array_length(units)=0 THEN RETURN NULL;END IF;
 f:=jsonb_build_object('status','AVAILABLE','units',units);
 FOREACH key IN ARRAY ARRAY['acr','aclBeforeFees','fixedFee','variableFee','totalFees','aclAfterFees','savingsAfterFees'] LOOP
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(units)u WHERE u->>key IS NULL OR u->>key !~ '^-?[0-9]{1,15}[.][0-9]{2}$') THEN RAISE EXCEPTION 'Published unit values unavailable' USING ERRCODE='22023';END IF;
  SELECT sum((u->>key)::numeric) INTO value FROM jsonb_array_elements(units)u;
  f:=jsonb_set(f,ARRAY[key],to_jsonb(to_char(value,'FM999999999999999990.00')));
 END LOOP;
 f:=f||jsonb_build_object('savingsBeforeFees',to_char((f->>'acr')::numeric-(f->>'aclBeforeFees')::numeric,'FM999999999999999990.00'));
 RETURN jsonb_set(body,'{financial}',f)||jsonb_build_object('scope','AUTHORIZED_UNITS');
END$$;

-- Views retain the original column order/types. Financial publications remain
-- immutable: only this private read projection sums authorized unit amounts.
DO $$DECLARE t record;cols text;org text;customer text;unit text;hc boolean;hu boolean;pending text;special text;
BEGIN
 FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','p') AND c.relname NOT IN('portal_customer_access','portal_customer_access_events')
 AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND NOT a.attisdropped AND a.attname IN('organization_id','customer_id','consumer_unit_id','unit_id')) LOOP
  SELECT string_agg(CASE
   WHEN t.relname='organization_members' AND a.attname='exclusive_customer_id' THEN format('portal_scope.member_customer(x.organization_id,x.user_id::text,x.exclusive_customer_id) AS %I',a.attname)
   WHEN t.relname='eva_closing_publications' AND a.attname='projection' THEN 'portal_scope.publication_projection(x.projection) AS projection'
   WHEN t.relname='eva_assisted_closing_versions' AND a.attname='report' THEN 'portal_scope.report_units(x.report) AS report'
   ELSE format('x.%I',a.attname) END,',' ORDER BY a.attnum) INTO cols
  FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped;
  org:=CASE WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attname='organization_id' AND NOT attisdropped) THEN 'x.organization_id::text' ELSE 'NULL::text' END;
  hc:=t.relname='customers' OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attname='customer_id' AND NOT attisdropped);
  customer:=CASE WHEN t.relname='customers' THEN 'x.id::text' WHEN hc THEN 'x.customer_id::text' ELSE 'NULL::text' END;
  hu:=true;
  IF t.relname='consumer_units' THEN unit:='x.id::text';
  ELSIF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attname='consumer_unit_id' AND NOT attisdropped) THEN unit:='x.consumer_unit_id::text';
  ELSIF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=t.oid AND attname='unit_id' AND NOT attisdropped) THEN unit:='x.unit_id::text';
  ELSE unit:='NULL::text';hu:=false;END IF;
  pending:=CASE WHEN t.relname='eva_automatic_intakes' THEN '(x.actor_id=portal_scope.context()->>''userId'')' ELSE 'false' END;
  special:=CASE WHEN t.relname='eva_closing_publications' THEN ' AND (portal_scope.context() IS NULL OR portal_scope.publication_projection(x.projection) IS NOT NULL)' WHEN t.relname='portal_notification_outbox' THEN ' AND portal_scope.notice_allowed(x.id)' ELSE '' END;
  EXECUTE format('CREATE VIEW portal_scope.%I WITH(security_barrier=true) AS SELECT %s FROM public.%I x WHERE portal_scope.row_allowed(%s,%s,%s,%L,%L,%s)%s WITH LOCAL CHECK OPTION',t.relname,cols,t.relname,org,customer,unit,hc,hu,pending,special);
  EXECUTE format('REVOKE ALL ON portal_scope.%I FROM PUBLIC,anon,authenticated,service_role',t.relname);
 END LOOP;
END$$;

-- Explicit public entry points only; recursive helpers are private to their
-- existing business rules. A source revision change fails closed until a new
-- audited runtime build, instead of silently running stale authorization.
DO $$DECLARE roots text[]:=ARRAY['client_portal_entitlement','portal_workspace_action','portal_invoice_library','portal_invoice_content_source','portal_presentation_action','portal_waste_correction_action','eva_intake_action','eva_intake_published_completions','read_eva_closing_publications','read_eva_published_components','read_portal_financial_components_v2','energy_price_read','energy_price_read_workspace','energy_forecast_client_published','energy_forecast_client_sources','acl_portal','bot_energy_client_reports','append_operation_client_message','open_operation_client_message','organization_branding_action','eva_intake_work_context','transition_eva_automatic_intake','eva_intake_reference_signature','eva_intake_unit_aliases','bot_energy_license_quota','reserve_bot_energy_ai_usage_v2','settle_bot_energy_ai_usage','eva_composite_rag','eva_corpus_rag','eva_market_local_hits'];r record;dep record;body text;header text;declarations text;missing text[];
BEGIN
 SELECT array_agg(name) INTO missing FROM unnest(roots)name WHERE NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name AND p.prokind='f');
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Review missing portal routines: %',missing;END IF;
 INSERT INTO portal_scope.routines(original_oid,original_name,source_hash,root)
 WITH RECURSIVE functions(oid) AS (
  SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(roots) AND p.prokind='f'
  UNION
  SELECT dependency.oid FROM functions f JOIN pg_proc source ON source.oid=f.oid
  CROSS JOIN LATERAL regexp_matches(source.prosrc,'public[.]([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*[(]','g')call
  JOIN pg_proc dependency ON dependency.proname=call[1] JOIN pg_namespace n ON n.oid=dependency.pronamespace WHERE n.nspname='public' AND dependency.prokind='f' AND dependency.prorettype<>'trigger'::regtype
  AND dependency.proname NOT IN('client_portal_parent_license','client_capacity','organization_resource_usage','organization_resource_usage_before_intake','organization_resource_usage_before_portal','assert_license_platform_actor')
 ) SELECT p.oid,p.proname,portal_scope.function_signature(p.oid),p.proname=ANY(roots) FROM functions f JOIN pg_proc p ON p.oid=f.oid;
 IF(SELECT count(*) FROM portal_scope.routines)>300 THEN RAISE EXCEPTION 'Portal dependency graph requires review';END IF;
 FOR r IN SELECT p.oid,p.proname FROM portal_scope.routines s JOIN pg_proc p ON p.oid=s.original_oid LOOP
  body:=pg_get_functiondef(r.oid);
  header:=left(body,strpos(body,'AS $function$')-1);
  body:=substr(body,strpos(body,'AS $function$'));
  IF header='' THEN RAISE EXCEPTION 'Review routine source format';END IF;
  header:=replace(header,'FUNCTION public.'||r.proname||'(','FUNCTION portal_scope.'||r.proname||'(');
  FOR dep IN SELECT DISTINCT original_name AS name FROM portal_scope.routines LOOP
   body:=regexp_replace(body,'public[.]'||dep.name||'([[:space:]]*[(])','portal_scope.'||dep.name||'\1','g');
  END LOOP;
  FOR dep IN SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='portal_scope' AND c.relkind='v' LOOP
   body:=regexp_replace(body,'public[.]'||dep.name||'([[:space:];,%)]|$)','portal_scope.'||dep.name||'\1','g');
  END LOOP;
  -- Keep composite variable types compatible with helper signatures. Reads
  -- still come from scoped views into the original typed row variables.
  declarations:=left(body,greatest(strpos(body,'BEGIN')-1,0));
  FOR dep IN SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='portal_scope' AND c.relkind='v' LOOP
   declarations:=replace(declarations,'portal_scope.'||dep.name,'public.'||dep.name);
   body:=replace(body,'::portal_scope.'||dep.name,'::public.'||dep.name);
  END LOOP;
  IF declarations<>'' THEN body:=declarations||substr(body,strpos(body,'BEGIN'));END IF;
  IF r.proname='read_portal_financial_components_v2' THEN
   -- Verify the immutable full-group hash/completeness against original rows;
   -- the outer f/u rows and the returned unit projection remain scoped.
   body:=replace(body,'FROM portal_scope.monthly_energy_settlements g WHERE','FROM public.monthly_energy_settlements g WHERE');
  END IF;
  EXECUTE header||body;
  EXECUTE format('REVOKE ALL ON FUNCTION portal_scope.%I(%s) FROM PUBLIC,anon,authenticated,service_role',r.proname,pg_get_function_identity_arguments(r.oid));
 END LOOP;
END$$;

CREATE FUNCTION public.portal_scoped_rpc(p_org text,p_actor text,p_role text,p_customer text,p_revision text,p_name text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb;fn record;old text;args text;result jsonb;arg record;
BEGIN
 s:=public.portal_customer_scope(p_org,p_actor,p_role,p_customer);
 IF s->>'enabled'<>'true' OR s->>'revision' IS DISTINCT FROM p_revision OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text)>1048576 THEN RAISE EXCEPTION 'Portal scope changed' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM portal_scope.routines r WHERE r.source_hash<>portal_scope.function_signature(r.original_oid)) THEN RAISE EXCEPTION 'Portal runtime source revision changed' USING ERRCODE='55000';END IF;
 SELECT p.* INTO fn FROM portal_scope.routines r JOIN pg_proc p ON p.oid=r.original_oid WHERE r.root AND r.original_name=p_name;
 IF NOT FOUND OR (SELECT count(*) FROM portal_scope.routines WHERE root AND original_name=p_name)<>1 THEN RAISE EXCEPTION 'Portal operation unavailable' USING ERRCODE='42501';END IF;
 IF (p_args ? 'p_organization' AND p_args->>'p_organization' IS DISTINCT FROM p_org) OR (p_args ? 'p_operation' AND p_args->>'p_operation' IS DISTINCT FROM 'false') OR (p_args ? 'p_org' AND p_args->>'p_org' IS DISTINCT FROM p_org) OR (p_args ? 'p_actor' AND p_args->>'p_actor' IS DISTINCT FROM p_actor) OR (p_args ? 'p_role' AND p_args->>'p_role' IS DISTINCT FROM p_role) OR (p_args ? 'p_customer' AND p_args->>'p_customer' IS NOT NULL AND p_args->>'p_customer' IS DISTINCT FROM p_customer) OR (p_args ? 'p_platform' AND p_args->>'p_platform' IS DISTINCT FROM 'false') OR (p_args ? 'p_portal' AND p_args->>'p_portal' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'Portal arguments outside authenticated scope' USING ERRCODE='42501';END IF;
 IF p_args->>'p_unit' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'units')u WHERE u->>'id'=p_args->>'p_unit') THEN RAISE EXCEPTION 'Unit outside portal scope' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_args)k WHERE NOT k=ANY(fn.proargnames)) OR EXISTS(SELECT 1 FROM generate_series(1,fn.pronargs-fn.pronargdefaults)n WHERE NOT p_args ? fn.proargnames[n]) THEN RAISE EXCEPTION 'Invalid portal operation arguments' USING ERRCODE='22023';END IF;
 s:=s||jsonb_build_object('unitIds',(SELECT jsonb_agg(u->>'id') FROM jsonb_array_elements(s->'units')u));
 old:=current_setting('energyos.portal_scope',true);PERFORM set_config('energyos.portal_scope',s::text,true);
 args:='';
 FOR arg IN SELECT n,fn.proargnames[n] AS name,fn.proargtypes[n-1] AS type FROM generate_series(1,fn.pronargs)n WHERE p_args ? fn.proargnames[n] ORDER BY n LOOP
  args:=args||CASE WHEN args='' THEN '' ELSE ',' END||format('%I => ',arg.name)||CASE WHEN arg.type IN('json'::regtype,'jsonb'::regtype) THEN format('($1->%L)::%s',arg.name,format_type(arg.type,NULL))
   WHEN(SELECT typcategory='A' FROM pg_type WHERE oid=arg.type) THEN format('CASE WHEN $1->%L=''null''::jsonb THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text($1->%L))::%s END',arg.name,arg.name,format_type(arg.type,NULL))
   ELSE format('($1->>%L)::%s',arg.name,format_type(arg.type,NULL)) END;
 END LOOP;
 BEGIN
  EXECUTE format('SELECT to_jsonb(portal_scope.%I(%s))',p_name,args) INTO result USING p_args;
 EXCEPTION WHEN OTHERS THEN PERFORM set_config('energyos.portal_scope',coalesce(old,''),true);RAISE;END;
 PERFORM set_config('energyos.portal_scope',coalesce(old,''),true);
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.portal_scoped_rpc(text,text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_scoped_rpc(text,text,text,text,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
