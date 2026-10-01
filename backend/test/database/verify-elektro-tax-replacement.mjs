import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);require('reflect-metadata');
const {CalculationParametersService}=require('../../dist/modules/contracts/services/parameters.service.js');
const db=new PGlite();let checks=0;const ok=v=>{assert.ok(v);checks++;};
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const migration=async n=>db.exec(readFileSync(new URL('../../src/database/migrations/'+n,import.meta.url),'utf8'));
const get=async id=>(await db.query('select * from calculation_parameters where id=$1',[id])).rows[0];
const fail=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
async function insert(row){const keys=Object.keys(row);return (await db.query('insert into calculation_parameters ('+keys.join(',')+') values ('+keys.map((_,i)=>'$'+(i+1)).join(',')+') returning *',Object.values(row).map(v=>typeof v==='object'&&v!==null?JSON.stringify(v):v))).rows[0];}
try{
await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create table organizations(id text primary key);create table customers(id text primary key,organization_id text,deleted_at timestamptz);create table consumer_units(id text primary key,organization_id text,customer_id text);insert into organizations values ('org'),('other');insert into customers values ('customer','org',null);insert into consumer_units values ('unit','org','customer');grant select on organizations,customers,consumer_units to service_role;");
for(const m of ['20260925_f1_30_calculation_parameters.sql','20260925_f1_31_tax_bases.sql','20260925_f1_45_tax_interaction.sql','20260925_f1_46_sequential_taxes.sql','20260925_f1_47_shared_inside_taxes.sql','20260926_f1_56_operational_tax_bases.sql','20260927_f1_96_included_tax_optional_rate.sql'])await migration(m);
await db.exec('set role service_role');
const source='OCR CPFL · documento '+uuid(99)+' · SHA-256 '+'a'.repeat(64);
const common={organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',scenario:'ACL',direction:'DEBIT',start_date:'2026-08-01',end_date:'2026-08-31',unit_context:{},created_by:'creator',updated_by:'creator',source,notes:'Evidence preserved'};
for(let i=1;i<=4;i++){await insert({...common,id:uuid(i),kind:'TARIFF',component_code:i<=2?'TUSD_ENERGY':'CDE_WATER_SCARCITY',label:'Base '+i,time_band:i%2?'PEAK':'OFF_PEAK',measure:'BRL_MWH',amount_text:'5',treatment:'GROSS',included_taxes:'ICMS PIS COFINS',embedded_tax_codes:['ICMS','PIS','COFINS']});await db.query("update calculation_parameters set status='APPROVED' where id=$1",[uuid(i)]);}
const items=count=>Array.from({length:count},(_,i)=>({parameterId:uuid(i+1),revision:2,operation:'INCLUDE'}));
for(let i=0;i<3;i++){const tax={...common,kind:'TAX',component_code:['ICMS','PIS','COFINS'][i],label:'Tax',time_band:'ALL',measure:'PERCENT',amount_text:null,treatment:'INCLUDED',base_rule:'Included TUSD'};await insert({...tax,id:uuid(10+i),tax_basis:{version:1,items:items(2)}});await db.query("update calculation_parameters set status='APPROVED' where id=$1",[uuid(10+i)]);await insert({...tax,id:uuid(20+i),source:source+' · versão ampliada do parâmetro '+uuid(10+i),tax_basis:{version:1,items:items(4)}});}
await db.exec('reset role');await migration('20260927_f1_103_atomic_parameter_replacement.sql');await migration('20260927_f1_103_atomic_parameter_replacement.sql');
await migration('20260927_f1_114_demand_tax_replacement.sql');await migration('20261001_f1_136_elektro_tax_bases.sql');
ok((await get(uuid(20))).supersedes_parameter_id===uuid(10));ok((await get(uuid(20))).revision===2);ok((await get(uuid(10))).revision===2);ok((await db.query("select count(*)::int as n from calculation_parameter_events where actor_id='system:f1.103-lineage'")).rows[0].n===3);
await db.exec('set role service_role');
const rpc=async(id,revision=2,org='org',actor='approver')=>(await db.query('select approve_parameter_replacement($1,$2,$3,$4) as result',[org,id,revision,actor])).rows[0].result;
await fail(()=>rpc(uuid(20),1),'40001');await fail(()=>rpc(uuid(20),2,'other'),'P3311');await fail(()=>rpc(uuid(20),2,'org',''),'P3301');ok((await get(uuid(10))).status==='APPROVED');
// Exercise the actual service as well as the database procedure.
const client={from:table=>{const filters=[];const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},async maybeSingle(){const r=await q.run();return {...r,data:r.data[0]??null};},async run(){const r=await db.query('select * from '+table+(filters.length?' where '+filters.map(([k],i)=>k+'=$'+(i+1)).join(' and '):''),filters.map(x=>x[1]));return {data:JSON.parse(JSON.stringify(r.rows)),error:null};},then(resolve,reject){return q.run().then(resolve,reject);}};return q;},rpc:async(name,args)=>{assert.equal(name,'approve_parameter_replacement');try{return {data:await rpc(args.p_parameter,args.p_revision,args.p_organization,args.p_actor),error:null};}catch(error){console.error('RPC failure',error.code,error.message);return {data:null,error};}}};
let entitled=true;const service=new CalculationParametersService({getClient:()=>client},{requireEntitlement:async()=>{if(!entitled)throw Error('license denied');}});
const approved=await service.approve(uuid(20),{revision:2},'org','real-author');ok(approved.status==='APPROVED'&&approved.approved_by==='real-author'&&approved.revision===3);const original=await get(uuid(10));ok(original.status==='RETIRED'&&original.revision===3&&original.updated_by==='real-author');ok(original.retirement_reason.includes(uuid(20)));ok(original.notes==='Evidence preserved');
const events=(await db.query('select * from calculation_parameter_events where parameter_id in ($1,$2)',[uuid(10),uuid(20)])).rows;ok(events.filter(e=>e.actor_id==='real-author').length===2);ok(events.some(e=>e.action==='APPROVED'&&e.snapshot.supersedes_parameter_id===uuid(10)));
await service.approve(uuid(20),{revision:2},'org','real-author');ok((await get(uuid(20))).revision===3);ok((await get(uuid(10))).revision===3);

// Extend an approved four-base declaration to six, including an explicit unused-ICMS exclusion.
for(let i=5;i<=6;i++){await insert({...common,id:uuid(i),kind:'TARIFF',component_code:i===5?'TUSD_DEMAND_USED':'TUSD_DEMAND_UNUSED',label:'Demand '+i,time_band:'ALL',measure:'BRL_KW',amount_text:'10',treatment:'GROSS',included_taxes:'Included',embedded_tax_codes:i===5?['ICMS','PIS','COFINS']:['PIS','COFINS']});await db.query("update calculation_parameters set status='APPROVED' where id=$1",[uuid(i)]);}
const six=items(6);six[5].operation='EXCLUDE';const current=await get(uuid(20));
await insert({...common,id:uuid(30),supersedes_parameter_id:uuid(20),kind:'TAX',component_code:'ICMS',label:'Included demand',time_band:'ALL',measure:'PERCENT',amount_text:null,treatment:'INCLUDED',base_rule:'Six bases',source:current.source+' · versão ampliada do parâmetro '+uuid(20),tax_basis:{version:1,items:six}});
await fail(()=>rpc(uuid(30),1,'other'),'P3311');
const bad=structuredClone(six);bad[5].operation='INCLUDE';await db.query('update calculation_parameters set tax_basis=$2 where id=$1',[uuid(30),JSON.stringify({version:1,items:bad})]);await fail(()=>rpc(uuid(30),2),'P3311');ok((await get(uuid(20))).status==='APPROVED');
await db.query('update calculation_parameters set tax_basis=$2 where id=$1',[uuid(30),JSON.stringify({version:1,items:six})]);
await db.exec('reset role');await db.exec("create function fail_demand_approval() returns trigger language plpgsql as $$begin if new.id='"+uuid(30)+"' and new.status='APPROVED' then raise exception using errcode='P3311',message='Injected demand failure';end if;return new;end$$;create trigger z_demand_approval before update on calculation_parameters for each row execute function fail_demand_approval();set role service_role");
const beforeDemand=(await db.query('select count(*)::int n from calculation_parameter_events')).rows[0].n;await fail(()=>rpc(uuid(30),3),'P3311');ok((await get(uuid(20))).status==='APPROVED');ok((await get(uuid(30))).status==='DRAFT');ok((await db.query('select count(*)::int n from calculation_parameter_events')).rows[0].n===beforeDemand);
await db.exec('reset role;drop trigger z_demand_approval on calculation_parameters;drop function fail_demand_approval();set role service_role');
const demandApproved=await service.approve(uuid(30),{revision:3},'org','demand-author');ok(demandApproved.status==='APPROVED');ok(demandApproved.tax_basis.items[5].operation==='EXCLUDE');ok((await get(uuid(20))).status==='RETIRED');ok((await get(uuid(20))).updated_by==='demand-author');await rpc(uuid(30),3);ok((await get(uuid(30))).revision===4);


// Elektro: TUSD two posts + used/unused demand + one documented reactive post. No CDE.
await db.exec("reset role;insert into consumer_units values ('elektro','org','customer');set role service_role");
const es='OCR fatura · documento '+uuid(199)+' · SHA-256 '+'b'.repeat(64),ec={...common,consumer_unit_id:'elektro',source:es};
for(let i=0;i<5;i++){
 const component=['TUSD_ENERGY','TUSD_ENERGY','TUSD_DEMAND_USED','TUSD_DEMAND_UNUSED','REACTIVE'][i];
 await insert({...ec,id:uuid(100+i),kind:'TARIFF',component_code:component,label:component,time_band:i===2||i===3?'ALL':i===0?'PEAK':'OFF_PEAK',measure:i===2||i===3?'BRL_KW':'BRL_MWH',amount_text:'5',treatment:'GROSS',included_taxes:'Documented embedded taxes',source:es+' · tables[1].row['+i+']',embedded_tax_codes:i===3?['PIS','COFINS']:['ICMS','PIS','COFINS']});
 await db.query("update calculation_parameters set status='APPROVED' where id=$1",[uuid(100+i)]);
}
const ei=Array.from({length:5},(_,i)=>({parameterId:uuid(100+i),revision:2,operation:i===3?'EXCLUDE':'INCLUDE'}));
const et={...ec,kind:'TAX',component_code:'ICMS',label:'Elektro included tax',time_band:'ALL',measure:'PERCENT',amount_text:null,treatment:'INCLUDED',base_rule:'Documented included amounts'};
await insert({...et,id:uuid(110),tax_basis:{version:1,items:ei.slice(0,2)}});await db.query("update calculation_parameters set status='APPROVED' where id=$1",[uuid(110)]);
await insert({...et,id:uuid(120),supersedes_parameter_id:uuid(110),source:es+' · versão ampliada do parâmetro '+uuid(110),tax_basis:{version:1,items:ei}});
const badEi=structuredClone(ei);badEi[3].operation='INCLUDE';await db.query('update calculation_parameters set tax_basis=$2 where id=$1',[uuid(120),JSON.stringify({version:1,items:badEi})]);
await fail(()=>rpc(uuid(120),2),'P3311');ok((await get(uuid(110))).status==='APPROVED');
await db.query('update calculation_parameters set tax_basis=$2 where id=$1',[uuid(120),JSON.stringify({version:1,items:ei})]);
await fail(()=>rpc(uuid(120),3,'other'),'P3311');
const ea=await service.approve(uuid(120),{revision:3},'org','elektro-author');ok(ea.status==='APPROVED'&&ea.tax_basis.items.length===5);ok((await get(uuid(110))).status==='RETIRED');ok(ea.tax_basis.items[3].operation==='EXCLUDE');await rpc(uuid(120),3);ok((await get(uuid(120))).revision===4);

entitled=false;await assert.rejects(()=>service.approve(uuid(21),{revision:2},'org','actor'),/license denied/);checks++;entitled=true;
// Simulate failure after the predecessor UPDATE and prove both records/events roll back.
await db.exec('reset role');await db.exec("create function fail_new_approval() returns trigger language plpgsql as $$begin if new.id='"+uuid(21)+"' and new.status='APPROVED' then raise exception using errcode='P3311',message='Injected approval failure';end if;return new;end$$;create trigger z_test_approval before update on calculation_parameters for each row execute function fail_new_approval();");await db.exec('set role service_role');
const eventCount=(await db.query('select count(*)::int n from calculation_parameter_events')).rows[0].n;await fail(()=>rpc(uuid(21)),'P3311');ok((await get(uuid(11))).status==='APPROVED');ok((await get(uuid(21))).status==='DRAFT');ok((await db.query('select count(*)::int n from calculation_parameter_events')).rows[0].n===eventCount);
await db.exec('reset role;drop trigger z_test_approval on calculation_parameters;drop function fail_new_approval();set role service_role');
await db.query("update calculation_parameters set source='Manual source' where id=$1",[uuid(21)]);await fail(()=>rpc(uuid(21),3),'P3311');ok((await get(uuid(11))).status==='APPROVED');
await db.query("update calculation_parameters set status='RETIRED',retirement_reason='Source corrected' where id=$1",[uuid(4)]);await fail(()=>rpc(uuid(22)),'P3311');ok((await get(uuid(12))).status==='APPROVED');
await db.exec('reset role');for(const role of ['anon','authenticated']){await db.exec('set role '+role);await fail(()=>rpc(uuid(22)),'42501');await db.exec('reset role');}
ok((await db.query("select not has_function_privilege('anon','approve_parameter_replacement(text,uuid,integer,text)','execute') as safe")).rows[0].safe);
console.log(checks+' atomic replacement checks passed: real service, metadata backfill, idempotency, rollback, scope, license, basis validation and privileges');
}finally{await db.close();}
