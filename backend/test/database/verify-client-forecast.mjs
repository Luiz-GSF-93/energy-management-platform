// Disposable database only; never write these fixtures to a live tenant.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aclFixture} from './acl-test-fixture.mjs';
const {db,client,actor,call,migrate}=await aclFixture();let checks=0;
const check=value=>{assert.ok(value);checks++;},deny=async fn=>{await assert.rejects(fn,e=>e.code==='42501');checks++;};
try{
 await db.exec("ALTER TABLE licenses ADD COLUMN report_generation boolean DEFAULT true; CREATE TABLE monthly_energy_settlements(organization_id text,customer_id text,consumer_unit_id text,financial_group_id uuid,status text,validation_status text,financial_hash text,version_number int,month date);");
 await migrate('20261006_r2_published_reports.sql');await migrate('20261009_energy_forecast.sql');await migrate('20261009_energy_forecast_client.sql');await migrate('20261009_energy_forecast_formula_versions.sql');
 const seed=async(org,customer,unit,version,actions)=>{
  const id=randomUUID();await db.query("INSERT INTO energy_forecast_runs(id,organization_id,customer_id,consumer_unit_id,version,cutoff,request_id,request,sources,body,payload_hash,created_by) VALUES($1,$2,$3,$4,$5,'2026-08',$6,'{}','[]','{}',$7,'fixture')",[id,org,customer,unit,version,randomUUID(),'a'.repeat(64)]);
  for(const action of actions)await db.query('INSERT INTO energy_forecast_events(organization_id,run_id,action,request_id,note,actor) VALUES($1,$2,$3,$4,$5,$6)',[org,id,action,randomUUID(),'Disposable test publication only.','fixture']);return id;
 };
 const first=await seed('o1','c1','u1',1,['VALIDATED','PUBLISHED']);await seed('o1','c1','u1',2,['VALIDATED']);await seed('o1','c1','u1',3,[]);await seed('o2','c2','u2',1,['VALIDATED','PUBLISHED']);
 const read=()=>call('energy_forecast_client_published',['o1',client,'client']);
 check((await read()).rows.length===1);check((await read()).rows[0].id===first);
 const latest=await seed('o1','c1','u1',4,['VALIDATED','PUBLISHED']);check((await read()).rows[0].id===latest);
 await deny(()=>call('energy_forecast_client_published',['o2',client,'client']));await deny(()=>call('energy_forecast_client_published',['o1',actor,'r1']));await deny(()=>call('energy_forecast_client_published',['o1',client,'r1']));
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await deny(read);await db.exec('RESET ROLE');}
 await db.exec('SET ROLE service_role');check((await read()).rows[0].id===latest);await deny(()=>db.exec('SELECT * FROM energy_forecast_runs'));await db.exec('RESET ROLE');
 for(const update of ["UPDATE organization_members SET status='INACTIVE' WHERE role_id='client'","UPDATE organization_members SET affiliation_type='internal' WHERE role_id='client'","UPDATE organization_members SET exclusive_customer_id='c2' WHERE role_id='client'","UPDATE roles SET permissions='[]' WHERE id='client'","UPDATE roles SET scope='global' WHERE id='client'","UPDATE customers SET deleted_at=now() WHERE id='c1'","UPDATE licenses SET report_generation=false WHERE organization_id='o1'"]){
  await db.exec('BEGIN');await db.exec(update);await deny(read);await db.exec('ROLLBACK');
 }
 await db.query("INSERT INTO platform_organization_sessions VALUES('o1',$1,now()+interval '1 hour',NULL)",[client]);await deny(read);
 await db.exec('DELETE FROM platform_organization_sessions');await db.exec("UPDATE consumer_units SET status='INACTIVE' WHERE id='u1'");check((await read()).rows.length===0);
 check((await db.query("SELECT proconfig FROM pg_proc WHERE proname='energy_forecast_client_published'")).rows[0].proconfig.includes('search_path=pg_catalog'));
 console.log(JSON.stringify({ok:true,checks}));
}finally{await db.close();}
