BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Read-only, paginated projection. Messages and earlier negotiations remain immutable.
CREATE FUNCTION public.trading_quote_company_conversations(p_org text,p_actor text,p_supplier uuid DEFAULT NULL,p_page integer DEFAULT 0,p_thread uuid DEFAULT NULL,p_message_page integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='8s' AS $$
DECLARE rows jsonb; total integer; selected public.trading_invitations;
BEGIN
 PERFORM public.assert_trading_actor(p_org,p_actor,false);
 IF p_page NOT BETWEEN 0 AND 1000 OR p_message_page NOT BETWEEN 0 AND 10000 OR p_page IS NULL OR p_message_page IS NULL THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 IF p_supplier IS NULL THEN
  IF p_thread IS NOT NULL THEN RAISE EXCEPTION 'Supplier required' USING ERRCODE='22023';END IF;
  SELECT count(DISTINCT supplier_id) INTO total FROM public.trading_invitations WHERE organization_id=p_org AND kind='SUPPLIER';
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.urgency DESC,x.name,x.id),'[]') INTO rows FROM(
   SELECT s.id,s.data->>'tradeName' name,max(coalesce(t.urgency,1)) urgency,jsonb_build_object('id',s.id,'supplier',s.data->>'tradeName','rounds',count(*),
    'active',count(*) FILTER(WHERE n.state IN('PENDING','RESPONDED') AND n.expires_at>now() AND public.trading_quote_is_live(p_org,n.opportunity_id)),
    'pending',count(*) FILTER(WHERE t.status='WAITING_BACKOFFICE' AND n.state IN('PENDING','RESPONDED') AND n.expires_at>now() AND public.trading_quote_is_live(p_org,n.opportunity_id)),
    'urgency',max(coalesce(t.urgency,1))) item
   FROM public.trading_invitations n JOIN public.trading_records s ON s.id=n.supplier_id AND s.organization_id=n.organization_id AND s.kind='supplier'
   LEFT JOIN public.trading_quote_threads t ON t.organization_id=n.organization_id AND t.invitation_id=n.id
   WHERE n.organization_id=p_org AND n.kind='SUPPLIER' GROUP BY s.id,s.data ORDER BY max(coalesce(t.urgency,1)) DESC,s.data->>'tradeName',s.id LIMIT 20 OFFSET p_page*20
  )x;
  RETURN jsonb_build_object('organizationId',p_org,'rows',rows,'total',total,'pageSize',20);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.trading_records WHERE organization_id=p_org AND id=p_supplier AND kind='supplier') THEN RAISE EXCEPTION 'Supplier unavailable' USING ERRCODE='42501'; END IF;
 IF p_thread IS NOT NULL THEN
  SELECT * INTO selected FROM public.trading_invitations WHERE organization_id=p_org AND supplier_id=p_supplier AND id=p_thread AND kind='SUPPLIER';
  IF selected.id IS NULL THEN RAISE EXCEPTION 'Thread unavailable' USING ERRCODE='42501';END IF;
 END IF;
 SELECT count(*) INTO total FROM public.trading_invitations WHERE organization_id=p_org AND supplier_id=p_supplier AND kind='SUPPLIER' AND(p_thread IS NULL OR id=p_thread);
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.created_at DESC,x.id),'[]') INTO rows FROM(
  SELECT n.created_at,n.id,jsonb_build_object('id',n.id,'opportunityId',n.opportunity_id,'title',o.data->>'title','supplier',s.data->>'tradeName','email',n.email,
   'expiresAt',least(n.expires_at,(o.data->>'expiresAt')::timestamptz),'urgency',coalesce(t.urgency,1),
   'status',CASE WHEN NOT public.trading_quote_is_live(p_org,o.id) OR n.expires_at<=now() OR n.state NOT IN('PENDING','RESPONDED') THEN 'EXPIRED' ELSE coalesce(t.status,'NO_MESSAGES') END,
   'messageTotal',(SELECT count(*) FROM public.trading_quote_messages q WHERE q.organization_id=p_org AND q.invitation_id=n.id),
   'messages',(SELECT coalesce(jsonb_agg(mm.message ORDER BY mm.created_at,mm.id),'[]') FROM(
    SELECT q.id,q.created_at,jsonb_build_object('id',q.id,'author',q.author_type,'text',q.body,'urgency',q.urgency,'at',q.created_at,'status',q.status) message
    FROM public.trading_quote_messages q WHERE q.organization_id=p_org AND q.invitation_id=n.id ORDER BY q.created_at DESC,q.id DESC LIMIT 50 OFFSET p_message_page*50)mm),
   'deliveries',(SELECT coalesce(jsonb_agg(jsonb_build_object('state',d.state,'kind',d.kind,'at',d.created_at,'diagnostic',d.diagnostic) ORDER BY d.created_at DESC),'[]') FROM(SELECT * FROM public.trading_quote_mail_outbox WHERE organization_id=p_org AND invitation_id=n.id ORDER BY created_at DESC LIMIT 10)d)) item
  FROM public.trading_invitations n JOIN public.trading_records o ON o.organization_id=n.organization_id AND o.id=n.opportunity_id
  JOIN public.trading_records s ON s.organization_id=n.organization_id AND s.id=n.supplier_id
  LEFT JOIN public.trading_quote_threads t ON t.organization_id=n.organization_id AND t.invitation_id=n.id
  WHERE n.organization_id=p_org AND n.supplier_id=p_supplier AND n.kind='SUPPLIER' AND(p_thread IS NULL OR n.id=p_thread)
  ORDER BY n.created_at DESC,n.id LIMIT 20 OFFSET p_page*20)x;
 RETURN jsonb_build_object('organizationId',p_org,'supplierId',p_supplier,'rows',rows,'total',total,'pageSize',20,'messagePageSize',50);
END $$;
REVOKE ALL ON FUNCTION public.trading_quote_company_conversations(text,text,uuid,integer,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trading_quote_company_conversations(text,text,uuid,integer,uuid,integer) TO service_role;
COMMIT;
