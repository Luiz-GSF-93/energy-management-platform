BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Receipt notices are history, not financial evidence. Preserve every notice;
-- only same-tenant/customer DOCUMENT notices without a case may coexist.
DO $$DECLARE definition text;old text;replacement text;BEGIN
 definition:=pg_get_functiondef('public.correct_document_type(text,text,text,integer,text,text,boolean)'::regprocedure);
 old:='''portal_document_intakes'',''eva_automatic_intakes'') LOOP';
 replacement:='''portal_document_intakes'',''eva_automatic_intakes'',''portal_notification_outbox'') LOOP';
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'Review recovery dependency guard';END IF;
 definition:=replace(definition,old,replacement);
 old:=' OR EXISTS(SELECT 1 FROM public.operation_client_messages WHERE p_document=ANY(document_ids))';
 replacement:=old||E'\n OR EXISTS(SELECT 1 FROM public.portal_notification_outbox WHERE document_id=p_document AND (organization_id IS DISTINCT FROM p_org OR customer_id IS DISTINCT FROM d.customer_id OR kind IS DISTINCT FROM ''DOCUMENT'' OR record_id IS NOT NULL))';
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'Review source notice guard';END IF;
 definition:=replace(definition,old,replacement);
 EXECUTE definition;
END$$;
COMMIT;
