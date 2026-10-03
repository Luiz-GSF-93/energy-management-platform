BEGIN;
-- Adds source-alert read receipts; existing operational RPC and history stay intact.
CREATE FUNCTION public.read_source_operation_notification(p_org text,p_actor text,p_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE origin text;source_id text;permission text;actor_role text;actor_permissions jsonb;exists_source boolean;
BEGIN
 IF p_org IS NULL OR p_actor IS NULL OR p_key IS NULL OR length(p_key)>160 OR p_key !~ '^(ocr|energy|management|license):[A-Za-z0-9_-]{1,80}:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid source alert' USING ERRCODE='P2031';END IF;
 origin:=split_part(p_key,':',1);source_id:=split_part(p_key,':',2);
 permission:=CASE origin WHEN 'ocr' THEN '8f105b02-4443-49de-b188-847e0284e7ed' WHEN 'license' THEN '8c5673e4-115c-4ab7-bb11-3b410eddcad3' ELSE '60f9690a-145b-4dba-b23f-9f945baca296' END;
 IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions s WHERE s.organization_id=p_org AND s.user_id::text=p_actor AND s.expires_at>now() AND s.revoked_at IS NULL) THEN
  SELECT r.name,r.permissions INTO actor_role,actor_permissions FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND m.status='ACTIVE';
  IF actor_role IS NULL OR actor_role NOT IN ('admin_org','gestor','operacional') OR NOT coalesce(actor_permissions ? permission,false) OR NOT coalesce(actor_permissions ?| ARRAY['cb949e2a-e01d-4cf0-8c69-6ca74fe4d627','1479c0b7-9608-4e95-bd83-7e6899255a78','489e6387-d5fc-4cb0-81f9-d7a76269dca5'],false) THEN RAISE EXCEPTION 'Unauthorized source alert' USING ERRCODE='P2031';END IF;
 END IF;
 CASE origin
 WHEN 'ocr' THEN SELECT EXISTS(SELECT 1 FROM public.document_ocr_jobs j JOIN public.documents d ON d.id=j.document_id AND d.organization_id=j.organization_id WHERE j.id::text=source_id AND j.organization_id=p_org AND j.state IN ('SUCCEEDED','FAILED','SUBMISSION_UNKNOWN') AND j.updated_at>=now()-interval '7 days' AND d.file_verified) INTO exists_source;
 WHEN 'energy' THEN SELECT EXISTS(SELECT 1 FROM public.energy_contracts c WHERE c.id=source_id AND c.organization_id=p_org AND c.status='ACTIVE' AND c.end_date::date BETWEEN (now() AT TIME ZONE 'America/Sao_Paulo')::date-30 AND (now() AT TIME ZONE 'America/Sao_Paulo')::date+30) INTO exists_source;
 WHEN 'management' THEN SELECT EXISTS(SELECT 1 FROM public.management_contracts c WHERE c.id=source_id AND c.organization_id=p_org AND c.status='ACTIVE' AND c.end_date::date BETWEEN (now() AT TIME ZONE 'America/Sao_Paulo')::date-30 AND (now() AT TIME ZONE 'America/Sao_Paulo')::date+30) INTO exists_source;
 WHEN 'license' THEN SELECT EXISTS(SELECT 1 FROM public.licenses l WHERE l.id=source_id AND l.organization_id=p_org AND l.status='ACTIVE' AND l.active AND coalesce(l.end_date,l.renewal_date)::date BETWEEN (now() AT TIME ZONE 'America/Sao_Paulo')::date-30 AND (now() AT TIME ZONE 'America/Sao_Paulo')::date+30) INTO exists_source;
 END CASE;
 IF NOT coalesce(exists_source,false) THEN RAISE EXCEPTION 'Source unavailable' USING ERRCODE='P2033';END IF;
 INSERT INTO public.operation_notification_reads(organization_id,user_id,notification_key) VALUES(p_org,p_actor,p_key) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.read_source_operation_notification(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_source_operation_notification(text,text,text) TO service_role;
INSERT INTO public.operation_module_versions(version) VALUES('20261003_f3_2_source_alerts');
NOTIFY pgrst,'reload schema';
COMMIT;
