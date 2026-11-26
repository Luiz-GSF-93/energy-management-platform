-- Controlled consultation: attachment-free copied notices remain limited to recipients
-- captured in the sender-owned communication. No new tables, grants or access paths.
begin;
grant pee_runtime to postgres with set true,inherit false;grant create on schema public to pee_runtime;
set local role pee_runtime;
create or replace function pee_notify_user(p_actor uuid,p_tenant uuid,p_role text,p_core boolean,p_action text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m pee_mail_messages;x jsonb;v_id uuid;
begin
 perform pee_store_v2(p_actor,p_tenant,p_role,p_core,'usage','{"monthly_limit":1}');perform set_config('pee.actor',p_actor::text,true);
 if p_role='finance'then raise exception 'PEE_ROLE'using errcode='42501';end if;
 select * into m from pee_mail_messages where id=(p_data->>'message_id')::uuid;
 if not found then raise exception 'PEE_MAIL_NOT_FOUND'using errcode='P0002';end if;
 if p_action='list'then return(select coalesce(jsonb_agg(jsonb_build_object('recipient',n.recipient,'state',n.state,'provider_id',n.provider_id,'id',n.id)),'[]')from pee_mail_notifications n where message_id=m.id);end if;
 if p_action<>'schedule'or p_role not in('editor','manager')or coalesce(m.payload->>'purpose','')not in('submission','presentation','diligence','follow_up')or m.state not in('accepted','delivered')or jsonb_typeof(p_data->'notifications')<>'array'or jsonb_array_length(p_data->'notifications')>52 then raise exception 'PEE_NOTIFICATION_STATE'using errcode='42501';end if;
 for x in select * from jsonb_array_elements(p_data->'notifications')loop
  if not exists(select 1 from jsonb_array_elements_text(m.payload->'notification_recipients')r where r=x->>'recipient')or octet_length(x::text)>6000 or x->'payload'?'attachments'then raise exception 'PEE_NOTIFICATION_INPUT';end if;
  v_id=(x->>'id')::uuid;
  insert into pee_mail_notifications(tenant_id,owner_id,id,message_id,recipient,payload)values(p_tenant,p_actor,v_id,m.id,x->>'recipient',x->'payload')on conflict(tenant_id,message_id,recipient)do nothing;
  insert into pee_mail_notification_routes(id,tenant_id,owner_id)select v_id,p_tenant,p_actor where exists(select 1 from pee_mail_notifications n where n.id=v_id)on conflict do nothing;
 end loop;
 insert into pee_audit(tenant_id,actor_id,action,record_id,detail)values(p_tenant,p_actor,'communication.private_notices_queued',m.id,jsonb_build_object('message_id',m.id,'without_attachments',true));return jsonb_build_object('scheduled',true);
end$$;
create or replace function pee_security_event(p_actor uuid,p_tenant uuid,p_role text,p_core boolean,p_event text,p_detail jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform pee_store(p_actor,p_tenant,p_role,p_core,'usage','{"monthly_limit":1}');
 if p_event not in('window_hidden','copy_command_blocked','print_command_blocked','document_export_denied','document_exported','document_viewed','document_signing_requested')or octet_length(p_detail::text)>2000 then raise exception 'PEE_SECURITY_EVENT';end if;
 insert into pee_audit(tenant_id,actor_id,action,detail)values(p_tenant,p_actor,'security.'||p_event,p_detail);return jsonb_build_object('recorded',true);
end$$;
revoke all on function public.pee_notify_user(uuid,uuid,text,boolean,text,jsonb)from public,anon,authenticated;
revoke all on function public.pee_security_event(uuid,uuid,text,boolean,text,jsonb)from public,anon,authenticated;
grant execute on function public.pee_notify_user(uuid,uuid,text,boolean,text,jsonb)to service_role;
grant execute on function public.pee_security_event(uuid,uuid,text,boolean,text,jsonb)to service_role;
reset role;
revoke create on schema public from pee_runtime;revoke pee_runtime from postgres;
insert into pee_schema_versions(version)values(13)on conflict do nothing;
commit;
