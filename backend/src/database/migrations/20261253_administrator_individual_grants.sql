BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.organization_user_admin_context(o text,a uuid,platform boolean,editing boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.organization_members;r public.roles;perms jsonb;lic jsonb;cnt integer;
BEGIN
 IF nullif(o,'') IS NULL OR a IS NULL OR platform IS NULL OR editing IS NULL OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=o AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Invalid organization context' USING ERRCODE='42501'; END IF;
 IF platform THEN
  IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=o AND user_id::text=a::text AND expires_at>now() AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Platform operation session required' USING ERRCODE='42501'; END IF;
  PERFORM public.assert_license_platform_actor(a);
  SELECT jsonb_agg(x->'id') INTO perms FROM jsonb_array_elements(public.organization_permission_rules()) x;
 ELSE
  IF (SELECT count(*) FROM public.organization_members WHERE organization_id=o AND user_id=a AND lower(status)='active')<>1 THEN RAISE EXCEPTION 'Unique active membership required' USING ERRCODE='42501'; END IF;
  SELECT * INTO m FROM public.organization_members WHERE organization_id=o AND user_id=a AND lower(status)='active';
  SELECT * INTO r FROM public.roles WHERE id=m.role_id AND organization_id=o AND scope='organization';
  IF r.name IS DISTINCT FROM 'admin_org' OR m.affiliation_type IS DISTINCT FROM 'internal' OR jsonb_typeof(r.permissions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Only organization administrator manages users' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO perms FROM jsonb_array_elements(r.permissions) x WHERE m.permission_limit IS NULL OR m.permission_limit @> jsonb_build_array(x);
  IF NOT perms ? 'f60e405e-f120-4420-a563-691162504b15' THEN RAISE EXCEPTION 'User view permission required' USING ERRCODE='42501'; END IF;
  IF editing AND NOT perms ? '94f57d38-0438-43c5-81bc-5544ab53912a' THEN RAISE EXCEPTION 'User invitation permission required' USING ERRCODE='42501'; END IF;
  -- Existing full Trading managers already have greater supplier authority.
  IF perms ? 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce' AND NOT perms ? 'f1c2d3a4-7c53-4b05-8ed3-f32b88f32131' THEN perms:=perms||'"f1c2d3a4-7c53-4b05-8ed3-f32b88f32131"'::jsonb; END IF;
 END IF;
 SELECT count(*) INTO cnt FROM public.licenses WHERE organization_id=o AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE);
 IF cnt>1 THEN RAISE EXCEPTION 'Ambiguous organization license' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(l) INTO lic FROM public.licenses l WHERE organization_id=o AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE);
 IF editing AND lic IS NULL THEN RAISE EXCEPTION 'Active license required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('permissions',perms,'license',lic,'platform',platform,'administrator',true);
END$$;

CREATE OR REPLACE FUNCTION public.organization_permission_status(rule jsonb,role_name text,ctx jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE cap text;
BEGIN
 IF rule->'ownerOnly'='true'::jsonb AND ctx->'platform' IS DISTINCT FROM 'true'::jsonb THEN RETURN 'Configuração exclusiva do administrador da plataforma.'; END IF;
 IF ctx->'administrator' IS DISTINCT FROM 'true'::jsonb AND NOT (rule->'roles') ? role_name THEN RETURN 'Ação incompatível com esta função; decisões administrativas permanecem protegidas.'; END IF;
 IF ctx->'administrator' IS DISTINCT FROM 'true'::jsonb AND NOT (ctx->'permissions') ? (rule->>'id') THEN RETURN 'O administrador responsável não possui esta liberação para delegar.'; END IF;
 IF ctx->'license' IS NULL OR ctx->'license'='null'::jsonb THEN RETURN 'Não existe licença ativa e única para esta organização.'; END IF;
 FOR cap IN SELECT jsonb_array_elements_text(rule->'capabilities') LOOP
  IF (ctx->'license'->cap) IS DISTINCT FROM 'true'::jsonb THEN RETURN 'Módulo não habilitado na licença: '||(rule->>'module')||'.'; END IF;
 END LOOP;
 IF jsonb_array_length(rule->'anyCapabilities')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(rule->'anyCapabilities') x WHERE ctx->'license'->x='true'::jsonb) THEN RETURN 'O módulo necessário não está contratado na licença.'; END IF;
 RETURN NULL;
END$$;

CREATE OR REPLACE FUNCTION public.organization_user_permission_catalog(o text,a uuid,platform boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;r public.roles;t public.organization_role_templates;rule jsonb;role_list jsonb:='[]';perm_list jsonb:='[]';byrole jsonb;why text;can_configure boolean;presented jsonb;unmapped public.permissions;
BEGIN
 ctx:=public.organization_user_admin_context(o,a,platform,false);
 FOR r IN SELECT * FROM public.roles WHERE organization_id=o AND scope='organization' ORDER BY name,id LOOP
  SELECT * INTO t FROM public.organization_role_templates WHERE organization_id=o AND role_id=r.id;
  can_configure:=r.name IN('gestor','operacional','consulta') AND (ctx->'permissions') ? '5f91d918-8def-4bc1-b6c7-37e1ff2d14e2';
  presented:=r.permissions;
  IF r.name='admin_org' THEN SELECT coalesce(jsonb_agg(x->'id' ORDER BY x->>'id'),'[]'::jsonb) INTO presented FROM jsonb_array_elements(public.organization_permission_rules()) x WHERE public.organization_permission_status(x,r.name,ctx) IS NULL; END IF;
  role_list:=role_list||jsonb_build_array(jsonb_build_object('id',r.id,'name',r.name,'permissions',presented,'defaultPermissions',CASE WHEN r.name='admin_org' THEN presented ELSE coalesce(t.selected,r.permissions) END,'revision',md5(jsonb_build_array(r.permissions,coalesce(t.selected,r.permissions),coalesce(t.revision,0))::text),'canConfigure',can_configure,'canAssign',true));
 END LOOP;
 FOR rule IN SELECT x FROM jsonb_array_elements(public.organization_permission_rules()) x WHERE EXISTS(SELECT 1 FROM public.permissions p WHERE p.id=x->>'id' AND p.code=x->>'code') LOOP
  byrole:='{}';
  FOR r IN SELECT * FROM public.roles WHERE organization_id=o AND scope='organization' LOOP
   why:=public.organization_permission_status(rule,r.name,ctx);
   byrole:=byrole||jsonb_build_object(r.id,jsonb_build_object('configurable',why IS NULL AND r.name<>'admin_org','assignable',why IS NULL,'reason',why));
  END LOOP;
  perm_list:=perm_list||jsonb_build_array(rule||jsonb_build_object('availability',byrole));
 END LOOP;
 -- A newly registered organizational action must be visible for diagnosis, but never delegable without a reviewed policy.
 FOR unmapped IN SELECT p.* FROM public.permissions p WHERE (p.code LIKE ANY(ARRAY['organization.%','documents.%','energia.%','operacao.%','settings.%','intelligence.%','acl_admissions.%','ccee_data.%','ccee_registrations.%','trading.%'])) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.organization_permission_rules()) q WHERE q->>'id'=p.id AND q->>'code'=p.code) LOOP
  byrole:='{}';
  FOR r IN SELECT * FROM public.roles WHERE organization_id=o AND scope='organization' LOOP
   byrole:=byrole||jsonb_build_object(r.id,jsonb_build_object('assignable',false,'configurable',false,'reason','Ação registrada sem regra de delegação homologada. Solicite a revisão do catálogo à plataforma.'));
  END LOOP;
  perm_list:=perm_list||jsonb_build_array(jsonb_build_object('id',unmapped.id,'code',unmapped.code,'name',unmapped.name,'module','Outras ações registradas','action',unmapped.action,'description','Esta ação permanece protegida até a configuração da política de acesso.','dependencies','[]'::jsonb,'availability',byrole));
 END LOOP;
 RETURN jsonb_build_object('metadataVersion',2,'roles',role_list,'permissions',perm_list,'members',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'role_id',role_id,'permission_limit',permission_limit,'affiliation_type',affiliation_type)),'[]'::jsonb) FROM public.organization_members WHERE organization_id=o AND lower(status)='active'),'canApprove',true);
END$$;

CREATE OR REPLACE FUNCTION public.organization_user_permission_selection(o text,a uuid,platform boolean,roleid text,selected jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;r public.roles;chosen jsonb;rule jsonb;pid text;why text;prior jsonb;
BEGIN
 ctx:=public.organization_user_admin_context(o,a,platform,true);
 SELECT * INTO r FROM public.roles WHERE id=roleid AND organization_id=o AND scope='organization';
 IF r.id IS NULL OR jsonb_typeof(r.permissions) IS DISTINCT FROM 'array' OR r.name NOT IN('admin_org','gestor','operacional','consulta') THEN RAISE EXCEPTION 'Role unavailable for assignment' USING ERRCODE='42501'; END IF;
 IF selected IS NOT NULL AND (jsonb_typeof(selected) IS DISTINCT FROM 'array' OR jsonb_array_length(selected)>300 OR EXISTS(SELECT 1 FROM jsonb_array_elements(selected) x WHERE jsonb_typeof(x)<>'string') OR (SELECT count(*) FROM jsonb_array_elements_text(selected))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(selected) x)) THEN RAISE EXCEPTION 'Invalid permission selection' USING ERRCODE='22023'; END IF;
 IF r.name='admin_org' THEN SELECT coalesce(jsonb_agg(x->'id'),'[]'::jsonb) INTO selected FROM jsonb_array_elements(public.organization_permission_rules()) x WHERE public.organization_permission_status(x,r.name,ctx) IS NULL; END IF;
 SELECT coalesce(selected,(SELECT x.selected FROM public.organization_role_templates x WHERE x.organization_id=o AND x.role_id=roleid),r.permissions) INTO chosen;
 IF selected IS NULL THEN
  SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO chosen FROM jsonb_array_elements(chosen) x WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(public.organization_permission_rules()) q WHERE q->'id'=x AND public.organization_permission_status(q,r.name,ctx) IS NULL);
  LOOP
   prior:=chosen;
   SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO chosen FROM jsonb_array_elements(chosen) x WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(public.organization_permission_rules()) q WHERE q->'id'=x AND chosen @> (q->'dependencies'));
   EXIT WHEN chosen=prior;
  END LOOP;
 END IF;
 IF jsonb_typeof(chosen) IS DISTINCT FROM 'array' OR jsonb_array_length(chosen)>300 OR EXISTS(SELECT 1 FROM jsonb_array_elements(chosen) x WHERE jsonb_typeof(x)<>'string') OR (SELECT count(*) FROM jsonb_array_elements_text(chosen))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(chosen) x) THEN RAISE EXCEPTION 'Invalid permission selection' USING ERRCODE='22023'; END IF;
 FOR pid IN SELECT jsonb_array_elements_text(chosen) LOOP
  SELECT x INTO rule FROM jsonb_array_elements(public.organization_permission_rules()) x WHERE x->>'id'=pid;
  IF rule IS NULL OR NOT EXISTS(SELECT 1 FROM public.permissions WHERE id=pid AND code=rule->>'code') THEN RAISE EXCEPTION 'Unknown organization permission' USING ERRCODE='42501'; END IF;
  why:=public.organization_permission_status(rule,r.name,ctx);
  IF why IS NOT NULL THEN RAISE EXCEPTION '%',why USING ERRCODE='42501'; END IF;
  IF NOT chosen @> (rule->'dependencies') THEN RAISE EXCEPTION 'Required permission dependency missing: %',rule->>'name' USING ERRCODE='22023'; END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(x ORDER BY x),'[]'::jsonb) INTO chosen FROM jsonb_array_elements_text(chosen) x;
 RETURN jsonb_build_object('role',jsonb_build_object('id',r.id,'name',r.name,'permissions',r.permissions),'permissions',chosen);
END$$;

CREATE OR REPLACE FUNCTION public.extend_organization_role_capacity(o text,a uuid,roleid text,chosen jsonb,reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.roles;m public.organization_members;added jsonb;prior jsonb;
BEGIN
 -- Private helper: callers validate the actor, license, selection and dependencies first.
 PERFORM pg_advisory_xact_lock(hashtextextended(o||':user-role-settings',0));
 SELECT * INTO r FROM public.roles WHERE id=roleid AND organization_id=o AND scope='organization' FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Role outside organization' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x),'[]'::jsonb) INTO added FROM jsonb_array_elements_text(chosen) x WHERE NOT r.permissions ? x;
 IF jsonb_array_length(added)=0 THEN RETURN; END IF;
 -- A one-person grant must not become a default for new accounts or an implicit grant to peers.
 INSERT INTO public.organization_role_templates(organization_id,role_id,selected,revision,updated_by) VALUES(o,roleid,r.permissions,1,a) ON CONFLICT(organization_id,role_id) DO NOTHING;
 FOR m IN SELECT * FROM public.organization_members WHERE organization_id=o AND role_id=roleid AND permission_limit IS NULL FOR UPDATE LOOP
  prior:=to_jsonb(m);
  UPDATE public.organization_members SET permission_limit=r.permissions WHERE id=m.id AND organization_id=o;
  INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status) VALUES(gen_random_uuid()::text,o,a,'UPDATE','organization_member_permissions',m.user_id::text,jsonb_build_object('before',prior,'after',jsonb_build_object('permissionLimit',r.permissions),'reason','Preservar o acesso efetivo durante uma concessão individual.','effectiveAccessUnchanged',true),'success');
 END LOOP;
 UPDATE public.roles SET permissions=permissions||added WHERE id=roleid AND organization_id=o;
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT roleid,x FROM jsonb_array_elements_text(added) x ON CONFLICT(role_id,permission_id) DO NOTHING;
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status) VALUES(gen_random_uuid()::text,o,a,'UPDATE','organization_role_capacity',roleid,jsonb_build_object('added',added,'reason',reason,'defaultsAndOtherUsersPreserved',true),'success');
END$$;

CREATE OR REPLACE FUNCTION public.set_member_permission_limit(o text,a uuid,platform boolean,u uuid,roleid text,selected jsonb,reason text,expected jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;prior jsonb;validated jsonb;
BEGIN
 ctx:=public.organization_user_admin_context(o,a,platform,true);
 IF NOT(ctx->'permissions') ? '5f91d918-8def-4bc1-b6c7-37e1ff2d14e2' THEN RAISE EXCEPTION 'Administrator approval without self escalation required' USING ERRCODE='42501'; END IF;
 IF reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 1000 OR jsonb_typeof(expected) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(o||':user-role-settings',0));
 validated:=public.organization_user_permission_selection(o,a,platform,roleid,selected);
 IF (SELECT count(*) FROM public.organization_members WHERE organization_id=o AND user_id=u AND lower(status)='active')<>1 THEN RAISE EXCEPTION 'Unique active target membership required' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(m) INTO prior FROM public.organization_members m WHERE organization_id=o AND user_id=u AND lower(status)='active' FOR UPDATE;
 IF prior IS NULL THEN RAISE EXCEPTION 'Membership unavailable' USING ERRCODE='42501'; END IF;
 IF prior->>'role_id' IS DISTINCT FROM expected->>'roleId' OR prior->'permission_limit' IS DISTINCT FROM expected->'permissionLimit' THEN RAISE EXCEPTION 'Membership changed since preview' USING ERRCODE='40001'; END IF;
 IF a=u AND prior->>'role_id' IS DISTINCT FROM roleid THEN RAISE EXCEPTION 'Cannot change own administrator role' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.roles WHERE id=prior->>'role_id' AND organization_id=o AND name='admin_org') AND NOT EXISTS(SELECT 1 FROM public.roles WHERE id=roleid AND organization_id=o AND name='admin_org') AND (SELECT count(*) FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=o AND lower(m.status)='active' AND m.affiliation_type='internal' AND r.name='admin_org' AND m.user_id<>u)=0 THEN RAISE EXCEPTION 'Last organization administrator must remain active' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.roles WHERE id=roleid AND organization_id=o AND name='admin_org') AND prior->>'affiliation_type' IS DISTINCT FROM 'internal' THEN RAISE EXCEPTION 'Administrator requires internal membership' USING ERRCODE='42501'; END IF;
 
 IF NOT EXISTS(SELECT 1 FROM public.roles WHERE id=roleid AND organization_id=o AND name='admin_org') THEN PERFORM public.extend_organization_role_capacity(o,a,roleid,validated->'permissions',reason); END IF;
 UPDATE public.organization_members SET role_id=roleid,permission_limit=CASE WHEN EXISTS(SELECT 1 FROM public.roles WHERE id=roleid AND organization_id=o AND name='admin_org') THEN NULL ELSE validated->'permissions' END WHERE organization_id=o AND user_id=u AND lower(status)='active';
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status) VALUES(gen_random_uuid()::text,o,a,'UPDATE','organization_member_permissions',u::text,jsonb_build_object('before',prior,'after',jsonb_build_object('roleId',roleid,'permissions',CASE WHEN EXISTS(SELECT 1 FROM public.roles WHERE id=roleid AND organization_id=o AND name='admin_org') THEN (SELECT permissions FROM public.roles WHERE id=roleid AND organization_id=o) ELSE validated->'permissions' END,'administratorFullAuthority',EXISTS(SELECT 1 FROM public.roles WHERE id=roleid AND organization_id=o AND name='admin_org')),'reason',reason),'success');
END$$;

CREATE OR REPLACE FUNCTION public.prepare_organization_invite_permissions(o text,a uuid,platform boolean,roleid text,selected jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE validated jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(o||':user-role-settings',0));
 validated:=public.organization_user_permission_selection(o,a,platform,roleid,selected);
 PERFORM public.extend_organization_role_capacity(o,a,roleid,validated->'permissions','Concessão individual de convite aprovada pelo Administrador.');
 RETURN validated;
END$$;

DO $$DECLARE r public.roles;m public.organization_members;all_org jsonb;added jsonb;BEGIN
 SELECT jsonb_agg(x->'id' ORDER BY x->>'id') INTO all_org FROM jsonb_array_elements(public.organization_permission_rules()) x WHERE x->'ownerOnly'='false'::jsonb AND EXISTS(SELECT 1 FROM public.permissions p WHERE p.id=x->>'id' AND p.code=x->>'code');
 FOR r IN SELECT * FROM public.roles WHERE scope='organization' AND name='admin_org' FOR UPDATE LOOP
  SELECT coalesce(jsonb_agg(x ORDER BY x),'[]'::jsonb) INTO added FROM jsonb_array_elements_text(all_org) x WHERE NOT r.permissions ? x;
  UPDATE public.roles SET permissions=permissions||added WHERE id=r.id AND organization_id=r.organization_id;
  INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,x FROM jsonb_array_elements_text(added) x ON CONFLICT DO NOTHING;
  FOR m IN SELECT * FROM public.organization_members WHERE organization_id=r.organization_id AND role_id=r.id AND affiliation_type='internal' AND permission_limit IS NOT NULL FOR UPDATE LOOP
   UPDATE public.organization_members SET permission_limit=NULL WHERE id=m.id AND organization_id=r.organization_id;
   INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status) VALUES(gen_random_uuid()::text,r.organization_id,m.user_id,'UPDATE','organization_member_permissions',m.user_id::text,jsonb_build_object('before',jsonb_build_object('permissionLimit',m.permission_limit),'after',jsonb_build_object('permissionLimit',null),'reason','Administrador da organização possui autoridade integral sobre permissões organizacionais; licença e escopo preservados.'),'success');
  END LOOP;
 END LOOP;
END$$;

REVOKE ALL ON FUNCTION public.extend_organization_role_capacity(text,uuid,text,jsonb,text),public.prepare_organization_invite_permissions(text,uuid,boolean,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_organization_invite_permissions(text,uuid,boolean,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
