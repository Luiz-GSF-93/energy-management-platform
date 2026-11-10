-- An explicit approval for another single unit does not overlap this receipt.
-- Legacy, consolidated, ambiguous and same-unit approvals remain protected.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.eva_intake_approval_overlaps(p_report jsonb,p_unit text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(CASE WHEN p_report#>>'{scope,kind}'='UNIT' AND jsonb_typeof(p_report#>'{scope,unitIds}')='array' THEN
  CASE WHEN jsonb_array_length(p_report#>'{scope,unitIds}')=1
   AND p_report->'unitIds'=p_report#>'{scope,unitIds}'
   AND jsonb_typeof(p_report#>'{scope,unitIds,0}')='string'
   AND p_report#>>'{scope,unitIds,0}' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   THEN (p_report#>'{scope,unitIds}') ? p_unit ELSE true END
  ELSE true END,true)
$$;
REVOKE ALL ON FUNCTION public.eva_intake_approval_overlaps(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE d text;needle text;replacement text;
BEGIN
 d:=pg_get_functiondef('public.eva_intake_administration(text,text,text,boolean,text,uuid,jsonb)'::regprocedure);
 needle:=$old$WHERE v.organization_id=p_org AND v.customer_id=i.customer_id AND v.month=i.month AND (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=v.id ORDER BY sequence DESC LIMIT 1)='APPROVED'$old$;
 replacement:=replace(needle,'AND (SELECT state','AND public.eva_intake_approval_overlaps(v.report,i.unit_id) AND (SELECT state');
 IF strpos(d,replacement)>0 THEN NULL;
 ELSIF strpos(d,needle)>0 THEN EXECUTE replace(d,needle,replacement);
 ELSE RAISE EXCEPTION 'Review approved reconciliation scope baseline';END IF;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
