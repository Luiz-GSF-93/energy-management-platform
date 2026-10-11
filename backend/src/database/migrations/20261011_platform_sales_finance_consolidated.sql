BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Additive projection only: no writes/backfills or changes to existing readers.
CREATE OR REPLACE FUNCTION public.read_platform_sales_finance_consolidated(
 p_actor uuid,p_page integer,p_search text,p_status text,p_from date,p_to date,p_review boolean,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE history jsonb; result jsonb;
BEGIN
 -- Reuse the existing database authority; Finance must already have its capability.
 history:=public.read_platform_sales_finance(p_actor,p_page,p_search,p_status,p_from,p_to,p_id);
 IF p_review IS NULL THEN RAISE EXCEPTION 'Invalid review filter' USING ERRCODE='22023'; END IF;
 WITH sources AS (
  SELECT b.id,b.company,b.payment_id "paymentId",b.proposal_id "proposalId",b.gross_cents "expectedCents",
   c.created_at "checkedAt",c.status "checkResult",e.received_at "receivedAt",
   c.summary,
   coalesce(c.status='VERIFIED' AND c.summary->>'id'=b.payment_id
    AND c.summary->>'customer'=b.customer_id AND c.summary->>'reference'=b.id::text
    AND c.summary->>'grossCents'=b.gross_cents::text
    AND c.summary->>'status' IN ('PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED'),false) compatible,
   coalesce(e.received_at>c.created_at OR (e.received_at IS NOT NULL AND c.id IS NULL),false) "pendingEvent",
   EXISTS(SELECT 1 FROM public.platform_sales_asaas_checks x JOIN public.platform_sales_asaas_inbox i ON i.id=x.event_id
    WHERE i.payment_id=b.payment_id AND x.created_at=c.created_at AND x.id<>c.id) ambiguous
  FROM public.platform_sales_asaas_bindings b
  LEFT JOIN LATERAL(SELECT x.* FROM public.platform_sales_asaas_checks x JOIN public.platform_sales_asaas_inbox i ON i.id=x.event_id
   WHERE i.payment_id=b.payment_id ORDER BY x.created_at DESC,x.id DESC LIMIT 1)c ON true
  LEFT JOIN LATERAL(SELECT i.received_at FROM public.platform_sales_asaas_inbox i WHERE i.payment_id=b.payment_id
   ORDER BY i.received_at DESC,i.id DESC LIMIT 1)e ON true
  WHERE (p_id IS NULL OR b.id=p_id)
   AND (p_search='' OR strpos(lower(b.company),lower(p_search))>0 OR strpos(b.payment_id,p_search)>0 OR strpos(b.proposal_id::text,p_search)>0)
   AND (p_from IS NULL OR b.created_at>=p_from::timestamptz) AND (p_to IS NULL OR b.created_at<(p_to+1)::timestamptz)
 ), projected AS (
  SELECT id,company,"paymentId","proposalId","expectedCents","checkedAt","receivedAt","checkResult","pendingEvent",
   NOT compatible OR "pendingEvent" OR ambiguous AS "requiresReview",
   CASE WHEN compatible AND NOT "pendingEvent" AND NOT ambiguous THEN summary->>'status' ELSE 'UNKNOWN' END status,
   CASE WHEN ambiguous THEN 'AMBIGUOUS_CHECK_ORDER' WHEN "pendingEvent" THEN 'EVENT_AFTER_CHECK'
    WHEN "checkedAt" IS NULL THEN 'NO_CHECK' WHEN "checkResult"<>'VERIFIED' THEN 'CHECK_REQUIRES_REVIEW'
    WHEN NOT compatible THEN 'INCOMPATIBLE_CHECK' ELSE NULL END reason,
   CASE WHEN compatible AND NOT "pendingEvent" AND NOT ambiguous THEN (summary->>'grossCents')::bigint ELSE NULL END "grossCents",
   CASE WHEN compatible AND NOT "pendingEvent" AND NOT ambiguous THEN (summary->>'netCents')::bigint ELSE NULL END "netCents"
  FROM sources
 ), filtered AS (SELECT * FROM projected WHERE (p_status='' OR status=p_status) AND (NOT p_review OR "requiresReview"))
 SELECT jsonb_build_object('environment','SANDBOX','currency','BRL','asOf',clock_timestamp(),
  'total',(SELECT count(*) FROM filtered),
  'rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT * FROM filtered ORDER BY company,id LIMIT 25 OFFSET p_page*25)x),
  'totals',(SELECT jsonb_build_object(
   'receivedCount',count(*) FILTER(WHERE status='RECEIVED'),
   'receivedGrossCents',coalesce(sum("grossCents") FILTER(WHERE status='RECEIVED'),0)::text,
   'receivedKnownNetCents',coalesce(sum("netCents") FILTER(WHERE status='RECEIVED' AND "netCents" IS NOT NULL),0)::text,
   'receivedNetMissingCount',count(*) FILTER(WHERE status='RECEIVED' AND "netCents" IS NULL),
   'pendingCount',count(*) FILTER(WHERE status='PENDING'),
   'overdueCount',count(*) FILTER(WHERE status='OVERDUE'),
   'confirmedCount',count(*) FILTER(WHERE status='CONFIRMED'),
   'refundedCount',count(*) FILTER(WHERE status='REFUNDED'),
   'reviewCount',count(*) FILTER(WHERE "requiresReview")) FROM filtered),
  'fiscalStatus','NOT_INTEGRATED','refundAmountsStatus','NOT_INTEGRATED') INTO result;
 IF p_id IS NOT NULL THEN result:=result||jsonb_build_object('history',history); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_platform_sales_finance_consolidated(uuid,integer,text,text,date,date,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_platform_sales_finance_consolidated(uuid,integer,text,text,date,date,boolean,uuid) TO service_role;
COMMIT;
