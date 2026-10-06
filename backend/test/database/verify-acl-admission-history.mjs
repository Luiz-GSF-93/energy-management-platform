import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { aclFixture } from './acl-test-fixture.mjs';
const {db,actor,peer,client,perms,call,migrate,create,work,evidence,doc}=await aclFixture();let checks=0;
const check=v=>{assert.ok(v);checks++;};const deny=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);checks++;};
const note='Conferência documental e responsabilidade do Consultor para esta operação.';
try{
 await migrate('20261006_acl_admission_closure.sql');await migrate('20261006_acl_admission_history.sql');let row=await create();
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
 await db.exec("UPDATE consumer_units SET free_market=true WHERE id='u1'"); // A completed migration can later have its unit explicitly updated by its own authorized registry flow.
 const frozen=JSON.stringify(row),hash=performance.hash;const reopenRequest=randomUUID();
 const reopen=(extra={})=>call('acl_reopen',['o1',extra.actor??actor,extra.role??'r1',false,row.id,extra.request??reopenRequest,extra.revision??row.revision,extra.reason??note,extra.checked??true]);
 await deny(()=>reopen({checked:false}),'22023');await deny(()=>reopen({actor:client,role:'client'}),'42501');
 check((await reopen({revision:row.revision-1})).code==='CONFLICT');
 const opened=await reopen();const fresh=opened.admission;check(opened.ok&&fresh.id!==row.id&&fresh.previousId===row.id&&fresh.rootId===row.id&&fresh.generation===2);
 check(fresh.stages.every(s=>s.status==='NOT_STARTED'&&s.elapsedMs===0&&!s.evidenceRef)&&fresh.revision===1);
 check(JSON.stringify((await call('acl_read',['o1',actor,'r1',false,row.id,null]))[0])===frozen);
 check((await call('acl_closure_read',['o1',actor,'r1',false,row.id])).performance.hash===hash);
 check((await reopen()).replayed);await deny(()=>reopen({reason:note+' alterada'}),'40001');check((await reopen({request:randomUUID()})).code==='LOCKED');
 check((await call('acl_reopen',['o1',actor,'r1',false,fresh.id,randomUUID(),1,note,true])).code==='LOCKED');
 await deny(()=>call('acl_create',['o1',actor,'r1',false,randomUUID(),'c1','u1']),'22023');
 let visible=await call('acl_portal',['o1',client,'client',null]);check(visible.length===1&&visible[0].status==='IN_PROGRESS'&&!visible[0].summary);
 check(!/previousId|rootId|generation|reopenReason/.test(JSON.stringify(visible)));
 check((await call('acl_candidates',['o1',actor,'r1',false,''])).every(c=>c.unitId!=='u1'));
 const compare=await call('acl_performance_read',['o1',actor,'r1',false,null,'u1']);check(compare.length===1&&compare[0].generation===1&&compare[0].hash===hash);
 check(compare[0].stages.length===12&&compare[0].calendarMs>=0&&compare[0].responsibles[0].actorId===actor);
 check(compare[0].activeMs===compare[0].responsibles.reduce((sum,r)=>sum+r.activeMs,0));
 check((await call('acl_performance_read',['o1',actor,'r1',false,null,'u2'])).length===0);
 // Re-confer each stage in a second real process; previous approvals are not reused.
 let second=fresh;
 for(const stage of ['registration','invoices','feasibility','modality','contracts','technical','metering','custody','contract-registration','termination','validation','supply']){
  second=(await work(second.id,second.revision,stage,'START')).admission;
  let docs=[await doc('history-'+stage)];if(stage==='invoices'){docs=[];for(let i=0;i<12;i++)docs.push(await doc('history-invoice-'+i,'INVOICE_DISTRIBUTOR',new Date(Date.UTC(2025,9+i,1)).toISOString().slice(0,10)));}
  if(stage==='contracts')docs=[await doc('history-energy','CONTRACT_ENERGY'),await doc('history-management','CONTRACT_MANAGEMENT')];
  const facts=stage==='modality'?{modality:'RETAIL'}:stage==='supply'?{supplyDate:'2027-01-01'}:{};
  const ev=await evidence(second.id,second.revision,'SUBMIT',{stage,documents:docs,kind:'COMPLETE',facts,note});second=ev.admission;
  second=(await evidence(second.id,second.revision,'APPROVE',{evidence:ev.evidenceId,note,actor:peer})).admission;
  second=(await evidence(second.id,second.revision,'COMPLETE',{evidence:ev.evidenceId})).admission;
 }
 const final=await call('acl_closure_command',['o1',actor,'r1',false,second.id,randomUUID(),second.revision,'CLOSE',true,null,null]);second=final.admission;
 const two=await call('acl_performance_read',['o1',actor,'r1',false,null,'u1']);check(two.length===2&&two.some(p=>p.generation===1&&p.hash===hash)&&two.some(p=>p.generation===2&&p.previousId===row.id));
 check(two.every(p=>p.activeMs===p.responsibles.reduce((sum,r)=>sum+r.activeMs,0)));
 const third=await call('acl_reopen',['o1',actor,'r1',false,second.id,randomUUID(),second.revision,note,true]);check(third.admission.generation===3&&third.admission.rootId===row.id&&third.admission.previousId===second.id);
 check((await call('acl_portal',['o1',client,'client',null])).length===1);
 await db.query("INSERT INTO organization_members VALUES('o1',$1,'r1','ACTIVE','external','c1','Duplicado')",[actor]);
 await deny(()=>call('acl_performance_read',['o1',actor,'r1',false,null,null]),'42501');await deny(()=>call('acl_read',['o1',actor,'r1',false,row.id,null]),'42501');
 await db.query("DELETE FROM organization_members WHERE user_id=$1 AND display_name='Duplicado'",[actor]);
 await db.query("UPDATE roles SET permissions=$1 WHERE id='client'",[JSON.stringify({'3ebadd32-6f30-459e-8ed3-0d2843d89946':true})]);
 await deny(()=>call('acl_portal',['o1',client,'client',null]),'42501');await db.query("UPDATE roles SET permissions=$1 WHERE id='client'",[JSON.stringify(['3ebadd32-6f30-459e-8ed3-0d2843d89946'])]);
 await deny(()=>call('acl_performance_read',['o1',client,'client',false,null,null]),'42501');
 await deny(()=>call('acl_reopen',['o2',actor,'r2',false,row.id,randomUUID(),row.revision,note,true]),'42501');
 await db.exec("UPDATE roles SET name='operacional' WHERE id='r1'");await deny(()=>reopen(),'42501');await db.exec("UPDATE roles SET name='gestor' WHERE id='r1'");
 await db.exec("UPDATE licenses SET document_management=false WHERE organization_id='o1'");await deny(()=>reopen(),'42501');await deny(()=>call('acl_performance_read',['o1',actor,'r1',false,null,'u2']),'42501');await db.exec("UPDATE licenses SET document_management=true WHERE organization_id='o1'");
 await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms.filter(p=>p!=='26cadaa7-2eea-4080-91f6-1f26f87ca809'))]);await deny(()=>reopen(),'42501');
 await db.exec('SET ROLE authenticated');try{await deny(()=>call('acl_performance_read',['o1',actor,'r1',false,null,null]),'42501');}finally{await db.exec('RESET ROLE');}
 console.log(JSON.stringify({ok:true,checks}));
}finally{await db.close();}
