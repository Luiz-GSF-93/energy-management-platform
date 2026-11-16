BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $install$ BEGIN
 IF to_regprocedure('public.expire_trading_quotes()') IS NOT NULL THEN
  IF obj_description(to_regprocedure('public.expire_trading_quotes()'),'pg_proc') IS DISTINCT FROM 'trading:20261325:v1' THEN RAISE EXCEPTION 'Review existing quotation expiry schema'; END IF;
  RETURN;
 END IF;
 EXECUTE $schema$
CREATE FUNCTION public.trading_quote_is_live(p_org text,p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT r.kind='opportunity' AND r.status IN('OPEN','ANALYSIS') AND (r.data->>'expiresAt')::timestamptz>now() AND public.trading_license_active(p_org) FROM public.trading_records r WHERE r.organization_id=p_org AND r.id=p_id),false)
$$;
CREATE FUNCTION public.assert_trading_reference_prices(d jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r jsonb;year integer;n integer;seen integer[]='{}';first_year integer;
BEGIN
 IF jsonb_typeof(d->'annualReferencePrices') IS DISTINCT FROM 'array' OR (d->>'startMonth') !~ '^\d{4}-(0[1-9]|1[0-2])$' OR coalesce((d->>'months')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Annual reference prices required' USING ERRCODE='22023';END IF;
 n:=ceil((d->>'months')::numeric/12)::integer;first_year:=left(d->>'startMonth',4)::integer;
 IF jsonb_array_length(d->'annualReferencePrices')<>n THEN RAISE EXCEPTION 'One reference per supply year required' USING ERRCODE='22023';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(d->'annualReferencePrices') LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR jsonb_typeof(r->'year') IS DISTINCT FROM 'number' OR jsonb_typeof(r->'priceBrlMwh') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Reference data invalid' USING ERRCODE='22023';END IF;
  year:=(r->>'year')::integer;
  IF year<first_year OR year>=first_year+n OR year=ANY(seen) OR (r->>'priceBrlMwh')::numeric<=0 OR (r->>'priceBrlMwh')::numeric>10000000 THEN RAISE EXCEPTION 'Reference year or price invalid' USING ERRCODE='22023';END IF;
  seen:=array_append(seen,year);
 END LOOP;
END$$;
CREATE FUNCTION public.guard_trading_quote_lifetime() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expires timestamptz;
BEGIN
 IF NEW.kind='opportunity' THEN
  IF TG_OP='UPDATE' AND (OLD.data->>'expiresAt')::timestamptz<=now() AND NEW.status NOT IN('CANCELLED','CLOSED') THEN RAISE EXCEPTION 'Expired quotation cannot be reopened or reused' USING ERRCODE='42501';END IF;
  IF NEW.status IN('OPEN','ANALYSIS') AND (TG_OP='INSERT' OR OLD.status='DRAFT') THEN
   IF (NEW.data->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'Quotation expired' USING ERRCODE='42501';END IF;
   IF NEW.data->>'commercialTermsVersion'='2' OR NEW.data ? 'annualReferencePrices' THEN PERFORM public.assert_trading_reference_prices(NEW.data);END IF;
  END IF;
 ELSIF NEW.kind='proposal' AND NEW.status NOT IN('CANCELLED','REJECTED') THEN
  IF NOT EXISTS(SELECT 1 FROM public.trading_records WHERE organization_id=NEW.organization_id AND id=NEW.parent_id AND kind='opportunity' AND status IN('DRAFT','OPEN','ANALYSIS') AND (data->>'expiresAt')::timestamptz>now()) THEN RAISE EXCEPTION 'Quotation unavailable or expired' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER trading_quote_lifetime BEFORE INSERT OR UPDATE ON public.trading_records FOR EACH ROW EXECUTE FUNCTION public.guard_trading_quote_lifetime();
CREATE FUNCTION public.guard_trading_invitation_lifetime() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expires timestamptz;
BEGIN
 IF NEW.state='REVOKED' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state AND NEW.token_hash IS NOT DISTINCT FROM OLD.token_hash AND NEW.session_hash IS NOT DISTINCT FROM OLD.session_hash AND NEW.otp_hash IS NOT DISTINCT FROM OLD.otp_hash THEN RETURN NEW;END IF;
 SELECT (data->>'expiresAt')::timestamptz INTO expires FROM public.trading_records WHERE organization_id=NEW.organization_id AND id=NEW.opportunity_id AND kind='opportunity';
 IF NOT public.trading_quote_is_live(NEW.organization_id,NEW.opportunity_id) OR NEW.expires_at>expires THEN RAISE EXCEPTION 'Invitation cannot outlive the quotation' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER trading_invitation_lifetime BEFORE INSERT OR UPDATE ON public.trading_invitations FOR EACH ROW EXECUTE FUNCTION public.guard_trading_invitation_lifetime();
CREATE FUNCTION public.guard_trading_approval_lifetime() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.state='COMPLETED' AND EXISTS(SELECT 1 FROM public.trading_records q JOIN public.trading_records p ON p.organization_id=q.organization_id AND p.parent_id=q.id WHERE q.organization_id=NEW.organization_id AND q.id=NEW.opportunity_id AND q.status='CLOSED' AND (q.data->>'expiresAt')::timestamptz>now() AND p.id=NEW.proposal_id AND p.status='CONTRACTED') AND public.trading_license_active(NEW.organization_id) THEN RETURN NEW;END IF;
 IF NEW.state NOT IN('REVOKED','REJECTED') AND NOT public.trading_quote_is_live(NEW.organization_id,NEW.opportunity_id) THEN RAISE EXCEPTION 'Expired quotation cannot authorize a decision' USING ERRCODE='42501';END IF;RETURN NEW;
END$$;
CREATE TRIGGER trading_approval_lifetime BEFORE INSERT OR UPDATE ON public.trading_approval_workflows FOR EACH ROW EXECUTE FUNCTION public.guard_trading_approval_lifetime();
CREATE OR REPLACE FUNCTION public.trading_formalization_assert(p_hash text,p_session boolean) RETURNS public.trading_formalization_access
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.trading_formalization_access;w public.trading_approval_workflows;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_session IS NULL THEN RAISE EXCEPTION 'Access unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO a FROM public.trading_formalization_access WHERE CASE WHEN p_session THEN session_hash ELSE token_hash END=p_hash AND revoked_at IS NULL;
 IF a.id IS NULL OR(p_session AND(a.session_expires_at IS NULL OR a.session_expires_at<=now())) OR NOT public.trading_license_active(a.organization_id) THEN RAISE EXCEPTION 'Access expired or revoked' USING ERRCODE='42501';END IF;
 SELECT * INTO w FROM public.trading_approval_workflows WHERE id=a.workflow_id AND organization_id=a.organization_id;
 IF NOT public.trading_quote_is_live(w.organization_id,w.opportunity_id) OR w.state NOT IN('SUPPLIER_PENDING','FORMALIZING') OR NOT EXISTS(SELECT 1 FROM public.trading_records p WHERE p.id=w.proposal_id AND p.organization_id=w.organization_id AND p.status='CLIENT_APPROVED' AND p.data=w.proposal_data AND p.revision=w.proposal_revision)
 OR NOT EXISTS(SELECT 1 FROM public.trading_records s WHERE s.id=w.supplier_id AND s.organization_id=w.organization_id AND s.status='ACTIVE')
 OR NOT EXISTS(SELECT 1 FROM public.customers c JOIN public.consumer_units u ON u.organization_id=c.organization_id AND u.customer_id=c.id WHERE c.organization_id=w.organization_id AND c.id=w.customer_id AND u.id=w.unit_id AND c.status='ACTIVE' AND c.deleted_at IS NULL AND u.status='ACTIVE') THEN RAISE EXCEPTION 'Negotiation unavailable or expired' USING ERRCODE='42501';END IF;
 RETURN a;
END$$;
CREATE FUNCTION public.expire_trading_quotes() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q public.trading_records;p public.trading_records;n integer=0;
BEGIN
 FOR q IN SELECT * FROM public.trading_records WHERE kind='opportunity' AND status IN('DRAFT','OPEN','ANALYSIS') AND (data->>'expiresAt')::timestamptz<=now() ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT 50 LOOP
  UPDATE public.trading_records SET status=CASE WHEN EXISTS(SELECT 1 FROM public.trading_records WHERE organization_id=q.organization_id AND parent_id=q.id AND status='CONTRACTED') THEN 'CLOSED' ELSE 'CANCELLED' END,revision=revision+1,updated_by='system:trading-expiry',updated_at=clock_timestamp() WHERE id=q.id RETURNING * INTO q;
  INSERT INTO public.trading_history(organization_id,record_id,revision,actor_id,action,reason,snapshot) VALUES(q.organization_id,q.id,q.revision,'system:trading-expiry','EXPIRED','Prazo expirado; ações e acessos da cotação encerrados.',to_jsonb(q));
  UPDATE public.trading_invitations SET state='REVOKED',session_hash=NULL,session_expires_at=NULL,otp_hash=NULL WHERE organization_id=q.organization_id AND opportunity_id=q.id AND state IN('PENDING','RESPONDED');
  FOR p IN UPDATE public.trading_records SET status='CANCELLED',revision=revision+1,updated_by='system:trading-expiry',updated_at=clock_timestamp() WHERE organization_id=q.organization_id AND parent_id=q.id AND kind='proposal' AND status NOT IN('CONTRACTED','REJECTED','DECLINED','CANCELLED') RETURNING * LOOP
   INSERT INTO public.trading_history(organization_id,record_id,revision,actor_id,action,reason,snapshot) VALUES(p.organization_id,p.id,p.revision,'system:trading-expiry','EXPIRED','Proposta encerrada pelo vencimento da cotação; histórico preservado.',to_jsonb(p));
  END LOOP;n:=n+1;
 END LOOP;RETURN n;
END$$;
REVOKE ALL ON FUNCTION public.trading_quote_is_live(text,uuid),public.assert_trading_reference_prices(jsonb),public.guard_trading_quote_lifetime(),public.guard_trading_invitation_lifetime(),public.guard_trading_approval_lifetime(),public.expire_trading_quotes() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.expire_trading_quotes() TO service_role;
COMMENT ON FUNCTION public.expire_trading_quotes() IS 'trading:20261325:v1';
NOTIFY pgrst,'reload schema';
$schema$;
END $install$;
COMMIT;
