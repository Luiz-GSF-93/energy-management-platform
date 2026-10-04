-- Management tags never change OCR, signatures, financial approval or client visibility.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.document_catalog_versions(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.document_catalog_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_catalog_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.document_catalog_versions TO service_role;
ALTER TABLE public.documents ADD COLUMN catalog_previous_id text REFERENCES public.documents(id);
CREATE TABLE public.document_catalog (
 document_id text PRIMARY KEY REFERENCES public.documents(id),organization_id text NOT NULL REFERENCES public.organizations(id),
 series_id text NOT NULL REFERENCES public.documents(id),previous_id text REFERENCES public.documents(id),version integer NOT NULL CHECK(version>0),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 tag text NOT NULL DEFAULT 'DRAFT' CHECK(tag IN ('DRAFT','APPROVED','MODEL','SIGNING','RELEASED','OBSOLETE','REVIEWED')),
 reason text NOT NULL,actor_id text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,series_id,version)
);
CREATE TABLE public.document_catalog_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,document_id text NOT NULL REFERENCES public.documents(id),revision integer NOT NULL,actor_id text NOT NULL,reason text NOT NULL,snapshot jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),UNIQUE(document_id,revision));
CREATE TABLE public.document_favorites(organization_id text NOT NULL,document_id text NOT NULL REFERENCES public.documents(id),actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,document_id,actor_id));
ALTER TABLE public.document_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_catalog_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_favorites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_catalog,public.document_catalog_events,public.document_favorites FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.document_catalog,public.document_catalog_events,public.document_favorites TO service_role;
CREATE FUNCTION public.assert_document_catalog_actor(p_org text,p_actor text,p_write boolean,p_approval boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE role_name text;permissions jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE) AND document_management) THEN RAISE EXCEPTION 'Document license required' USING ERRCODE='P2071';END IF;
 IF EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL) THEN RETURN;END IF;
 SELECT r.name,r.permissions INTO role_name,permissions FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal';
 IF role_name IS NULL OR role_name NOT IN ('operacional','gestor','admin_org') OR NOT coalesce(permissions ? '8f105b02-4443-49de-b188-847e0284e7ed',false) OR (p_write AND NOT coalesce(permissions ? '613b71d0-67db-4761-9e11-61fdf63ac8d5',false)) OR (p_approval AND role_name NOT IN ('gestor','admin_org')) THEN RAISE EXCEPTION 'Document profile unavailable' USING ERRCODE='P2071';END IF;
END $$;
CREATE FUNCTION public.audit_document_catalog() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preserve document history' USING ERRCODE='P2072';END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['tag','revision','reason','actor_id','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['tag','revision','reason','actor_id','updated_at']) THEN RAISE EXCEPTION 'Immutable version binding' USING ERRCODE='P2072';END IF;
 NEW.updated_at:=now();
 IF TG_OP='UPDATE' THEN NEW.revision:=OLD.revision+1;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_document_catalog BEFORE UPDATE OR DELETE ON public.document_catalog FOR EACH ROW EXECUTE FUNCTION public.audit_document_catalog();
CREATE FUNCTION public.record_document_catalog_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN INSERT INTO public.document_catalog_events(organization_id,document_id,revision,actor_id,reason,snapshot) VALUES(NEW.organization_id,NEW.document_id,NEW.revision,NEW.actor_id,NEW.reason,to_jsonb(NEW));RETURN NULL;END $$;
CREATE TRIGGER record_document_catalog_event AFTER INSERT OR UPDATE ON public.document_catalog FOR EACH ROW EXECUTE FUNCTION public.record_document_catalog_event();
CREATE TRIGGER preserve_document_catalog_event BEFORE UPDATE OR DELETE ON public.document_catalog_events FOR EACH ROW EXECUTE FUNCTION public.preserve_operation_history();
INSERT INTO public.document_catalog(document_id,organization_id,series_id,version,tag,reason,actor_id) SELECT id,organization_id,id,1,'DRAFT','Importação de cadastro existente; não comprova aprovação ou assinatura.',coalesce(uploaded_by_auth_user_id::text,'legacy-import') FROM public.documents;
CREATE FUNCTION public.register_document_catalog() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.documents%ROWTYPE;c public.document_catalog%ROWTYPE;n integer;
BEGIN
 IF NEW.catalog_previous_id IS NULL THEN INSERT INTO public.document_catalog(document_id,organization_id,series_id,version,tag,reason,actor_id) VALUES(NEW.id,NEW.organization_id,NEW.id,1,'DRAFT','Arquivo recebido; aguarda classificação e conferência.',NEW.uploaded_by_auth_user_id::text);RETURN NULL;END IF;
 SELECT * INTO p FROM public.documents WHERE id=NEW.catalog_previous_id AND organization_id=NEW.organization_id AND customer_id=NEW.customer_id AND consumer_unit_id=NEW.consumer_unit_id AND reference_month=NEW.reference_month AND document_type=NEW.document_type AND file_verified;
 IF NOT FOUND OR p.id=NEW.id THEN RAISE EXCEPTION 'Invalid previous document scope' USING ERRCODE='P2072';END IF;
 SELECT * INTO c FROM public.document_catalog WHERE document_id=p.id AND organization_id=NEW.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Previous catalog unavailable' USING ERRCODE='P2072';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id||':'||c.series_id,207));
 SELECT max(version) INTO n FROM public.document_catalog WHERE organization_id=NEW.organization_id AND series_id=c.series_id;
 IF c.version<>n THEN RAISE EXCEPTION 'Use latest document version' USING ERRCODE='P2072';END IF;
 INSERT INTO public.document_catalog(document_id,organization_id,series_id,previous_id,version,tag,reason,actor_id) VALUES(NEW.id,NEW.organization_id,c.series_id,p.id,n+1,'REVIEWED','Nova versão recebida; arquivo anterior e suas aprovações preservados.',NEW.uploaded_by_auth_user_id::text);
 RETURN NULL;
END $$;
CREATE TRIGGER register_document_catalog AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.register_document_catalog();
CREATE FUNCTION public.save_document_catalog(p_org text,p_actor text,p_document text,p_revision integer,p_tag text,p_reason text,p_checked boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.document_catalog%ROWTYPE;d public.documents%ROWTYPE;
BEGIN
 PERFORM public.assert_document_catalog_actor(p_org,p_actor,true,p_tag IN ('APPROVED','RELEASED'));
 IF p_tag NOT IN ('DRAFT','APPROVED','MODEL','SIGNING','RELEASED','OBSOLETE','REVIEWED') OR length(btrim(p_reason)) NOT BETWEEN 20 AND 1000 OR p_checked IS DISTINCT FROM true THEN RAISE EXCEPTION 'Review and justification required' USING ERRCODE='P2071';END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_document AND organization_id=p_org AND file_verified;
 IF NOT FOUND THEN RAISE EXCEPTION 'Verified private file required' USING ERRCODE='P2073';END IF;
 SELECT * INTO c FROM public.document_catalog WHERE organization_id=p_org AND document_id=p_document FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Catalog unavailable' USING ERRCODE='P2073';END IF;
 IF c.tag IN ('APPROVED','RELEASED') THEN PERFORM public.assert_document_catalog_actor(p_org,p_actor,true,true);END IF;
 IF c.revision<>p_revision THEN RAISE EXCEPTION 'Catalog changed' USING ERRCODE='P2072';END IF;
 UPDATE public.document_catalog SET tag=p_tag,reason=btrim(p_reason),actor_id=p_actor WHERE organization_id=p_org AND document_id=p_document RETURNING * INTO c;
 RETURN to_jsonb(c);
END $$;
CREATE FUNCTION public.favorite_document(p_org text,p_actor text,p_document text,p_favorite boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.assert_document_catalog_actor(p_org,p_actor,false);
 IF p_favorite IS NULL OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=p_document AND organization_id=p_org) THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='P2073';END IF;
 IF p_favorite THEN INSERT INTO public.document_favorites(organization_id,document_id,actor_id) VALUES(p_org,p_document,p_actor) ON CONFLICT DO NOTHING;ELSE DELETE FROM public.document_favorites WHERE organization_id=p_org AND document_id=p_document AND actor_id=p_actor;END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_document_catalog_actor(text,text,boolean,boolean),public.audit_document_catalog(),public.record_document_catalog_event(),public.register_document_catalog(),public.save_document_catalog(text,text,text,integer,text,text,boolean),public.favorite_document(text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_document_catalog(text,text,text,integer,text,text,boolean),public.favorite_document(text,text,text,boolean) TO service_role;
INSERT INTO public.document_catalog_versions(version) VALUES('20261004_f3_7_document_catalog');
NOTIFY pgrst,'reload schema';
COMMIT;
