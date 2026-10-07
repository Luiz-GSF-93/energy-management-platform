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

 await db.exec("CREATE TABLE monthly_energy_settlements(organization_id text,customer_id text,consumer_unit_id text,month date,status text,validation_status text,financial_format text,financial_payload jsonb,financial_hash text,approved_at timestamptz,published_at timestamptz,version_number integer)");
 await migrate('20261007_energy_price_score.sql');
 const baseline={state:'AVAILABLE',method:'ANNUAL_ENERGY_WEIGHTED_GD_TE',annualKwh:'12000',annualGrossTe:'7200.00',annualNetTe:'3600.00',months:Array.from({length:12},(_,i)=>({sourceMonth:'2026-'+String(i+1).padStart(2,'0'),kwh:'1000',grossTe:'600.00',netTe:'300.00'}))};
 const publish=(o='o1',who=actor,study=first,request=randomUUID(),payload=baseline)=>call('energy_price_publish',[o,who,'r1',false,study.id,study.hash,request,payload]);
 const read=(o='o1',who=actor,role='r1',portal=false,customer='c1',unit=null)=>call('energy_price_read',[o,who,role,false,portal,2026,customer,unit]);
 await deny(()=>publish('o2'));await deny(()=>publish('o1',client));await deny(()=>publish('o1',actor,first,randomUUID(),null));
 const key=randomUUID(),published=await publish('o1',actor,first,key);check(!!published.id);check((await publish('o1',actor,first,key)).replayed);await deny(()=>publish('o1',peer,first,key));
 const dashboard=await read();check(dashboard.units.length===2);check(dashboard.baselines.length===1);check(dashboard.studies.length===1);
 const portal=await read('o1',client,'client',true,null);check(portal.customerId==='c1');check(portal.studies.length===0);check(portal.baselines.length===1);check(portal.canPublish===false);
 await deny(()=>read('o1',client,'client',true,'c2'));await deny(()=>read('o1',actor,'r1',false,'c2'));await deny(()=>read('o1',actor,'r1',false,'c1','u2'));await deny(()=>read('o2',actor));
 await db.exec("UPDATE licenses SET active=false WHERE organization_id='o1'");await deny(()=>read());await db.exec("UPDATE licenses SET active=true WHERE organization_id='o1'");
 await db.exec("UPDATE document_catalog SET revision=2 WHERE document_id='invoice'");await deny(()=>publish());await db.exec("UPDATE document_catalog SET revision=1 WHERE document_id='invoice'");
 for(const name of ['energy_price_baselines','energy_price_pld_monthly']){await deny(()=>db.exec('SET ROLE authenticated; SELECT * FROM '+name));await db.exec('RESET ROLE');check((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass",[name])).rows[0].relrowsecurity);}
 for(const fn of ['energy_price_actor(text,text,text,boolean,boolean)','energy_price_read(text,text,text,boolean,boolean,integer,text,text)','energy_price_publish(text,text,text,boolean,uuid,text,uuid,jsonb)'])check((await db.query("SELECT NOT has_function_privilege('authenticated',$1,'EXECUTE') denied",[fn])).rows[0].denied);
 await deny(()=>db.query("UPDATE energy_price_baselines SET payload='{}'"));await deny(()=>db.query('DELETE FROM energy_price_baselines'));
 console.log(JSON.stringify({ok:true,checks,scope:'synthetic in-memory only'}));
}finally{await db.close();}
