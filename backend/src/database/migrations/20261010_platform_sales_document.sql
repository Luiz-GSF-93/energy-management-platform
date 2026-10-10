BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.read_platform_sales_approved_proposal(p_actor uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proposal public.platform_sales_proposals; review public.platform_sales_proposal_events;
BEGIN
 PERFORM 1 FROM public.platform_team_members WHERE user_id=p_actor FOR SHARE;
 PERFORM public.platform_team_owner(p_actor);
 IF p_id IS NULL THEN RAISE EXCEPTION 'Invalid proposal' USING ERRCODE='22023'; END IF;
 SELECT * INTO proposal FROM public.platform_sales_proposals WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Proposal missing' USING ERRCODE='P3610'; END IF;
 SELECT * INTO review FROM public.platform_sales_proposal_events WHERE proposal_id=p_id ORDER BY version DESC LIMIT 1;
 IF review.status IS DISTINCT FROM 'APPROVED_INTERNAL' THEN RAISE EXCEPTION 'Approved proposal required' USING ERRCODE='P3611'; END IF;
 -- Preserve the snapshot; no lead/contact lookup or personal author identifiers.
 RETURN jsonb_build_object('id',proposal.id,'receipt',proposal.receipt,'createdAt',proposal.created_at,'approvedAt',review.created_at,'status',review.status,'snapshot',proposal.snapshot);
END $$;
REVOKE ALL ON FUNCTION public.read_platform_sales_approved_proposal(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_platform_sales_approved_proposal(uuid,uuid) TO service_role;
COMMIT;
