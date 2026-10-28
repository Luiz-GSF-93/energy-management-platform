BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- An operator opening/defering the invoice is not a financial derivation.
-- Keep those immutable events and still stop on a scheduled agenda or wrong scope/hash.
DO $$DECLARE definition text;old text;replacement text;BEGIN
 definition:=pg_get_functiondef('public.correct_document_type(text,text,text,integer,text,text,boolean)'::regprocedure);
 old:='''eva_automatic_intakes'',''portal_notification_outbox'') LOOP';
 replacement:='''eva_automatic_intakes'',''portal_notification_outbox'',''eva_invoice_attention_events'') LOOP';
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'Review attention dependency guard';END IF;
 definition:=replace(definition,old,replacement);
 old:=' OR EXISTS(SELECT 1 FROM public.operation_client_messages WHERE p_document=ANY(document_ids))';
 replacement:=old||E'\n OR EXISTS(SELECT 1 FROM public.eva_invoice_attention_events WHERE document_id=p_document AND (organization_id IS DISTINCT FROM p_org OR source_hash IS DISTINCT FROM d.file_hash OR agenda_id IS NOT NULL OR state IS DISTINCT FROM ''OPENED'' AND state IS DISTINCT FROM ''DEFERRED'' AND state IS DISTINCT FROM ''PAUSED''))';
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'Review attention source guard';END IF;
 definition:=replace(definition,old,replacement);
 EXECUTE definition;
END$$;
COMMIT;
