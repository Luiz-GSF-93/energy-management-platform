// Uses isolated PostgreSQL-compatible PGlite, never production.
import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);require('reflect-metadata');const {MonthlyCostsService}=require('../../dist/modules/contracts/services/monthly-costs.service.js');
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
 const migration=readFileSync(new URL('../../src/database/migrations/20260925_f1_36_monthly_costs.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);ok(true);const supplierMigration=readFileSync(new URL('../../src/database/migrations/20260925_f1_51_supplier_monthly_costs.sql',import.meta.url),'utf8');await db.exec(supplierMigration);await db.exec(supplierMigration);ok(true);
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 await db.exec("INSERT INTO organizations VALUES ('org-a'),('org-b');INSERT INTO customers(id,organization_id,company_name,document) VALUES ('"+a+"','org-a','A','A'),('"+b+"','org-b','B','B');INSERT INTO consumer_units(id,organization_id,customer_id,consumer_unit_number,distributor,tariff_group) VALUES ('"+a+"','org-a','"+a+"','A','D','A4'),('"+b+"','org-b','"+b+"','B','D','A4');SET ROLE service_role");
 let entitled=true;const client={getClient:()=>({from:t=>new Query(t)})},licenses={requireEntitlement:async()=>{if(!entitled)throw Object.assign(new Error('No license'),{getStatus:()=>403});}};
 const s=new MonthlyCostsService(client,licenses),t={organizationId:'org-a',userId:'actor',role:'gestor'},other={...t,organizationId:'org-b'},deny=async(fn,status)=>{await assert.rejects(fn,e=>e.getStatus?.()===status);checks++;};
 const item={id:'10000000-0000-4000-8000-000000000001',label:'Encargo',category:'CCEE',scenario:'ACL',effect:'COST',amount:'10.25',source:'Relatório 1',taxTreatment:'INCLUDED'};
 const body={consumerUnitId:a,month:'2026-09',costs:{noCosts:false,items:[item]},sourceReference:'Documentos revisados',notes:'',correctionReason:''};
 const r=await s.create(body,t);ok(r.version===1&&r.revision===1&&r.status==='DRAFT');ok(r.costs.items[0].amount==='10.25');ok((await s.events(r.id,t)).length===1);
 await deny(()=>s.create(body,t),409);await deny(()=>s.one(r.id,other),404);await deny(()=>s.events(r.id,other),404);await deny(()=>s.create({...body,consumerUnitId:b},t),404);await deny(()=>s.list({consumerUnitId:b,month:body.month},t),404);
 const up=await s.update(r.id,{...body,notes:'Revisto',revision:1},t);ok(up.revision===2);await deny(()=>s.update(r.id,{...body,revision:1},t),409);await deny(()=>s.update(r.id,{...body,month:'2026-10',revision:2},t),409);
 await deny(()=>s.validate(r.id,{revision:2},{...t,role:'operador'}),403);await deny(()=>s.validate(r.id,{revision:2},other),404);
 const valid=await s.validate(r.id,{revision:2},t);ok(valid.status==='VALIDATED'&&valid.validated_by==='actor'&&valid.revision===3);ok((await s.events(r.id,t)).length===3);
 await deny(()=>s.update(r.id,{...body,revision:3},t),409);await assert.rejects(()=>db.query("UPDATE calculation_monthly_costs SET notes='overwrite' WHERE id=$1",[r.id]),e=>e.code==='P3602');checks++;
 await deny(()=>s.create({...body,previousId:r.id},t),400);const v2=await s.create({...body,previousId:r.id,correctionReason:'Corrigir documento',costs:{noCosts:false,items:[{...item,effect:'CREDIT',amount:'999999999999.99'}]}},t);ok(v2.version===2&&v2.previous_id===r.id);ok((await s.one(r.id,t)).costs.items[0].amount==='10.25');await deny(()=>s.create({...body,previousId:r.id,correctionReason:'Duplicar'},t),409);
 const v2valid=await s.validate(v2.id,{revision:1},t);ok(v2valid.costs.items[0].amount==='999999999999.99');await deny(()=>s.create({...body,previousId:r.id,correctionReason:'Versão antiga'},t),409);
 const list=await s.list({consumerUnitId:a,month:'2026-09'},t);ok(list.rows.length===2&&list.rows[0].version===2&&list.canValidate);ok(!(await s.list({consumerUnitId:a,month:'2026-09'},{...t,role:'operador'})).canValidate);
 const blank=await s.create({...body,month:'2026-10',costs:{noCosts:false,items:[]}},t);await deny(()=>s.validate(blank.id,{revision:1},t),400);
 const absence=await s.update(blank.id,{...body,month:'2026-10',costs:{noCosts:true,items:[]},revision:1},t);await s.validate(absence.id,{revision:2},t);ok((await s.one(absence.id,t)).costs.noCosts===true);
 const zero=await s.create({...body,month:'2026-11',costs:{noCosts:false,items:[{...item,amount:'0'}]}},t);await s.validate(zero.id,{revision:1},t);ok((await s.one(zero.id,t)).costs.items[0].amount==='0');
 for(const patch of [{month:'2026-13'},{month:'2026-9'},{organizationId:'org-b'},{status:'VALIDATED'},{costs:null},{costs:{noCosts:true,items:[item]}},{costs:{noCosts:false,items:[item,item]}},{costs:{noCosts:false,items:[],unknown:true}},{sourceReference:' '}])await deny(()=>s.create({...body,month:'2027-01',...patch},t),400);
 for(const patch of [{amount:1},{amount:'-1'},{amount:'1e3'},{amount:'0.001'},{amount:'01'},{unknown:'x'},{label:' '},{source:''},{category:'ENERGY'},{scenario:'BOTH'},{effect:'NEGATIVE'},{taxTreatment:'BAD'},{id:'x'}])await deny(()=>s.create({...body,month:'2027-01',costs:{noCosts:false,items:[{...item,...patch}]}},t),400);
 const partial=await s.create({...body,month:'2027-02',costs:{noCosts:false,items:[{...item,taxTreatment:'UNSPECIFIED'}]}},t);await deny(()=>s.validate(partial.id,{revision:1},t),400);
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_costs SET status='VALIDATED' WHERE id=$1",[partial.id]),e=>e.code==='P3601');checks++;
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_costs SET costs='{}' WHERE id=$1",[partial.id]),e=>e.code==='P3601');checks++;
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_costs SET customer_id=$2 WHERE id=$1",[partial.id,b]),e=>e.code==='P3603');checks++;
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_costs SET month='2027-03' WHERE id=$1",[partial.id]),e=>e.code==='P3602');checks++;
 await assert.rejects(()=>db.query("DELETE FROM calculation_monthly_costs WHERE id=$1",[partial.id]),e=>e.code==='42501');checks++;
 await assert.rejects(()=>db.exec("UPDATE calculation_monthly_cost_events SET actor_id='spoof'"),e=>e.code==='42501');checks++;
 entitled=false;await deny(()=>s.list({consumerUnitId:a,month:'2026-09'},t),403);await deny(()=>s.create({...body,month:'2028-01'},t),403);entitled=true;

 const supplierItem={...item,category:'SUPPLIER_INVOICE',amount:'100.00',source:'NF fornecedor 123'};
 const extraItem={...supplierItem,id:'10000000-0000-4000-8000-000000000002',category:'SUPPLIER_EXTRA_ENERGY',amount:'20.00',source:'NF compra extra 124'};
 const supplierBody={...body,month:'2028-04',costs:{noCosts:false,items:[supplierItem,extraItem]}};
 const sr=await s.create(supplierBody,t);ok(sr.costs.items[1].category==='SUPPLIER_EXTRA_ENERGY');
 await deny(()=>s.validate(sr.id,{revision:1},{...t,role:'operador'}),403);
 const sv=await s.validate(sr.id,{revision:1},t);ok(sv.status==='VALIDATED');ok((await s.events(sr.id,t)).length===2);
 await deny(()=>s.update(sr.id,{...supplierBody,revision:2},t),409);
 for(const category of ['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'])await deny(()=>s.create({...supplierBody,month:'2028-05',costs:{noCosts:false,items:[{...supplierItem,category,scenario:'ACR'}]}},t),400);
 await assert.rejects(()=>db.query("UPDATE calculation_monthly_costs SET costs=$2 WHERE id=$1",[partial.id,JSON.stringify({noCosts:false,items:[{...supplierItem,scenario:'ACR'}]})]),e=>e.code==='P3601');checks++;
 await deny(()=>s.one(sr.id,other),404);

 await db.query('UPDATE customers SET deleted_at=now() WHERE id=$1',[a]);await deny(()=>s.one(r.id,t),404);await deny(()=>s.create({...body,month:'2028-01'},t),404);
 await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(()=>db.exec('SELECT * FROM calculation_monthly_costs'),e=>e.code==='42501');checks++;
 await db.exec('RESET ROLE;SET ROLE authenticated');await assert.rejects(()=>db.exec('SELECT * FROM calculation_monthly_cost_events'),e=>e.code==='42501');checks++;
 console.log('Monthly costs: '+checks+' isolated database/service checks passed.');
}finally{await db.close();}
