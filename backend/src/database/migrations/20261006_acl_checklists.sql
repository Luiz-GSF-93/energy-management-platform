-- Operational checklists; consultant reference is required, no hardcoded regulatory deadline.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE TABLE public.acl_checklist_templates(version text PRIMARY KEY,catalog jsonb NOT NULL);
INSERT INTO public.acl_checklist_templates VALUES('acl-checklist-v1','{"feasibility": {"COMPLETE": [{"key": "history", "label": "Histórico aprovado e sazonalidade conferidos", "optional": false}, {"key": "comparison", "label": "Bases ACR e ACL comparáveis, incluindo TUSD e demanda", "optional": false}, {"key": "scope", "label": "Custos, impostos, perdas, gestão e CCEE incluídos ou explicitamente pendentes", "optional": false}, {"key": "technologies", "label": "GD e BESS tratados sem duplicar consumo ou economia", "optional": true}, {"key": "investment", "label": "Investimentos e limite de ROI/payback documentados", "optional": false}]}, "modality": {"COMPLETE": [{"key": "eligibility", "label": "Carga, demanda, tensão e fundamento da elegibilidade conferidos", "optional": false}, {"key": "representation", "label": "Modalidade e representação confirmadas pelo Consultor", "optional": false}, {"key": "applicability", "label": "Etapas condicionais e responsabilidades identificadas", "optional": false}]}, "contracts": {"COMPLETE": [{"key": "energy", "label": "Contrato de energia, fornecedor, vigência e versão conferidos", "optional": false}, {"key": "management", "label": "Contrato de gestão, honorários, vigência e versão conferidos", "optional": false}, {"key": "signatures", "label": "Documentos assinados recebidos e poderes dos representantes conferidos", "optional": false}]}, "termination": {"COMPLETE": [{"key": "notice", "label": "Carta de denúncia e destinatário conferidos", "optional": false}, {"key": "protocol", "label": "Protocolo de recebimento documentado", "optional": false}, {"key": "deadline", "label": "Prazo conferido no contrato ou procedimento aplicável", "optional": false}]}, "metering": {"COMPLETE": [{"key": "panel", "label": "Painel, TC/TP, medidor e documentação técnica conferidos", "optional": false}, {"key": "photos", "label": "Fotos e termo técnico identificados", "optional": false}, {"key": "acceptance", "label": "Validação da adequação recebida e conferida", "optional": false}], "SKIP": [{"key": "applicability", "label": "Não aplicabilidade fundamentada e comprovada para esta unidade e modalidade", "optional": false}]}, "custody": {"COMPLETE": [{"key": "authority", "label": "Procuração e poderes de representação conferidos", "optional": false}, {"key": "account", "label": "Conta, custódia e adesão verificadas quando exigidas", "optional": false}, {"key": "fee", "label": "Boleto externo, vencimento e comprovante conferidos quando exigidos", "optional": true}], "SKIP": [{"key": "applicability", "label": "Não aplicabilidade fundamentada e comprovada para esta unidade e modalidade", "optional": false}]}, "technical": {"COMPLETE": [{"key": "unit", "label": "UC, instalação, distribuidora, tensão e submercado conferidos", "optional": false}, {"key": "cusd", "label": "CUSD vigente e aditivos conferidos", "optional": false}, {"key": "diagram", "label": "Diagrama unifilar e informações de conexão conferidos", "optional": false}]}, "contract-registration": {"COMPLETE": [{"key": "contracts", "label": "Contratos e representação vinculados ao processo correto", "optional": false}, {"key": "protocols", "label": "Protocolos de registro e confirmação conferidos", "optional": false}, {"key": "source", "label": "Origem da comprovação identificada: manual ou integração validada", "optional": false}], "SKIP": [{"key": "applicability", "label": "Não aplicabilidade fundamentada e comprovada para esta unidade e modalidade", "optional": false}]}, "validation": {"COMPLETE": [{"key": "company", "label": "CNPJ, societário, representantes e procurações conferidos", "optional": false}, {"key": "technical", "label": "Conexão, demanda, tensão e medição aplicável conferidos", "optional": false}, {"key": "distributor", "label": "Checklist e aceitação da distribuidora conferidos", "optional": false}, {"key": "ccee", "label": "Checklist aplicável à modalidade e comprovação CCEE conferidos", "optional": false}]}, "supply": {"COMPLETE": [{"key": "date", "label": "Data de suprimento confirmada por evidência", "optional": false}, {"key": "acceptance", "label": "Aceite e validações de início conferidos", "optional": false}, {"key": "communication", "label": "Resumo destinado ao cliente revisado", "optional": false}]}}'::jsonb);
CREATE TABLE public.acl_admission_checklists (
 evidence_id uuid PRIMARY KEY,organization_id text NOT NULL,admission_id uuid NOT NULL,request_id uuid NOT NULL,
 template_version text NOT NULL REFERENCES public.acl_checklist_templates(version),payload jsonb NOT NULL,command_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,admission_id) REFERENCES public.acl_admissions(organization_id,id),
 FOREIGN KEY(organization_id,evidence_id) REFERENCES public.acl_admission_evidence(organization_id,id),UNIQUE(organization_id,request_id),
 CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=10000)
);
ALTER TABLE public.acl_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acl_admission_checklists ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER acl_checklist_immutable BEFORE UPDATE OR DELETE ON public.acl_admission_checklists FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
CREATE TRIGGER acl_template_immutable BEFORE UPDATE OR DELETE ON public.acl_checklist_templates FOR EACH ROW EXECUTE FUNCTION public.acl_preserve_record();
REVOKE ALL ON public.acl_checklist_templates,public.acl_admission_checklists FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.acl_checklist_templates,public.acl_admission_checklists TO service_role;
CREATE FUNCTION public.acl_checklist_catalog(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,false,false);
 RETURN (SELECT jsonb_build_object('version',version,'stages',catalog) FROM public.acl_checklist_templates WHERE version='acl-checklist-v1');
END $$;
CREATE FUNCTION public.acl_validate_checklist(p_stage text,p_kind text,p_value jsonb,p_documents text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE items jsonb;spec jsonb;answer jsonb;
BEGIN
 SELECT catalog->p_stage->p_kind INTO items FROM public.acl_checklist_templates WHERE version='acl-checklist-v1';
 IF items IS NULL THEN
  IF p_value IS NOT NULL THEN RAISE EXCEPTION 'Unexpected checklist' USING ERRCODE='22023';END IF;RETURN;
 END IF;
 IF NOT coalesce(jsonb_typeof(p_value)='object' AND p_value-ARRAY['templateVersion','reference','referenceDate','deadlineDate','items']='{}'::jsonb
 AND p_value->>'templateVersion'='acl-checklist-v1' AND jsonb_typeof(p_value->'reference')='string' AND length(btrim(p_value->>'reference')) BETWEEN 20 AND 300
 AND jsonb_typeof(p_value->'referenceDate')='string' AND p_value->>'referenceDate'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND jsonb_typeof(p_value->'items')='object',false)
 THEN RAISE EXCEPTION 'Incomplete checklist reference' USING ERRCODE='22023';END IF;
 PERFORM (p_value->>'referenceDate')::date;
 IF p_value ? 'deadlineDate' THEN
  IF jsonb_typeof(p_value->'deadlineDate')<>'string' OR NOT (p_value->>'deadlineDate'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN RAISE EXCEPTION 'Invalid reviewed deadline' USING ERRCODE='22023';END IF;
  PERFORM (p_value->>'deadlineDate')::date;
 END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_value->'items'))<>jsonb_array_length(items) THEN RAISE EXCEPTION 'Checklist items differ' USING ERRCODE='22023';END IF;
 FOR spec IN SELECT value FROM jsonb_array_elements(items) LOOP
  answer:=p_value->'items'->(spec->>'key');
  IF NOT coalesce(jsonb_typeof(answer)='object' AND answer-ARRAY['status','note','documentId']='{}'::jsonb
   AND answer->>'status' IN ('CONFIRMED','NOT_APPLICABLE') AND (answer->>'status'='CONFIRMED' OR spec->>'optional'='true')
   AND jsonb_typeof(answer->'note')='string' AND length(btrim(answer->>'note')) BETWEEN 10 AND 500
   AND jsonb_typeof(answer->'documentId')='string' AND answer->>'documentId'=ANY(p_documents),false)
  THEN RAISE EXCEPTION 'Each item requires reviewed source and justification' USING ERRCODE='22023';END IF;
 END LOOP;
END $$;
ALTER FUNCTION public.acl_evidence_command(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean) RENAME TO acl_evidence_command_checklist_internal;
ALTER FUNCTION public.acl_evidence_read(text,text,text,boolean,uuid,uuid) RENAME TO acl_evidence_read_checklist_internal;
REVOKE ALL ON FUNCTION public.acl_evidence_command_checklist_internal(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean),public.acl_evidence_read_checklist_internal(text,text,text,boolean,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.acl_evidence_command(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_request uuid,p_revision integer,
 p_action text,p_stage text DEFAULT NULL,p_evidence uuid DEFAULT NULL,p_documents text[] DEFAULT NULL,p_note text DEFAULT NULL,p_facts jsonb DEFAULT NULL,p_kind text DEFAULT NULL,p_checked boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;previous public.acl_admission_checklists;value jsonb;payload jsonb;
BEGIN
 PERFORM public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,true,p_action IN ('APPROVE','REJECT','SKIP'));
 PERFORM 1 FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF p_action='SUBMIT' THEN
  value:=p_facts->'checklist';
  PERFORM public.acl_validate_checklist(p_stage,p_kind,value,p_documents);
  payload:=jsonb_build_object('actor',p_actor,'admission',p_id,'revision',p_revision,'stage',p_stage,'kind',p_kind,'documents',p_documents,'note',p_note,'facts',p_facts,'checked',p_checked);
  SELECT * INTO previous FROM public.acl_admission_checklists WHERE organization_id=p_org AND request_id=p_request;
  IF FOUND AND previous.command_payload<>payload THEN RAISE EXCEPTION 'Checklist retry changed' USING ERRCODE='40001';END IF;
 END IF;
 result:=public.acl_evidence_command_checklist_internal(p_org,p_actor,p_role,p_platform,p_id,p_request,p_revision,p_action,p_stage,p_evidence,p_documents,p_note,CASE WHEN p_action='SUBMIT' THEN p_facts-'checklist' ELSE p_facts END,p_kind,p_checked);
 IF p_action='SUBMIT' AND value IS NOT NULL AND result->>'ok'='true' THEN
  INSERT INTO public.acl_admission_checklists(evidence_id,organization_id,admission_id,request_id,template_version,payload,command_payload)
   VALUES((result->>'evidenceId')::uuid,p_org,p_id,p_request,'acl-checklist-v1',value,payload) ON CONFLICT(organization_id,request_id) DO NOTHING;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.acl_evidence_read(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows jsonb;
BEGIN
 rows:=public.acl_evidence_read_checklist_internal(p_org,p_actor,p_role,p_platform,p_id,p_after);
 RETURN (SELECT coalesce(jsonb_agg(v||jsonb_build_object('checklist',(SELECT payload FROM public.acl_admission_checklists WHERE organization_id=p_org AND admission_id=p_id AND evidence_id=(v->>'id')::uuid)) ORDER BY v->>'id'),'[]'::jsonb) FROM jsonb_array_elements(rows) v);
END $$;
REVOKE ALL ON FUNCTION public.acl_checklist_catalog(text,text,text,boolean,uuid),public.acl_validate_checklist(text,text,jsonb,text[]),public.acl_evidence_command(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean),public.acl_evidence_read(text,text,text,boolean,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_checklist_catalog(text,text,text,boolean,uuid),public.acl_evidence_command(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean),public.acl_evidence_read(text,text,text,boolean,uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.acl_closure_command(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_request uuid,p_revision integer,
 p_action text,p_checked boolean,p_conclusion text DEFAULT NULL,p_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE access jsonb;r record;old_event record;perf record;e record;stage jsonb;instant timestamptz;payload jsonb;v jsonb;ev jsonb;body jsonb;digest text;perf_id uuid;mode text;supply date;
BEGIN
 IF p_id IS NULL OR p_request IS NULL OR p_revision IS NULL OR p_revision<1 OR p_checked IS DISTINCT FROM true OR p_action IS NULL OR p_action NOT IN ('CLOSE','PUBLISH')
 OR (p_action='CLOSE' AND (p_conclusion IS NOT NULL OR p_hash IS NOT NULL))
 OR (p_action='PUBLISH' AND (p_conclusion IS NULL OR length(btrim(p_conclusion)) NOT BETWEEN 10 AND 1000 OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$'))
 THEN RAISE EXCEPTION 'Explicit ACL closure review required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('acl-work:'||p_org,0));
 access:=public.acl_evidence_actor(p_org,p_actor,p_role,p_platform,p_id,true,true);
 payload:=jsonb_build_object('admissionId',p_id,'actorId',p_actor,'revision',p_revision,'action',p_action,'checked',p_checked,'conclusion',p_conclusion,'hash',p_hash);
 SELECT * INTO old_event FROM public.acl_admission_events WHERE organization_id=p_org AND request_id=p_request;
 IF FOUND THEN
  IF old_event.request_payload<>payload THEN RAISE EXCEPTION 'ACL request already used' USING ERRCODE='40001';END IF;
  SELECT state INTO v FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id;
  RETURN jsonb_build_object('ok',true,'admission',v,'closure',public.acl_closure_read(p_org,p_actor,p_role,p_platform,p_id),'replayed',true);
 END IF;
 instant:=date_trunc('milliseconds',clock_timestamp());
 PERFORM public.acl_expire_work(p_org,instant);
 SELECT * INTO r FROM public.acl_admissions WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF r.revision<>p_revision THEN RETURN jsonb_build_object('ok',false,'code','CONFLICT');END IF;
 IF instant<r.created_at OR EXISTS(SELECT 1 FROM public.acl_admission_events WHERE organization_id=p_org AND admission_id=p_id AND recorded_at>instant)
 THEN RAISE EXCEPTION 'ACL clock moved backwards' USING ERRCODE='23514';END IF;
 IF p_action='CLOSE' THEN
  IF r.status='COMPLETED' THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
  IF EXISTS(SELECT 1 FROM public.acl_admission_work_sessions WHERE organization_id=p_org AND admission_id=p_id AND ended_at IS NULL)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.state->'stages') x WHERE x->>'status' NOT IN ('COMPLETED','SKIPPED') OR x ? 'active')
  THEN RETURN jsonb_build_object('ok',false,'code','DEPENDENCIES');END IF;
  FOR stage IN SELECT x FROM jsonb_array_elements(r.state->'stages') x LOOP
   SELECT evidence.*,review.decision INTO e FROM public.acl_admission_evidence evidence
    JOIN public.acl_admission_evidence_reviews review ON review.organization_id=evidence.organization_id AND review.evidence_id=evidence.id
    WHERE evidence.organization_id=p_org AND evidence.admission_id=p_id AND evidence.id::text=stage->>'evidenceRef'
      AND evidence.stage_key=stage->>'key' AND review.decision='APPROVED'
      AND evidence.kind=CASE WHEN stage->>'status'='SKIPPED' THEN 'SKIP' ELSE 'COMPLETE' END;
   IF NOT FOUND THEN RAISE EXCEPTION 'Approved stage evidence required for closure' USING ERRCODE='22023';END IF;
   PERFORM public.acl_check_evidence_sources(p_org,e.id);
   IF stage->>'key'='modality' THEN
    mode:=e.facts->>'modality';IF stage->>'modality' IS DISTINCT FROM mode THEN RAISE EXCEPTION 'Modality evidence mismatch' USING ERRCODE='23514';END IF;
   END IF;
   IF stage->>'key'='supply' THEN
    supply:=(e.facts->>'supplyDate')::date;IF stage->>'supplyDate' IS DISTINCT FROM supply::text THEN RAISE EXCEPTION 'Supply evidence mismatch' USING ERRCODE='23514';END IF;
   END IF;
  END LOOP;
  IF mode IS NULL OR mode NOT IN ('RETAIL','OWN_AGENT') OR supply IS NULL THEN RAISE EXCEPTION 'Confirmed modality and supply required' USING ERRCODE='22023';END IF;
  ev:=jsonb_build_object('revision',r.revision+1,'requestId',p_request,'action','CLOSE','actorId',p_actor,'actorName',access->>'actorName','at',floor(extract(epoch FROM instant)*1000)::bigint);
  v:=r.state||jsonb_build_object('status','COMPLETED','revision',r.revision+1,'closedAt',instant,'events',(r.state->'events')||jsonb_build_array(ev));
  body:=jsonb_build_object('schemaVersion','acl-performance/2','hashFormat','postgres-jsonb-text-utf8-sha256','organizationId',p_org,'admissionId',p_id,
   'customerId',r.customer_id,'unitId',r.consumer_unit_id,'processRevision',r.revision+1,'closedAt',instant,'closedBy',p_actor,'closedByName',access->>'actorName',
   'modality',mode,'supplyDate',supply,'stages',r.state->'stages','events',v->'events',
   'sessions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'stageKey',s.stage_key,'actorId',s.actor_id,'startedAt',s.started_at,'endedAt',s.ended_at,'reason',s.reason) ORDER BY s.started_at,s.id),'[]'::jsonb) FROM public.acl_admission_work_sessions s WHERE s.organization_id=p_org AND s.admission_id=p_id),
   'evidence',(SELECT jsonb_agg(jsonb_build_object('id',a.id,'stageKey',a.stage_key,'kind',a.kind,'facts',a.facts,'checklist',(SELECT ck.payload FROM public.acl_admission_checklists ck WHERE ck.organization_id=p_org AND ck.evidence_id=a.id),'actorId',a.created_by,'actorName',a.actor_name,'reviewerId',review.reviewed_by,'reviewerName',review.actor_name,'reviewedAt',review.reviewed_at,
     'documents',(SELECT jsonb_agg(jsonb_build_object('id',d.document_id,'hash',d.file_hash,'version',d.catalog_version,'catalogRevision',d.catalog_revision,'type',d.document_type,'month',d.reference_month) ORDER BY d.document_id) FROM public.acl_admission_evidence_documents d WHERE d.organization_id=p_org AND d.evidence_id=a.id)) ORDER BY a.stage_key,a.id)
     FROM public.acl_admission_evidence a JOIN public.acl_admission_evidence_reviews review ON review.organization_id=a.organization_id AND review.evidence_id=a.id
     WHERE a.organization_id=p_org AND a.admission_id=p_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.state->'stages') x WHERE x->>'evidenceRef'=a.id::text)));
  digest:=encode(sha256(convert_to(body::text,'UTF8')),'hex');
  INSERT INTO public.acl_admission_performance_versions(organization_id,admission_id,version,body,payload_hash,created_by,created_at)
   VALUES(p_org,p_id,1,body,digest,p_actor,instant) RETURNING id INTO perf_id;
  UPDATE public.acl_admissions SET state=v,status='COMPLETED',revision=r.revision+1,updated_at=instant WHERE organization_id=p_org AND id=p_id;
 ELSE
  IF r.status<>'COMPLETED' OR EXISTS(SELECT 1 FROM public.acl_admission_public_summaries WHERE organization_id=p_org AND admission_id=p_id)
  THEN RETURN jsonb_build_object('ok',false,'code','LOCKED');END IF;
  SELECT * INTO perf FROM public.acl_admission_performance_versions WHERE organization_id=p_org AND admission_id=p_id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR perf.payload_hash<>p_hash OR perf.payload_hash<>encode(sha256(convert_to(perf.body::text,'UTF8')),'hex')
   OR (perf.body->>'processRevision')::integer<>r.revision THEN RAISE EXCEPTION 'Reviewed performance hash mismatch' USING ERRCODE='22023';END IF;
  INSERT INTO public.acl_admission_public_summaries(organization_id,admission_id,performance_id,modality,supply_date,conclusion,published_by,published_at)
   VALUES(p_org,p_id,perf.id,perf.body->>'modality',(perf.body->>'supplyDate')::date,btrim(p_conclusion),p_actor,instant);
  v:=r.state;
  ev:=jsonb_build_object('revision',r.revision+1,'requestId',p_request,'action','PUBLISH','actorId',p_actor,'actorName',access->>'actorName','performanceId',perf.id,'hash',perf.payload_hash,'at',floor(extract(epoch FROM instant)*1000)::bigint);
 END IF;
 INSERT INTO public.acl_admission_events(organization_id,admission_id,revision,request_id,request_payload,action,actor_id,snapshot,recorded_at)
  VALUES(p_org,p_id,r.revision+1,p_request,payload,p_action,p_actor,ev,instant);
 RETURN jsonb_build_object('ok',true,'admission',v,'closure',public.acl_closure_read(p_org,p_actor,p_role,p_platform,p_id),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.acl_closure_command(text,text,text,boolean,uuid,uuid,integer,text,boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acl_closure_command(text,text,text,boolean,uuid,uuid,integer,text,boolean,text,text) TO service_role;
NOTIFY pgrst,'reload schema';COMMIT;
