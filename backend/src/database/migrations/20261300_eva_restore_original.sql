BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.eva_intake_restore(p_org text,p_actor text,p_role text,p_platform boolean,p_id uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public.eva_automatic_intakes;a jsonb;
BEGIN
 SELECT * INTO i FROM public.eva_automatic_intakes WHERE organization_id=p_org AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original unavailable' USING ERRCODE='42501';END IF;
 a:=public.eva_intake_actor(p_org,p_actor,p_role,p_platform,i.customer_id);
 IF a->>'external' IS DISTINCT FROM 'false' OR NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id::text=m.role_id::text AND r.organization_id=m.organization_id WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.role_id::text=p_role AND upper(m.status)='ACTIVE' AND m.affiliation_type='internal' AND r.name IN('admin_org','gestor')) THEN RAISE EXCEPTION 'Internal administrator or manager required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR p_body-ARRAY['reason']<>'{}' OR jsonb_typeof(p_body->'reason') IS DISTINCT FROM 'string' OR coalesce(length(btrim(p_body->>'reason')),0) NOT BETWEEN 30 AND 1000 THEN RAISE EXCEPTION 'Restoration reason required' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.eva_automatic_intake_events e WHERE e.intake_id=i.id AND e.event='RESTORED' AND e.actor_id=p_actor AND e.body->>'sourceHash'=i.file_hash AND e.body->>'reason'=btrim(p_body->>'reason')) THEN RETURN jsonb_build_object('id',i.id,'state',i.state,'replayed',true);END IF;
 IF i.state<>'DISMISSED' OR NOT i.stored OR i.document_id IS NOT NULL OR i.closing_id IS NOT NULL OR i.lease_token IS NOT NULL OR i.operation_url IS NOT NULL AND i.raw_result IS NULL OR EXISTS(SELECT 1 FROM public.eva_intake_identity_reviews r WHERE r.intake_id=i.id AND r.source_hash=i.file_hash AND r.kind='REJECTED' AND public.eva_identity_registration_current(p_org,r.diagnostic->'registration')) THEN RAISE EXCEPTION 'Source must be reviewed without uncertain writes' USING ERRCODE='40001';END IF;
 UPDATE public.eva_automatic_intakes SET state='RECOGNIZING',note='Original retomado por confirmação do operador; a EVA reconferirá unidade, competência e fontes, sem aprovação financeira.',next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=i.id;
 PERFORM public.eva_intake_event(i.id,'RESTORED',jsonb_build_object('reason',btrim(p_body->>'reason'),'sourceHash',i.file_hash,'previousState',i.state,'financialApproval',false,'preservedReading',i.raw_result IS NOT NULL),p_actor);
 RETURN jsonb_build_object('id',i.id,'state','RECOGNIZING','replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.eva_intake_restore(text,text,text,boolean,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.eva_intake_restore(text,text,text,boolean,uuid,jsonb) TO service_role;
-- A later restoration supersedes a prior STOP for triage display only. The
-- original stop, source diagnostics and independent identity checks are retained.
DO $patch$DECLARE d text;needle text;replacement text;BEGIN
 SELECT pg_get_functiondef('public.eva_intake_identity_action(text,text,text,boolean,text,uuid,jsonb)'::regprocedure) INTO d;
 needle:=$old$AND decision.kind IN('CONTINUE','ADDRESS','STOP','REJECTED')$old$;
 replacement:=$new$AND decision.kind IN('CONTINUE','ADDRESS','STOP','REJECTED') AND decision.created_at>=coalesce((SELECT max(restored.created_at) FROM public.eva_automatic_intake_events restored WHERE restored.intake_id=t.id AND restored.event='RESTORED'),'-infinity'::timestamptz)$new$;
 IF strpos(d,replacement)>0 THEN NULL;ELSIF strpos(d,needle)>0 THEN EXECUTE replace(d,needle,replacement);ELSE RAISE EXCEPTION 'Review identity restoration baseline';END IF;
END$patch$;
DO $list$DECLARE d text;needle text;replacement text;BEGIN
 SELECT pg_get_functiondef('public.eva_intake_administration(text,text,text,boolean,text,uuid,jsonb)'::regprocedure) INTO d;
 needle:=$old$'state',closed.state,'note',closed.note$old$;
 replacement:=$new$'state',closed.state,'canRestore',allowed AND closed.document_id IS NULL AND closed.closing_id IS NULL AND closed.lease_token IS NULL,'note',closed.note$new$;
 IF strpos(d,replacement)>0 THEN NULL;ELSIF strpos(d,needle)>0 THEN EXECUTE replace(d,needle,replacement);ELSE RAISE EXCEPTION 'Review restoration list baseline';END IF;
END$list$;
-- Re-evaluate only unfinished, unpublished proposals after supplier draft rollout.
UPDATE public.eva_automatic_intakes i SET signature=NULL,next_attempt_at=clock_timestamp()
WHERE i.state IN('AWAITING_SOURCES','PROPOSAL_READY') AND i.lease_token IS NULL
AND NOT EXISTS(SELECT 1 FROM public.eva_assisted_closing_events e WHERE e.closing_id=i.closing_id AND e.state='APPROVED');
NOTIFY pgrst,'reload schema';
COMMIT;
