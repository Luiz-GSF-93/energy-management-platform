-- Untrusted browser event reports are marked as reports, never proof of an OS screenshot.
begin;
grant pee_runtime to postgres with set true,inherit false;grant create on schema public to pee_runtime;
set local role pee_runtime;
create function pee_security_event(p_actor uuid,p_tenant uuid,p_role text,p_core boolean,p_event text,p_detail jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform pee_store(p_actor,p_tenant,p_role,p_core,'usage','{"monthly_limit":1}');
 if p_event not in('window_hidden','copy_command_blocked','print_command_blocked','document_export_denied','document_exported','document_viewed')or octet_length(p_detail::text)>2000 then raise exception 'PEE_SECURITY_EVENT';end if;
 insert into pee_audit(tenant_id,actor_id,action,detail)values(p_tenant,p_actor,'security.'||p_event,p_detail);return jsonb_build_object('recorded',true);
end$$;
reset role;alter function pee_security_event(uuid,uuid,text,boolean,text,jsonb)owner to pee_runtime;
revoke all on function pee_security_event(uuid,uuid,text,boolean,text,jsonb)from public,anon,authenticated;
grant execute on function pee_security_event(uuid,uuid,text,boolean,text,jsonb)to service_role;
revoke create on schema public from pee_runtime;revoke pee_runtime from postgres;
insert into pee_schema_versions(version)values(10);commit;
