-- F1.13: affiliation and display name belong to each organization membership.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS affiliation_type text;
ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS display_name text;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='organization_members_affiliation_check' AND conrelid='public.organization_members'::regclass) THEN
 ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_affiliation_check CHECK(affiliation_type IS NULL OR affiliation_type IN ('internal','external'));
 END IF;
END$$;
-- Legacy global classification is preserved on the profile, not guessed per organization.
CREATE OR REPLACE FUNCTION public.update_organization_member_details(target_organization_id text,target_user_id uuid,actor_user_id uuid,target_affiliation text,target_name text,audit_ip text,audit_agent text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE before_row jsonb; after_row jsonb; member_id text;
BEGIN
 IF target_affiliation NOT IN ('internal','external') OR target_affiliation IS NULL OR (target_name IS NOT NULL AND (length(btrim(target_name))<2 OR length(target_name)>120)) THEN RAISE EXCEPTION 'Invalid member details' USING ERRCODE='22023'; END IF;
 SELECT m.id,to_jsonb(m) INTO member_id,before_row FROM public.organization_members m WHERE m.organization_id=target_organization_id AND m.user_id=target_user_id AND m.status='active' FOR UPDATE;
 IF member_id IS NULL THEN RAISE EXCEPTION 'Active membership missing' USING ERRCODE='P3130'; END IF;
 UPDATE public.organization_members m SET affiliation_type=target_affiliation,display_name=COALESCE(btrim(target_name),m.display_name) WHERE m.id=member_id RETURNING to_jsonb(m) INTO after_row;
 IF before_row IS DISTINCT FROM after_row THEN
 INSERT INTO public.audit_logs(id,organization_id,user_id,action,resource_type,resource_id,changes,status,ip_address,user_agent)
 VALUES(gen_random_uuid()::text,target_organization_id,actor_user_id,'UPDATE','organization_member',member_id::text,jsonb_build_object('before',before_row,'after',after_row),'success',audit_ip,audit_agent);
 END IF;
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.update_organization_member_details(text,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_organization_member_details(text,uuid,uuid,text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
