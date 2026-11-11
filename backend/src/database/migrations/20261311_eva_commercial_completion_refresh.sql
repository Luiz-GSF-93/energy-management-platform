BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE INDEX IF NOT EXISTS calculation_preparation_customer_month_idx ON public.calculation_preparation_runs(organization_id,customer_id,month,id);
-- A commercial reservation is a source of readiness, never a financial value.
-- Include its effective state so a completed reservation cannot leave an old
-- blocking warning in a sleeping proposal.
CREATE OR REPLACE FUNCTION public.eva_intake_commercial_digest(p_org text,p_customer text,p_month text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT md5(coalesce(string_agg(jsonb_build_array(r.id,r.consumer_unit_id,r.document_id,r.source_hash,r.source_basis,public.calculation_preparation_effective_state(r.organization_id,r.id))::text,'' ORDER BY r.id),''))
 FROM public.calculation_preparation_runs r WHERE r.organization_id=p_org AND r.customer_id=p_customer AND r.month=p_month;
$$;
REVOKE ALL ON FUNCTION public.eva_intake_commercial_digest(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.eva_intake_source_state(p_id uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;fingerprint text;
BEGIN
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() FOR UPDATE;
 fingerprint:=public.eva_intake_source_fingerprint(p_id,p_token);
 fingerprint:=encode(sha256(convert_to(jsonb_build_array('intake-commercial-state-1',fingerprint,public.eva_intake_commercial_digest(i.organization_id,i.customer_id,i.month))::text,'UTF8')),'hex');
 RETURN jsonb_build_object('revision',i.source_revision,'fingerprint',fingerprint);
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_source_state(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_source_state(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.wake_eva_intake_commercial_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.calculation_preparation_runs;
BEGIN
 IF TG_TABLE_NAME='calculation_preparation_run_events' THEN
  IF NEW.state NOT IN('PREPARED','PARTIAL','UNKNOWN') THEN RETURN NULL;END IF;
 END IF;
 SELECT * INTO r FROM public.calculation_preparation_runs WHERE id=NEW.run_id AND organization_id=NEW.organization_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE public.eva_automatic_intakes i SET source_revision=i.source_revision+1,
  next_attempt_at=CASE WHEN i.lease_token IS NULL THEN clock_timestamp() ELSE i.next_attempt_at END
 WHERE i.organization_id=r.organization_id AND i.customer_id=r.customer_id AND i.month=r.month
 AND i.state IN('AWAITING_SOURCES','PROPOSAL_READY','PREPARING')
 AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_events e WHERE e.closing_id=i.closing_id AND e.state='APPROVED');
 RETURN NULL;
END$$;
REVOKE ALL ON FUNCTION public.wake_eva_intake_commercial_completion() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS wake_eva_commercial_completion ON public.calculation_preparation_run_events;
CREATE TRIGGER wake_eva_commercial_completion AFTER INSERT ON public.calculation_preparation_run_events FOR EACH ROW EXECUTE FUNCTION public.wake_eva_intake_commercial_completion();
DROP TRIGGER IF EXISTS wake_eva_commercial_completion ON public.calculation_preparation_reconciliations;
CREATE TRIGGER wake_eva_commercial_completion AFTER INSERT ON public.calculation_preparation_reconciliations FOR EACH ROW EXECUTE FUNCTION public.wake_eva_intake_commercial_completion();

-- Refresh only an obsolete warning whose actual reservations are all finished.
-- Do not clear an UNKNOWN result, change a receipt or revisit approved history.
DO $refresh$
DECLARE i public.eva_automatic_intakes;
BEGIN
 FOR i IN SELECT x.* FROM public.eva_automatic_intakes x JOIN public.eva_assisted_closing_versions v ON v.organization_id=x.organization_id AND v.id=x.closing_id
 WHERE x.state IN('AWAITING_SOURCES','PROPOSAL_READY')
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units')u CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(u->'missing','[]')) m WHERE strpos(m,'reserva de preparação comercial')>0)
 AND NOT EXISTS(SELECT 1 FROM public.calculation_preparation_runs r WHERE r.organization_id=x.organization_id AND r.customer_id=x.customer_id AND r.month=x.month AND coalesce(public.calculation_preparation_effective_state(r.organization_id,r.id),'RUNNING') IN('RUNNING','UNKNOWN'))
 AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_events e WHERE e.closing_id=x.closing_id AND e.state='APPROVED')
 AND NOT EXISTS(SELECT 1 FROM public.eva_automatic_intake_events e WHERE e.intake_id=x.id AND e.event='COMMERCIAL_STATE_REFRESH_REQUESTED' AND e.body->>'closingId'=x.closing_id::text)
 LOOP
  UPDATE public.eva_automatic_intakes SET source_revision=source_revision+1,next_attempt_at=CASE WHEN lease_token IS NULL THEN clock_timestamp() ELSE next_attempt_at END WHERE id=i.id;
  PERFORM public.eva_intake_event(i.id,'COMMERCIAL_STATE_REFRESH_REQUESTED',jsonb_build_object('closingId',i.closing_id,'reason','Commercial reservations finished; refresh obsolete readiness warning.','financialApproval',false,'repeatOcr',false),'system:migration:20261311');
 END LOOP;
END$refresh$;
NOTIFY pgrst,'reload schema';
COMMIT;
