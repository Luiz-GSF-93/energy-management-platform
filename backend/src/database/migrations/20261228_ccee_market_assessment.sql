BEGIN;
CREATE FUNCTION public.ccee_market_monthly_history(p_org text,p_actor text,p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE as_of date; first_month date; result jsonb;
BEGIN
 PERFORM public.assert_ccee_data_actor(p_org,p_actor,'view');
 IF p_to IS NULL OR p_to<'2021-01-01'::date THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023';END IF;
 as_of:=least(p_to,(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date);
 first_month:=(date_trunc('month',as_of)-interval '24 months')::date;
 WITH latest AS(SELECT DISTINCT ON(period_start,submarket) period_start,submarket,value_brl_mwh,source_hash FROM public.ccee_price_observations
  WHERE organization_id=p_org AND period_start=date_trunc('hour',period_start) AND period_start>=first_month::timestamp AT TIME ZONE 'America/Sao_Paulo' AND period_start<(as_of+1)::timestamp AT TIME ZONE 'America/Sao_Paulo' ORDER BY period_start,submarket,retrieved_at DESC,id DESC),
 measured AS(SELECT date_trunc('month',period_start AT TIME ZONE 'America/Sao_Paulo')::date AS month,submarket,avg(value_brl_mwh) AS value,count(*)::integer AS hours,
  'SOAP'::text AS origin,'https://servicos.ccee.org.br/ws/prec/PLDBSv1'::text AS source,encode(sha256(convert_to(string_agg(source_hash,'' ORDER BY period_start),'UTF8')),'hex') AS hash FROM latest GROUP BY 1,2),
 candidates AS(SELECT month,submarket,value,hours,origin,source,hash FROM measured UNION ALL
  SELECT month,submarket,mean_brl_mwh,hours,'OFFICIAL_MONTHLY',source,source_hash FROM public.energy_price_pld_monthly WHERE organization_id=p_org AND month>=first_month),
 eligible AS(SELECT *,extract(day FROM month+interval '1 month'-interval '1 day')::integer*24 AS expected FROM candidates
  WHERE month+interval '1 month'<=(as_of+1)::timestamp AND hours=extract(day FROM month+interval '1 month'-interval '1 day')::integer*24),
 preferred AS(SELECT DISTINCT ON(month,submarket) * FROM eligible ORDER BY month,submarket,CASE WHEN origin='OFFICIAL_MONTHLY' THEN 0 ELSE 1 END)
 SELECT coalesce(jsonb_agg(jsonb_build_object('month',to_char(month,'YYYY-MM-DD'),'submarket',submarket,'value',value::numeric(14,6)::text,'hours',hours,'expectedHours',expected,'origin',origin,'source',source,'hash',hash) ORDER BY month,submarket),'[]') INTO result FROM preferred;
 RETURN jsonb_build_object('organizationId',p_org,'asOf',to_char(as_of,'YYYY-MM-DD'),'rows',result);
END$$;
CREATE FUNCTION public.eva_market_local_hits(p_actor uuid,p_org text,p_role text,p_operation boolean,p_asof date,p_composite boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE sources jsonb; hits jsonb; period jsonb; terms tsquery;
BEGIN
 IF p_asof IS NULL OR p_asof<'2021-01-01'::date OR p_asof>(clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date OR p_composite IS NULL THEN RAISE EXCEPTION 'Invalid context date' USING ERRCODE='22023';END IF;
 period:=jsonb_build_object('from',to_char(p_asof,'YYYY-MM-DD'),'to',to_char(p_asof,'YYYY-MM-DD'),'market','ACL');
 -- Existing publication gate remains the authority for organization, actor,
 -- license, role, operation session, revocation and publication integrity.
 IF p_composite THEN sources:=public.eva_composite_rag(p_actor,p_org,p_role,p_operation,'sources',period);
 ELSE sources:=public.eva_corpus_rag(p_actor,p_org,p_role,p_operation,'sources',period);END IF;
 terms:=to_tsquery('portuguese','PLD | preço | hidrologia | sazonalidade | submercado | contratação');
 WITH candidates AS(
  SELECT s.value->>'releaseId' AS release,s.value->>'revisionId' AS revision,c.id AS id,c.content AS text,c.content_hash AS hash
  FROM jsonb_array_elements(sources)s(value) JOIN public.eva_search_chunks c ON c.release_id=(s.value->>'releaseId')::uuid WHERE coalesce(s.value->>'kind','')<>'COMPOSITE'
  UNION ALL
  SELECT s.value->>'releaseId',s.value->>'revisionId',c.value->>'id',c.value->>'text',c.value->>'textHash'
  FROM jsonb_array_elements(sources)s(value) JOIN public.eva_composite_release_batches b ON b.release_id=(s.value->>'releaseId')::uuid AND b.state='PUBLISHED'
  CROSS JOIN LATERAL jsonb_array_elements(b.chunks)c(value) WHERE s.value->>'kind'='COMPOSITE'),
 ranked AS(SELECT *,ts_rank_cd(to_tsvector('portuguese',text),terms) AS score FROM candidates WHERE to_tsvector('portuguese',text)@@terms ORDER BY score DESC,release,id LIMIT 6)
 SELECT coalesce(jsonb_agg(jsonb_build_object('releaseId',release,'revisionId',revision,'chunkId',id,'contentHash',hash,'score',score) ORDER BY score DESC,release,id),'[]') INTO hits FROM ranked;
 RETURN jsonb_build_object('organizationId',p_org,'asOf',to_char(p_asof,'YYYY-MM-DD'),'sources',sources,'hits',hits);
END$$;
REVOKE ALL ON FUNCTION public.ccee_market_monthly_history(text,text,date),public.eva_market_local_hits(uuid,text,text,boolean,date,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ccee_market_monthly_history(text,text,date),public.eva_market_local_hits(uuid,text,text,boolean,date,boolean) TO service_role;
COMMIT;
