-- Dedicated PEE database only. Customer capability is restricted to one invitation/project.
begin;
create table pee_portal_invites(tenant_id uuid not null references pee_tenants,id uuid not null,project_id uuid not null,client_id uuid not null,name text not null,email text not null,token_hash text not null check(token_hash~'^[a-f0-9]{64}$'),expires_at timestamptz not null,created_by uuid not null,created_at timestamptz not null default now(),revoked_at timestamptz,used_at timestamptz,session_hash text,session_expires_at timestamptz,session_absolute_at timestamptz,primary key(tenant_id,id),foreign key(tenant_id,project_id)references pee_records(tenant_id,id));
create table pee_portal_requests(tenant_id uuid not null,id uuid not null,invite_id uuid not null,project_id uuid not null,title text not null,instructions text not null,fields jsonb not null,simulation_id uuid,answers jsonb not null default '{}',category text not null,requirement_id uuid,original_id uuid,signed_id uuid,evidence_id uuid,state text not null default 'requested' check(state in('requested','submitted','returned','accepted')),review_note text,version integer not null default 1,created_at timestamptz not null default now(),submitted_at timestamptz,primary key(tenant_id,id),foreign key(tenant_id,invite_id)references pee_portal_invites(tenant_id,id),foreign key(tenant_id,original_id)references pee_records(tenant_id,id));
alter table pee_portal_invites add column resume_hash text,add column resume_expires_at timestamptz,add column resume_requested_at timestamptz,add column resume_count integer not null default 0;
grant pee_runtime to postgres with set true,inherit false;
grant create on schema public to pee_runtime;
grant select,insert,update on pee_portal_invites,pee_portal_requests to pee_runtime;
do $$declare t text;begin foreach t in array array['pee_portal_invites','pee_portal_requests']loop
 execute format('alter table %I enable row level security',t);execute format('alter table %I force row level security',t);
 execute format('create policy portal_tenant_scope on %I to pee_runtime using(tenant_id::text=current_setting(''pee.tenant'',true))with check(tenant_id::text=current_setting(''pee.tenant'',true))',t);
end loop;end$$;
revoke all on pee_portal_invites,pee_portal_requests from public,anon,authenticated,service_role;
set local role pee_runtime;
create function pee_portal_manage(p_actor uuid,p_tenant uuid,p_role text,p_core boolean,p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb;i pee_portal_invites;r pee_portal_requests;d pee_records;
begin
 perform pee_store(p_actor,p_tenant,p_role,p_core,'usage','{"monthly_limit":1}');
 if p_role not in('manager','editor','reviewer')then raise exception 'PEE_ROLE'using errcode='42501';end if;
 if p_action='list'then
  select coalesce(jsonb_agg(to_jsonb(x)-'token_hash'-'session_hash'-'resume_hash'),'[]')into v from pee_portal_invites x where project_id=(p_data->>'project_id')::uuid;
  return jsonb_build_object('invites',v,'requests',(select coalesce(jsonb_agg(to_jsonb(x)order by created_at),'[]')from pee_portal_requests x where project_id=(p_data->>'project_id')::uuid));
 end if;
 if p_action='invite'then
  if p_role not in('editor','manager')or not exists(select 1 from pee_records where id=(p_data->>'project_id')::uuid and kind='project')or p_data->>'token_hash'!~'^[a-f0-9]{64}$'or length(p_data->>'name')not between 2 and 200 or length(p_data->>'email')not between 3 and 254 then raise exception 'PEE_PORTAL_INPUT'using errcode='42501';end if;
  if(select count(*)from pee_portal_invites where project_id=(p_data->>'project_id')::uuid and revoked_at is null)>50 then raise exception 'PEE_PORTAL_LIMIT';end if;
  insert into pee_portal_invites(tenant_id,id,project_id,client_id,name,email,token_hash,expires_at,created_by)values(p_tenant,(p_data->>'id')::uuid,(p_data->>'project_id')::uuid,(p_data->>'client_id')::uuid,p_data->>'name',p_data->>'email',p_data->>'token_hash',now()+interval '7 days',p_actor)returning * into i;
  insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'portal.invited',i.project_id,jsonb_build_object('invite_id',i.id,'name',i.name,'email',i.email,'expires_at',i.expires_at));return to_jsonb(i)-'token_hash'-'session_hash'-'resume_hash';
 end if;
 select * into i from pee_portal_invites where id=(p_data->>'invite_id')::uuid for update;
 if not found then raise exception 'PEE_NOT_FOUND'using errcode='P0002';end if;
 if p_action='mail_result'and p_role in('manager','editor')then
  if p_data->>'state'not in('accepted','unknown')then raise exception 'PEE_MAIL_STATE';end if;
  insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'portal.invitation_mail',i.project_id,jsonb_build_object('invite_id',i.id,'recipient',i.email,'state',p_data->>'state','provider_id',p_data->>'provider_id'));return jsonb_build_object('recorded',true);
 elsif p_action='renew'and p_role in('manager','editor')then
  if i.revoked_at is not null or not coalesce(p_data->>'token_hash'~'^[a-f0-9]{64}$',false)then raise exception 'PEE_UNAUTHORIZED'using errcode='42501';end if;
  update pee_portal_invites set token_hash=p_data->>'token_hash',expires_at=now()+interval '7 days',used_at=null,session_hash=null,session_expires_at=null,session_absolute_at=null,resume_hash=null,resume_expires_at=null,resume_requested_at=null,resume_count=0 where id=i.id returning * into i;
  insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'portal.renewed',i.project_id,jsonb_build_object('invite_id',i.id,'client_name',i.name,'expires_at',i.expires_at,'history_preserved',true));
  return to_jsonb(i)-'token_hash'-'session_hash'-'resume_hash';
 elsif p_action='revoke'and p_role in('manager','editor')then
  update pee_portal_invites set revoked_at=now(),session_hash=null where id=i.id;
 elsif p_action='request'and p_role in('manager','editor')then
  if i.revoked_at is not null or i.expires_at<=now()or jsonb_typeof(p_data->'fields')is distinct from 'array'or jsonb_array_length(p_data->'fields')>40 or octet_length(p_data::text)>40000 then raise exception 'PEE_PORTAL_INPUT';end if;
  if p_data->>'original_id'is not null then select * into d from pee_records where id=(p_data->>'original_id')::uuid and kind='document'and payload->>'project_id'=i.project_id::text;if not found or d.payload->>'signature_review'='verified'or d.payload->>'category'='signature_evidence'then raise exception 'PEE_ORIGINAL';end if;end if;
  if p_data->>'category'='manufacturer_manual'and not exists(select 1 from pee_records where id=(p_data->>'simulation_id')::uuid and kind='simulation'and payload->>'project_id'=i.project_id::text)then raise exception 'PEE_SIMULATION';end if;
  insert into pee_portal_requests(tenant_id,id,invite_id,project_id,title,instructions,fields,category,requirement_id,original_id,simulation_id)values(p_tenant,(p_data->>'id')::uuid,i.id,i.project_id,p_data->>'title',p_data->>'instructions',p_data->'fields',p_data->>'category',(p_data->>'requirement_id')::uuid,(p_data->>'original_id')::uuid,(p_data->>'simulation_id')::uuid)returning * into r;
 elsif p_action='review'and p_role in('manager','reviewer')then
  select * into r from pee_portal_requests where id=(p_data->>'id')::uuid and invite_id=i.id for update;
  if not found or r.version<>(p_data->>'version')::integer or r.state<>'submitted'or p_data->>'state'not in('accepted','returned')or length(p_data->>'note')not between 20 and 3000 then raise exception 'PEE_PORTAL_REVIEW'using errcode='40001';end if;
  -- Acceptance of the request does not itself approve a signature or engineering contents.
  if p_data->>'state'='accepted'and not exists(select 1 from pee_records where id=r.original_id and payload->>'signature_review'='verified'and payload->>'signed_document_id'=r.signed_id::text and payload->>'signature_evidence_id'=r.evidence_id::text)then raise exception 'PEE_SIGNATURE_REVIEW_REQUIRED';end if;
  if p_data->>'state'='accepted'and r.requirement_id is not null then
   if not exists(select 1 from pee_records p join pee_records rule on rule.id=(p.payload->>'rule_id')::uuid cross join lateral jsonb_array_elements(rule.payload->'requirements')x where p.id=r.project_id and rule.kind='rule'and x->>'id'=r.requirement_id::text)then raise exception 'PEE_REQUIREMENT_CHANGED';end if;
   update pee_records set payload=jsonb_set(payload,'{requirement_answers}',coalesce(payload->'requirement_answers','{}')||jsonb_build_object(r.requirement_id::text,jsonb_build_object('answer',(select string_agg((f->>'label')||': '||coalesce(r.answers->>(f->>'id'),''),E'\n')from jsonb_array_elements(r.fields)f))),true),version=version+1,updated_by=p_actor,updated_at=now()where id=r.project_id;
   update pee_records set payload=payload||jsonb_build_object('requirement_id',r.requirement_id),version=version+1,updated_by=p_actor,updated_at=now()where id=r.original_id;
   insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'portal.requirement_integrated',r.project_id,jsonb_build_object('request_id',r.id,'requirement_id',r.requirement_id,'technical_review_must_be_refreshed',true));
  end if;
  update pee_portal_requests set state=p_data->>'state',review_note=p_data->>'note',version=version+1 where id=r.id returning * into r;
 else raise exception 'PEE_ROLE'using errcode='42501';end if;
 insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'portal.'||p_action,i.project_id,jsonb_build_object('invite_id',i.id,'request_id',r.id,'state',r.state));return coalesce(to_jsonb(r),jsonb_build_object('revoked',true));
end$$;
create function pee_portal_client(p_tenant uuid,p_invite uuid,p_hash text,p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare i pee_portal_invites;r pee_portal_requests;d pee_records;f jsonb;v jsonb;p pee_records;
begin
 if p_hash is null or p_hash!~'^[a-f0-9]{64}$'or p_tenant is null or p_invite is null then raise exception 'PEE_UNAUTHORIZED'using errcode='42501';end if;
 perform set_config('pee.tenant',p_tenant::text,true);
 select * into i from pee_portal_invites where id=p_invite for update;
 if not found or i.revoked_at is not null or i.expires_at<=now()then raise exception 'PEE_UNAUTHORIZED'using errcode='42501';end if;
 if p_action='resume_request'then
  if lower(i.email)is distinct from lower(p_data->>'email')or i.resume_requested_at>now()-interval '1 hour'and i.resume_count>=5 then return null;end if;
  if not coalesce(p_data->>'resume_hash'~'^[a-f0-9]{64}$',false)then raise exception 'PEE_INPUT';end if;
  update pee_portal_invites set resume_hash=p_data->>'resume_hash',resume_expires_at=least(now()+interval '15 minutes',expires_at),resume_count=case when resume_requested_at>now()-interval '1 hour'then resume_count+1 else 1 end,resume_requested_at=now()where id=i.id;
  insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,i.client_id,'portal.resume_requested',i.project_id,jsonb_build_object('client_name',i.name,'invite_id',i.id));
  return jsonb_build_object('name',i.name,'email',i.email);
 end if;
 if p_action='exchange_context'then
  if not coalesce(i.used_at is null and i.token_hash=p_hash or i.resume_hash=p_hash and i.resume_expires_at>now(),false)then raise exception 'PEE_UNAUTHORIZED'using errcode='42501';end if;
  return jsonb_build_object('created_by',i.created_by,'tenant_id',i.tenant_id);
 end if;
 if p_action='context'then
  if i.session_hash is distinct from p_hash or i.session_expires_at<=now()or i.session_absolute_at<=now()then raise exception 'PEE_UNAUTHORIZED'using errcode='42501';end if;
  return jsonb_build_object('created_by',i.created_by,'tenant_id',i.tenant_id);
 end if;
 if not exists(select 1 from pee_tenants where id=p_tenant and core_workspace)and not exists(select 1 from pee_licenses where tenant_id=p_tenant and status='active'and expires_at>now())then raise exception 'PEE_LICENSE_INACTIVE'using errcode='42501';end if;
 select * into p from pee_records where id=i.project_id and kind='project';if not found then raise exception 'PEE_NOT_FOUND'using errcode='P0002';end if;
 if p_action='exchange'then
  if not coalesce(i.used_at is null and i.token_hash=p_hash or i.resume_hash=p_hash and i.resume_expires_at>now(),false)or not coalesce(p_data->>'session_hash'~'^[a-f0-9]{64}$',false)then raise exception 'PEE_UNAUTHORIZED'using errcode='42501';end if;
  update pee_portal_invites set used_at=now(),resume_hash=null,resume_expires_at=null,session_hash=p_data->>'session_hash',session_expires_at=least(now()+interval '15 minutes',expires_at),session_absolute_at=expires_at where id=i.id;
 elsif i.session_hash is distinct from p_hash or i.session_expires_at<=now()or i.session_absolute_at<=now()then raise exception 'PEE_UNAUTHORIZED'using errcode='42501';
 elsif p_action='activity'then update pee_portal_invites set session_expires_at=least(now()+interval '15 minutes',session_absolute_at)where id=i.id;
 elsif p_action='logout'then update pee_portal_invites set session_hash=null where id=i.id;return jsonb_build_object('logged_out',true);
 elsif p_action='original'then
  select * into r from pee_portal_requests where id=(p_data->>'id')::uuid and invite_id=i.id;
  if not found or r.state not in('requested','returned')then raise exception 'PEE_NOT_FOUND'using errcode='P0002';end if;
  select * into d from pee_records where id=r.original_id and kind='document'and payload->>'project_id'=i.project_id::text;
  if not found or d.payload->>'signature_review'='verified'or d.payload->>'category'='signature_evidence'then raise exception 'PEE_PROTECTED_DOCUMENT'using errcode='42501';end if;
  insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,i.client_id,'portal.original_downloaded',d.id,jsonb_build_object('invite_id',i.id,'client_name',i.name,'request_id',r.id));return d.payload;
 elsif p_action='submit'then
  select * into r from pee_portal_requests where id=(p_data->>'id')::uuid and invite_id=i.id for update;
  if not found or r.state not in('requested','returned')or r.version<>(p_data->>'version')::integer or jsonb_typeof(p_data->'answers')is distinct from 'object'or octet_length(p_data::text)>200000 then raise exception 'PEE_PORTAL_VERSION'using errcode='40001';end if;
  for f in select * from jsonb_array_elements(p_data->'documents')loop
   if f->>'category'not in('manufacturer_manual','other','bills','baseline','diagram','art','budgets','mv_plan','consent','cnpj_status','distributor_clearance','tax_clearance','labor_clearance','fgts','signature_evidence')or f->>'sha256'!~'^[a-f0-9]{64}$'or f->>'mime'<>'application/pdf'or f->>'storage_key'<>p_tenant::text||'/'||(f->>'id')||'/'||(f->>'sha256')or f->>'project_id'<>i.project_id::text then raise exception 'PEE_PORTAL_FILE';end if;
   insert into pee_records(tenant_id,id,kind,payload,created_by,updated_by)values(p_tenant,(f->>'id')::uuid,'document',f-'id',i.client_id,i.client_id);
  end loop;
  select * into d from pee_records where id=coalesce(r.original_id,(p_data->>'original_id')::uuid)and kind='document'and payload->>'project_id'=i.project_id::text for update;
  if not found or d.payload->>'signature_review'='verified'then raise exception 'PEE_ORIGINAL';end if;
  if d.payload->>'sha256'=(select payload->>'sha256'from pee_records where id=(p_data->>'signed_id')::uuid)or d.payload->>'sha256'=(select payload->>'sha256'from pee_records where id=(p_data->>'evidence_id')::uuid)or (select payload->>'sha256'from pee_records where id=(p_data->>'signed_id')::uuid)=(select payload->>'sha256'from pee_records where id=(p_data->>'evidence_id')::uuid)then raise exception 'PEE_DISTINCT_EVIDENCE';end if;
  if not exists(select 1 from pee_records where id=(p_data->>'signed_id')::uuid and payload->>'project_id'=i.project_id::text and payload->>'category'='signature_evidence')or not exists(select 1 from pee_records where id=(p_data->>'evidence_id')::uuid and payload->>'project_id'=i.project_id::text and payload->>'category'='signature_evidence')then raise exception 'PEE_EVIDENCE';end if;
  update pee_records set payload=payload||jsonb_build_object('signed_document_id',p_data->>'signed_id','signed_sha256',(select payload->>'sha256'from pee_records where id=(p_data->>'signed_id')::uuid),'signature_original_sha256',d.payload->>'sha256','signature_evidence_id',p_data->>'evidence_id','signature_evidence_sha256',(select payload->>'sha256'from pee_records where id=(p_data->>'evidence_id')::uuid),'signature_channel','gov','signature_method','gov','signature_review','pending','signer_name',i.name,'signature_linked_at',now(),'signature_linked_by',i.client_id),version=version+1,updated_by=i.client_id,updated_at=now()where id=d.id;
  update pee_portal_requests set original_id=d.id,signed_id=(p_data->>'signed_id')::uuid,evidence_id=(p_data->>'evidence_id')::uuid,answers=p_data->'answers',state='submitted',version=version+1,submitted_at=now()where id=r.id;
 else if p_action<>'bootstrap'then raise exception 'PEE_ACTION';end if;end if;
 insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,i.client_id,'portal.'||p_action,i.project_id,jsonb_build_object('invite_id',i.id,'request_id',r.id,'client_name',i.name,'client_email',i.email));
 return jsonb_build_object('name',i.name,'email',i.email,'project',jsonb_build_object('name',p.payload->>'name','phase',p.payload->>'phase'),'engine_data',pee_store_v2(i.created_by,p_tenant,case when p_tenant='5a0df16a-1221-439b-a6db-8ab143273a78'then 'editor'else(select role from pee_members where tenant_id=p_tenant and user_id=i.created_by and active)end,p_tenant='5a0df16a-1221-439b-a6db-8ab143273a78','snapshot',jsonb_build_object('project_id',i.project_id)),'requests',(select coalesce(jsonb_agg(to_jsonb(x)order by created_at),'[]')from pee_portal_requests x where invite_id=i.id));
end$$;
reset role;
alter function pee_portal_manage(uuid,uuid,text,boolean,text,jsonb)owner to pee_runtime;
alter function pee_portal_client(uuid,uuid,text,text,jsonb)owner to pee_runtime;
revoke all on function pee_portal_manage(uuid,uuid,text,boolean,text,jsonb),pee_portal_client(uuid,uuid,text,text,jsonb)from public,anon,authenticated;
grant execute on function pee_portal_manage(uuid,uuid,text,boolean,text,jsonb),pee_portal_client(uuid,uuid,text,text,jsonb)to service_role;
revoke create on schema public from pee_runtime;revoke pee_runtime from postgres;
insert into pee_schema_versions(version)values(9);
commit;
