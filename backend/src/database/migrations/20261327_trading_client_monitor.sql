BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $install$ BEGIN
 IF to_regprocedure('public.trading_client_monitor(text,text,text,text,jsonb)') IS NOT NULL THEN
  IF obj_description(to_regprocedure('public.trading_client_monitor(text,text,text,text,jsonb)'),'pg_proc') IS DISTINCT FROM 'trading:20261327:v1' THEN RAISE EXCEPTION 'Review existing monitor';END IF;RETURN;
 END IF;
 EXECUTE $schema$
CREATE TABLE public.trading_client_monitors(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,opportunity_id uuid NOT NULL REFERENCES public.trading_records(id),customer_id text NOT NULL,email text NOT NULL,
 request_id uuid NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz,revoked_by text,
 token_hash text UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),session_hash text UNIQUE,session_expires_at timestamptz,
 otp_hash text,otp_expires_at timestamptz,otp_sent_at timestamptz,otp_day date,otp_count integer NOT NULL DEFAULT 0,otp_attempts integer NOT NULL DEFAULT 0,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','SENDING','ACCEPTED','FAILED','UNKNOWN','CANCELLED')),
 started_at timestamptz,provider_id text,diagnostic text,cost_micro_usd bigint NOT NULL DEFAULT 0 CHECK(cost_micro_usd>=0),UNIQUE(organization_id,request_id));
CREATE INDEX trading_client_monitor_scope ON public.trading_client_monitors(organization_id,opportunity_id,created_at DESC);
ALTER TABLE public.trading_client_monitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_client_monitors FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.trading_client_monitor_live(p_id uuid) RETURNS public.trading_client_monitors LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.trading_client_monitors;
BEGIN
 SELECT * INTO m FROM public.trading_client_monitors WHERE id=p_id;
 IF m.id IS NULL OR m.revoked_at IS NOT NULL OR m.expires_at<=now() OR NOT public.trading_quote_is_live(m.organization_id,m.opportunity_id)
 OR NOT EXISTS(SELECT 1 FROM public.customers c JOIN public.trading_records o ON o.organization_id=c.organization_id AND o.data->>'customerId'=c.id WHERE c.organization_id=m.organization_id AND c.id=m.customer_id AND c.deleted_at IS NULL AND lower(c.contact_email)=m.email AND o.id=m.opportunity_id)
 THEN RAISE EXCEPTION 'Monitor unavailable' USING ERRCODE='42501';END IF;RETURN m;
END$$;
CREATE FUNCTION public.trading_client_monitor_snapshot(p_org text,p_op uuid,p_expiry timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o public.trading_records;ps jsonb;ss jsonb;hh jsonb;pld jsonb;counts jsonb;
BEGIN
 SELECT * INTO o FROM public.trading_records WHERE organization_id=p_org AND id=p_op AND kind='opportunity';
 IF NOT public.trading_quote_is_live(p_org,p_op) OR p_expiry<=now() THEN RAISE EXCEPTION 'Round expired' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM public.trading_records WHERE organization_id=p_org AND parent_id=p_op AND kind='proposal')>250 THEN RAISE EXCEPTION 'Round too large' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,'created_at',p.created_at,'data',jsonb_build_object('supplierId',p.data->'supplierId','priceBrlMwh',p.data->'priceBrlMwh','energyType',p.data->'energyType','validUntil',p.data->'validUntil','flexibilityUpperPercent',p.data->'flexibilityUpperPercent','flexibilityLowerPercent',p.data->'flexibilityLowerPercent','seasonality',p.data->'seasonality','correctionIndex',p.data->'correctionIndex','billingTerms',p.data->'billingTerms','conditions',p.data->'conditions'))),'[]') INTO ps FROM public.trading_records p WHERE p.organization_id=p_org AND p.parent_id=p_op AND p.kind='proposal';
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'data',jsonb_build_object('tradeName',s.data->'tradeName'))),'[]') INTO ss FROM public.trading_records s WHERE s.organization_id=p_org AND s.kind='supplier' AND EXISTS(SELECT 1 FROM public.trading_records p WHERE p.organization_id=p_org AND p.parent_id=p_op AND p.kind='proposal' AND p.data->>'supplierId'=s.id::text);
 SELECT coalesce(jsonb_agg(x),'[]') INTO hh FROM(SELECT jsonb_build_object('proposalId',h.record_id,'at',h.recorded_at,'priceBrlMwh',h.snapshot->'data'->'priceBrlMwh') x FROM public.trading_history h JOIN public.trading_records p ON p.id=h.record_id AND p.organization_id=h.organization_id WHERE h.organization_id=p_org AND p.parent_id=p_op AND p.kind='proposal' ORDER BY h.recorded_at DESC LIMIT 500) q;
 SELECT coalesce(jsonb_agg(x),'[]') INTO pld FROM(SELECT month,mean_brl_mwh,source,published_at FROM public.energy_price_pld_monthly WHERE organization_id=p_org AND submarket=o.data->>'submarket' AND month<=date_trunc('month',now())::date ORDER BY month DESC LIMIT 24) x;
 SELECT jsonb_build_object('issued',count(*),'responded',count(*) FILTER(WHERE state='RESPONDED'),'pending',count(*) FILTER(WHERE state='PENDING' AND expires_at>now()),'declined',count(*) FILTER(WHERE state='DECLINED'),'revoked',count(*) FILTER(WHERE state='REVOKED'),'expired',count(*) FILTER(WHERE expires_at<=now()),'emailAccepted',count(*) FILTER(WHERE email_status IN('SENT','ACCEPTED','DELIVERED'))) INTO counts FROM public.trading_invitations WHERE organization_id=p_org AND opportunity_id=p_op AND kind='SUPPLIER';
 RETURN jsonb_build_object('serverNow',now(),'roundEndsAt',(o.data->>'expiresAt')::timestamptz,'expiresAt',least(p_expiry,(o.data->>'expiresAt')::timestamptz),'opportunity',jsonb_build_object('data',o.data),'proposals',ps,'suppliers',ss,'history',hh,'pld',pld,'counts',counts,
 'customer',(SELECT company_name FROM public.customers WHERE organization_id=p_org AND id=o.data->>'customerId'),'unit',(SELECT name FROM public.consumer_units WHERE organization_id=p_org AND customer_id=o.data->>'customerId' AND id=o.data->>'unitId'));
END$$;
CREATE FUNCTION public.trading_client_monitor(p_org text,p_actor text,p_session text,p_action text,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.trading_client_monitors;o public.trading_records;addr text;expiry timestamptz;req uuid;
BEGIN
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>2000 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023';END IF;
 IF p_action IN('ISSUE','REVOKE','PREVIEW','LIST') THEN
  IF p_session IS NOT NULL THEN RAISE EXCEPTION 'Mixed context' USING ERRCODE='42501';END IF;
  PERFORM public.assert_trading_actor(p_org,p_actor,p_action IN('ISSUE','REVOKE'));
  SELECT * INTO o FROM public.trading_records WHERE organization_id=p_org AND id=(p_body->>'opportunityId')::uuid AND kind='opportunity';
  IF o.id IS NULL THEN RAISE EXCEPTION 'Round unavailable' USING ERRCODE='42501';END IF;
  IF p_action='LIST' THEN RETURN (SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT id,email,expires_at,revoked_at,state,diagnostic,created_at FROM public.trading_client_monitors WHERE organization_id=p_org AND opportunity_id=o.id ORDER BY created_at DESC LIMIT 20) x);END IF;
  IF p_action='REVOKE' THEN UPDATE public.trading_client_monitors SET revoked_at=now(),revoked_by=p_actor,session_hash=NULL,token_hash=NULL,state=CASE WHEN state='PENDING' THEN 'CANCELLED' ELSE state END WHERE organization_id=p_org AND opportunity_id=o.id AND id=(p_body->>'id')::uuid AND revoked_at IS NULL;RETURN jsonb_build_object('revoked',true);END IF;
  IF NOT public.trading_quote_is_live(p_org,o.id) THEN RAISE EXCEPTION 'Round expired' USING ERRCODE='42501';END IF;
  IF p_action='PREVIEW' THEN RETURN public.trading_client_monitor_snapshot(p_org,o.id,(o.data->>'expiresAt')::timestamptz);END IF;
  req:=(p_body->>'requestId')::uuid;expiry:=least((p_body->>'expiresAt')::timestamptz,(o.data->>'expiresAt')::timestamptz);
  IF req IS NULL OR expiry IS NULL OR expiry<=now() THEN RAISE EXCEPTION 'Invalid deadline' USING ERRCODE='22023';END IF;
  SELECT lower(contact_email) INTO addr FROM public.customers WHERE organization_id=p_org AND id=o.data->>'customerId' AND deleted_at IS NULL;
  IF addr IS NULL OR addr!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Register client email' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('trading-monitor:'||p_org||':'||o.id::text,0));
  SELECT * INTO m FROM public.trading_client_monitors WHERE organization_id=p_org AND request_id=req;
  IF m.id IS NOT NULL THEN IF m.opportunity_id<>o.id OR m.email<>addr OR m.expires_at<>expiry THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='PT409';END IF;RETURN jsonb_build_object('id',m.id,'state',m.state,'email',m.email,'expiresAt',m.expires_at);END IF;
  IF (SELECT count(*) FROM public.trading_client_monitors WHERE organization_id=p_org AND opportunity_id=o.id AND created_at>=date_trunc('day',now()))>=10 THEN RAISE EXCEPTION 'Daily link limit' USING ERRCODE='22023';END IF;
  INSERT INTO public.trading_client_monitors(organization_id,opportunity_id,customer_id,email,request_id,created_by,expires_at) VALUES(p_org,o.id,o.data->>'customerId',addr,req,p_actor,expiry) RETURNING * INTO m;
  RETURN jsonb_build_object('id',m.id,'state',m.state,'email',m.email,'expiresAt',m.expires_at);
 ELSIF p_action='VIEW' THEN
  IF p_org IS NOT NULL OR p_actor IS NOT NULL OR p_session IS NULL OR p_session!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Session invalid' USING ERRCODE='42501';END IF;
  SELECT * INTO m FROM public.trading_client_monitors WHERE session_hash=p_session AND session_expires_at>now();m:=public.trading_client_monitor_live(m.id);
  RETURN public.trading_client_monitor_snapshot(m.organization_id,m.opportunity_id,m.expires_at)||jsonb_build_object('sessionExpiresAt',m.session_expires_at);
 END IF;RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501';
END$$;
CREATE FUNCTION public.trading_client_monitor_auth(p_token text,p_action text,p_otp text,p_session text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.trading_client_monitors;
BEGIN
 IF p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' OR p_otp IS NULL OR p_otp!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid access' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.trading_client_monitors WHERE token_hash=p_token FOR UPDATE;m:=public.trading_client_monitor_live(m.id);
 IF p_action='CHALLENGE' THEN
  IF m.otp_sent_at>now()-interval '60 seconds' OR(m.otp_day=CURRENT_DATE AND m.otp_count>=10) THEN RETURN jsonb_build_object('allowed',false);END IF;
  UPDATE public.trading_client_monitors SET otp_day=CURRENT_DATE,otp_count=CASE WHEN otp_day=CURRENT_DATE THEN otp_count+1 ELSE 1 END,otp_hash=p_otp,otp_expires_at=least(expires_at,now()+interval '10 minutes'),otp_sent_at=now(),otp_attempts=0 WHERE id=m.id;
  RETURN jsonb_build_object('allowed',true,'id',m.id,'email',m.email);
 ELSIF p_action='VERIFY' THEN
  IF m.otp_hash IS NULL OR m.otp_expires_at<=now() OR m.otp_attempts>=5 THEN RETURN jsonb_build_object('allowed',false);END IF;
  UPDATE public.trading_client_monitors SET otp_attempts=otp_attempts+1 WHERE id=m.id;
  IF m.otp_hash<>p_otp THEN RETURN jsonb_build_object('allowed',false);END IF;
  IF p_session IS NULL OR p_session!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid session' USING ERRCODE='22023';END IF;
  UPDATE public.trading_client_monitors SET session_hash=p_session,session_expires_at=least(expires_at,now()+interval '1 hour'),otp_hash=NULL WHERE id=m.id;RETURN jsonb_build_object('allowed',true);
 END IF;RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501';
END$$;
CREATE FUNCTION public.trading_client_monitor_mail(p_action text,p_id uuid,p_token text,p_daily integer,p_budget bigint,p_cost bigint,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.trading_client_monitors;old public.trading_client_monitors;o public.trading_records;
BEGIN
 IF p_action='CLAIM' THEN
  IF p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' OR p_daily IS NULL OR p_daily<1 OR p_budget IS NULL OR p_budget<1 OR p_cost IS NULL OR p_cost<1 THEN RETURN NULL;END IF;
  UPDATE public.trading_client_monitors SET state='UNKNOWN',diagnostic='RECEIPT_UNCONFIRMED' WHERE state='SENDING' AND started_at<now()-interval '2 minutes';
  SELECT * INTO m FROM public.trading_client_monitors WHERE state='PENDING' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF m.id IS NULL THEN RETURN NULL;END IF;
  BEGIN old:=public.trading_client_monitor_live(m.id);EXCEPTION WHEN insufficient_privilege THEN UPDATE public.trading_client_monitors SET state='CANCELLED',diagnostic='ACCESS_EXPIRED' WHERE id=m.id;RETURN NULL;END;
  BEGIN PERFORM public.assert_trading_actor(m.organization_id,m.created_by,true);EXCEPTION WHEN insufficient_privilege THEN UPDATE public.trading_client_monitors SET state='CANCELLED',diagnostic='AUTHOR_ACCESS_REVOKED' WHERE id=m.id;RETURN NULL;END;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-notice-budget:'||m.organization_id,0));
  IF public.trading_delivery_usage(m.organization_id,'DAY')+(SELECT count(*) FROM public.portal_notification_deliveries WHERE organization_id=m.organization_id AND sequence=1 AND created_at>=date_trunc('day',now()))>=p_daily
  OR public.trading_delivery_usage(m.organization_id,'MONTH')+(SELECT coalesce(sum(cost_micro_usd),0) FROM public.portal_notification_deliveries WHERE organization_id=m.organization_id AND channel<>'INAPP' AND state IN('SENDING','ACCEPTED','DELIVERED','UNKNOWN') AND created_at>=date_trunc('month',now()))+p_cost>p_budget THEN RETURN NULL;END IF;
  UPDATE public.trading_client_monitors SET state='SENDING',started_at=now(),token_hash=p_token,cost_micro_usd=p_cost WHERE id=m.id;
  SELECT * INTO o FROM public.trading_records WHERE organization_id=m.organization_id AND id=m.opportunity_id;
  RETURN jsonb_build_object('id',m.id,'email',m.email,'expiresAt',m.expires_at,'title',o.data->>'title');
 ELSIF p_action='FINISH' THEN
  IF p_result->>'state' NOT IN('ACCEPTED','FAILED','UNKNOWN') THEN RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='22023';END IF;
  UPDATE public.trading_client_monitors SET state=p_result->>'state',provider_id=left(p_result->>'providerId',200),diagnostic=left(p_result->>'diagnostic',100) WHERE id=p_id AND token_hash=p_token AND state IN('SENDING','UNKNOWN');RETURN jsonb_build_object('recorded',FOUND);
 END IF;RAISE EXCEPTION 'Action unavailable' USING ERRCODE='42501';
END$$;
ALTER FUNCTION public.trading_workflow_delivery(text,uuid,uuid,integer,bigint,jsonb,jsonb) RENAME TO trading_workflow_delivery_before_client_monitor;
CREATE FUNCTION public.trading_workflow_delivery(p_action text,p_id uuid,p_lease uuid,p_daily integer,p_budget bigint,p_costs jsonb,p_result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE used bigint;spent bigint;
BEGIN
 IF p_action='CLAIM' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-notice-budget:org_default',0));
  SELECT count(*) FILTER(WHERE created_at>=date_trunc('day',now())),coalesce(sum(cost_micro_usd),0) INTO used,spent FROM public.trading_client_monitors WHERE organization_id='org_default' AND state IN('SENDING','ACCEPTED','UNKNOWN') AND created_at>=date_trunc('month',now());
  p_daily:=p_daily-used;p_budget:=p_budget-spent;IF p_daily<=0 OR p_budget<=0 THEN RETURN NULL;END IF;
 END IF;
 RETURN public.trading_workflow_delivery_before_client_monitor(p_action,p_id,p_lease,p_daily,p_budget,p_costs,p_result);
END$$;
ALTER FUNCTION public.trading_delivery_usage(text,text) RENAME TO trading_delivery_usage_before_client_monitor;
CREATE FUNCTION public.trading_delivery_usage(p_org text,p_period text) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.trading_delivery_usage_before_client_monitor(p_org,p_period)+(SELECT CASE p_period WHEN 'DAY' THEN count(*) ELSE coalesce(sum(cost_micro_usd),0) END FROM public.trading_client_monitors WHERE organization_id=p_org AND state IN('SENDING','ACCEPTED','UNKNOWN') AND created_at>=date_trunc(CASE p_period WHEN 'DAY' THEN 'day' ELSE 'month' END,now()))
$$;
DO $priv$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure name,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND(proname LIKE 'trading_client_monitor%' OR proname IN('trading_delivery_usage','trading_delivery_usage_before_client_monitor','trading_quote_mail','trading_quote_mail_before_client_monitor','trading_workflow_delivery','trading_workflow_delivery_before_client_monitor')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.name);
 IF f.proname IN('trading_client_monitor','trading_client_monitor_auth','trading_client_monitor_mail','trading_quote_mail','trading_workflow_delivery') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.name);END IF;
END LOOP;END $priv$;
COMMENT ON FUNCTION public.trading_client_monitor(text,text,text,text,jsonb) IS 'trading:20261327:v1';
NOTIFY pgrst,'reload schema';
$schema$;
END $install$;
COMMIT;
