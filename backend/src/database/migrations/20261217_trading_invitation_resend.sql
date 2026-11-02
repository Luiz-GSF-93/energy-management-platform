BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.trading_invitations
 ADD COLUMN email_revision integer NOT NULL DEFAULT 0 CHECK(email_revision>=0),
 ADD COLUMN email_request_id uuid,
 ADD COLUMN email_resend_by text,
 ADD COLUMN email_attempt_at timestamptz,
 ADD COLUMN email_http_status integer CHECK(email_http_status BETWEEN 100 AND 599),
 ADD COLUMN email_error_code text CHECK(email_error_code IS NULL OR email_error_code ~ '^[A-Z0-9_]{1,80}$');
CREATE UNIQUE INDEX trading_invitation_resend_request ON public.trading_invitations(organization_id,email_request_id) WHERE email_request_id IS NOT NULL;
CREATE FUNCTION public.resend_trading_invitation(p_org text,p_actor text,p_id uuid,p_request uuid,p_expected integer,p_action text,p_token text,p_reason text,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE i public.trading_invitations;o public.trading_records;r jsonb;resultstate text;code text;http integer;previous jsonb;
BEGIN
 IF p_request IS NULL OR p_expected IS NULL OR p_expected<0 THEN RAISE EXCEPTION 'Invalid resend request' USING ERRCODE='22023';END IF;
 PERFORM public.assert_trading_actor(p_org,p_actor,true);
 SELECT * INTO i FROM public.trading_invitations WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation outside scope' USING ERRCODE='42501';END IF;
 PERFORM public.assert_trading_actor(p_org,p_actor,true,i.kind='CLIENT');
 IF EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.permission_limit IS NOT NULL AND NOT m.permission_limit ? 'beb6ec90-8ba8-40ce-a156-aeef6cc75cce') AND NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Individual permission required' USING ERRCODE='42501';END IF;
 IF p_action='finish' THEN
  IF i.email_request_id IS DISTINCT FROM p_request OR i.email_resend_by IS DISTINCT FROM p_actor OR i.email_revision<>p_expected OR i.email_status<>'SENDING' OR i.state<>'PENDING' THEN RETURN jsonb_build_object('recorded',false);END IF;
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_result) k WHERE k NOT IN ('state','messageId','httpStatus','code')) THEN RAISE EXCEPTION 'Invalid mail result' USING ERRCODE='22023';END IF;
  resultstate:=p_result->>'state';code:=p_result->>'code';http:=(p_result->>'httpStatus')::integer;
  IF resultstate IS NULL OR resultstate NOT IN ('ACCEPTED','REJECTED','UNKNOWN','NOT_CONFIGURED') OR (code IS NOT NULL AND code !~ '^[A-Z0-9_]{1,80}$') OR (http IS NOT NULL AND http NOT BETWEEN 100 AND 599) OR (resultstate='ACCEPTED' AND (nullif(p_result->>'messageId','') IS NULL OR length(p_result->>'messageId')>200)) THEN RAISE EXCEPTION 'Invalid mail outcome' USING ERRCODE='22023';END IF;
  UPDATE public.trading_invitations SET email_status=resultstate,email_message_id=p_result->>'messageId',email_http_status=http,email_error_code=code WHERE id=i.id AND organization_id=p_org;
  INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(p_org,i.id,'RESEND_'||resultstate,i.email,jsonb_build_object('actor',p_actor,'requestId',p_request,'revision',p_expected,'messageId',p_result->>'messageId','httpStatus',http,'code',code));
  RETURN jsonb_build_object('recorded',true,'state',resultstate);
 ELSIF p_action IS DISTINCT FROM 'reserve' THEN RAISE EXCEPTION 'Invalid resend action' USING ERRCODE='22023';END IF;
 IF i.email_request_id=p_request THEN RETURN jsonb_build_object('claimed',false,'email',i.email,'state',i.email_status);END IF;
 IF EXISTS(SELECT 1 FROM public.trading_portal_audit a WHERE a.organization_id=p_org AND a.action='RESEND_RESERVED' AND a.details->>'requestId'=p_request::text) THEN RAISE EXCEPTION 'Resend request already used' USING ERRCODE='40001';END IF;
 IF i.email_revision<>p_expected THEN RAISE EXCEPTION 'Resend revision changed' USING ERRCODE='40001';END IF;
 IF i.state<>'PENDING' OR i.expires_at<=now() THEN RAISE EXCEPTION 'Invitation expired or answered' USING ERRCODE='42501';END IF;
 IF i.email_status='SENDING' AND i.email_attempt_at>now()-interval '2 minutes' THEN RAISE EXCEPTION 'Resend running' USING ERRCODE='40001';END IF;
 IF coalesce(i.email_attempt_at,i.created_at)>now()-interval '60 seconds' OR p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Resend interval or reason invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO o FROM public.trading_records WHERE id=i.opportunity_id AND organization_id=p_org AND kind='opportunity' FOR SHARE;
 IF NOT FOUND OR o.status NOT IN ('OPEN','ANALYSIS') OR i.expires_at>(o.data->>'expiresAt')::timestamptz THEN RAISE EXCEPTION 'Opportunity closed or changed' USING ERRCODE='42501';END IF;
 IF i.kind='SUPPLIER' THEN
  IF NOT EXISTS(SELECT 1 FROM public.trading_records s CROSS JOIN LATERAL jsonb_array_elements(s.data->'quotationContacts') c WHERE s.organization_id=p_org AND s.id=i.supplier_id AND s.kind='supplier' AND s.status='ACTIVE' AND lower(c->>'email')=i.email) THEN RAISE EXCEPTION 'Supplier contact changed' USING ERRCODE='42501';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.trading_records p JOIN public.customers c ON c.id=o.data->>'customerId' AND c.organization_id=p_org WHERE p.id=i.proposal_id AND p.organization_id=p_org AND p.parent_id=o.id AND p.kind='proposal' AND p.status='MANAGER_APPROVED' AND lower(c.contact_email)=i.email AND c.deleted_at IS NULL) THEN RAISE EXCEPTION 'Client proposal changed' USING ERRCODE='42501';END IF;
 END IF;
 previous:=jsonb_build_object('state',i.email_status,'messageId',i.email_message_id,'httpStatus',i.email_http_status,'code',i.email_error_code);
 UPDATE public.trading_invitations SET token_hash=p_token,session_hash=NULL,session_expires_at=NULL,otp_hash=NULL,otp_expires_at=NULL,otp_attempts=0,otp_sent_at=NULL,email_revision=email_revision+1,email_request_id=p_request,email_resend_by=p_actor,email_attempt_at=now(),email_status='SENDING',email_message_id=NULL,email_http_status=NULL,email_error_code=NULL WHERE id=i.id AND organization_id=p_org RETURNING * INTO i;
 INSERT INTO public.trading_portal_audit(organization_id,invitation_id,action,identity,details) VALUES(p_org,i.id,'RESEND_RESERVED',i.email,jsonb_build_object('actor',p_actor,'requestId',p_request,'revision',i.email_revision,'reason',btrim(p_reason),'expiresAt',i.expires_at,'previousMailResult',previous));
 RETURN jsonb_build_object('claimed',true,'email',i.email,'kind',i.kind,'opportunityId',o.id,'opportunity',o.data||jsonb_build_object('expiresAt',i.expires_at),'revision',i.email_revision);
END $$;
REVOKE ALL ON FUNCTION public.resend_trading_invitation(text,text,uuid,uuid,integer,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resend_trading_invitation(text,text,uuid,uuid,integer,text,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
