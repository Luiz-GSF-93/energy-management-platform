import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();let count=0;const ok=(v,m)=>{assert.ok(v,m);count++;};const fail=async q=>{await assert.rejects(()=>db.exec(q));count++;};
try{
 await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE documents(id text primary key,organization_id text,document_type text,file_verified boolean,storage_bucket text,file_hash text,customer_id text,consumer_unit_id text,reference_month date);GRANT SELECT ON documents TO service_role;");
 for(const name of ['20260926_f1_61_ocr_queue.sql','20260926_f1_64_invoice_quarantine.sql'])await db.exec(readFileSync(new URL('../../src/database/migrations/'+name,import.meta.url),'utf8'));
 const hash='a'.repeat(64);
 const add=async(id,type='INVOICE_DISTRIBUTOR',verified=true)=>db.query("INSERT INTO documents VALUES($1,'org',$2,$3,'energy-documents-private',$4,'customer','unit','2026-08-01')",[id,type,verified,hash]);
 const state=async id=>(await db.query('select intake_state,intake_can_import from documents_with_intake where id=$1',[id])).rows[0];
 await add('waiting');ok((await state('waiting')).intake_state==='QUARANTINED','receipt starts quarantined');
 await add('metadata','INVOICE_DISTRIBUTOR',false);ok((await state('metadata')).intake_state==='PENDING_RECEIPT','metadata not verified');
 await add('other','OTHER');ok((await state('other')).intake_state==='NOT_APPLICABLE','other document separate');
 await db.query("select enqueue_document_ocr('org','waiting','actor')");ok((await state('waiting')).intake_state==='IN_REVIEW','queue visible');
 async function evidence(id,decision,sourceOverride={},extra={}){await add(id);const j=(await db.query("select * from enqueue_document_ocr('org',$1,'actor')",[id])).rows[0];await db.query("update document_ocr_jobs set state='SUCCEEDED' where id=$1",[j.id]);const assessment={version:'intake-assessment-v1',source:{organizationId:'org',documentId:id,fileHash:hash,customerId:'customer',unitId:'unit',referenceMonth:'2026-08',...sourceOverride},intake:{decision,canImport:false},...extra};await db.query('insert into document_ocr_results(job_id,organization_id,document_id,file_hash,raw_result,evidence) values($1,$2,$3,$4,$5,$6)',[j.id,'org',id,hash,{}, {assessment}]);}
 await evidence('rejected','REJECT_AUTOMATION');ok((await state('rejected')).intake_state==='REJECTED','rejected derived');
 await evidence('review','REVIEW_REQUIRED');ok((await state('review')).intake_state==='REVIEW_REQUIRED','review derived');
 await evidence('fake-approval','ELIGIBLE_FOR_IMPORT');ok((await state('fake-approval')).intake_state==='QUARANTINED','approval not supported');
 for(const key of ['documentId','organizationId','customerId','unitId','fileHash','referenceMonth']){await evidence('changed-'+key,'REJECT_AUTOMATION',{[key]:'changed'});ok((await state('changed-'+key)).intake_state==='QUARANTINED','changed '+key+' quarantined');}
 await evidence('unknown-version','REJECT_AUTOMATION',{}, {version:'unknown'});ok((await state('unknown-version')).intake_state==='QUARANTINED','unknown version quarantined');
 ok((await db.query('select * from documents_with_intake where intake_can_import')).rows.length===0,'nothing importable');
 await fail("update document_ocr_results set evidence='{}'");
 await db.exec('SET ROLE authenticated');await fail('select * from documents_with_intake');await db.exec('RESET ROLE;SET ROLE anon');await fail('select * from documents_with_intake');await db.exec('RESET ROLE;SET ROLE service_role');ok((await db.query('select * from documents_with_intake')).rows.length>0,'service read permitted');await fail("update documents_with_intake set customer_id='other'");await db.exec('RESET ROLE');
 console.log(count+' quarantine database checks passed; no production connection');
}finally{await db.close();}
