BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- NULL is an explicitly indefinite management term, not a fabricated end date.
-- Preserve insert-only history, organization scope and overlap serialization.
DO $migration$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.guard_contract_configuration()'::regprocedure);
 IF strpos(d,'NEW.start_date IS NULL OR (NEW.end_date IS NOT NULL')=0 THEN
  IF strpos(d,$before$NEW.status<>'ACTIVE' OR NEW.end_date IS NULL OR NEW.end_date<NEW.start_date$before$)=0 THEN RAISE EXCEPTION 'Review management guard baseline';END IF;
  d:=replace(d,$before$NEW.status<>'ACTIVE' OR NEW.end_date IS NULL OR NEW.end_date<NEW.start_date$before$,$after$NEW.status<>'ACTIVE' OR NEW.start_date IS NULL OR (NEW.end_date IS NOT NULL AND NEW.end_date<NEW.start_date)$after$);
  d:=replace(d,'m.start_date::date<=NEW.end_date::date','m.start_date::date<=coalesce(NEW.end_date::date,''infinity''::date)');
  EXECUTE d;
 END IF;
 d:=pg_get_functiondef('public.guard_management_allocation()'::regprocedure);
 IF strpos(d,'c.end_date IS NULL OR c.end_date::date<last_day')>0 THEN
  EXECUTE replace(d,'c.end_date IS NULL OR c.end_date::date<last_day','(c.end_date IS NOT NULL AND c.end_date::date<last_day)');
 ELSIF strpos(d,'c.end_date IS NOT NULL AND c.end_date::date<last_day')=0 THEN RAISE EXCEPTION 'Review management allocation baseline';END IF;
END$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
