import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
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
 for(const m of ['20260925_f1_30_calculation_parameters.sql','20260925_f1_31_tax_bases.sql','20260925_f1_45_tax_interaction.sql','20260925_f1_46_sequential_taxes.sql','20260925_f1_47_shared_inside_taxes.sql','20260926_f1_56_operational_tax_bases.sql','20260927_f1_96_included_tax_optional_rate.sql','20260927_f1_103_atomic_parameter_replacement.sql','20261004_f1_178_bot_tax_exclusion.sql'])await migration(m);
 await migration('20261004_f1_178_bot_tax_exclusion.sql');await db.exec('set role service_role');
 const source='OCR · documento '+uuid(99)+' · SHA-256 '+'a'.repeat(64),common={organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',scenario:'ACL',direction:'DEBIT',start_date:'2026-08-01',end_date:'2026-08-31',unit_context:{},created_by:'creator',updated_by:'creator',source,notes:'bot-energy · source evidence'};
 for(let i=1;i<=8;i++){const demand=i>=7;await insert({...common,id:uuid(i),kind:'TARIFF',component_code:i<=2?'TUSD_ENERGY':i<=4?'CDE_WATER_SCARCITY':i<=6?'REACTIVE':i===7?'TUSD_DEMAND_USED':'TUSD_DEMAND_UNUSED',label:'Base '+i,time_band:demand?'ALL':i%2?'PEAK':'OFF_PEAK',measure:demand?'BRL_KW':'BRL_MWH',amount_text:'5',treatment:'GROSS',included_taxes:'Included',embedded_tax_codes:i===8?['PIS','COFINS']:['ICMS','PIS','COFINS'],source:source+' · tables[3].rows['+i+']'});await db.query("update calculation_parameters set status='APPROVED' where id=$1",[uuid(i)]);}
 const items=Array.from({length:7},(_,i)=>({parameterId:uuid(i+1),revision:2,operation:'INCLUDE'}));
 const tax={...common,kind:'TAX',component_code:'ICMS',label:'Included ICMS',time_band:'ALL',measure:'PERCENT',amount_text:null,treatment:'INCLUDED',base_rule:'No extra tax'};
 await insert({...tax,id:uuid(10),tax_basis:{version:1,items}});await db.query("update calculation_parameters set status='APPROVED' where id=$1",[uuid(10)]);
 const complete=[...items,{parameterId:uuid(8),revision:2,operation:'EXCLUDE'}];
 await insert({...tax,id:uuid(20),supersedes_parameter_id:uuid(10),source:source+' · exclusões completadas do parâmetro '+uuid(10),tax_basis:{version:1,items:complete}});
 const rpc=async(org='org',actor='manager',revision=1)=>(await db.query('select approve_bot_tax_exclusion($1,$2,$3,$4) result',[org,uuid(20),revision,actor])).rows[0].result;
 await fail(()=>rpc('other'),'P3311');await fail(()=>rpc('org',''),'P3301');await fail(()=>rpc('org','manager',99),'40001');ok((await get(uuid(10))).status==='APPROVED');
 const wrong=structuredClone(complete);wrong[7].operation='INCLUDE';await db.query('update calculation_parameters set tax_basis=$2 where id=$1',[uuid(20),JSON.stringify({version:1,items:wrong})]);await fail(()=>rpc('org','manager',2),'P3311');ok((await get(uuid(10))).status==='APPROVED');
 await db.query('update calculation_parameters set tax_basis=$2 where id=$1',[uuid(20),JSON.stringify({version:1,items:complete})]);
 await db.exec("reset role;create function fail_bot_approval() returns trigger language plpgsql as $$begin if new.id='"+uuid(20)+"' and new.status='APPROVED' then raise exception using errcode='P3311',message='Injected failure';end if;return new;end$$;create trigger z_bot_failure before update on calculation_parameters for each row execute function fail_bot_approval();set role service_role");
 const count=(await db.query('select count(*)::int n from calculation_parameter_events')).rows[0].n;await fail(()=>rpc('org','manager',3),'P3311');ok((await get(uuid(10))).status==='APPROVED');ok((await get(uuid(20))).status==='DRAFT');ok((await db.query('select count(*)::int n from calculation_parameter_events')).rows[0].n===count);
 await db.exec('reset role;drop trigger z_bot_failure on calculation_parameters;drop function fail_bot_approval();set role service_role');
 const client={from:table=>{const filters=[];const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},async maybeSingle(){const r=await q.run();return {...r,data:r.data[0]??null};},async run(){const r=await db.query('select * from '+table+(filters.length?' where '+filters.map(([k],i)=>k+'=$'+(i+1)).join(' and '):''),filters.map(x=>x[1]));return {data:JSON.parse(JSON.stringify(r.rows)),error:null};},then(resolve,reject){return q.run().then(resolve,reject);}};return q;},rpc:async(name,args)=>{assert.equal(name,'approve_bot_tax_exclusion');try{return {data:await rpc(args.p_organization,args.p_actor,args.p_revision),error:null};}catch(error){console.error('RPC failure',error.code,error.message);return {data:null,error};}}};
let entitled=true;const service=new CalculationParametersService({getClient:()=>client},{requireEntitlement:async()=>{if(!entitled)throw Error('license denied');}});
entitled=false;await assert.rejects(()=>service.approve(uuid(20),{revision:3},'org','manager'),/license denied/);checks++;entitled=true;
 const approved=await service.approve(uuid(20),{revision:3},'org','manager');ok(approved.status==='APPROVED'&&approved.approved_by==='manager');ok((await get(uuid(10))).status==='RETIRED');ok((await get(uuid(10))).tax_basis.items.length===7);ok(approved.tax_basis.items.length===8);ok((await rpc('org','manager',3)).revision===approved.revision);
 await db.exec('reset role');for(const role of ['anon','authenticated']){await db.exec('set role '+role);await fail(()=>rpc(),'42501');await db.exec('reset role');}
 console.log(checks+' bot tax exclusion SQL checks passed: scope, revision, wrong incidence, rollback, history, idempotency and privileges.');
}finally{await db.close();}
