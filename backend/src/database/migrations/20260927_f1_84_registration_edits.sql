BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.customers ADD COLUMN edit_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.consumer_units ADD COLUMN edit_version integer NOT NULL DEFAULT 0;
-- Explicit lifecycle ownership; NULL means backoffice/shared/unassigned. No inferred links.
ALTER TABLE public.organization_members ADD COLUMN exclusive_customer_id text REFERENCES public.customers(id);
CREATE TABLE public.registration_edits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 entity_kind text NOT NULL CHECK(entity_kind IN ('customers','consumer_units')),entity_id text NOT NULL,
 before_record jsonb NOT NULL,after_record jsonb NOT NULL, changes jsonb NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
 created_by text NOT NULL CHECK(length(btrim(created_by))>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_id uuid NOT NULL, expected_version integer NOT NULL,
 UNIQUE(organization_id,request_id)
);
CREATE FUNCTION public.preserve_registration_edit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Registration audit is immutable' USING ERRCODE='23514';END $$;
CREATE TRIGGER preserve_registration_edit BEFORE UPDATE OR DELETE ON public.registration_edits FOR EACH ROW EXECUTE FUNCTION public.preserve_registration_edit();
CREATE FUNCTION public.bump_registration_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.edit_version=OLD.edit_version+1;RETURN NEW;END $$;
CREATE TRIGGER bump_registration_version BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.bump_registration_version();
CREATE TRIGGER bump_registration_version BEFORE UPDATE ON public.consumer_units FOR EACH ROW EXECUTE FUNCTION public.bump_registration_version();
CREATE FUNCTION public.edit_registration(p_org text,p_kind text,p_id text,p_actor text,p_reason text,p_expected integer,p_request uuid,p_changes jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior jsonb; saved jsonb; old_edit public.registration_edits; member_row record; exclusive_ids jsonb; affected jsonb='[]'::jsonb; actor_permissions jsonb; is_platform boolean; persisted_changes jsonb; allowed text[]; cols text; k text;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('customers','consumer_units') OR p_actor IS NULL OR length(btrim(p_actor))=0 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 OR p_expected IS NULL OR p_expected<0 OR p_request IS NULL OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object' OR p_changes='{}'::jsonb THEN RAISE EXCEPTION 'Invalid edit' USING ERRCODE='22023'; END IF;
 allowed=CASE WHEN p_kind='customers' THEN ARRAY['exclusive_user_ids','company_name','trade_name','document','contact_name','contact_email','contact_phone','economic_group','status'] ELSE ARRAY['name','consumer_unit_number','distributor','tariff_group','tariff_modality','address','city','state','installed_capacity','voltage','status','contracted_demand','contracted_demand_peak','contracted_demand_off_peak','demand_tariff','demand_tariff_peak','demand_tariff_off_peak','energy_tariff_peak','energy_tariff_off_peak','reactive_energy_tariff','last_demand_value','last_demand_peak','last_demand_off_peak','tariff_subgroup','consumption_class','free_market','last_demand_adjustment_date'] END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) x WHERE NOT x=ANY(allowed)) THEN RAISE EXCEPTION 'Field not editable' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
 PERFORM pg_advisory_xact_lock(hashtextextended('registration-edit:'||p_org||':'||p_request::text,0));
 SELECT * INTO old_edit FROM public.registration_edits WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
 IF old_edit.entity_kind<>p_kind OR old_edit.entity_id<>p_id OR old_edit.created_by<>p_actor OR old_edit.reason<>btrim(p_reason) OR old_edit.expected_version<>p_expected OR old_edit.changes<>p_changes THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;
 RETURN old_edit.after_record;
 END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND organization_id=$2 FOR UPDATE',p_kind) INTO prior USING p_id,p_org;
 IF prior IS NULL OR prior->>'deleted_at' IS NOT NULL THEN RAISE EXCEPTION 'Registration unavailable' USING ERRCODE='P3840'; END IF;
 IF (prior->>'edit_version')::integer<>p_expected THEN RAISE EXCEPTION 'Registration changed' USING ERRCODE='40001'; END IF;
 IF p_kind='customers' THEN
  SELECT coalesce(jsonb_agg(m.user_id::text ORDER BY m.user_id::text),'[]'::jsonb) INTO exclusive_ids
  FROM public.organization_members m WHERE m.organization_id=p_org AND m.exclusive_customer_id=p_id;
  prior=prior||jsonb_build_object('exclusive_user_ids',exclusive_ids);
 END IF;
 IF p_changes <@ prior THEN RAISE EXCEPTION 'No changes' USING ERRCODE='P3841'; END IF;
 IF p_changes ? 'exclusive_user_ids' THEN
  IF jsonb_typeof(p_changes->'exclusive_user_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid users' USING ERRCODE='22023'; END IF;
  IF p_changes->'exclusive_user_ids' IS DISTINCT FROM exclusive_ids THEN
   IF coalesce(p_changes->>'status',prior->>'status')='INACTIVE' AND NOT (p_changes->'exclusive_user_ids' <@ exclusive_ids) THEN RAISE EXCEPTION 'Reactivate customer before adding users' USING ERRCODE='22023'; END IF;
   SELECT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id::text=p_actor AND r.name='admin_platform' AND r.scope='global') INTO is_platform;
   SELECT r.permissions::jsonb INTO actor_permissions FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.status='active';
   IF NOT is_platform AND (actor_permissions IS NULL OR NOT actor_permissions ? '5f91d918-8def-4bc1-b6c7-37e1ff2d14e2') THEN RAISE EXCEPTION 'Cannot assign users' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_changes->'exclusive_user_ids') wanted WHERE NOT EXISTS(
    SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id
    WHERE m.organization_id=p_org AND m.user_id::text=wanted AND r.scope='organization' AND r.name='consulta' AND m.affiliation_type='external'
    AND m.user_id::text<>p_actor AND (m.exclusive_customer_id IS NULL OR m.exclusive_customer_id=p_id)
    AND NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles gr ON gr.id=ur.role_id WHERE ur.user_id::text=m.user_id::text AND gr.scope='global' AND gr.name='admin_platform')
   )) THEN RAISE EXCEPTION 'Only exclusive external consultation users allowed' USING ERRCODE='42501'; END IF;
   UPDATE public.organization_members SET exclusive_customer_id=NULL WHERE organization_id=p_org AND exclusive_customer_id=p_id;
   UPDATE public.organization_members SET exclusive_customer_id=p_id WHERE organization_id=p_org AND user_id::text IN(SELECT jsonb_array_elements_text(p_changes->'exclusive_user_ids'));
  END IF;
 END IF;
 IF p_kind='customers' AND p_changes->>'status'='INACTIVE' AND prior->>'status' IS DISTINCT FROM 'INACTIVE' THEN
  FOR member_row IN SELECT m.* FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id
   WHERE m.organization_id=p_org AND m.exclusive_customer_id=p_id AND m.status='active' AND m.affiliation_type='external' AND r.name='consulta' AND r.scope='organization'
   AND m.user_id::text<>p_actor AND NOT EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles gr ON gr.id=ur.role_id WHERE ur.user_id::text=m.user_id::text AND gr.scope='global' AND gr.name='admin_platform')
   ORDER BY m.user_id FOR UPDATE OF m
  LOOP
   PERFORM public.set_organization_member_status(p_org,member_row.user_id::uuid,p_actor::uuid,'inactive','active',member_row.role_id::text,NULL,NULL);
   affected=affected||jsonb_build_array(member_row.user_id::text);
  END LOOP;
 END IF;
 persisted_changes=p_changes-'exclusive_user_ids';
 -- A relationship-only edit still increments the customer's optimistic version.
 IF persisted_changes='{}'::jsonb THEN persisted_changes=jsonb_build_object('status',prior->'status'); END IF;
 SELECT string_agg(format('%I = x.%I',key,key),',') INTO cols FROM jsonb_object_keys(persisted_changes) key;
 EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$1) x WHERE t.id=$2 AND t.organization_id=$3 RETURNING to_jsonb(t)',p_kind,cols,p_kind) INTO saved USING prior||persisted_changes,p_id,p_org;
 IF p_kind='customers' THEN
  SELECT coalesce(jsonb_agg(m.user_id::text ORDER BY m.user_id::text),'[]'::jsonb) INTO exclusive_ids FROM public.organization_members m WHERE m.organization_id=p_org AND m.exclusive_customer_id=p_id;
  saved=saved||jsonb_build_object('exclusive_user_ids',exclusive_ids,'deactivated_user_ids',affected);
 END IF;
 INSERT INTO public.registration_edits(organization_id,entity_kind,entity_id,before_record,after_record,changes,reason,created_by,request_id,expected_version) VALUES(p_org,p_kind,p_id,prior,saved,p_changes,btrim(p_reason),p_actor,p_request,p_expected);
 RETURN saved;
END $$;
ALTER TABLE public.registration_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_edits FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.registration_edits TO service_role;
REVOKE ALL ON FUNCTION public.edit_registration(text,text,text,text,text,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_registration(text,text,text,text,text,integer,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.preserve_registration_edit(),public.bump_registration_version() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
