BEGIN;
SET LOCAL lock_timeout='5s';
-- Government source verification: gov.br/aneel/pt-br/centrais-de-conteudos/legislacao
-- links Leis.org's ANEEL institutional repository. Other institutions stay excluded.
DO $$
DECLARE prior text; matches integer;
BEGIN
 SELECT count(*),min(conname::text) INTO matches,prior FROM pg_constraint
 WHERE conrelid='public.bot_energy_knowledge_versions'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%official_url%' AND pg_get_constraintdef(oid) LIKE '%authority%';
 IF matches<>1 THEN RAISE EXCEPTION 'Expected exactly one official source constraint'; END IF;
 EXECUTE format('ALTER TABLE public.bot_energy_knowledge_versions DROP CONSTRAINT %I',prior);
END $$;
ALTER TABLE public.bot_energy_knowledge_versions ADD CONSTRAINT bot_energy_official_source CHECK (
 (authority='ANEEL' AND (
  official_url ~ '^https://(www2?\.)?aneel\.gov\.br/' OR
  official_url ~ '^https://git\.aneel\.gov\.br/publico/' OR
  official_url ~ '^https://biblioteca\.aneel\.gov\.br/' OR
  official_url ~ '^https://www\.gov\.br/aneel/' OR
  official_url ~ '^https://leis\.org/(aneel|institucionais/br/aneel)/lei/[^/?#]+/[0-9]{4}/[0-9]+/[^/?#]+$')) OR
 (authority='PLANALTO' AND official_url ~ '^https://(www\.)?planalto\.gov\.br/') OR
 (authority='CCEE' AND official_url ~ '^https://(www\.)?ccee\.org\.br/') OR
 (authority='ONS' AND official_url ~ '^https://(www\.|ecmservice\.|proxyportais\.)?ons\.org\.br/'));
NOTIFY pgrst,'reload schema';
COMMIT;
