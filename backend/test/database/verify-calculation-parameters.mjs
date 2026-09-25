// Isolated PostgreSQL-compatible verification; never connects to production.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);require('reflect-metadata');
const {ContractsService}=require('../../dist/modules/contracts/services/contracts.service.js');
const {CalculationParametersService}=require('../../dist/modules/contracts/services/parameters.service.js');
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
 for(const t of ['customers','consumer_units']){const columns=fixture.columns.filter(c=>c.table===t).map(c=>q(c.name)+' '+c.type+(c.not_null?' NOT NULL':'')+(c.default?' DEFAULT '+c.default:''));await db.exec('CREATE TABLE '+q(t)+' ('+columns.join(',')+',PRIMARY KEY(id));GRANT ALL ON '+q(t)+' TO service_role');}
 const migration=readFileSync(new URL('../../src/database/migrations/20260925_f1_30_calculation_parameters.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);ok(true);
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 await db.exec("INSERT INTO organizations VALUES ('org-a'),('org-b');INSERT INTO customers(id,organization_id,company_name,document) VALUES ('"+a+"','org-a','A','A'),('"+b+"','org-b','B','B');INSERT INTO consumer_units(id,organization_id,customer_id,consumer_unit_number,distributor,tariff_group) VALUES ('"+a+"','org-a','"+a+"','A','D','A4'),('"+b+"','org-b','"+b+"','B','D','A4');SET ROLE service_role");
 let entitled=true;const client={getClient:()=>({from:t=>new Query(t)})},licenses={requireEntitlement:async()=>{if(!entitled)throw Object.assign(new Error('No license'),{getStatus:()=>403});}};
 const service=new CalculationParametersService(client,licenses),deny=async(fn,status)=>{await assert.rejects(fn,e=>e.getStatus?.()===status);checks++;};
 const body={consumerUnitId:a,kind:'TARIFF',componentCode:'TE',label:'Energia',scenario:'ACR',timeBand:'ALL',measure:'BRL_KWH',amount:'0.123456',treatment:'NET',includedTaxes:'',baseRule:'',direction:'DEBIT',source:'Tabela de teste isolado',notes:'',startDate:'2026-01-01',endDate:'2026-12-31'};
 const row=await service.create(body,'org-a','actor-a');ok(row.amount_text==='0.123456'&&row.status==='DRAFT'&&row.revision===1);ok(row.unit_context.distributor==='D');
 const updated=await service.update(row.id,{...body,amount:'0.654321',revision:1},'org-a','actor-a');ok(updated.revision===2&&updated.amount_text==='0.654321');
 await deny(()=>service.update(row.id,{...body,revision:1},'org-a','actor-a'),409);
 await deny(()=>service.one(row.id,'org-b'),404);await deny(()=>service.events(row.id,'org-b'),404);await deny(()=>service.create({...body,consumerUnitId:b},'org-a','actor-a'),404);await deny(()=>service.update(row.id,{...body,revision:2},'org-b','actor-b'),404);await deny(()=>service.approve(row.id,{revision:2},'org-b','actor-b'),404);await deny(()=>service.retire(row.id,{revision:2,reason:'x'},'org-b','actor-b'),404);ok((await service.list('org-b')).length===0);
 const approved=await service.approve(row.id,{revision:2},'org-a','approver');ok(approved.status==='APPROVED'&&approved.approved_by==='approver'&&approved.revision===3);
 await deny(()=>service.update(row.id,{...body,revision:3},'org-a','actor-a'),409);
 await assert.rejects(()=>db.query("UPDATE calculation_parameters SET amount_text='1' WHERE id=$1",[row.id]),e=>e.code==='P3302');checks++;
 const overlap=await service.create({...body,timeBand:'PEAK'},'org-a','actor-a');await deny(()=>service.approve(overlap.id,{revision:1},'org-a','approver'),409);
 const next=await service.create({...body,startDate:'2027-01-01',endDate:'2027-12-31'},'org-a','actor-a');await service.approve(next.id,{revision:1},'org-a','approver');ok(true);
 const other=await service.create({...body,consumerUnitId:b},'org-b','actor-b');await service.approve(other.id,{revision:1},'org-b','actor-b');ok(true);
 const retired=await service.retire(row.id,{revision:3,reason:'Correção da fonte'},'org-a','approver');ok(retired.status==='RETIRED'&&retired.amount_text==='0.654321'&&retired.approved_by==='approver');await service.approve(overlap.id,{revision:1},'org-a','approver');ok(true);
 const events=await service.events(row.id,'org-a');ok(events.length===4&&events.some(e=>e.action==='RETIRED'&&e.snapshot.retirement_reason==='Correção da fonte'));
 await deny(()=>service.retire(row.id,{revision:4,reason:'again'},'org-a','actor-a'),409);
 const invalid=[{amount:'-1'},{amount:'1.1234567'},{amount:0.1},{amount:'NaN'},{amount:'1e2'},{amount:null},{endDate:'2025-01-01'},{startDate:'2026-02-30'},{treatment:'GROSS'},{measure:'PERCENT'},{direction:'CREDIT'},{label:' '},{source:''},{created_by:'spoof'},{organization_id:'org-b'},{status:'APPROVED'},{componentCode:'bad code'},{componentCode:'OTHER_'},{componentCode:'OTHER'}];
 for(const change of invalid)await deny(()=>service.create({...body,...change},'org-a','actor-a'),400);
 const tax={...body,kind:'TAX',componentCode:'ICMS',label:'ICMS',measure:'PERCENT',amount:'18',treatment:'INSIDE',baseRule:'Base informada conforme fonte'};
 const tx=await service.create(tax,'org-a','actor-a');ok(tx.amount_text==='18');
 for(const change of [{amount:'100'},{baseRule:''},{measure:'BRL_MWH'},{timeBand:'PEAK'},{direction:'CREDIT'},{treatment:'NET'},{componentCode:'UNKNOWN'},{includedTaxes:'ICMS'},{treatment:'NOT_APPLICABLE'}])await deny(()=>service.create({...tax,...change},'org-a','actor-a'),400);
 const na=await service.create({...tax,componentCode:'IOF',treatment:'NOT_APPLICABLE',amount:null,baseRule:'Não há operação sujeita no período'},'org-a','actor-a');ok(na.amount_text===null);await service.approve(na.id,{revision:1},'org-a','actor-a');ok(true);
 const cost=await service.create({...body,kind:'COST',componentCode:'CCEE',label:'Crédito CCEE',measure:'BRL_MONTH',amount:'1234.560001',direction:'CREDIT',baseRule:'Crédito da competência'},'org-a','actor-a');ok(cost.amount_text==='1234.560001');
 const gross=await service.create({...body,componentCode:'TUSD',treatment:'GROSS',includedTaxes:'ICMS, PIS e Cofins'},'org-a','actor-a');ok(gross.treatment==='GROSS');
 await deny(()=>service.create(body,'org-a',''),401);entitled=false;await deny(()=>service.list('org-a'),403);await deny(()=>service.approve(tx.id,{revision:1},'org-a','actor-a'),403);entitled=true;
 await db.exec('RESET ROLE');await assert.rejects(()=>db.query('DELETE FROM calculation_parameters WHERE id=$1',[tx.id]),e=>e.code==='P3302');checks++;
 await assert.rejects(()=>db.query("UPDATE calculation_parameter_events SET actor_id='spoof' WHERE parameter_id=$1",[row.id]),e=>e.code==='P3302');checks++;
 const rights=await db.query("SELECT bool_and(NOT has_table_privilege(r,t,'SELECT') AND NOT has_table_privilege(r,t,'INSERT') AND NOT has_table_privilege(r,t,'UPDATE')) AS restricted FROM unnest(ARRAY['anon','authenticated']) r CROSS JOIN unnest(ARRAY['calculation_parameters','calculation_parameter_events']) t");ok(rights.rows[0].restricted);
 const rls=await db.query("SELECT bool_and(relrowsecurity) AS enabled FROM pg_class WHERE relname IN ('calculation_parameters','calculation_parameter_events')");ok(rls.rows[0].enabled);
 console.log(JSON.stringify({status:'passed',checks},null,2));
}finally{await db.close();}
