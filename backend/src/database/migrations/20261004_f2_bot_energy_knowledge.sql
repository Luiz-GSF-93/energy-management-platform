-- DRAFT: not applied. Requires live catalog preflight and deployment of the embedding model.
-- Public regulatory corpus only. No invoices, customer contracts or calculated results here.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
-- Fail rather than moving an existing extension or changing unrelated schemas.
DO $$ BEGIN
 IF to_regtype('extensions.vector') IS NULL THEN
  RAISE EXCEPTION 'Verify existing vector extension schema before applying this migration';
 END IF;
END $$;

CREATE TABLE public.bot_energy_knowledge_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_key text NOT NULL CHECK (length(btrim(document_key)) BETWEEN 1 AND 200),
 family text NOT NULL CHECK (family IN ('ANEEL_RULES','REN_1000','REN_1059','LAW_14300','PRODIST','CCEE_PROCEDURES','ONS_PROCEDURES')),
 authority text NOT NULL CHECK (authority IN ('ANEEL','PLANALTO','CCEE','ONS')),
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 500),
 version text NOT NULL CHECK (length(btrim(version)) BETWEEN 1 AND 200),
 official_url text NOT NULL CHECK (length(official_url)<=2000),
 document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
 published_at date,
 valid_from date NOT NULL,
 valid_to date,
 status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','REVIEWED','QUARANTINED')),
 markets text[] NOT NULL CHECK (cardinality(markets) BETWEEN 1 AND 4 AND markets <@ ARRAY['COMMON','ACL','ACR','GD']::text[]),
 fetched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 verified_at timestamptz,
 reviewed_by text,
 created_by text NOT NULL CHECK (length(btrim(created_by))>0),
 CHECK (valid_to IS NULL OR valid_to>valid_from),
 CHECK (status<>'REVIEWED' OR (verified_at IS NOT NULL AND reviewed_by IS NOT NULL AND length(btrim(reviewed_by))>0)),
 CHECK ((authority='ANEEL' AND family IN ('ANEEL_RULES','REN_1000','REN_1059','PRODIST')) OR
        (authority='PLANALTO' AND family='LAW_14300') OR
        (authority='CCEE' AND family='CCEE_PROCEDURES') OR
        (authority='ONS' AND family='ONS_PROCEDURES')),
 CHECK ((authority='ANEEL' AND official_url ~ '^https://(www2?\.)?aneel\.gov\.br/' OR
         authority='ANEEL' AND official_url ~ '^https://git\.aneel\.gov\.br/publico/' OR
         authority='ANEEL' AND official_url ~ '^https://biblioteca\.aneel\.gov\.br/' OR
         authority='ANEEL' AND official_url ~ '^https://www\.gov\.br/aneel/') OR
        (authority='PLANALTO' AND official_url ~ '^https://(www\.)?planalto\.gov\.br/') OR
        (authority='CCEE' AND official_url ~ '^https://(www\.)?ccee\.org\.br/') OR
        (authority='ONS' AND official_url ~ '^https://(www\.|ecmservice\.|proxyportais\.)?ons\.org\.br/')),
 UNIQUE(document_key,version,document_hash)
);

CREATE TABLE public.bot_energy_knowledge_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 version_id uuid NOT NULL REFERENCES public.bot_energy_knowledge_versions(id),
 ordinal integer NOT NULL CHECK (ordinal>=0),
 section text NOT NULL CHECK (length(btrim(section)) BETWEEN 1 AND 500),
 page integer CHECK (page>0),
 content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 6000),
 content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
 embedding_model text NOT NULL CHECK (length(btrim(embedding_model)) BETWEEN 1 AND 200),
 embedding_version text NOT NULL CHECK (length(btrim(embedding_version)) BETWEEN 1 AND 100),
 embedding extensions.vector(1536) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (content_hash=encode(sha256(convert_to(content,'UTF8')),'hex')),
 CHECK (extensions.vector_norm(embedding)>0),
 UNIQUE(version_id,ordinal,embedding_model,embedding_version)
);
CREATE INDEX bot_energy_knowledge_version_scope ON public.bot_energy_knowledge_versions(status,valid_from,valid_to);
CREATE INDEX bot_energy_knowledge_chunk_revision ON public.bot_energy_knowledge_chunks(version_id,embedding_model,embedding_version);

-- Exact search for the initial corpus. A future ANN index must preserve date/market filters.
-- Return revisions overlapping the period, not only covering it: the server rejects
-- transitions/conflicting revisions rather than silently using a partially applicable rule.
CREATE FUNCTION public.search_bot_energy_knowledge(
 p_embedding extensions.vector(1536),p_period_start date,p_period_end date,
 p_market text,p_embedding_model text,p_embedding_version text
) RETURNS TABLE (
 id uuid,document_id text,family text,authority text,title text,official_url text,
 version text,section text,page integer,content text,content_hash text,document_hash text,
 valid_from date,valid_to date,verified_at timestamptz,reviewed_by text,status text,
 markets text[],similarity double precision,embedding_model text,embedding_version text
) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,extensions AS $$
BEGIN
 IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_start>p_period_end
 OR p_market IS NULL OR p_market NOT IN ('COMMON','ACL','ACR','GD')
 OR p_embedding IS NULL OR extensions.vector_dims(p_embedding)<>1536
 OR extensions.vector_norm(p_embedding)<=0 OR p_embedding_model IS NULL OR length(btrim(p_embedding_model))=0
 OR p_embedding_version IS NULL OR length(btrim(p_embedding_version))=0 THEN
  RAISE EXCEPTION 'Invalid regulatory knowledge query' USING ERRCODE='22023';
 END IF;
 -- Check version ambiguity before ranking/limiting, including low-similarity revisions.
 IF EXISTS(SELECT 1 FROM public.bot_energy_knowledge_versions d
 WHERE d.status='REVIEWED' AND d.valid_from<=p_period_end AND (d.valid_to IS NULL OR d.valid_to>p_period_start)
 AND (p_market=ANY(d.markets) OR 'COMMON'=ANY(d.markets))
 AND (d.valid_from>p_period_start OR d.valid_to<=p_period_end))
 OR EXISTS(SELECT 1 FROM public.bot_energy_knowledge_versions d
 WHERE d.status='REVIEWED' AND d.valid_from<=p_period_end AND (d.valid_to IS NULL OR d.valid_to>p_period_start)
 AND (p_market=ANY(d.markets) OR 'COMMON'=ANY(d.markets)) GROUP BY d.document_key HAVING count(*)>1) THEN
 RAISE EXCEPTION 'Conflicting regulatory validity' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 SELECT c.id,d.document_key,d.family,d.authority,d.title,d.official_url,
 d.version,c.section,c.page,c.content,c.content_hash,d.document_hash,
 d.valid_from,d.valid_to,d.verified_at,d.reviewed_by,d.status,d.markets,
 1-(c.embedding OPERATOR(extensions.<=>) p_embedding),c.embedding_model,c.embedding_version
 FROM public.bot_energy_knowledge_chunks c
 JOIN public.bot_energy_knowledge_versions d ON d.id=c.version_id
 WHERE d.status='REVIEWED' AND d.valid_from<=p_period_end
 AND (d.valid_to IS NULL OR d.valid_to>p_period_start)
 AND (p_market=ANY(d.markets) OR 'COMMON'=ANY(d.markets))
 AND c.embedding_model=p_embedding_model AND c.embedding_version=p_embedding_version
 AND 1-(c.embedding OPERATOR(extensions.<=>) p_embedding)>=0.72
 ORDER BY c.embedding OPERATOR(extensions.<=>) p_embedding,c.id
 LIMIT 30;
END $$;

ALTER TABLE public.bot_energy_knowledge_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_energy_knowledge_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_energy_knowledge_versions,public.bot_energy_knowledge_chunks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.bot_energy_knowledge_versions TO service_role;
GRANT SELECT,INSERT ON public.bot_energy_knowledge_chunks TO service_role;
REVOKE ALL ON FUNCTION public.search_bot_energy_knowledge(extensions.vector,date,date,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_bot_energy_knowledge(extensions.vector,date,date,text,text,text) TO service_role;
COMMENT ON TABLE public.bot_energy_knowledge_versions IS 'Official public regulatory corpus. Reviewed revisions require verified provenance and applicability; no private customer material.';
COMMENT ON TABLE public.bot_energy_knowledge_chunks IS 'Regulatory excerpts and embeddings only. Immutable chunks; reindex as a new revision/model. Never financial truth or approval.';
NOTIFY pgrst,'reload schema';
COMMIT;
