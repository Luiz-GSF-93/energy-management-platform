BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.platform_sales_evidence_validate_diagnostics(d jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE x jsonb;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid diagnostics' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(d)>4 THEN RAISE EXCEPTION 'Too many diagnostics' USING ERRCODE='22023';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(d) LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR x-ARRAY['scope','code','httpStatus']<>'{}' OR NOT x ?& ARRAY['scope','code']
   OR jsonb_typeof(x->'scope') IS DISTINCT FROM 'string' OR x->>'scope' NOT IN ('PAYMENT','REFUNDS','INVOICES','RECHECK','COLLECTION')
   OR jsonb_typeof(x->'code') IS DISTINCT FROM 'string' OR x->>'code' NOT IN ('QUERY_FAILED','CONFIG_INVALID','TIMEOUT','NETWORK_ERROR','HTTP_ERROR','RESPONSE_LIMIT','JSON_INVALID','PAYMENT_SCHEMA_INVALID','REFUNDS_ENVELOPE_INVALID','REFUND_ROW_INVALID','INVOICES_ENVELOPE_INVALID','INVOICE_ROW_INVALID','BINDING_MISMATCH','DUPLICATE_ITEMS','HISTORY_TRUNCATED','PAGINATION_CHANGED','COLLECTION_DEADLINE','SOURCE_CHANGED')
   OR x ? 'httpStatus' AND (x->>'code'<>'HTTP_ERROR' OR jsonb_typeof(x->'httpStatus') IS DISTINCT FROM 'number' OR x->>'httpStatus' !~ '^[3-5][0-9]{2}$')
   THEN RAISE EXCEPTION 'Invalid diagnostic item' USING ERRCODE='22023';END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(d))<>(SELECT count(DISTINCT value->>'scope') FROM jsonb_array_elements(d)) THEN RAISE EXCEPTION 'Duplicate diagnostic scope' USING ERRCODE='22023';END IF;
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_evidence_validate_diagnostics(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.platform_sales_evidence_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE s jsonb;e jsonb;p jsonb;x jsonb;row public.platform_sales_evidence_attempts;old public.platform_sales_evidence_revisions;
 entity uuid;lease uuid;origin_kind text;page integer;valid boolean;can_check boolean:=false;total bigint;author text;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Actor required' USING ERRCODE='42501';END IF;
 IF p_action='read' THEN PERFORM public.read_platform_sales_finance(p_actor,0,'','',NULL,NULL,NULL);
 ELSE PERFORM pg_advisory_xact_lock(hashtextextended('energyos-platform-team',0));PERFORM public.platform_team_owner(p_actor);END IF;
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>65536 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023';END IF;
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action IN ('read','claim') THEN
  entity:=(p_body->>'id')::uuid;origin_kind:=p_body->>'kind';IF entity IS NULL OR origin_kind IS NULL THEN RAISE EXCEPTION 'Origin required' USING ERRCODE='22023';END IF;
  s:=public.platform_sales_evidence_source(p_actor,origin_kind,entity);
 END IF;
 IF p_action='read' THEN
  IF p_body-ARRAY['id','kind','page']<>'{}' OR NOT p_body ?& ARRAY['id','kind','page'] THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023';END IF;
  page:=(p_body->>'page')::integer;IF page IS NULL OR page NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023';END IF;
  BEGIN PERFORM public.platform_team_owner(p_actor);can_check:=true;EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_column THEN can_check:=false;END;
  RETURN jsonb_build_object('canCheck',can_check,'environment','SANDBOX','source',s,'total',(SELECT count(*) FROM public.platform_sales_evidence_attempts WHERE source_id=entity AND kind=origin_kind),
   'rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT a.id,a.source,a.actor_id,a.actor_name,public.platform_sales_finance_name(a.actor_id) current_actor_name,a.justification,a.created_at,coalesce(r.status,'PROCESSING') status,r.evidence,r.extractor_version FROM public.platform_sales_evidence_attempts a LEFT JOIN public.platform_sales_evidence_revisions r ON r.attempt_id=a.id WHERE a.source_id=entity AND a.kind=origin_kind ORDER BY a.created_at DESC,a.id DESC LIMIT 25 OFFSET page*25)x));
 END IF;
 IF p_action='claim' THEN
  IF p_body-ARRAY['id','kind','lease','justification']<>'{}' OR NOT p_body ?& ARRAY['id','kind','lease','justification'] OR p_body->>'justification' IS NULL OR length(btrim(p_body->>'justification')) NOT BETWEEN 20 AND 500 THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='22023';END IF;
  lease:=(p_body->>'lease')::uuid;IF lease IS NULL OR NOT coalesce((s->>'verified')::boolean,false) THEN RAISE EXCEPTION 'Source not verified' USING ERRCODE='P3691';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-evidence:'||origin_kind||':'||entity::text,0));
  IF EXISTS(SELECT 1 FROM public.platform_sales_evidence_attempts a WHERE a.source_id=entity AND a.kind=origin_kind AND a.created_at>clock_timestamp()-interval '90 seconds' AND NOT EXISTS(SELECT 1 FROM public.platform_sales_evidence_revisions r WHERE r.attempt_id=a.id)) THEN RAISE EXCEPTION 'Concurrent check' USING ERRCODE='P3691';END IF;
  INSERT INTO public.platform_sales_evidence_attempts(id,kind,source_id,source,actor_id,actor_name,justification) VALUES(lease,origin_kind,entity,s,p_actor,author,p_body->>'justification');RETURN jsonb_build_object('source',s);
 END IF;
 IF p_action='finish' THEN
  IF p_body-ARRAY['lease','evidence']<>'{}' OR NOT p_body ?& ARRAY['lease','evidence'] THEN RAISE EXCEPTION 'Invalid finish' USING ERRCODE='22023';END IF;
  lease:=(p_body->>'lease')::uuid;e:=p_body->'evidence';SELECT * INTO row FROM public.platform_sales_evidence_attempts WHERE id=lease;
  IF row.id IS NULL THEN RAISE EXCEPTION 'Attempt missing' USING ERRCODE='P3690';END IF;
  IF row.actor_id<>p_actor THEN RAISE EXCEPTION 'Actor mismatch' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-evidence:'||row.kind||':'||row.source_id::text,0));
  SELECT * INTO old FROM public.platform_sales_evidence_revisions WHERE attempt_id=lease;
  IF FOUND THEN IF old.evidence IS DISTINCT FROM e THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='P3691';END IF;RETURN jsonb_build_object('status',old.status,'replayed',true);END IF;
  IF (SELECT id FROM public.platform_sales_evidence_attempts a WHERE a.source_id=row.source_id AND a.kind=row.kind ORDER BY created_at DESC,id DESC LIMIT 1)<>lease THEN RAISE EXCEPTION 'Stale attempt' USING ERRCODE='P3691';END IF;
  s:=public.platform_sales_evidence_source(p_actor,row.kind,row.source_id);valid:=coalesce(s=row.source AND (s->>'verified')::boolean,false);
  IF e IS NULL OR e='null'::jsonb THEN valid:=false;
  ELSE
   IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='22023';END IF;
   IF e ? 'diagnostics' THEN PERFORM public.platform_sales_evidence_validate_diagnostics(e->'diagnostics');END IF;
   IF e-ARRAY['diagnostics']='{}'::jsonb AND e ? 'diagnostics' THEN
    IF jsonb_array_length(e->'diagnostics')=0 THEN RAISE EXCEPTION 'Empty failure diagnostics' USING ERRCODE='22023';END IF;
    valid:=false;
   ELSE
   IF jsonb_typeof(e)<>'object' OR e-ARRAY['payment','refunds','invoices','refundsComplete','invoicesComplete','diagnostics']<>'{}' OR NOT e ?& ARRAY['payment','refunds','invoices','refundsComplete','invoicesComplete'] OR jsonb_typeof(e->'refunds')<>'array' OR jsonb_typeof(e->'invoices')<>'array' OR jsonb_typeof(e->'refundsComplete')<>'boolean' OR jsonb_typeof(e->'invoicesComplete')<>'boolean' OR jsonb_array_length(e->'refunds')>100 OR jsonb_array_length(e->'invoices')>100 THEN RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='22023';END IF;
   FOR x IN SELECT value FROM jsonb_array_elements(coalesce(e->'diagnostics','[]'::jsonb)) LOOP
    IF x->>'scope'='REFUNDS' AND (e->>'refundsComplete')::boolean OR x->>'scope'='INVOICES' AND (e->>'invoicesComplete')::boolean THEN RAISE EXCEPTION 'Diagnostic contradicts completeness' USING ERRCODE='22023';END IF;
    IF x->>'scope' IN ('PAYMENT','RECHECK','COLLECTION') THEN valid:=false;END IF;
   END LOOP;
   p:=e->'payment';IF jsonb_typeof(p)<>'object' OR p-ARRAY['id','customer','reference','grossCents','netCents','status','subscription','dueDate']<>'{}' OR NOT p ?& ARRAY['id','customer','reference','grossCents','netCents','status'] THEN RAISE EXCEPTION 'Invalid payment' USING ERRCODE='22023';END IF;
   valid:=valid AND coalesce(p->>'id'=s->>'paymentId' AND p->>'customer'=s->>'customer' AND p->>'reference'=s->>'reference' AND p->'grossCents'=s->'grossCents' AND p->>'subscription' IS NOT DISTINCT FROM s->>'subscription' AND p->>'dueDate' IS NOT DISTINCT FROM s->>'dueDate' AND p->>'status' IN ('PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED','DELETED') AND (p->>'netCents' IS NULL OR (p->>'netCents')::bigint BETWEEN 0 AND (p->>'grossCents')::bigint),false);
   total:=0;FOR x IN SELECT value FROM jsonb_array_elements(e->'refunds') LOOP
    IF jsonb_typeof(x)<>'object' OR x-ARRAY['status','valueCents','date']<>'{}' OR NOT x ?& ARRAY['status','valueCents','date'] OR x->>'status' NOT IN ('DONE','PENDING','CANCELLED') OR x->>'status' IS NULL OR x->>'date' IS NULL OR (x->>'date') !~ '^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$' OR (x->>'valueCents') !~ '^\d{1,11}$' OR x->>'valueCents' IS NULL THEN RAISE EXCEPTION 'Invalid refund' USING ERRCODE='22023';END IF;
    IF x->>'status'='DONE' THEN total:=total+(x->>'valueCents')::bigint;END IF;
   END LOOP;
   IF total>(p->>'grossCents')::bigint THEN RAISE EXCEPTION 'Refund exceeds original' USING ERRCODE='22023';END IF;
   FOR x IN SELECT value FROM jsonb_array_elements(e->'invoices') LOOP
    IF jsonb_typeof(x)<>'object' OR x-ARRAY['id','payment','customer','status','valueCents','effectiveDate']<>'{}' OR NOT x ?& ARRAY['id','payment','customer','status','valueCents','effectiveDate'] OR x->>'id' IS NULL OR x->>'id' !~ '^inv_[a-zA-Z0-9]{1,100}$' OR x->>'payment' IS DISTINCT FROM s->>'paymentId' OR x->>'customer' IS DISTINCT FROM s->>'customer' OR x->>'status' IS NULL OR x->>'status' NOT IN ('SCHEDULED','AUTHORIZED','PROCESSING_CANCELLATION','CANCELED','CANCELLATION_DENIED','ERROR') OR x->>'valueCents' IS NULL OR x->>'valueCents' !~ '^\d{1,11}$' OR x->>'effectiveDate' IS NULL OR x->>'effectiveDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid invoice' USING ERRCODE='22023';END IF;
   END LOOP;
   IF (SELECT count(*) FROM jsonb_array_elements(e->'invoices'))<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(e->'invoices')) THEN RAISE EXCEPTION 'Duplicate invoice' USING ERRCODE='22023';END IF;
  END IF;
  END IF;
  INSERT INTO public.platform_sales_evidence_revisions(attempt_id,status,evidence) VALUES(lease,CASE WHEN NOT valid THEN 'REVIEW' WHEN (e->>'refundsComplete')::boolean AND (e->>'invoicesComplete')::boolean THEN 'COMPLETE' ELSE 'PARTIAL' END,e);
  RETURN jsonb_build_object('status',CASE WHEN NOT valid THEN 'REVIEW' WHEN (e->>'refundsComplete')::boolean AND (e->>'invoicesComplete')::boolean THEN 'COMPLETE' ELSE 'PARTIAL' END);
 END IF;
 RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_evidence_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_evidence_action(uuid,text,jsonb) TO service_role;
COMMIT;
