-- Resend project communications. Private mail is isolated by BOTH tenant and individual owner.
begin;
create table public.pee_mail_threads(
 tenant_id uuid not null,owner_id uuid not null,id uuid not null,project_id uuid not null,
 project_code text not null,subject text not null,reply_token text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(tenant_id,id),unique(tenant_id,id,owner_id),unique(tenant_id,owner_id,project_id),
 foreign key(tenant_id,project_id)references public.pee_records(tenant_id,id)
);
create table public.pee_mail_messages(
 tenant_id uuid not null,owner_id uuid not null,id uuid not null,thread_id uuid not null,
 ordinal bigint generated always as identity,direction text not null check(direction in('outbound','inbound')),
 state text not null check(state in('draft','sending','accepted','delivered','received','failed','unknown','bounced','complained','delivery_delayed','suppressed')),
 payload jsonb not null check(jsonb_typeof(payload)='object'and octet_length(payload::text)<=524288),
 version integer not null default 1,provider_id uuid,lease_hash text,first_attempt_at timestamptz,last_attempt_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(tenant_id,id),unique(tenant_id,id,owner_id),unique(provider_id),
 foreign key(tenant_id,thread_id,owner_id)references public.pee_mail_threads(tenant_id,id,owner_id)
);
create index pee_mail_history on public.pee_mail_messages(tenant_id,owner_id,thread_id,ordinal desc);
create table public.pee_mail_revisions(
 tenant_id uuid not null,owner_id uuid not null,id bigint generated always as identity primary key,
 message_id uuid not null,version integer not null,payload jsonb not null,created_at timestamptz not null default now(),
 unique(tenant_id,message_id,version),foreign key(tenant_id,message_id,owner_id)references public.pee_mail_messages(tenant_id,id,owner_id)
);
create table public.pee_mail_files(
 tenant_id uuid not null,owner_id uuid not null,id uuid not null,message_id uuid not null,
 provider_attachment_id uuid not null,name text not null,mime text not null,size bigint not null check(size between 1 and 20971520),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),storage_key text not null,
 created_at timestamptz not null default now(),primary key(tenant_id,id),unique(tenant_id,message_id,provider_attachment_id),
 foreign key(tenant_id,message_id,owner_id)references public.pee_mail_messages(tenant_id,id,owner_id)
);
-- The routing directory has opaque references only, never subjects, bodies, recipients or files.
create table public.pee_mail_routes(
 route_type text not null check(route_type in('reply','provider')),route_key text not null,
 tenant_id uuid not null,owner_id uuid not null,thread_id uuid not null,message_id uuid,
 primary key(route_type,route_key),foreign key(tenant_id,thread_id,owner_id)references public.pee_mail_threads(tenant_id,id,owner_id)
);
create table public.pee_mail_webhook_events(
 id text primary key,payload_hash text not null check(payload_hash~'^[a-f0-9]{64}$'),event_type text not null,
 provider_id uuid not null,provider_created_at timestamptz,applied boolean not null default false,
 received_at timestamptz not null default now()
);
do $$begin if not exists(select 1 from pg_roles where rolname='pee_mail_router')then create role pee_mail_router nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;end if;end$$;
grant usage on schema public to pee_mail_router;
grant select,insert,update on public.pee_mail_threads,public.pee_mail_messages to pee_runtime;
grant select,insert on public.pee_mail_revisions,public.pee_mail_files,public.pee_mail_routes to pee_runtime;
grant usage,select on sequence public.pee_mail_messages_ordinal_seq,public.pee_mail_revisions_id_seq to pee_runtime;
grant select,insert,update on public.pee_mail_threads,public.pee_mail_messages,public.pee_mail_webhook_events to pee_mail_router;
grant select on public.pee_mail_routes to pee_mail_router;
grant usage,select on sequence public.pee_mail_messages_ordinal_seq to pee_mail_router;
grant insert on public.pee_audit to pee_mail_router;
grant usage,select on sequence public.pee_audit_id_seq to pee_mail_router;
do $$declare t text;begin foreach t in array array['pee_mail_threads','pee_mail_messages','pee_mail_revisions','pee_mail_files']loop
 execute format('alter table public.%I enable row level security',t);execute format('alter table public.%I force row level security',t);
 execute format('create policy private_mailbox on public.%I to pee_runtime,pee_mail_router using(tenant_id::text=current_setting(''pee.tenant'',true)and owner_id::text=current_setting(''pee.actor'',true))with check(tenant_id::text=current_setting(''pee.tenant'',true)and owner_id::text=current_setting(''pee.actor'',true))',t);
end loop;end$$;
alter table public.pee_mail_routes enable row level security;alter table public.pee_mail_routes force row level security;
create policy own_route on public.pee_mail_routes to pee_runtime using(tenant_id::text=current_setting('pee.tenant',true)and owner_id::text=current_setting('pee.actor',true))with check(tenant_id::text=current_setting('pee.tenant',true)and owner_id::text=current_setting('pee.actor',true));
create policy opaque_router on public.pee_mail_routes for select to pee_mail_router using(true);
alter table public.pee_mail_webhook_events enable row level security;alter table public.pee_mail_webhook_events force row level security;
create policy verified_mail_events on public.pee_mail_webhook_events to pee_mail_router using(true)with check(true);
create policy mail_audit_append on public.pee_audit for insert to pee_mail_router with check(tenant_id::text=current_setting('pee.tenant',true)and actor_id::text=current_setting('pee.actor',true));
revoke all on public.pee_mail_threads,public.pee_mail_messages,public.pee_mail_revisions,public.pee_mail_files,public.pee_mail_routes,public.pee_mail_webhook_events from public,anon,authenticated,service_role;

grant pee_runtime to postgres with set true,inherit false;
grant create on schema public to pee_runtime;
set local role pee_runtime;
create function public.pee_mail_user(p_actor uuid,p_tenant uuid,p_role text,p_core boolean,p_action text,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_context jsonb;v_thread public.pee_mail_threads;v_msg public.pee_mail_messages;v_old public.pee_mail_messages;v_result jsonb;v_version integer;v_id uuid;v_first bigint;
begin
 v_context=public.pee_store_v2(p_actor,p_tenant,p_role,p_core,'usage',jsonb_build_object('monthly_limit',1));
 perform set_config('pee.actor',p_actor::text,true);
 if p_role='finance'then raise exception 'PEE_MAIL_ROLE'using errcode='42501';end if;
 if p_action='list'then
  select coalesce(jsonb_agg(x.item order by x.updated_at desc),'[]')into v_result from(
   select jsonb_build_object('id',t.id,'project_id',t.project_id,'project_code',t.project_code,'subject',t.subject,'updated_at',t.updated_at,'messages_count',(select count(*)from public.pee_mail_messages m where m.thread_id=t.id),'last_message',(select jsonb_build_object('subject',m.payload->>'subject','state',m.state,'direction',m.direction,'created_at',m.created_at)from public.pee_mail_messages m where m.thread_id=t.id order by m.ordinal desc limit 1))as item,t.updated_at
   from public.pee_mail_threads t order by t.updated_at desc limit 500
  )x;return v_result;
 elsif p_action='thread'then
  select * into v_thread from public.pee_mail_threads where id=(p_data->>'id')::uuid;
  if not found then raise exception 'PEE_MAIL_NOT_FOUND'using errcode='P0002';end if;
  select coalesce(jsonb_agg(to_jsonb(x)-'lease_hash'order by x.ordinal),'[]')into v_result from(select * from public.pee_mail_messages where thread_id=v_thread.id and(p_data->>'before' is null or ordinal<(p_data->>'before')::bigint)order by ordinal desc limit 100)x;
  return jsonb_build_object('thread',to_jsonb(v_thread),'messages',v_result);
 elsif p_action='message'then
  select * into v_msg from public.pee_mail_messages where id=(p_data->>'id')::uuid;
  if not found then raise exception 'PEE_MAIL_NOT_FOUND'using errcode='P0002';end if;
  return to_jsonb(v_msg)-'lease_hash';
 elsif p_action='files'then
  if not exists(select 1 from public.pee_mail_messages where id=(p_data->>'message_id')::uuid)then raise exception 'PEE_MAIL_NOT_FOUND'using errcode='P0002';end if;
  select coalesce(jsonb_agg(to_jsonb(f)),'[]')into v_result from public.pee_mail_files f where message_id=(p_data->>'message_id')::uuid;return v_result;
 end if;
 if p_role not in('editor','manager')then raise exception 'PEE_MAIL_ROLE'using errcode='42501';end if;
 if p_action='new_thread'then
  if not exists(select 1 from public.pee_records where id=(p_data->>'project_id')::uuid and kind='project')then raise exception 'PEE_MAIL_PROJECT'using errcode='P0002';end if;
  if p_data->>'reply_token'!~'^[A-Za-z0-9_-]{43}$'then raise exception 'PEE_MAIL_ROUTE';end if;
  select min(id)into v_first from public.pee_audit where record_id=(p_data->>'project_id')::uuid;
  if v_first is null then raise exception 'PEE_MAIL_PROJECT_REFERENCE';end if;
  insert into public.pee_mail_threads(tenant_id,owner_id,id,project_id,project_code,subject,reply_token)values(p_tenant,p_actor,(p_data->>'id')::uuid,(p_data->>'project_id')::uuid,'PRJ-'||lpad(v_first::text,greatest(6,length(v_first::text)),'0'),left(p_data->>'subject',300),p_data->>'reply_token')on conflict(tenant_id,owner_id,project_id)do update set updated_at=pee_mail_threads.updated_at returning * into v_thread;
  insert into public.pee_mail_routes(route_type,route_key,tenant_id,owner_id,thread_id)values('reply',encode(sha256(convert_to(v_thread.reply_token,'UTF8')),'hex'),p_tenant,p_actor,v_thread.id)on conflict do nothing;
  return to_jsonb(v_thread);
 elsif p_action='draft'then
  v_id=(p_data->>'id')::uuid;v_version=(p_data->>'expected_version')::integer;
  select * into v_thread from public.pee_mail_threads where id=(p_data->>'thread_id')::uuid for update;
  if not found then raise exception 'PEE_MAIL_NOT_FOUND'using errcode='P0002';end if;
  select * into v_old from public.pee_mail_messages where id=v_id for update;
  if found then
   if v_old.thread_id<>v_thread.id or v_old.state<>'draft'or v_old.version<>v_version then raise exception 'PEE_MAIL_VERSION'using errcode='40001';end if;
   insert into public.pee_mail_revisions(tenant_id,owner_id,message_id,version,payload)values(p_tenant,p_actor,v_old.id,v_old.version,v_old.payload);
   update public.pee_mail_messages set payload=p_data->'payload',version=version+1,updated_at=now()where id=v_id returning * into v_msg;
  else
   if v_version<>0 then raise exception 'PEE_MAIL_VERSION'using errcode='40001';end if;
   insert into public.pee_mail_messages(tenant_id,owner_id,id,thread_id,direction,state,payload)values(p_tenant,p_actor,v_id,v_thread.id,'outbound','draft',p_data->'payload')returning * into v_msg;
  end if;
  update public.pee_mail_threads set updated_at=now()where id=v_thread.id;
  insert into public.pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'communication.saved',v_msg.id,jsonb_build_object('version',v_msg.version,'thread_id',v_msg.thread_id));
  return to_jsonb(v_msg)-'lease_hash';
 elsif p_action='start_send'then
  select * into v_msg from public.pee_mail_messages where id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'PEE_MAIL_NOT_FOUND'using errcode='P0002';end if;
  if v_msg.state in('accepted','delivered','bounced','complained','delivery_delayed','suppressed')then return to_jsonb(v_msg)-'lease_hash';end if;
  if v_msg.version<>(p_data->>'expected_version')::integer or v_msg.payload->>'preview_hash' is distinct from p_data->>'preview_hash'then raise exception 'PEE_MAIL_VERSION'using errcode='40001';end if;
  if v_msg.state not in('draft','unknown','sending')or(v_msg.state='sending'and v_msg.last_attempt_at>now()-interval '30 seconds')or(v_msg.first_attempt_at is not null and v_msg.first_attempt_at<now()-interval '23 hours')then raise exception 'PEE_MAIL_REVIEW_REQUIRED'using errcode='40001';end if;
  update public.pee_mail_messages set state='sending',lease_hash=p_data->>'lease_hash',first_attempt_at=coalesce(first_attempt_at,now()),last_attempt_at=now(),updated_at=now()where id=v_msg.id returning * into v_msg;
  insert into public.pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'communication.queued',v_msg.id,jsonb_build_object('version',v_msg.version,'thread_id',v_msg.thread_id));return to_jsonb(v_msg);
 elsif p_action='finish_send'then
  select * into v_msg from public.pee_mail_messages where id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'PEE_MAIL_NOT_FOUND'using errcode='P0002';end if;
  if v_msg.lease_hash is distinct from p_data->>'lease_hash'then raise exception 'PEE_MAIL_LEASE'using errcode='40001';end if;
  if p_data->>'state'not in('accepted','failed','unknown')then raise exception 'PEE_MAIL_STATE';end if;
  if v_msg.state in('sending','unknown')then
   update public.pee_mail_messages set state=p_data->>'state',provider_id=coalesce(provider_id,(p_data->>'provider_id')::uuid),payload=payload||jsonb_build_object('delivery_code',p_data->>'code'),updated_at=now()where id=v_msg.id returning * into v_msg;
   if v_msg.provider_id is not null then insert into public.pee_mail_routes(route_type,route_key,tenant_id,owner_id,thread_id,message_id)values('provider',v_msg.provider_id::text,p_tenant,p_actor,v_msg.thread_id,v_msg.id)on conflict do nothing;end if;
   insert into public.pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,case when v_msg.state='accepted'then 'communication.accepted'else 'communication.failed'end,v_msg.id,jsonb_build_object('state',v_msg.state,'thread_id',v_msg.thread_id));
  end if;return to_jsonb(v_msg)-'lease_hash';
 elsif p_action='save_file'then
  select * into v_msg from public.pee_mail_messages where id=(p_data->>'message_id')::uuid;
  if not found then raise exception 'PEE_MAIL_NOT_FOUND'using errcode='P0002';end if;
  if p_data->>'storage_key'not like p_tenant::text||'/%'then raise exception 'PEE_MAIL_FILE_SCOPE';end if;
  insert into public.pee_mail_files(tenant_id,owner_id,id,message_id,provider_attachment_id,name,mime,size,sha256,storage_key)values(p_tenant,p_actor,(p_data->>'id')::uuid,v_msg.id,(p_data->>'provider_attachment_id')::uuid,left(p_data->>'name',300),p_data->>'mime',(p_data->>'size')::bigint,p_data->>'sha256',p_data->>'storage_key')on conflict(tenant_id,message_id,provider_attachment_id)do nothing;
  return jsonb_build_object('saved',true);
 else raise exception 'PEE_MAIL_ACTION';end if;
end$$;
revoke all on function public.pee_mail_user(uuid,uuid,text,boolean,text,jsonb)from public,anon,authenticated;
grant execute on function public.pee_mail_user(uuid,uuid,text,boolean,text,jsonb)to service_role;
set local role postgres;
revoke pee_runtime from postgres;revoke create on schema public from pee_runtime;
-- The verified-event router function is installed in version 005 with the receiving worker.
insert into public.pee_schema_versions(version)values(4);
commit;
