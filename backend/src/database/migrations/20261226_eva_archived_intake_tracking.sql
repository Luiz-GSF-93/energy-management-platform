BEGIN;
SET LOCAL lock_timeout='5s';
DO $$DECLARE d text;old text;replacement text;BEGIN
 d:=pg_get_functiondef('public.eva_intake_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 old:='''documentType'',document_type,''updatedAt'',updated_at)x';
 replacement:='''documentType'',document_type,''percent'',CASE WHEN state=''AWAITING_SOURCES'' THEN 80 ELSE 100 END,''updatedAt'',updated_at)x';
 IF position(replacement IN d)=0 THEN
  IF position(old IN d)=0 THEN RAISE EXCEPTION 'Review archived intake projection';END IF;
  d:=replace(d,old,replacement);
 END IF;
 old:='AND document_id IS NOT NULL AND state IN(''SOURCE_READY'',''PROPOSAL_READY'',''PUBLISHED'') ORDER BY updated_at DESC LIMIT 5';
 replacement:='AND document_id IS NOT NULL AND state IN(''AWAITING_SOURCES'',''SOURCE_READY'',''PROPOSAL_READY'',''PUBLISHED'') ORDER BY updated_at DESC LIMIT 5';
 IF position(replacement IN d)=0 THEN
  IF position(old IN d)=0 THEN RAISE EXCEPTION 'Review archived intake states';END IF;
  d:=replace(d,old,replacement);
 END IF;
 EXECUTE d;
END$$;
COMMIT;
