// Uses isolated PostgreSQL-compatible PGlite, never production.
import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);require('reflect-metadata');const {MonthlyInputsService}=require('../../dist/modules/contracts/services/monthly-inputs.service.js');
const db=new PGlite();let checks=0;const ok=x=>{assert.ok(x);checks++;};const q=n=>'"'+n.replaceAll('"','""')+'"';
class Query{
 constructor(table){this.table=table;this.filters=[];this.params=[];this.op='select';}
 select(){return this;}order(k,o={ascending:true}){this.orderSql=' ORDER BY '+q(k)+(o.ascending?' ASC':' DESC');return this;}range(a,b){this.rangeSql=' LIMIT '+(b-a+1)+' OFFSET '+a;return this;}eq(k,v){this.params.push(v);this.filters.push(q(k)+'=$'+this.params.length);return this;}is(k,v){assert.equal(v,null);this.filters.push(q(k)+' IS NULL');return this;}
 insert(rows){this.op='insert';this.values=rows[0];return this;} update(values){this.op='update';this.values=values;return this;}single(){return this.execute(true);}maybeSingle(){return this.execute(true);}then(resolve,reject){return this.execute(false).then(resolve,reject);}
 async execute(single){const p=[...this.params];const bind=v=>{p.push(v!==null&&typeof v==='object'?JSON.stringify(v):v);return '$'+p.length;};const where=this.filters.length?' WHERE '+this.filters.join(' AND '):'';const sql=this.op==='insert'?'INSERT INTO '+q(this.table)+' ('+Object.keys(this.values).map(q).join(',')+') VALUES ('+Object.values(this.values).map(bind).join(',')+') RETURNING *':this.op==='update'?'UPDATE '+q(this.table)+' SET '+Object.entries(this.values).map(([k,v])=>q(k)+'='+bind(v)).join(',')+where+' RETURNING *':'SELECT * FROM '+q(this.table)+where+(this.orderSql||'')+(this.rangeSql||'');try{const r=await db.query(sql,p);const data=JSON.parse(JSON.stringify(r.rows));return {data:single?data[0]||null:data,error:null};}catch(error){return {data:null,error};}}
}
try{
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;CREATE TABLE organizations(id text primary key)');
 const fixture=JSON.parse(readFileSync(new URL('./contracts-fixture.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
 for(const t of ['customers','consumer_units']){const cols=fixture.columns.filter(c=>c.table===t).map(c=>q(c.name)+' '+c.type+(c.not_null?' NOT NULL':'')+(c.default?' DEFAULT '+c.default:''));await db.exec('CREATE TABLE '+q(t)+' ('+cols.join(',')+',PRIMARY KEY(id));GRANT ALL ON '+q(t)+' TO service_role');}
 const migration=readFileSync(new URL('../../src/database/migrations/20260925_f1_34_monthly_inputs.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);ok(true);
 const billedMigration=readFileSync(new URL('../../src/database/migrations/20260925_f1_48_billed_demand.sql',import.meta.url),'utf8');await db.exec(billedMigration);await db.exec(billedMigration);ok(true);
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 await db.exec("INSERT INTO organizations VALUES ('org-a'),('org-b');INSERT INTO customers(id,organization_id,company_name,document) VALUES ('"+a+"','org-a','A','A'),('"+b+"','org-b','B','B');INSERT INTO consumer_units(id,organization_id,customer_id,consumer_unit_number,distributor,tariff_group) VALUES ('"+a+"','org-a','"+a+"','A','D','A4'),('"+b+"','org-b','"+b+"','B','D','A4');SET ROLE service_role");
 let entitled=true;const client={getClient:()=>({from:t=>new Query(t)})},licenses={requireEntitlement:async()=>{if(!entitled)throw Object.assign(new Error('No license'),{getStatus:()=>403});}};
 const s=new MonthlyInputsService(client,licenses),t={organizationId:'org-a',userId:'actor',role:'gestor'},other={...t,organizationId:'org-b'},deny=async(fn,status)=>{await assert.rejects(fn,e=>e.getStatus?.()===status);checks++;};
 const body={consumerUnitId:a,month:'2026-09',measurements:{consumptionTotal:'0.3',consumptionPeak:'0.1',consumptionOffPeak:'0.2'},sourceReference:'Relatório isolado, página 1',notes:'',correctionReason:''};
 const r=await s.create(body,t);ok(r.version===1&&r.revision===1&&r.status==='DRAFT');ok(r.measurements.consumptionTotal==='0.3'&&r.measurements.demandSingle===null);ok((await s.events(r.id,t)).length===1);
 await deny(()=>s.create(body,t),409);await deny(()=>s.one(r.id,other),404);await deny(()=>s.events(r.id,other),404);await deny(()=>s.create({...body,consumerUnitId:b},t),404);await deny(()=>s.list({consumerUnitId:b,month:body.month},t),404);
 const up=await s.update(r.id,{...body,notes:'Revisto',revision:1},t);ok(up.revision===2);await deny(()=>s.update(r.id,{...body,revision:1},t),409);await deny(()=>s.update(r.id,{...body,month:'2026-10',revision:2},t),409);
 await deny(()=>s.validate(r.id,{revision:2},{...t,role:'operador'}),403);await deny(()=>s.validate(r.id,{revision:2},other),404);
 const valid=await s.validate(r.id,{revision:2},t);ok(valid.status==='VALIDATED'&&valid.validated_by==='actor'&&valid.revision===3);ok((await s.events(r.id,t)).length===3);
 await deny(()=>s.update(r.id,{...body,revision:3},t),409);await assert.rejects(()=>db.query("UPDATE calculation_monthly_inputs SET notes='overwrite' WHERE id=$1",[r.id]),e=>e.code==='P3402');checks++;
 await deny(()=>s.create({...body,previousId:r.id},t),400);const v2=await s.create({...body,previousId:r.id,correctionReason:'Corrigir leitura',measurements:{consumptionTotal:'999999999999.999999'}},t);ok(v2.version===2&&v2.previous_id===r.id);ok((await s.one(r.id,t)).measurements.consumptionTotal==='0.3');await deny(()=>s.create({...body,previousId:r.id,correctionReason:'Duplicar'},t),409);
 const v2valid=await s.validate(v2.id,{revision:1},t);ok(v2valid.measurements.consumptionTotal==='999999999999.999999');await deny(()=>s.create({...body,previousId:r.id,correctionReason:'Versão antiga'},t),409);
 const list=await s.list({consumerUnitId:a,month:'2026-09'},t);ok(list.rows.length===2&&list.rows[0].version===2&&list.canValidate);ok(!(await s.list({consumerUnitId:a,month:'2026-09'},{...t,role:'operador'})).canValidate);
 const blank=await s.create({...body,month:'2026-10',measurements:{}},t);await deny(()=>s.validate(blank.id,{revision:1},t),400);
 const zero=await s.update(blank.id,{...body,month:'2026-10',measurements:{consumptionTotal:'0'},revision:1},t);await s.validate(zero.id,{revision:2},t);ok((await s.one(zero.id,t)).measurements.consumptionTotal==='0');
 for(const patch of [{month:'2026-13'},{month:'2026-9'},{organizationId:'org-b'},{status:'VALIDATED'},{measurements:{consumptionTotal:1}},{measurements:{consumptionTotal:'-1'}},{measurements:{consumptionTotal:'1e3'}},{measurements:{consumptionTotal:'0.0000001'}},{measurements:{consumptionTotal:'1',unknown:'1'}},{measurements:{consumptionTotal:'1',consumptionPeak:'0.1',consumptionOffPeak:'0.2'}},{measurements:{demandSingle:'1',demandPeak:'1'}},{sourceReference:' '}])await deny(()=>s.create({...body,month:'2027-01',...patch},t),400);
 const partial=await s.create({...body,month:'2027-02',measurements:{consumptionTotal:'1',consumptionPeak:'0.1'}},t);await deny(()=>s.validate(partial.id,{revision:1},t),400);
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_inputs SET status='VALIDATED' WHERE id=$1",[partial.id]),e=>e.code==='P3401');checks++;
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_inputs SET measurements='{}' WHERE id=$1",[partial.id]),e=>e.code==='P3401');checks++;
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_inputs SET customer_id=$2 WHERE id=$1",[partial.id,b]),e=>e.code==='P3403');checks++;
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_inputs SET month='2027-03' WHERE id=$1",[partial.id]),e=>e.code==='P3402');checks++;
 await assert.rejects(()=>db.query("DELETE FROM calculation_monthly_inputs WHERE id=$1",[partial.id]),e=>e.code==='42501');checks++;
 await assert.rejects(()=>db.exec("UPDATE calculation_monthly_input_events SET actor_id='spoof'"),e=>e.code==='42501');checks++;

 await db.query("UPDATE consumer_units SET tariff_group='A',tariff_modality='GREEN' WHERE id=$1",[a]);
 const billing={...body,month:'2028-02',billedDemand:{ACL:{single:'12',source:'Fatura ACL'},ACR:{single:'15',source:'Regra ACR'}}};
 const bd=await s.create(billing,t);ok(bd.billed_demand.ACL.single==='12'&&bd.billed_demand.ACR.single==='15');
 const revised=await s.update(bd.id,{...billing,billedDemand:{ACL:{single:'13',source:'Fatura corrigida'}},revision:1},t);ok(revised.billed_demand.ACL.single==='13'&&!revised.billed_demand.ACR);
 await deny(()=>s.validate(bd.id,{revision:2},{...t,role:'operador'}),403);
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_inputs SET status='VALIDATED',billed_demand=$2 WHERE id=$1",[bd.id,JSON.stringify({ACL:{single:'20',source:'not saved'}})]),e=>e.code==='P3402');checks++;
 const bv=await s.validate(bd.id,{revision:2},t);ok(bv.billed_demand.ACL.single==='13');ok((await s.events(bd.id,t))[0].snapshot.billed_demand.ACL.source==='Fatura corrigida');
 await deny(()=>s.update(bd.id,{...billing,revision:3},t),409);await deny(()=>s.one(bd.id,other),404);
 const corr=await s.create({...billing,previousId:bd.id,correctionReason:'Rever demanda'},t);ok(corr.version===2&&(await s.one(bd.id,t)).billed_demand.ACL.single==='13');
 for(const billedDemand of [{ACL:{single:1,source:'F'}},{ACL:{single:'-1',source:'F'}},{ACL:{single:'1',source:''}},{ACL:{single:'1',peak:'2',source:'F'}},{OTHER:{}},{ACL:{single:'1',source:'F',unknown:1}}])await deny(()=>s.create({...billing,month:'2028-03',billedDemand},t),400);
 const partialDemand=await s.create({...billing,month:'2028-03',billedDemand:{ACL:{peak:'2',source:'F'}}},t);await deny(()=>s.validate(partialDemand.id,{revision:1},t),400);
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_inputs SET status='VALIDATED' WHERE id=$1",[partialDemand.id]),e=>e.code==='P3401');checks++;
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_inputs SET billed_demand=$2 WHERE id=$1",[partialDemand.id,JSON.stringify({ACL:{single:'1e2',source:'F'}})]),e=>e.code==='P3401');checks++;
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_inputs SET billed_demand=$2 WHERE id=$1",[partialDemand.id,JSON.stringify({ACL:{single:'2',source:''}})]),e=>e.code==='P3401');checks++;
 await db.query("UPDATE consumer_units SET tariff_modality='BLUE' WHERE id=$1",[a]);
 const bb=await s.create({...billing,month:'2028-04',billedDemand:{ACL:{peak:'10',offPeak:'20',source:'Azul'}}},t);await s.validate(bb.id,{revision:1},t);ok((await s.one(bb.id,t)).billed_demand.ACL.offPeak==='20');

 entitled=false;await deny(()=>s.list({consumerUnitId:a,month:'2026-09'},t),403);await deny(()=>s.create({...body,month:'2028-01'},t),403);entitled=true;
 await db.query('UPDATE customers SET deleted_at=now() WHERE id=$1',[a]);await deny(()=>s.one(r.id,t),404);await deny(()=>s.create({...body,month:'2028-01'},t),404);
 await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(()=>db.exec('SELECT * FROM calculation_monthly_inputs'),e=>e.code==='42501');checks++;
 await db.exec('RESET ROLE;SET ROLE authenticated');await assert.rejects(()=>db.exec('SELECT * FROM calculation_monthly_input_events'),e=>e.code==='42501');checks++;
 console.log('Monthly inputs: '+checks+' isolated database/service checks passed.');
}finally{await db.close();}
