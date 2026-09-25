// Isolated integration test: no production credentials or network.
import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);require('reflect-metadata');const {EntryDraftService}=require('../../dist/modules/contracts/services/entry-drafts.service.js');const {ContractConfigurationsService}=require('../../dist/modules/contracts/services/configurations.service.js');
const db=new PGlite();let checks=0;const ok=x=>{assert.ok(x);checks++;};const q=n=>'"'+n.replaceAll('"','""')+'"';
class Query{
 constructor(table){this.table=table;this.filters=[];this.params=[];this.op='select';}
 select(){return this;}order(k,o={ascending:true}){this.orderSql=' ORDER BY '+q(k)+(o.ascending?' ASC':' DESC');return this;}range(a,b){this.rangeSql=' LIMIT '+(b-a+1)+' OFFSET '+a;return this;}eq(k,v){this.params.push(v);this.filters.push(q(k)+'=$'+this.params.length);return this;}neq(k,v){this.params.push(v);this.filters.push(q(k)+'<>$'+this.params.length);return this;}is(k,v){assert.equal(v,null);this.filters.push(q(k)+' IS NULL');return this;}
 insert(rows){this.op='insert';this.values=rows[0];return this;} update(values){this.op='update';this.values=values;return this;}single(){return this.execute(true);}maybeSingle(){return this.execute(true);}then(resolve,reject){return this.execute(false).then(resolve,reject);}
 async execute(single){const p=[...this.params];const bind=v=>{p.push(v!==null&&typeof v==='object'?JSON.stringify(v):v);return '$'+p.length;};const where=this.filters.length?' WHERE '+this.filters.join(' AND '):'';const sql=this.op==='insert'?'INSERT INTO '+q(this.table)+' ('+Object.keys(this.values).map(q).join(',')+') VALUES ('+Object.values(this.values).map(bind).join(',')+') RETURNING *':this.op==='update'?'UPDATE '+q(this.table)+' SET '+Object.entries(this.values).map(([k,v])=>q(k)+'='+bind(v)).join(',')+where+' RETURNING *':'SELECT * FROM '+q(this.table)+where+(this.orderSql||'')+(this.rangeSql||'');try{const r=await db.query(sql,p);const data=JSON.parse(JSON.stringify(r.rows));return {data:single?data[0]||null:data,error:null};}catch(error){return {data:null,error};}}
}
try{
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;CREATE TABLE organizations(id text primary key);CREATE TABLE customers(id text primary key,organization_id text,deleted_at timestamptz);CREATE TABLE consumer_units(id text primary key DEFAULT gen_random_uuid()::text,organization_id text,customer_id text);CREATE TABLE energy_contracts(id text primary key DEFAULT gen_random_uuid()::text,organization_id text,customer_id text);CREATE TABLE service_agreements(id text primary key DEFAULT gen_random_uuid()::text,organization_id text,customer_id text);CREATE TABLE management_contracts(id text primary key DEFAULT gen_random_uuid()::text,organization_id text,customer_id text,contract_number text UNIQUE,remuneration_model text,fixed_fee_monthly numeric,savings_percentage numeric,start_date date,end_date date,application_rules text,status text);GRANT ALL ON organizations,customers,consumer_units,energy_contracts,management_contracts,service_agreements TO service_role');
 const migration=readFileSync(new URL('../../src/database/migrations/20260925_f1_38_contract_entry.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);ok(true);
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 await db.exec("INSERT INTO organizations VALUES ('org-a'),('org-b');INSERT INTO customers VALUES ('"+a+"','org-a',null),('"+b+"','org-b',null);INSERT INTO consumer_units(id,organization_id,customer_id) VALUES ('"+a+"','org-a','"+a+"'),('"+b+"','org-b','"+b+"');SET ROLE service_role");
 let entitled=true;const client={getClient:()=>({from:t=>new Query(t)})},licenses={requireEntitlement:async()=>{if(!entitled)throw Object.assign(new Error('License'),{getStatus:()=>403});}},configs=new ContractConfigurationsService(client,licenses,{}),s=new EntryDraftService(client,licenses,{}, {},configs);
 const t={organizationId:'org-a',userId:'author',permissions:[],role:'gestor'},other={...t,organizationId:'org-b'},deny=async(fn,status)=>{await assert.rejects(fn,e=>e.getStatus?.()===status);checks++;};
 const body={customerId:a,kind:'management',payload:{contractNumber:'TEST',remunerationModel:'FIXED',fixedFeeMonthly:0,savingsPercentage:0,startDate:'2026-01-01',endDate:'2026-12-31',applicationRules:'Teste'}};
 const pending=await s.create({...body,payload:{contractNumber:'Partial'},deferredSteps:[1]},t);ok(pending.status==='INCOMPLETE'&&pending.issues.includes('step:1'));ok(pending.payload.fixedFeeMonthly===undefined);
 const list=await s.list(t);ok(list[0].id===pending.id);ok((await s.list(other)).length===0);
 await deny(()=>s.create({...body,customerId:b},t),404);await deny(()=>s.create({...body,kind:'distributor'},t),403);await deny(()=>s.create({...body,payload:{consumerUnitId:b}},t),404);
 await deny(()=>s.update(pending.id,{...body,revision:1},other),404);
 await deny(()=>s.register(pending.id,{revision:1},t),400);
 const draft=await s.update(pending.id,{...body,revision:1},t);ok(draft.status==='DRAFT'&&draft.revision===2&&draft.payload.fixedFeeMonthly===0);
 await deny(()=>s.update(draft.id,{...body,revision:1},t),409);await deny(()=>s.update(draft.id,{...body,kind:'services',revision:2},t),409);
 await deny(()=>s.register(draft.id,{revision:1},t),409);
 const registered=await s.register(draft.id,{revision:2},{...t,userId:'reviewer'});ok(registered.status==='REGISTERED'&&registered.target_id&&registered.updated_by==='reviewer');
 const retry=await s.register(draft.id,{revision:2},t);ok(retry.target_id===registered.target_id);ok((await db.query('SELECT * FROM management_contracts')).rows.length===1);
 await deny(()=>s.update(draft.id,{...body,revision:registered.revision},t),409);
 const audit=(await db.query('SELECT * FROM contract_entry_events ORDER BY revision')).rows;ok(audit.length===3&&audit[2].actor_id==='reviewer');
 await assert.rejects(()=>db.query("UPDATE contract_entry_drafts SET status='DRAFT' WHERE id=$1",[draft.id]));checks++;
 await assert.rejects(()=>db.query('DELETE FROM management_contracts WHERE id=$1',[registered.target_id]));checks++;
 const conflict=await s.create(body,t);await deny(()=>s.register(conflict.id,{revision:1},t),409);ok((await s.list(t)).find(r=>r.id===conflict.id).status==='DRAFT');
 const wrong=await s.create({...body,payload:{...body.payload,contractNumber:'OTHER'}},t);
 await assert.rejects(()=>db.query('INSERT INTO management_contracts(organization_id,customer_id,entry_draft_id,entry_draft_revision,entry_draft_actor) VALUES ($1,$2,$3,1,$4)',['org-b',b,wrong.id,'actor']));checks++;
 ok((await s.list(t)).find(r=>r.id===wrong.id).status==='DRAFT');
 entitled=false;await deny(()=>s.list(t),403);entitled=true;
 await db.exec('RESET ROLE');
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(()=>db.query('SELECT * FROM contract_entry_drafts'));checks++;await assert.rejects(()=>db.query('SELECT * FROM contract_entry_events'));checks++;await db.exec('RESET ROLE');}
 console.log('Guided entry database checks passed:',checks);
}finally{await db.close();}
