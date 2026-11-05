-- Read-only, permission-scoped explanation evidence. No historical changes or grants to users.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
CREATE FUNCTION public.energy_audit_alert_evidence(p_org text,p_actor uuid,p_global boolean,p_id uuid,p_page integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public.energy_audit_alerts;ip_ok boolean:=false;result jsonb;span interval;
BEGIN
 PERFORM public.energy_audit_authorize(p_org,p_actor,p_global,CASE WHEN p_global THEN 'dbb580ca-d940-4e80-97fb-e9f9619a0004' ELSE 'dbb580ca-d940-4e80-97fb-e9f9619a0001' END);
 IF p_page<0 OR p_page>10000 OR p_page IS NULL THEN RAISE EXCEPTION 'Invalid evidence page' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.energy_audit_alerts WHERE id=p_id AND (p_global OR organization_id=p_org);
 IF a.id IS NULL THEN RAISE EXCEPTION 'Alert unavailable' USING ERRCODE='42501';END IF;
 BEGIN PERFORM public.energy_audit_authorize(p_org,p_actor,p_global,'dbb580ca-d940-4e80-97fb-e9f9619a0002');ip_ok:=true;EXCEPTION WHEN insufficient_privilege THEN ip_ok:=false;END;
 span:=CASE WHEN a.kind='DENIED' THEN interval '5 minutes' ELSE interval '10 minutes' END;
 WITH candidates AS (
  SELECT e.* FROM public.energy_audit_events e WHERE e.organization_id IS NOT DISTINCT FROM a.organization_id
   AND e.created_at BETWEEN a.first_at-span AND a.last_at AND coalesce(e.actor_id,e.origin)=a.subject
   AND CASE a.kind WHEN 'DENIED' THEN e.result='DENIED' WHEN 'AUTH_FAILURE' THEN e.result='AUTH_FAILURE' WHEN 'DOWNLOAD_BURST' THEN e.action='DOWNLOAD_REQUEST' WHEN 'CRITICAL_ERROR' THEN e.result='CRITICAL' ELSE false END
 ), selected AS (SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET p_page*25)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM candidates),'page',p_page,'size',25,'ipAllowed',ip_ok,
 'coverage','Consulta de eventos técnicos ainda disponíveis. O vínculo é reconstruído pela chave de agrupamento, tipo e janela; não é uma associação individual gravada na detecção. Eventos arquivados ou removidos da fonte principal podem não aparecer.',
 'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'actorId',e.actor_id,'actorName',(SELECT coalesce(nullif(btrim(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name')),''),nullif(btrim(to_jsonb(p)->>'full_name'),''),nullif(btrim(to_jsonb(p)->>'display_name'),''),nullif(btrim(to_jsonb(p)->>'name'),'')) FROM public.user_profiles p WHERE p.user_id::text=e.actor_id LIMIT 1),'role',e.role,'module',e.module,'action',e.action,'resource',public.energy_audit_text(e.resource),'result',e.result,'status',e.status_code,'createdAt',e.created_at)||CASE WHEN ip_ok THEN jsonb_build_object('ip',e.ip,'ipBasis',e.ip_basis) ELSE '{}'::jsonb END ORDER BY e.created_at DESC,e.id DESC) FROM selected e),'[]'::jsonb)) INTO result;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.energy_audit_alert_evidence(text,uuid,boolean,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.energy_audit_alert_evidence(text,uuid,boolean,uuid,integer) TO service_role;

-- Preserve the existing authorized read and add current names only to its decision page.
DO $names$
DECLARE body text;needle text:='jsonb_agg(to_jsonb(d))';replacement text:=$projection$jsonb_agg(to_jsonb(d)||jsonb_build_object('actor_name_current',(SELECT coalesce(nullif(btrim(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name')),''),nullif(btrim(to_jsonb(p)->>'full_name'),''),nullif(btrim(to_jsonb(p)->>'display_name'),''),nullif(btrim(to_jsonb(p)->>'name'),'')) FROM public.user_profiles p WHERE p.user_id::text=d.actor_id LIMIT 1)))$projection$;
BEGIN
 body:=pg_get_functiondef('public.energy_audit_read(text,uuid,boolean,jsonb)'::regprocedure);
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Audit decision projection changed; inspect compatibility';END IF;
 EXECUTE replace(body,needle,replacement);
END $names$;
NOTIFY pgrst,'reload schema';
COMMIT;
