-- Append-only commercial notices from the private project workspace to the Core.
begin;
create function pee_royalty_user(p_actor uuid,p_tenant uuid,p_role text,p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare n jsonb:=p_data->'notice';r pee_records;d pee_records;e pee_emission_contracts;v jsonb;expected bigint;
begin
 perform public.pee_store_v2(p_actor,p_tenant,p_role,false,'usage','{}');
 if p_role not in('manager','reviewer')or p_tenant='5a0df16a-1221-439b-a6db-8ab143273a78'then raise exception 'PEE_ROLE'using errcode='42501';end if;
 perform id from pee_tenants where id=p_tenant for update;
 if p_action='prepare'then
  if(n->>'license_id')::uuid<>p_tenant then raise exception 'PEE_ROYALTY_SCOPE'using errcode='42501';end if;
  select * into r from pee_records where id=(n->>'event_id')::uuid;
  if found then if r.kind<>'royalty'or r.payload->'notice'<>n then raise exception 'PEE_ROYALTY_IDEMPOTENCY'using errcode='40001';end if;return to_jsonb(r);end if;
  if not exists(select 1 from pee_records where id=(n->>'project_reference')::uuid and kind='project'and (n->>'kind'<>'approval'or payload->>'phase'='Aprovado'))then raise exception 'PEE_ROYALTY_APPROVAL_REQUIRED';end if;
  select * into d from pee_records where kind='document'and payload->>'project_id'=n->>'project_reference'and payload->>'category'='official_decision'and payload->>'sha256'=n->>'decision_sha256'and payload->>'signature_review'='verified';
  if not found then raise exception 'PEE_ROYALTY_DECISION_EVIDENCE';end if;
  select * into e from pee_emission_contracts where emission_id=(n->>'emission_reference')::uuid and contract_hash=n->>'contract_hash'and contract_version=(n->>'contract_version')::integer;
  if not found or not exists(select 1 from pee_emissions where id=e.emission_id and project_id=(n->>'project_reference')::uuid)then raise exception 'PEE_ROYALTY_EMISSION_REQUIRED';end if;
  insert into pee_records(tenant_id,id,kind,payload,created_by,updated_by)values(p_tenant,(n->>'event_id')::uuid,'royalty',jsonb_build_object('notice',n,'rate_bps',e.royalty_bps,'status','pending_core'),p_actor,p_actor)returning * into r;
  insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'royalty.prepared',r.id,jsonb_build_object('project_reference',n->>'project_reference'));return to_jsonb(r);
 elsif p_action='confirm'then
  select * into r from pee_records where id=(p_data->>'id')::uuid and kind='royalty'for update;
  if not found then raise exception 'PEE_NOT_FOUND'using errcode='P0002';end if;
  n=r.payload->'notice';v=p_data->'receipt';expected=round((n->>'approved_pee_cents')::numeric*(r.payload->>'rate_bps')::numeric/10000)::bigint;
  if(v->>'id')::uuid<>r.id or(v->>'royalty_cents')::bigint<>expected or(v->>'base_cents')::bigint<>(n->>'approved_pee_cents')::bigint or(v->>'rate_bps')::integer<>(r.payload->>'rate_bps')::integer then raise exception 'PEE_ROYALTY_CONFIRMATION_MISMATCH';end if;
  if r.payload->>'status'='confirmed'then if r.payload->'receipt'<>v then raise exception 'PEE_ROYALTY_IDEMPOTENCY'using errcode='40001';end if;return to_jsonb(r);end if;
  update pee_records set payload=payload||jsonb_build_object('status','confirmed','receipt',v),version=version+1,updated_by=p_actor,updated_at=now()where id=r.id returning * into r;
  insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'royalty.confirmed',r.id,v);return to_jsonb(r);
 else raise exception 'PEE_ACTION';end if;
end$$;
revoke all on function pee_royalty_user(uuid,uuid,text,text,jsonb)from public,anon,authenticated;
grant execute on function pee_royalty_user(uuid,uuid,text,text,jsonb)to service_role;
grant pee_runtime to postgres;
grant create on schema public to pee_runtime;
alter function pee_royalty_user(uuid,uuid,text,text,jsonb)owner to pee_runtime;
revoke create on schema public from pee_runtime;
revoke pee_runtime from postgres;
grant pee_runtime to postgres;
grant create on schema public to pee_runtime;
create function pee_licensed_status(p_actor uuid,p_tenant uuid,p_role text)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare usage jsonb;result jsonb;
begin
 usage:=public.pee_store_v2(p_actor,p_tenant,p_role,false,'usage','{}');
 select jsonb_build_object('usage',usage,'license',(select jsonb_build_object('id',core_reference,'contract_hash',contract_hash,'contract_version',contract_version,'signature_reference',signature_reference,'started_at',started_at,'auto_renew',auto_renew,'next_renewal_at',next_renewal_at,'monthly_cents',monthly_cents,'cancellation_requested_at',cancellation_requested_at,'cancellation_effective_at',cancellation_effective_at,'expires_at',expires_at,'monthly_limit',monthly_limit,'seats',seats,'royalty_rate',royalty_rate,'version',version)from pee_licenses),'emissions',coalesce((select jsonb_agg(x)from(select e.id,e.project_id,e.created_at,e.document_hash,c.contract_hash,c.contract_version,c.royalty_bps from pee_emissions e join pee_emission_contracts c on c.tenant_id=e.tenant_id and c.emission_id=e.id order by e.created_at desc limit 2000)x),'[]'))into result;return result;
end$$;
revoke all on function pee_licensed_status(uuid,uuid,text)from public,anon,authenticated;
grant execute on function pee_licensed_status(uuid,uuid,text)to service_role;
alter function pee_licensed_status(uuid,uuid,text)owner to pee_runtime;
revoke create on schema public from pee_runtime;
revoke pee_runtime from postgres;
grant select on pee_emissions,pee_emission_contracts to pee_license_runtime;
create policy licensed_emission_metadata on pee_emissions for select to pee_license_runtime using(tenant_id::text=current_setting('pee.tenant',true));
create policy licensed_emission_contract_metadata on pee_emission_contracts for select to pee_license_runtime using(tenant_id::text=current_setting('pee.tenant',true));
grant pee_license_runtime to postgres;grant create on schema public to pee_license_runtime;
create function pee_verify_licensed_emission(p_license uuid,p_project uuid,p_emission uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb;
begin
 if p_license is null or p_project is null or p_emission is null or p_license='5a0df16a-1221-439b-a6db-8ab143273a78'then raise exception 'PEE_SCOPE'using errcode='42501';end if;
 perform set_config('pee.tenant',p_license::text,true);
 select jsonb_build_object('eligible',true,'license_id',e.tenant_id,'project_reference',e.project_id,'emission_reference',e.id,'contract_hash',c.contract_hash,'contract_version',c.contract_version,'royalty_bps',c.royalty_bps)into r from pee_emissions e join pee_emission_contracts c on c.tenant_id=e.tenant_id and c.emission_id=e.id where e.id=p_emission and e.project_id=p_project;
 if r is null then return jsonb_build_object('eligible',false);end if;return r;
end$$;
revoke all on function pee_verify_licensed_emission(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function pee_verify_licensed_emission(uuid,uuid,uuid)to service_role;
alter function pee_verify_licensed_emission(uuid,uuid,uuid)owner to pee_license_runtime;
revoke create on schema public from pee_license_runtime;revoke pee_license_runtime from postgres;
insert into pee_schema_versions(version)values(7);
commit;
