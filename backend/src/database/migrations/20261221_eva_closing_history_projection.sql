BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
-- Project only the existing response columns. Immutable source snapshots remain
-- stored and compared by the original function; they are never serialized just
-- to be removed from a history/receipt response. No access or decision change.
DO $migration$
DECLARE definition text:=pg_get_functiondef('public.eva_assisted_closing_action(text,text,text,boolean,text,text,text,uuid,jsonb)'::regprocedure);
BEGIN
 IF position($old0$to_jsonb(t)-'source_snapshot'$old0$ IN definition)>0 THEN
  definition:=replace(definition,$old0$to_jsonb(t)-'source_snapshot'$old0$,$new0$jsonb_build_object('id',t.id,'organization_id',t.organization_id,'customer_id',t.customer_id,'consumer_unit_id',t.consumer_unit_id,'month',t.month,'version',t.version,'previous_id',t.previous_id,'basis',t.basis,'payload_hash',t.payload_hash,'report',t.report,'created_by',t.created_by,'created_at',t.created_at)$new0$);
 ELSIF position($new0$jsonb_build_object('id',t.id,'organization_id',t.organization_id,'customer_id',t.customer_id,'consumer_unit_id',t.consumer_unit_id,'month',t.month,'version',t.version,'previous_id',t.previous_id,'basis',t.basis,'payload_hash',t.payload_hash,'report',t.report,'created_by',t.created_by,'created_at',t.created_at)$new0$ IN definition)=0 THEN RAISE EXCEPTION 'Closing response projection changed; manual migration review required'; END IF;
 IF position($old1$to_jsonb(r)-'source_snapshot'$old1$ IN definition)>0 THEN
  definition:=replace(definition,$old1$to_jsonb(r)-'source_snapshot'$old1$,$new1$jsonb_build_object('id',r.id,'organization_id',r.organization_id,'customer_id',r.customer_id,'consumer_unit_id',r.consumer_unit_id,'month',r.month,'version',r.version,'previous_id',r.previous_id,'basis',r.basis,'payload_hash',r.payload_hash,'report',r.report,'created_by',r.created_by,'created_at',r.created_at)$new1$);
 ELSIF position($new1$jsonb_build_object('id',r.id,'organization_id',r.organization_id,'customer_id',r.customer_id,'consumer_unit_id',r.consumer_unit_id,'month',r.month,'version',r.version,'previous_id',r.previous_id,'basis',r.basis,'payload_hash',r.payload_hash,'report',r.report,'created_by',r.created_by,'created_at',r.created_at)$new1$ IN definition)=0 THEN RAISE EXCEPTION 'Closing response projection changed; manual migration review required'; END IF;
 IF position($old2$to_jsonb(old)-'source_snapshot'$old2$ IN definition)>0 THEN
  definition:=replace(definition,$old2$to_jsonb(old)-'source_snapshot'$old2$,$new2$jsonb_build_object('id',old.id,'organization_id',old.organization_id,'customer_id',old.customer_id,'consumer_unit_id',old.consumer_unit_id,'month',old.month,'version',old.version,'previous_id',old.previous_id,'basis',old.basis,'payload_hash',old.payload_hash,'report',old.report,'created_by',old.created_by,'created_at',old.created_at)$new2$);
 ELSIF position($new2$jsonb_build_object('id',old.id,'organization_id',old.organization_id,'customer_id',old.customer_id,'consumer_unit_id',old.consumer_unit_id,'month',old.month,'version',old.version,'previous_id',old.previous_id,'basis',old.basis,'payload_hash',old.payload_hash,'report',old.report,'created_by',old.created_by,'created_at',old.created_at)$new2$ IN definition)=0 THEN RAISE EXCEPTION 'Closing response projection changed; manual migration review required'; END IF;
 EXECUTE definition;
END $migration$;
COMMIT;
