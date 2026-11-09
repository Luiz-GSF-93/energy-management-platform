BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_intake_explanations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,intake_id uuid NOT NULL UNIQUE REFERENCES public.eva_automatic_intakes(id),
 document_id text NOT NULL,source_hash text NOT NULL,closing_id uuid NOT NULL REFERENCES public.eva_assisted_closing_versions(id),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','SUCCEEDED','FAILED','UNKNOWN')),
 lease_id uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,error_code text
);
ALTER TABLE public.eva_intake_explanations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.eva_intake_explanations FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX eva_explanations_pending ON public.eva_intake_explanations(created_at,id) WHERE state='QUEUED';
CREATE FUNCTION public.eva_intake_explanation_context(p_id uuid,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.eva_intake_explanations;i public.eva_automatic_intakes;policy public.portal_service_routing;delegate record;
BEGIN
 SELECT * INTO STRICT j FROM public.eva_intake_explanations WHERE id=p_id AND lease_id=p_lease AND lease_until>clock_timestamp() AND state='RUNNING';
 SELECT * INTO STRICT i FROM public.eva_automatic_intakes WHERE id=j.intake_id AND organization_id=j.organization_id AND document_id=j.document_id AND file_hash=j.source_hash;
 PERFORM public.eva_intake_actor(i.organization_id,i.actor_id,i.role_id,i.platform,i.customer_id);
 SELECT * INTO policy FROM public.portal_service_routing WHERE organization_id=i.organization_id AND kind='ROUTING' AND owner_user_id='organization' ORDER BY revision DESC LIMIT 1;
 IF policy.body->>'enabled' IS DISTINCT FROM 'true' OR policy.body->>'automationEnabled' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Delegation revoked' USING ERRCODE='42501';END IF;
 SELECT m.user_id::text AS id,r.id::text AS role_id,r.name,r.permissions INTO delegate FROM public.organization_members m JOIN public.roles r ON r.organization_id=m.organization_id AND r.id=m.role_id AND r.scope='organization'
 WHERE m.organization_id=i.organization_id AND m.user_id::text=policy.body->>'automationActor' AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND m.exclusive_customer_id IS NULL AND r.name IN('admin_org','gestor');
 IF NOT FOUND OR NOT coalesce(delegate.permissions @> '["8f105b02-4443-49de-b188-847e0284e7ed","92e1b670-ab10-483a-b825-c6e16799496d","60f9690a-145b-4dba-b23f-9f945baca296","beb6ec90-8ba8-40ce-a156-aeef6cc75cce"]'::jsonb,false) THEN RAISE EXCEPTION 'Delegated actor revoked' USING ERRCODE='42501';END IF;
 IF i.closing_id IS DISTINCT FROM j.closing_id OR i.state NOT IN('AWAITING_SOURCES','PROPOSAL_READY') OR NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v WHERE v.organization_id=i.organization_id AND v.id=j.closing_id AND v.customer_id=i.customer_id AND v.month=i.month AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.report->'units')u WHERE u->>'id'=i.unit_id AND u->>'documentId'=i.document_id AND u->>'sourceHash'=i.file_hash)) THEN RAISE EXCEPTION 'Prepared source changed' USING ERRCODE='40001';END IF;
 RETURN jsonb_build_object('organizationId',i.organization_id,'documentId',i.document_id,'sourceHash',i.file_hash,'delegate',jsonb_build_object('userId',delegate.id,'roleId',delegate.role_id,'role',delegate.name,'permissions',delegate.permissions));
END$$;
CREATE FUNCTION public.eva_intake_explanation_task(p_action text,p_id uuid DEFAULT NULL,p_lease uuid DEFAULT NULL,p_orgs text[] DEFAULT NULL,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.eva_intake_explanations;ctx jsonb;
BEGIN
 IF p_action='claim' THEN
  IF coalesce(cardinality(p_orgs),0) NOT BETWEEN 1 AND 100 THEN RETURN NULL;END IF;
  -- Intent was persisted before inference. An interrupted POST is never retried.
  UPDATE public.eva_intake_explanations SET state='UNKNOWN',finished_at=clock_timestamp(),error_code='INTERRUPTED_EXPLANATION' WHERE organization_id=ANY(p_orgs) AND state='RUNNING' AND lease_until<clock_timestamp();
  SELECT * INTO j FROM public.eva_intake_explanations WHERE organization_id=ANY(p_orgs) AND state='QUEUED' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL;END IF;
  UPDATE public.eva_intake_explanations SET state='RUNNING',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '3 minutes',started_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
  BEGIN ctx:=public.eva_intake_explanation_context(j.id,j.lease_id);
  EXCEPTION WHEN SQLSTATE '42501' OR SQLSTATE '40001' THEN UPDATE public.eva_intake_explanations SET state='FAILED',finished_at=clock_timestamp(),error_code='SOURCE_OR_ACCESS_CHANGED' WHERE id=j.id;RETURN NULL;END;
  UPDATE public.eva_automatic_intakes SET ai_attempted=true WHERE id=j.intake_id;
  RETURN jsonb_build_object('id',j.id,'leaseId',j.lease_id,'context',ctx);
 END IF;
 ctx:=public.eva_intake_explanation_context(p_id,p_lease);
 IF p_action='assert' THEN RETURN ctx;END IF;
 IF p_action<>'finish' OR p_error IS NOT NULL AND p_error!~'^[A-Z0-9_]{3,80}$' THEN RAISE EXCEPTION 'Invalid explanation result' USING ERRCODE='22023';END IF;
 UPDATE public.eva_intake_explanations SET state=CASE WHEN p_error IS NULL THEN 'SUCCEEDED' ELSE 'FAILED' END,error_code=p_error,finished_at=clock_timestamp() WHERE id=p_id AND state='RUNNING';
 RETURN jsonb_build_object('stored',true);
END$$;

-- Queue the optional explanation in the same transaction that makes the
-- deterministic proposal available. Neither a model nor its queue gates it.
CREATE FUNCTION public.eva_intake_explanation_enqueue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.event='prepared' AND NEW.state IN('AWAITING_SOURCES','PROPOSAL_READY') THEN
  INSERT INTO public.eva_intake_explanations(organization_id,intake_id,document_id,source_hash,closing_id)
  SELECT i.organization_id,i.id,i.document_id,i.file_hash,i.closing_id FROM public.eva_automatic_intakes i WHERE i.id=NEW.intake_id AND i.document_type='INVOICE_DISTRIBUTOR' AND NOT i.ai_attempted
  AND NOT EXISTS(SELECT 1 FROM public.eva_intake_identity_reviews r WHERE r.intake_id=i.id AND r.organization_id=i.organization_id AND r.source_hash=i.file_hash AND r.kind IN('CONTINUE','ADDRESS'))
  ON CONFLICT(intake_id) DO NOTHING;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER eva_intake_optional_explanation AFTER INSERT ON public.eva_automatic_intake_events FOR EACH ROW EXECUTE FUNCTION public.eva_intake_explanation_enqueue();
REVOKE ALL ON FUNCTION public.eva_intake_explanation_context(uuid,uuid),public.eva_intake_explanation_task(text,uuid,uuid,text[],text),public.eva_intake_explanation_enqueue() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.eva_intake_explanation_context(uuid,uuid),public.eva_intake_explanation_task(text,uuid,uuid,text[],text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
