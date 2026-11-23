const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let checks=0;const test=async(expected)=>{assert.equal((await db.query("select eva_intake_unstarted_closing('11111111-1111-4111-8111-111111111111') allowed")).rows[0].allowed,expected);checks++};try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE eva_automatic_intakes(id uuid,organization_id text,unit_id text,customer_id text,month text,state text);
 CREATE TABLE calculation_preparation_runs(organization_id text,consumer_unit_id text,month text);
 CREATE TABLE eva_assisted_closing_versions(organization_id text,customer_id text,month text,report jsonb);
 CREATE TABLE eva_automatic_intake_events(organization_id text,intake_id uuid,event text,sequence int,body jsonb);
 CREATE FUNCTION eva_intake_unstarted_closing(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 REVOKE ALL ON FUNCTION eva_intake_unstarted_closing(uuid) FROM PUBLIC,anon,authenticated,service_role;
 CREATE FUNCTION eva_intake_approval_overlaps(p_report jsonb,p_unit text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(CASE WHEN p_report#>>'{scope,kind}'='UNIT' AND jsonb_typeof(p_report#>'{scope,unitIds}')='array' THEN
 CASE WHEN jsonb_array_length(p_report#>'{scope,unitIds}')=1 AND p_report->'unitIds'=p_report#>'{scope,unitIds}' AND jsonb_typeof(p_report#>'{scope,unitIds,0}')='string' AND p_report#>>'{scope,unitIds,0}' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
 THEN (p_report#>'{scope,unitIds}') ? p_unit ELSE true END ELSE true END,true)$$;
 INSERT INTO eva_automatic_intakes VALUES('11111111-1111-4111-8111-111111111111','orgA','22222222-2222-4222-8222-222222222222','customerA','2026-07','UNKNOWN');`);
 const migration=fs.readFileSync(__dirname+'/../src/database/migrations/20261355_eva_unstarted_capture_recovery.sql','utf8');await db.exec(migration);
 const event=async(stage,cause)=>db.query("INSERT INTO eva_automatic_intake_events SELECT 'orgA','11111111-1111-4111-8111-111111111111','unknown',coalesce(max(sequence),0)+1,jsonb_build_object('diagnostic',jsonb_build_object('stage',$1::text,'cause',$2::text)) FROM eva_automatic_intake_events",[stage,cause]);
 await test(false);
 for(const cause of ['HTTP_409','HTTP_503','EVA_CLOSING_CAPTURE_LIMIT']){await event('CLOSING_PREPARATION',cause);await test(true)}
 for(const stage of ['OCR_SUBMITTING','DRAFT_PREPARATION','ARCHIVING','IDENTITY_CHECK']){await event(stage,'HTTP_503');await test(false)}
 await event('CLOSING_PREPARATION','UNAVAILABLE');await test(false);await event('CLOSING_PREPARATION','HTTP_503');
 await db.exec("INSERT INTO calculation_preparation_runs VALUES('orgA','22222222-2222-4222-8222-222222222222','2026-07')");await test(false);await db.exec('DELETE FROM calculation_preparation_runs');
 await db.exec("INSERT INTO calculation_preparation_runs VALUES('orgB','22222222-2222-4222-8222-222222222222','2026-07'),('orgA','other','2026-07'),('orgA','22222222-2222-4222-8222-222222222222','2026-06')");await test(true);
 const closing=async(report)=>{await db.exec('DELETE FROM eva_assisted_closing_versions');await db.query("INSERT INTO eva_assisted_closing_versions VALUES('orgA','customerA','2026-07',$1)",[JSON.stringify(report)])};
 const unit=id=>({scope:{kind:'UNIT',unitIds:[id]},unitIds:[id]});
 await closing(unit('33333333-3333-4333-8333-333333333333'));await test(true);
 for(const report of [unit('22222222-2222-4222-8222-222222222222'),{},null,{scope:{kind:'CUSTOMER'}},{scope:{kind:'UNIT',unitIds:['bad']},unitIds:['bad']},{scope:{kind:'UNIT',unitIds:['33333333-3333-4333-8333-333333333333']},unitIds:[]}]){await closing(report);await test(false)}
 await db.exec('DELETE FROM eva_assisted_closing_versions');await db.exec("UPDATE eva_automatic_intakes SET state='PREPARING'");await test(false);await db.exec("UPDATE eva_automatic_intakes SET state='UNKNOWN'");
 await db.exec(migration);await test(true);
 for(const role of ['anon','authenticated','service_role']){assert.equal((await db.query("SELECT has_function_privilege($1,'eva_intake_unstarted_closing(uuid)','EXECUTE') allowed",[role])).rows[0].allowed,false);checks++}
 console.log('Unstarted capture recovery:',checks,'checks passed');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
