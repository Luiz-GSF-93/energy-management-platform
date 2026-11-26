-- EnergyOS PEE dedicated project only. Never apply to the existing EnergyOS DB.
begin;
create table public.pee_schema_versions(version integer primary key, applied_at timestamptz not null default now());
create table public.pee_tenants(id uuid primary key,name text not null,core_workspace boolean not null default false,created_at timestamptz not null default now());
create table public.pee_members(tenant_id uuid not null references public.pee_tenants(id),user_id uuid not null,role text not null check(role in('manager','editor','reviewer','viewer','finance')),active boolean not null default false,version integer not null default 1,primary key(tenant_id,user_id));
create table public.pee_licenses(tenant_id uuid primary key references public.pee_tenants(id),core_reference uuid not null unique,status text not null check(status in('pending','active','suspended','expired')),contract_version integer not null,contract_hash text not null,signature_reference text not null,expires_at timestamptz not null,monthly_limit integer not null check(monthly_limit>0),seats integer not null check(seats>0),royalty_rate numeric not null check(royalty_rate between 0 and 100),version integer not null default 1);
create table public.pee_records(tenant_id uuid not null references public.pee_tenants(id),id uuid not null,kind text not null check(kind in('company','unit','project','simulation','document','rule','workflow','communication','royalty')),payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=524288),version integer not null default 1,created_by uuid not null,updated_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),primary key(tenant_id,id));
create index pee_records_kind on public.pee_records(tenant_id,kind,updated_at desc);
create table public.pee_audit(id bigint generated always as identity primary key,tenant_id uuid not null references public.pee_tenants(id),actor_id uuid not null,action text not null,record_id uuid,detail jsonb not null default '{}',created_at timestamptz not null default now());
create table public.pee_emissions(tenant_id uuid not null references public.pee_tenants(id),id uuid not null,actor_id uuid not null,project_id uuid not null,month date not null,document_hash text not null,created_at timestamptz not null default now(),primary key(tenant_id,id));
create index pee_emissions_month on public.pee_emissions(tenant_id,month,actor_id);
do $$begin if not exists(select 1 from pg_roles where rolname='pee_runtime')then create role pee_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;end if;end$$;
grant pee_runtime to postgres with set true, inherit false;
grant usage on schema public to pee_runtime;
grant create on schema public to pee_runtime;
grant update(id)on public.pee_tenants to pee_runtime;
grant select,insert,update on public.pee_records to pee_runtime;
grant select on public.pee_tenants,public.pee_members,public.pee_licenses to pee_runtime;
grant select,insert on public.pee_audit,public.pee_emissions to pee_runtime;
grant usage,select on sequence public.pee_audit_id_seq to pee_runtime;
alter table public.pee_tenants enable row level security;
alter table public.pee_tenants force row level security;
create policy pee_tenant_scope on public.pee_tenants to pee_runtime using(id::text=current_setting('pee.tenant',true));
do $$declare t text;begin foreach t in array array['pee_members','pee_licenses','pee_records','pee_audit','pee_emissions']loop execute format('alter table public.%I enable row level security',t);execute format('alter table public.%I force row level security',t);execute format('create policy tenant_scope on public.%I to pee_runtime using(tenant_id::text=current_setting(''pee.tenant'',true)) with check(tenant_id::text=current_setting(''pee.tenant'',true))',t);end loop;end$$;
revoke all on public.pee_tenants,public.pee_members,public.pee_licenses,public.pee_records,public.pee_audit,public.pee_emissions,public.pee_schema_versions from public,anon,authenticated,service_role;
insert into public.pee_tenants(id,name,core_workspace)values('5a0df16a-1221-439b-a6db-8ab143273a78','Expert Energy',true);
create function public.pee_store(p_actor uuid,p_tenant uuid,p_role text,p_core boolean,p_action text,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text;v_license public.pee_licenses;v_kind text;v_id uuid;v_old public.pee_records;v_row public.pee_records;v_result jsonb;v_limit integer;v_count integer;v_month date;v_emission public.pee_emissions;
begin
 if p_actor is null or p_tenant is null or p_role is null or p_core is null then raise exception 'PEE_UNAUTHORIZED' using errcode='42501';end if;
 perform set_config('pee.tenant',p_tenant::text,true);
 if p_core then
  if p_tenant<>'5a0df16a-1221-439b-a6db-8ab143273a78'::uuid or not exists(select 1 from public.pee_tenants where id=p_tenant and core_workspace)or p_role not in('editor','reviewer','viewer')then raise exception 'PEE_SCOPE' using errcode='42501';end if;v_role=p_role;
 else
  select m.role into v_role from public.pee_members m where m.tenant_id=p_tenant and m.user_id=p_actor and m.active;
  select * into v_license from public.pee_licenses where tenant_id=p_tenant;
  if v_role is null or v_role<>p_role or v_license.status is distinct from 'active' or v_license.expires_at<=now()then raise exception 'PEE_LICENSE_INACTIVE' using errcode='42501';end if;
 end if;
 if p_action='list' then
  v_kind=p_data->>'kind';if v_kind not in('company','unit','project','simulation','document','rule','workflow','communication','royalty')then raise exception 'PEE_KIND';end if;
  if v_role='finance' and v_kind not in('royalty')then raise exception 'PEE_ROLE' using errcode='42501';end if;
  select coalesce(jsonb_agg(to_jsonb(r)order by r.updated_at desc),'[]')into v_result from(select * from public.pee_records where kind=v_kind limit 2000)r;return v_result;
 elsif p_action='get' then
  select * into v_row from public.pee_records where id=(p_data->>'id')::uuid;
  if not found then raise exception 'PEE_NOT_FOUND' using errcode='P0002';end if;
  if v_role='finance' and v_row.kind<>'royalty'then raise exception 'PEE_ROLE' using errcode='42501';end if;return to_jsonb(v_row);
 elsif p_action='put' then
  v_kind=p_data->>'kind';v_id=(p_data->>'id')::uuid;
  if v_role not in('editor','manager','reviewer') or v_role='reviewer' and v_kind not in('document','workflow')or v_kind not in('company','unit','project','simulation','document','rule','workflow','communication')then raise exception 'PEE_WRITE_ROLE' using errcode='42501';end if;
  if jsonb_typeof(p_data->'payload')is distinct from 'object'then raise exception 'PEE_PAYLOAD';end if;
  perform id from public.pee_tenants where id=p_tenant for update;
  select * into v_old from public.pee_records where id=v_id for update;
  if found then
   if v_old.kind<>v_kind or v_old.version<>(p_data->>'expected_version')::integer then raise exception 'PEE_VERSION_CONFLICT' using errcode='40001';end if;
   update public.pee_records set payload=p_data->'payload',version=version+1,updated_by=p_actor,updated_at=now()where id=v_id returning * into v_row;
  else
   if (p_data->>'expected_version')::integer is distinct from 0 then raise exception 'PEE_VERSION_CONFLICT' using errcode='40001';end if;
   insert into public.pee_records(tenant_id,id,kind,payload,created_by,updated_by)values(p_tenant,v_id,v_kind,p_data->'payload',p_actor,p_actor)returning * into v_row;
  end if;
  insert into public.pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,v_kind||'.saved',v_id,jsonb_build_object('version',v_row.version,'previous',case when v_old.id is null then null else to_jsonb(v_old)end));return to_jsonb(v_row);
 elsif p_action='emit' then
  if v_role not in('editor','manager','reviewer')then raise exception 'PEE_ROLE' using errcode='42501';end if;
  v_id=(p_data->>'id')::uuid;v_month=date_trunc('month',timezone('America/Sao_Paulo',now()))::date;
  perform id from public.pee_tenants where id=p_tenant for update;
  select * into v_emission from public.pee_emissions where id=v_id;
  if found then if v_emission.actor_id<>p_actor or v_emission.project_id<>(p_data->>'project_id')::uuid or v_emission.document_hash<>p_data->>'document_hash'then raise exception 'PEE_IDEMPOTENCY_CONFLICT'using errcode='40001';end if;return to_jsonb(v_emission);end if;
  if not exists(select 1 from public.pee_records where id=(p_data->>'project_id')::uuid and kind='project')then raise exception 'PEE_PROJECT_NOT_FOUND'using errcode='P0002';end if;
  v_limit=case when p_core then (p_data->>'monthly_limit')::integer else v_license.monthly_limit end;
  if v_limit is null or v_limit<1 or v_limit>10000 then raise exception 'PEE_LIMIT';end if;
  select count(distinct project_id)into v_count from public.pee_emissions where month=v_month and(not p_core or actor_id=p_actor);
  if v_count>=v_limit and not exists(select 1 from public.pee_emissions where month=v_month and project_id=(p_data->>'project_id')::uuid and(not p_core or actor_id=p_actor))then raise exception 'PEE_QUOTA_EXCEEDED'using errcode='P0001';end if;
  insert into public.pee_emissions(tenant_id,id,actor_id,project_id,month,document_hash)values(p_tenant,v_id,p_actor,(p_data->>'project_id')::uuid,v_month,p_data->>'document_hash')returning * into v_emission;
  insert into public.pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'project.emitted',v_emission.project_id,jsonb_build_object('emission_id',v_id,'hash',v_emission.document_hash));return to_jsonb(v_emission);
 elsif p_action='audit' then
  if v_role='finance'then raise exception 'PEE_ROLE'using errcode='42501';end if;
  select coalesce(jsonb_agg(to_jsonb(a)order by a.id desc),'[]')into v_result from(select id,actor_id,action,record_id,detail,created_at from public.pee_audit order by id desc limit 500)a;return v_result;
 else raise exception 'PEE_ACTION';end if;
end$$;
revoke all on function public.pee_store(uuid,uuid,text,boolean,text,jsonb)from public,anon,authenticated;
grant execute on function public.pee_store(uuid,uuid,text,boolean,text,jsonb)to service_role;
alter function public.pee_store(uuid,uuid,text,boolean,text,jsonb)owner to pee_runtime;
revoke pee_runtime from postgres;
revoke create on schema public from pee_runtime;
insert into public.pee_schema_versions(version)values(1);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('pee-private','pee-private',false,20971520,array['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain','text/html']);
-- No browser storage policy. All uploads/downloads pass through authenticated API.
commit;
