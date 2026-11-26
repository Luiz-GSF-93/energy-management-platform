-- Authenticated Resend event ingestion. The application verifies Svix on the ORIGINAL request body first.
begin;
alter table public.pee_mail_messages add column delivery_event_at timestamptz;
create table public.pee_mail_archive_queue(
 provider_id uuid primary key,tenant_id uuid not null,owner_id uuid not null,message_id uuid not null,
 attempts integer not null default 0,complete boolean not null default false,next_attempt_at timestamptz not null default now(),lease_until timestamptz,
 foreign key(tenant_id,message_id,owner_id)references public.pee_mail_messages(tenant_id,id,owner_id)
);
alter table public.pee_mail_archive_queue enable row level security;alter table public.pee_mail_archive_queue force row level security;
create policy opaque_archive_queue on public.pee_mail_archive_queue to pee_mail_router using(true)with check(true);
revoke all on public.pee_mail_archive_queue from public,anon,authenticated,service_role;
grant select,insert,update on public.pee_mail_archive_queue to pee_mail_router;
grant select,insert on public.pee_mail_files to pee_mail_router;
grant insert on public.pee_mail_routes to pee_mail_router;
create policy router_new_binding on public.pee_mail_routes for insert to pee_mail_router with check(tenant_id::text=current_setting('pee.tenant',true)and owner_id::text=current_setting('pee.actor',true));
grant pee_mail_router to postgres with set true,inherit false;
grant create on schema public to pee_mail_router;
set local role pee_mail_router;
create function public.pee_mail_system(p_action text,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_route public.pee_mail_routes;v_prior public.pee_mail_webhook_events;v_msg public.pee_mail_messages;v_queue public.pee_mail_archive_queue;v_type text;v_state text;v_at timestamptz;v_result jsonb;v_item jsonb;v_id text;
begin
 if p_action='route'then
  if p_data->>'route_type'not in('reply','provider')then raise exception 'PEE_MAIL_ROUTE';end if;
  select * into v_route from public.pee_mail_routes where route_type=p_data->>'route_type'and route_key=p_data->>'route_key';return case when found then to_jsonb(v_route)else null end;
 elsif p_action='apply'then
  v_id=p_data->>'event_id';v_type=p_data->>'event_type';v_at=(p_data->>'provider_created_at')::timestamptz;
  if v_id!~'^[A-Za-z0-9_-]{8,160}$'or p_data->>'payload_hash'!~'^[a-f0-9]{64}$'or v_type not in('email.received','email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed')then raise exception 'PEE_MAIL_EVENT';end if;
  perform pg_advisory_xact_lock(hashtextextended('pee-mail-event:'||v_id,0));
  select * into v_prior from public.pee_mail_webhook_events where id=v_id;
  if found then
   if v_prior.payload_hash<>p_data->>'payload_hash'then raise exception 'PEE_MAIL_EVENT_COLLISION'using errcode='40001';end if;
   if v_prior.applied then return jsonb_build_object('duplicate',true,'applied',true);end if;
  else
   insert into public.pee_mail_webhook_events(id,payload_hash,event_type,provider_id,provider_created_at)values(v_id,p_data->>'payload_hash',v_type,(p_data->>'provider_id')::uuid,v_at);
  end if;
  select * into v_route from public.pee_mail_routes where route_type=p_data->>'route_type'and route_key=p_data->>'route_key';
  if not found then return jsonb_build_object('applied',false,'unrouted',true);end if;
  perform set_config('pee.tenant',v_route.tenant_id::text,true);perform set_config('pee.actor',v_route.owner_id::text,true);
  perform id from public.pee_mail_threads where id=v_route.thread_id for update;
  if v_type='email.received'then
   if p_data->'payload'->>'direction' is distinct from 'inbound'or p_data->'payload'->>'provider_id' is distinct from p_data->>'provider_id'then raise exception 'PEE_MAIL_RECEIPT_SCOPE';end if;
   select * into v_msg from public.pee_mail_messages where provider_id=(p_data->>'provider_id')::uuid;
   if not found then
    insert into public.pee_mail_messages(tenant_id,owner_id,id,thread_id,direction,state,payload,provider_id,delivery_event_at)values(v_route.tenant_id,v_route.owner_id,(p_data->>'message_id')::uuid,v_route.thread_id,'inbound','received',p_data->'payload',(p_data->>'provider_id')::uuid,v_at)returning * into v_msg;
    insert into public.pee_mail_routes(route_type,route_key,tenant_id,owner_id,thread_id,message_id)values('provider',v_msg.provider_id::text,v_route.tenant_id,v_route.owner_id,v_route.thread_id,v_msg.id)on conflict do nothing;
    if jsonb_array_length(coalesce(v_msg.payload->'attachments','[]'))>0 then insert into public.pee_mail_archive_queue(provider_id,tenant_id,owner_id,message_id)values(v_msg.provider_id,v_msg.tenant_id,v_msg.owner_id,v_msg.id)on conflict do nothing;end if;
    insert into public.pee_audit(tenant_id,actor_id,action,record_id,detail)values(v_route.tenant_id,v_route.owner_id,'communication.received',v_msg.id,jsonb_build_object('thread_id',v_route.thread_id,'event_id',v_id));
   elsif v_msg.thread_id<>v_route.thread_id then raise exception 'PEE_MAIL_PROVIDER_SCOPE';end if;
  else
   select * into v_msg from public.pee_mail_messages where id=v_route.message_id and provider_id=(p_data->>'provider_id')::uuid and direction='outbound'for update;
   if not found then raise exception 'PEE_MAIL_PROVIDER_SCOPE';end if;
   v_state=case v_type when 'email.sent'then 'accepted'when 'email.delivered'then 'delivered'when 'email.delivery_delayed'then 'delivery_delayed'when 'email.bounced'then 'bounced'when 'email.complained'then 'complained'when 'email.suppressed'then 'suppressed'else 'failed'end;
   if v_msg.delivery_event_at is null or v_at>=v_msg.delivery_event_at then
    update public.pee_mail_messages set state=v_state,delivery_event_at=v_at,updated_at=now()where id=v_msg.id returning * into v_msg;
   end if;
   insert into public.pee_audit(tenant_id,actor_id,action,record_id,detail)values(v_route.tenant_id,v_route.owner_id,case v_state when 'accepted'then 'communication.accepted'when 'delivered'then 'communication.delivered'when 'bounced'then 'communication.bounced'when 'complained'then 'communication.complained'else 'communication.failed'end,v_msg.id,jsonb_build_object('thread_id',v_route.thread_id,'event_id',v_id,'provider_state',v_state));
  end if;
  update public.pee_mail_threads set updated_at=now()where id=v_route.thread_id;
  update public.pee_mail_webhook_events set applied=true where id=v_id;
  return jsonb_build_object('applied',true,'message_id',v_msg.id,'thread_id',v_route.thread_id);
 elsif p_action='pending_delivery'then
  select coalesce(jsonb_agg(jsonb_build_object('event_id',e.id,'payload_hash',e.payload_hash,'event_type',e.event_type,'provider_id',e.provider_id,'provider_created_at',e.provider_created_at,'route_type','provider','route_key',e.provider_id::text)),'[]')into v_result from(select * from public.pee_mail_webhook_events where not applied and event_type<>'email.received'and provider_id=(p_data->>'provider_id')::uuid order by received_at limit 50)e;return v_result;
 elsif p_action='pending_files'then
  v_result='[]'::jsonb;
  for v_queue in update public.pee_mail_archive_queue set attempts=attempts+1,lease_until=now()+interval '5 minutes'where provider_id in(select provider_id from public.pee_mail_archive_queue where not complete and attempts<10 and next_attempt_at<=now()and(lease_until is null or lease_until<now())order by next_attempt_at for update skip locked limit 3)returning * loop
   perform set_config('pee.tenant',v_queue.tenant_id::text,true);perform set_config('pee.actor',v_queue.owner_id::text,true);
   select * into v_msg from public.pee_mail_messages where id=v_queue.message_id and direction='inbound';
   if found then v_result=v_result||jsonb_build_array(jsonb_build_object('tenant_id',v_msg.tenant_id,'owner_id',v_msg.owner_id,'message_id',v_msg.id,'provider_id',v_msg.provider_id,'attachments',v_msg.payload->'attachments'));end if;
  end loop;return v_result;
 elsif p_action='files'then
  select * into v_route from public.pee_mail_routes where route_type='provider'and route_key=p_data->>'provider_id';if not found then raise exception 'PEE_MAIL_ROUTE';end if;
  perform set_config('pee.tenant',v_route.tenant_id::text,true);perform set_config('pee.actor',v_route.owner_id::text,true);
  select coalesce(jsonb_agg(to_jsonb(f)),'[]')into v_result from public.pee_mail_files f where message_id=v_route.message_id;return v_result;
 elsif p_action='store_file'then
  select * into v_route from public.pee_mail_routes where route_type='provider'and route_key=p_data->>'provider_id';if not found then raise exception 'PEE_MAIL_ROUTE';end if;
  perform set_config('pee.tenant',v_route.tenant_id::text,true);perform set_config('pee.actor',v_route.owner_id::text,true);
  select * into v_msg from public.pee_mail_messages where id=v_route.message_id and direction='inbound';
  if not found or not exists(select 1 from jsonb_array_elements(v_msg.payload->'attachments')x where x->>'id'=p_data->>'provider_attachment_id')or p_data->>'storage_key'not like v_route.tenant_id::text||'/%'then raise exception 'PEE_MAIL_FILE_SCOPE';end if;
  insert into public.pee_mail_files(tenant_id,owner_id,id,message_id,provider_attachment_id,name,mime,size,sha256,storage_key)values(v_route.tenant_id,v_route.owner_id,(p_data->>'id')::uuid,v_route.message_id,(p_data->>'provider_attachment_id')::uuid,left(p_data->>'name',300),p_data->>'mime',(p_data->>'size')::bigint,p_data->>'sha256',p_data->>'storage_key')on conflict(tenant_id,message_id,provider_attachment_id)do nothing;return jsonb_build_object('saved',true);
 elsif p_action='archive_status'then
  select * into v_route from public.pee_mail_routes where route_type='provider'and route_key=p_data->>'provider_id';if not found then raise exception 'PEE_MAIL_ROUTE';end if;
  perform set_config('pee.tenant',v_route.tenant_id::text,true);perform set_config('pee.actor',v_route.owner_id::text,true);
  update public.pee_mail_messages set payload=payload||jsonb_build_object('attachments_archived',p_data->'complete','attachment_archive_status',p_data->>'status'),updated_at=now()where id=v_route.message_id and direction='inbound';
  update public.pee_mail_archive_queue set complete=coalesce((p_data->>'complete')::boolean,false),lease_until=null,next_attempt_at=now()+interval '5 minutes'where provider_id=(p_data->>'provider_id')::uuid;
  return jsonb_build_object('updated',true);
 else raise exception 'PEE_MAIL_SYSTEM_ACTION';end if;
end$$;
revoke all on function public.pee_mail_system(text,jsonb)from public,anon,authenticated;
grant execute on function public.pee_mail_system(text,jsonb)to service_role;
set local role postgres;
revoke pee_mail_router from postgres;revoke create on schema public from pee_mail_router;
insert into public.pee_schema_versions(version)values(5);
commit;
