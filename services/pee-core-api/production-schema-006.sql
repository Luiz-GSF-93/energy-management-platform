-- Mirrored permissions are accepted only after a current, validated Core answer.
-- Anonymous clients never execute this function or choose another tenant.
begin;
do $$begin if not exists(select 1 from pg_roles where rolname='pee_license_runtime')then create role pee_license_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;end if;end$$;
grant pee_license_runtime to postgres;
grant usage,create on schema public to pee_license_runtime;
grant select,insert,update on pee_tenants,pee_licenses,pee_members to pee_license_runtime;
grant insert on pee_audit to pee_license_runtime;grant usage,select on sequence pee_audit_id_seq to pee_license_runtime;
create policy licensed_audit_scope on pee_audit for insert to pee_license_runtime with check(tenant_id::text=current_setting('pee.tenant',true));
create policy licensed_tenant_mirror on pee_tenants to pee_license_runtime using(id::text=current_setting('pee.tenant',true)and not core_workspace)with check(id::text=current_setting('pee.tenant',true)and not core_workspace);
create policy licensed_terms_mirror on pee_licenses to pee_license_runtime using(tenant_id::text=current_setting('pee.tenant',true))with check(tenant_id::text=current_setting('pee.tenant',true));
create policy licensed_member_mirror on pee_members to pee_license_runtime using(tenant_id::text=current_setting('pee.tenant',true))with check(tenant_id::text=current_setting('pee.tenant',true));
alter table pee_licenses add column started_at timestamptz,add column auto_renew boolean not null default true,add column next_renewal_at timestamptz,add column monthly_cents bigint,add column cancellation_requested_at timestamptz,add column cancellation_effective_at timestamptz;
create function pee_sync_license(p_grant jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=(p_grant->>'tenant_id')::uuid;u uuid:=(p_grant->>'sub')::uuid;l jsonb:=p_grant->'license';v integer:=(l->>'version')::integer;m integer:=(p_grant->>'member_version')::integer;old pee_licenses;old_member pee_members;
begin
 if coalesce(p_grant->>'organization_id'<>'d4b48d68-4203-45b2-b709-ac931c87760e' or t is null or u is null or t='5a0df16a-1221-439b-a6db-8ab143273a78' or (l->>'id')::uuid<>t or p_grant->>'active'<>'true' or p_grant->>'audience'<>'energyos-pee' or l->>'status'<>'active' or (l->>'expires_at')::timestamptz<=now() or p_grant->>'role'not in('manager','editor','reviewer','viewer','finance')or v<1 or m<1 or l->>'contract_hash'!~'^[a-f0-9]{64}$' or (l->>'contract_version')::integer<1 or (l->>'signature_reference')::uuid is null or (l->>'monthly_limit')::integer not between 1 and 10000 or (l->>'seats')::integer not between 1 and 10000 or (l->>'royalty_bps')::integer not between 0 and 10000,true) then raise exception 'PEE_LICENSE_SCOPE'using errcode='42501';end if;
 perform set_config('pee.tenant',t::text,true);
 perform pg_advisory_xact_lock(hashtext(t::text));
 select * into old from pee_licenses where tenant_id=t for update;
 if found and old.version>v then raise exception 'PEE_LICENSE_STALE'using errcode='40001';end if;
 if old.version=v and(old.contract_hash<>l->>'contract_hash'or old.contract_version<>(l->>'contract_version')::integer or old.monthly_limit<>(l->>'monthly_limit')::integer or old.royalty_rate<>(l->>'royalty_bps')::numeric/100)then raise exception 'PEE_LICENSE_VERSION_MISMATCH'using errcode='40001';end if;
 insert into pee_tenants(id,name,core_workspace)values(t,left(p_grant->>'workspace_name',200),false)on conflict(id)do update set name=excluded.name where not pee_tenants.core_workspace;
 insert into pee_licenses(tenant_id,core_reference,status,contract_version,contract_hash,signature_reference,expires_at,monthly_limit,seats,royalty_rate,version)values(t,t,'active',(l->>'contract_version')::integer,l->>'contract_hash',l->>'signature_reference',(l->>'expires_at')::timestamptz,(l->>'monthly_limit')::integer,(l->>'seats')::integer,(l->>'royalty_bps')::numeric/100,v)on conflict(tenant_id)do update set status=excluded.status,contract_version=excluded.contract_version,contract_hash=excluded.contract_hash,signature_reference=excluded.signature_reference,expires_at=excluded.expires_at,monthly_limit=excluded.monthly_limit,seats=excluded.seats,royalty_rate=excluded.royalty_rate,version=excluded.version;
 update pee_licenses set started_at=(l->>'started_at')::timestamptz,auto_renew=coalesce((l->>'auto_renew')::boolean,true),next_renewal_at=(l->>'next_renewal_at')::timestamptz,monthly_cents=(l->>'monthly_cents')::bigint,cancellation_requested_at=(l->>'cancellation_requested_at')::timestamptz,cancellation_effective_at=(l->>'cancellation_effective_at')::timestamptz where tenant_id=t;
 select * into old_member from pee_members where tenant_id=t and user_id=u;
 if found and old_member.version>m then raise exception 'PEE_MEMBER_STALE'using errcode='40001';end if;
 insert into pee_members(tenant_id,user_id,role,active,version)values(t,u,p_grant->>'role',true,m)on conflict(tenant_id,user_id)do update set role=excluded.role,active=true,version=excluded.version;
 if old.cancellation_requested_at is null and l->>'cancellation_requested_at'is not null then insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(t,u,'license.cancellation_requested',t,jsonb_build_object('requested_at',l->>'cancellation_requested_at','effective_at',l->>'cancellation_effective_at','royalty_obligations_preserved',true));end if;
 return jsonb_build_object('synced',true,'tenant_id',t,'subject',u);
end$$;
revoke all on function pee_sync_license(jsonb)from public,anon,authenticated;
grant execute on function pee_sync_license(jsonb)to service_role;
alter function pee_sync_license(jsonb)owner to pee_license_runtime;
revoke create on schema public from pee_license_runtime;
revoke pee_license_runtime from postgres;
create table pee_emission_contracts(tenant_id uuid not null,emission_id uuid not null,contract_hash text not null,contract_version integer not null,royalty_bps integer not null,created_at timestamptz not null default now(),primary key(tenant_id,emission_id),foreign key(tenant_id,emission_id)references pee_emissions(tenant_id,id));
alter table pee_emission_contracts enable row level security;alter table pee_emission_contracts force row level security;
create policy frozen_emission_scope on pee_emission_contracts to pee_runtime using(tenant_id::text=current_setting('pee.tenant',true))with check(tenant_id::text=current_setting('pee.tenant',true));
grant select,insert on pee_emission_contracts to pee_runtime;
revoke all on pee_emission_contracts from public,anon,authenticated,service_role;
create function pee_stamp_emission_contract()returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 insert into pee_emission_contracts(tenant_id,emission_id,contract_hash,contract_version,royalty_bps)select new.tenant_id,new.id,l.contract_hash,l.contract_version,round(l.royalty_rate*100)::integer from pee_licenses l where l.tenant_id=new.tenant_id and l.status='active'and l.expires_at>now();return new;
end$$;
revoke all on function pee_stamp_emission_contract()from public,anon,authenticated,service_role;
create trigger pee_stamp_emission_contract after insert on pee_emissions for each row execute function pee_stamp_emission_contract();
insert into pee_schema_versions(version)values(6);
commit;
