BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $install_20261268$ BEGIN
 IF to_regprocedure('public.trading_workflow_source_changed()') IS NOT NULL THEN
  IF obj_description(to_regprocedure('public.trading_workflow_source_changed()'),'pg_proc') IS DISTINCT FROM 'trading-workflow:20261268:fa16b85e22286160e16176f23670c591799058bfc976e3e49e1ca779f843bf86' THEN RAISE EXCEPTION 'Review existing Trading workflow schema before migration';END IF;RETURN;
 END IF;
 EXECUTE $schema_20261268$
CREATE FUNCTION public.trading_workflow_tasks(p_org text,p_actor text,p_role text,p_portal boolean,p_customer text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;approval boolean;
BEGIN
 IF p_org<>'org_default' THEN RETURN jsonb_build_object('organizationId',p_org,'count',0);END IF;
 IF p_portal THEN
  SELECT count(*) INTO n FROM public.trading_approval_workflows w WHERE w.organization_id=p_org AND w.recipient_id=p_actor AND w.state='CLIENT_PENDING' AND w.deadline>now() AND(p_customer IS NULL OR w.customer_id=p_customer) AND public.trading_workflow_portal_allowed(p_org,p_actor,p_role,w.customer_id,w.unit_id);
 ELSE
  PERFORM public.assert_trading_actor(p_org,p_actor,false);
  SELECT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND r.name IN('gestor','admin_org')) INTO approval;
  SELECT count(*) INTO n FROM public.trading_approval_workflows w WHERE w.organization_id=p_org AND((approval AND w.state='INTERNAL_PENDING') OR(w.requester_id=p_actor AND w.state IN('INTERNAL_APPROVED','CLIENT_APPROVED','FORMALIZING','STALE')));
 END IF;
 RETURN jsonb_build_object('organizationId',p_org,'count',n);
END$$;
REVOKE ALL ON FUNCTION public.trading_workflow_tasks(text,text,text,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.trading_workflow_tasks(text,text,text,boolean,text) TO service_role;
CREATE FUNCTION public.trading_workflow_source_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w public.trading_approval_workflows;next_state text;
BEGIN
 IF NOT((NEW.kind='proposal' AND NEW.data-ARRAY['contractDocumentId','contractReference'] IS DISTINCT FROM OLD.data-ARRAY['contractDocumentId','contractReference']) OR(NEW.kind='supplier' AND(NEW.status IS DISTINCT FROM OLD.status OR NEW.data->'quotationContacts' IS DISTINCT FROM OLD.data->'quotationContacts')) OR(NEW.kind='opportunity' AND(NEW.data IS DISTINCT FROM OLD.data OR NEW.status IN('CANCELLED','CLOSED')))) THEN RETURN NEW;END IF;
 FOR w IN SELECT q.* FROM public.trading_approval_workflows q WHERE q.organization_id=NEW.organization_id AND q.state NOT IN('COMPLETED','REJECTED','REVOKED','STALE') AND(CASE NEW.kind WHEN 'proposal' THEN q.proposal_id=NEW.id WHEN 'supplier' THEN q.supplier_id=NEW.id ELSE q.opportunity_id=NEW.id END) AND(NEW.kind<>'opportunity' OR NOT EXISTS(SELECT 1 FROM public.trading_records p WHERE p.id=q.proposal_id AND p.organization_id=q.organization_id AND p.status='CONTRACTED')) FOR UPDATE OF q LOOP
  next_state:=CASE WHEN NEW.kind='opportunity' AND NEW.status IN('CANCELLED','CLOSED') THEN 'REVOKED' ELSE 'STALE' END;
  UPDATE public.trading_approval_workflows SET state=next_state,revision=revision+1,updated_at=clock_timestamp() WHERE id=w.id RETURNING * INTO w;
  UPDATE public.trading_formalization_access SET revoked_at=clock_timestamp(),session_hash=NULL,session_expires_at=NULL,otp_hash=NULL WHERE workflow_id=w.id AND revoked_at IS NULL;
  UPDATE public.trading_formalization_files SET shared=false WHERE workflow_id=w.id;
  UPDATE public.trading_approval_deliveries SET state='CANCELLED',diagnostic='SOURCE_CHANGED' WHERE workflow_id=w.id AND state='PENDING';
  INSERT INTO public.trading_approval_events(organization_id,workflow_id,actor_id,request_id,input,action,reason,snapshot,response)VALUES(w.organization_id,w.id,NEW.updated_by,gen_random_uuid(),jsonb_build_object('recordId',NEW.id,'revision',NEW.revision),'SOURCE_CHANGED','Fonte comercial alterada; decisões antigas não autorizam esta revisão.',to_jsonb(w),'{}');
 END LOOP;RETURN NEW;
END$$;
CREATE TRIGGER trading_workflow_source_changed AFTER UPDATE ON public.trading_records FOR EACH ROW EXECUTE FUNCTION public.trading_workflow_source_changed();
REVOKE ALL ON FUNCTION public.trading_workflow_source_changed() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMENT ON FUNCTION public.trading_workflow_source_changed() IS 'trading-workflow:20261268:fa16b85e22286160e16176f23670c591799058bfc976e3e49e1ca779f843bf86';
$schema_20261268$;
END $install_20261268$;
COMMIT;
