-- Commercial notices: minimal routing/integrity metadata only, never project content.
begin;
create table pee_license_notices(id uuid primary key,license_id uuid not null,request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),recipient_hash text not null check(recipient_hash~'^[a-f0-9]{64}$'),state text not null check(state in('prepared','sending','accepted','delivered','failed','unknown')),provider_id uuid unique,attempt_started_at timestamptz,delivered_at timestamptz,created_at timestamptz not null default now());
alter table pee_license_notices enable row level security;alter table pee_license_notices force row level security;
create policy commercial_notice_runtime on pee_license_notices to pee_license_runtime using(true)with check(true);
revoke all on pee_license_notices from public,anon,authenticated,service_role;
grant select,insert,update on pee_license_notices to pee_license_runtime;
grant pee_license_runtime to postgres;grant create on schema public to pee_license_runtime;
create function pee_notice_system(p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare n pee_license_notices;
begin
 if p_action='prepare'then
  insert into pee_license_notices(id,license_id,request_hash,recipient_hash,state)values((p_data->>'id')::uuid,(p_data->>'license_id')::uuid,p_data->>'request_hash',p_data->>'recipient_hash','prepared')on conflict(id)do nothing;
  select * into n from pee_license_notices where id=(p_data->>'id')::uuid for update;
  if n.license_id<>(p_data->>'license_id')::uuid or n.request_hash<>p_data->>'request_hash'or n.recipient_hash<>p_data->>'recipient_hash'then raise exception 'PEE_NOTICE_IDEMPOTENCY'using errcode='40001';end if;
 elsif p_action='start'then
  select * into n from pee_license_notices where id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'PEE_NOT_FOUND'using errcode='P0002';end if;
  if n.request_hash<>p_data->>'request_hash'then raise exception 'PEE_NOTICE_IDEMPOTENCY'using errcode='40001';end if;
  if n.provider_id is not null then return to_jsonb(n);end if;
  if n.state='sending'and n.attempt_started_at>now()-interval '5 minutes'then raise exception 'PEE_NOTICE_INFLIGHT'using errcode='40001';end if;
  if n.attempt_started_at<now()-interval '23 hours'then raise exception 'PEE_NOTICE_REVIEW_REQUIRED'using errcode='40001';end if;
  update pee_license_notices set state='sending',attempt_started_at=coalesce(attempt_started_at,now())where id=n.id returning * into n;
 elsif p_action='accepted'then
  update pee_license_notices set provider_id=(p_data->>'provider_id')::uuid,state='accepted'where id=(p_data->>'id')::uuid and state='sending'returning * into n;
 elsif p_action='uncertain'then
  update pee_license_notices set state='unknown'where id=(p_data->>'id')::uuid and state='sending'returning * into n;
 elsif p_action='status'then
  select * into n from pee_license_notices where id=(p_data->>'id')::uuid;
 elsif p_action='observed'then
  update pee_license_notices set state=case when p_data->>'state'='delivered'then'delivered'when p_data->>'state'='failed'then'failed'else state end,delivered_at=case when p_data->>'state'='delivered'then coalesce(delivered_at,now())else delivered_at end where id=(p_data->>'id')::uuid and provider_id=(p_data->>'provider_id')::uuid returning * into n;
 else raise exception 'PEE_ACTION';end if;
 if n.id is null then raise exception 'PEE_NOT_FOUND'using errcode='P0002';end if;
 return to_jsonb(n);
end$$;
revoke all on function pee_notice_system(text,jsonb)from public,anon,authenticated;
grant execute on function pee_notice_system(text,jsonb)to service_role;
alter function pee_notice_system(text,jsonb)owner to pee_license_runtime;
revoke create on schema public from pee_license_runtime;revoke pee_license_runtime from postgres;
insert into pee_schema_versions(version)values(8);
commit;
