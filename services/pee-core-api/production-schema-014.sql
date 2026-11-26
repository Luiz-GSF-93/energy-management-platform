-- A provisional credential is admitted only once into the PEE platform.
-- It is bound to the verified Supabase auth session until mandatory replacement.
begin;
create table pee_temporary_login_claims(
 auth_user_id uuid not null,generation text not null check(generation~'^[a-f0-9]{64}$'),
 tenant_id uuid not null,session_hash text not null check(session_hash~'^[a-f0-9]{64}$'),
 expires_at timestamptz not null,consumed_at timestamptz not null default now(),
 primary key(auth_user_id,generation)
);
alter table pee_temporary_login_claims enable row level security;
alter table pee_temporary_login_claims force row level security;
create policy own_temporary_login on pee_temporary_login_claims to pee_runtime
 using(auth_user_id::text=current_setting('pee.auth_actor',true))
 with check(auth_user_id::text=current_setting('pee.auth_actor',true));
revoke all on pee_temporary_login_claims from public,anon,authenticated,service_role;
grant select,insert on pee_temporary_login_claims to pee_runtime;
grant pee_runtime to postgres with set true,inherit false;
grant create on schema public to pee_runtime;
set local role pee_runtime;
create function pee_temporary_login(p_user_id uuid,p_tenant_id uuid,p_generation text,p_session_hash text,p_expires_at timestamptz,p_action text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare claimed integer;
begin
 if p_user_id is null or p_generation is null or p_session_hash is null or p_expires_at is null
 or p_generation!~'^[a-f0-9]{64}$'or p_session_hash!~'^[a-f0-9]{64}$'
 or p_action is null or p_action not in('claim','status')then raise exception 'PEE_TEMPORARY_INPUT';end if;
 if p_expires_at<=now()or p_expires_at>now()+interval '24 hours 5 minutes'then return jsonb_build_object('allowed',false);end if;
 perform set_config('pee.auth_actor',p_user_id::text,true);
 if p_action='claim'then
  if p_tenant_id is null then raise exception 'PEE_TEMPORARY_TENANT';end if;
  insert into pee_temporary_login_claims(auth_user_id,generation,tenant_id,session_hash,expires_at)
   values(p_user_id,p_generation,p_tenant_id,p_session_hash,p_expires_at)on conflict do nothing;
  get diagnostics claimed=row_count;
  return jsonb_build_object('allowed',claimed=1);
 end if;
 return jsonb_build_object('allowed',exists(select 1 from pee_temporary_login_claims
  where auth_user_id=p_user_id and generation=p_generation and session_hash=p_session_hash
  and expires_at=p_expires_at and expires_at>now()));
end$$;
revoke all on function pee_temporary_login(uuid,uuid,text,text,timestamptz,text)from public,anon,authenticated;
grant execute on function pee_temporary_login(uuid,uuid,text,text,timestamptz,text)to service_role;
reset role;
revoke create on schema public from pee_runtime;
revoke pee_runtime from postgres;
insert into pee_schema_versions(version)values(14);
commit;
