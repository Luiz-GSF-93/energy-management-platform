-- Preserve the organization requester identity when platform triage creates a case.
-- Only new events of the Central Support origin are normalized; history is immutable.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION public.central_support_event_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.central_support_requests;
BEGIN
 SELECT * INTO r FROM public.central_support_requests WHERE id=NEW.case_id AND state='SUBMITTED';
 IF r.id IS NOT NULL THEN
 NEW.details:=NEW.details||jsonb_build_object('requesterNameAtTime',public.platform_workflow_name(r.requester_id),
 'organizationRequesterId',r.requester_id,'authorizationReference',r.id);
 END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER central_support_event_identity BEFORE INSERT ON public.platform_support_case_events
FOR EACH ROW EXECUTE FUNCTION public.central_support_event_identity();
REVOKE ALL ON FUNCTION public.central_support_event_identity() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
