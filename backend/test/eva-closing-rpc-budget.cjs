const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let checks=0;try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE authenticator;ALTER ROLE authenticator SET statement_timeout='8s';CREATE SCHEMA portal_scope;CREATE TABLE portal_scope.routines(original_oid oid,source_hash text);CREATE FUNCTION portal_scope.function_signature(o oid) RETURNS text LANGUAGE sql AS $$SELECT md5(jsonb_build_array(prosrc,proconfig,prosecdef)::text) FROM pg_proc WHERE oid=o$$;`);
 const names=['eva_assisted_closing_action','eva_contract_closing_action','eva_documented_closing_action'];
 for(const ns of ['public','portal_scope'])for(const name of names)await db.exec(`CREATE FUNCTION ${ns}.${name}(p_org text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT p_org$$;REVOKE ALL ON FUNCTION ${ns}.${name}(text) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION ${ns}.${name}(text) TO service_role;`);
 await db.exec(`CREATE FUNCTION public.unrelated_rpc() RETURNS text LANGUAGE sql SET statement_timeout='8s' AS $$SELECT 'untouched'$$;INSERT INTO portal_scope.routines SELECT oid,portal_scope.function_signature(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'eva_%';`);
 const state=async()=>(await db.query(`SELECT oid,prosrc,prosecdef,proacl::text,proconfig FROM pg_proc WHERE proname=ANY($1) ORDER BY oid`,[names])).rows;
 const before=await state(),roleBefore=(await db.query("SELECT rolconfig FROM pg_roles WHERE rolname='authenticator'")).rows;
 const migration=fs.readFileSync(__dirname+'/../src/database/migrations/20261247_eva_closing_rpc_budget.sql','utf8');await db.exec(migration);
 const after=await state();assert.equal(after.length,6);checks++;
 for(let n=0;n<after.length;n++){assert.deepEqual({...after[n],proconfig:null},{...before[n],proconfig:null});assert(after[n].proconfig.includes('statement_timeout=30s'));assert(after[n].proconfig.includes('search_path=pg_catalog'));checks++;}
 assert.deepEqual((await db.query("SELECT rolconfig FROM pg_roles WHERE rolname='authenticator'")).rows,roleBefore);checks++;
 assert((await db.query("SELECT proconfig FROM pg_proc WHERE oid='public.unrelated_rpc()'::regprocedure")).rows[0].proconfig.includes('statement_timeout=8s'));checks++;
 assert((await db.query('SELECT bool_and(source_hash=portal_scope.function_signature(original_oid)) valid FROM portal_scope.routines')).rows[0].valid);checks++;
 await db.exec(migration);assert.deepEqual(await state(),after);checks++;
 for(const role of ['anon','authenticated']){assert(!(await db.query("SELECT has_function_privilege($1,'public.eva_documented_closing_action(text)','EXECUTE') allowed",[role])).rows[0].allowed);checks++;}
 console.log('Closing RPC budget:',checks,'checks passed; only bounded closing settings change, bodies/grants/roles/scoped signatures preserved.');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
