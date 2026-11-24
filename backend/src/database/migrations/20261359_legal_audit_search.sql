BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Read only: never enqueues OCR/AI, charges credits or changes an analysis.
CREATE FUNCTION public.legal_audit_excerpt(original text,query_text text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE normalized text:=translate(lower(original),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'); term text; found integer; first_hit integer:=0;start_at integer;
BEGIN
 FOR term IN SELECT value FROM regexp_split_to_table(translate(lower(query_text),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^[:alnum:]]+') value WHERE length(value)>=3 LOOP
  IF numnode(plainto_tsquery('portuguese',term))=0 THEN CONTINUE;END IF;
  found:=strpos(normalized,term);IF found>0 AND(first_hit=0 OR found<first_hit) THEN first_hit:=found;END IF;
 END LOOP;
 start_at:=greatest(1,first_hit-120);
 RETURN CASE WHEN start_at>1 THEN '… ' ELSE '' END||substring(original FROM start_at FOR 650)||CASE WHEN length(original)>start_at+649 THEN ' …' ELSE '' END;
END$$;
REVOKE ALL ON FUNCTION public.legal_audit_excerpt(text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.legal_audit_search(p_org text,p_actor text,p_role text,p_platform boolean,p_query text,p_customer text DEFAULT NULL,p_unit text DEFAULT NULL,p_kind text DEFAULT NULL,p_document text DEFAULT NULL,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='5s' AS $$
DECLARE query tsquery; result jsonb;
BEGIN
 PERFORM public.legal_audit_actor(p_org,p_actor,p_role,p_platform,false);
 IF p_query IS NULL OR length(btrim(p_query)) NOT BETWEEN 3 AND 500 OR p_offset IS NULL OR p_offset<0 OR p_offset>10000 OR p_kind IS NOT NULL AND p_kind NOT IN('CONTRACT_ENERGY','CONTRACT_CUSD','CONTRACT_CCER','CONTRACT_MANAGEMENT','OTHER') OR length(coalesce(p_customer,''))>100 OR length(coalesce(p_unit,''))>100 OR length(coalesce(p_document,''))>100 THEN RAISE EXCEPTION 'Invalid legal search' USING ERRCODE='22023';END IF;
 query:=plainto_tsquery('portuguese',translate(lower(p_query),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'));
 IF numnode(query)=0 THEN RETURN jsonb_build_object('rows','[]'::jsonb,'hasMore',false,'offset',p_offset);END IF;
 WITH latest AS MATERIALIZED (
  SELECT DISTINCT ON(j.document_id) j.id,j.document_id,j.customer_id,j.unit_id,j.pages,j.created_at
  FROM public.legal_audit_jobs j WHERE j.organization_id=p_org AND jsonb_array_length(j.pages)>0
   AND(p_customer IS NULL OR j.customer_id=p_customer) AND(p_unit IS NULL OR j.unit_id=p_unit) AND(p_document IS NULL OR j.document_id=p_document)
  ORDER BY j.document_id,j.created_at DESC,j.id DESC
 ), corpus AS (
  SELECT j.*,d.original_filename,d.document_type,c.company_name,u.name unit_name,
   concat_ws(' ',c.company_name,u.name,d.original_filename) metadata
  FROM latest j JOIN public.documents d ON d.id=j.document_id AND d.organization_id=p_org AND d.customer_id=j.customer_id AND d.consumer_unit_id=j.unit_id
  JOIN public.legal_audit_jobs live ON live.id=j.id AND live.organization_id=p_org AND live.source_hash=d.file_hash
  JOIN public.customers c ON c.id=j.customer_id AND c.organization_id=p_org AND c.deleted_at IS NULL
  JOIN public.consumer_units u ON u.id=j.unit_id AND u.organization_id=p_org AND u.customer_id=c.id
  WHERE d.file_verified=true AND d.document_type IN('CONTRACT_ENERGY','CONTRACT_CUSD','CONTRACT_CCER','CONTRACT_MANAGEMENT','OTHER') AND(p_kind IS NULL OR d.document_type=p_kind)
 ), pages AS (
  SELECT c.*,p.ordinality page_order,p.value->>'text' page_text,CASE WHEN p.value->>'page' ~ '^[0-9]{1,4}$' THEN (p.value->>'page')::integer ELSE p.ordinality::integer END page
  FROM corpus c CROSS JOIN LATERAL jsonb_array_elements(c.pages) WITH ORDINALITY p
 ), ranked AS (
  SELECT *,to_tsvector('portuguese',translate(lower(metadata||' '||page_text),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')) vector FROM pages WHERE length(btrim(page_text))>0
 ), found AS (
  SELECT *,ts_rank_cd(vector,query) score FROM ranked WHERE vector @@ query
 ), windowed AS (
  SELECT * FROM found ORDER BY score DESC,created_at DESC,id,page_order LIMIT 21 OFFSET p_offset
 ), displayed AS (
  SELECT * FROM windowed ORDER BY score DESC,created_at DESC,id,page_order LIMIT 20
 )
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(jsonb_build_object('analysisId',id,'documentId',document_id,'customerId',customer_id,'unitId',unit_id,'customerName',company_name,'unitName',unit_name,'filename',original_filename,'kind',document_type,'page',page,
  'excerpt',public.legal_audit_excerpt(page_text,p_query)) ORDER BY score DESC,created_at DESC,id,page_order) FROM displayed),'[]'::jsonb),
  'hasMore',(SELECT count(*)>20 FROM windowed),'offset',p_offset) INTO result;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.legal_audit_search(text,text,text,boolean,text,text,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.legal_audit_search(text,text,text,boolean,text,text,text,text,text,integer) TO service_role;
COMMIT;
