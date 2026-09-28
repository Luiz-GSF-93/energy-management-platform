import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;const ok=v=>{assert.ok(v);checks++;};
const migration=async n=>db.exec(await readFile(new URL('../../src/database/migrations/'+n,import.meta.url),'utf8'));
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
CREATE TABLE organizations(id text primary key);
CREATE TABLE customers(id text primary key,organization_id text,deleted_at timestamptz,company_name text,document text,status text default 'ACTIVE');
CREATE TABLE consumer_units(id text primary key,organization_id text,customer_id text,consumer_unit_number text,address text,free_market boolean,status text default 'ACTIVE',distributor text,tariff_group text,tariff_subgroup text,tariff_modality text,state text);
CREATE TABLE documents(id text primary key,organization_id text,customer_id text,consumer_unit_id text,reference_month timestamp,file_verified boolean,document_type text,file_hash text);
CREATE TABLE document_ocr_jobs(id uuid primary key,organization_id text,document_id text,file_hash text,state text);
CREATE TABLE document_ocr_results(job_id uuid,organization_id text,document_id text,file_hash text);
INSERT INTO organizations VALUES ('org'),('other');
INSERT INTO customers(id,organization_id,company_name,document) VALUES ('customer','org','Company','123');
INSERT INTO consumer_units(id,organization_id,customer_id,consumer_unit_number,address,free_market) VALUES ('unit','org','customer','001','Rua Um',true);
INSERT INTO documents VALUES ('doc','org','customer','unit','2026-08-01',true,'INVOICE_DISTRIBUTOR',repeat('a',64));
INSERT INTO document_ocr_jobs VALUES ('11111111-1111-4111-8111-111111111111','org','doc',repeat('a',64),'SUCCEEDED');
INSERT INTO document_ocr_results SELECT id,organization_id,document_id,file_hash FROM document_ocr_jobs;`);
for(const n of ['20260925_f1_34_monthly_inputs.sql','20260925_f1_48_billed_demand.sql','20260926_f1_71_ocr_field_reviews.sql','20260927_f1_81_ocr_demand_reviews.sql','20260927_f1_86_ocr_review_trigger_permissions.sql','20260927_f1_87_ocr_identity_reviews.sql','20260927_f1_90_ocr_monthly_integration.sql','20260927_f1_91_ocr_demand_integration.sql'])await migration(n);
for(const n of ['20260925_f1_30_calculation_parameters.sql','20260925_f1_31_tax_bases.sql','20260927_f1_111_split_demand.sql','20260927_f1_112_ocr_split_demand.sql'])await migration(n);
const refs={identity:{},consumption:{}},hash='a'.repeat(64),job='11111111-1111-4111-8111-111111111111';
const document={id:'doc',organizationId:'org',customerId:'customer',unitId:'unit',month:'2026-08',fileHash:hash};
for(const key of ['customer','taxId','unit','address','period','market','consumptionPeakKwh','consumptionOffPeakKwh','consumptionTotalKwh']){
 const identity=!key.startsWith('consumption'),kind=identity?'identity':'field';
 const snapshot={format:identity?'ocr-identity-review-v1':'ocr-consumption-review-v1',jobId:job,document,registration:{customer:{company_name:'Company',document:'123'},unit:{consumer_unit_number:'001',address:'Rua Um',free_market:true}},field:{key,state:'EXTRACTED_REVIEW',decimal:identity?'value':key==='consumptionTotalKwh'?'0.3':key==='consumptionPeakKwh'?'0.1':'0.2',unit:identity?'':'kWh',check:{comparison:'EQUAL'}}};
 const row={organization_id:'org',document_id:'doc',job_id:job,file_hash:hash,field_key:key,source_hash:hash,source_snapshot:JSON.stringify(snapshot),decision:'CONFIRMED',note:'Conferido no PDF',expected_review_id:null,request_id:randomUUID(),created_by:'reviewer',...(identity?{checked_pdf:true}:{})};
 const keys=Object.keys(row);const saved=(await db.query('INSERT INTO document_ocr_'+kind+'_reviews ('+keys.join(',')+') VALUES ('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING id',Object.values(row))).rows[0];refs[identity?'identity':'consumption'][key]={id:saved.id,sourceHash:hash};
}
const integrate=async(org='org',r=refs)=> (await db.query('SELECT public.integrate_ocr_monthly($1,$2,$3,$4) as result',[org,'doc','actor',JSON.stringify(r)])).rows[0].result;
const denied=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
const rollback=async fn=>{await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}};

await db.exec("UPDATE consumer_units SET tariff_group='A',tariff_modality='GREEN'");
const demandRefs={};
for(const [key,decision,decimal] of [['b'.repeat(64),'USED','234.6400'],['c'.repeat(64),'UNUSED','265.3600']]){
 const snapshot={format:'ocr-demand-review-v1',jobId:job,document,field:{key,state:'BILLED_UNCLASSIFIED',unit:'kW',period:'UNSPECIFIED',decimal}};
 const row={organization_id:'org',document_id:'doc',job_id:job,file_hash:hash,field_key:key,source_hash:hash,source_snapshot:JSON.stringify(snapshot),decision,note:'Conferido no PDF',expected_review_id:null,request_id:randomUUID(),created_by:'reviewer',checked_pdf:true};
 const keys=Object.keys(row);const saved=(await db.query('INSERT INTO document_ocr_demand_reviews ('+keys.join(',')+') VALUES ('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING id',Object.values(row))).rows[0];demandRefs[key]={id:saved.id,sourceHash:hash};
}
const demand=async(org='org',r=demandRefs,revision=1)=>(await db.query('SELECT public.integrate_ocr_billed_demand($1,$2,$3,$4,$5) AS result',[org,'doc','actor',JSON.stringify(r),revision])).rows[0].result;
await denied(()=>demand(),'P4091');
await db.exec('SET ROLE service_role');const first=await integrate();await db.exec('RESET ROLE');
await denied(()=>demand('other'),'P4091');await denied(()=>demand('org',{},1),'P4090');await denied(()=>demand('org',demandRefs,2),'P4091');
for(const change of ["UPDATE consumer_units SET tariff_modality='BLUE'","UPDATE consumer_units SET address='changed'","UPDATE customers SET status='INACTIVE'","UPDATE document_ocr_jobs SET state='FAILED'"])await rollback(async()=>{await db.exec(change);await denied(()=>demand(),change.includes('tariff_modality')?'P4091':'P4090');});
await rollback(async()=>{await db.exec("UPDATE calculation_monthly_inputs SET billed_demand='{}'");await denied(()=>demand('org',demandRefs,2),'P4091');});
await rollback(async()=>{await db.exec("UPDATE calculation_monthly_inputs SET measurements=jsonb_set(measurements,'{demandSingle}',to_jsonb('123'::text))");await denied(()=>demand('org',demandRefs,2),'P4091');});
await rollback(async()=>{await db.exec("UPDATE calculation_monthly_inputs SET status='VALIDATED'");await denied(()=>demand('org',demandRefs,2),'P4091');});
async function changeReview(){const original=(await db.query('SELECT * FROM document_ocr_demand_reviews ORDER BY field_key LIMIT 1')).rows[0];const row={...original,id:randomUUID(),decision:'NEEDS_CORRECTION',note:'Rever parcela',expected_review_id:original.id,request_id:randomUUID()};const keys=Object.keys(row);await db.query('INSERT INTO document_ocr_demand_reviews ('+keys.join(',')+') VALUES ('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(row).map(v=>v!==null&&typeof v==='object'&&!(v instanceof Date)?JSON.stringify(v):v));}
await rollback(async()=>{await changeReview();await denied(()=>demand(),'P4090');});
ok((await db.query('SELECT * FROM document_ocr_demand_integrations')).rows.length===0);
await db.exec('SET ROLE service_role');const written=await demand(),again=await demand();ok(written.inputId===first.inputId&&again.inputId===written.inputId&&again.alreadyIntegrated);
const m=(await db.query('SELECT * FROM calculation_monthly_inputs')).rows[0];ok(m.status==='DRAFT'&&m.revision===2&&m.billed_demand.ACL.single==='500.0000');ok(m.measurements.demandSingle===null&&m.measurements.demandPeak===null&&m.measurements.reactiveTotal===null);ok(m.measurements.consumptionTotal==='0.3');
const audit=(await db.query('SELECT * FROM calculation_monthly_input_events ORDER BY revision')).rows;ok(audit.length===2&&audit[1].snapshot.billed_demand.ACL.single==='500.0000');
const logged=(await db.query('SELECT * FROM document_ocr_demand_integrations')).rows;ok(logged.length===1&&logged[0].created_by==='actor'&&logged[0].source_snapshot.reviews.length===2&&logged[0].source_snapshot.unusedKw==='265.3600');
for(const action of ['INSERT','UPDATE','DELETE','TRUNCATE'])ok(!(await db.query("SELECT has_table_privilege(current_user,'public.document_ocr_demand_integrations',$1) AS allowed",[action])).rows[0].allowed);
await db.exec('RESET ROLE');
await rollback(async()=>{await changeReview();await denied(()=>db.exec("UPDATE calculation_monthly_inputs SET status='VALIDATED'"),'P4090');});
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await denied(()=>demand(),'42501');await db.exec('RESET ROLE');}
await rollback(async()=>{
 const current=(await db.query('SELECT * FROM calculation_monthly_inputs')).rows[0];
 const rows=Object.values(demandRefs).map((ref,i)=>({classification:i?'UNUSED':'USED',source:'row'+i,quantity:i?'265.3600':'234.6400',rate:i?'8.78135364':'10.70900103',amount:i?'2330.22':'2512.76',taxCodes:i?['PIS','COFINS']:['ICMS','PIS','COFINS'],reviewId:ref.id,sourceHash:ref.sourceHash}));
 const r=(await db.query('SELECT public.integrate_ocr_split_demand($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',['org','doc','actor',current.id,current.revision,JSON.stringify(refs),JSON.stringify(demandRefs),job,hash,JSON.stringify(rows)])).rows[0].result;
 ok(r.inputId===current.id);const updated=(await db.query('SELECT * FROM calculation_monthly_inputs')).rows;ok(updated.length===1&&updated[0].status==='DRAFT'&&updated[0].billed_demand.ACL.used==='234.6400');
});
await db.exec("UPDATE calculation_monthly_inputs SET status='VALIDATED'");ok((await db.query('SELECT status FROM calculation_monthly_inputs')).rows[0].status==='VALIDATED');

const original=(await db.query('SELECT * FROM calculation_monthly_inputs')).rows[0];
const priorEvents=(await db.query('SELECT * FROM calculation_monthly_input_events ORDER BY revision')).rows;
const financialRows=Object.entries(demandRefs).map(([key,ref],i)=>({classification:i===0?'USED':'UNUSED',source:'tables[3].row['+(i+3)+']',quantity:i===0?'234.6400':'265.3600',rate:i===0?'10.70900103':'8.78135364',amount:i===0?'2512.76':'2330.22',taxCodes:i===0?['ICMS','PIS','COFINS']:['PIS','COFINS'],reviewId:ref.id,sourceHash:ref.sourceHash}));
const split=async(rows=financialRows,revision=original.revision,org='org')=>(await db.query('SELECT public.integrate_ocr_split_demand($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result',[org,'doc','actor',original.id,revision,JSON.stringify(refs),JSON.stringify(demandRefs),job,hash,JSON.stringify(rows)])).rows[0].result;
await denied(()=>split(financialRows,original.revision+1),'P4091');
await denied(()=>split(financialRows,original.revision,'other'),'P4090');
await denied(()=>split([{...financialRows[0],amount:'1.00'},financialRows[1]]),'P4090');
await denied(()=>split([{...financialRows[0],rate:'10.7090010301'},financialRows[1]]),'P4090');
await rollback(async()=>{await changeReview();await denied(()=>split(),'P4090');});
await rollback(async()=>{await db.exec("UPDATE consumer_units SET address='changed'");await denied(()=>split(),'P4090');});
// Failure after input creation must roll the entire transaction back.
await db.exec("CREATE FUNCTION reject_split_tariff_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure' USING ERRCODE='P9999';END $$;CREATE TRIGGER reject_split_tariff_test BEFORE INSERT ON calculation_parameters FOR EACH ROW EXECUTE FUNCTION reject_split_tariff_test()");
await denied(()=>split(),'P9999');
ok((await db.query('SELECT * FROM calculation_monthly_inputs')).rows.length===1);ok((await db.query('SELECT * FROM document_ocr_split_demand_integrations')).rows.length===0);
await db.exec('DROP TRIGGER reject_split_tariff_test ON calculation_parameters');
await db.exec('SET ROLE service_role');const out=await split();const replay=await split();ok(replay.alreadyIntegrated&&replay.inputId===out.inputId);
const versions=(await db.query('SELECT * FROM calculation_monthly_inputs ORDER BY version')).rows;
assert.deepEqual(versions[0],original);checks++;
ok(versions.length===2&&versions[1].previous_id===original.id&&versions[1].status==='DRAFT'&&versions[1].origin==='OCR_REVIEWED');
ok(versions[1].billed_demand.ACL.used==='234.6400'&&versions[1].billed_demand.ACL.unused==='265.3600'&&versions[1].measurements.demandSingle===null);
const tariffs=(await db.query('SELECT *,amount::text AS exact_amount FROM calculation_parameters ORDER BY component_code')).rows;
ok(tariffs.length===2&&tariffs.every(p=>p.status==='DRAFT'&&p.created_by==='actor'&&p.treatment==='GROSS'));
ok(tariffs.some(p=>p.amount_text==='10.70900103'&&p.exact_amount==='10.709001030'));
ok(tariffs.find(p=>p.component_code==='TUSD_DEMAND_UNUSED').embedded_tax_codes.join(',')==='PIS,COFINS');
assert.deepEqual((await db.query('SELECT * FROM calculation_monthly_input_events WHERE input_id=$1 ORDER BY revision',[original.id])).rows,priorEvents);checks++;
await db.exec('RESET ROLE');await rollback(async()=>{await changeReview();await denied(()=>db.query("UPDATE calculation_monthly_inputs SET status='VALIDATED' WHERE id=$1",[out.inputId]),'P4090');});await rollback(async()=>{await changeReview();await denied(()=>db.query("UPDATE calculation_parameters SET status='APPROVED' WHERE id=$1",[out.parameterIds[0]]),'P4090');});
for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await denied(()=>split(),'42501');await denied(()=>db.exec('SELECT * FROM document_ocr_split_demand_integrations'),'42501');await db.exec('RESET ROLE');}
await db.exec('SET ROLE service_role');await denied(()=>db.exec("UPDATE document_ocr_split_demand_integrations SET created_by='fake'"),'42501');await db.exec('RESET ROLE');

console.log(checks+' OCR split demand SQL checks passed');await db.close();
