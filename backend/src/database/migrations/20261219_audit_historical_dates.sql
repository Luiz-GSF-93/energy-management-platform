-- Compatibility for immutable histories using recorded_at. No original records changed.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $$DECLARE t text;parts text[]:=ARRAY[]::text[];date_expr text;BEGIN
 FOREACH t IN ARRAY ARRAY['audit_logs','platform_plan_audit','platform_team_audit','platform_support_case_events','ccee_registration_history','trading_portal_audit','eva_assisted_closing_events','eva_tariff_events','eva_closing_change_events','calculation_preparation_run_events','eva_automatic_intake_events','eva_intake_unit_aliases_audit','portal_customer_access_events','ccee_integration_events','platform_cost_service_events','platform_sales_activation_events','platform_sales_provisioning_events','calculation_parameter_events','calculation_monthly_input_events','contract_entry_events','calculation_monthly_cost_events','operation_record_history','document_catalog_events','platform_cost_audit','trading_history','consumer_unit_location_history','acl_admission_events','report_policy_history','report_job_events','customer_notice_history','client_portal_license_events','energy_forecast_events','energy_forecast_history','platform_cost_reconciliation_audit','user_environment_events','organization_user_request_events'] LOOP
 IF to_regclass('public.'||t) IS NOT NULL THEN
 INSERT INTO public.energy_audit_health(source) VALUES('projection:'||t) ON CONFLICT(source) DO NOTHING;
 SELECT format('a.%I',column_name) INTO date_expr FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name IN('created_at','recorded_at','occurred_at','changed_at','at') AND data_type IN('timestamp with time zone','timestamp without time zone') ORDER BY CASE column_name WHEN 'created_at' THEN 0 ELSE 1 END LIMIT 1;
 date_expr:=coalesce(date_expr,'NULL::timestamptz');
 parts:=array_append(parts,format($q$SELECT %L||':'||coalesce(j->>'id',md5(j::text)) id,coalesce(j->>'organization_id',j->>'org') organization_id,coalesce(j->>'user_id',j->>'actor_id',j->>'actor') actor_id,j->>'role' role,coalesce(j->>'resource_type',%L) module,coalesce(j->>'action',j->>'event_type',j->>'kind','EVENT') action,coalesce(j->>'resource_id',j->>'record_id',j->>'document_id',j->>'contract_id',j->>'case_id',j->>'plan_id') resource,public.energy_audit_text(coalesce(j->>'reason',j->>'justification',j#>>'{changes,reason}',j#>>'{details,reason}',j#>>'{changes,after,reason}')) reason,coalesce(j->>'status','RECORDED') result,coalesce(j->>'ip_address',j->>'ip') ip,CASE WHEN coalesce(j->>'ip_address',j->>'ip') IS NOT NULL THEN 'SOURCE_RECORDED_UNVERIFIED' END ip_basis,%L source,jsonb_build_object('before',public.energy_audit_changes(j#>'{changes,before}'),'after',public.energy_audit_changes(coalesce(j#>'{changes,after}',j->'snapshot'))) details,%s created_at FROM public.%I a CROSS JOIN LATERAL (SELECT to_jsonb(a) j) n$q$,t,t,t,date_expr,t));
 END IF;END LOOP;
 EXECUTE 'CREATE OR REPLACE VIEW public.energy_audit_source_events WITH (security_barrier=true) AS '||array_to_string(parts,' UNION ALL ');
END$$;
REVOKE ALL ON public.energy_audit_source_events FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
