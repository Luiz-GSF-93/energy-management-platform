BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Prefer the excerpt covering more query terms, without changing stored text.
CREATE OR REPLACE FUNCTION public.legal_audit_excerpt(original text,query_text text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE normalized text:=translate(lower(original),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc');
 term text; terms text[]; found integer; candidate integer; start_at integer:=1; covered integer; best integer:=-1;
BEGIN
 SELECT array_agg(DISTINCT value) INTO terms FROM regexp_split_to_table(translate(lower(query_text),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^[:alnum:]]+') value
 WHERE length(value)>=3 AND numnode(plainto_tsquery('portuguese',value))>0;
 FOREACH term IN ARRAY coalesce(terms,ARRAY[]::text[]) LOOP
  found:=strpos(normalized,term);IF found=0 THEN CONTINUE;END IF;
  candidate:=greatest(1,found-120);
  SELECT count(*) INTO covered FROM unnest(terms) t WHERE strpos(substring(normalized FROM candidate FOR 650),t)>0;
  IF covered>best OR covered=best AND candidate<start_at THEN start_at:=candidate;best:=covered;END IF;
 END LOOP;
 RETURN CASE WHEN start_at>1 THEN '… ' ELSE '' END||substring(original FROM start_at FOR 650)||CASE WHEN length(original)>start_at+649 THEN ' …' ELSE '' END;
END$$;
REVOKE ALL ON FUNCTION public.legal_audit_excerpt(text,text) FROM PUBLIC,anon,authenticated;
COMMIT;
