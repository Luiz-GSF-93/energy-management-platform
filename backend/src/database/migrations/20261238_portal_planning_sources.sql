BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Service-only source adapter. The existing live membership/license gate derives the customer.
CREATE FUNCTION public.energy_forecast_client_sources(p_org text,p_actor text,p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE gate jsonb; customer text; pubs jsonb:='[]'; units jsonb; y integer;
BEGIN
 gate:=public.energy_forecast_client_published(p_org,p_actor,p_role);
 customer:=gate->>'customerId';
 IF customer IS NULL THEN RAISE EXCEPTION 'Client scope unavailable' USING ERRCODE='42501'; END IF;
 FOR y IN extract(year FROM current_date)::integer-3..extract(year FROM current_date)::integer LOOP
  pubs:=pubs||public.read_portal_financial_components_v2(p_org,p_actor,p_role,false,true,y::text||'-01',y::text||'-12',customer);
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('organizationId',p_org,'customerId',customer,'unitId',u.id,'unitName',u.name,
  'publications',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'month'),'[]') FROM jsonb_array_elements(pubs)x WHERE x->>'customerId'=customer AND x->>'unitId'=u.id),
  'invoice',invoice.source,
  'ccee',(SELECT coalesce(jsonb_agg(q.source ORDER BY q.month),'[]') FROM (
   SELECT DISTINCT ON(j.month) j.month,jsonb_build_object('id',j.id,'month',to_char(j.month,'YYYY-MM'),'finishedAt',j.finished_at,
    'record',j.result->'record','data',jsonb_build_object('timeSemantics',j.result#>'{data,timeSemantics}',
     'rows',j.result#>'{data,rows}','totalKwh',j.result#>'{data,totalKwh}','expectedHours',j.result#>'{data,expectedHours}')) source
   FROM public.ccee_integration_jobs j JOIN public.ccee_unit_authorizations a ON a.id=j.authorization_id AND a.organization_id=j.organization_id
   WHERE j.organization_id=p_org AND a.customer_id=customer AND a.consumer_unit_id=u.id
    AND a.status='APPROVED' AND a.reviewed_at IS NOT NULL AND a.measurement_basis='NO_LOSSES' AND a.service_scope?'MEASUREMENTS'
    AND a.valid_from<=j.month AND (a.valid_to IS NULL OR a.valid_to>=(j.month+interval '1 month - 1 day')::date)
    AND NOT EXISTS(SELECT 1 FROM public.ccee_unit_authorizations newer WHERE newer.organization_id=p_org AND newer.consumer_unit_id=u.id AND newer.revision>a.revision)
    AND j.environment='PRODUCTION' AND j.kind='MEASUREMENTS' AND j.measurement_kind='FINAL' AND j.state='SUCCEEDED'
    AND j.result->'complete'='true'::jsonb AND j.result#>>'{data,timeSemantics}'='CCEE_HOUR_LABEL_V2'
    AND j.result#>>'{record,evidence,finality}'='FINAL' AND j.result#>>'{record,binding,authorizationRevision}'=a.revision::text
    AND to_char(j.month,'YYYY-MM')<=(SELECT max(x->>'month') FROM jsonb_array_elements(pubs)x WHERE x->>'unitId'=u.id AND x->>'customerId'=customer)
    AND j.month>=date_trunc('month',current_date)-interval '36 months'
   ORDER BY j.month,j.finished_at DESC,j.id DESC LIMIT 36
  )q)) ORDER BY u.name,u.id),'[]') INTO units
 FROM public.consumer_units u
 LEFT JOIN LATERAL (
  SELECT jsonb_build_object('documentId',d.id,'fileHash',d.file_hash,'month',v.month,'publicationId',p.id,
   'publicationHash',p.source_hash,'publishedAt',p.created_at,'raw',r.raw_result) source
  FROM public.eva_closing_publications p
  JOIN public.eva_assisted_closing_versions v ON v.id=p.closing_id AND v.organization_id=p.organization_id AND v.payload_hash=p.source_hash
  CROSS JOIN LATERAL jsonb_array_elements(v.report->'units') vu
  JOIN public.documents d ON d.id=vu->>'documentId' AND d.organization_id=p_org AND d.customer_id=customer
   AND d.consumer_unit_id=u.id AND d.file_hash=vu->>'sourceHash' AND d.file_verified
  JOIN public.document_ocr_jobs j ON j.document_id=d.id AND j.organization_id=p_org AND j.file_hash=d.file_hash AND j.state='SUCCEEDED'
  JOIN public.document_ocr_results r ON r.job_id=j.id AND r.organization_id=p_org AND r.document_id=d.id AND r.file_hash=d.file_hash
  WHERE p.organization_id=p_org AND p.customer_id=customer AND vu->>'id'=u.id
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(pubs)x WHERE x->>'publicationId'=p.id::text AND x->>'sourceHash'=p.source_hash AND x->>'unitId'=u.id AND x->>'month'=v.month)
  ORDER BY v.month DESC,p.created_at DESC,j.created_at DESC LIMIT 1
 )invoice ON true
 WHERE u.organization_id=p_org AND u.customer_id=customer AND u.status='ACTIVE'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(pubs)x WHERE x->>'unitId'=u.id AND x->>'customerId'=customer);
 RETURN jsonb_build_object('customerId',customer,'units',units);
END $$;
REVOKE ALL ON FUNCTION public.energy_forecast_client_sources(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.energy_forecast_client_sources(text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
