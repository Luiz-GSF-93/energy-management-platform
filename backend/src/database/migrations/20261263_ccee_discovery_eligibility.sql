BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Expose eligibility inputs already enforced by the worker; no status or authorization changes.
DO $migration$
DECLARE definition text; old_text text; new_text text;
BEGIN
 SELECT pg_get_functiondef('public.ccee_customer_discovery_read(text,text,integer)'::regprocedure) INTO definition;
 IF strpos(definition,'DISCOVERY_ELIGIBILITY_PROJECTION')=0 THEN
  old_text:=$old$SELECT j.id,j.customer_id,c.company_name customer_name,j.tax_id$old$;
  new_text:=$new$SELECT /* DISCOVERY_ELIGIBILITY_PROJECTION */ j.id,j.customer_id,c.company_name customer_name,c.status customer_status,j.tax_id$new$;
  IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'Discovery customer projection changed'; END IF;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$'name',u.name,'installation',u.consumer_unit_number,'binding'$old$;
  new_text:=$new$'name',u.name,'installation',u.consumer_unit_number,'status',u.status,'binding'$new$;
  IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'Discovery unit projection changed'; END IF;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$'page',p_page,'policy'$old$;
  new_text:=$new$'page',p_page,'canRetry',EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization' WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE' AND r.name='admin_org'),'policy'$new$;
  IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN RAISE EXCEPTION 'Discovery actor projection changed'; END IF;
  EXECUTE replace(definition,old_text,new_text);
 END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
