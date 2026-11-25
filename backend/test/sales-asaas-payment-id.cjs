const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();let checks=0;
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE platform_sales_asaas_bindings(id int PRIMARY KEY,payment_id text NOT NULL CHECK(payment_id ~ '^pay_[a-zA-Z0-9]{1,100}$'),amount_cents bigint NOT NULL);
 CREATE TABLE platform_sales_creation_events(id int PRIMARY KEY,payment_id text CHECK(payment_id ~ '^pay_[a-zA-Z0-9]{1,100}$'));
 CREATE TABLE platform_sales_cycle_bindings(id int PRIMARY KEY,payment_id text NOT NULL CHECK(payment_id ~ '^pay_[a-zA-Z0-9]{1,100}$'));
 CREATE FUNCTION platform_sales_asaas_action(uuid,text,jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF $3->>'id' !~ '^pay_[a-zA-Z0-9]{1,100}$' THEN RAISE EXCEPTION 'Invalid ID';END IF;RETURN $3;END$$;
 CREATE FUNCTION platform_sales_creation_action(uuid,text,jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('valid',$3->>'id' ~ '^pay_[a-zA-Z0-9]{1,100}$','preservedRecoveryGuard','keep') $$;
 REVOKE ALL ON FUNCTION platform_sales_asaas_action(uuid,text,jsonb),platform_sales_creation_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION platform_sales_asaas_action(uuid,text,jsonb),platform_sales_creation_action(uuid,text,jsonb) TO service_role;
 INSERT INTO platform_sales_asaas_bindings VALUES(1,'pay_old123',260000);`);
 const before=(await db.query('SELECT * FROM platform_sales_asaas_bindings')).rows;
 const sql=fs.readFileSync('src/database/migrations/20261363_asaas_payment_identifier_compatibility.sql','utf8');await db.exec(sql);await db.exec(sql);
 assert.deepEqual((await db.query('SELECT * FROM platform_sales_asaas_bindings')).rows,before);checks++;
 for(const table of ['platform_sales_asaas_bindings','platform_sales_creation_events','platform_sales_cycle_bindings']){
  await db.query(`INSERT INTO ${table}(id,payment_id${table==='platform_sales_asaas_bindings'?',amount_cents':''}) VALUES(2,$1${table==='platform_sales_asaas_bindings'?',260000':''})`,['pay_0_example123']);checks++;
  for(const bad of ['pay_','pay_a/b','pay_a?token=x','pay_'+ 'x'.repeat(101)]){await assert.rejects(()=>db.query(`INSERT INTO ${table}(id,payment_id${table==='platform_sales_asaas_bindings'?',amount_cents':''}) VALUES(3,$1${table==='platform_sales_asaas_bindings'?',0':''})`,[bad]),e=>e.code==='23514');checks++;}
 }
 const body=JSON.stringify({id:'pay_0_example123'});assert.equal((await db.query('SELECT platform_sales_asaas_action(NULL,$1,$2) r',['inbox',body])).rows[0].r.id,'pay_0_example123');checks++;
 const creation=(await db.query('SELECT platform_sales_creation_action(NULL,$1,$2) r',['finish',body])).rows[0].r;assert.deepEqual(creation,{valid:true,preservedRecoveryGuard:'keep'});checks++;
 for(const name of ['platform_sales_asaas_action','platform_sales_creation_action']){
  const f=(await db.query("select prosecdef,proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') auth,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where proname=$1",[name])).rows[0];assert.equal(f.prosecdef,true);assert.equal(f.anon,false);assert.equal(f.auth,false);assert.equal(f.service,true);assert.deepEqual(f.proconfig,['search_path=pg_catalog']);checks++;
 }
 await db.close();console.log('Asaas identifier compatibility: '+checks+' SQL checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
