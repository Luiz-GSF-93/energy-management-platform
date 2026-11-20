-- Paginated audit with stable readable references derived from the first immutable event.
-- Audit rows, original identifiers and existing policies are preserved.
begin;
create index if not exists pee_audit_record_reference on public.pee_audit(tenant_id,record_id,id);
grant pee_runtime to postgres with set true,inherit false;
grant create on schema public to pee_runtime;
set local role pee_runtime;
alter function public.pee_store(uuid,uuid,text,boolean,text,jsonb)rename to pee_store_v2;
revoke all on function public.pee_store_v2(uuid,uuid,text,boolean,text,jsonb)from public,anon,authenticated,service_role;
create function public.pee_store(p_actor uuid,p_tenant uuid,p_role text,p_core boolean,p_action text,p_data jsonb default '{}')returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_context jsonb;v_limit integer;v_before bigint;v_snapshot bigint;v_items jsonb;v_total bigint;v_more boolean;v_next bigint;v_from timestamptz;v_until timestamptz;
begin
 if p_action<>'audit_page'then return public.pee_store_v2(p_actor,p_tenant,p_role,p_core,p_action,p_data);end if;
 -- Reuse exactly the current membership/license validation and tenant context.
 v_context=public.pee_store_v2(p_actor,p_tenant,p_role,p_core,'usage',jsonb_build_object('monthly_limit',1));
 if p_role='finance'then raise exception 'PEE_ROLE'using errcode='42501';end if;
 v_limit=coalesce((p_data->>'limit')::integer,25);if v_limit not in(10,25,50,100,500)then raise exception 'PEE_PAGE_LIMIT';end if;
 v_before=(p_data->>'before')::bigint;v_snapshot=(p_data->>'snapshot')::bigint;
 v_from=(p_data->>'date_from')::date::timestamp at time zone 'America/Sao_Paulo';v_until=((p_data->>'date_to')::date+1)::timestamp at time zone 'America/Sao_Paulo';
 if v_before is not null and v_before<1 or v_snapshot is not null and v_snapshot<0 then raise exception 'PEE_CURSOR';end if;
 if v_snapshot is null then select coalesce(max(id),0)into v_snapshot from public.pee_audit;end if;
 select count(*)into v_total from public.pee_audit where id<=v_snapshot and(v_from is null or created_at>=v_from)and(v_until is null or created_at<v_until);
 select coalesce(jsonb_agg(to_jsonb(r)order by r.id desc),'[]'),min(r.id)into v_items,v_next from(
  select a.id,a.actor_id,a.action,a.record_id,a.detail,a.created_at,
   case when a.record_id is null then 'SEM-REGISTRO'else
    coalesce(case split_part(a.action,'.',1)when 'company'then 'EMP'when 'unit'then 'UC'when 'project'then 'PRJ'when 'simulation'then 'SIM'when 'document'then 'DOC'when 'rule'then 'EDT'when 'workflow'then 'CPP'when 'communication'then 'COM'when 'royalty'then 'ROY'else 'REG'end,'REG')||'-'||(select lpad(min(b.id)::text,greatest(6,length(min(b.id)::text)),'0')from public.pee_audit b where b.record_id=a.record_id)end as record_code,
   coalesce((select r.payload->>'name'from public.pee_records r where r.id=a.record_id),a.detail->'previous'->'payload'->>'name','')as record_name
  from public.pee_audit a where a.id<=v_snapshot and(v_before is null or a.id<v_before)and(v_from is null or a.created_at>=v_from)and(v_until is null or a.created_at<v_until)order by a.id desc limit v_limit
 )r;
 select exists(select 1 from public.pee_audit where id<=v_snapshot and id<v_next and(v_from is null or created_at>=v_from)and(v_until is null or created_at<v_until))into v_more;
 return jsonb_build_object('items',v_items,'total',v_total,'snapshot',v_snapshot,'has_more',v_more,'next_cursor',case when v_more then v_next else null end,'limit',v_limit);
end$$;
revoke all on function public.pee_store(uuid,uuid,text,boolean,text,jsonb)from public,anon,authenticated;
grant execute on function public.pee_store(uuid,uuid,text,boolean,text,jsonb)to service_role;
set local role postgres;
revoke pee_runtime from postgres;
revoke create on schema public from pee_runtime;
insert into public.pee_schema_versions(version)values(3);
commit;
