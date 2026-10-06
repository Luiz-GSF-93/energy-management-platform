-- Controlled manual evidence. Reuse private document versions; do not duplicate
-- bytes, infer signatures from catalog tags, or automatically change ACR/ACL.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE UNIQUE INDEX acl_document_scope_key ON public.documents(organization_id,customer_id,consumer_unit_id,id);
CREATE UNIQUE INDEX acl_admission_evidence_scope_key ON public.acl_admissions(organization_id,id,customer_id,consumer_unit_id);
CREATE TABLE public.acl_admission_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,admission_id uuid NOT NULL,
 customer_id text NOT NULL,consumer_unit_id text NOT NULL,stage_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('COMPLETE','SKIP')),note text NOT NULL CHECK(length(btrim(note)) BETWEEN 20 AND 2000),
 facts jsonb NOT NULL CHECK(jsonb_typeof(facts)='object' AND octet_length(facts::text)<=4000),
 created_by text NOT NULL,actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,admission_id,customer_id,consumer_unit_id) REFERENCES public.acl_admissions(organization_id,id,customer_id,consumer_unit_id),
 UNIQUE(organization_id,id),UNIQUE(organization_id,id,customer_id,consumer_unit_id),
 CHECK(stage_key IN ('registration','invoices','feasibility','modality','contracts','termination','metering','custody','technical','contract-registration','validation','supply')),
 CHECK(kind<>'SKIP' OR stage_key IN ('metering','custody','contract-registration'))
);
CREATE TABLE public.acl_admission_evidence_documents (
 organization_id text NOT NULL,evidence_id uuid NOT NULL,customer_id text NOT NULL,consumer_unit_id text NOT NULL,document_id text NOT NULL REFERENCES public.documents(id),
 file_hash text NOT NULL CHECK(file_hash~'^[a-f0-9]{64}$'),catalog_revision integer NOT NULL,catalog_version integer NOT NULL,
 document_type text NOT NULL,reference_month date,PRIMARY KEY(evidence_id,document_id),
 FOREIGN KEY(organization_id,evidence_id,customer_id,consumer_unit_id) REFERENCES public.acl_admission_evidence(organization_id,id,customer_id,consumer_unit_id),
 FOREIGN KEY(organization_id,customer_id,consumer_unit_id,document_id) REFERENCES public.documents(organization_id,customer_id,consumer_unit_id,id)
);
CREATE TABLE public.acl_admission_evidence_reviews (
 evidence_id uuid PRIMARY KEY,organization_id text NOT NULL,decision text NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 20 AND 1000),reviewed_by text NOT NULL,actor_name text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,evidence_id) REFERENCES public.acl_admission_evidence(organization_id,id)
);
ALTER TABLE public.acl_admission_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acl_admission_evidence_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acl_admission_evidence_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.acl_admission_evidence,public.acl_admission_evidence_documents,public.acl_admission_evidence_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.acl_admission_evidence,public.acl_admission_evidence_documents,public.acl_admission_evidence_reviews TO service_role;
CREATE TRIGGER acl_evidence_immutable BEFORE UPDATE OR DELETE ON public.acl_admission_evidence FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER acl_evidence_docs_immutable BEFORE UPDATE OR DELETE ON public.acl_admission_evidence_documents FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER acl_reviews_immutable BEFORE UPDATE OR DELETE ON public.acl_admission_evidence_reviews FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();

CREATE FUNCTION public.acl_evidence_actor(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_write boolean,p_approve boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;
BEGIN
 IF p_write THEN access:=public.acl_work_authority(p_org,p_actor,p_role,p_platform,p_id);
 ELSE
  access:=public.acl_assert_actor(p_org,p_actor,p_role,p_platform,false);
  PERFORM public.acl_read(p_org,p_actor,p_role,p_platform,p_id,NULL);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active'
   AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND document_management)
 OR (NOT p_platform AND NOT EXISTS(SELECT 1 FROM public.roles WHERE id::text=p_role AND organization_id=p_org
   AND jsonb_typeof(permissions)='array' AND permissions ? '8f105b02-4443-49de-b188-847e0284e7ed'
   AND (NOT p_approve OR name IN ('admin_org','gestor') AND permissions ? '26cadaa7-2eea-4080-91f6-1f26f87ca809')))
 THEN RAISE EXCEPTION 'ACL evidence permission/license unavailable' USING ERRCODE='42501';END IF;
 RETURN access;
END $$;

-- File identity, the selected version and its catalog revision are revalidated
-- at submission, approval and use. New versions require fresh evidence review.
CREATE FUNCTION public.acl_check_evidence_sources(p_org text,p_evidence uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Pin the chosen series against concurrent version registration and changes.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org||':'||c.series_id,207))
 FROM public.acl_admission_evidence_documents l JOIN public.document_catalog c ON c.document_id=l.document_id AND c.organization_id=l.organization_id
 WHERE l.organization_id=p_org AND l.evidence_id=p_evidence ORDER BY c.series_id;
 PERFORM d.id FROM public.acl_admission_evidence_documents l JOIN public.documents d ON d.id=l.document_id AND d.organization_id=l.organization_id
 JOIN public.document_catalog c ON c.document_id=d.id AND c.organization_id=d.organization_id
 WHERE l.organization_id=p_org AND l.evidence_id=p_evidence ORDER BY d.id FOR SHARE OF d,c;
 IF NOT EXISTS(SELECT 1 FROM public.acl_admission_evidence_documents WHERE organization_id=p_org AND evidence_id=p_evidence)
 OR EXISTS(SELECT 1 FROM public.acl_admission_evidence_documents l LEFT JOIN public.documents d ON d.id=l.document_id
   AND d.organization_id=l.organization_id AND d.customer_id=l.customer_id AND d.consumer_unit_id=l.consumer_unit_id
   LEFT JOIN public.document_catalog c ON c.document_id=d.id AND c.organization_id=d.organization_id
   WHERE l.organization_id=p_org AND l.evidence_id=p_evidence AND (d.id IS NULL OR d.file_verified IS DISTINCT FROM true
    OR d.file_hash IS DISTINCT FROM l.file_hash OR d.document_type IS DISTINCT FROM l.document_type OR d.reference_month IS DISTINCT FROM l.reference_month
    OR c.revision IS DISTINCT FROM l.catalog_revision OR c.version IS DISTINCT FROM l.catalog_version OR c.tag NOT IN ('APPROVED','RELEASED','REVIEWED')
    OR EXISTS(SELECT 1 FROM public.document_catalog newer WHERE newer.organization_id=c.organization_id AND newer.series_id=c.series_id AND newer.version>c.version)))
 THEN RAISE EXCEPTION 'ACL evidence source changed/unavailable' USING ERRCODE='22023';END IF;
END $$;

-- Every write enters through this one organization lock, matching timer RPCs.
CREATE FUNCTION public.acl_evidence_command(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_request uuid,p_revision integer,
 p_action text,p_stage text DEFAULT NULL,p_evidence uuid DEFAULT NULL,p_documents text[] DEFAULT NULL,p_note text DEFAULT NULL,p_facts jsonb DEFAULT NULL,p_kind text DEFAULT NULL,p_checked boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;r record;old_event record;e record;s record;stage jsonb;pos integer;instant timestamptz;now_ms bigint;payload jsonb;v jsonb;ev jsonb;new_id uuid;docs_count integer;dependencies text[];
BEGIN
 IF p_id IS NULL OR p_request IS NULL OR p_revision IS NULL OR p_revision<1 OR p_action IS NULL OR p_action NOT IN ('SUBMIT','APPROVE','REJECT','COMPLETE','SKIP')
 OR p_checked IS DISTINCT FROM true THEN RAISE EXCEPTION 'ACL evidence requires explicit review' USING ERRCODE='22023';END IF;
 IF (p_action='SUBMIT' AND (p_stage IS NULL OR p_kind IS NULL OR p_kind NOT IN ('COMPLETE','SKIP') OR p_documents IS NULL OR cardinality(p_documents) NOT BETWEEN 1 AND 20
   OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 20 AND 2000 OR p_facts IS NULL OR jsonb_typeof(p_facts)<>'object' OR octet_length(p_facts::text)>4000 OR p_evidence IS NOT NULL))
 OR (p_action IN ('APPROVE','REJECT') AND (p_evidence IS NULL OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 20 AND 1000 OR p_documents IS NOT NULL OR p_facts IS NOT NULL OR p_kind IS NOT NULL OR p_stage IS NOT NULL))
 OR (p_action IN ('COMPLETE','SKIP') AND (p_evidence IS NULL OR p_documents IS NOT NULL OR p_facts IS NOT NULL OR p_kind IS NOT NULL OR p_stage IS NOT NULL OR p_note IS NOT NULL))
 THEN RAISE EXCEPTION 'Invalid ACL evidence command fields' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('acl-work:'||p_org,0));
 access:=public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,true,p_action IN ('APPROVE','REJECT','SKIP'));
 instant:=date_trunc('milliseconds',clock_timestamp());now_ms:=floor(extract(epoch FROM instant)*1000)::bigint;
 payload:=jsonb_build_object('admissionId',p_id,'actorId',p_actor,'revision',p_revision,'action',p_action,'stageKey',p_stage,'evidenceId',p_evidence,'documents',p_documents,'note',p_note,'facts',p_facts,'kind',p_kind,'checked',p_checked);
 SELECT * INTO old_event FROM public.acl_admission_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF old_event.request_payload<>payload THEN RAISE EXCEPTION 'ACL request already used' USING ERRCODE='40001';END IF;
  SELECT state INTO v FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id;
  RETURN jsonb_build_object('ok',true,'admission',v,'evidenceId',old_event.snapshot->'evidenceId','replayed',true);
 END IF;
 PERFORM public.acl_expire_work(p_org,instant);
 SELECT * INTO STRICT r FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF now_ms<(r.state->>'createdAt')::bigint OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.state->'events') x WHERE (x->>'at')::bigint>now_ms)
 THEN RAISE EXCEPTION 'ACL clock moved backwards' USING ERRCODE='23514';END IF;
 IF r.revision<>p_revision THEN RETURN jsonb_build_object('ok',false,'code','CONFLICT');END IF;
 IF r.status='COMPLETED' THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
 IF p_action<>'SUBMIT' THEN
  SELECT * INTO e FROM public.acl_admission_evidence WHERE organization_id=p_org AND admission_id=p_id AND id=p_evidence;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACL evidence outside process' USING ERRCODE='P4102';END IF;
  p_stage:=e.stage_key;
 END IF;
 SELECT value,(ordinality-1)::integer INTO stage,pos FROM jsonb_array_elements(r.state->'stages') WITH ORDINALITY WHERE value->>'key'=p_stage;
 IF stage IS NULL THEN RAISE EXCEPTION 'Invalid ACL stage' USING ERRCODE='22023';END IF;
 IF p_action='SUBMIT' THEN
  IF p_kind='COMPLETE' AND (stage->>'status'<>'RUNNING' OR stage->'active'->>'actorId' IS DISTINCT FROM p_actor)
   OR p_kind='SKIP' AND (stage->>'status'<>'NOT_STARTED' OR p_stage NOT IN ('metering','custody','contract-registration'))
  THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_documents) x)<>cardinality(p_documents) THEN RAISE EXCEPTION 'Duplicate ACL documents' USING ERRCODE='22023';END IF;
  -- Facts have a strict whitelist. A modality/date is confirmed by the reviewer,
  -- not inferred from price, document tags or an unreviewed OCR response.
  IF p_kind='SKIP' OR p_stage NOT IN ('modality','supply') THEN
   IF p_facts<>'{}'::jsonb THEN RAISE EXCEPTION 'Unexpected ACL facts' USING ERRCODE='22023';END IF;
  ELSIF p_stage='modality' THEN
   IF NOT coalesce(p_facts-'modality'='{}'::jsonb AND jsonb_typeof(p_facts->'modality')='string' AND p_facts->>'modality' IN ('RETAIL','OWN_AGENT'),false)
    THEN RAISE EXCEPTION 'Confirmed modality required' USING ERRCODE='22023';END IF;
  ELSIF p_stage='supply' THEN
   IF NOT coalesce(p_facts-'supplyDate'='{}'::jsonb AND jsonb_typeof(p_facts->'supplyDate')='string' AND p_facts->>'supplyDate'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$',false)
    THEN RAISE EXCEPTION 'Confirmed supply date required' USING ERRCODE='22023';END IF;
   BEGIN PERFORM (p_facts->>'supplyDate')::date;
   EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'Invalid supply date' USING ERRCODE='22023';END;
  END IF;
  new_id:=gen_random_uuid();
  INSERT INTO public.acl_admission_evidence(id,organization_id,admission_id,customer_id,consumer_unit_id,stage_key,kind,note,facts,created_by,actor_name,created_at)
   VALUES(new_id,p_org,p_id,r.customer_id,r.consumer_unit_id,p_stage,p_kind,btrim(p_note),p_facts,p_actor,access->>'actorName',instant);
  INSERT INTO public.acl_admission_evidence_documents(organization_id,evidence_id,customer_id,consumer_unit_id,document_id,file_hash,catalog_revision,catalog_version,document_type,reference_month)
   SELECT p_org,new_id,r.customer_id,r.consumer_unit_id,d.id,d.file_hash,c.revision,c.version,d.document_type,d.reference_month
   FROM public.documents d JOIN public.document_catalog c ON c.document_id=d.id AND c.organization_id=d.organization_id
   WHERE d.id=ANY(p_documents) AND d.organization_id=p_org AND d.customer_id=r.customer_id AND d.consumer_unit_id=r.consumer_unit_id AND d.file_verified
   AND d.file_hash~'^[a-f0-9]{64}$' AND c.tag IN ('APPROVED','RELEASED','REVIEWED');
  GET DIAGNOSTICS docs_count=ROW_COUNT;
  IF docs_count<>cardinality(p_documents) THEN RAISE EXCEPTION 'Private reviewed document versions required' USING ERRCODE='22023';END IF;
  PERFORM public.acl_check_evidence_sources(p_org,new_id);
  IF p_kind='COMPLETE' AND p_stage='invoices' THEN
   IF docs_count<>12 OR EXISTS(SELECT 1 FROM public.acl_admission_evidence_documents WHERE evidence_id=new_id AND document_type<>'INVOICE_DISTRIBUTOR')
   OR EXISTS(SELECT 1 FROM public.acl_admission_evidence_documents WHERE evidence_id=new_id AND reference_month<>date_trunc('month',reference_month)::date)
   OR (SELECT count(DISTINCT date_trunc('month',reference_month)) FROM public.acl_admission_evidence_documents WHERE evidence_id=new_id)<>12
   OR (SELECT max(reference_month) FROM public.acl_admission_evidence_documents WHERE evidence_id=new_id)
      <> (SELECT min(reference_month)+interval '11 months' FROM public.acl_admission_evidence_documents WHERE evidence_id=new_id)
   THEN RAISE EXCEPTION 'Twelve consecutive reviewed invoices required' USING ERRCODE='22023';END IF;
  END IF;
  IF p_kind='COMPLETE' AND p_stage='contracts' AND NOT
   (EXISTS(SELECT 1 FROM public.acl_admission_evidence_documents WHERE evidence_id=new_id AND document_type='CONTRACT_ENERGY') AND
    EXISTS(SELECT 1 FROM public.acl_admission_evidence_documents WHERE evidence_id=new_id AND document_type='CONTRACT_MANAGEMENT'))
   THEN RAISE EXCEPTION 'Energy and management contract evidence required' USING ERRCODE='22023';END IF;
 ELSE
  new_id:=p_evidence;
  IF p_action IN ('APPROVE','REJECT') THEN
   IF (e.kind='COMPLETE' AND stage->>'status'<>'RUNNING') OR (e.kind='SKIP' AND stage->>'status'<>'NOT_STARTED')
    OR EXISTS(SELECT 1 FROM public.acl_admission_evidence_reviews WHERE evidence_id=e.id)
   THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
   IF p_action='APPROVE' THEN PERFORM public.acl_check_evidence_sources(p_org,e.id);END IF;
   INSERT INTO public.acl_admission_evidence_reviews(evidence_id,organization_id,decision,reason,reviewed_by,actor_name,reviewed_at)
    VALUES(e.id,p_org,CASE p_action WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,btrim(p_note),p_actor,access->>'actorName',instant);
  ELSE
   IF e.kind<>p_action OR NOT EXISTS(SELECT 1 FROM public.acl_admission_evidence_reviews WHERE organization_id=p_org AND evidence_id=e.id AND decision='APPROVED')
    THEN RAISE EXCEPTION 'Approved evidence required' USING ERRCODE='22023';END IF;
   PERFORM public.acl_check_evidence_sources(p_org,e.id);
   dependencies:=CASE p_stage WHEN 'registration' THEN ARRAY[]::text[] WHEN 'invoices' THEN ARRAY['registration'] WHEN 'feasibility' THEN ARRAY['invoices']
    WHEN 'modality' THEN ARRAY['feasibility'] WHEN 'contracts' THEN ARRAY['modality'] WHEN 'termination' THEN ARRAY['contracts']
    WHEN 'technical' THEN ARRAY['registration'] WHEN 'metering' THEN ARRAY['modality','technical'] WHEN 'custody' THEN ARRAY['modality']
    WHEN 'contract-registration' THEN ARRAY['modality','contracts'] WHEN 'validation' THEN ARRAY['technical','contracts','termination','metering','custody','contract-registration']
    WHEN 'supply' THEN ARRAY['validation'] END;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.state->'stages') x WHERE x->>'key'=ANY(dependencies) AND x->>'status' NOT IN ('COMPLETED','SKIPPED'))
    THEN RETURN jsonb_build_object('ok',false,'code','DEPENDENCIES');END IF;
   IF p_action='COMPLETE' THEN
    SELECT * INTO s FROM public.acl_admission_work_sessions WHERE organization_id=p_org AND admission_id=p_id AND stage_key=p_stage AND ended_at IS NULL FOR UPDATE;
    IF NOT FOUND OR s.actor_id<>p_actor OR stage->>'status'<>'RUNNING' THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
    IF instant<s.heartbeat_at THEN RAISE EXCEPTION 'ACL clock moved backwards' USING ERRCODE='23514';END IF;
    stage:=(stage-'active')||jsonb_build_object('status','COMPLETED','evidenceRef',e.id,'elapsedMs',(stage->>'elapsedMs')::bigint+floor(extract(epoch FROM instant-s.started_at)*1000)::bigint);
    IF p_stage='modality' THEN stage:=stage||jsonb_build_object('modality',e.facts->'modality');END IF;
    IF p_stage='supply' THEN stage:=stage||jsonb_build_object('supplyDate',e.facts->'supplyDate');END IF;
    UPDATE public.acl_admission_work_sessions SET ended_at=instant,reason='COMPLETED' WHERE id=s.id;
   ELSE
    IF stage->>'status'<>'NOT_STARTED' THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
    IF p_stage IN ('custody','contract-registration') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.state->'stages') x WHERE x->>'key'='modality' AND x->>'status'='COMPLETED' AND x->>'modality'='RETAIL')
     THEN RAISE EXCEPTION 'Retail modality required for this dispensation' USING ERRCODE='22023';END IF;
    stage:=stage||jsonb_build_object('status','SKIPPED','evidenceRef',e.id,'skipReason',e.note);
   END IF;
  END IF;
 END IF;
 ev:=jsonb_build_object('revision',r.revision+1,'requestId',p_request,'action','EVIDENCE_'||p_action,'actorId',p_actor,'actorName',access->>'actorName','at',now_ms,'stageKey',p_stage,'evidenceId',new_id);
 v:=jsonb_set(r.state,ARRAY['stages',pos::text],stage)||jsonb_build_object('status','IN_PROGRESS','revision',r.revision+1,'events',(r.state->'events')||jsonb_build_array(ev));
 UPDATE public.acl_admissions SET state=v,status='IN_PROGRESS',revision=r.revision+1,updated_at=instant WHERE organization_id=p_org AND id=p_id;
 INSERT INTO public.acl_admission_events(organization_id,admission_id,revision,request_id,request_payload,action,actor_id,snapshot,recorded_at)
 VALUES(p_org,p_id,r.revision+1,p_request,payload,'EVIDENCE_'||p_action,p_actor,ev,instant);
 RETURN jsonb_build_object('ok',true,'admission',v,'evidenceId',new_id,'replayed',false);
END $$;

CREATE FUNCTION public.acl_evidence_read(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,false,false);
 SELECT coalesce(jsonb_agg(q.body ORDER BY q.id),'[]'::jsonb) INTO result FROM (
  SELECT e.id,jsonb_build_object('id',e.id,'stageKey',e.stage_key,'kind',e.kind,'note',e.note,'facts',e.facts,'actorName',e.actor_name,'createdAt',e.created_at,
   'review',CASE WHEN r.evidence_id IS NOT NULL THEN jsonb_build_object('decision',r.decision,'reason',r.reason,'actorName',r.actor_name,'reviewedAt',r.reviewed_at) ELSE NULL END,
   'documents',(SELECT jsonb_agg(jsonb_build_object('id',l.document_id,'fileHash',l.file_hash,'version',l.catalog_version,'type',l.document_type,'month',l.reference_month) ORDER BY l.document_id)
     FROM public.acl_admission_evidence_documents l WHERE l.organization_id=p_org AND l.evidence_id=e.id)) AS body
  FROM public.acl_admission_evidence e LEFT JOIN public.acl_admission_evidence_reviews r ON r.evidence_id=e.id AND r.organization_id=e.organization_id
  WHERE e.organization_id=p_org AND e.admission_id=p_id AND (p_after IS NULL OR e.id>p_after) ORDER BY e.id LIMIT 51
 ) q;RETURN result;
END $$;
CREATE FUNCTION public.acl_evidence_sources(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_after text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,false,false);
 SELECT coalesce(jsonb_agg(q.body ORDER BY q.id),'[]'::jsonb) INTO result FROM (
  SELECT d.id,jsonb_build_object('id',d.id,'name',d.original_filename,'type',d.document_type,'month',d.reference_month,'version',c.version) AS body
  FROM public.acl_admissions a JOIN public.documents d ON d.organization_id=a.organization_id AND d.customer_id=a.customer_id AND d.consumer_unit_id=a.consumer_unit_id
  JOIN public.document_catalog c ON c.organization_id=d.organization_id AND c.document_id=d.id
  WHERE a.organization_id=p_org AND a.id=p_id AND d.id>coalesce(p_after,'') AND d.file_verified AND d.file_hash~'^[a-f0-9]{64}$'
   AND c.tag IN ('APPROVED','RELEASED','REVIEWED') AND NOT EXISTS(SELECT 1 FROM public.document_catalog newer WHERE newer.organization_id=c.organization_id AND newer.series_id=c.series_id AND newer.version>c.version)
  ORDER BY d.id LIMIT 51
 ) q;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.acl_evidence_actor(text,text,text,boolean,uuid,boolean,boolean),public.acl_check_evidence_sources(text,uuid),
 public.acl_evidence_command(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean),public.acl_evidence_read(text,text,text,boolean,uuid,uuid),public.acl_evidence_sources(text,text,text,boolean,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_evidence_command(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean),public.acl_evidence_read(text,text,text,boolean,uuid,uuid),public.acl_evidence_sources(text,text,text,boolean,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';COMMIT;
