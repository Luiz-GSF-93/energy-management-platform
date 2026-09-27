-- Allow an omitted informational rate only for INCLUDED declarations.
-- Preserve existing rates, approval guards, tenant checks and audit triggers.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$
DECLARE definition text; old_clause text := 'ELSIF NEW.amount_text IS NULL OR NEW.amount_text::numeric>100'; new_clause text := 'ELSIF (NEW.amount_text IS NULL AND NEW.treatment<>''INCLUDED'') OR NEW.amount_text::numeric>100';
BEGIN
 SELECT pg_get_functiondef('public.guard_calculation_parameter()'::regprocedure) INTO definition;
 IF position(new_clause IN definition)>0 THEN RETURN; END IF;
 IF position(old_clause IN definition)=0 THEN RAISE EXCEPTION 'Unexpected parameter guard version'; END IF;
 EXECUTE replace(definition,old_clause,new_clause);
END $migration$;
COMMIT;
