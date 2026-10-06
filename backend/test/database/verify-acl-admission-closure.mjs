import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { aclFixture } from './acl-test-fixture.mjs';
const {db,actor,peer,client,perms,call,migrate,create,work,evidence,doc}=await aclFixture();let checks=0;
const check=v=>{assert.ok(v);checks++;};const deny=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
const note='Conferência documental e responsabilidade do Consultor para esta operação.';
try{
 await migrate('20261006_acl_admission_closure.sql');let row=await create();
 const close=(action='CLOSE',opts={})=>call('acl_closure_command',['o1',opts.actor??actor,opts.role??'r1',false,row.id,opts.request??randomUUID(),opts.revision??row.revision,action,opts.checked??true,opts.conclusion??null,opts.hash??null]);
 check((await close()).code==='DEPENDENCIES');
 await deny(()=>close('CLOSE',{checked:false}),'22023');await deny(()=>close('CLOSE',{hash:'a'.repeat(64)}),'22023');
 await deny(()=>close('CLOSE',{actor:client,role:'client'}),'42501');
 await deny(()=>call('acl_closure_read',['o1',client,'client',false,row.id]),'42501');
 check((await close('PUBLISH',{hash:'a'.repeat(64),conclusion:note})).code==='LOCKED');
 for(const stage of ['registration','invoices','feasibility','modality','contracts','technical','metering','custody','contract-registration','termination','validation','supply']){
  row=(await work(row.id,row.revision,stage,'START')).admission;
  let docs=[await doc('close-'+stage)];if(stage==='invoices'){docs=[];for(let i=0;i<12;i++)docs.push(await doc('close-invoice-'+i,'INVOICE_DISTRIBUTOR',new Date(Date.UTC(2025,9+i,1)).toISOString().slice(0,10)));}
  if(stage==='contracts')docs=[await doc('close-energy','CONTRACT_ENERGY'),await doc('close-management','CONTRACT_MANAGEMENT')];
  const facts=stage==='modality'?{modality:'RETAIL'}:stage==='supply'?{supplyDate:'2026-12-01'}:{};
  const ev=await evidence(row.id,row.revision,'SUBMIT',{stage,documents:docs,kind:'COMPLETE',facts,note});row=ev.admission;
  row=(await evidence(row.id,row.revision,'APPROVE',{evidence:ev.evidenceId,note,actor:peer})).admission;
  row=(await evidence(row.id,row.revision,'COMPLETE',{evidence:ev.evidenceId})).admission;
 }
 await db.exec("UPDATE roles SET name='operacional' WHERE id='r1'");await deny(()=>close(),'42501');await db.exec("UPDATE roles SET name='gestor' WHERE id='r1'");
 await db.exec("UPDATE document_catalog SET revision=2 WHERE document_id='close-registration'");await deny(()=>close(),'22023');await db.exec("UPDATE document_catalog SET revision=1 WHERE document_id='close-registration'");
 const request=randomUUID(),revision=row.revision,closed=await close('CLOSE',{request});row=closed.admission;
 check(closed.ok&&row.status==='COMPLETED'&&row.revision===revision+1);check(closed.closure.performance.version===1&&!closed.closure.summary);
 const performance=closed.closure.performance;
 check(performance.body.stages.length===12&&performance.body.evidence.length===12&&performance.body.sessions.length===12);
 check(performance.body.evidence.every(e=>e.reviewerName==='Consultor 2'));
 check((await db.query("SELECT encode(sha256(convert_to(body::text,'UTF8')),'hex')=payload_hash AS ok FROM acl_admission_performance_versions")).rows[0].ok);
 check((await close('CLOSE',{request,revision})).replayed);check((await close()).code==='LOCKED');
 await deny(()=>db.exec("UPDATE acl_admissions SET updated_at=now()"),'23514');await deny(()=>db.exec("DELETE FROM acl_admission_performance_versions"),'23514');
 check(!(await db.query('SELECT free_market FROM consumer_units WHERE id=$1',['u1'])).rows[0].free_market);
 let portal=(await call('acl_portal',['o1',client,'client',null]))[0];check(portal.status==='CONCLUDED'&&!portal.summary);
 await deny(()=>close('PUBLISH',{hash:'a'.repeat(64),conclusion:note}),'22023');await deny(()=>close('PUBLISH',{hash:performance.hash,conclusion:'curto'}),'22023');
 check((await close('PUBLISH',{hash:performance.hash,conclusion:note,revision:revision})).code==='CONFLICT');
 const publishRequest=randomUUID(),published=await close('PUBLISH',{request:publishRequest,hash:performance.hash,conclusion:note});check(published.ok&&published.closure.summary.conclusion===note);
 check(published.admission.revision===row.revision);check((await close('PUBLISH',{request:publishRequest,hash:performance.hash,conclusion:note})).replayed);
 await deny(()=>close('PUBLISH',{request:publishRequest,hash:performance.hash,conclusion:note+' alterado'}),'40001');
 check((await close('PUBLISH',{hash:performance.hash,conclusion:note})).code==='LOCKED');await deny(()=>db.exec("UPDATE acl_admission_public_summaries SET conclusion='Outra conclusão'"),'23514');
 portal=(await call('acl_portal',['o1',client,'client',null]))[0];check(portal.status==='CONCLUDED'&&portal.summary.modality==='RETAIL'&&portal.summary.supplyDate==='2026-12-01');
 check(!/evidence|sessions|stages|actorId|payload_hash|reviewer/.test(JSON.stringify(portal)));
 check((await db.query("SELECT count(*)::int AS n FROM acl_admission_events WHERE action IN ('CLOSE','PUBLISH')")).rows[0].n===2);
 await db.exec("UPDATE licenses SET document_management=false WHERE organization_id='o1'");await deny(()=>close('PUBLISH',{request:publishRequest,hash:performance.hash,conclusion:note}),'42501');await db.exec("UPDATE licenses SET document_management=true WHERE organization_id='o1'");
 await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms.filter(p=>p!=='26cadaa7-2eea-4080-91f6-1f26f87ca809'))]);await deny(()=>close('CLOSE',{request,revision}),'42501');
 await db.exec('SET ROLE authenticated');try{await deny(()=>call('acl_closure_read',['o1',actor,'r1',false,row.id]),'42501');}finally{await db.exec('RESET ROLE');}
 console.log(JSON.stringify({ok:true,checks}));
}finally{await db.close();}
