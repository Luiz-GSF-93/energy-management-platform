BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE TABLE public.eva_closing_change_proposals(
 id uuid PRIMARY KEY, organization_id text NOT NULL REFERENCES public.organizations(id),customer_id text NOT NULL REFERENCES public.customers(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),month text NOT NULL,
 source_id uuid NOT NULL REFERENCES public.eva_assisted_closing_versions(id),source_hash text NOT NULL,proposal_hash text NOT NULL,
 question text NOT NULL CHECK(length(question) BETWEEN 1 AND 2000),report jsonb NOT NULL,diff jsonb NOT NULL,sources jsonb NOT NULL,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '20 minutes',
 UNIQUE(organization_id,id),CHECK(octet_length(report::text)<=2000000 AND octet_length(sources::text)<=16000000 AND octet_length(diff::text)<=100000));
CREATE TABLE public.eva_closing_change_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,proposal_id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence>0),
 state text NOT NULL CHECK(state IN('PROPOSED','CANCELLED','APPLIED')),actor_id text NOT NULL,closing_id uuid REFERENCES public.eva_assisted_closing_versions(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,proposal_id) REFERENCES public.eva_closing_change_proposals(organization_id,id),UNIQUE(proposal_id,sequence));
CREATE TABLE public.eva_closing_document_credits(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,proposal_id uuid NOT NULL UNIQUE,closing_id uuid NOT NULL UNIQUE REFERENCES public.eva_assisted_closing_versions(id),license_id text NOT NULL,
 units integer NOT NULL CHECK(units=1),actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(organization_id,proposal_id) REFERENCES public.eva_closing_change_proposals(organization_id,id));
CREATE INDEX eva_closing_change_scope ON public.eva_closing_change_proposals(organization_id,consumer_unit_id,month,created_at DESC);
CREATE INDEX eva_closing_credit_scope ON public.eva_closing_document_credits(organization_id,created_at DESC);
DO $$DECLARE n text;BEGIN FOREACH n IN ARRAY ARRAY['eva_closing_change_proposals','eva_closing_change_events','eva_closing_document_credits'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',n);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',n);
 EXECUTE format('CREATE TRIGGER closing_change_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.preserve_calculation_autofill()',n);
END LOOP;END$$;
CREATE OR REPLACE FUNCTION public.organization_resource_usage(org text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('users',(SELECT count(*) FROM public.organization_members WHERE organization_id=org AND status='active'),
 'units',(SELECT count(*) FROM public.consumer_units u WHERE organization_id=org AND to_jsonb(u)->>'deleted_at' IS NULL),
 'documents',(SELECT count(*) FROM public.documents WHERE organization_id=org)+(SELECT coalesce(sum(quota_units),0) FROM public.eva_tariff_model_evaluations WHERE organization_id=org)+(SELECT coalesce(sum(units),0) FROM public.eva_closing_document_credits WHERE organization_id=org));
$$;
CREATE FUNCTION public.eva_closing_change_action(p_org text,p_actor text,p_role text,p_platform boolean,p_action text,p_unit text,p_month text,p_id uuid,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rights jsonb;src public.eva_assisted_closing_versions;prop public.eva_closing_change_proposals;ev public.eva_closing_change_events;lic record;used bigint;captured jsonb;result jsonb;finished jsonb;row_json jsonb;latest_id uuid;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('propose','status','cancel','confirm','history') OR p_id IS NULL OR p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>2200000 THEN RAISE EXCEPTION 'Invalid correction' USING ERRCODE='22023';END IF;
 rights:=public.eva_assisted_closing_action(p_org,p_actor,p_role,p_platform,'history',p_unit,p_month,NULL,'{"page":0}');
 IF rights->'canPrepare' IS DISTINCT FROM 'true'::jsonb OR NOT p_platform AND NOT EXISTS(SELECT 1 FROM public.roles WHERE id::text=p_role AND organization_id=p_org AND permissions ? '62443ab1-9187-42e4-a932-a7cf54f76250') THEN RAISE EXCEPTION 'Correction denied' USING ERRCODE='42501';END IF;
 -- Same ordering as invoice uploads/model re-evaluations; one shared allowance.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
 SELECT * INTO lic FROM public.licenses WHERE organization_id=p_org AND active=true AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'License denied' USING ERRCODE='42501';END IF;
 IF p_action='history' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['hash'] OR NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_versions v JOIN public.consumer_units u ON u.id=p_unit AND u.organization_id=v.organization_id AND u.customer_id=v.customer_id WHERE v.id=p_id AND v.organization_id=p_org AND v.month=p_month AND v.payload_hash=p_body->>'hash') THEN RAISE EXCEPTION 'History denied' USING ERRCODE='42501';END IF;
  used:=(public.organization_resource_usage(p_org)->>'documents')::bigint;
  RETURN jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'expiresAt' DESC),'[]') FROM(SELECT jsonb_build_object('id',p.id,'hash',p.proposal_hash,'sourceId',p.source_id,'sourceHash',p.source_hash,'expiresAt',p.expires_at,'state',(SELECT CASE WHEN e.state='PROPOSED' AND p.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE e.state END FROM public.eva_closing_change_events e WHERE e.proposal_id=p.id ORDER BY sequence DESC LIMIT 1),'financial',p.report->'financial','diff',p.diff,'used',used,'limit',lic.documents_limit,'unlimited',coalesce(lic.documents_unlimited,false))x FROM public.eva_closing_change_proposals p WHERE p.organization_id=p_org AND p.consumer_unit_id=p_unit AND p.month=p_month AND p.source_id=p_id AND p.created_by=p_actor ORDER BY p.created_at DESC LIMIT 10)s));
 END IF;
 IF p_action='propose' THEN
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM ARRAY['diff','question','report','reportHash','sourceHash','sourceId'] OR p_body->>'reportHash' IS NULL OR p_body->>'reportHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_body->'diff') IS DISTINCT FROM 'array' OR jsonb_array_length(p_body->'diff') NOT BETWEEN 1 AND 12 OR length(p_body->>'question') NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Invalid candidate' USING ERRCODE='22023';END IF;
  SELECT * INTO src FROM public.eva_assisted_closing_versions v WHERE id=(p_body->>'sourceId')::uuid AND organization_id=p_org AND month=p_month AND payload_hash=p_body->>'sourceHash' AND EXISTS(SELECT 1 FROM public.consumer_units u WHERE u.id=p_unit AND u.organization_id=v.organization_id AND u.customer_id=v.customer_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Source denied' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-closing:'||p_org||':'||src.customer_id||':'||p_month,0));
  IF src.id IS DISTINCT FROM (SELECT id FROM public.eva_assisted_closing_versions WHERE organization_id=p_org AND customer_id=src.customer_id AND month=p_month ORDER BY version DESC LIMIT 1) OR (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=src.id ORDER BY sequence DESC LIMIT 1) NOT IN('READY_FOR_REVIEW','APPROVED','REJECTED') THEN RAISE EXCEPTION 'Stale source' USING ERRCODE='40001';END IF;
  captured:=public.capture_eva_assisted_closing_sources(p_org,src.customer_id,p_month);
  IF src.source_snapshot IS DISTINCT FROM captured THEN RAISE EXCEPTION 'Sources changed' USING ERRCODE='40001';END IF;
  IF p_body#>>'{report,methodology}' IS DISTINCT FROM 'EVA_CONFIRMED_CHANGES_V1' OR p_body#>'{report,automaticApproval}' IS DISTINCT FROM 'false'::jsonb OR p_body#>'{report,publicationAllowed}' IS DISTINCT FROM 'false'::jsonb OR p_body#>>'{report,organizationId}' IS DISTINCT FROM p_org OR p_body#>>'{report,customerId}' IS DISTINCT FROM src.customer_id OR p_body#>>'{report,month}' IS DISTINCT FROM p_month OR p_body#>'{report,unitIds}' IS DISTINCT FROM src.report->'unitIds' THEN RAISE EXCEPTION 'Invalid report' USING ERRCODE='22023';END IF;
  IF (SELECT count(*) FROM public.eva_closing_change_proposals WHERE organization_id=p_org AND created_by=p_actor AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN RAISE EXCEPTION 'Proposal rate limit' USING ERRCODE='22023';END IF;
  INSERT INTO public.eva_closing_change_proposals(id,organization_id,customer_id,consumer_unit_id,month,source_id,source_hash,proposal_hash,question,report,diff,sources,created_by) VALUES(p_id,p_org,src.customer_id,p_unit,p_month,src.id,src.payload_hash,p_body->>'reportHash',p_body->>'question',p_body->'report',p_body->'diff',captured,p_actor) RETURNING * INTO prop;
  INSERT INTO public.eva_closing_change_events(organization_id,proposal_id,sequence,state,actor_id) VALUES(p_org,p_id,1,'PROPOSED',p_actor);
 ELSE
  IF p_body->>'hash' IS NULL OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_body)k) IS DISTINCT FROM (CASE WHEN p_action='confirm' THEN ARRAY['acknowledge','hash'] ELSE ARRAY['hash'] END) OR p_action='confirm' AND p_body->'acknowledge' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Confirmation required' USING ERRCODE='22023';END IF;
  SELECT * INTO prop FROM public.eva_closing_change_proposals WHERE id=p_id AND organization_id=p_org AND consumer_unit_id=p_unit AND month=p_month AND created_by=p_actor AND proposal_hash=p_body->>'hash' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal denied' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('eva-closing:'||p_org||':'||prop.customer_id||':'||p_month,0));
  SELECT * INTO ev FROM public.eva_closing_change_events WHERE proposal_id=prop.id ORDER BY sequence DESC LIMIT 1;
  IF p_action='cancel' AND ev.state='PROPOSED' THEN INSERT INTO public.eva_closing_change_events(organization_id,proposal_id,sequence,state,actor_id) VALUES(p_org,p_id,ev.sequence+1,'CANCELLED',p_actor);ev.state:='CANCELLED';END IF;
  IF p_action='confirm' AND ev.state<>'APPLIED' THEN
   IF ev.state<>'PROPOSED' OR prop.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Expired or cancelled' USING ERRCODE='22023';END IF;
   SELECT id INTO latest_id FROM public.eva_assisted_closing_versions WHERE organization_id=p_org AND customer_id=prop.customer_id AND month=p_month ORDER BY version DESC LIMIT 1;
   IF latest_id IS DISTINCT FROM prop.source_id OR prop.sources IS DISTINCT FROM public.capture_eva_assisted_closing_sources(p_org,prop.customer_id,p_month) OR (SELECT state FROM public.eva_assisted_closing_events WHERE closing_id=latest_id ORDER BY sequence DESC LIMIT 1) NOT IN('READY_FOR_REVIEW','APPROVED','REJECTED') THEN RAISE EXCEPTION 'Source changed' USING ERRCODE='40001';END IF;
   used:=(public.organization_resource_usage(p_org)->>'documents')::bigint;
   IF NOT coalesce(lic.documents_unlimited,false) AND (lic.documents_limit IS NULL OR used+1>lic.documents_limit) THEN RAISE EXCEPTION 'Document allowance exceeded' USING ERRCODE='22023';END IF;
   result:=public.eva_assisted_closing_action(p_org,p_actor,p_role,p_platform,'reserve',p_unit,p_month,p_id,jsonb_build_object('basis',prop.proposal_hash,'hash',prop.proposal_hash,'report',prop.report,'sources',prop.sources));
   IF result->'acquired' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Version not acquired' USING ERRCODE='40001';END IF;
   finished:=public.eva_assisted_closing_action(p_org,p_actor,p_role,p_platform,'finish',p_unit,p_month,p_id,'{}');
   IF finished->>'state' IS DISTINCT FROM 'READY_FOR_REVIEW' THEN RAISE EXCEPTION 'Unready correction' USING ERRCODE='40001';END IF;
   INSERT INTO public.eva_closing_document_credits(organization_id,proposal_id,closing_id,license_id,units,actor_id) VALUES(p_org,p_id,p_id,lic.id::text,1,p_actor);
   UPDATE public.licenses SET documents_used=used+1 WHERE id=lic.id;
   INSERT INTO public.eva_closing_change_events(organization_id,proposal_id,sequence,state,actor_id,closing_id) VALUES(p_org,p_id,ev.sequence+1,'APPLIED',p_actor,p_id);
  END IF;
 END IF;
 SELECT * INTO ev FROM public.eva_closing_change_events WHERE proposal_id=prop.id ORDER BY sequence DESC LIMIT 1;
 used:=(public.organization_resource_usage(p_org)->>'documents')::bigint;
 RETURN jsonb_build_object('id',prop.id,'hash',prop.proposal_hash,'sourceId',prop.source_id,'sourceHash',prop.source_hash,'state',CASE WHEN ev.state='PROPOSED' AND prop.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE ev.state END,'closingId',ev.closing_id,'expiresAt',prop.expires_at,'diff',prop.diff,'financial',prop.report->'financial','documentCharge',1,'charged',ev.state='APPLIED','used',used,'limit',lic.documents_limit,'unlimited',coalesce(lic.documents_unlimited,false));
END$$;
REVOKE ALL ON FUNCTION public.eva_closing_change_action(text,text,text,boolean,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_closing_change_action(text,text,text,boolean,text,text,text,uuid,jsonb) TO service_role;
COMMIT;
