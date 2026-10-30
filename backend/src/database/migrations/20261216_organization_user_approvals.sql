BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.organization_members ADD COLUMN permission_limit jsonb;
ALTER TABLE public.organization_members ADD CONSTRAINT organization_member_permission_limit_array CHECK(permission_limit IS NULL OR jsonb_typeof(permission_limit)='array');
CREATE TABLE public.organization_user_requests(
 id uuid PRIMARY KEY,organization_id text NOT NULL REFERENCES public.organizations(id),
 actor_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('INVITE','PERMISSIONS','PORTAL_GRANT')),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','EXECUTING','COMPLETE','REJECTED','UNKNOWN')),
 decision_by uuid,decision_reason text,result jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX organization_user_invite_pending ON public.organization_user_requests(organization_id,lower(body->>'email')) WHERE kind='INVITE' AND state IN ('PENDING','EXECUTING');
CREATE UNIQUE INDEX organization_user_scope_pending ON public.organization_user_requests(organization_id,kind,(body->>'userId'),coalesce(body->>'customerId','')) WHERE kind IN ('PERMISSIONS','PORTAL_GRANT') AND state IN ('PENDING','EXECUTING');
CREATE INDEX organization_user_requests_inbox ON public.organization_user_requests(organization_id,state,created_at DESC);
CREATE TABLE public.organization_user_request_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id text NOT NULL,request_id uuid NOT NULL,actor_id uuid NOT NULL,
 state text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,request_id) REFERENCES public.organization_user_requests(organization_id,id)
);
ALTER TABLE public.organization_user_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_user_request_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_user_requests,public.organization_user_request_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.organization_user_requests,public.organization_user_request_events TO service_role;
CREATE FUNCTION public.organization_user_request_action(o text,a uuid,platform boolean,action text,rid uuid,b jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.organization_members%ROWTYPE;rr public.roles%ROWTYPE;r public.organization_user_requests%ROWTYPE;perms jsonb;admin boolean:=false;nextstate text;target public.organization_members%ROWTYPE;
BEGIN
 IF nullif(o,'') IS NULL OR a IS NULL OR rid IS NULL OR jsonb_typeof(b)<>'object' THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023';END IF;
 IF platform THEN
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions s WHERE s.organization_id=o AND s.user_id::text=a::text AND s.expires_at>now() AND s.revoked_at IS NULL) THEN RAISE EXCEPTION 'No platform session' USING ERRCODE='42501';END IF;
  admin:=true;
 ELSE
  SELECT * INTO m FROM public.organization_members WHERE organization_id=o AND user_id::text=a::text AND lower(status)='active';
  SELECT * INTO rr FROM public.roles WHERE id=m.role_id AND organization_id=o AND scope='organization';
  IF rr.name NOT IN ('admin_org','gestor') OR rr.name IS NULL THEN RAISE EXCEPTION 'Not a manager' USING ERRCODE='42501';END IF;
  SELECT coalesce(jsonb_agg(v),'[]'::jsonb) INTO perms FROM jsonb_array_elements(rr.permissions) v WHERE m.permission_limit IS NULL OR m.permission_limit @> jsonb_build_array(v);
  IF NOT perms ? '94f57d38-0438-43c5-81bc-5544ab53912a' THEN RAISE EXCEPTION 'Invite permission required' USING ERRCODE='42501';END IF;
  admin:=rr.name='admin_org';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(o||rid::text,0));
 SELECT * INTO r FROM public.organization_user_requests WHERE organization_id=o AND id=rid FOR UPDATE;
 IF action='submit' THEN
  IF FOUND THEN IF r.actor_id<>a OR r.body<>b->'body' OR r.kind<>b->>'kind' THEN RAISE EXCEPTION 'Changed request' USING ERRCODE='40001';END IF;RETURN to_jsonb(r);END IF;
  IF b->>'kind' NOT IN ('INVITE','PERMISSIONS','PORTAL_GRANT') OR jsonb_typeof(b->'body')<>'object' THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023';END IF;
  INSERT INTO public.organization_user_requests(id,organization_id,actor_id,kind,body) VALUES(rid,o,a,b->>'kind',b->'body') RETURNING * INTO r;
  INSERT INTO public.organization_user_request_events(organization_id,request_id,actor_id,state,reason) VALUES(o,rid,a,'PENDING','Solicitação registrada, sem concessão de acesso ou envio de convite.');RETURN to_jsonb(r);
 END IF;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found' USING ERRCODE='42501';END IF;
 IF action='read' THEN
  IF NOT admin AND r.actor_id<>a THEN RAISE EXCEPTION 'Notification outside scope' USING ERRCODE='42501';END IF;
  IF b->>'key' IS DISTINCT FROM 'users:'||rid::text||':'||r.state THEN RAISE EXCEPTION 'Notification changed' USING ERRCODE='40001';END IF;
  INSERT INTO public.operation_notification_reads(organization_id,user_id,notification_key) VALUES(o,a::text,b->>'key') ON CONFLICT DO NOTHING;RETURN jsonb_build_object('read',true);
 END IF;
 IF NOT admin OR (r.actor_id=a AND NOT platform AND rr.name<>'admin_org') THEN RAISE EXCEPTION 'Administrator approval required' USING ERRCODE='42501';END IF;
 IF action IN ('claim','reject') THEN
  IF length(btrim(b->>'reason')) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023';END IF;
  IF r.state<>'PENDING' THEN RAISE EXCEPTION 'Request already decided; inspect history' USING ERRCODE='40001';END IF;
  nextstate:=CASE action WHEN 'claim' THEN 'EXECUTING' ELSE 'REJECTED' END;
  UPDATE public.organization_user_requests SET state=nextstate,decision_by=a,decision_reason=b->>'reason',updated_at=now() WHERE id=rid AND organization_id=o RETURNING * INTO r;
 ELSIF action IN ('complete','unknown') THEN
  IF r.state<>'EXECUTING' OR r.decision_by<>a THEN RAISE EXCEPTION 'Invalid completion' USING ERRCODE='40001';END IF;
  nextstate:=CASE action WHEN 'complete' THEN 'COMPLETE' ELSE 'UNKNOWN' END;
  UPDATE public.organization_user_requests SET state=nextstate,result=b,updated_at=now() WHERE id=rid AND organization_id=o RETURNING * INTO r;
 ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;
 INSERT INTO public.organization_user_request_events(organization_id,request_id,actor_id,state,reason) VALUES(o,rid,a,r.state,coalesce(b->>'reason',r.decision_reason,'Resultado registrado'));
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.organization_user_request_action(text,uuid,boolean,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organization_user_request_action(text,uuid,boolean,text,uuid,jsonb) TO service_role;
CREATE FUNCTION public.set_member_permission_limit(o text,a uuid,platform boolean,u uuid,roleid text,selected jsonb,reason text,expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE dest public.roles%ROWTYPE;actor public.roles%ROWTYPE;actorlimit jsonb;prior jsonb;
BEGIN
 IF jsonb_typeof(selected)<>'array' OR jsonb_array_length(selected)>300 OR length(btrim(reason)) NOT BETWEEN 10 AND 1000 OR u=a THEN RAISE EXCEPTION 'Invalid permission decision' USING ERRCODE='22023';END IF;
 IF platform THEN
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions s WHERE s.organization_id=o AND s.user_id::text=a::text AND s.expires_at>now() AND s.revoked_at IS NULL) THEN RAISE EXCEPTION 'No platform session' USING ERRCODE='42501';END IF;
 ELSE
  SELECT r.* INTO actor FROM public.roles r JOIN public.organization_members m ON m.role_id=r.id AND m.organization_id=r.organization_id WHERE m.user_id::text=a::text AND m.organization_id=o AND lower(m.status)='active';
  SELECT m.permission_limit INTO actorlimit FROM public.organization_members m WHERE m.user_id::text=a::text AND m.organization_id=o AND lower(m.status)='active';
  IF actor.id IS NULL OR actor.name<>'admin_org' OR NOT actor.permissions ? '5f91d918-8def-4bc1-b6c7-37e1ff2d14e2' OR actorlimit IS NOT NULL AND NOT actorlimit ? '5f91d918-8def-4bc1-b6c7-37e1ff2d14e2' THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501';END IF;
 END IF;
 SELECT * INTO dest FROM public.roles WHERE id::text=roleid AND organization_id=o AND scope='organization';
 IF dest.id IS NULL OR dest.name='admin_org' AND NOT platform OR NOT dest.permissions @> selected OR (NOT platform AND (NOT actor.permissions @> selected OR actorlimit IS NOT NULL AND NOT actorlimit @> selected)) THEN RAISE EXCEPTION 'Permission escalation denied' USING ERRCODE='42501';END IF;
 SELECT to_jsonb(m) INTO prior FROM public.organization_members m WHERE m.user_id::text=u::text AND m.organization_id=o AND lower(m.status)='active' FOR UPDATE;
 IF prior IS NULL THEN RAISE EXCEPTION 'Membership unavailable' USING ERRCODE='42501';END IF;
 IF prior->>'role_id' IS DISTINCT FROM expected->>'roleId' OR prior->'permission_limit' IS DISTINCT FROM expected->'permissionLimit' THEN RAISE EXCEPTION 'Membership changed after preparation' USING ERRCODE='40001';END IF;
 UPDATE public.organization_members SET role_id=dest.id,permission_limit=selected WHERE organization_id=o AND user_id::text=u::text;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,created_at) VALUES(gen_random_uuid(),o,a,'UPDATE','organization_member_permissions',u::text,jsonb_build_object('before',prior,'after',jsonb_build_object('roleId',roleid,'permissions',selected),'reason',reason),'success',now());
END $$;
REVOKE ALL ON FUNCTION public.set_member_permission_limit(text,uuid,boolean,uuid,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_permission_limit(text,uuid,boolean,uuid,text,jsonb,text,jsonb) TO service_role;

CREATE FUNCTION public.check_member_permission_limit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE rp jsonb;
BEGIN
 IF TG_OP='UPDATE' AND NEW.permission_limit IS NOT DISTINCT FROM OLD.permission_limit AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN RETURN NEW;END IF;
 IF current_user IN ('anon','authenticated') THEN RAISE EXCEPTION 'Use approved administration workflow' USING ERRCODE='42501';END IF;
 SELECT permissions INTO rp FROM public.roles WHERE id=NEW.role_id AND organization_id=NEW.organization_id AND scope='organization';
 IF NEW.permission_limit IS NOT NULL THEN
  IF rp IS NULL OR jsonb_typeof(NEW.permission_limit)<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.permission_limit) v WHERE jsonb_typeof(v)<>'string') THEN RAISE EXCEPTION 'Invalid individual permissions' USING ERRCODE='22023';END IF;
  IF TG_OP='UPDATE' AND NEW.permission_limit IS NOT DISTINCT FROM OLD.permission_limit AND NEW.role_id IS DISTINCT FROM OLD.role_id THEN
   SELECT coalesce(jsonb_agg(v),'[]'::jsonb) INTO NEW.permission_limit FROM jsonb_array_elements(NEW.permission_limit) v WHERE rp @> jsonb_build_array(v);
  ELSIF NOT rp @> NEW.permission_limit THEN RAISE EXCEPTION 'Permission escalation denied' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_member_permission_limit BEFORE INSERT OR UPDATE OF permission_limit,role_id ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.check_member_permission_limit();

NOTIFY pgrst,'reload schema';
COMMIT;
