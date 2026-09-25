// Isolated PostgreSQL-compatible verification; never connects to production.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);require('reflect-metadata');
const {ContractsService}=require('../../dist/modules/contracts/services/contracts.service.js');
const {ConsumerUnitsService}=require('../../dist/modules/consumer-units/services/consumer-units.service.js');
const db=new PGlite();let checks=0;const ok=(x)=>{assert.ok(x);checks++;};
const q=n=>'"'+n.replaceAll('"','""')+'"';
class Query{
 constructor(table){this.table=table;this.filters=[];this.params=[];this.op='select';}
 select(){return this;}eq(k,v){this.params.push(v);this.filters.push(q(k)+'=$'+this.params.length);return this;}is(k,v){assert.equal(v,null);this.filters.push(q(k)+' IS NULL');return this;}
 insert(rows){this.op='insert';this.values=rows[0];return this;} update(values){this.op='update';this.values=values;return this;}single(){return this.execute(true);}maybeSingle(){return this.execute(true);}then(resolve,reject){return this.execute(false).then(resolve,reject);}
 async execute(single){const p=[...this.params];const bind=v=>{p.push(v!==null&&typeof v==='object'?JSON.stringify(v):v);return '$'+p.length;};const where=this.filters.length?' WHERE '+this.filters.join(' AND '):'';const sql=this.op==='insert'?'INSERT INTO '+q(this.table)+' ('+Object.keys(this.values).map(q).join(',')+') VALUES ('+Object.values(this.values).map(bind).join(',')+') RETURNING *':this.op==='update'?'UPDATE '+q(this.table)+' SET '+Object.entries(this.values).map(([k,v])=>q(k)+'='+bind(v)).join(',')+where+' RETURNING *':'SELECT * FROM '+q(this.table)+where;try{const r=await db.query(sql,p);const data=JSON.parse(JSON.stringify(r.rows));return {data:single?data[0]||null:data,error:null};}catch(error){return {data:null,error};}}
}
try{
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;CREATE TABLE organizations(id text primary key)');
 const fixture=JSON.parse(readFileSync(new URL('./contracts-fixture.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
 for(const t of ['customers','consumer_units','energy_contracts','management_contracts']){const columns=fixture.columns.filter(c=>c.table===t).map(c=>q(c.name)+' '+c.type+(c.not_null?' NOT NULL':'')+(c.default?' DEFAULT '+c.default:''));await db.exec('CREATE TABLE '+q(t)+' ('+columns.join(',')+',PRIMARY KEY(id));GRANT ALL ON '+q(t)+' TO service_role');}
 const schema=readFileSync(new URL('../../../docs/supabase-schema.sql',import.meta.url),'utf8');const start=schema.indexOf('CREATE TABLE contract_price_history');await db.exec(schema.slice(start,schema.indexOf(');',start)+2));await db.exec('GRANT ALL ON contract_price_history TO service_role');
 // The captured fixture predates the existing consumer-unit display-name column.
 await db.exec('ALTER TABLE consumer_units ADD COLUMN IF NOT EXISTS name varchar(255)');
 const migration=readFileSync(new URL('../../src/database/migrations/20260925_f1_28_electrical_supply_terms.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);ok(true);
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 await db.exec("INSERT INTO organizations VALUES ('org-a'),('org-b');INSERT INTO customers(id,organization_id,company_name,document) VALUES ('"+a+"','org-a','A','A'),('"+b+"','org-b','B','B');SET ROLE service_role");
 const client={getClient:()=>({from:t=>new Query(t)})},licenses={requireEntitlement:async()=>{}};
 const units=new ConsumerUnitsService(client),contracts=new ContractsService(client,licenses);
 const deny=async(fn,status)=>{await assert.rejects(fn,e=>e.getStatus?.()===status);checks++;};
 const electric={customerId:a,name:'Factory',code:'UC1',distributor:'D',tariffGroup:'A',tariffSubgroup:'A4',tariffModality:'BLUE',contractedDemandPeak:100,contractedDemandOffPeak:200,demandTariffPeak:32.5,demandTariffOffPeak:18.2,energyTariffPeak:0.55,energyTariffOffPeak:0.25,reactiveEnergyTariff:0.1,freeMarket:true,consumptionClass:'INDUSTRIAL',lastDemandAdjustmentDate:'2026-01-01',lastDemandPeak:100,lastDemandOffPeak:200};
 const unit=await units.create(electric,'org-a');ok(Number(unit.contracted_demand_peak)===100&&unit.free_market===true&&unit.tariff_subgroup==='A4');
 await units.update(unit.id,'org-a',{freeMarket:false,demandTariffPeak:0});const changed=await units.findOne(unit.id,'org-a');ok(changed.free_market===false&&Number(changed.demand_tariff_peak)===0&&Number(changed.contracted_demand_off_peak)===200);
 await deny(()=>units.findOne(unit.id,'org-b'),404);await deny(()=>units.create({...electric,code:'BAD',customerId:b},'org-a'),404);
 for(const change of [{tariffGroup:'B'},{tariffSubgroup:'B1'},{contractedDemandPeak:null},{lastDemandAdjustmentDate:null},{lastDemandPeak:null},{energyTariffPeak:-1},{consumptionClass:'INVALID'},{freeMarket:'yes'}])await deny(()=>units.update(unit.id,'org-a',change),400);
 await units.update(unit.id,'org-a',{tariffModality:'GREEN',contractedDemand:180,contractedDemandPeak:null,contractedDemandOffPeak:null,lastDemandPeak:null,lastDemandOffPeak:null,lastDemandValue:180});ok((await units.findOne(unit.id,'org-a')).tariff_modality==='GREEN');
 const body={consumerUnitId:unit.id,contractNumber:'E1',contractType:'ENERGY_PURCHASE',contractedVolumeMwh:100,currentPrice:250,startDate:'2026-01-01',endDate:'2027-12-31',pricingMode:'MIXED',adjustmentIndex:'IPCA',adjustmentDate:'2026-01-01',adjustmentRule:'Acumulado anual conforme contrato',adjustmentFrequency:'ANNUAL',annualPrices:[{startDate:'2026-01-01',endDate:'2026-12-31',pricePerMwh:250,priceStatus:'FINAL'},{startDate:'2027-01-01',endDate:'2027-12-31',pricePerMwh:270,priceStatus:'BASE'}],guaranteeType:'BANK_GUARANTEE',guaranteeAmount:10000,guaranteeInstitution:'Institution'};
 const row=await contracts.create(body,'org-a');ok(row.annual_prices.length===2&&Number(row.guarantee_amount)===10000);await deny(()=>contracts.findOne(row.id,'org-b'),404);
 const invalid=[{guaranteeInstitution:''},{guaranteeAmount:-1},{guaranteeType:'OTHER'},{adjustmentRule:''},{adjustmentDate:null},{pricingMode:'FIXED'},{currentPrice:251},{annualPrices:[body.annualPrices[0]]},{annualPrices:[body.annualPrices[0],{...body.annualPrices[1],startDate:'2027-01-02'}]},{annualPrices:[{...body.annualPrices[0],endDate:'2027-12-31'}]},{annualPrices:[{...body.annualPrices[0],pricePerMwh:'250'}]},{annualPrices:[{...body.annualPrices[0],startDate:'2026-02-30'}]},{annualPrices:[{...body.annualPrices[0],unexpected:'x'}]}];
 for(const change of invalid)await deny(()=>contracts.create({...body,contractNumber:'BAD',...change},'org-a'),400);
 await deny(()=>contracts.update(row.id,'org-a',{endDate:'2026-12-31'}),400);
 await contracts.update(row.id,'org-a',{guaranteeType:'INSURANCE',guaranteeAmount:20000,guaranteeInstitution:'Insurance'});ok((await contracts.findOne(row.id,'org-a')).guarantee_type==='INSURANCE');
 await contracts.update(row.id,'org-a',{status:'ACTIVE'});await deny(()=>contracts.update(row.id,'org-a',{guaranteeAmount:1}),409);
 await assert.rejects(()=>db.query('UPDATE energy_contracts SET guarantee_amount=1 WHERE id=$1',[row.id]),e=>e.code==='P3282');checks++;
 const legacy=await contracts.create({consumerUnitId:unit.id,contractNumber:'Legacy',contractType:'ENERGY_PURCHASE',contractedVolumeMwh:10,currentPrice:100,startDate:'2026-01-01',endDate:'2026-12-31'},'org-a');ok(legacy.annual_prices.length===0);
 console.log(JSON.stringify({status:'passed',checks},null,2));
}finally{await db.close();}
