// Isolated PostgreSQL-compatible verification; never connects to production.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);require('reflect-metadata');
const {ContractsService}=require('../../dist/modules/contracts/services/contracts.service.js');
const {ContractConfigurationsService}=require('../../dist/modules/contracts/services/configurations.service.js');
const db=new PGlite();let checks=0;const ok=(x)=>{assert.ok(x);checks++;};
const q=n=>'"'+n.replaceAll('"','""')+'"';
class Query{
 constructor(table){this.table=table;this.filters=[];this.params=[];this.op='select';}
 select(){return this;}eq(k,v){this.params.push(v);this.filters.push(q(k)+'=$'+this.params.length);return this;}is(k,v){assert.equal(v,null);this.filters.push(q(k)+' IS NULL');return this;}
 insert(rows){this.op='insert';this.values=rows[0];return this;}single(){return this.execute(true);}maybeSingle(){return this.execute(true);}then(resolve,reject){return this.execute(false).then(resolve,reject);}
 async execute(single){const p=[...this.params];const bind=v=>{p.push(v);return '$'+p.length;};const where=this.filters.length?' WHERE '+this.filters.join(' AND '):'';const sql=this.op==='insert'?'INSERT INTO '+q(this.table)+' ('+Object.keys(this.values).map(q).join(',')+') VALUES ('+Object.values(this.values).map(bind).join(',')+') RETURNING *':'SELECT * FROM '+q(this.table)+where;try{const r=await db.query(sql,p);const data=JSON.parse(JSON.stringify(r.rows));return {data:single?data[0]||null:data,error:null};}catch(error){return {data:null,error};}}
}
try{
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;CREATE TABLE organizations(id text primary key)');
 const fixture=JSON.parse(readFileSync(new URL('./contracts-fixture.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
 for(const t of ['customers','consumer_units','energy_contracts','management_contracts']){const columns=fixture.columns.filter(c=>c.table===t).map(c=>q(c.name)+' '+c.type+(c.not_null?' NOT NULL':'')+(c.default?' DEFAULT '+c.default:''));await db.exec('CREATE TABLE '+q(t)+' ('+columns.join(',')+',PRIMARY KEY(id));GRANT ALL ON '+q(t)+' TO service_role');}
 const schema=readFileSync(new URL('../../../docs/supabase-schema.sql',import.meta.url),'utf8');const start=schema.indexOf('CREATE TABLE contract_price_history');await db.exec(schema.slice(start,schema.indexOf(');',start)+2));await db.exec('GRANT ALL ON contract_price_history TO service_role');
 const migration=readFileSync(new URL('../../src/database/migrations/20260925_f1_27_contract_configurations.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);ok(true);
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',c='00000000-0000-4000-8000-000000000003';
 await db.exec("INSERT INTO organizations VALUES ('org-a'),('org-b');INSERT INTO customers(id,organization_id,company_name,document) VALUES ('"+a+"','org-a','A','A'),('"+b+"','org-b','B','B');INSERT INTO consumer_units(id,organization_id,customer_id,consumer_unit_number,distributor,tariff_group) VALUES ('"+a+"','org-a','"+a+"','A','D','A4'),('"+b+"','org-b','"+b+"','B','D','A4');INSERT INTO energy_contracts(id,organization_id,customer_id,consumer_unit_id,contract_number,contract_type,contracted_volume_mwh,current_price,start_date,end_date,status) VALUES ('"+c+"','org-a','"+a+"','"+a+"','E-1','ENERGY_PURCHASE',100,250,'2026-01-01','2027-12-31','ACTIVE');SET ROLE service_role;");
 const client={getClient:()=>({from:t=>new Query(t)})},license={requireEntitlement:async()=>{}};const contracts=new ContractsService(client,license);const service=new ContractConfigurationsService(client,license,contracts);
 const denied=async(action,status)=>{await assert.rejects(action,e=>e.getStatus?.()===status);checks++;};
 const fee={customerId:a,contractNumber:'G-2026',remunerationModel:'HYBRID',fixedFeeMonthly:100,savingsPercentage:10,startDate:'2026-01-01',endDate:'2026-12-31',applicationRules:'Mensal para todo cliente'};
 const m=await service.createManagement(fee,'org-a');ok(m.fixed_fee_monthly===100&&m.savings_percentage===10&&m.application_rules===fee.applicationRules);
 await denied(()=>service.createManagement({...fee,contractNumber:'overlap'},'org-a'),409);
 await service.createManagement({...fee,contractNumber:'G-2027',startDate:'2027-01-01',endDate:'2027-12-31'},'org-a');ok((await service.listManagement('org-a')).length===2);ok((await service.listManagement('org-b')).length===0);
 await denied(()=>service.createManagement(fee,'org-b'),404);
 await assert.rejects(()=>db.query('UPDATE management_contracts SET fixed_fee_monthly=1 WHERE id=$1',[m.id]),e=>e.code==='P3271');checks++;
 const period={startDate:'2026-01-01',endDate:'2026-12-31',pricePerMwh:260,reason:'Preço 2026'};const price=await service.addPrice(c,period,'org-a');ok(price.price_per_mwh===260);
 await denied(()=>service.addPrice(c,period,'org-a'),409);await denied(()=>service.prices(c,'org-b'),404);
 await service.addPrice(c,{...period,startDate:'2027-01-01',endDate:'2027-12-31',pricePerMwh:275},'org-a');ok((await service.prices(c,'org-a')).length===2);ok((await contracts.findOne(c,'org-a')).current_price===250);
 await assert.rejects(()=>db.query('UPDATE contract_price_history SET price_per_mwh=1 WHERE id=$1',[price.id]),e=>e.code==='P3271');checks++;
 const agreement={customerId:a,consumerUnitId:a,agreementType:'INTERMEDIATION',contractNumber:'I-1',counterparty:'Consultor',description:'Intermediação',billingBasis:'CUSTOM',startDate:'2026-01-01',endDate:'2026-12-31',applicationRules:'Conforme cláusula comercial'};const row=await service.createService(agreement,'org-a');ok(row.agreed_value===null);await denied(()=>service.createService({...agreement,consumerUnitId:b},'org-a'),404);ok((await service.listServices('org-b')).length===0);
 await assert.rejects(()=>db.query('DELETE FROM service_agreements WHERE id=$1',[row.id]),e=>e.code==='42501');checks++;
 await db.exec('RESET ROLE');await assert.rejects(()=>db.query('DELETE FROM service_agreements WHERE id=$1',[row.id]),e=>e.code==='P3271');checks++;const rights=await db.query("SELECT bool_and(NOT has_table_privilege(r,t,'SELECT') AND NOT has_table_privilege(r,t,'INSERT')) AS restricted FROM unnest(ARRAY['anon','authenticated']) r CROSS JOIN unnest(ARRAY['management_contracts','service_agreements','contract_price_history']) t");ok(rights.rows[0].restricted);
 console.log(JSON.stringify({status:'passed',checks},null,2));
}finally{await db.close();}
