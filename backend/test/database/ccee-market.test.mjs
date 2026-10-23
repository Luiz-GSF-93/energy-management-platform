import {PGlite} from '@electric-sql/pglite';
import {driPostgresAdapter} from './ccee-dri-postgres-adapter.mjs';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const real=process.env.CCEE_MARKET_TEST_CONTAINER;const db=real?driPostgresAdapter(real):new PGlite();let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;},deny=async p=>{await assert.rejects(p);checks++;};
const query=async(sql,args=[])=>{const r=await db.query(sql,args);return r.rows[0]?.result;};
const action=(org,actor,id,body)=>query('SELECT ccee_market_schedule($1,$2,$3,$4) result',[org,actor,id,JSON.stringify(body)]);
const read=(org='org',actor='admin',patch={})=>query('SELECT ccee_market_read($1,$2,$3) result',[org,actor,JSON.stringify({from:'2026-03-01',to:'2026-03-31',granularity:'MONTH',origin:'ALL',submarkets:['SE_CO','S','NE','N'],page:0,...patch})]);
const reserve=(j,limit=20)=>query('SELECT ccee_market_reserve($1,$2,$3) result',[j.id,j.leaseId,limit]);
const finish=(j,data,error=null)=>query('SELECT ccee_market_finish($1,$2,$3,$4) result',[j.id,j.leaseId,data?JSON.stringify(data):null,error]);
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE organizations(id text PRIMARY KEY);INSERT INTO organizations VALUES('org'),('foreign');
 CREATE TABLE actors(org text,id text,can_manage boolean,active boolean);INSERT INTO actors VALUES('org','admin',true,true),('org','viewer',false,true),('foreign','other',true,true);
 CREATE TABLE ccee_unit_authorizations(id uuid PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,meter_code text,principal_profile_code text,active boolean);
 CREATE TABLE ccee_integration_events(id uuid DEFAULT gen_random_uuid(),organization_id text,actor_id text,event text,request_id uuid,details jsonb,recorded_at timestamptz DEFAULT now());
 CREATE TABLE ccee_integration_jobs(organization_id text,kind text,state text,month date,finished_at timestamptz,error_code text,created_at timestamptz);
 CREATE TABLE energy_price_pld_monthly(organization_id text,month date,submarket text,mean_brl_mwh numeric,source text,source_hash text,hours integer,published_at timestamptz,provider text);
 CREATE FUNCTION acl_preserve_record() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Immutable' USING ERRCODE='42501';END$$;
 CREATE FUNCTION assert_ccee_data_actor(o text,a text,action text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT 1 FROM public.actors WHERE org=o AND id=a AND active AND(action='view' OR can_manage)) THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END IF;END$$;
 CREATE FUNCTION assert_ccee_data_binding(o text,i uuid,m date,s text) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE a public.ccee_unit_authorizations;BEGIN SELECT * INTO a FROM public.ccee_unit_authorizations WHERE id=i AND organization_id=o AND active;IF NOT FOUND THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END IF;RETURN to_jsonb(a);END$$;`);
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261217_ccee_market_hourly.sql',import.meta.url),'utf8'));
 await deny(action('org','other',null,{action:'configure'}));await deny(action('org','viewer',null,{action:'configure'}));
 const cfg={action:'configure',requestId:randomUUID(),kind:'PLD_HOURLY',maxRequests:2,dailyLimit:60,dayOffset:0,reason:'Synthetic approved pilot only'};
 const schedule=await action('org','admin',null,cfg);ok(schedule.id);
 const empty=await read();ok(empty.schedules[0].frequency_seconds===3600&&empty.schedules[0].next_run_at===null,'paused schedule promises no refresh');
 await deny(action('org','admin',schedule.id,{action:'toggle',enabled:true,reason:'Not yet homologated'}));
 await action('org','admin',schedule.id,{action:'collect',day:'2026-03-01',reason:'One synthetic collection'});
 const job=await query('SELECT ccee_market_claim($1,false) result',['org']);ok(job.kind==='PLD_HOURLY'&&job.day==='2026-03-01');ok(await query('SELECT ccee_market_claim($1,false) result',['org'])===null,'no duplicate claim');
 await reserve(job);await reserve(job);await deny(reserve(job));
 const rows=Array.from({length:24},(_,i)=>['SE_CO','S','NE','N'].map(submarket=>({start:new Date(Date.parse('2026-03-01T00:00:00-03:00')+i*3600000).toISOString(),end:new Date(Date.parse('2026-03-01T00:00:00-03:00')+(i+1)*3600000).toISOString(),submarket,value:100+i}))).flat();
 const data={kind:'PLD_HOURLY',day:'2026-03-01',sourceHash:'a'.repeat(64),rows,complete:true};ok((await finish(job,data)).stored);
 const daily=await read('org','viewer',{granularity:'DAY'});ok(daily.rows.length===4&&daily.rows.every(r=>r.hours===24),'daily source coverage preserved');ok(daily.rows[0].value==='111.500000');
 const foreign=await read('foreign','other');ok(foreign.rows.length===0&&foreign.schedules.length===0,'other tenant receives no observations');await deny(read('org','other'));
 await db.query('INSERT INTO energy_price_pld_monthly VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8)',['org','2026-03-01','SE_CO','222.22','https://official.invalid/monthly','b'.repeat(64),744,'CCEE']);
 const monthly=await read();ok(monthly.rows.filter(r=>r.submarket==='SE_CO').length===1&&monthly.rows.find(r=>r.submarket==='SE_CO').value==='222.220000','published monthly source wins without fabricated hourly detail');
 await action('org','admin',schedule.id,{action:'toggle',enabled:true,reason:'Complete source homologated'});const active=await read();ok(active.schedules[0].enabled&&active.schedules[0].next_run_at&&active.schedules[0].last_success_at&&active.schedules[0].last_source_at,'last success and next actual due returned');
 await action('org','admin',schedule.id,{action:'collect',day:'2026-03-01',reason:'Idempotent same source'});const second=await query('SELECT ccee_market_claim($1,false) result',['org']);await reserve(second);await finish(second,data);ok((await query("SELECT count(*)::integer result FROM ccee_price_observations"))===96,'same revision is not duplicated');
 await deny(finish(second,data));await deny(db.exec("UPDATE ccee_price_observations SET value_brl_mwh=0"));
 await deny(read('org','admin',{granularity:'HOUR',to:'2026-05-31'}));
 const binding=randomUUID();await db.query('INSERT INTO ccee_unit_authorizations VALUES($1,$2,$3,$4,$5,$6,true)',[binding,'org','customer','unit','METER','123']);
 const privateSchedule=await action('org','admin',null,{...cfg,requestId:randomUUID(),kind:'MEASUREMENTS_5M',authorizationId:binding});await action('org','admin',privateSchedule.id,{action:'collect',day:'2026-03-01',reason:'Synthetic private source'});
 ok(await query('SELECT ccee_market_claim($1,false) result',['org'])===null,'disabled private adapter does not consume job');
 const privateJob=await query('SELECT ccee_market_claim($1,true) result',['org']);ok(privateJob.binding.meter_code==='METER');
 await db.exec("UPDATE actors SET active=false WHERE org='org' AND id='admin'");await deny(reserve(privateJob));ok((await finish(privateJob,null,'ACCESS_CHANGED')).stored===false);await db.exec("UPDATE actors SET active=true WHERE org='org' AND id='admin'");
 const privateState=(await read()).schedules.find(s=>s.id===privateSchedule.id);ok(privateState.state==='BLOCKED'&&!privateState.enabled&&privateState.next_run_at===null,'revocation blocks collection and removes next due');
 // Exhaustion is aggregate across schedules and includes profile/pagination calls.
 await deny(action('org','admin',null,{...cfg,requestId:randomUUID(),dailyLimit:30}));
 for(const table of ['ccee_price_observations','ccee_measurement_intervals','ccee_sync_schedules']){
  ok((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',[table])).rows[0].relrowsecurity);
  ok(!(await db.query("SELECT has_table_privilege('service_role',$1,'SELECT') allowed",[table])).rows[0].allowed);
 }
 if(real){
  await action('org','admin',schedule.id,{action:'collect',day:'2026-03-02',reason:'Concurrent workers in disposable PostgreSQL'});
  const claims=await Promise.all([query('SELECT ccee_market_claim($1,false) result',['org']),query('SELECT ccee_market_claim($1,false) result',['org'])]);ok(claims.filter(Boolean).length===1,'one lease across independent connections');
  await finish(claims.find(Boolean),null,'TEST_STOP');
 }
 // Three functional failures suspend hourly calls instead of retrying indefinitely.
 for(let i=0;i<3;i++){
  await action('org','admin',schedule.id,{action:'collect',day:'2026-03-03',reason:'Synthetic rejection safety check'});
  const j=await query('SELECT ccee_market_claim($1,false) result',['org']);await finish(j,null,'PROVIDER_REJECTED');
 }
 const blocked=(await read()).schedules.find(s=>s.id===schedule.id);ok(blocked.state==='BLOCKED'&&!blocked.enabled&&blocked.next_run_at===null);
 ok((await read()).requestUsage.total===3,'each authorization/page reservation counted');
 console.log(checks+' CCEE market '+(real?'PostgreSQL':'PGlite')+' checks passed');
}catch(e){console.error('check',checks,e.message,e.where??'',e.stack);process.exitCode=1;}finally{await db.close();}
