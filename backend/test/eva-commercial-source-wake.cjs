const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=v=>{assert(v);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE eva_automatic_intakes(id uuid PRIMARY KEY,organization_id text,customer_id text,month text,state text,closing_id uuid,lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz DEFAULT 'infinity',source_revision bigint DEFAULT 0);
CREATE TABLE eva_automatic_intake_events(intake_id uuid,organization_id text,event text,body jsonb,actor_id text);
CREATE TABLE calculation_preparation_runs(id uuid PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,month text,document_id text,source_hash text,source_basis text);
CREATE TABLE calculation_preparation_run_events(run_id uuid,organization_id text,sequence int,state text);
CREATE TABLE calculation_preparation_reconciliations(run_id uuid PRIMARY KEY,organization_id text);
CREATE TABLE eva_assisted_closing_versions(id uuid PRIMARY KEY,organization_id text,report jsonb);
CREATE TABLE eva_assisted_closing_events(closing_id uuid,state text);
CREATE FUNCTION eva_intake_event(p_id uuid,p_event text,p_body jsonb,p_actor text) RETURNS void LANGUAGE sql SET search_path=public AS $$INSERT INTO eva_automatic_intake_events SELECT id,organization_id,p_event,p_body,p_actor FROM eva_automatic_intakes WHERE id=p_id$$;
CREATE FUNCTION calculation_preparation_effective_state(o text,r uuid) RETURNS text LANGUAGE sql SET search_path=public AS $$SELECT CASE WHEN EXISTS(SELECT 1 FROM calculation_preparation_reconciliations WHERE run_id=r AND organization_id=o) THEN 'PARTIAL' ELSE coalesce((SELECT state FROM calculation_preparation_run_events WHERE run_id=r AND organization_id=o ORDER BY sequence DESC LIMIT 1),'RUNNING') END$$;
CREATE FUNCTION eva_intake_source_fingerprint(uuid,uuid) RETURNS text LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.deny_source',true)='true' THEN RAISE EXCEPTION 'Source access denied' USING ERRCODE='42501';END IF;RETURN repeat('a',64);END$$;
`);
const migration=fs.readFileSync(__dirname+'/../src/database/migrations/20261311_eva_commercial_completion_refresh.sql','utf8');await db.exec(migration);
for(const [n,org,customer,month,state] of [[1,'org','customer','2026-01','AWAITING_SOURCES'],[2,'org','customer','2026-01','PROPOSAL_READY'],[3,'other','customer','2026-01','AWAITING_SOURCES'],[4,'org','customer','2026-02','AWAITING_SOURCES'],[5,'org','another','2026-01','AWAITING_SOURCES'],[6,'org','customer','2026-01','PROPOSAL_READY'],[7,'org','customer','2026-01','PREPARING']])await db.query('INSERT INTO eva_automatic_intakes(id,organization_id,customer_id,month,state) VALUES($1,$2,$3,$4,$5)',[id(n),org,customer,month,state]);
await db.query("INSERT INTO eva_assisted_closing_events VALUES($1,'APPROVED')",[id(60)]);await db.query('UPDATE eva_automatic_intakes SET closing_id=$1 WHERE id=$2',[id(60),id(6)]);
await db.query("UPDATE eva_automatic_intakes SET lease_token=$1,lease_until=now()+interval '5 minutes' WHERE id=$2",[id(70),id(7)]);
await db.query("INSERT INTO calculation_preparation_runs VALUES($1,'org','customer','unit','2026-01','source',$2,$3)",[id(10),'b'.repeat(64),'c'.repeat(64)]);
await db.query("INSERT INTO calculation_preparation_run_events VALUES($1,'org',1,'RUNNING')",[id(10)]);
const rows=()=>db.query('SELECT id,source_revision::int revision,next_attempt_at::text next FROM eva_automatic_intakes ORDER BY id').then(r=>r.rows);
ok((await rows()).every(r=>r.revision===0));
const state=()=>db.query('SELECT eva_intake_source_state($1,$2) v',[id(7),id(70)]).then(r=>r.rows[0].v);const before=await state();
await db.query("INSERT INTO calculation_preparation_run_events VALUES($1,'org',2,'PARTIAL')",[id(10)]);
const after=await state(),woken=await rows();ok(before.fingerprint!==after.fingerprint);ok(after.revision===1);ok(/^[a-f0-9]{64}$/.test(after.fingerprint));
for(const n of [1,2]){const r=woken.find(r=>r.id===id(n));ok(r.revision===1&&r.next!=='infinity');}
for(const n of [3,4,5,6]){const r=woken.find(r=>r.id===id(n));ok(r.revision===0&&r.next==='infinity');}
ok(woken.find(r=>r.id===id(7)).next==='infinity');
await deny(()=>db.query('SELECT eva_intake_source_state($1,$2)',[id(7),id(71)]));await db.exec("SET test.deny_source='true'");await deny(state);await db.exec("SET test.deny_source='false'");
const warning={units:[{id:'unit',missing:['Há uma reserva de preparação comercial ainda não confirmada. Confira o histórico.']}]};
await db.query("INSERT INTO eva_assisted_closing_versions VALUES($1,'org',$2)",[id(80),JSON.stringify(warning)]);
await db.query("INSERT INTO eva_automatic_intakes(id,organization_id,customer_id,month,state,closing_id) VALUES($1,'org','customer','2026-01','AWAITING_SOURCES',$2)",[id(8),id(80)]);
await db.exec(migration);ok((await rows()).find(r=>r.id===id(8)).revision===1);await db.exec(migration);ok((await rows()).find(r=>r.id===id(8)).revision===1);
ok((await db.query("SELECT count(*)::int n FROM eva_automatic_intake_events WHERE intake_id=$1 AND event='COMMERCIAL_STATE_REFRESH_REQUESTED'",[id(8)])).rows[0].n===1);
ok(JSON.stringify((await db.query('SELECT report FROM eva_assisted_closing_versions WHERE id=$1',[id(80)])).rows[0].report)===JSON.stringify(warning));
await db.query("INSERT INTO calculation_preparation_runs VALUES($1,'org','uncertain','unit','2026-01','source',$2,$3)",[id(11),'d'.repeat(64),'e'.repeat(64)]);await db.query("INSERT INTO calculation_preparation_run_events VALUES($1,'org',2,'UNKNOWN')",[id(11)]);
await db.query("INSERT INTO eva_automatic_intakes(id,organization_id,customer_id,month,state,closing_id) VALUES($1,'org','uncertain','2026-01','AWAITING_SOURCES',$2)",[id(9),id(80)]);
await db.exec(migration);ok((await rows()).find(r=>r.id===id(9)).revision===0);
await db.query("INSERT INTO calculation_preparation_reconciliations VALUES($1,'org')",[id(11)]);ok((await rows()).find(r=>r.id===id(9)).revision===1);
ok((await db.query('SELECT state FROM calculation_preparation_run_events WHERE run_id=$1',[id(11)])).rows[0].state==='UNKNOWN');
ok((await db.query('SELECT state FROM eva_assisted_closing_events WHERE closing_id=$1',[id(60)])).rows[0].state==='APPROVED');
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await deny(state);await db.exec('RESET ROLE');}
for(const role of ['anon','authenticated','service_role'])ok(!(await db.query("SELECT has_function_privilege($1,'eva_intake_commercial_digest(text,text,text)','EXECUTE') p",[role])).rows[0].p);
console.log('Commercial readiness refresh SQL:',checks,'checks passed');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
