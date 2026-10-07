BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.acl_economic_study_command(text,text,text,boolean,uuid,uuid,integer,text,boolean,jsonb,uuid,text,text)'::regprocedure) INTO definition;
 IF position('octet_length(p_snapshot::text)>60000' in definition)=0 THEN RAISE EXCEPTION 'Unexpected study gateway definition';END IF;
 EXECUTE replace(definition,'octet_length(p_snapshot::text)>60000','octet_length(p_snapshot::text)>120000');
END $$;
CREATE TABLE public.acl_financial_reviews(
 organization_id text NOT NULL,study_id uuid PRIMARY KEY,decision text NOT NULL CHECK(decision IN ('FAVORABLE','UNFAVORABLE','CONDITIONAL')),
 checks jsonb NOT NULL,payload_hash text NOT NULL,reviewed_by text NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,study_id) REFERENCES public.acl_economic_studies(organization_id,id)
);
CREATE TABLE public.acl_feasibility_studies(
 organization_id text NOT NULL,evidence_id uuid PRIMARY KEY,study_id uuid NOT NULL,payload_hash text NOT NULL,
 FOREIGN KEY(organization_id,evidence_id) REFERENCES public.acl_admission_evidence(organization_id,id),
 FOREIGN KEY(organization_id,study_id) REFERENCES public.acl_economic_studies(organization_id,id)
);
ALTER TABLE public.acl_financial_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acl_feasibility_studies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.acl_financial_reviews,public.acl_feasibility_studies FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.acl_financial_reviews,public.acl_feasibility_studies TO service_role;
CREATE TRIGGER acl_financial_review_immutable BEFORE UPDATE OR DELETE ON public.acl_financial_reviews FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER acl_feasibility_study_immutable BEFORE UPDATE OR DELETE ON public.acl_feasibility_studies FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE FUNCTION public.acl_financial_review_command(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_request uuid,p_revision integer,p_study uuid,p_hash text,p_reason text,p_decision text,p_checks jsonb,p_checked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s record;f jsonb;res jsonb;old record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('acl-work:'||p_org,0));
 PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,true,true);
 IF p_decision IS NULL OR p_decision NOT IN ('FAVORABLE','UNFAVORABLE','CONDITIONAL') OR p_checks IS DISTINCT FROM '{"sources":true,"costs":true,"gd":true,"cashFlow":true,"limitations":true}'::jsonb THEN RAISE EXCEPTION 'Explicit independent financial checks required' USING ERRCODE='22023';END IF;
 SELECT * INTO s FROM public.acl_economic_studies WHERE organization_id=p_org AND admission_id=p_id AND id=p_study;
 IF NOT FOUND THEN RAISE EXCEPTION 'Study outside scope' USING ERRCODE='P4102';END IF;
 f:=s.body->'result'->'financialComparison';
 IF NOT coalesce(f->>'state'='COMPLETE_SIMULATED' AND f->>'formulaVersion'='acl-financial/1' AND jsonb_array_length(f->'rows')=(s.body->'result'->'proposal'->>'months')::integer,false) THEN RAISE EXCEPTION 'Complete simulated cash flow required' USING ERRCODE='22023';END IF;
 IF p_decision='FAVORABLE' AND ((f->>'operatingSavings')::numeric<=0 OR (f->>'netCash')::numeric<0) THEN RAISE EXCEPTION 'Favorable decision incompatible with cash flow' USING ERRCODE='22023';END IF;
 SELECT * INTO old FROM public.acl_financial_reviews WHERE organization_id=p_org AND study_id=p_study;
 IF FOUND AND (old.decision<>p_decision OR old.checks<>p_checks OR old.reviewed_by<>p_actor OR old.payload_hash<>p_hash) THEN RAISE EXCEPTION 'Financial review retry changed' USING ERRCODE='40001';END IF;
 -- Existing gateway checks reviewer != author, live source hashes, permissions, revision,
 -- active feasibility stage and idempotent request. Both writes commit atomically.
 res:=public.acl_economic_study_command(p_org,p_actor,p_role,p_platform,p_id,p_request,p_revision,'REVIEW',p_checked,NULL,p_study,p_reason,p_hash);
 IF res->>'ok'='true' THEN
  INSERT INTO public.acl_financial_reviews(organization_id,study_id,decision,checks,payload_hash,reviewed_by) VALUES(p_org,p_study,p_decision,p_checks,p_hash,p_actor) ON CONFLICT(study_id) DO NOTHING;
 END IF;RETURN res;
END $$;
ALTER FUNCTION public.acl_economic_study_read(text,text,text,boolean,uuid,uuid) RENAME TO acl_economic_study_read_financial_internal;
REVOKE ALL ON FUNCTION public.acl_economic_study_read_financial_internal(text,text,text,boolean,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.acl_economic_study_read(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows jsonb;
BEGIN
 rows:=public.acl_economic_study_read_financial_internal(p_org,p_actor,p_role,p_platform,p_id,p_after);
 RETURN (SELECT coalesce(jsonb_agg(v||jsonb_build_object('financialReview',(SELECT jsonb_build_object('decision',f.decision,'checks',f.checks,'hash',f.payload_hash,'reviewedAt',f.reviewed_at) FROM public.acl_financial_reviews f WHERE f.organization_id=p_org AND f.study_id=(v->>'id')::uuid)) ORDER BY v->>'id'),'[]'::jsonb) FROM jsonb_array_elements(rows) v);
END $$;
CREATE FUNCTION public.acl_check_financial_study(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_study uuid,p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s record;src jsonb;
BEGIN
 PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,false,false);
 SELECT s0.* INTO s FROM public.acl_economic_studies s0 JOIN public.acl_financial_reviews f ON f.organization_id=s0.organization_id AND f.study_id=s0.id JOIN public.acl_economic_study_reviews rev ON rev.organization_id=s0.organization_id AND rev.study_id=s0.id
 WHERE s0.organization_id=p_org AND s0.admission_id=p_id AND s0.id=p_study AND f.decision='FAVORABLE' AND f.payload_hash=s0.payload_hash AND f.reviewed_by<>s0.created_by AND rev.decision='REVIEWED' AND rev.reviewed_by=f.reviewed_by AND rev.payload_hash=s0.payload_hash;
 IF NOT FOUND OR s.payload_hash<>p_hash OR s.payload_hash<>encode(sha256(convert_to(s.body::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Current favorable independent financial review required' USING ERRCODE='22023';END IF;
 src:=public.acl_history_simulation_source(p_org,p_actor,p_role,p_platform,p_id,s.evidence_id);
 IF src IS DISTINCT FROM s.body->'source' THEN RAISE EXCEPTION 'Financial study source changed' USING ERRCODE='22023';END IF;
END $$;
ALTER FUNCTION public.acl_evidence_command(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean) RENAME TO acl_evidence_command_financial_internal;
REVOKE ALL ON FUNCTION public.acl_evidence_command_financial_internal(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.acl_evidence_command(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_request uuid,p_revision integer,p_action text,p_stage text DEFAULT NULL,p_evidence uuid DEFAULT NULL,p_documents text[] DEFAULT NULL,p_note text DEFAULT NULL,p_facts jsonb DEFAULT NULL,p_kind text DEFAULT NULL,p_checked boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE res jsonb;link jsonb;e record;s record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('acl-work:'||p_org,0));
 PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,true,p_action IN ('APPROVE','REJECT','SKIP'));
 IF p_action='SUBMIT' AND p_stage='feasibility' THEN
  link:=p_facts->'financialStudy';
  IF NOT coalesce(jsonb_typeof(link)='object' AND link-ARRAY['id','hash']='{}'::jsonb AND link->>'hash'~'^[a-f0-9]{64}$',false) THEN RAISE EXCEPTION 'Financial version required for feasibility' USING ERRCODE='22023';END IF;
  PERFORM public.acl_check_financial_study(p_org,p_actor,p_role,p_platform,p_id,(link->>'id')::uuid,link->>'hash');
  SELECT * INTO s FROM public.acl_economic_studies WHERE organization_id=p_org AND admission_id=p_id AND id=(link->>'id')::uuid;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(s.body->'source'->'documents') d WHERE NOT (d->>'id'=ANY(p_documents))) THEN RAISE EXCEPTION 'Financial source documents required in evidence' USING ERRCODE='22023';END IF;
 ELSE
  IF p_facts ? 'financialStudy' THEN RAISE EXCEPTION 'Unexpected financial linkage' USING ERRCODE='22023';END IF;
  IF p_action IN ('APPROVE','COMPLETE') THEN
   SELECT * INTO e FROM public.acl_admission_evidence WHERE organization_id=p_org AND admission_id=p_id AND id=p_evidence;
   IF e.stage_key='feasibility' THEN
    SELECT * INTO s FROM public.acl_feasibility_studies WHERE organization_id=p_org AND evidence_id=p_evidence;
    IF NOT FOUND THEN RAISE EXCEPTION 'Independent reviewed financial version required' USING ERRCODE='22023';END IF;
    PERFORM public.acl_check_financial_study(p_org,p_actor,p_role,p_platform,p_id,s.study_id,s.payload_hash);
   END IF;
  END IF;
 END IF;
 res:=public.acl_evidence_command_financial_internal(p_org,p_actor,p_role,p_platform,p_id,p_request,p_revision,p_action,p_stage,p_evidence,p_documents,p_note,p_facts-'financialStudy',p_kind,p_checked);
 IF link IS NOT NULL AND res->>'ok'='true' THEN
  SELECT * INTO s FROM public.acl_feasibility_studies WHERE organization_id=p_org AND evidence_id=(res->>'evidenceId')::uuid;
  IF FOUND AND (s.study_id::text<>link->>'id' OR s.payload_hash<>link->>'hash') THEN RAISE EXCEPTION 'Financial linkage retry changed' USING ERRCODE='40001';END IF;
  INSERT INTO public.acl_feasibility_studies(organization_id,evidence_id,study_id,payload_hash) VALUES(p_org,(res->>'evidenceId')::uuid,(link->>'id')::uuid,link->>'hash') ON CONFLICT(evidence_id) DO NOTHING;
 END IF;RETURN res;
END $$;
-- Preserve financial linkage in evidence reads and at final closure.
ALTER FUNCTION public.acl_evidence_read(text,text,text,boolean,uuid,uuid) RENAME TO acl_evidence_read_financial_internal;
REVOKE ALL ON FUNCTION public.acl_evidence_read_financial_internal(text,text,text,boolean,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.acl_evidence_read(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows jsonb;
BEGIN
 rows:=public.acl_evidence_read_financial_internal(p_org,p_actor,p_role,p_platform,p_id,p_after);
 RETURN (SELECT coalesce(jsonb_agg(v||jsonb_build_object('financialStudy',(SELECT jsonb_build_object('id',l.study_id,'hash',l.payload_hash) FROM public.acl_feasibility_studies l WHERE l.organization_id=p_org AND l.evidence_id=(v->>'id')::uuid)) ORDER BY v->>'id'),'[]'::jsonb) FROM jsonb_array_elements(rows) v);
END $$;
REVOKE ALL ON FUNCTION public.acl_evidence_read(text,text,text,boolean,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_evidence_read(text,text,text,boolean,uuid,uuid) TO service_role;
DO $$ DECLARE definition text; BEGIN
 IF to_regprocedure('public.acl_closure_command(text,text,text,boolean,uuid,uuid,integer,text,boolean,text,text)') IS NOT NULL THEN
  SELECT pg_get_functiondef('public.acl_closure_command(text,text,text,boolean,uuid,uuid,integer,text,boolean,text,text)'::regprocedure) INTO definition;
  IF position('PERFORM public.acl_check_evidence_sources(p_org,e.id);' in definition)=0 THEN RAISE EXCEPTION 'Unexpected closure gateway';END IF;
  definition:=replace(definition,'PERFORM public.acl_check_evidence_sources(p_org,e.id);','PERFORM public.acl_check_evidence_sources(p_org,e.id); IF stage->>''key''=''feasibility'' THEN PERFORM public.acl_check_financial_study(p_org,p_actor,p_role,p_platform,p_id,(SELECT study_id FROM public.acl_feasibility_studies WHERE organization_id=p_org AND evidence_id=e.id),(SELECT payload_hash FROM public.acl_feasibility_studies WHERE organization_id=p_org AND evidence_id=e.id)); END IF;');
  definition:=replace(definition,'''facts'',a.facts,','''facts'',a.facts,''financialStudy'',(SELECT jsonb_build_object(''id'',fs.study_id,''hash'',fs.payload_hash) FROM public.acl_feasibility_studies fs WHERE fs.organization_id=p_org AND fs.evidence_id=a.id),');
  EXECUTE definition;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.acl_check_financial_study(text,text,text,boolean,uuid,uuid,text),public.acl_financial_review_command(text,text,text,boolean,uuid,uuid,integer,uuid,text,text,text,jsonb,boolean),public.acl_economic_study_read(text,text,text,boolean,uuid,uuid),public.acl_evidence_command(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_financial_review_command(text,text,text,boolean,uuid,uuid,integer,uuid,text,text,text,jsonb,boolean),public.acl_economic_study_read(text,text,text,boolean,uuid,uuid),public.acl_evidence_command(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean) TO service_role;
NOTIFY pgrst,'reload schema';COMMIT;
