import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite(),actor='11111111-1111-4111-8111-111111111111',plan='22222222-2222-4222-8222-222222222222',subscription='33333333-3333-4333-8333-333333333333';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const body={coreSubscriptionId:subscription,revision:1,plan:{id:plan,version:1,support:{enabled:true,annual_tickets:5,extra_ticket_cents:2500}},payment:{cycle:'MONTHLY'}};
const sync=b=>q('SELECT platform_core_license_sync($1,$2) v',[actor,JSON.stringify(b)]);
try{
 // Only the existing sync boundary is stubbed. The entitlement migration and read summary execute as real PostgreSQL functions.
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE licenses(id text PRIMARY KEY,organization_id text,plan_id uuid,active boolean,status text,start_date date,end_date date,central_support_enabled boolean DEFAULT false,governance_revision integer DEFAULT 1,updated_at timestamptz);
 CREATE TABLE central_support_policies(plan_id uuid PRIMARY KEY,revision integer,allowance integer,extra_minor integer,updated_by uuid);
 CREATE TABLE central_support_cycles(id uuid PRIMARY KEY,organization_id text,starts date,ends date,policy jsonb);
 CREATE TABLE platform_core_license_links(core_subscription_id uuid PRIMARY KEY,license_id text,revision integer,license_revision integer);
 CREATE TABLE platform_core_plan_links(plan_id uuid,core_plan_id uuid,core_version integer,cycle text);
 CREATE FUNCTION central_support_summary(c_id uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('id',c_id,'totalUsed',2)$$;
 CREATE FUNCTION platform_core_license_sync(p_actor uuid,p_body jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF p_actor<>'${actor}'::uuid THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('organizationId','tenant-a','licenseId','license-a');END$$;
 INSERT INTO licenses(id,organization_id,plan_id,active,status,start_date)VALUES('license-a','tenant-a','${plan}',true,'ACTIVE',CURRENT_DATE);
 INSERT INTO platform_core_license_links VALUES('${subscription}','license-a',1,1);
 INSERT INTO platform_core_plan_links VALUES('${plan}','${plan}',1,'MONTHLY');`);
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261365_core_support_entitlements.sql',import.meta.url),'utf8'));
 for(const role of ['anon','authenticated']){
  assert.equal((await q('SELECT has_function_privilege($1,\'platform_core_license_sync(uuid,jsonb)\',\'EXECUTE\') v',[role]))[0].v,false);
  assert.equal((await q('SELECT has_function_privilege($1,\'central_support_license_usage(text)\',\'EXECUTE\') v',[role]))[0].v,false);
 }
 assert.equal((await q("SELECT has_function_privilege('service_role','platform_core_license_sync_before_support(uuid,jsonb)','EXECUTE') v"))[0].v,false);
 await sync(body);
 assert.equal((await q("SELECT central_support_enabled v FROM licenses WHERE id='license-a'"))[0].v,true);
 assert.equal((await q('SELECT allowance FROM central_support_policies'))[0].allowance,5);
 const revision=(await q("SELECT governance_revision FROM licenses WHERE id='license-a'"))[0].governance_revision;
 await sync(body);assert.equal((await q("SELECT governance_revision FROM licenses WHERE id='license-a'"))[0].governance_revision,revision);
 const usage=(await q("SELECT central_support_license_usage('tenant-a') v"))[0].v;
 assert.equal(usage.contracted,5);assert.equal(usage.currentCycle,null);
 assert.equal((await q('SELECT count(*)::int n FROM central_support_cycles'))[0].n,0);
 assert.equal((await q("SELECT central_support_license_usage('tenant-b') v"))[0].v,null);
 await assert.rejects(()=>sync({...body,plan:{...body.plan,support:{enabled:true,annual_tickets:-1,extra_ticket_cents:0}}}));
 await assert.rejects(()=>sync({...body,plan:{...body.plan,support:{enabled:true,annual_tickets:3,extra_ticket_cents:2500}}}));
 await q("UPDATE licenses SET governance_revision=governance_revision+1 WHERE id='license-a'");
 await assert.rejects(()=>sync(body));
 // An old successful event must not reapply old limits after a newer command.
 await q('UPDATE platform_core_license_links SET revision=2');await sync(body);
 assert.equal((await q('SELECT allowance FROM central_support_policies'))[0].allowance,5);
 await db.exec('SET ROLE service_role');
 assert.equal((await q("SELECT central_support_license_usage('tenant-a') v"))[0].v.contracted,5);
 console.log('Core support entitlement PostgreSQL checks passed');
}finally{await db.close();}
