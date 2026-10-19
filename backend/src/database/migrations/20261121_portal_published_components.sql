BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Additional, narrowly projected evidence of an already disclosed, approved version.
CREATE FUNCTION public.read_eva_published_components(p_org text,p_actor text,p_role text,p_platform boolean,p_portal boolean,p_from text,p_to text,p_customer text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pubs jsonb; result jsonb;
BEGIN
 pubs:=public.read_eva_closing_publications(p_org,p_actor,p_role,p_platform,p_portal,p_from,p_to,p_customer);
 WITH latest AS (
  SELECT DISTINCT ON(x#>>'{projection,customerId}',x#>>'{projection,month}') x FROM jsonb_array_elements(pubs)x
  ORDER BY x#>>'{projection,customerId}',x#>>'{projection,month}',(x->>'publishedAt')::timestamptz DESC,x->>'id' DESC
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('publicationId',x->>'id','sourceHash',x->>'sourceHash','publishedAt',x->>'publishedAt','customerId',v.customer_id,'month',v.month,'unitId',u->>'id','name',u->>'name',
 'invoice',u#>>'{prepared,invoice,amount}','supplier',u#>>'{prepared,supplier,amount}',
 'financial',jsonb_build_object('acr',u->>'acr','aclBeforeFees',u->>'aclBeforeFees','aclAfterFees',u->>'aclAfterFees','fees',u->>'totalFees'),
 'fields',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',f->>'key','value',f->'value')),'[]') FROM jsonb_array_elements(coalesce(u->'fields','[]'))f WHERE f->>'state'='FILLED' AND f->>'key' IN('consumptionTotal','consumptionPeak','consumptionOffPeak','supplier:tax')),
 'tariffLines',(SELECT coalesce(jsonb_agg(jsonb_build_object('component',l->>'component','band',l->>'band','measure',l->>'measure','quantity',l->>'quantity','rate',l->>'rate','amount',l->>'amount')),'[]') FROM jsonb_array_elements(coalesce(u#>'{methodology,lines}','[]'))l WHERE l->>'component'='TE'),
 'retained',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',r->>'kind','label',left(r->>'label',200),'amount',r->>'amount','quantity',r->>'quantity','unit',r->>'unit')),'[]') FROM jsonb_array_elements(coalesce(u#>'{methodology,retained}','[]'))r),
 'method',u#>>'{methodology,method}')),'[]') INTO result
 FROM latest JOIN public.eva_assisted_closing_versions v ON v.id=(x->>'closingId')::uuid AND v.organization_id=p_org AND v.payload_hash=x->>'sourceHash'
 CROSS JOIN LATERAL jsonb_array_elements(v.report->'units')u
 WHERE x->>'state'='PUBLISHED' AND EXISTS(SELECT 1 FROM public.consumer_units cu WHERE cu.organization_id=p_org AND cu.customer_id=v.customer_id AND cu.id=u->>'id' AND cu.status='ACTIVE')
 AND NOT EXISTS(SELECT 1 FROM public.monthly_energy_settlements f WHERE f.organization_id=p_org AND f.customer_id=v.customer_id AND to_char(f.month,'YYYY-MM')=v.month AND f.status='PUBLISHED' AND f.published_at>(x->>'publishedAt')::timestamptz);
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.read_eva_published_components(text,text,text,boolean,boolean,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_eva_published_components(text,text,text,boolean,boolean,text,text,text) TO service_role;
COMMIT;
