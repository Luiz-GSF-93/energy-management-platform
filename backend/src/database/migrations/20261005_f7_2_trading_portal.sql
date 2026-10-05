BEGIN;


SET LOCAL lock_timeout='5s';


SET LOCAL statement_timeout='30s';


CREATE UNIQUE INDEX trading_supplier_cnpj ON public.trading_records(organization_id,(data->>'cnpj')) WHERE kind='supplier';


CREATE TABLE public.trading_invitations (


 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),opportunity_id uuid NOT NULL REFERENCES public.trading_records(id),supplier_id uuid REFERENCES public.trading_records(id),proposal_id uuid REFERENCES public.trading_records(id),


 kind text NOT NULL CHECK(kind IN ('SUPPLIER','CLIENT')),email text NOT NULL,token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,


 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RESPONDED','DECLINED','APPROVED','REVOKED')),


 email_status text NOT NULL DEFAULT 'PENDING',email_message_id text,


 otp_day date,otp_day_count integer NOT NULL DEFAULT 0,otp_hash text,otp_expires_at timestamptz,otp_attempts integer NOT NULL DEFAULT 0,otp_sent_at timestamptz,


 session_hash text,session_expires_at timestamptz,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),


 CHECK((kind='SUPPLIER' AND supplier_id IS NOT NULL AND proposal_id IS NULL) OR (kind='CLIENT' AND supplier_id IS NULL AND proposal_id IS NOT NULL))


);


CREATE INDEX trading_invite_scope ON public.trading_invitations(organization_id,opportunity_id,email);


CREATE UNIQUE INDEX trading_invite_pending ON public.trading_invitations(organization_id,opportunity_id,email,kind) WHERE state='PENDING';


CREATE TABLE public.trading_files(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,invitation_id uuid NOT NULL REFERENCES public.trading_invitations(id),path text NOT NULL,filename text NOT NULL,sha256 text NOT NULL,size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),created_at timestamptz NOT NULL DEFAULT now());


ALTER TABLE public.trading_files ENABLE ROW LEVEL SECURITY;


REVOKE ALL ON public.trading_files FROM PUBLIC,anon,authenticated;


GRANT SELECT,INSERT ON public.trading_files TO service_role;


ALTER TABLE public.trading_invitations ENABLE ROW LEVEL SECURITY;


REVOKE ALL ON public.trading_invitations FROM PUBLIC,anon,authenticated;


GRANT SELECT,INSERT,UPDATE ON public.trading_invitations TO service_role;


CREATE TABLE public.trading_portal_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL,invitation_id uuid NOT NULL REFERENCES public.trading_invitations(id),action text NOT NULL,identity text NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());


ALTER TABLE public.trading_portal_audit ENABLE ROW LEVEL SECURITY;


REVOKE ALL ON public.trading_portal_audit FROM PUBLIC,anon,authenticated;


GRANT SELECT,INSERT ON public.trading_portal_audit TO service_role;


CREATE TRIGGER preserve_trading_portal_audit BEFORE UPDATE OR DELETE ON public.trading_portal_audit FOR EACH ROW EXECUTE FUNCTION public.preserve_trading_history();


CREATE FUNCTION public.trading_license_active(p_org text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT count(*)=1 AND coalesce(bool_and(trading_hub),false) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND (end_date IS NULL OR end_date>=CURRENT_DATE); $$;


CREATE FUNCTION public.trading_otp_challenge(p_hash text,p_otp text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


DECLARE i public.trading_invitations;


BEGIN


 SELECT * INTO i FROM public.trading_invitations WHERE token_hash=p_hash FOR UPDATE;


 IF NOT FOUND OR i.state<>'PENDING' OR i.expires_at<=now() OR NOT public.trading_license_active(i.organization_id) OR (i.otp_day=CURRENT_DATE AND i.otp_day_count>=10) OR i.otp_sent_at>now()-interval '60 seconds' THEN RETURN false;END IF;


 UPDATE public.trading_invitations SET otp_day=CURRENT_DATE,otp_day_count=CASE WHEN otp_day=CURRENT_DATE THEN otp_day_count+1 ELSE 1 END,otp_hash=p_otp,otp_expires_at=least(expires_at,now()+interval '10 minutes'),otp_sent_at=now(),otp_attempts=0,session_hash=NULL,session_expires_at=NULL WHERE id=i.id;


 INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(i.organization_id,i.id,'OTP_REQUESTED',i.email,'{}');RETURN true;


END $$;


CREATE FUNCTION public.trading_otp_verify(p_hash text,p_otp text,p_session text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


DECLARE i public.trading_invitations;


BEGIN


 SELECT * INTO i FROM public.trading_invitations WHERE token_hash=p_hash FOR UPDATE;


 IF NOT FOUND OR i.state<>'PENDING' OR i.expires_at<=now() OR i.otp_expires_at<=now() OR i.otp_hash IS NULL OR i.otp_attempts>=5 OR NOT public.trading_license_active(i.organization_id) THEN RETURN false;END IF;


 UPDATE public.trading_invitations SET otp_attempts=otp_attempts+1 WHERE id=i.id;


 IF i.otp_hash<>p_otp THEN RETURN false;END IF;


 UPDATE public.trading_invitations SET session_hash=p_session,session_expires_at=least(expires_at,now()+interval '1 hour'),otp_hash=NULL WHERE id=i.id;


 INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(i.organization_id,i.id,'EMAIL_VERIFIED',i.email,'{}');RETURN true;


END $$;


CREATE FUNCTION public.trading_portal_reply(p_session text,p_data jsonb,p_action text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


DECLARE i public.trading_invitations;o public.trading_records;r public.trading_records;


BEGIN


 SELECT * INTO i FROM public.trading_invitations WHERE session_hash=p_session FOR UPDATE;


 IF NOT FOUND OR i.state<>'PENDING' OR i.expires_at<=now() OR i.session_expires_at IS NULL OR i.session_expires_at<=now() OR NOT public.trading_license_active(i.organization_id) THEN RAISE EXCEPTION 'Portal expired or answered' USING ERRCODE='42501';END IF;


 SELECT * INTO o FROM public.trading_records WHERE organization_id=i.organization_id AND id=i.opportunity_id FOR UPDATE;


 IF o.id IS NULL OR o.status NOT IN ('OPEN','ANALYSIS') OR (o.data->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'Opportunity closed' USING ERRCODE='42501';END IF;


 IF i.kind='SUPPLIER' THEN


  IF NOT EXISTS(SELECT 1 FROM public.trading_records WHERE id=i.supplier_id AND organization_id=i.organization_id AND kind='supplier' AND status='ACTIVE') THEN RAISE EXCEPTION 'Supplier inactive' USING ERRCODE='42501';END IF;


  IF p_action='DECLINE' THEN


   IF p_data->>'declineReason' NOT IN ('INSUFFICIENT_VOLUME','REGION','RISK','UNAVAILABLE','OTHER') OR length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Decline needs justification' USING ERRCODE='22023';END IF;


   INSERT INTO public.trading_records(organization_id,kind,parent_id,status,data,created_by,updated_by) VALUES(i.organization_id,'proposal',o.id,'DECLINED',jsonb_build_object('supplierId',i.supplier_id,'declineReason',p_data->>'declineReason','justification',p_reason),i.email,i.email) RETURNING * INTO r;


  ELSIF p_action='RESPOND' THEN


   IF p_data->>'supplierId'<>i.supplier_id::text OR p_data->>'energyType'<>o.data->>'energyType' OR (p_data->>'priceBrlMwh')::numeric<=0 THEN RAISE EXCEPTION 'Proposal differs from invitation' USING ERRCODE='22023';END IF;


   INSERT INTO public.trading_records(organization_id,kind,parent_id,status,data,created_by,updated_by) VALUES(i.organization_id,'proposal',o.id,'RECEIVED',p_data,i.email,i.email) RETURNING * INTO r;


  ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';END IF;


 ELSE


  IF p_action<>'APPROVE' OR length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Client decision needs confirmation' USING ERRCODE='22023';END IF;


  SELECT * INTO r FROM public.trading_records WHERE id=i.proposal_id AND organization_id=i.organization_id AND parent_id=o.id AND status='MANAGER_APPROVED' FOR UPDATE;


  IF NOT FOUND OR coalesce((r.data->>'validUntil')::date<CURRENT_DATE,true) OR NOT EXISTS(SELECT 1 FROM public.trading_records s WHERE s.id=(r.data->>'supplierId')::uuid AND s.organization_id=i.organization_id AND s.kind='supplier' AND s.status='ACTIVE') THEN RAISE EXCEPTION 'Manager approval unavailable' USING ERRCODE='42501';END IF;


  UPDATE public.trading_records SET status='CLIENT_APPROVED',revision=revision+1,updated_by=i.email,updated_at=now() WHERE id=r.id RETURNING * INTO r;


 END IF;


 INSERT INTO public.trading_history(organization_id,record_id,revision,actor_id,action,reason,snapshot) VALUES(i.organization_id,r.id,r.revision,i.email,p_action,CASE WHEN p_action='RESPOND' THEN 'Proposta enviada pelo contato convidado, e-mail verificado' ELSE left(p_reason,500) END,to_jsonb(r));


 UPDATE public.trading_invitations SET state=CASE p_action WHEN 'DECLINE' THEN 'DECLINED' WHEN 'APPROVE' THEN 'APPROVED' ELSE 'RESPONDED' END,session_hash=NULL,session_expires_at=NULL WHERE id=i.id;


 INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(i.organization_id,i.id,p_action,i.email,jsonb_build_object('recordId',r.id,'revision',r.revision));


 RETURN jsonb_build_object('id',r.id,'status',r.status);


END $$;


REVOKE ALL ON FUNCTION public.trading_license_active(text),public.trading_otp_challenge(text,text),public.trading_otp_verify(text,text,text),public.trading_portal_reply(text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;


GRANT EXECUTE ON FUNCTION public.trading_otp_challenge(text,text),public.trading_otp_verify(text,text,text),public.trading_portal_reply(text,jsonb,text,text) TO service_role;


INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('trading-private','trading-private',false,10485760,ARRAY['application/pdf']) ON CONFLICT(id) DO NOTHING;





CREATE FUNCTION public.guard_trading_invitation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


DECLARE o public.trading_records;


BEGIN


 PERFORM public.assert_trading_actor(NEW.organization_id,NEW.created_by,true,NEW.kind='CLIENT');


 SELECT * INTO o FROM public.trading_records WHERE id=NEW.opportunity_id AND organization_id=NEW.organization_id AND kind='opportunity' FOR SHARE;


 IF NOT FOUND OR o.status NOT IN ('OPEN','ANALYSIS') OR NEW.expires_at> (o.data->>'expiresAt')::timestamptz OR NEW.expires_at<=now() OR NEW.token_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid invitation scope' USING ERRCODE='42501';END IF;


 IF NEW.kind='SUPPLIER' THEN


  IF NOT EXISTS(SELECT 1 FROM public.trading_records s CROSS JOIN LATERAL jsonb_array_elements(s.data->'quotationContacts') c WHERE s.id=NEW.supplier_id AND s.organization_id=NEW.organization_id AND s.kind='supplier' AND s.status='ACTIVE' AND lower(c->>'email')=NEW.email) THEN RAISE EXCEPTION 'Contact outside supplier scope' USING ERRCODE='42501';END IF;


 ELSE


  IF NOT EXISTS(SELECT 1 FROM public.trading_records p JOIN public.customers c ON c.id=o.data->>'customerId' AND c.organization_id=NEW.organization_id WHERE p.id=NEW.proposal_id AND p.organization_id=NEW.organization_id AND p.parent_id=o.id AND p.kind='proposal' AND p.status='MANAGER_APPROVED' AND lower(c.contact_email)=NEW.email AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'Client decision outside scope' USING ERRCODE='42501';END IF;


 END IF;


 RETURN NEW;


END $$;


CREATE TRIGGER guard_trading_invitation BEFORE INSERT ON public.trading_invitations FOR EACH ROW EXECUTE FUNCTION public.guard_trading_invitation();


CREATE FUNCTION public.audit_trading_invitation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


BEGIN


 INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(NEW.organization_id,NEW.id,'INVITED',NEW.email,jsonb_build_object('actor',NEW.created_by,'kind',NEW.kind));RETURN NEW;


END $$;


CREATE TRIGGER audit_trading_invitation AFTER INSERT ON public.trading_invitations FOR EACH ROW EXECUTE FUNCTION public.audit_trading_invitation();


CREATE FUNCTION public.revoke_trading_invitation(p_org text,p_actor text,p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


DECLARE i public.trading_invitations;


BEGIN


 PERFORM public.assert_trading_actor(p_org,p_actor,true);


 UPDATE public.trading_invitations SET state='REVOKED',session_hash=NULL,session_expires_at=NULL,otp_hash=NULL WHERE id=p_id AND organization_id=p_org AND state='PENDING' RETURNING * INTO i;


 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not pending' USING ERRCODE='22023';END IF;


 INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(p_org,i.id,'REVOKED',i.email,jsonb_build_object('actor',p_actor));RETURN true;


END $$;


CREATE FUNCTION public.guard_trading_file() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


DECLARE i public.trading_invitations;


BEGIN


 SELECT * INTO i FROM public.trading_invitations WHERE id=NEW.invitation_id FOR UPDATE;


 IF NOT FOUND OR i.organization_id<>NEW.organization_id OR i.kind<>'SUPPLIER' OR i.state<>'PENDING' OR i.expires_at<=now() OR NOT public.trading_license_active(i.organization_id) OR NEW.path NOT LIKE i.organization_id||'/'||i.id::text||'/%' OR NEW.sha256!~'^[a-f0-9]{64}$' OR (SELECT count(*) FROM public.trading_files WHERE invitation_id=i.id)>=10 THEN RAISE EXCEPTION 'Invalid private attachment' USING ERRCODE='42501';END IF;


 RETURN NEW;


END $$;


CREATE TRIGGER guard_trading_file BEFORE INSERT ON public.trading_files FOR EACH ROW EXECUTE FUNCTION public.guard_trading_file();


CREATE FUNCTION public.audit_trading_file() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


BEGIN


 INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) SELECT NEW.organization_id,NEW.invitation_id,'PDF_ATTACHED',email,jsonb_build_object('id',NEW.id,'sha256',NEW.sha256) FROM public.trading_invitations WHERE id=NEW.invitation_id;RETURN NEW;


END $$;


CREATE TRIGGER audit_trading_file AFTER INSERT ON public.trading_files FOR EACH ROW EXECUTE FUNCTION public.audit_trading_file();


REVOKE ALL ON FUNCTION public.guard_trading_invitation(),public.audit_trading_invitation(),public.revoke_trading_invitation(text,text,uuid),public.guard_trading_file(),public.audit_trading_file() FROM PUBLIC,anon,authenticated,service_role;


GRANT EXECUTE ON FUNCTION public.revoke_trading_invitation(text,text,uuid) TO service_role;


DO $$ BEGIN IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='trading-private' AND public) THEN RAISE EXCEPTION 'Trading bucket must be private';END IF;END $$;






CREATE FUNCTION public.contract_trading_proposal(p_org text,p_actor text,p_id uuid,p_revision integer,p_document text,p_reference text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.trading_records;o public.trading_records;
BEGIN
 PERFORM public.assert_trading_actor(p_org,p_actor,true,true);
 SELECT * INTO r FROM public.trading_records WHERE id=p_id AND organization_id=p_org AND kind='proposal' FOR UPDATE;
 IF NOT FOUND OR r.status<>'CLIENT_APPROVED' OR r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Client approval unavailable or changed' USING ERRCODE='P3151';END IF;
 SELECT * INTO o FROM public.trading_records WHERE id=r.parent_id AND organization_id=p_org AND kind='opportunity' FOR UPDATE;
 IF NOT FOUND OR o.status NOT IN ('OPEN','ANALYSIS') OR length(btrim(p_reference)) NOT BETWEEN 3 AND 200 OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=p_document AND organization_id=p_org AND customer_id=o.data->>'customerId' AND consumer_unit_id=o.data->>'unitId' AND file_verified AND storage_bucket='energy-documents-private' AND file_path LIKE p_org||'/%') THEN RAISE EXCEPTION 'Verified contract evidence required' USING ERRCODE='42501';END IF;
 UPDATE public.trading_records SET status='CONTRACTED',revision=revision+1,updated_by=p_actor,updated_at=now(),data=data||jsonb_build_object('contractDocumentId',p_document,'contractReference',p_reference) WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.trading_history(organization_id,record_id,revision,actor_id,action,reason,snapshot) VALUES(p_org,r.id,r.revision,p_actor,'CONTRACTED',p_reason,to_jsonb(r));
 UPDATE public.trading_records SET status='CLOSED',revision=revision+1,updated_by=p_actor,updated_at=now() WHERE id=o.id RETURNING * INTO o;
 INSERT INTO public.trading_history(organization_id,record_id,revision,actor_id,action,reason,snapshot) VALUES(p_org,o.id,o.revision,p_actor,'CLOSED','Cotação encerrada após formalização do contrato',to_jsonb(o));
 UPDATE public.trading_invitations SET state='REVOKED',session_hash=NULL,session_expires_at=NULL,otp_hash=NULL WHERE opportunity_id=o.id AND organization_id=p_org AND state='PENDING';
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.contract_trading_proposal(text,text,uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.contract_trading_proposal(text,text,uuid,integer,text,text,text) TO service_role;


CREATE FUNCTION public.revoke_changed_supplier_invites() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.trading_invitations;
BEGIN
 IF NEW.kind='supplier' AND ((OLD.data->'quotationContacts') IS DISTINCT FROM (NEW.data->'quotationContacts') OR (OLD.status='ACTIVE' AND NEW.status<>'ACTIVE')) THEN
  FOR i IN UPDATE public.trading_invitations SET state='REVOKED',session_hash=NULL,session_expires_at=NULL,otp_hash=NULL WHERE organization_id=NEW.organization_id AND supplier_id=NEW.id AND state='PENDING' RETURNING * LOOP
   INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(i.organization_id,i.id,'CONTACT_CHANGED_REVOKED',i.email,jsonb_build_object('actor',NEW.updated_by));
  END LOOP;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER revoke_changed_supplier_invites AFTER UPDATE ON public.trading_records FOR EACH ROW EXECUTE FUNCTION public.revoke_changed_supplier_invites();
REVOKE ALL ON FUNCTION public.revoke_changed_supplier_invites() FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';


COMMIT;


