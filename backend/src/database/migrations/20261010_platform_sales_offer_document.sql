BEGIN;
CREATE OR REPLACE FUNCTION public.read_platform_sales_offer_document(p_actor uuid,p_proposal uuid,p_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proposal jsonb; terms public.platform_sales_offer_terms; event public.platform_sales_offer_term_events;
BEGIN
 proposal:=public.read_platform_sales_approved_proposal(p_actor,p_proposal);
 IF p_revision IS NULL OR p_revision<1 THEN RAISE EXCEPTION 'Invalid revision' USING ERRCODE='22023'; END IF;
 SELECT * INTO terms FROM public.platform_sales_offer_terms WHERE proposal_id=p_proposal AND revision=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'Terms missing' USING ERRCODE='P3610'; END IF;
 SELECT * INTO event FROM public.platform_sales_offer_term_events WHERE proposal_id=p_proposal AND revision=p_revision ORDER BY version DESC LIMIT 1;
 IF event.status IS DISTINCT FROM 'APPROVED_INTERNAL' THEN RAISE EXCEPTION 'Terms not approved' USING ERRCODE='P3611'; END IF;
 RETURN jsonb_build_object('proposal',proposal,'terms',jsonb_build_object('revision',terms.revision,'definition',terms.definition,'status',event.status,'approvedAt',event.created_at),'asOfDate',(now() AT TIME ZONE 'UTC')::date,'expired',(terms.definition->>'validUntil')::date<(now() AT TIME ZONE 'UTC')::date);
END $$;
REVOKE ALL ON FUNCTION public.read_platform_sales_offer_document(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_platform_sales_offer_document(uuid,uuid,integer) TO service_role;
COMMIT;
