BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Register a capability, but do not assign it to roles or people.
INSERT INTO public.permissions(id,code,name,module,resource,action) VALUES
 ('c767190a-5ec0-4d89-8675-688415e967b1','platform.sales.finance.read','Consultar financeiro comercial sandbox','platform','sales_finance','read') ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.permissions WHERE id='c767190a-5ec0-4d89-8675-688415e967b1' AND code='platform.sales.finance.read') THEN RAISE EXCEPTION 'Permission conflict'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.platform_sales_finance_name(p_user uuid) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE result text;
BEGIN
 SELECT coalesce(nullif(btrim(concat_ws(' ',to_jsonb(t)->>'first_name',to_jsonb(t)->>'last_name')),''),nullif(btrim(to_jsonb(p)->>'name'),''),nullif(btrim(to_jsonb(p)->>'full_name'),'')) INTO result
 FROM public.platform_team_members t LEFT JOIN public.user_profiles p ON p.user_id=t.user_id WHERE t.user_id=p_user;
 RETURN result;
EXCEPTION WHEN undefined_table OR undefined_column OR insufficient_privilege THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_finance_name(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.platform_sales_finance_author() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 -- New rows only: never rename or backfill historical evidence.
 IF NEW.actor_name IS NULL THEN NEW.actor_name:=public.platform_sales_finance_name(NEW.actor_id); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.platform_sales_finance_author() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS finance_author ON public.platform_sales_asaas_bindings;
CREATE TRIGGER finance_author BEFORE INSERT ON public.platform_sales_asaas_bindings FOR EACH ROW EXECUTE FUNCTION public.platform_sales_finance_author();
DROP TRIGGER IF EXISTS finance_author ON public.platform_sales_asaas_checks;
CREATE TRIGGER finance_author BEFORE INSERT ON public.platform_sales_asaas_checks FOR EACH ROW EXECUTE FUNCTION public.platform_sales_finance_author();
CREATE OR REPLACE FUNCTION public.read_platform_sales_finance(p_actor uuid,p_page integer,p_search text,p_status text,p_from date,p_to date,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE entity public.platform_sales_asaas_bindings; profile text;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Platform actor required' USING ERRCODE='42501'; END IF;
 SELECT t.profile INTO profile FROM public.platform_team_members t JOIN public.user_roles u ON u.user_id::text=t.user_id::text JOIN public.roles r ON r.id=u.role_id
 WHERE t.user_id=p_actor AND t.active AND r.scope='global' AND
 ((t.profile='OWNER' AND r.name='admin_platform' AND r.permissions ? '82e7fc71-479a-4dd6-8b22-4fba6eaa6841') OR
 (t.profile='FINANCE' AND r.name='platform_finance' AND r.permissions ? 'c767190a-5ec0-4d89-8675-688415e967b1'));
 IF profile IS NULL THEN RAISE EXCEPTION 'Financial reader required' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 1000 OR p_search IS NULL OR length(p_search)>100 OR p_status IS NULL OR p_status NOT IN ('','PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED','UNKNOWN') OR p_from>p_to THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO entity FROM public.platform_sales_asaas_bindings WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing binding' USING ERRCODE='P3610'; END IF;
  RETURN jsonb_build_object('binding',jsonb_build_object('id',entity.id,'paymentId',entity.payment_id,'proposalId',entity.proposal_id,'company',entity.company,'expectedCents',entity.gross_cents,'actorId',entity.actor_id,'recordedName',entity.actor_name,'currentName',public.platform_sales_finance_name(entity.actor_id),'justification',entity.justification),
  'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'providerId',i.provider_id,'event',i.event,'receivedAt',i.received_at,'summary',i.summary,
    'checks',(SELECT coalesce(jsonb_agg(jsonb_build_object('version',c.version,'status',c.status,'note',c.note,'createdAt',c.created_at,'summary',c.summary,'actorId',c.actor_id,'recordedName',c.actor_name,'currentName',public.platform_sales_finance_name(c.actor_id)) ORDER BY c.version),'[]') FROM public.platform_sales_asaas_checks c WHERE c.event_id=i.id)) ORDER BY i.received_at DESC,i.id),'[]') FROM public.platform_sales_asaas_inbox i WHERE i.payment_id=entity.payment_id));
 END IF;
 RETURN (WITH rows AS (
  SELECT b.id,b.company,b.payment_id "paymentId",b.proposal_id "proposalId",b.gross_cents "expectedCents",
   coalesce(c.summary->>'status','UNKNOWN') status,c.summary->'grossCents' "grossCents",c.summary->'netCents' "netCents",c.created_at "checkedAt",c.status "checkResult",e.received_at "receivedAt",
   (e.received_at IS NOT NULL AND (c.created_at IS NULL OR e.received_at>c.created_at)) "pendingEvent",
   (last_check.status IN ('REVIEW','PROCESSING','UNLINKED')) "requiresReview"
  FROM public.platform_sales_asaas_bindings b
  LEFT JOIN LATERAL(SELECT x.* FROM public.platform_sales_asaas_checks x JOIN public.platform_sales_asaas_inbox i ON i.id=x.event_id WHERE i.payment_id=b.payment_id AND x.summary->>'id'=b.payment_id AND x.summary->>'customer'=b.customer_id AND x.summary->>'reference'=b.id::text AND x.summary->>'grossCents'=b.gross_cents::text AND x.summary->>'status' IN ('PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED') ORDER BY x.created_at DESC,x.id DESC LIMIT 1)c ON true
  LEFT JOIN LATERAL(SELECT i.received_at FROM public.platform_sales_asaas_inbox i WHERE i.payment_id=b.payment_id ORDER BY i.received_at DESC,i.id DESC LIMIT 1)e ON true
  LEFT JOIN LATERAL(SELECT x.status FROM public.platform_sales_asaas_checks x JOIN public.platform_sales_asaas_inbox i ON i.id=x.event_id WHERE i.payment_id=b.payment_id ORDER BY x.created_at DESC,x.id DESC LIMIT 1)last_check ON true
  WHERE (p_search='' OR strpos(lower(b.company),lower(p_search))>0 OR strpos(b.payment_id,p_search)>0 OR strpos(b.proposal_id::text,p_search)>0)
   AND (p_from IS NULL OR b.created_at>=p_from::timestamptz) AND (p_to IS NULL OR b.created_at<(p_to+1)::timestamptz)
 ), filtered AS (SELECT * FROM rows WHERE p_status='' OR status=p_status)
 SELECT jsonb_build_object('environment','SANDBOX','rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT * FROM filtered ORDER BY company,id LIMIT 25 OFFSET p_page*25)x),'total',(SELECT count(*) FROM filtered)));
END $$;
REVOKE ALL ON FUNCTION public.read_platform_sales_finance(uuid,integer,text,text,date,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_platform_sales_finance(uuid,integer,text,text,date,date,uuid) TO service_role;
COMMIT;
