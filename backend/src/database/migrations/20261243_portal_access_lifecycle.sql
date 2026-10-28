BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.portal_grant_user_count(org text,customer text,except_user uuid DEFAULT NULL) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT count(DISTINCT a.user_id) FROM public.portal_customer_access a JOIN public.organization_members m ON m.organization_id=a.organization_id AND m.user_id=a.user_id AND upper(m.status)='ACTIVE' AND m.affiliation_type='external' JOIN public.roles r ON r.organization_id=m.organization_id AND r.id=m.role_id AND r.scope='organization' AND r.name='consulta'
 WHERE a.organization_id=org AND a.customer_id=customer AND a.active AND(except_user IS NULL OR a.user_id<>except_user)
$$;
CREATE FUNCTION public.portal_access_license_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF coalesce((SELECT multi_customer_enabled FROM public.client_portal_policies WHERE organization_id=NEW.organization_id),false) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
  IF NEW.max_users<public.portal_grant_user_count(NEW.organization_id,NEW.customer_id) THEN RAISE EXCEPTION 'Portal users exceed proposed customer capacity' USING ERRCODE='P3412';END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER portal_access_license_capacity BEFORE INSERT OR UPDATE OF max_users,status,starts,ends ON public.client_portal_licenses FOR EACH ROW EXECUTE FUNCTION public.portal_access_license_capacity();
CREATE FUNCTION public.portal_legacy_binding_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous public.portal_customer_access;saved public.portal_customer_access;cap integer;grant_row record;
BEGIN
 IF NOT coalesce((SELECT multi_customer_enabled FROM public.client_portal_policies WHERE organization_id=NEW.organization_id),false) THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id,315));
 IF TG_OP='UPDATE' AND OLD.exclusive_customer_id IS NOT NULL AND OLD.exclusive_customer_id IS DISTINCT FROM NEW.exclusive_customer_id THEN
  SELECT * INTO previous FROM public.portal_customer_access WHERE organization_id=OLD.organization_id AND user_id=OLD.user_id AND customer_id=OLD.exclusive_customer_id AND origin='LEGACY' AND active FOR UPDATE;
  IF FOUND THEN
   UPDATE public.portal_customer_access SET active=false,revision=revision+1,updated_by='system:legacy-binding-sync',updated_at=clock_timestamp() WHERE organization_id=previous.organization_id AND user_id=previous.user_id AND customer_id=previous.customer_id RETURNING * INTO saved;
   INSERT INTO public.portal_customer_access_events(organization_id,user_id,customer_id,actor_id,request_id,reason,previous,current_snapshot) VALUES(saved.organization_id,saved.user_id,saved.customer_id,'system:legacy-binding-sync',gen_random_uuid(),'Revogação acompanhando a alteração auditada do vínculo anterior.',to_jsonb(previous),to_jsonb(saved));
   UPDATE public.organization_members SET portal_scope_managed=true WHERE id=NEW.id;
  END IF;
 END IF;
 IF NEW.exclusive_customer_id IS NOT NULL AND NEW.affiliation_type='external' AND upper(NEW.status)='ACTIVE' AND EXISTS(SELECT 1 FROM public.roles WHERE id=NEW.role_id AND organization_id=NEW.organization_id AND name='consulta' AND scope='organization') THEN
  INSERT INTO public.portal_customer_access(organization_id,user_id,customer_id,all_units,active,origin,updated_by) VALUES(NEW.organization_id,NEW.user_id,NEW.exclusive_customer_id,true,true,'LEGACY','system:legacy-binding-sync') ON CONFLICT DO NOTHING RETURNING * INTO saved;
  IF FOUND THEN INSERT INTO public.portal_customer_access_events(organization_id,user_id,customer_id,actor_id,request_id,reason,current_snapshot) VALUES(saved.organization_id,saved.user_id,saved.customer_id,'system:legacy-binding-sync',gen_random_uuid(),'Preservação do fluxo anterior de convite ou vínculo exclusivo autorizado.',to_jsonb(saved));END IF;
  SELECT max_users INTO cap FROM public.client_portal_licenses WHERE organization_id=NEW.organization_id AND customer_id=NEW.exclusive_customer_id AND status='ACTIVE' AND starts<=CURRENT_DATE AND ends>=CURRENT_DATE;
  IF cap IS NULL OR public.portal_grant_user_count(NEW.organization_id,NEW.exclusive_customer_id)>cap THEN RAISE EXCEPTION 'Customer portal user capacity reached' USING ERRCODE='P3411';END IF;
 END IF;
 IF NEW.affiliation_type='external' AND upper(NEW.status)='ACTIVE' AND EXISTS(SELECT 1 FROM public.roles WHERE id=NEW.role_id AND organization_id=NEW.organization_id AND name='consulta' AND scope='organization') THEN
  FOR grant_row IN SELECT a.customer_id,l.max_users FROM public.portal_customer_access a JOIN public.client_portal_licenses l ON l.organization_id=a.organization_id AND l.customer_id=a.customer_id AND l.status='ACTIVE' AND l.starts<=CURRENT_DATE AND l.ends>=CURRENT_DATE WHERE a.organization_id=NEW.organization_id AND a.user_id=NEW.user_id AND a.active LOOP
   IF public.portal_grant_user_count(NEW.organization_id,grant_row.customer_id)>grant_row.max_users THEN RAISE EXCEPTION 'Customer portal user capacity reached' USING ERRCODE='P3411';END IF;
  END LOOP;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER portal_legacy_binding_sync AFTER INSERT OR UPDATE OF exclusive_customer_id,status,affiliation_type,role_id ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.portal_legacy_binding_sync();
DO $$DECLARE body text;old text:='SELECT count(*) INTO used FROM public.organization_members WHERE organization_id=NEW.organization_id AND exclusive_customer_id=customer AND status=''active'' AND affiliation_type=''external'' AND id<>NEW.id;';BEGIN
 body:=pg_get_functiondef('public.enforce_client_portal_resource_capacity()'::regprocedure);
 IF position(old IN body)=0 THEN RAISE EXCEPTION 'Review original portal capacity function';END IF;
 EXECUTE replace(body,old,'IF coalesce((SELECT multi_customer_enabled FROM public.client_portal_policies WHERE organization_id=NEW.organization_id),false) THEN used:=public.portal_grant_user_count(NEW.organization_id,customer,NEW.user_id);ELSE '||old||'END IF;');
END$$;

-- Recheck private delivery scope before the existing transport may obtain an
-- address. No message is sent by this migration and channel consent is kept.
DO $$DECLARE body text;dep record;BEGIN
 body:=pg_get_functiondef('public.portal_notice_destination(uuid,text)'::regprocedure);
 body:=replace(body,'FUNCTION public.portal_notice_destination(','FUNCTION portal_scope.portal_notice_destination_original(');
 FOR dep IN SELECT DISTINCT original_name AS name FROM portal_scope.routines LOOP
  body:=regexp_replace(body,'public[.]'||dep.name||'([[:space:]]*[(])','portal_scope.'||dep.name||'\1','g');
 END LOOP;
 FOR dep IN SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='portal_scope' AND c.relkind='v' LOOP
  body:=regexp_replace(body,'public[.]'||dep.name||'([[:space:];,%)]|$)','portal_scope.'||dep.name||'\1','g');
 END LOOP;
 EXECUTE body;
END$$;
CREATE OR REPLACE FUNCTION public.portal_notice_destination(p_notice uuid,p_channel text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n public.portal_notification_outbox;m record;s jsonb;old text;result text;
BEGIN
 SELECT * INTO STRICT n FROM public.portal_notification_outbox WHERE id=p_notice;
 IF NOT coalesce((SELECT multi_customer_enabled FROM public.client_portal_policies WHERE organization_id=n.organization_id),false) THEN RETURN portal_scope.portal_notice_destination_original(p_notice,p_channel);END IF;
 SELECT role_id::text AS role_id INTO m FROM public.organization_members WHERE organization_id=n.organization_id AND user_id::text=n.recipient_id AND upper(status)='ACTIVE' AND affiliation_type='external';
 IF NOT FOUND THEN RAISE EXCEPTION 'Portal recipient unavailable' USING ERRCODE='42501';END IF;
 s:=public.portal_customer_scope(n.organization_id,n.recipient_id,m.role_id,n.customer_id);
 s:=s||jsonb_build_object('unitIds',(SELECT jsonb_agg(u->>'id') FROM jsonb_array_elements(s->'units')u));
 old:=current_setting('energyos.portal_scope',true);PERFORM set_config('energyos.portal_scope',s::text,true);
 BEGIN result:=portal_scope.portal_notice_destination_original(p_notice,p_channel);
 EXCEPTION WHEN no_data_found THEN PERFORM set_config('energyos.portal_scope',coalesce(old,''),true);RAISE EXCEPTION 'Notification unit unavailable' USING ERRCODE='42501';
 WHEN OTHERS THEN PERFORM set_config('energyos.portal_scope',coalesce(old,''),true);RAISE;END;
 PERFORM set_config('energyos.portal_scope',coalesce(old,''),true);RETURN result;
END$$;
-- Recipient discovery recognizes secondary grants. Routing/consent and unit
-- checks still apply before an address can be obtained for delivery.
CREATE FUNCTION public.portal_customer_recipients(org text,customer text) RETURNS TABLE(actor text,role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m.user_id::text,m.role_id::text FROM public.organization_members m JOIN public.roles r ON r.organization_id=m.organization_id AND r.id=m.role_id AND r.scope='organization' AND r.name='consulta'
 WHERE m.organization_id=org AND upper(m.status)='ACTIVE' AND m.affiliation_type='external' AND
 CASE WHEN coalesce((SELECT multi_customer_enabled FROM public.client_portal_policies WHERE organization_id=org),false)
 THEN EXISTS(SELECT 1 FROM public.portal_customer_access a WHERE a.organization_id=org AND a.customer_id=customer AND a.user_id=m.user_id AND a.active)
 ELSE m.exclusive_customer_id=customer END
$$;
CREATE FUNCTION public.portal_recipient_entitlement(org text,actor text,role text,customer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb;
BEGIN
 IF NOT coalesce((SELECT multi_customer_enabled FROM public.client_portal_policies WHERE organization_id=org),false) THEN RETURN public.client_portal_entitlement(org,actor,role,'notifications');END IF;
 s:=public.portal_customer_scope(org,actor,role,customer);
 RETURN public.portal_scoped_rpc(org,actor,role,customer,s->>'revision','client_portal_entitlement',jsonb_build_object('p_org',org,'p_actor',actor,'p_role',role,'p_module','notifications'));
END$$;
DO $$DECLARE body text;needle text;BEGIN
 body:=pg_get_functiondef('public.portal_notify_client_event()'::regprocedure);
 needle:='SELECT m.user_id::text AS actor,m.role_id::text AS role FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=org AND r.scope=''organization'' WHERE m.organization_id=org AND upper(m.status)=''ACTIVE'' AND m.affiliation_type=''external'' AND m.exclusive_customer_id=customer AND r.name=''consulta''';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'Review portal notification recipients';END IF;
 body:=replace(body,needle,'SELECT * FROM public.portal_customer_recipients(org,customer)');
 body:=replace(body,'public.client_portal_entitlement(org,member.actor,member.role,''notifications'')','public.portal_recipient_entitlement(org,member.actor,member.role,customer)');
 EXECUTE body;
 body:=pg_get_functiondef('public.collect_portal_deadline_notices()'::regprocedure);
 needle:='SELECT user_id::text AS id,role_id::text AS role FROM public.organization_members WHERE organization_id=r.organization_id AND upper(status)=''ACTIVE'' AND affiliation_type=''external'' AND exclusive_customer_id=r.customer_id';
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'Review portal deadline recipients';END IF;
 body:=replace(body,needle,'SELECT actor AS id,role FROM public.portal_customer_recipients(r.organization_id,r.customer_id)');
 body:=replace(body,'public.client_portal_entitlement(r.organization_id,m.id,m.role,''notifications'')','public.portal_recipient_entitlement(r.organization_id,m.id,m.role,r.customer_id)');
 EXECUTE body;
END$$;
REVOKE ALL ON FUNCTION public.portal_customer_recipients(text,text),public.portal_recipient_entitlement(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.portal_grant_user_count(text,text,uuid),public.portal_access_license_capacity(),public.portal_legacy_binding_sync() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION portal_scope.portal_notice_destination_original(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
