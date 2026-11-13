// Disposable database: exercise the exact production migration and preserve ACLs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const names=['calculation_autofill_action','calculation_autofill_reconcile','calculation_autofill_reconcile_running','eva_assisted_closing_action','eva_closing_change_action','eva_closing_publication_action','eva_document_review_queue','eva_flow_action','eva_flow_reconcile_interrupted','eva_flow_worker','eva_intake_identity_action','eva_intake_restore','eva_invoice_attention','eva_tariff_workbench_action'];
(async()=>{const db=new PGlite();let checks=0;const ok=v=>{assert(v);checks++;};try{
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA portal_scope;CREATE TABLE portal_scope.routines(original_oid oid);CREATE TABLE synthetic_financial(id int,amount numeric);INSERT INTO synthetic_financial VALUES(1,42)');
 for(const name of names)await db.exec(`CREATE FUNCTION public.${name}(text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='8s' AS $$BEGIN IF $1='forbidden' THEN RAISE EXCEPTION 'tenant denied' USING ERRCODE='42501';END IF;IF $1='conflict' THEN RAISE EXCEPTION 'application conflict' USING ERRCODE = '40001';END IF;RETURN $1;END$$;REVOKE ALL ON FUNCTION public.${name}(text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.${name}(text) TO service_role`);
 await db.exec("CREATE FUNCTION unrelated_conflict() RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'unrelated' USING ERRCODE='40001';END$$");
 const meta=()=>db.query("SELECT proname,prosecdef,proconfig,proacl::text,pg_get_function_identity_arguments(oid) args FROM pg_proc WHERE proname=ANY($1) ORDER BY proname",[names]).then(r=>JSON.stringify(r.rows));
 const before=await meta(),migration=fs.readFileSync(path.join(__dirname,'../src/database/migrations/20261323_eva_calculation_domain_conflicts.sql'),'utf8');
 await db.exec("INSERT INTO portal_scope.routines SELECT 'eva_flow_worker(text)'::regprocedure::oid");
 await assert.rejects(()=>db.exec(migration),e=>e.code==='55000');checks++;await db.exec('ROLLBACK');
 ok((await db.query("SELECT prosrc FROM pg_proc WHERE oid='calculation_autofill_action(text)'::regprocedure")).rows[0].prosrc.includes("'40001'"));
 await db.exec('DELETE FROM portal_scope.routines');await db.exec(migration);await db.exec(migration);ok(await meta()===before);
 for(const name of names){await assert.rejects(()=>db.query(`SELECT ${name}('conflict')`),e=>e.code==='PT409');checks++;await assert.rejects(()=>db.query(`SELECT ${name}('forbidden')`),e=>e.code==='42501');checks++;ok((await db.query(`SELECT ${name}('ok') result`)).rows[0].result==='ok');ok(!(await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',['authenticated',name+'(text)'])).rows[0].allowed);}
 await assert.rejects(()=>db.exec('SELECT unrelated_conflict()'),e=>e.code==='40001');checks++;
 await assert.rejects(()=>db.exec("DO $$BEGIN RAISE SQLSTATE '40001' USING MESSAGE='engine serialization';END$$"),e=>e.code==='40001');checks++;
 ok((await db.query('SELECT amount::text FROM synthetic_financial')).rows[0].amount==='42');
 console.log(JSON.stringify({suite:'eva-calculation-domain-conflicts',checks,tenantGates:'preserved',acl:'unchanged',engineSerialization:'40001',applicationConflict:'PT409',financialWrites:0}));
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
