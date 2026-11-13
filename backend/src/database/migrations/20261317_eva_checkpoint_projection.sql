BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
-- Preserve lease, source equality, actor/license and financial reservation gates.
-- Do not serialize an immutable snapshot merely to remove it from the response.
DO $migration$
DECLARE definition text:=pg_get_functiondef('public.eva_intake_prepared_checkpoint(uuid,uuid,text)'::regprocedure);
 old_expression text:=$old$to_jsonb(v)-'source_snapshot'$old$;
 new_expression text:=$new$jsonb_build_object('id',v.id,'organization_id',v.organization_id,'customer_id',v.customer_id,'consumer_unit_id',v.consumer_unit_id,'month',v.month,'version',v.version,'previous_id',v.previous_id,'basis',v.basis,'payload_hash',v.payload_hash,'report',v.report,'created_by',v.created_by,'created_at',v.created_at)$new$;
BEGIN
 IF position(old_expression IN definition)>0 THEN
  definition:=replace(definition,old_expression,new_expression);EXECUTE definition;
 ELSIF position(new_expression IN definition)=0 THEN RAISE EXCEPTION 'Checkpoint projection changed; manual migration review required';END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
