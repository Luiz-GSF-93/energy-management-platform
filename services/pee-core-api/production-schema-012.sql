-- Separate attachment-free notifications. Private content remains scoped to tenant AND sender.
begin;
create table pee_mail_notifications(tenant_id uuid not null,owner_id uuid not null,id uuid not null,message_id uuid not null,recipient text not null,payload jsonb not null,state text not null default 'pending'check(state in('pending','sending','accepted','unknown','failed')),provider_id uuid,created_at timestamptz not null default now(),attempted_at timestamptz,primary key(tenant_id,id),unique(tenant_id,message_id,recipient),foreign key(tenant_id,message_id,owner_id)references pee_mail_messages(tenant_id,id,owner_id));
create table pee_mail_notification_routes(id uuid primary key,tenant_id uuid not null,owner_id uuid not null,next_check_at timestamptz not null default now());
alter table pee_mail_notifications enable row level security;alter table pee_mail_notifications force row level security;
create policy private_notifications on pee_mail_notifications to pee_runtime,pee_mail_router using(tenant_id::text=current_setting('pee.tenant',true)and owner_id::text=current_setting('pee.actor',true))with check(tenant_id::text=current_setting('pee.tenant',true)and owner_id::text=current_setting('pee.actor',true));
alter table pee_mail_notification_routes enable row level security;alter table pee_mail_notification_routes force row level security;
create policy own_notification_route on pee_mail_notification_routes to pee_runtime using(tenant_id::text=current_setting('pee.tenant',true)and owner_id::text=current_setting('pee.actor',true))with check(tenant_id::text=current_setting('pee.tenant',true)and owner_id::text=current_setting('pee.actor',true));
create policy opaque_notification_router on pee_mail_notification_routes to pee_mail_router using(true)with check(true);
revoke all on pee_mail_notifications,pee_mail_notification_routes from public,anon,authenticated,service_role;
grant select,insert on pee_mail_notifications,pee_mail_notification_routes to pee_runtime;
grant select,update on pee_mail_notifications,pee_mail_notification_routes to pee_mail_router;
grant pee_runtime to postgres with set true,inherit false;grant create on schema public to pee_runtime;
set local role pee_runtime;
create function pee_notify_user(p_actor uuid,p_tenant uuid,p_role text,p_core boolean,p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m pee_mail_messages;x jsonb;v_id uuid;
begin
 perform pee_store_v2(p_actor,p_tenant,p_role,p_core,'usage','{"monthly_limit":1}');perform set_config('pee.actor',p_actor::text,true);
 if p_role='finance'then raise exception 'PEE_ROLE'using errcode='42501';end if;
 select * into m from pee_mail_messages where id=(p_data->>'message_id')::uuid;
 if not found then raise exception 'PEE_MAIL_NOT_FOUND'using errcode='P0002';end if;
 if p_action='list'then return(select coalesce(jsonb_agg(jsonb_build_object('recipient',n.recipient,'state',n.state,'provider_id',n.provider_id,'id',n.id)),'[]')from pee_mail_notifications n where message_id=m.id);end if;
 if p_action<>'schedule'or p_role not in('editor','manager')or m.payload->>'purpose'<>'submission'or m.state not in('accepted','delivered')or jsonb_array_length(p_data->'notifications')>2 then raise exception 'PEE_NOTIFICATION_STATE'using errcode='42501';end if;
 for x in select * from jsonb_array_elements(p_data->'notifications')loop
  if not exists(select 1 from jsonb_array_elements_text(m.payload->'notification_recipients')r where r=x->>'recipient')or octet_length(x::text)>6000 or x->'payload'?'attachments'then raise exception 'PEE_NOTIFICATION_INPUT';end if;
  v_id=(x->>'id')::uuid;
  insert into pee_mail_notifications(tenant_id,owner_id,id,message_id,recipient,payload)values(p_tenant,p_actor,v_id,m.id,x->>'recipient',x->'payload')on conflict(tenant_id,message_id,recipient)do nothing;
  insert into pee_mail_notification_routes(id,tenant_id,owner_id)select v_id,p_tenant,p_actor where exists(select 1 from pee_mail_notifications n where n.id=v_id)on conflict do nothing;
 end loop;
 insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'communication.private_notices_queued',m.id,jsonb_build_object('message_id',m.id,'without_attachments',true));return jsonb_build_object('scheduled',true);
end$$;
reset role;alter function pee_notify_user(uuid,uuid,text,boolean,text,jsonb)owner to pee_runtime;
revoke all on function pee_notify_user(uuid,uuid,text,boolean,text,jsonb)from public,anon,authenticated;
grant execute on function pee_notify_user(uuid,uuid,text,boolean,text,jsonb)to service_role;
grant pee_mail_router to postgres with set true,inherit false;grant create on schema public to pee_mail_router;
set local role pee_mail_router;
create function pee_notify_system(p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare route pee_mail_notification_routes;n pee_mail_notifications;
begin
 if p_action='claim'then
  select * into route from pee_mail_notification_routes where next_check_at<=now()order by next_check_at,id for update skip locked limit 1;if not found then return null;end if;
  perform set_config('pee.tenant',route.tenant_id::text,true);perform set_config('pee.actor',route.owner_id::text,true);
  select * into n from pee_mail_notifications where id=route.id for update;
  update pee_mail_notification_routes set next_check_at=now()+interval '5 minutes'where id=route.id;
  if n.state='sending'then update pee_mail_notifications set state='unknown'where id=n.id;update pee_mail_notification_routes set next_check_at=now()+interval '100 years'where id=route.id;return null;end if;
  if n.state<>'pending'then return null;end if;
  update pee_mail_notifications set state='sending',attempted_at=now()where id=n.id returning * into n;return to_jsonb(n);
 elsif p_action='finish'then
  select * into route from pee_mail_notification_routes where id=(p_data->>'id')::uuid for update;if not found then raise exception 'PEE_NOT_FOUND'using errcode='P0002';end if;
  perform set_config('pee.tenant',route.tenant_id::text,true);perform set_config('pee.actor',route.owner_id::text,true);
  if p_data->>'state'not in('accepted','unknown')then raise exception 'PEE_NOTIFICATION_STATE';end if;
  update pee_mail_notifications set state=p_data->>'state',provider_id=(p_data->>'provider_id')::uuid where id=route.id and state='sending';
  update pee_mail_notification_routes set next_check_at=now()+interval '100 years'where id=route.id;
  insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(route.tenant_id,route.owner_id,'communication.private_notice_finished',route.id,jsonb_build_object('state',p_data->>'state','without_attachments',true));return jsonb_build_object('recorded',true);
 end if;raise exception 'PEE_ACTION';
end$$;
reset role;alter function pee_notify_system(text,jsonb)owner to pee_mail_router;
revoke all on function pee_notify_system(text,jsonb)from public,anon,authenticated;
grant execute on function pee_notify_system(text,jsonb)to service_role;
revoke create on schema public from pee_runtime,pee_mail_router;revoke pee_runtime,pee_mail_router from postgres;
insert into pee_schema_versions(version)values(12);commit;
