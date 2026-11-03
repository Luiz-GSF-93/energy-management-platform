BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
ALTER TABLE public.eva_invoice_attention_events DROP CONSTRAINT eva_invoice_attention_events_state_check;
ALTER TABLE public.eva_invoice_attention_events ADD CONSTRAINT eva_invoice_attention_events_state_check CHECK(state IN('OPENED','DEFERRED','SCHEDULED','PAUSED','DISMISSED','RESTORED'));
DO $migration$ DECLARE source text;marker text;replacement text;BEGIN
 source:=pg_get_functiondef('public.eva_invoice_attention(text,text,text,boolean,text,text,jsonb)'::regprocedure);
 marker:=$before0$p_action NOT IN('list','record')$before0$;
 replacement:=$after0$p_action NOT IN('list','record','list-dismissed','inspect')$after0$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Invoice notice source changed at step 0; review before migrating';END IF;
 source:=replace(source,marker,replacement);
 marker:=$before1$IF p_action='list' AND (p_document IS NOT NULL OR p_body<>'{}') THEN RAISE EXCEPTION 'Invalid inbox request' USING ERRCODE='22023';END IF;$before1$;
 replacement:=$after1$IF p_action='list' AND (p_document IS NOT NULL OR p_body<>'{}') OR p_action='inspect' AND (p_document IS NULL OR p_body<>'{}') THEN RAISE EXCEPTION 'Invalid inbox request' USING ERRCODE='22023';END IF;
 IF p_action='list-dismissed' AND (p_document IS NOT NULL OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body) k) IS DISTINCT FROM ARRAY['page'] OR jsonb_typeof(p_body->'page') IS DISTINCT FROM 'number' OR (p_body->>'page') !~ '^(0|[1-9][0-9]{0,4})$' OR (p_body->>'page')::integer>10000) THEN RAISE EXCEPTION 'Invalid dismissed page' USING ERRCODE='22023';END IF;$after1$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Invoice notice source changed at step 1; review before migrating';END IF;
 source:=replace(source,marker,replacement);
 marker:=$before2$AND (p_action='record' AND doc.id=p_document OR p_action='list' AND (i.created_at>=now()-interval '30 days' OR EXISTS(SELECT 1 FROM public.eva_invoice_attention_events a WHERE a.organization_id=p_org AND a.actor_id=p_actor AND a.document_id=doc.id AND a.state IN('SCHEDULED','PAUSED','DEFERRED','OPENED'))))$before2$;
 replacement:=$after2$AND (p_action IN('record','inspect') AND doc.id=p_document
    OR p_action='list' AND (SELECT state FROM public.eva_invoice_attention_events a WHERE a.organization_id=p_org AND a.actor_id=p_actor AND a.document_id=doc.id AND a.source_hash=doc.file_hash ORDER BY a.created_at DESC,a.id DESC LIMIT 1) IS DISTINCT FROM 'DISMISSED'
     AND (i.created_at>=now()-interval '30 days' OR EXISTS(SELECT 1 FROM public.eva_invoice_attention_events a WHERE a.organization_id=p_org AND a.actor_id=p_actor AND a.document_id=doc.id AND a.source_hash=doc.file_hash AND a.state IN('SCHEDULED','PAUSED','DEFERRED','OPENED','RESTORED')))
    OR p_action='list-dismissed' AND (SELECT state FROM public.eva_invoice_attention_events a WHERE a.organization_id=p_org AND a.actor_id=p_actor AND a.document_id=doc.id AND a.source_hash=doc.file_hash ORDER BY a.created_at DESC,a.id DESC LIMIT 1)='DISMISSED')$after2$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Invoice notice source changed at step 2; review before migrating';END IF;
 source:=replace(source,marker,replacement);
 marker:=$before3$ORDER BY doc.id,doc.created_at DESC,i.created_at DESC,i.id DESC LIMIT 202$before3$;
 replacement:=$after3$ORDER BY doc.id,doc.created_at DESC,i.created_at DESC,i.id DESC LIMIT CASE WHEN p_action='list-dismissed' THEN 26 ELSE 202 END OFFSET CASE WHEN p_action='list-dismissed' THEN (p_body->>'page')::integer*25 ELSE 0 END$after3$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Invoice notice source changed at step 3; review before migrating';END IF;
 source:=replace(source,marker,replacement);
 marker:=$before4$counted:=counted+1;IF counted>200$before4$;
 replacement:=$after4$counted:=counted+1;IF p_action='list-dismissed' AND counted>25 THEN EXIT;END IF;IF counted>200$after4$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Invoice notice source changed at step 4; review before migrating';END IF;
 source:=replace(source,marker,replacement);
 marker:=$before5$IF p_action='record' THEN
   IF (SELECT array_agg$before5$;
 replacement:=$after5$IF p_action='inspect' THEN RETURN item;END IF;
  IF p_action='record' THEN
   IF (SELECT array_agg$after5$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Invoice notice source changed at step 5; review before migrating';END IF;
 source:=replace(source,marker,replacement);
 marker:=$before6$p_body->>'state' NOT IN('OPENED','DEFERRED','SCHEDULED','PAUSED')$before6$;
 replacement:=$after6$p_body->>'state' NOT IN('OPENED','DEFERRED','SCHEDULED','PAUSED','DISMISSED','RESTORED')$after6$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Invoice notice source changed at step 6; review before migrating';END IF;
 source:=replace(source,marker,replacement);
 marker:=$before7$ELSE
    INSERT INTO public.eva_invoice_attention_events$before7$;
 replacement:=$after7$ELSE
    IF p_body->>'state'='RESTORED' AND item->>'state' IS DISTINCT FROM 'DISMISSED' THEN RAISE EXCEPTION 'Notice is not dismissed' USING ERRCODE='40001';END IF;
    INSERT INTO public.eva_invoice_attention_events$after7$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Invoice notice source changed at step 7; review before migrating';END IF;
 source:=replace(source,marker,replacement);
 marker:=$before8$IF p_action='record' THEN RAISE EXCEPTION 'Invoice unavailable'$before8$;
 replacement:=$after8$IF p_action IN('record','inspect') THEN RAISE EXCEPTION 'Invoice unavailable'$after8$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Invoice notice source changed at step 8; review before migrating';END IF;
 source:=replace(source,marker,replacement);
 marker:=$before9$RETURN jsonb_build_object('rows',result,'checkedAt',clock_timestamp());$before9$;
 replacement:=$after9$RETURN jsonb_build_object('rows',result,'checkedAt',clock_timestamp())||CASE WHEN p_action='list-dismissed' THEN jsonb_build_object('page',(p_body->>'page')::integer,'hasMore',counted>25) ELSE '{}'::jsonb END;$after9$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'Invoice notice source changed at step 9; review before migrating';END IF;
 source:=replace(source,marker,replacement);
 EXECUTE source;
END $migration$;
REVOKE ALL ON FUNCTION public.eva_invoice_attention(text,text,text,boolean,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_invoice_attention(text,text,text,boolean,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
