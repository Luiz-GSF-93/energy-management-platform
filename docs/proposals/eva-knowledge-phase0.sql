-- DRAFT FOR REVIEW ONLY. Outside automatic migrations. Never execute against the shared database in Phase 0.
-- No existing table/function, vector extension, grant or production data is modified.
BEGIN;
CREATE TABLE public.eva_knowledge_sources (
 id uuid PRIMARY KEY, source_key text NOT NULL UNIQUE CHECK(length(source_key)>0),
 kind text NOT NULL CHECK(kind IN ('OFFICIAL','PRODUCT_GUIDE','SPECIALIST','OPERATIONAL')),
 authority text NOT NULL, discovery_url text, registered_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.eva_knowledge_documents (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES public.eva_knowledge_sources(id), document_key text NOT NULL,
 scope_kind text NOT NULL CHECK(scope_kind IN ('OFFICIAL_PUBLIC','PRODUCT','PLATFORM_INTERNAL','ORGANIZATION','CLIENT_UNIT')),
 organization_id uuid, customer_id uuid, unit_id uuid,
 CHECK((scope_kind IN ('OFFICIAL_PUBLIC','PRODUCT','PLATFORM_INTERNAL') AND organization_id IS NULL AND customer_id IS NULL AND unit_id IS NULL)
 OR (scope_kind='ORGANIZATION' AND organization_id IS NOT NULL AND customer_id IS NULL AND unit_id IS NULL)
 OR (scope_kind='CLIENT_UNIT' AND organization_id IS NOT NULL AND customer_id IS NOT NULL AND unit_id IS NOT NULL)),
 UNIQUE(source_id,document_key), UNIQUE(id,scope_kind)
);
CREATE TABLE public.eva_knowledge_reviews (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES public.eva_knowledge_documents(id), version text NOT NULL,
 document_hash text NOT NULL CHECK(document_hash ~ '^[a-f0-9]{64}$'), content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 author_id uuid NOT NULL, reviewer_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('APPROVE','REJECT','QUARANTINE','RETIRE')),
 justification text NOT NULL CHECK(length(trim(justification))>=10), occurred_at timestamptz NOT NULL DEFAULT now(),
 CHECK(author_id<>reviewer_id)
);
CREATE TABLE public.eva_knowledge_revisions (
 id uuid PRIMARY KEY, document_id uuid NOT NULL, scope_kind text NOT NULL, version text NOT NULL CHECK(length(trim(version))>0),
 document_hash text NOT NULL CHECK(document_hash ~ '^[a-f0-9]{64}$'), content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN ('DRAFT','REVIEWED','PUBLISHED','QUARANTINED','RETIRED')),
 audiences text[] NOT NULL CHECK(cardinality(audiences)>0 AND audiences <@ ARRAY['BACKOFFICE','PORTAL','PLATFORM']::text[]),
 allowed_platform_profiles text[] NOT NULL CHECK(allowed_platform_profiles <@ ARRAY['OWNER','ADMINISTRATOR','FINANCE','SUPPORT']::text[]),
 CHECK(('PLATFORM'=ANY(audiences) AND cardinality(allowed_platform_profiles)>0) OR (NOT ('PLATFORM'=ANY(audiences)) AND cardinality(allowed_platform_profiles)=0)),
 valid_from date NOT NULL, valid_to date CHECK(valid_to IS NULL OR valid_to>valid_from),
 published_at timestamptz, review_id uuid REFERENCES public.eva_knowledge_reviews(id), product_release text,
 section text NOT NULL CHECK(length(trim(section))>0), page integer CHECK(page IS NULL OR page>0), private_storage_ref text,
 required_permissions uuid[] NOT NULL, required_modules text[] NOT NULL,
 FOREIGN KEY(document_id,scope_kind) REFERENCES public.eva_knowledge_documents(id,scope_kind),
 CHECK((status='PUBLISHED' AND published_at IS NOT NULL AND review_id IS NOT NULL) OR (status<>'PUBLISHED' AND published_at IS NULL)),
 CHECK((scope_kind='PRODUCT' AND product_release IS NOT NULL AND length(trim(product_release))>0) OR (scope_kind='PLATFORM_INTERNAL' AND (product_release IS NULL OR length(trim(product_release))>0)) OR (scope_kind NOT IN ('PRODUCT','PLATFORM_INTERNAL') AND product_release IS NULL)),
 CHECK(scope_kind<>'PLATFORM_INTERNAL' OR audiences=ARRAY['PLATFORM']::text[]),
 CHECK(scope_kind<>'ORGANIZATION' OR NOT ('PORTAL'=ANY(audiences))),
 UNIQUE(document_id,version,document_hash)
);
CREATE TABLE public.eva_index_jobs (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL REFERENCES public.eva_knowledge_revisions(id), provider text NOT NULL CHECK(provider IN ('PGVECTOR','AZURE_SEARCH','DETERMINISTIC_GUIDE')),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','QUEUED','RUNNING','SUCCEEDED','FAILED','QUARANTINED')),
 parser_version text NOT NULL, embedding_version text NOT NULL, embedding_dimensions integer CHECK(embedding_dimensions IS NULL OR embedding_dimensions>0),
 index_reference text, idempotency_key text NOT NULL UNIQUE CHECK(length(trim(idempotency_key))>0),
 cost_scope text NOT NULL CHECK(cost_scope IN ('PLATFORM_CORPUS','ORGANIZATION')), organization_id uuid,
 CHECK((cost_scope='PLATFORM_CORPUS' AND organization_id IS NULL) OR (cost_scope='ORGANIZATION' AND organization_id IS NOT NULL)),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), lease_until timestamptz, safe_error_code text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.eva_index_checkpoints (
 job_id uuid NOT NULL REFERENCES public.eva_index_jobs(id), ordinal integer NOT NULL CHECK(ordinal>=0),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'), provider_reference text NOT NULL,
 confirmed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,ordinal)
);
CREATE TABLE public.eva_module_guides (
 id uuid PRIMARY KEY, module_key text NOT NULL, product_release text NOT NULL, audience text NOT NULL CHECK(audience IN ('BACKOFFICE','PORTAL','PLATFORM')),
 revision_id uuid NOT NULL REFERENCES public.eva_knowledge_revisions(id), implementation_state text NOT NULL CHECK(implementation_state IN ('IMPLEMENTED','PARTIAL','CONFIGURATION_REQUIRED','SANDBOX_ONLY','EXTERNAL_BLOCKER','PLANNED','RETIRED')),
 UNIQUE(module_key,product_release,audience)
);
CREATE TABLE public.eva_evaluation_cases (
 id uuid PRIMARY KEY, case_key text NOT NULL UNIQUE, synthetic boolean NOT NULL CHECK(synthetic),
 question text NOT NULL, expected_decision text NOT NULL CHECK(expected_decision IN ('EVIDENCE','REFUSAL','ESCALATION')),
 audience text NOT NULL CHECK(audience IN ('BACKOFFICE','PORTAL','PLATFORM')), corpus_release text NOT NULL,
 expected_revision_ids uuid[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.eva_evaluation_results (
 id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES public.eva_evaluation_cases(id), prompt_version text NOT NULL,
 model_version text NOT NULL, corpus_release text NOT NULL, passed boolean NOT NULL, safe_reason text NOT NULL,
 duration_ms integer NOT NULL CHECK(duration_ms>=0), occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.eva_query_metrics (
 id uuid PRIMARY KEY, organization_id uuid, audience text NOT NULL CHECK(audience IN ('BACKOFFICE','PORTAL','PLATFORM')),
 cost_scope text NOT NULL CHECK(cost_scope IN ('PLATFORM_CORPUS','ORGANIZATION')),
 CHECK((cost_scope='PLATFORM_CORPUS' AND organization_id IS NULL) OR (cost_scope='ORGANIZATION' AND organization_id IS NOT NULL)),
 authorization_ms integer NOT NULL CHECK(authorization_ms>=0), retrieval_ms integer NOT NULL CHECK(retrieval_ms>=0),
 generation_ms integer NOT NULL CHECK(generation_ms>=0), validation_ms integer NOT NULL CHECK(validation_ms>=0),
 input_tokens integer NOT NULL CHECK(input_tokens>=0), output_tokens integer NOT NULL CHECK(output_tokens>=0),
 estimated_usd numeric(18,8) NOT NULL CHECK(estimated_usd>=0), outcome text NOT NULL CHECK(outcome IN ('EVIDENCE','REFUSAL','FAILURE')),
 corpus_release text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
 -- No question, answer, document content, credential or personal identity in this metric.
);
CREATE FUNCTION public.eva_phase0_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'EVA immutable history' USING ERRCODE='55000'; END $$;
CREATE FUNCTION public.eva_phase0_validate_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r public.eva_knowledge_reviews; kind text;
BEGIN
 SELECT s.kind INTO kind FROM public.eva_knowledge_documents d JOIN public.eva_knowledge_sources s ON s.id=d.source_id WHERE d.id=NEW.document_id;
 IF (NEW.scope_kind='OFFICIAL_PUBLIC' AND kind<>'OFFICIAL') OR (NEW.scope_kind='PRODUCT' AND kind<>'PRODUCT_GUIDE') OR (kind='OPERATIONAL' AND NEW.scope_kind NOT IN ('ORGANIZATION','CLIENT_UNIT')) THEN
  RAISE EXCEPTION 'EVA source/scope mismatch' USING ERRCODE='23514';
 END IF;
 IF (kind='PRODUCT_GUIDE' AND (NEW.scope_kind NOT IN ('PRODUCT','PLATFORM_INTERNAL') OR NEW.product_release IS NULL)) OR (kind<>'PRODUCT_GUIDE' AND NEW.product_release IS NOT NULL) THEN
  RAISE EXCEPTION 'EVA guide release mismatch' USING ERRCODE='23514';
 END IF;
 IF NEW.status='PUBLISHED' THEN
  SELECT * INTO r FROM public.eva_knowledge_reviews WHERE id=NEW.review_id;
  IF r.id IS NULL OR r.action<>'APPROVE' OR r.document_id<>NEW.document_id OR r.version<>NEW.version OR r.document_hash<>NEW.document_hash OR r.content_hash<>NEW.content_hash OR r.occurred_at>NEW.published_at THEN
   RAISE EXCEPTION 'EVA approval mismatch' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER eva_revision_provenance BEFORE INSERT ON public.eva_knowledge_revisions FOR EACH ROW EXECUTE FUNCTION public.eva_phase0_validate_revision();
CREATE FUNCTION public.eva_phase0_validate_guide() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r public.eva_knowledge_revisions;
BEGIN
 SELECT * INTO r FROM public.eva_knowledge_revisions WHERE id=NEW.revision_id;
 IF r.product_release IS NULL OR r.product_release<>NEW.product_release OR NOT (NEW.audience=ANY(r.audiences)) THEN
  RAISE EXCEPTION 'EVA guide scope mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER eva_guide_provenance BEFORE INSERT ON public.eva_module_guides FOR EACH ROW EXECUTE FUNCTION public.eva_phase0_validate_guide();
CREATE FUNCTION public.eva_phase0_validate_job_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid;
BEGIN
 SELECT d.organization_id INTO org FROM public.eva_knowledge_revisions r JOIN public.eva_knowledge_documents d ON d.id=r.document_id WHERE r.id=NEW.revision_id;
 IF (org IS NULL AND NEW.cost_scope<>'PLATFORM_CORPUS') OR (org IS NOT NULL AND (NEW.cost_scope<>'ORGANIZATION' OR NEW.organization_id IS DISTINCT FROM org)) THEN
  RAISE EXCEPTION 'EVA job cost scope mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER eva_job_scope BEFORE INSERT OR UPDATE ON public.eva_index_jobs FOR EACH ROW EXECUTE FUNCTION public.eva_phase0_validate_job_scope();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['eva_knowledge_sources','eva_knowledge_documents','eva_knowledge_reviews','eva_knowledge_revisions','eva_index_jobs','eva_index_checkpoints','eva_module_guides','eva_evaluation_cases','eva_evaluation_results','eva_query_metrics'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['eva_knowledge_sources','eva_knowledge_documents','eva_knowledge_reviews','eva_knowledge_revisions','eva_index_checkpoints','eva_module_guides','eva_evaluation_cases','eva_evaluation_results','eva_query_metrics'] LOOP
  EXECUTE format('CREATE TRIGGER eva_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eva_phase0_append_only()',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.eva_phase0_append_only(),public.eva_phase0_validate_revision(),public.eva_phase0_validate_guide(),public.eva_phase0_validate_job_scope() FROM PUBLIC,anon,authenticated,service_role;
-- No runtime role granted. Publishing/quarantine read model, worker transitions, retention,
-- references to tenant tables and external providers require subsequent approved migrations/RPCs.
COMMIT;
