BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Admission of public official files only. Registration is not normative review/publication.
CREATE FUNCTION public.eva_legal_official_family(authority text,family text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce((authority='ANEEL' AND family IN('ANEEL_RULES','PRORET','PRODIST')) OR(authority='PLANALTO' AND family='LEGISLATION') OR(authority='CCEE' AND family IN('CCEE_RULES','CCEE_PROCEDURES')) OR(authority='ONS' AND family IN('ONS_PROCEDURES','ONS_REPORTS')) OR(authority='MME' AND family='MME_LEGISLATION') OR(authority='CNPE' AND family='CNPE_RESOLUTIONS') OR(authority='EPE' AND family='ENERGY_PLANNING') OR(authority='DOU' AND family='OFFICIAL_GAZETTE') OR(authority='DISTRIBUTOR' AND family='DISTRIBUTOR_DOCUMENTS'),false)
$$;
CREATE FUNCTION public.eva_legal_official_url(authority text,origin text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 WITH u AS(SELECT split_part(substring(origin FROM 9),'/',1) host)
 SELECT coalesce(origin ~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^?#[:space:]]*)?$' AND CASE authority
 WHEN 'ANEEL' THEN host IN('www.aneel.gov.br','www2.aneel.gov.br','biblioteca.aneel.gov.br','git.aneel.gov.br','legislacao.aneel.gov.br') OR(host='www.gov.br' AND origin LIKE 'https://www.gov.br/aneel/%')
 WHEN 'PLANALTO' THEN host IN('www.planalto.gov.br','planalto.gov.br','www2.camara.leg.br','www.camara.leg.br','camara.leg.br','legis.senado.gov.br','bibliotecadigital.mj.gov.br')
 WHEN 'CCEE' THEN host IN('www.ccee.org.br','ccee.org.br')
 WHEN 'ONS' THEN host IN('www.ons.org.br','ons.org.br','ecmservice.ons.org.br','proxyportais.ons.org.br')
 WHEN 'MME' THEN host='www.gov.br' AND origin LIKE 'https://www.gov.br/mme/%'
 WHEN 'CNPE' THEN host='www.gov.br' AND origin LIKE 'https://www.gov.br/mme/%'
 WHEN 'EPE' THEN host IN('www.epe.gov.br','epe.gov.br')
 WHEN 'DOU' THEN host IN('www.in.gov.br','in.gov.br','pesquisa.in.gov.br')
 ELSE false END,false) FROM u
$$;
REVOKE ALL ON FUNCTION public.eva_legal_official_family(text,text),public.eva_legal_official_url(text,text) FROM PUBLIC,anon,authenticated,service_role;
DO $patch_source$
DECLARE d text;old text;replacement text;BEGIN
 d:=pg_get_functiondef('public.eva_official_source_action(uuid,text,uuid,jsonb)'::regprocedure);
 IF md5(d)<>'78d9f690f667226e29c5076631da3fc4' THEN RAISE EXCEPTION 'Review current eva_official_source_action before official admission';END IF;
 old:=$old_source_family$IF NOT ((authority='ANEEL' AND family IN ('ANEEL_RULES','PRORET','PRODIST')) OR (authority='PLANALTO' AND family='LEGISLATION') OR (authority='CCEE' AND family IN ('CCEE_RULES','CCEE_PROCEDURES')) OR (authority='ONS' AND family='ONS_PROCEDURES') OR (authority='DISTRIBUTOR' AND family='DISTRIBUTOR_DOCUMENTS')) THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='22023';END IF;$old_source_family$;replacement:=$new_source_family$IF NOT public.eva_legal_official_family(authority,family) THEN RAISE EXCEPTION 'Invalid authority' USING ERRCODE='22023';END IF;$new_source_family$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Official admission predicate changed';END IF;d:=replace(d,old,replacement);
 old:=$old_source_origin$IF host ~ '(\.local|\.internal)$' OR (authority='ANEEL' AND NOT(host IN ('www.aneel.gov.br','www2.aneel.gov.br','biblioteca.aneel.gov.br','git.aneel.gov.br') OR host='www.gov.br' AND origin LIKE 'https://www.gov.br/aneel/%')) OR (authority='PLANALTO' AND host NOT IN ('www.planalto.gov.br','planalto.gov.br')) OR (authority='CCEE' AND host NOT IN ('www.ccee.org.br','ccee.org.br')) OR (authority='ONS' AND host NOT IN ('www.ons.org.br','ons.org.br','ecmservice.ons.org.br','proxyportais.ons.org.br')) THEN RAISE EXCEPTION 'Invalid origin' USING ERRCODE='22023';END IF;$old_source_origin$;replacement:=$new_source_origin$IF host ~ '(\.local|\.internal)$' OR (authority<>'DISTRIBUTOR' AND NOT public.eva_legal_official_url(authority,origin)) THEN RAISE EXCEPTION 'Invalid origin' USING ERRCODE='22023';END IF;$new_source_origin$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Official admission predicate changed';END IF;d:=replace(d,old,replacement);
 old:=$filters$('','ANEEL','PLANALTO','CCEE','ONS','DISTRIBUTOR')$filters$;replacement:=$filters$('','ANEEL','PLANALTO','CCEE','ONS','MME','CNPE','EPE','DOU','DISTRIBUTOR')$filters$;IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Official filter list changed';END IF;d:=replace(d,old,replacement);
 old:=$filters$('','ANEEL_RULES','PRORET','PRODIST','LEGISLATION','CCEE_RULES','CCEE_PROCEDURES','ONS_PROCEDURES','DISTRIBUTOR_DOCUMENTS')$filters$;replacement:=$filters$('','ANEEL_RULES','PRORET','PRODIST','LEGISLATION','CCEE_RULES','CCEE_PROCEDURES','ONS_PROCEDURES','ONS_REPORTS','MME_LEGISLATION','CNPE_RESOLUTIONS','ENERGY_PLANNING','OFFICIAL_GAZETTE','DISTRIBUTOR_DOCUMENTS')$filters$;IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Official filter list changed';END IF;d:=replace(d,old,replacement);
 EXECUTE d;END $patch_source$;
DO $patch_document$
DECLARE d text;old text;replacement text;BEGIN
 d:=pg_get_functiondef('public.eva_official_document_action(uuid,text,uuid,jsonb)'::regprocedure);
 IF md5(d)<>'dd39dfe9c87dcefa2485f5479c16cf86' THEN RAISE EXCEPTION 'Review current eva_official_document_action before official admission';END IF;
 old:=$old_document_origin$IF NOT ((authority='ANEEL' AND (host IN ('www.aneel.gov.br','www2.aneel.gov.br','biblioteca.aneel.gov.br','git.aneel.gov.br') OR host='www.gov.br' AND origin LIKE 'https://www.gov.br/aneel/%')) OR (authority='PLANALTO' AND host IN ('www.planalto.gov.br','planalto.gov.br')) OR (authority='CCEE' AND host IN ('www.ccee.org.br','ccee.org.br')) OR (authority='ONS' AND host IN ('www.ons.org.br','ons.org.br','ecmservice.ons.org.br','proxyportais.ons.org.br'))) THEN RAISE EXCEPTION 'Origin not institutional' USING ERRCODE='22023';END IF;$old_document_origin$;replacement:=$new_document_origin$IF NOT public.eva_legal_official_url(authority,origin) THEN RAISE EXCEPTION 'Origin not institutional' USING ERRCODE='22023';END IF;$new_document_origin$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Official admission predicate changed';END IF;d:=replace(d,old,replacement);
 EXECUTE d;END $patch_document$;
NOTIFY pgrst,'reload schema';
COMMIT;
