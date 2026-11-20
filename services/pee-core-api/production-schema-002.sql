-- Version 2: enforce the already approved reviewer workflow and read quota from real emissions.
-- No direct/browser grants or tenant policies are changed.
begin;
grant pee_runtime to postgres with set true, inherit false;
grant create on schema public to pee_runtime;
set local role pee_runtime;
create or replace function public.pee_store(p_actor uuid,p_tenant uuid,p_role text,p_core boolean,p_action text,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text;v_license public.pee_licenses;v_kind text;v_id uuid;v_old public.pee_records;v_row public.pee_records;v_result jsonb;v_limit integer;v_count integer;v_month date;v_emission public.pee_emissions;
begin
 if p_actor is null or p_tenant is null or p_role is null or p_core is null then raise exception 'PEE_UNAUTHORIZED' using errcode='42501';end if;
 perform set_config('pee.tenant',p_tenant::text,true);
 if p_core then
  if p_tenant<>'5a0df16a-1221-439b-a6db-8ab143273a78'::uuid or not exists(select 1 from public.pee_tenants where id=p_tenant and core_workspace)or p_role not in('editor','reviewer','viewer')then raise exception 'PEE_SCOPE' using errcode='42501';end if;v_role=p_role;
 else
  if exists(select 1 from public.pee_tenants where id=p_tenant and core_workspace)then raise exception 'PEE_LICENSE_CORE_TENANT_FORBIDDEN'using errcode='42501';end if;
  select m.role into v_role from public.pee_members m where m.tenant_id=p_tenant and m.user_id=p_actor and m.active;
  select * into v_license from public.pee_licenses where tenant_id=p_tenant;
  if v_role is null or v_role<>p_role or v_license.status is distinct from 'active' or v_license.expires_at<=now()then raise exception 'PEE_LICENSE_INACTIVE' using errcode='42501';end if;
 end if;
 if p_action='list' then
  v_kind=p_data->>'kind';if v_kind not in('company','unit','project','simulation','document','rule','workflow','communication','royalty')then raise exception 'PEE_KIND';end if;
  if v_role='finance' and v_kind not in('royalty')then raise exception 'PEE_ROLE' using errcode='42501';end if;
  select coalesce(jsonb_agg(to_jsonb(r)order by r.updated_at desc),'[]')into v_result from(select * from public.pee_records where kind=v_kind limit 2000)r;return v_result;
 elsif p_action='snapshot' then
  if v_role='finance'then raise exception 'PEE_ROLE'using errcode='42501';end if;
  select * into v_old from public.pee_records where id=(p_data->>'project_id')::uuid and kind='project';
  if not found then raise exception 'PEE_NOT_FOUND'using errcode='P0002';end if;
  select jsonb_build_object('project',to_jsonb(v_old),'records',coalesce(jsonb_agg(to_jsonb(r)order by r.id),'[]'))into v_result from public.pee_records r where
   (r.kind in('simulation','document','workflow')and r.payload->>'project_id'=v_old.id::text)or
   (r.kind='rule'and r.id::text=v_old.payload->>'rule_id')or
   (r.kind='company'and r.id::text=v_old.payload->>'company_id')or
   (r.kind='unit'and r.id::text=v_old.payload->>'unit_id');
  return v_result||jsonb_build_object('snapshot_hash',encode(sha256(convert_to(v_result::text,'UTF8')),'hex'),'technical_hash',encode(sha256(convert_to(jsonb_build_object('project_id',v_old.id,'technical',v_old.payload-array['scoring','reviewed_domains','action_assignments','technical_review','mv_review','qualification','phase','decision','version','id','created_at','updated_at'],'records',(select coalesce(jsonb_agg(n.value order by n.value->>'id'),'[]')from jsonb_array_elements(v_result->'records')as n(value)where n.value->>'kind'<>'workflow'))::text,'UTF8')),'hex'));
 elsif p_action='get' then
  select * into v_row from public.pee_records where id=(p_data->>'id')::uuid;
  if not found then raise exception 'PEE_NOT_FOUND' using errcode='P0002';end if;
  if v_role='finance' and v_row.kind<>'royalty'then raise exception 'PEE_ROLE' using errcode='42501';end if;return to_jsonb(v_row);
 elsif p_action='put' then
  v_kind=p_data->>'kind';v_id=(p_data->>'id')::uuid;
  if v_role not in('editor','manager','reviewer') or v_role='reviewer' and v_kind not in('document','workflow','project','rule')or v_kind not in('company','unit','project','simulation','document','rule','workflow','communication')then raise exception 'PEE_WRITE_ROLE' using errcode='42501';end if;
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
  if p_data->>'snapshot_hash' is not null and p_data->>'snapshot_hash'<>(public.pee_store(p_actor,p_tenant,p_role,p_core,'snapshot',jsonb_build_object('project_id',p_data->>'project_id'))->>'snapshot_hash')then raise exception 'PEE_SNAPSHOT_CHANGED'using errcode='40001';end if;
  select * into v_emission from public.pee_emissions where id=v_id;
  if found then if v_emission.actor_id<>p_actor or v_emission.project_id<>(p_data->>'project_id')::uuid or v_emission.document_hash<>p_data->>'document_hash'then raise exception 'PEE_IDEMPOTENCY_CONFLICT'using errcode='40001';end if;return to_jsonb(v_emission);end if;
  if not exists(select 1 from public.pee_records where id=(p_data->>'project_id')::uuid and kind='project')then raise exception 'PEE_PROJECT_NOT_FOUND'using errcode='P0002';end if;
  v_limit=case when p_core then (p_data->>'monthly_limit')::integer else v_license.monthly_limit end;
  if v_limit is null or v_limit<1 or v_limit>10000 then raise exception 'PEE_LIMIT';end if;
  select count(distinct project_id)into v_count from public.pee_emissions where month=v_month and(not p_core or actor_id=p_actor);
  if v_count>=v_limit and not exists(select 1 from public.pee_emissions where month=v_month and project_id=(p_data->>'project_id')::uuid and(not p_core or actor_id=p_actor))then raise exception 'PEE_QUOTA_EXCEEDED'using errcode='P0001';end if;
  insert into public.pee_emissions(tenant_id,id,actor_id,project_id,month,document_hash)values(p_tenant,v_id,p_actor,(p_data->>'project_id')::uuid,v_month,p_data->>'document_hash')returning * into v_emission;
  insert into public.pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'project.emitted',v_emission.project_id,jsonb_build_object('emission_id',v_id,'hash',v_emission.document_hash));return to_jsonb(v_emission);
 elsif p_action='usage' then
  v_month=date_trunc('month',timezone('America/Sao_Paulo',now()))::date;
  v_limit=case when p_core then (p_data->>'monthly_limit')::integer else v_license.monthly_limit end;
  if v_limit is null or v_limit<1 or v_limit>10000 then raise exception 'PEE_LIMIT';end if;
  select count(distinct project_id)into v_count from public.pee_emissions where month=v_month and(not p_core or actor_id=p_actor);
  return jsonb_build_object('month',v_month,'used',v_count,'limit',v_limit,'remaining',greatest(0,v_limit-v_count),'source',case when p_core then 'core_grant' else 'paid_license' end,'license_status',case when p_core then 'core_access' else v_license.status end,'expires_at',case when p_core then null else v_license.expires_at end,'royalty_rate',case when p_core then null else v_license.royalty_rate end);
 elsif p_action='audit' then
  if v_role='finance'then raise exception 'PEE_ROLE'using errcode='42501';end if;
  select coalesce(jsonb_agg(to_jsonb(a)order by a.id desc),'[]')into v_result from(select id,actor_id,action,record_id,detail,created_at from public.pee_audit order by id desc limit 500)a;return v_result;
 else raise exception 'PEE_ACTION';end if;
end$$;
revoke all on function public.pee_store(uuid,uuid,text,boolean,text,jsonb)from public,anon,authenticated;
grant execute on function public.pee_store(uuid,uuid,text,boolean,text,jsonb)to service_role;
alter function public.pee_store(uuid,uuid,text,boolean,text,jsonb)owner to pee_runtime;
set local role postgres;
revoke pee_runtime from postgres;
revoke create on schema public from pee_runtime;
insert into public.pee_schema_versions(version)values(2);
commit;
