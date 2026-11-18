BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- A rejected, already billed interpretation is not retried just to produce a report.
-- Return only the rejection metadata, never the rejected legal assertions.
CREATE FUNCTION public.legal_audit_settled_rejection(p_id uuid,p_token uuid,p_cursor integer,p_evidence text,p_question text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.legal_audit_jobs; a public.audit_logs;
BEGIN
 SELECT * INTO j FROM public.legal_audit_jobs WHERE id=p_id AND state='ANALYZING' AND lease_token=p_token AND p_token IS NOT NULL AND lease_until>clock_timestamp() AND cursor=p_cursor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active legal checkpoint required' USING ERRCODE='40001';END IF;
 IF p_evidence IS NULL OR p_evidence !~ '^[a-f0-9]{64}$' OR p_question IS NULL OR p_question !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Evidence hashes required' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.audit_logs WHERE organization_id=j.organization_id AND user_id::text=j.actor_id AND resource_type='backoffice_ai_interpretation' AND changes->'after'->>'documentId'=j.document_id AND changes->'after'->>'evidenceHash'=p_evidence AND changes->'after'->>'questionHash'=p_question AND created_at>=j.created_at ORDER BY created_at DESC,id DESC LIMIT 1;
 IF NOT FOUND OR a.changes->'after'->>'state' IS DISTINCT FROM 'FAILED' OR a.changes->'after'->>'consumptionState' IS DISTINCT FROM 'SETTLED' OR coalesce(a.changes->'after'->>'errorCode','') NOT IN('INVALID_RESPONSE','UNGROUNDED_NUMBER','UNGROUNDED_RESPONSE','UNGROUNDED_FIELD','OUTPUT_LIMIT') OR a.resource_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bot_energy_ai_usage WHERE id=a.resource_id::uuid AND organization_id=j.organization_id AND actor_id=j.actor_id AND module='AUDITORIA' AND state='SETTLED' AND actual_micro_usd IS NOT NULL AND settled_at IS NOT NULL AND input_tokens>0 AND output_tokens>=0) THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('state','FAILED','consumptionState','SETTLED','errorCode',a.changes->'after'->>'errorCode','requestId',a.resource_id,'replayed',true);
END$$;
REVOKE ALL ON FUNCTION public.legal_audit_settled_rejection(uuid,uuid,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.legal_audit_settled_rejection(uuid,uuid,integer,text,text) TO service_role;
COMMIT;
