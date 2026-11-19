BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$BEGIN
 IF to_regprocedure('public.trading_client_monitor_before_supply_v3(text,text,text,text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.trading_client_monitor(text,text,text,text,jsonb) RENAME TO trading_client_monitor_before_supply_v3;
 END IF;
END$$;
CREATE OR REPLACE FUNCTION public.trading_client_monitor(p_org text,p_actor text,p_session text,p_action text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE answer jsonb;o public.trading_records;org text;op uuid;uid text;yr integer;period jsonb;options jsonb;ps jsonb;hh jsonb;
BEGIN
 -- The existing entry point validates tenant, actor/session, license, customer, revocation and round lifetime first.
 answer:=public.trading_client_monitor_before_supply_v3(p_org,p_actor,p_session,p_action,p_body);
 IF p_action NOT IN('PREVIEW','VIEW') OR answer->'opportunity'->'data'->>'supplyVersion' IS DISTINCT FROM '3' THEN RETURN answer;END IF;
 IF p_action='PREVIEW' THEN org:=p_org;op:=(p_body->>'opportunityId')::uuid;
 ELSE SELECT organization_id,opportunity_id INTO org,op FROM public.trading_client_monitors WHERE session_hash=p_session AND session_expires_at>now();END IF;
 SELECT * INTO o FROM public.trading_records WHERE organization_id=org AND id=op AND kind='opportunity';
 IF o.id IS NULL THEN RAISE EXCEPTION 'Scope unavailable' USING ERRCODE='42501';END IF;
 uid:=coalesce(p_body->>'unitId',o.data->'unitIds'->>0);yr:=coalesce((p_body->>'year')::integer,(o.data->'supplyPeriods'->0->>'year')::integer);
 SELECT value INTO period FROM jsonb_array_elements(o.data->'supplyPeriods') WHERE (value->>'year')::integer=yr;
 IF NOT coalesce(o.data->'unitIds' ? uid,false) OR period IS NULL THEN RAISE EXCEPTION 'Unit or year outside this quotation' USING ERRCODE='42501';END IF;
 SELECT jsonb_agg(jsonb_build_object('unitId',u->>'id','unitName',u->>'name','year',p->'year','startDate',p->'startDate','endDate',p->'endDate','months',p->'months') ORDER BY u->>'name',(p->>'year')::integer) INTO options FROM jsonb_array_elements(o.data->'unitSnapshots') u CROSS JOIN jsonb_array_elements(o.data->'supplyPeriods') p;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'created_at',r.created_at,'data',jsonb_build_object('supplierId',r.data->'supplierId','energyType',r.data->'energyType','validUntil',r.data->'validUntil','priceBrlMwh',price->'priceBrlMwh','flexibilityUpperPercent',offer->'flexibilityUpperPercent','flexibilityLowerPercent',offer->'flexibilityLowerPercent','seasonality',offer->'seasonality','correctionIndex',offer->'correctionIndex','billingTerms',offer->'billingTerms','guarantees',offer->'guarantees','conditions',offer->'conditions'))),'[]') INTO ps
 FROM public.trading_records r CROSS JOIN LATERAL jsonb_array_elements(r.data->'unitOffers') offer CROSS JOIN LATERAL jsonb_array_elements(offer->'periodPrices') price
 WHERE r.organization_id=org AND r.parent_id=op AND r.kind='proposal' AND offer->>'unitId'=uid AND (price->>'year')::integer=yr;
 SELECT coalesce(jsonb_agg(x),'[]') INTO hh FROM(SELECT jsonb_build_object('proposalId',h.record_id,'at',h.recorded_at,'priceBrlMwh',price->'priceBrlMwh') x FROM public.trading_history h JOIN public.trading_records r ON r.id=h.record_id AND r.organization_id=h.organization_id CROSS JOIN LATERAL jsonb_array_elements(h.snapshot->'data'->'unitOffers') offer CROSS JOIN LATERAL jsonb_array_elements(offer->'periodPrices') price WHERE h.organization_id=org AND r.parent_id=op AND r.kind='proposal' AND offer->>'unitId'=uid AND (price->>'year')::integer=yr ORDER BY h.recorded_at DESC LIMIT 500) q;
 RETURN answer||jsonb_build_object('scope',jsonb_build_object('unitId',uid,'unitName',(SELECT u->>'name' FROM jsonb_array_elements(o.data->'unitSnapshots') u WHERE u->>'id'=uid),'year',yr)||period,'scopeOptions',options,'proposals',ps,'history',hh,
 'opportunity',jsonb_build_object('data',o.data||jsonb_build_object('startMonth',left(period->>'startDate',7),'months',period->'months','annualReferencePrices',(SELECT jsonb_agg(r) FROM jsonb_array_elements(o.data->'annualReferencePrices') r WHERE (r->>'year')::integer=yr))));
END$$;
REVOKE ALL ON FUNCTION public.trading_client_monitor_before_supply_v3(text,text,text,text,jsonb),public.trading_client_monitor(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.trading_client_monitor(text,text,text,text,jsonb) TO service_role;
COMMENT ON FUNCTION public.trading_client_monitor(text,text,text,text,jsonb) IS 'trading:20261327:v1';
COMMIT;
