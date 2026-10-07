import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aclFixture} from './acl-test-fixture.mjs';
const {db,actor,peer,client,call,migrate,create,work,evidence,doc}=await aclFixture();let checks=0;
const check=v=>{assert.ok(v);checks++;},deny=async fn=>{await assert.rejects(fn);checks++;};
await migrate('20261006_acl_history_simulation.sql');await migrate('20261006_acl_economic_studies.sql');
try{
 let row=await create();const note='Fontes e premissas conferidas pelo Consultor responsável.';
 const submit=(stage,documents,facts={})=>evidence(row.id,row.revision,'SUBMIT',{stage,documents,facts,kind:'COMPLETE',note});
 await doc('registration');row=(await work(row.id,row.revision,'registration','START')).admission;
 let e=await submit('registration',['registration']);row=e.admission;row=(await evidence(row.id,row.revision,'APPROVE',{evidence:e.evidenceId,note,actor:peer})).admission;row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:e.evidenceId})).admission;
 await doc('invoice','INVOICE_DISTRIBUTOR','2026-08-01');row=(await work(row.id,row.revision,'invoices','START')).admission;
 const history={sourceDocumentId:'invoice',rows:Array.from({length:12},(_,i)=>({month:new Date(Date.UTC(2025,8+i,1)).toISOString().slice(0,7),peakKwh:'10',offPeakKwh:'100',demandKw:'200',days:30,page:2,source:'table'}))};
 e=await submit('invoices',['invoice'],{history});row=e.admission;row=(await evidence(row.id,row.revision,'APPROVE',{evidence:e.evidenceId,note,actor:peer})).admission;row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:e.evidenceId})).admission;
 const source=await call('acl_history_simulation_source',['o1',actor,'r1',false,row.id,e.evidenceId]);
 await migrate('20261006_acl_reference_costs.sql');await migrate('20261006_acl_admission_closure.sql');await migrate('20261006_acl_checklists.sql');await migrate('20261007_acl_financial_review.sql');
 row=(await work(row.id,row.revision,'feasibility','START')).admission;
 const snapshot={schemaVersion:'acl-economic-study/1',source,result:{evidenceId:e.evidenceId,documents:source.documents,formulaVersion:'acl-supplier-preview/4',partial:true,totalAclCost:null,savings:null,roi:null,payback:null,variableFee:null,pending:['Independent review'],proposal:{months:12},financialComparison:{state:'COMPLETE_SIMULATED',formulaVersion:'acl-financial/1',rows:Array(12).fill({saving:'100'}),operatingSavings:'1200',netCash:'200'}}};
 const save=async body=>{const s=await call('acl_economic_study_command',['o1',actor,'r1',false,row.id,randomUUID(),row.revision,'SAVE',true,body,null,null,null]);row=s.admission;return (await call('acl_economic_study_read',['o1',actor,'r1',false,row.id,null])).find(v=>v.id===s.studyId);};
 const checksBody={sources:true,costs:true,gd:true,cashFlow:true,limitations:true};
 const review=(study,opts={})=>call('acl_financial_review_command',[opts.org??'o1',opts.actor??peer,'r1',false,row.id,opts.request??randomUUID(),opts.revision??row.revision,study.id,opts.hash??study.hash,note,opts.decision??'FAVORABLE',opts.checks??checksBody,true]);
 const first=await save(snapshot);
 await deny(()=>review(first,{actor}));await deny(()=>review(first,{org:'o2'}));await deny(()=>review(first,{checks:{...checksBody,gd:false}}));await deny(()=>review(first,{hash:'a'.repeat(64)}));
 await db.exec("UPDATE document_catalog SET revision=2 WHERE document_id='invoice'");await deny(()=>review(first));await db.exec("UPDATE document_catalog SET revision=1 WHERE document_id='invoice'");
 let rq=randomUUID(),rv=row.revision,approved=await review(first,{request:rq,revision:rv});check(approved.ok);row=approved.admission;check((await review(first,{request:rq,revision:rv})).replayed);await deny(()=>review(first,{request:rq,revision:rv,decision:'UNFAVORABLE'}));
 const visible=await call('acl_economic_study_read',['o1',actor,'r1',false,row.id,null]);check(visible[0].financialReview.decision==='FAVORABLE');
 const unfavorable=await save({...snapshot,result:{...snapshot.result,financialComparison:{...snapshot.result.financialComparison,netCash:'-100',operatingSavings:'-1'}}});
 await deny(()=>review(unfavorable));let bad=await review(unfavorable,{decision:'UNFAVORABLE'});check(bad.ok);row=bad.admission;
 await deny(()=>evidence(row.id,row.revision,'SUBMIT',{stage:'feasibility',documents:['invoice'],facts:{},kind:'COMPLETE',note}));
 await deny(()=>evidence(row.id,row.revision,'SUBMIT',{stage:'feasibility',documents:['invoice'],facts:{financialStudy:{id:unfavorable.id,hash:unfavorable.hash}},kind:'COMPLETE',note}));
 const catalog=await call('acl_checklist_catalog',['o1',actor,'r1',false,row.id]);
 const checklist=stage=>({templateVersion:catalog.version,reference:note,referenceDate:'2026-10-07',items:Object.fromEntries(catalog.stages[stage].COMPLETE.map(i=>[i.key,{status:'CONFIRMED',note,documentId:'invoice'}]))});
 let link=await evidence(row.id,row.revision,'SUBMIT',{stage:'feasibility',documents:['invoice'],facts:{financialStudy:{id:first.id,hash:first.hash},checklist:checklist('feasibility')},kind:'COMPLETE',note});check(link.ok);row=link.admission;
 check((await db.query('SELECT study_id FROM acl_feasibility_studies WHERE evidence_id=$1',[link.evidenceId])).rows[0].study_id===first.id);
 await db.exec("UPDATE document_catalog SET revision=2 WHERE document_id='invoice'");await deny(()=>evidence(row.id,row.revision,'APPROVE',{evidence:link.evidenceId,note,actor:peer}));await db.exec("UPDATE document_catalog SET revision=1 WHERE document_id='invoice'");
 row=(await evidence(row.id,row.revision,'APPROVE',{evidence:link.evidenceId,note,actor:peer})).admission;row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:link.evidenceId})).admission;check(row.stages.find(s=>s.key==='feasibility').status==='COMPLETED');
 const readEvidence=await call('acl_evidence_read',['o1',actor,'r1',false,row.id,null]);check(readEvidence.find(e=>e.id===link.evidenceId).financialStudy.id===first.id);
 for(const stage of ['modality','contracts','termination','technical','metering','custody','contract-registration','validation','supply']){
  row=(await work(row.id,row.revision,stage,'START')).admission;
  let docs=[await doc('financial-'+stage)];if(stage==='contracts')docs=[await doc('financial-energy','CONTRACT_ENERGY'),await doc('financial-management','CONTRACT_MANAGEMENT')];
  const facts=stage==='modality'?{modality:'RETAIL'}:stage==='supply'?{supplyDate:'2026-11-01'}:{};
  facts.checklist={...checklist(stage),items:Object.fromEntries(catalog.stages[stage].COMPLETE.map(i=>[i.key,{status:'CONFIRMED',note,documentId:docs[0]}]))};
  const ev=await evidence(row.id,row.revision,'SUBMIT',{stage,documents:docs,kind:'COMPLETE',facts,note});row=ev.admission;
  row=(await evidence(row.id,row.revision,'APPROVE',{evidence:ev.evidenceId,note,actor:peer})).admission;row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:ev.evidenceId})).admission;
 }
 const closed=await call('acl_closure_command',['o1',actor,'r1',false,row.id,randomUUID(),row.revision,'CLOSE',true,null,null]);check(closed.ok);check(closed.closure.performance.body.evidence.find(e=>e.stageKey==='feasibility').financialStudy.id===first.id);
 for(const name of ['acl_financial_reviews','acl_feasibility_studies']){await deny(()=>db.exec('SET ROLE authenticated; SELECT * FROM '+name));await db.exec('RESET ROLE');check((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass",[name])).rows[0].relrowsecurity);}
 for(const fn of ['acl_check_financial_study(text,text,text,boolean,uuid,uuid,text)','acl_evidence_command_financial_internal(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean)','acl_financial_review_command(text,text,text,boolean,uuid,uuid,integer,uuid,text,text,text,jsonb,boolean)'])check((await db.query("SELECT NOT has_function_privilege('authenticated',$1,'EXECUTE') denied",[fn])).rows[0].denied);
 await deny(()=>db.query('UPDATE acl_financial_reviews SET decision=$1 WHERE study_id=$2',['CONDITIONAL',first.id]));await deny(()=>db.query('DELETE FROM acl_feasibility_studies WHERE evidence_id=$1',[link.evidenceId]));
 console.log(JSON.stringify({ok:true,checks,scope:'synthetic in-memory only'}));
}finally{await db.close();}
