import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const ok=(x,m)=>{assert.ok(x,m);checks++;};
const a='00000000-0000-4000-8000-000000000001',u='00000000-0000-4000-8000-000000000002',foreign='00000000-0000-4000-8000-000000000003';
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE customers(id text primary key,organization_id text,status text,deleted_at timestamptz);
 CREATE TABLE consumer_units(id text primary key,organization_id text,customer_id text,status text);
 CREATE TABLE management_contracts(id text primary key,organization_id text,customer_id text,status text,start_date date,end_date date,remuneration_model text,savings_percentage numeric);
 CREATE TABLE eva_assisted_closing_versions(id uuid primary key,organization_id text,customer_id text,month text);
 CREATE TABLE eva_assisted_closing_events(organization_id text,closing_id uuid,sequence int,state text);`);
 for(const name of ['20260925_f1_53_management_allocations.sql','20261328_management_variable_unit_basis.sql','20261352_management_fee_defaults.sql'])await db.exec(readFileSync(new URL('../../src/database/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261352_management_fee_defaults.sql',import.meta.url),'utf8'));
 await db.query("INSERT INTO customers VALUES ($1,'org','ACTIVE',null),($2,'foreign','ACTIVE',null)",[a,foreign]);
 await db.query("INSERT INTO consumer_units VALUES ($1,'org',$1,'ACTIVE'),($2,'org',$1,'ACTIVE'),($3,'foreign',$3,'ACTIVE')",[a,u,foreign]);
 await db.query("INSERT INTO management_contracts VALUES ($1,'org',$1,'ACTIVE','2026-01-01',null,'HYBRID',8),($2,'foreign',$2,'ACTIVE','2026-01-01',null,'FIXED',0)",[a,foreign]);
 const ensure=async(month='2026-02',org='org',unit=u)=>(await db.query('SELECT ensure_management_fee_default($1,$2,$3,$4) r',[org,'preparer',unit,month])).rows[0].r;
 const rule=async(month,def,prev=null)=>{const r=await db.query(`INSERT INTO management_fee_allocations(organization_id,customer_id,contract_id,month,fixed_fee_basis,variable_fee_basis,allocations,source,reason,previous_id,created_by,is_default) VALUES ('org',$1,$1,$2,'PER_UNIT','PER_UNIT','[]','Confirmed 8 percent per unit','Reviewed recurring policy',$3,'admin',$4) RETURNING *`,[a,month,prev,def]);return r.rows[0];};
 await rule('2026-01',false);ok((await ensure()).reason==='NO_CONFIRMED_DEFAULT','Unmarked monthly exception cannot become a standing policy');
 const policy=await rule('2026-02',true);ok((await ensure()).reason==='EXPLICIT_MONTHLY_RULE','Explicit monthly rule takes precedence');
 let result=await ensure('2026-03');ok(result.created&&result.sourceRuleId===policy.id,'Recurring policy materialized for next month');
 let derived=(await db.query('SELECT * FROM management_fee_allocations WHERE id=$1',[result.ruleId])).rows[0];ok(derived.variable_fee_basis==='PER_UNIT'&&derived.allocations.length===0&&derived.inherited_from===policy.id&&!derived.is_default&&derived.created_by==='preparer','Derived rule records immutable source and actual actor');
 ok(!(await ensure('2026-03')).created,'Repeated preparation is idempotent');
 const count=async()=>Number((await db.query("SELECT count(*) n FROM management_fee_allocations WHERE month='2026-03'")).rows[0].n);ok(await count()===1,'No duplicate monthly versions');
 const policy2=await rule('2026-02',true,policy.id);result=await ensure('2026-03');ok(result.created&&result.sourceRuleId===policy2.id&&await count()===2,'Correction of standing policy yields a new derived version');
 await rule('2026-02',false,policy2.id);ok((await ensure('2026-03')).needsReview,'Revoked source cannot silently authorize an existing derived rule');
 const manual=await rule('2026-04',false);ok((await ensure('2026-04')).ruleId===manual.id,'Explicit monthly exceptions are preserved');
 const policy3=await rule('2026-05',true);await db.query("INSERT INTO eva_assisted_closing_versions VALUES ($1,'org',$2,'2026-06')",[policy.id,a]);await db.query("INSERT INTO eva_assisted_closing_events VALUES ('org',$1,1,'APPROVED')",[policy.id]);ok((await ensure('2026-06')).reason==='PRESERVED_APPROVAL','Approved snapshots are never rewritten');
 result=await ensure('2026-07');ok(result.sourceRuleId===policy3.id,'Most recent eligible recurring source wins');
 await assert.rejects(()=>ensure('2026-07','foreign',u),e=>e.code==='42501');checks++;
 await assert.rejects(()=>ensure('2026-99'),e=>e.code==='22023');checks++;
 await db.query("UPDATE management_contracts SET end_date='2026-08-15' WHERE id=$1",[a]);ok((await ensure('2026-08')).reason==='PARTIAL_CONTRACT_PERIOD','Partial contract needs a decision, no invented prorating');ok((await ensure('2026-09')).reason==='CONTRACT_SCOPE_REVIEW','Outside contract does not inherit');
 result=await ensure('2026-02','foreign',foreign);ok(result.created&&result.sourceRuleId===null,'Fixed-only contract derives its per-unit basis without new financial assumptions');
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(()=>ensure(),e=>e.code==='42501');checks++;await db.exec('RESET ROLE');}
 await assert.rejects(()=>db.exec("UPDATE management_fee_allocations SET is_default=true"),e=>e.code==='P5302');checks++;

 // Apply the new product policy only after proving legacy migration behavior.
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261358_management_fee_unit_policy.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261358_management_fee_unit_policy.sql',import.meta.url),'utf8'));
 await db.query('UPDATE management_contracts SET end_date=null WHERE id=$1',[a]);
 result=await ensure('2026-09');ok(result.created&&result.policy==='GLOBAL_PER_UNIT_V1','New hybrid month derives the unit basis without manual rule');
 let unitRule=(await db.query('SELECT * FROM management_fee_allocations WHERE id=$1',[result.ruleId])).rows[0];
 ok(unitRule.fixed_fee_basis==='PER_UNIT'&&unitRule.variable_fee_basis==='PER_UNIT'&&unitRule.allocations.length===0&&unitRule.created_by==='preparer','Full fixed and unit variable basis with actual actor');
 ok(!(await ensure('2026-09')).created,'Unit policy is idempotent');
 const shares=JSON.stringify([{consumerUnitId:a,percentage:'50'},{consumerUnitId:u,percentage:'50'}]);
 const legacy=(await db.query(`INSERT INTO management_fee_allocations(organization_id,customer_id,contract_id,month,fixed_fee_basis,variable_fee_basis,allocations,source,reason,created_by,is_default) VALUES ('org',$1,$1,'2026-10','PER_UNIT','CONSOLIDATED',$2,'Legacy consolidated rule','Historical fixture','admin',true) RETURNING *`,[a,shares])).rows[0];
 result=await ensure('2026-10');unitRule=(await db.query('SELECT * FROM management_fee_allocations WHERE id=$1',[result.ruleId])).rows[0];
 ok(result.created&&unitRule.previous_id===legacy.id&&unitRule.version===2&&unitRule.variable_fee_basis==='PER_UNIT','Unapproved legacy basis gains an audited unit-policy version');
 ok((await db.query('SELECT variable_fee_basis FROM management_fee_allocations WHERE id=$1',[legacy.id])).rows[0].variable_fee_basis==='CONSOLIDATED','Historical rule is not overwritten');
 await db.query("INSERT INTO eva_assisted_closing_events VALUES ('org',$1,2,'SUPERSEDED')",[policy.id]);
 ok((await ensure('2026-06')).reason==='PRESERVED_APPROVAL','Any prior approval is preserved even after supersession');
 const concurrent=await Promise.all([ensure('2026-11'),ensure('2026-11')]);
 ok(concurrent.filter(x=>x.created).length===1&&Number((await db.query("SELECT count(*) n FROM management_fee_allocations WHERE contract_id=$1 AND month='2026-11'",[a])).rows[0].n)===1,'Concurrent preparations create one rule');
 await assert.rejects(()=>ensure('2026-12','foreign',u),e=>e.code==='42501');checks++;
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(()=>ensure('2026-12'),e=>e.code==='42501');checks++;await db.exec('RESET ROLE');}
 ok(Number((await db.query('SELECT savings_percentage FROM management_contracts WHERE id=$1',[a])).rows[0].savings_percentage)===8,'Product basis never changes the contractual percentage');
 await db.query("INSERT INTO consumer_units VALUES ('00000000-0000-4000-8000-000000000004','org',$1,'ACTIVE')",[a]);
 ok(!(await ensure('2026-11','org','00000000-0000-4000-8000-000000000004')).created,'New unit uses the same unit policy without asking for new allocation shares');
 const beforeRollback=Number((await db.query('SELECT count(*) n FROM management_fee_allocations')).rows[0].n);
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261352_management_fee_defaults.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261358_management_fee_unit_policy.sql',import.meta.url),'utf8'));
 ok(!(await ensure('2026-11')).created&&Number((await db.query('SELECT count(*) n FROM management_fee_allocations')).rows[0].n)===beforeRollback,'Rollback and reapplication preserve captured monthly history');
 console.log('Recurring fees: '+checks+' isolated database checks passed.');
}finally{await db.close();}
