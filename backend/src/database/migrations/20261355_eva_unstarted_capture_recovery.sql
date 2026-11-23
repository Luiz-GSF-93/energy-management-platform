BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF to_regprocedure('public.eva_intake_unstarted_closing(uuid)') IS NULL OR to_regprocedure('public.eva_intake_approval_overlaps(jsonb,text)') IS NULL THEN RAISE EXCEPTION 'Review intake recovery baseline';END IF;
END$$;
-- Recover only the non-billable closing stage, never provider submission.
-- No preparation run or overlapping closing may exist for this unit/month.
-- The caller still locks the intake, checks the delegate, original/hash, OCR
-- success, live identity, lease and financial effects, and writes the audit event.
CREATE OR REPLACE FUNCTION public.eva_intake_unstarted_closing(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.eva_automatic_intakes i WHERE i.id=p_id AND i.state='UNKNOWN'
  AND NOT EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=i.organization_id AND r.consumer_unit_id=i.unit_id AND r.month=i.month)
  AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.organization_id=i.organization_id AND v.customer_id=i.customer_id AND v.month=i.month AND public.eva_intake_approval_overlaps(v.report,i.unit_id))
  AND (SELECT e.body#>>'{diagnostic,stage}'='CLOSING_PREPARATION'
    AND e.body#>>'{diagnostic,cause}' IN('HTTP_409','HTTP_503','EVA_CLOSING_CAPTURE_LIMIT')
    FROM public.eva_automatic_intake_events e WHERE e.organization_id=i.organization_id AND e.intake_id=i.id AND e.event='unknown' ORDER BY e.sequence DESC LIMIT 1));
$$;
-- CREATE OR REPLACE retains the existing owner and EXECUTE ACL.
DO $$BEGIN
 IF to_regclass('portal_scope.routines') IS NOT NULL THEN
  UPDATE portal_scope.routines SET source_hash=portal_scope.function_signature(original_oid)
  WHERE original_oid='public.eva_intake_unstarted_closing(uuid)'::regprocedure;
 END IF;
END$$;
NOTIFY pgrst,'reload schema';
COMMIT;
