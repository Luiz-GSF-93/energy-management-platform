import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { aclFixture } from './acl-test-fixture.mjs';
const f=await aclFixture();const {db,actor,peer,client,perms,call,create,work,evidence,doc}=f;let checks=0;
const check=v=>{assert.ok(v);checks++;};const deny=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
const note='Conferência manual dos documentos e pré-condições registrada pelo Consultor.';
try{
 let row=await create();const source=await doc('doc-registration');await doc('doc-other-unit','OTHER','2026-09-01','u1b');await doc('doc-other-org','OTHER','2026-09-01','u2','o2','c2');
 await db.exec("UPDATE documents SET reference_month=NULL WHERE id='doc-registration'");
 check((await call('acl_evidence_sources',['o1',actor,'r1',false,row.id,''])).find(s=>s.id===source).month===null);
 const submit=(stage,documents,facts={},kind='COMPLETE',extra={})=>evidence(row.id,row.revision,'SUBMIT',{stage,documents,facts,kind,note,...extra});
 check((await submit('registration',[source])).code==='LOCKED');
 row=(await work(row.id,row.revision,'registration','START')).admission;
 await deny(()=>submit('registration',[source],{forged:true}),'22023');
 await deny(()=>submit('registration',['doc-other-unit']),'22023');await deny(()=>submit('registration',['doc-other-org']),'22023');
 await deny(()=>submit('registration',[source,source]),'22023');await deny(()=>submit('registration',[source],{},'COMPLETE',{checked:false}),'22023');
 await deny(()=>submit('registration',[source],{},'COMPLETE',{actor:client,role:'client'}),'42501');
 const request=randomUUID(),first=await submit('registration',[source],{},'COMPLETE',{request});row=first.admission;
 check(first.ok&&first.evidenceId);check((await evidence(row.id,row.revision-1,'SUBMIT',{stage:'registration',documents:[source],facts:{},kind:'COMPLETE',note,request})).replayed);
 await deny(()=>evidence(row.id,row.revision,'COMPLETE',{evidence:first.evidenceId}),'22023');
 await deny(()=>evidence(row.id,row.revision,'APPROVE',{evidence:randomUUID(),note}),'P4102');
 await db.exec("UPDATE roles SET name='operacional' WHERE id='r1'");await deny(()=>evidence(row.id,row.revision,'APPROVE',{evidence:first.evidenceId,note}),'42501');await db.exec("UPDATE roles SET name='gestor' WHERE id='r1'");
 const approved=await evidence(row.id,row.revision,'APPROVE',{evidence:first.evidenceId,note,actor:peer});row=approved.admission;check(approved.ok);
 check((await evidence(row.id,row.revision,'APPROVE',{evidence:first.evidenceId,note})).code==='LOCKED');
 // A changed catalog invalidates the recorded evidence even after approval.
 await db.exec("UPDATE document_catalog SET revision=2 WHERE document_id='doc-registration'");await deny(()=>evidence(row.id,row.revision,'COMPLETE',{evidence:first.evidenceId}),'22023');await db.exec("UPDATE document_catalog SET revision=1 WHERE document_id='doc-registration'");
 await db.exec("UPDATE documents SET file_verified=false WHERE id='doc-registration'");await deny(()=>evidence(row.id,row.revision,'COMPLETE',{evidence:first.evidenceId}),'22023');await db.exec("UPDATE documents SET file_verified=true WHERE id='doc-registration'");
 check((await evidence(row.id,row.revision,'COMPLETE',{evidence:first.evidenceId,actor:peer})).code==='LOCKED');
 row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:first.evidenceId})).admission;check(row.stages[0].status==='COMPLETED'&&!row.stages[0].active);
 check((await call('acl_portal',['o1',client,'client',null]))[0].status==='IN_PROGRESS');
 await deny(()=>call('acl_evidence_read',['o1',client,'client',false,row.id,null]),'42501');
 check(!(JSON.stringify(await call('acl_portal',['o1',client,'client',null]))).includes('note'));
 const invoiceDocs=[];for(let i=0;i<12;i++){const month=new Date(Date.UTC(2025,9+i,1)).toISOString().slice(0,10);invoiceDocs.push(await doc('invoice-'+i,'INVOICE_DISTRIBUTOR',month));}
 row=(await work(row.id,row.revision,'invoices','START')).admission;
 await deny(()=>submit('invoices',invoiceDocs.slice(0,11)),'22023');
 await db.exec("UPDATE documents SET reference_month='2025-10-02' WHERE id='invoice-1'");await deny(()=>submit('invoices',invoiceDocs),'22023');await db.exec("UPDATE documents SET reference_month='2025-11-01' WHERE id='invoice-1'");
 const inv=await submit('invoices',invoiceDocs);row=inv.admission;
 row=(await evidence(row.id,row.revision,'REJECT',{evidence:inv.evidenceId,note})).admission;
 await deny(()=>evidence(row.id,row.revision,'COMPLETE',{evidence:inv.evidenceId}),'22023');
 const fresh=await submit('invoices',invoiceDocs);row=fresh.admission;
 row=(await evidence(row.id,row.revision,'APPROVE',{evidence:fresh.evidenceId,note})).admission;
 row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:fresh.evidenceId})).admission;check(row.stages.find(s=>s.key==='invoices').status==='COMPLETED');
 // Check dependency locks without forbidding independent work.
 const earlyDoc=await doc('early-contract');row=(await work(row.id,row.revision,'termination','START')).admission;
 const early=await submit('termination',[earlyDoc]);row=early.admission;row=(await evidence(row.id,row.revision,'APPROVE',{evidence:early.evidenceId,note})).admission;
 check((await evidence(row.id,row.revision,'COMPLETE',{evidence:early.evidenceId})).code==='DEPENDENCIES');
 row=(await call('acl_work_command',['o1',actor,'r1',false,row.id,randomUUID(),row.revision,'termination','PAUSE','ENDING_ACTIVITY',null])).admission;
 check((await evidence(row.id,row.revision,'APPROVE',{evidence:early.evidenceId,note})).code==='LOCKED');
 const order=['feasibility','modality','contracts','technical','metering','custody','contract-registration','termination','validation','supply'];
 for(const stage of order){
  const current=row.stages.find(s=>s.key===stage);row=(await work(row.id,row.revision,stage,current.status==='PAUSED'?'RESUME':'START')).admission;
  let docs=[await doc('doc-'+stage)];if(stage==='contracts')docs=[await doc('contract-energy','CONTRACT_ENERGY'),await doc('contract-management','CONTRACT_MANAGEMENT')];
  const facts=stage==='modality'?{modality:'RETAIL'}:stage==='supply'?{supplyDate:'2026-12-01'}:{};
  if(stage==='modality')await deny(()=>submit(stage,docs,{modality:'RETAIL',canApprove:true}),'22023');
  if(stage==='supply')await deny(()=>submit(stage,docs,{supplyDate:'2026-02-30'}),'22023');
  const ev=await submit(stage,docs,facts);row=ev.admission;row=(await evidence(row.id,row.revision,'APPROVE',{evidence:ev.evidenceId,note})).admission;
  row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:ev.evidenceId})).admission;check(row.stages.find(s=>s.key===stage).status==='COMPLETED');
 }
 check(row.stages.every(s=>s.status==='COMPLETED')&&row.status==='IN_PROGRESS');
 const list=await call('acl_evidence_read',['o1',actor,'r1',false,row.id,null]);check(list.length===14&&list.every(e=>e.documents.length>0));
 const sources=await call('acl_evidence_sources',['o1',actor,'r1',false,row.id,'']);check(sources.every(s=>!['doc-other-unit','doc-other-org'].includes(s.id)));
 await deny(()=>call('acl_evidence_sources',['o1',client,'client',false,row.id,'']),'42501');
 await db.exec("UPDATE document_catalog SET tag='OBSOLETE' WHERE document_id='doc-registration'");check(!(await call('acl_evidence_sources',['o1',actor,'r1',false,row.id,''])).some(s=>s.id==='doc-registration'));await db.exec("UPDATE document_catalog SET tag='REVIEWED' WHERE document_id='doc-registration'");
 await deny(()=>db.query("INSERT INTO acl_admission_evidence(id,organization_id,admission_id,customer_id,consumer_unit_id,stage_key,kind,note,facts,created_by,actor_name) VALUES($1,'o1',$2,'c1','u1b','registration','COMPLETE',$3,'{}',$4,'Consultor')",[randomUUID(),row.id,note,actor]),'23503');
 await deny(()=>db.query("INSERT INTO acl_admission_evidence_documents SELECT organization_id,evidence_id,customer_id,consumer_unit_id,'doc-other-unit',file_hash,catalog_revision,catalog_version,document_type,reference_month FROM acl_admission_evidence_documents WHERE evidence_id=$1 LIMIT 1",[first.evidenceId]),'23503');
 // Test-only preconditions isolate the conditional-dispensation adapter.
 let b=await call('acl_create',['o1',actor,'r1',false,randomUUID(),'c1','u1b']);const skipDoc=await doc('skip-proof','OTHER','2026-09-01','u1b');
 const skipStage=stage=>evidence(b.id,b.revision,'SUBMIT',{stage,documents:[skipDoc],facts:{},kind:'SKIP',note});
 check((await skipStage('registration')).code==='LOCKED');
 let skip=await skipStage('custody');b=skip.admission;b=(await evidence(b.id,b.revision,'APPROVE',{evidence:skip.evidenceId,note})).admission;
 check((await evidence(b.id,b.revision,'SKIP',{evidence:skip.evidenceId})).code==='DEPENDENCIES');
 b={...b,stages:b.stages.map(s=>s.key==='modality'?{...s,status:'COMPLETED',modality:'OWN_AGENT'}:s)};await db.query('UPDATE acl_admissions SET state=$1 WHERE id=$2',[JSON.stringify(b),b.id]);
 await deny(()=>evidence(b.id,b.revision,'SKIP',{evidence:skip.evidenceId}),'22023');
 b={...b,stages:b.stages.map(s=>s.key==='modality'?{...s,modality:'RETAIL'}:s)};await db.query('UPDATE acl_admissions SET state=$1 WHERE id=$2',[JSON.stringify(b),b.id]);
 b=(await evidence(b.id,b.revision,'SKIP',{evidence:skip.evidenceId})).admission;check(b.stages.find(s=>s.key==='custody').status==='SKIPPED'&&b.stages.find(s=>s.key==='custody').elapsedMs===0);
 check((await evidence(b.id,b.revision,'SKIP',{evidence:skip.evidenceId})).code==='LOCKED');
 await db.exec("UPDATE licenses SET document_management=false WHERE organization_id='o1'");await deny(()=>call('acl_evidence_read',['o1',actor,'r1',false,row.id,null]),'42501');await db.exec("UPDATE licenses SET document_management=true WHERE organization_id='o1'");
 for(const table of ['acl_admission_evidence','acl_admission_evidence_documents','acl_admission_evidence_reviews']){
  await deny(()=>db.query('DELETE FROM '+table),'23514');
  await db.exec('SET ROLE service_role');try{await deny(()=>db.query('DELETE FROM '+table),'42501');}finally{await db.exec('RESET ROLE');}
 }
 await db.exec('SET ROLE authenticated');try{await deny(()=>call('acl_evidence_read',['o1',actor,'r1',false,row.id,null]),'42501');}finally{await db.exec('RESET ROLE');}
 check((await db.query("SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f' AND confrelid='public.documents'::regclass AND conrelid='public.acl_admission_evidence_documents'::regclass AND cardinality(conkey)=1")).rows[0].n===1); // Existing correction RPC recognizes single-column derived document links.
 console.log(JSON.stringify({ok:true,checks}));
}finally{await db.close();}
