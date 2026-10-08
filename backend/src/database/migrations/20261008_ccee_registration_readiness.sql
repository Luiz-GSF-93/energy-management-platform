-- Read-only preflight; no representation grant, provider call or transmission.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.read_ccee_registration_readiness(p_org text,p_actor text,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE records jsonb; r public.ccee_registration_records; a public.ccee_unit_authorizations; agenda_current boolean; customer_active boolean;
BEGIN
 -- Reuse the authoritative license/RBAC and agenda visibility checks.
 records:=public.read_ccee_registrations(p_org,p_actor,p_id,false);
 IF jsonb_array_length(records)<>1 THEN RAISE EXCEPTION 'Record not accessible' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.ccee_registration_records WHERE id=p_id AND organization_id=p_org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Record not accessible' USING ERRCODE='42501';END IF;
 SELECT EXISTS(SELECT 1 FROM public.customers c JOIN public.consumer_units u ON u.organization_id=c.organization_id AND u.customer_id=c.id
  WHERE c.organization_id=p_org AND c.id=r.customer_id AND u.id=r.consumer_unit_id AND c.deleted_at IS NULL) INTO customer_active;
 IF r.agenda_id IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM public.operation_records WHERE id=r.agenda_id AND organization_id=p_org AND kind='agenda'
    AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id AND status NOT IN ('DONE','CANCELLED')
    AND COALESCE(due_at,ends_at,starts_at)=r.deadline) INTO agenda_current;
 END IF;
 -- Latest revision wins, including a pending/revoked replacement; never fall back to an older approval.
 SELECT * INTO a FROM public.ccee_unit_authorizations WHERE organization_id=p_org AND customer_id=r.customer_id AND consumer_unit_id=r.consumer_unit_id ORDER BY revision DESC LIMIT 1;
 RETURN jsonb_build_object('organizationId',p_org,'checkedAt',now(),'record',jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'operation',r.operation,'customer_id',r.customer_id,'consumer_unit_id',r.consumer_unit_id,'deadline',r.deadline),
  'customerActive',customer_active,'agendaCurrent',agenda_current,
  'representation',CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id',a.id,'revision',a.revision,'status',a.status,'profileCode',a.profile_code,'independentReview',a.reviewed_by IS NOT NULL AND a.reviewed_by<>a.created_by AND a.reviewed_at IS NOT NULL) END);
END $$;
REVOKE ALL ON FUNCTION public.read_ccee_registration_readiness(text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_ccee_registration_readiness(text,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
