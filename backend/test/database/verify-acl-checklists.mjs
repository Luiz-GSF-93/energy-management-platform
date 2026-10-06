import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aclFixture} from './acl-test-fixture.mjs';
const f=await aclFixture(),{db,actor,call}=f;let checks=0;
const ok=v=>{assert.ok(v);checks++;};
const rejected=async(fn,code)=>{await assert.rejects(fn,e=>!code||(Array.isArray(code)?code.includes(e.code):e.code===code));checks++;};
try{
 await f.migrate('20261006_acl_admission_closure.sql');await f.migrate('20261006_acl_checklists.sql');
 let a=await f.create();const catalog=await call('acl_checklist_catalog',['o1',actor,'r1',false,a.id]);ok(Object.keys(catalog.stages).length===10);
 await rejected(()=>call('acl_checklist_catalog',['o2',actor,'r2',false,a.id]));await rejected(()=>call('acl_checklist_catalog',['o1',f.client,'client',false,a.id]),'42501');
 await f.doc('technical-source');await f.doc('foreign-source','OTHER','2026-09-01','u2','o2','c2');
 a=(await f.work(a.id,a.revision,'technical','START')).admission;
 const checklist={templateVersion:catalog.version,reference:'CUSD e documentação técnica vigentes da unidade.',referenceDate:'2026-10-06',items:Object.fromEntries(catalog.stages.technical.COMPLETE.map(s=>[s.key,{status:'CONFIRMED',note:'Conferido pelo Consultor na fonte indicada.',documentId:'technical-source'}]))};
 const req=randomUUID(),opts={stage:'technical',kind:'COMPLETE',documents:['technical-source'],note:'Documentação técnica conferida na fonte indicada.',facts:{checklist},request:req};
 const submit=(change={},request=req)=>f.evidence(a.id,a.revision,'SUBMIT',{...opts,...change,request});
 await rejected(()=>submit({facts:{}}),'22023');
 await rejected(()=>submit({facts:{checklist:{...checklist,reference:'curta'}}}),'22023');
 await rejected(()=>submit({facts:{checklist:{...checklist,organizationId:'o2'}}}),'22023');
 await rejected(()=>submit({facts:{checklist:{...checklist,referenceDate:'2026-02-30'}}}));
 await rejected(()=>submit({facts:{checklist:{...checklist,items:{...checklist.items,forged:{}}}}}),'22023');
 await rejected(()=>submit({facts:{checklist:{...checklist,items:{...checklist.items,unit:{...checklist.items.unit,status:'NOT_APPLICABLE'}}}}}),'22023');
 await rejected(()=>submit({facts:{checklist:{...checklist,items:{...checklist.items,unit:{...checklist.items.unit,documentId:'foreign-source'}}}}}),'22023');
 await db.exec(`CREATE FUNCTION test_checklist_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic failure' USING ERRCODE='P2032';END$$;CREATE TRIGGER test_checklist_failure BEFORE INSERT ON acl_admission_checklists FOR EACH ROW EXECUTE FUNCTION test_checklist_failure();`);
 await rejected(()=>submit(),'P2032');ok((await db.query('SELECT count(*)::integer n FROM acl_admission_evidence')).rows[0].n===0);ok((await call('acl_read',['o1',actor,'r1',false,a.id,null]))[0].revision===a.revision);
 await db.exec('DROP TRIGGER test_checklist_failure ON acl_admission_checklists;DROP FUNCTION test_checklist_failure();');
 const v=await submit();ok(v.ok);ok((await db.query('SELECT count(*)::integer n FROM acl_admission_checklists')).rows[0].n===1);ok((await submit()).evidenceId===v.evidenceId);
 await rejected(()=>submit({facts:{checklist:{...checklist,reference:'Outra referência não pode alterar esta tentativa.'}}}),'40001');
 const read=await call('acl_evidence_read',['o1',actor,'r1',false,a.id,null]);assert.deepEqual(read[0].checklist,checklist);checks++;
 await rejected(()=>db.query('UPDATE acl_admission_checklists SET payload=$1',[JSON.stringify(checklist)]),'23514');
 await rejected(()=>db.exec("UPDATE acl_checklist_templates SET version='altered'"),'23514');
 const approval=await f.evidence(a.id,v.admission.revision,'APPROVE',{evidence:v.evidenceId,note:'Conferência revisada pelo Gestor desta organização.'});ok(approval.ok);
 const attempt=await f.evidence(a.id,approval.admission.revision,'COMPLETE',{evidence:v.evidenceId});ok(attempt.ok===false&&attempt.code==='DEPENDENCIES');
 await db.query("UPDATE organization_members SET exclusive_customer_id='c2' WHERE user_id=$1",[actor]);await rejected(()=>call('acl_evidence_read',['o1',actor,'r1',false,a.id,null]),['42501','P4102']);await rejected(()=>submit(),['42501','P4102']);await db.query('UPDATE organization_members SET exclusive_customer_id=NULL WHERE user_id=$1',[actor]);
 await db.exec("UPDATE licenses SET document_management=false WHERE organization_id='o1'");await rejected(()=>call('acl_checklist_catalog',['o1',actor,'r1',false,a.id]),'42501');await db.exec("UPDATE licenses SET document_management=true WHERE organization_id='o1'");
 for(const role of ['anon','authenticated','service_role']){ok(!(await db.query("SELECT has_table_privilege($1,'acl_admission_checklists','INSERT') allowed",[role])).rows[0].allowed);ok(!(await db.query("SELECT has_function_privilege($1,'acl_evidence_command_checklist_internal(text,text,text,boolean,uuid,uuid,integer,text,text,uuid,text[],text,jsonb,text,boolean)','EXECUTE') allowed",[role])).rows[0].allowed);}
 ok((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='acl_admission_checklists'::regclass")).rows[0].relrowsecurity);
 console.log(checks+' ACL checklist SQL checks passed');
}catch(e){console.error({message:e.message,code:e.code,detail:e.detail});process.exitCode=1;}finally{await db.close();}
