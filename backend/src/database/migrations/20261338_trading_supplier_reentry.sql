BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Supplier invitations remain reusable until their deadline/revocation. OTP and session protections stay in place.
-- Preserve hashes only, scoped to the same supplier contact. No raw links or OTPs are stored.
CREATE TABLE IF NOT EXISTS public.trading_invitation_previous_tokens(
 token_hash text PRIMARY KEY CHECK(token_hash~'^[a-f0-9]{64}$'),invitation_id uuid NOT NULL REFERENCES public.trading_invitations(id),organization_id text NOT NULL,opportunity_id uuid NOT NULL,email text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trading_invitation_previous_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trading_invitation_previous_tokens FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.preserve_trading_supplier_token() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.kind='SUPPLIER' AND NEW.kind='SUPPLIER' AND OLD.organization_id=NEW.organization_id AND OLD.opportunity_id=NEW.opportunity_id AND OLD.email=NEW.email AND OLD.token_hash IS DISTINCT FROM NEW.token_hash AND OLD.state IN('PENDING','RESPONDED','DECLINED') AND OLD.expires_at>now() THEN
  INSERT INTO public.trading_invitation_previous_tokens(token_hash,invitation_id,organization_id,opportunity_id,email,expires_at) VALUES(OLD.token_hash,OLD.id,OLD.organization_id,OLD.opportunity_id,OLD.email,OLD.expires_at) ON CONFLICT(token_hash) DO NOTHING;
 END IF;RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS preserve_supplier_invitation_token ON public.trading_invitations;
CREATE TRIGGER preserve_supplier_invitation_token AFTER UPDATE OF token_hash ON public.trading_invitations FOR EACH ROW EXECUTE FUNCTION public.preserve_trading_supplier_token();
CREATE OR REPLACE FUNCTION public.trading_invitation_token_id(p_hash text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN count(*)=1 THEN (array_agg(candidate.id))[1] ELSE NULL END FROM(
  SELECT i.id FROM public.trading_invitations i WHERE i.token_hash=p_hash AND p_hash~'^[a-f0-9]{64}$'
  UNION
  SELECT i.id FROM public.trading_invitation_previous_tokens a JOIN public.trading_invitations i ON i.id=a.invitation_id AND i.organization_id=a.organization_id AND i.opportunity_id=a.opportunity_id AND i.email=a.email AND i.kind='SUPPLIER' WHERE a.token_hash=p_hash AND a.expires_at>now() AND p_hash~'^[a-f0-9]{64}$'
 )candidate
$$;
CREATE OR REPLACE FUNCTION public.trading_invitation_for_token(p_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT to_jsonb(i) FROM public.trading_invitations i WHERE i.id=public.trading_invitation_token_id(p_hash)
$$;
REVOKE ALL ON FUNCTION public.preserve_trading_supplier_token(),public.trading_invitation_token_id(text),public.trading_invitation_for_token(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.trading_invitation_for_token(text) TO service_role;
CREATE OR REPLACE FUNCTION public.trading_otp_challenge(p_hash text,p_otp text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


DECLARE i public.trading_invitations;


BEGIN


 SELECT * INTO i FROM public.trading_invitations WHERE id=public.trading_invitation_token_id(p_hash) FOR UPDATE;


 IF NOT FOUND OR NOT(i.state='PENDING' OR i.kind='SUPPLIER' AND i.state IN('RESPONDED','DECLINED')) OR i.expires_at<=now() OR NOT public.trading_license_active(i.organization_id) OR NOT public.trading_quote_is_live(i.organization_id,i.opportunity_id) OR (i.otp_day=CURRENT_DATE AND i.otp_day_count>=10) OR i.otp_sent_at>now()-interval '60 seconds' THEN RETURN false;END IF;


 UPDATE public.trading_invitations SET otp_day=CURRENT_DATE,otp_day_count=CASE WHEN otp_day=CURRENT_DATE THEN otp_day_count+1 ELSE 1 END,otp_hash=p_otp,otp_expires_at=least(expires_at,now()+interval '10 minutes'),otp_sent_at=now(),otp_attempts=0,session_hash=NULL,session_expires_at=NULL WHERE id=i.id;


 INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(i.organization_id,i.id,'OTP_REQUESTED',i.email,'{}');RETURN true;


END $$;


CREATE OR REPLACE FUNCTION public.trading_otp_verify(p_hash text,p_otp text,p_session text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


DECLARE i public.trading_invitations;


BEGIN


 SELECT * INTO i FROM public.trading_invitations WHERE id=public.trading_invitation_token_id(p_hash) FOR UPDATE;


 IF NOT FOUND OR NOT(i.state='PENDING' OR i.kind='SUPPLIER' AND i.state IN('RESPONDED','DECLINED')) OR i.expires_at<=now() OR i.otp_expires_at<=now() OR i.otp_hash IS NULL OR i.otp_attempts>=5 OR NOT public.trading_license_active(i.organization_id) OR NOT public.trading_quote_is_live(i.organization_id,i.opportunity_id) THEN RETURN false;END IF;


 UPDATE public.trading_invitations SET otp_attempts=otp_attempts+1 WHERE id=i.id;


 IF i.otp_hash<>p_otp THEN RETURN false;END IF;


 UPDATE public.trading_invitations SET session_hash=p_session,session_expires_at=least(expires_at,now()+interval '1 hour'),otp_hash=NULL WHERE id=i.id;


 INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(i.organization_id,i.id,'EMAIL_VERIFIED',i.email,'{}');RETURN true;


END $$;


REVOKE ALL ON FUNCTION public.trading_otp_challenge(text,text),public.trading_otp_verify(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trading_otp_challenge(text,text),public.trading_otp_verify(text,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.revoke_trading_invitation(p_org text,p_actor text,p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$


DECLARE i public.trading_invitations;


BEGIN


 PERFORM public.assert_trading_actor(p_org,p_actor,true);


 UPDATE public.trading_invitations SET state='REVOKED',session_hash=NULL,session_expires_at=NULL,otp_hash=NULL WHERE id=p_id AND organization_id=p_org AND(state='PENDING' OR kind='SUPPLIER' AND state IN('RESPONDED','DECLINED')) RETURNING * INTO i;


 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable for revocation' USING ERRCODE='22023';END IF;


 INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(p_org,i.id,'REVOKED',i.email,jsonb_build_object('actor',p_actor));RETURN true;


END $$;
REVOKE ALL ON FUNCTION public.revoke_trading_invitation(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_trading_invitation(text,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
