-- Mirrors only a current Core denial; prevents customer portals outliving a suspended license.
begin;
grant pee_license_runtime to postgres;grant create on schema public to pee_license_runtime;
set local role pee_license_runtime;
create function pee_sync_license_hold(p_grant jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=(p_grant->>'tenant_id')::uuid;
begin
 if coalesce(p_grant->>'organization_id'<>'d4b48d68-4203-45b2-b709-ac931c87760e'or t is null or t='5a0df16a-1221-439b-a6db-8ab143273a78'or p_grant->>'access_mode'<>'account'or p_grant->>'active'<>'true'or p_grant->>'audience'<>'energyos-pee'or(p_grant->'license'->>'id')::uuid<>t or p_grant->'license'->>'status'not in('suspended','expired')or(p_grant->>'expires_at')::timestamptz<=now(),true)then raise exception 'PEE_SCOPE'using errcode='42501';end if;
 perform set_config('pee.tenant',t::text,true);
 update pee_licenses set status=p_grant->'license'->>'status'where tenant_id=t and version<=(p_grant->'license'->>'version')::integer;
 return jsonb_build_object('held',true);
end$$;
reset role;alter function pee_sync_license_hold(jsonb)owner to pee_license_runtime;
revoke all on function pee_sync_license_hold(jsonb)from public,anon,authenticated;
grant execute on function pee_sync_license_hold(jsonb)to service_role;
revoke create on schema public from pee_license_runtime;revoke pee_license_runtime from postgres;
insert into pee_schema_versions(version)values(11);commit;
