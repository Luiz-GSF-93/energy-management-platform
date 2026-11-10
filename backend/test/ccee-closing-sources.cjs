const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let checks=0;const ok=value=>{assert(value);checks++};try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE consumer_units(id text,organization_id text,customer_id text,status text);
 CREATE TABLE ccee_unit_authorizations(id uuid,organization_id text,customer_id text,consumer_unit_id text,revision int,status text,valid_from date,valid_to date,service_scope jsonb,dri_tax_id text);
 CREATE TABLE ccee_integration_jobs(id uuid,organization_id text,authorization_id uuid,kind text,state text,month date,finished_at timestamptz,created_at timestamptz DEFAULT now(),request_payload jsonb,result jsonb);
 CREATE FUNCTION assert_ccee_data_actor(o text,a text,m text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF o<>'org' OR a<>'actor' OR m<>'view' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END IF;END$$;
 CREATE FUNCTION assert_ccee_data_binding(o text,b uuid,m date,s text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
 INSERT INTO consumer_units VALUES('u','org','c','ACTIVE'),('u2','org','c','ACTIVE'),('foreign','other','x','ACTIVE');
 INSERT INTO ccee_unit_authorizations VALUES('00000000-0000-4000-8000-000000000001','org','c','u',1,'APPROVED','2023-01-01',NULL,'["DRI_READ"]','123');`);
 await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261304_ccee_closing_sources.sql','utf8'));
 const read=async(org='org',actor='actor',unit='u',month='2026-01')=>(await db.query('SELECT ccee_closing_sources($1,$2,$3,$4) value',[org,actor,unit,month])).rows[0].value;
 for(const args of [['other','actor','foreign'],['org','foreign','u'],['org','actor','foreign'],['org','actor','u','2026-99']]){await assert.rejects(read(...args));checks++;}
 const insert=async(n,report,frame,month='2026-01-01',status='SUCCEEDED',org='org')=>db.query(`INSERT INTO ccee_integration_jobs(id,organization_id,authorization_id,kind,state,month,finished_at,request_payload,result) VALUES($1,$2,'00000000-0000-4000-8000-000000000001','DRI_RESULTS',$3,$4,'2026-11-01T00:00:00Z'::timestamptz+$5*interval '1 minute',$6,'{"complete":true}')`,['00000000-0000-4000-8000-'+String(n).padStart(12,'0'),org,status,month,n,JSON.stringify({reportId:report,frameId:frame})]);
 for(let n=1;n<=15;n++)await insert(n,'119','470');await insert(16,'56','264');await insert(17,'70','318','2026-02-01');await insert(18,'119','470','2026-01-01','FAILED');await insert(19,'119','470','2026-01-01','SUCCEEDED','other');
 let result=await read();ok(result.jobs.length===2);ok(result.jobs.find(j=>j.report_id==='119').id.endsWith('000000000015'));ok(result.binding.consumer_unit_id==='u');ok(result.allocationAmbiguous===false);
 await db.exec(`INSERT INTO ccee_unit_authorizations VALUES('00000000-0000-4000-8000-000000000002','org','c','u2',1,'APPROVED','2023-01-01',NULL,'["DRI_READ"]','123');`);ok((await read()).allocationAmbiguous===true);
 await db.exec(`INSERT INTO ccee_unit_authorizations VALUES('00000000-0000-4000-8000-000000000003','org','c','u',2,'DRAFT','2023-01-01',NULL,'["DRI_READ"]','123');`);result=await read();ok(result.binding===null&&result.jobs.length===0);
 for(const role of ['anon','authenticated'])ok(!(await db.query("SELECT has_function_privilege($1,'ccee_closing_sources(text,text,text,text)','EXECUTE') allowed",[role])).rows[0].allowed);
 ok((await db.query("SELECT has_function_privilege('service_role','ccee_closing_sources(text,text,text,text)','EXECUTE') allowed")).rows[0].allowed);
 console.log('CCEE closing sources SQL: '+checks+' checks passed');
}finally{await db.close();}})().catch(error=>{console.error(error);process.exitCode=1});
