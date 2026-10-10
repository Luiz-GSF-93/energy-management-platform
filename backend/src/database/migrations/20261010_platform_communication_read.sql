BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.read_platform_communications(p_actor uuid,p_filter jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; start_at timestamptz; end_at timestamptz; page integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id
 JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text AND t.active
 WHERE u.user_id::text=p_actor::text AND r.scope='global'
 AND ((r.name='admin_platform' AND t.profile='OWNER' AND r.permissions ? '82e7fc71-479a-4dd6-8b22-4fba6eaa6841')
 OR (r.name='platform_support' AND t.profile='SUPPORT' AND r.permissions ? 'c51b6e94-969a-4b9b-bcf9-05c18a4cb2d7')))
 OR (SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE u.user_id::text=p_actor::text AND r.scope='global')<>1
 THEN RAISE EXCEPTION 'Platform communication access denied' USING ERRCODE='42501';END IF;
 IF p_filter IS NULL OR jsonb_typeof(p_filter)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_filter) k WHERE k NOT IN ('start','end','page','organization','flow','processing','delivery','association','receipt')) THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
 IF coalesce(p_filter->>'start','') !~ '^\d{4}-\d{2}-\d{2}$' OR coalesce(p_filter->>'end','') !~ '^\d{4}-\d{2}-\d{2}$'
 OR coalesce(p_filter->>'page','0') !~ '^\d{1,4}$' THEN RAISE EXCEPTION 'Invalid period/page' USING ERRCODE='22023';END IF;
 start_at:=(p_filter->>'start')::date::timestamp AT TIME ZONE 'UTC';
 end_at:=((p_filter->>'end')::date+1)::timestamp AT TIME ZONE 'UTC';page:=coalesce(p_filter->>'page','0')::integer;
 IF end_at<=start_at OR end_at-start_at>interval '366 days' OR page>1000
 OR length(coalesce(p_filter->>'organization',''))>200 OR length(coalesce(p_filter->>'receipt',''))>510
 OR (p_filter ? 'flow' AND p_filter->>'flow' NOT IN ('REPORT','REQUEST','AGENDA','DEADLINE','ACL_PUBLISHED','UNASSOCIATED'))
 OR (p_filter ? 'processing' AND p_filter->>'processing' NOT IN ('QUEUED','PREPARING','TRANSMITTING','ACCEPTED','FAILED','UNKNOWN','BLOCKED','UNREGISTERED'))
 OR (p_filter ? 'delivery' AND p_filter->>'delivery' NOT IN ('sent','delivered','read','failed','PENDING'))
 OR (p_filter ? 'association' AND p_filter->>'association' NOT IN ('LINKED','UNASSOCIATED','CONFLICT'))
 THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
 WITH sends AS (
 SELECT 'notice:'||d.id id,d.organization_id,d.event flow,d.state processing,d.provider_id,d.created_at
 FROM public.customer_notice_deliveries d WHERE d.channel='whatsapp'
 UNION ALL SELECT 'report:'||d.id,d.organization_id,'REPORT',d.state,d.provider_id,d.created_at
 FROM public.report_deliveries d WHERE d.channel='whatsapp'
 ), receipts AS (
 SELECT provider_id,count(*) n FROM sends WHERE provider_id IS NOT NULL GROUP BY provider_id
 ), events AS (
 SELECT message_id,(array_agg(status ORDER BY CASE status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'failed' THEN 2 ELSE 1 END DESC,event_at DESC,event_key DESC))[1] delivery,
 count(*) event_count,min(event_at) first_at,max(event_at) last_at,
 coalesce(jsonb_agg(DISTINCT error_codes) FILTER(WHERE error_codes<>'[]'::jsonb),'[]'::jsonb) errors
 FROM public.platform_whatsapp_status_events GROUP BY message_id
 ), rows AS (
 SELECT s.id,CASE WHEN r.n>1 THEN NULL ELSE s.organization_id END organization_id,
 CASE WHEN r.n>1 THEN NULL ELSE o.name END organization_name,s.flow,s.processing,s.provider_id receipt,s.created_at,
 coalesce(e.delivery,'PENDING') delivery,coalesce(e.event_count,0) event_count,e.last_at,coalesce(e.errors,'[]'::jsonb) errors,
 CASE WHEN r.n>1 THEN 'CONFLICT' ELSE 'LINKED' END association
 FROM sends s LEFT JOIN receipts r ON r.provider_id=s.provider_id LEFT JOIN events e ON e.message_id=s.provider_id LEFT JOIN public.organizations o ON o.id=s.organization_id
 UNION ALL SELECT 'provider:'||e.message_id,NULL,NULL,'UNASSOCIATED','UNREGISTERED',e.message_id,e.first_at,e.delivery,e.event_count,e.last_at,e.errors,'UNASSOCIATED'
 FROM events e WHERE NOT EXISTS(SELECT 1 FROM sends s WHERE s.provider_id=e.message_id)
 ), filtered AS (
 SELECT * FROM rows WHERE created_at>=start_at AND created_at<end_at
 AND (NOT p_filter ? 'organization' OR organization_id=p_filter->>'organization')
 AND (NOT p_filter ? 'flow' OR flow=p_filter->>'flow')
 AND (NOT p_filter ? 'processing' OR processing=p_filter->>'processing')
 AND (NOT p_filter ? 'delivery' OR delivery=p_filter->>'delivery')
 AND (NOT p_filter ? 'association' OR association=p_filter->>'association')
 AND (NOT p_filter ? 'receipt' OR receipt=p_filter->>'receipt')
 ), paged AS (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 25 OFFSET page*25)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('costStatus','NOT_APURED','historicalModel',NULL) ORDER BY p.created_at DESC,p.id) FROM paged p),'[]'::jsonb),
 'total',(SELECT count(*) FROM filtered),'page',page,'pageSize',25,
 'messages',(SELECT count(DISTINCT receipt) FROM filtered WHERE receipt IS NOT NULL AND association<>'CONFLICT'),
 'organizations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) ORDER BY o.name,o.id) FROM public.organizations o WHERE EXISTS(SELECT 1 FROM sends s WHERE s.organization_id=o.id)),'[]'::jsonb),
 'timeBasis','UTC','costBasis','Valor não apurado; evento de entrega não comprova cobrança.') INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_platform_communications(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_platform_communications(uuid,jsonb) TO service_role;
COMMIT;
