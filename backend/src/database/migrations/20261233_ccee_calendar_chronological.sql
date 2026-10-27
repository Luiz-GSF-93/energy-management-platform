BEGIN;
DO $$DECLARE owner_def text;data_def text;BEGIN
 SELECT pg_get_functiondef('public.ccee_calendar_action(uuid,text,uuid,jsonb)'::regprocedure) INTO owner_def;
 IF position('ORDER BY t.source_row' in owner_def)=0 OR position('ORDER BY source_row,id LIMIT 25' in owner_def)=0 THEN RAISE EXCEPTION 'Calendar ordering source changed';END IF;
 owner_def:=replace(owner_def,'ORDER BY t.source_row',concat('ORDER BY coalesce(t.due_date,(t.due_at AT TIME ZONE ',quote_literal('America/Sao_Paulo'),')::date),t.due_at,t.source_sheet,t.source_row,t.id'));
 owner_def:=replace(owner_def,'ORDER BY source_row,id LIMIT 25',concat('ORDER BY coalesce(due_date,(due_at AT TIME ZONE ',quote_literal('America/Sao_Paulo'),')::date),due_at,source_sheet,source_row,id LIMIT 25'));
 EXECUTE owner_def;
 SELECT pg_get_functiondef('public.ccee_data_action(text,text,text,uuid,jsonb)'::regprocedure) INTO data_def;
 IF position('ORDER BY x.due_at' in data_def)=0 OR position('ORDER BY due_at,id LIMIT 25' in data_def)=0 THEN RAISE EXCEPTION 'Published calendar ordering source changed';END IF;
 data_def:=replace(data_def,'ORDER BY x.due_at',concat('ORDER BY coalesce(x.due_date,(x.due_at AT TIME ZONE ',quote_literal('America/Sao_Paulo'),')::date),x.due_at,x.source_sheet,x.source_row,x.id'));
 data_def:=replace(data_def,'ORDER BY due_at,id LIMIT 25',concat('ORDER BY coalesce(due_date,(due_at AT TIME ZONE ',quote_literal('America/Sao_Paulo'),')::date),due_at,source_sheet,source_row,id LIMIT 25'));
 EXECUTE data_def;
END$$;
COMMIT;
