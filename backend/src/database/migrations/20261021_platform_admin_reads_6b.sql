BEGIN;
-- Read-only additive projection. Existing commands, grants and history remain unchanged.
CREATE FUNCTION public.platform_admin_read_6b(p_actor uuid,p_kind text,p_id uuid DEFAULT NULL,p_page integer DEFAULT 0,p_filter jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor_profile text; result jsonb; total bigint; choices jsonb; snapshot jsonb;
 search text:=lower(coalesce(p_filter->>'search','')); desired_status text:=coalesce(p_filter->>'status','');
BEGIN
 IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 1000 OR jsonb_typeof(p_filter) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT 1 FROM jsonb_each(p_filter) f WHERE f.key NOT IN ('search','status','organization','month','priority','assignee','from','to','profile','active','actor','target') OR jsonb_typeof(f.value)<>'string' OR length(f.value#>>'{}')>150)
 THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023'; END IF;
 IF p_filter ? 'month' AND p_filter->>'month' !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(p_filter) f WHERE f.key IN ('from','to') AND (f.value !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(f.value::date,'YYYY-MM-DD')<>f.value))
 OR p_filter ? 'from' AND p_filter ? 'to' AND p_filter->>'from'>p_filter->>'to' THEN RAISE EXCEPTION 'Invalid dates' USING ERRCODE='22023'; END IF;
 IF p_filter ? 'profile' AND p_filter->>'profile' NOT IN ('OWNER','ADMINISTRATOR','FINANCE','SUPPORT') OR p_filter ? 'active' AND p_filter->>'active' NOT IN ('true','false')
 OR p_filter ? 'priority' AND p_filter->>'priority' NOT IN ('LOW','NORMAL','HIGH') THEN RAISE EXCEPTION 'Invalid enum' USING ERRCODE='22023'; END IF;

 IF p_kind IN ('team','audit') THEN
  PERFORM public.platform_team_owner(p_actor);
  IF p_kind='team' THEN
   WITH filtered AS (SELECT t.*,p.name,p.email FROM public.platform_team_members t LEFT JOIN public.user_profiles p ON p.user_id=t.user_id
    WHERE (search='' OR position(search in lower(concat_ws(' ',t.first_name,t.last_name,p.name,p.email,t.user_id::text)))>0)
    AND (NOT p_filter ? 'profile' OR t.profile=p_filter->>'profile') AND (NOT p_filter ? 'active' OR t.active=(p_filter->>'active')::boolean))
   SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(j ORDER BY created_at,user_id) FROM (SELECT created_at,user_id,jsonb_build_object('userId',user_id,'profile',profile,'firstName',first_name,'lastName',last_name,'registeredName',name,'email',email,'active',active,'revision',revision) j FROM filtered ORDER BY created_at,user_id LIMIT 25 OFFSET p_page*25)x),'[]'::jsonb),'total',(SELECT count(*) FROM filtered),'ownerCount',(SELECT count(*) FROM public.platform_team_members WHERE active AND profile='OWNER'),'history','[]'::jsonb) INTO result;
  ELSE
   WITH filtered AS (SELECT * FROM public.platform_team_audit a WHERE
    (NOT p_filter ? 'actor' OR a.actor_id::text=p_filter->>'actor') AND (NOT p_filter ? 'target' OR a.target_id::text=p_filter->>'target')
    AND (NOT p_filter ? 'from' OR a.created_at>=(p_filter->>'from')::date::timestamp AT TIME ZONE 'UTC') AND (NOT p_filter ? 'to' OR a.created_at<((p_filter->>'to')::date+1)::timestamp AT TIME ZONE 'UTC')
    AND (search='' OR position(search in lower(concat_ws(' ',a.actor_id::text,a.target_id::text,a.changes->>'actorNameAtTime',a.changes->>'reason')))>0))
   SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(j ORDER BY created_at DESC,id DESC) FROM (SELECT created_at,id,jsonb_build_object('id',id,'at',created_at,'actorId',actor_id,'targetId',target_id,'changes',changes,'currentActorName',public.platform_workflow_name(actor_id),'currentTargetName',public.platform_workflow_name(target_id)) j FROM filtered ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET p_page*25)x),'[]'::jsonb),'total',(SELECT count(*) FROM filtered)) INTO result;
  END IF;
 ELSIF p_kind IN ('support','support_history','finance','finance_history') THEN
  SELECT t.profile INTO actor_profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
  IF p_kind LIKE 'support%' THEN
   PERFORM public.platform_workflow_actor(p_actor,CASE WHEN actor_profile IN ('OWNER','ADMINISTRATOR') THEN 'a7c8f257-580d-4d39-8900-4a5788068203' ELSE 'a7c8f257-580d-4d39-8900-4a5788068204' END);
   IF desired_status<>'' AND desired_status NOT IN ('OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED') THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
   IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.platform_support_cases WHERE id=p_id AND (actor_profile IN ('OWNER','ADMINISTRATOR') OR assignee_id=p_actor)) THEN RAISE EXCEPTION 'Case unavailable' USING ERRCODE='42501'; END IF;
   IF p_kind='support_history' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023'; END IF;
    SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(j ORDER BY revision DESC) FROM (SELECT revision,to_jsonb(e)||jsonb_build_object('currentActorName',public.platform_workflow_name(e.actor_id)) j FROM public.platform_support_case_events e WHERE case_id=p_id ORDER BY revision DESC LIMIT 25 OFFSET p_page*25)x),'[]'::jsonb),'total',(SELECT count(*) FROM public.platform_support_case_events WHERE case_id=p_id)) INTO result;
   ELSE
    WITH filtered AS (SELECT c.* FROM public.platform_support_cases c WHERE (actor_profile IN ('OWNER','ADMINISTRATOR') OR c.assignee_id=p_actor) AND (p_id IS NULL OR c.id=p_id)
     AND (desired_status='' OR c.status=desired_status) AND (search='' OR position(search in lower(concat_ws(' ',c.title,c.id::text)))>0)
     AND (NOT p_filter ? 'organization' OR c.organization_id=p_filter->>'organization') AND (NOT p_filter ? 'assignee' OR c.assignee_id::text=p_filter->>'assignee')
     AND (NOT p_filter ? 'priority' OR c.priority=p_filter->>'priority') AND (NOT p_filter ? 'from' OR c.deadline>=(p_filter->>'from')::date) AND (NOT p_filter ? 'to' OR c.deadline<=(p_filter->>'to')::date))
    SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(j ORDER BY updated_at DESC,id DESC) FROM (SELECT updated_at,id,to_jsonb(c)||jsonb_build_object('requesterName',public.platform_workflow_name(c.requester_id),'assigneeName',public.platform_workflow_name(c.assignee_id),'organizationName',(SELECT name FROM public.organizations WHERE id=c.organization_id),'history','[]'::jsonb) j FROM filtered c ORDER BY updated_at DESC,id DESC LIMIT 25 OFFSET p_page*25)x),'[]'::jsonb),'total',(SELECT count(*) FROM filtered)) INTO result;
   END IF;
  ELSE
   PERFORM public.platform_workflow_actor(p_actor,CASE WHEN actor_profile='OWNER' THEN 'a7c8f257-580d-4d39-8900-4a5788068202' ELSE 'a7c8f257-580d-4d39-8900-4a5788068201' END);
   IF desired_status<>'' AND desired_status NOT IN ('PROPOSED','CONFIRMED','REJECTED') THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
   IF p_kind='finance_history' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023'; END IF;
    SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(j ORDER BY revision DESC) FROM (SELECT revision,to_jsonb(v)||jsonb_build_object('currentActorName',public.platform_workflow_name(v.actor_id),'audit',(SELECT a.details FROM public.platform_cost_reconciliation_audit a WHERE a.version_id=v.id)) j FROM public.platform_cost_reconciliation_versions v WHERE reconciliation_id=p_id ORDER BY revision DESC LIMIT 25 OFFSET p_page*25)x),'[]'::jsonb),'total',(SELECT count(*) FROM public.platform_cost_reconciliation_versions WHERE reconciliation_id=p_id)) INTO result;
   ELSE
    WITH latest AS (SELECT DISTINCT ON (reconciliation_id) * FROM public.platform_cost_reconciliation_versions ORDER BY reconciliation_id,revision DESC), filtered AS (SELECT * FROM latest v WHERE (p_id IS NULL OR v.reconciliation_id=p_id)
     AND (desired_status='' OR v.status=desired_status) AND (search='' OR position(search in lower(concat_ws(' ',v.payload->>'provider',v.payload->>'externalReference',v.reconciliation_id::text)))>0)
     AND (NOT p_filter ? 'month' OR v.payload->>'month'=(p_filter->>'month')||'-01')
     AND (NOT p_filter ? 'organization' OR EXISTS(SELECT 1 FROM public.platform_cost_reconciliation_allocations a WHERE a.version_id=v.id AND a.organization_id=p_filter->>'organization')))
    SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(j ORDER BY created_at DESC,reconciliation_id) FROM (SELECT created_at,reconciliation_id,to_jsonb(v)||jsonb_build_object('preparedName',public.platform_workflow_name(v.prepared_by),'history','[]'::jsonb,'evidence',(SELECT jsonb_build_object('id',e.id,'filename',e.filename,'sha256',e.sha256) FROM public.platform_financial_evidence e WHERE e.id=v.evidence_id)) j FROM filtered v ORDER BY created_at DESC,reconciliation_id LIMIT 25 OFFSET p_page*25)x),'[]'::jsonb),'total',(SELECT count(*) FROM filtered)) INTO result;
   END IF;
  END IF;
  IF p_kind IN ('support','finance') THEN
   result:=result||jsonb_build_object('profile',actor_profile,'supportMembers',CASE WHEN actor_profile IN ('OWNER','ADMINISTRATOR') THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',public.platform_workflow_name(user_id)) ORDER BY user_id),'[]'::jsonb) FROM public.platform_team_members WHERE active AND profile='SUPPORT') ELSE '[]'::jsonb END,'organizations',CASE WHEN actor_profile IN ('OWNER','ADMINISTRATOR','FINANCE') THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id),'[]'::jsonb) FROM public.organizations) ELSE '[]'::jsonb END);
  END IF;

 ELSIF p_kind IN ('sales_detail','sales_history','sales_consolidated_detail') THEN
  SELECT t.profile INTO actor_profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
  IF actor_profile NOT IN ('OWNER','FINANCE') OR actor_profile IS NULL THEN RAISE EXCEPTION 'Financial reader required' USING ERRCODE='42501'; END IF;
  PERFORM public.platform_workflow_actor(p_actor,CASE WHEN actor_profile='OWNER' THEN '82e7fc71-479a-4dd6-8b22-4fba6eaa6841' ELSE 'c767190a-5ec0-4d89-8675-688415e967b1' END);
  IF p_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.platform_sales_asaas_bindings WHERE id=p_id) THEN RAISE EXCEPTION 'Binding unavailable' USING ERRCODE='42501'; END IF;
  IF p_kind IN ('sales_detail','sales_consolidated_detail') THEN
   SELECT jsonb_build_object('binding',jsonb_build_object('id',b.id,'company',b.company,'paymentId',b.payment_id,'proposalId',b.proposal_id,'expectedCents',b.gross_cents,'actorId',b.actor_id,'recordedName',b.actor_name,'currentName',public.platform_sales_finance_name(b.actor_id),'justification',b.justification),'events','[]'::jsonb) INTO result FROM public.platform_sales_asaas_bindings b WHERE b.id=p_id;
   IF p_kind='sales_consolidated_detail' THEN
    snapshot:=public.read_platform_sales_finance_consolidated(p_actor,0,'','',NULL,NULL,false,p_id);
    result:=(snapshot-'history')||jsonb_build_object('history',jsonb_build_object('binding',result->'binding'));
   END IF;
  ELSE
   WITH entries AS (
    SELECT 'event-'||i.id::text id,i.received_at at,i.event,i.provider_id,'EVENT' source,i.summary event_summary,NULL::uuid actor_id,NULL::text actor_name,NULL::text status,NULL::text note,NULL::integer version
    FROM public.platform_sales_asaas_inbox i JOIN public.platform_sales_asaas_bindings b ON b.payment_id=i.payment_id WHERE b.id=p_id
    UNION ALL
    SELECT 'check-'||i.id::text||'-'||c.version::text,c.created_at,i.event,i.provider_id,'CHECK',c.summary,c.actor_id,c.actor_name,c.status,c.note,c.version
    FROM public.platform_sales_asaas_checks c JOIN public.platform_sales_asaas_inbox i ON i.id=c.event_id JOIN public.platform_sales_asaas_bindings b ON b.payment_id=i.payment_id WHERE b.id=p_id
   ) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(j ORDER BY at DESC,id DESC) FROM (SELECT at,id,to_jsonb(e)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(e.actor_id),'audit',jsonb_build_object('actorNameAtTime',e.actor_name,'reason',e.note)) j FROM entries e ORDER BY at DESC,id DESC LIMIT 25 OFFSET p_page*25)x),'[]'::jsonb),'total',(SELECT count(*) FROM entries)) INTO result;
  END IF;
 ELSIF p_kind='costs' THEN
  SELECT t.profile INTO actor_profile FROM public.platform_team_members t WHERE t.user_id=p_actor AND t.active;
  PERFORM public.platform_workflow_actor(p_actor,CASE WHEN actor_profile='OWNER' THEN 'e23a5c98-8b68-4ed2-aef8-70a7166407e4' ELSE '699703af-10ba-43a3-8eb8-9f0d9e477498' END);
  IF actor_profile NOT IN ('OWNER','FINANCE') THEN RAISE EXCEPTION 'Cost access denied' USING ERRCODE='42501'; END IF;
  IF NOT p_filter ? 'month' THEN RAISE EXCEPTION 'Month required' USING ERRCODE='22023'; END IF;
  snapshot:=public.platform_cost_snapshot(((p_filter->>'month')||'-01')::date);
  WITH filtered AS (SELECT value FROM jsonb_array_elements(snapshot->'companies') WHERE (search='' OR position(search in lower(concat_ws(' ',value->>'name',value->>'organization_id')))>0) AND (NOT p_filter ? 'organization' OR value->>'organization_id'=p_filter->>'organization'))
  SELECT coalesce((SELECT jsonb_agg(value ORDER BY value->>'name',value->>'organization_id') FROM (SELECT value FROM filtered ORDER BY value->>'name',value->>'organization_id' LIMIT 25 OFFSET p_page*25)x),'[]'::jsonb),(SELECT count(*) FROM filtered) INTO result,total;
  -- Global totals remain global and independent of the current company page.
  result:=jsonb_set(snapshot,'{companies}',result)||jsonb_build_object('companyTotal',total,'companyPage',p_page,'organizationOptions',(SELECT coalesce(jsonb_agg(jsonb_build_object('organization_id',value->>'organization_id','name',value->>'name') ORDER BY value->>'name',value->>'organization_id'),'[]'::jsonb) FROM jsonb_array_elements(snapshot->'companies')));
 ELSE RAISE EXCEPTION 'Invalid read scope' USING ERRCODE='22023'; END IF;
 RETURN result||jsonb_build_object('page',p_page,'pageSize',25);
END $$;
REVOKE ALL ON FUNCTION public.platform_admin_read_6b(uuid,text,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.platform_admin_read_6b(uuid,text,uuid,integer,jsonb) TO service_role;
CREATE INDEX IF NOT EXISTS platform_team_audit_6b_time ON public.platform_team_audit(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS platform_support_case_6b_assignee ON public.platform_support_cases(assignee_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS platform_sales_inbox_6b_payment ON public.platform_sales_asaas_inbox(payment_id,received_at DESC,id DESC);
COMMIT;
