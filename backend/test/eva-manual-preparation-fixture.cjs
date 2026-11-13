// Shared disposable fixture; same real calculation and manual-queue migrations.
const fs=require('node:fs'),path=require('node:path');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
module.exports=async function(db){
 const baseline=fs.readFileSync(path.join(__dirname,'calculation-autofill.cjs'),'utf8').split('await db.exec(`')[1].split('`);')[0].replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n)).replace(/\$\{'a'\.repeat\(64\)\}/g,'a'.repeat(64));await db.exec(baseline);
 await db.exec(fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261109_calculation_autofill.sql'),'utf8'));
 await db.exec(`ALTER TABLE organization_members ADD COLUMN permission_limit jsonb;
 CREATE FUNCTION preserve_operation_history() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable' USING ERRCODE='23514';END$$;
 CREATE TABLE eva_assisted_closing_versions(id uuid PRIMARY KEY,organization_id text,customer_id text,month text,report jsonb);
 CREATE TABLE eva_assisted_closing_events(closing_id uuid,sequence integer,state text);
 CREATE TABLE eva_automatic_intakes(id uuid PRIMARY KEY,organization_id text,customer_id text,unit_id text,month text,state text,lease_token uuid,lease_until timestamptz);
 CREATE TABLE eva_operational_runs(id uuid PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,month text,kind text,state text,write_started boolean,lease_id uuid,lease_until timestamptz);
 CREATE FUNCTION calculation_preparation_effective_state(text,uuid) RETURNS text LANGUAGE sql AS $$SELECT state FROM public.calculation_preparation_run_events WHERE organization_id=$1 AND run_id=$2 ORDER BY sequence DESC LIMIT 1$$;
 CREATE FUNCTION transition_eva_automatic_intake(uuid,uuid,text,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN UPDATE public.eva_automatic_intakes SET state='PREPARING' WHERE id=$1 AND lease_token=$2;RETURN '{"began":true}';END$$;
 CREATE FUNCTION eva_flow_worker(text,uuid,uuid,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN UPDATE public.eva_operational_runs SET write_started=true WHERE id=$2 AND lease_id=$3;RETURN '{"began":true}';END$$;
 INSERT INTO roles VALUES('admin','org','organization','admin_org','["8f105b02-4443-49de-b188-847e0284e7ed","60f9690a-145b-4dba-b23f-9f945baca296","92e1b670-ab10-483a-b825-c6e16799496d","beb6ec90-8ba8-40ce-a156-aeef6cc75cce"]');
 INSERT INTO organization_members(organization_id,user_id,role_id,status,affiliation_type) VALUES('org','${id(24)}','admin','ACTIVE','internal');
 INSERT INTO consumer_units VALUES('${id(3)}','org','customer','ACTIVE');`);
 const migration=fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261315_eva_manual_preparation_queue.sql'),'utf8');await db.exec(migration);await db.exec(migration);
};
