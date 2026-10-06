import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aclFixture} from './acl-test-fixture.mjs';
const f=await aclFixture(),{db,actor,peer,client,call,migrate}=f;let checks=0;
const ok=(v)=>{assert.ok(v);checks++;};
const rejected=async(fn,code)=>{await assert.rejects(fn,e=>!code||e.code===code);checks++;};
try{
 await db.exec(`CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text,public boolean,allowed_mime_types text[]);INSERT INTO storage.buckets(id,public) VALUES('energy-documents-private',false);CREATE TABLE users(auth_user_id uuid,name text,organization_id text);CREATE TABLE document_catalog_versions(version text);ALTER TABLE documents ADD COLUMN uploaded_by_auth_user_id uuid;ALTER TABLE documents ADD COLUMN catalog_previous_id text;`);
 await migrate('20261003_f3_1_operations.sql');await migrate('20261003_f3_3_client_evidence.sql');await migrate('20261004_f3_8_client_document_returns.sql');await migrate('20261006_acl_admission_requests.sql');await migrate('20261006_acl_operation_access.sql');
 const perms=[...f.perms,'d1f1b3be-a842-41e7-aeb1-45fefeb2f4c1','1479c0b7-9608-4e95-bd83-7e6899255a78','6da45eb4-810c-4e40-9933-d9cda66a8841','cb949e2a-e01d-4cf0-8c69-6ca74fe4d627'];
 await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms)]);
 const a=await f.create(),rid=randomUUID(),due=new Date(Date.now()+86400000).toISOString();
 const data={stageKey:'technical',subject:'Documentos técnicos da unidade',body:'Envie o CUSD vigente e o diagrama unifilar nesta solicitação.',dueAt:due,responsibleId:actor,priority:'NORMAL',requestType:'DOCUMENT',reason:'Justificativa interna que não será publicada.',checked:true};
 const create=(change={},request=rid,revision=a.revision,who=actor,org='o1',role='r1',id=a.id)=>call('acl_request_create',[org,who,role,false,id,request,revision,{...data,...change}]);
 const counts=async()=> (await db.query('SELECT (SELECT count(*)::integer FROM operation_records) records,(SELECT count(*)::integer FROM operation_client_messages) messages,(SELECT count(*)::integer FROM acl_admission_requests) links')).rows[0];
 await rejected(()=>create({organizationId:'o2'}),'22023');await rejected(()=>create({checked:null}),'22023');await rejected(()=>create({body:null}),'22023');await rejected(()=>create({stageKey:'invalid'}),'22023');await rejected(()=>create({dueAt:'2000-01-01T00:00:00Z'}),'22023');await rejected(()=>create({},rid,999),'40001');
 await rejected(()=>create({},rid,a.revision,actor,'o2','r2'),'42501');await rejected(()=>create({},rid,a.revision,client,'o1','client'),'42501');
 await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms.filter(p=>p!=='6da45eb4-810c-4e40-9933-d9cda66a8841'))]);await rejected(()=>create(),'P2031');ok((await counts()).records===0);
 await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms)]);
 await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms.filter(p=>p!=='1479c0b7-9608-4e95-bd83-7e6899255a78'))]);await rejected(()=>create(),'P2031');await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms)]);
 // Invalid responsible is checked inside save_operation_record; the entire transaction rolls back.
 await rejected(()=>create({responsibleId:'foreign-user'}),'P2031');ok((await counts()).records===0);
 // Simulate a failure after both records are inserted: portal failure must roll back all writes.
 await db.exec(`CREATE FUNCTION test_portal_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.body LIKE 'Atomic rollback%' THEN RAISE EXCEPTION 'Synthetic portal failure' USING ERRCODE='P2032';END IF;RETURN NEW;END$$;CREATE TRIGGER test_portal_failure BEFORE INSERT ON operation_client_messages FOR EACH ROW EXECUTE FUNCTION test_portal_failure();`);
 await rejected(()=>create({body:'Atomic rollback verification request.'},randomUUID()),'P2032');assert.deepEqual(await counts(),{records:0,messages:0,links:0});checks++;
 await db.exec('DROP TRIGGER test_portal_failure ON operation_client_messages;DROP FUNCTION test_portal_failure();');
 const v=await create();ok(v.requestRecordId!==v.agendaRecordId);assert.deepEqual(await counts(),{records:2,messages:1,links:1});checks++;
 assert.deepEqual(await create(),v);checks++;ok((await counts()).records===2);await rejected(()=>create({body:'Uma alteração não pode reutilizar o identificador.'}),'40001');
 await rejected(()=>db.query("UPDATE acl_admissions SET status='COMPLETED',state=jsonb_set(state,'{status}',to_jsonb('COMPLETED'::text)) WHERE id=$1",[a.id]),'P4103');
 const message=(await db.query('SELECT * FROM operation_client_messages WHERE id=$1',[v.messageId])).rows[0];ok(message.body.includes('CUSD'));ok(message.body.includes('(Brasília)'));ok(!message.body.includes('Justificativa interna'));ok(!message.body.includes(a.id));ok(message.customer_id==='c1'&&message.consumer_unit_id==='u1');
 const rows=await call('acl_request_read',['o1',actor,'r1',false,a.id,null]);ok(rows.length===1&&rows[0].responseCount===0);ok(!('request_payload' in rows[0]));
 const req=(await db.query('SELECT * FROM operation_records WHERE id=$1',[v.requestRecordId])).rows[0];
 const ag=(await db.query('SELECT * FROM operation_records WHERE id=$1',[v.agendaRecordId])).rows[0];ok(String(req.due_at)===String(ag.due_at));ok(String(ag.due_at)===String(ag.starts_at));ok(req.description.includes(a.id));
 await rejected(()=>db.query('UPDATE operation_records SET due_at=now() WHERE id=$1',[v.requestRecordId]),'P2032');await rejected(()=>db.query("UPDATE operation_records SET consumer_unit_id='u1b' WHERE id=$1",[v.agendaRecordId]),'P2032');
 await rejected(()=>db.query('UPDATE acl_admission_requests SET stage_key=$1',['registration']),'23514');
 await call('append_operation_client_message',['o1',client,v.requestRecordId,randomUUID(),'INBOUND','Resposta ao pedido','Documentos serão enviados após conferência.',[]]);
 const read=await call('acl_request_read',['o1',actor,'r1',false,a.id,null]);ok(read[0].responseCount===1);ok((await call('acl_read',['o1',actor,'r1',false,a.id,null]))[0].revision===a.revision);
 await call('transition_operation_record',['o1',actor,'requests',v.requestRecordId,randomUUID(),1,'Pedido encerrado pelo Consultor.','DONE']);ok((await call('acl_request_read',['o1',actor,'r1',false,a.id,null]))[0].status==='DONE');
 await rejected(()=>db.query("UPDATE acl_admissions SET status='COMPLETED',state=jsonb_set(state,'{status}',to_jsonb('COMPLETED'::text)) WHERE id=$1",[a.id]),'P4103');
 // Deadline agenda is separate: closing a request never marks the migration complete.
 ok((await call('acl_read',['o1',actor,'r1',false,a.id,null]))[0].status==='DRAFT');
 await db.exec("UPDATE licenses SET document_management=false WHERE organization_id='o1'");await rejected(()=>create(),'42501');await rejected(()=>call('acl_request_read',['o1',actor,'r1',false,a.id,null]),'42501');await db.exec("UPDATE licenses SET document_management=true WHERE organization_id='o1'");
 await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms.filter(p=>p!=='8f105b02-4443-49de-b188-847e0284e7ed'))]);await rejected(()=>create(),'42501');await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms)]);
 for(const role of ['anon','authenticated','service_role']){
  const grants=(await db.query("SELECT has_table_privilege($1,'acl_admission_requests','INSERT') ins,has_function_privilege($1,'acl_request_create(text,text,text,boolean,uuid,uuid,integer,jsonb)','EXECUTE') exec",[role])).rows[0];ok(!grants.ins);ok(grants.exec===(role==='service_role'));
 }
 ok((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='acl_admission_requests'::regclass")).rows[0].relrowsecurity);
 // Generic Operations/Evidence must preserve ACL access, including revoked customer links.
 const visible=()=>call('acl_operation_visible',['o1',actor,[v.requestRecordId,v.agendaRecordId],false]);
 ok((await visible()).length===2);
 await db.exec("INSERT INTO customers VALUES('other-customer','o1','ACTIVE',NULL,'Other customer');");
 await db.query("UPDATE organization_members SET exclusive_customer_id='other-customer' WHERE user_id=$1",[actor]);
 ok((await visible()).length===0);
 await rejected(()=>call('transition_operation_record',['o1',actor,'agenda',v.agendaRecordId,randomUUID(),1,'Conferência de escopo.','DONE']),'42501');
 await rejected(()=>call('append_operation_client_message',['o1',actor,v.agendaRecordId,randomUUID(),'OUTBOUND','Escopo inválido','Mensagem bloqueada pelo vínculo do cliente.',[]]),'42501');
 await db.query("UPDATE organization_members SET exclusive_customer_id=NULL WHERE user_id=$1",[actor]);
 await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms.filter(p=>p!=='820dc44f-15a0-4c2a-871e-2c1d2d443d9e'))]);
 ok((await visible()).length===2);ok((await call('acl_operation_visible',['o1',actor,[v.agendaRecordId],true])).length===0);
 await rejected(()=>call('transition_operation_record',['o1',actor,'agenda',v.agendaRecordId,randomUUID(),1,'Conferência sem permissão.','DONE']),'42501');
 await db.query("UPDATE roles SET permissions=$1 WHERE id='r1'",[JSON.stringify(perms)]);
 await db.exec("UPDATE licenses SET document_management=false WHERE organization_id='o1'");ok((await visible()).length===0);await db.exec("UPDATE licenses SET document_management=true WHERE organization_id='o1'");
 for(const fn of ['save_operation_record_acl_internal(text,text,text,uuid,uuid,integer,text,jsonb)','transition_operation_record_acl_internal(text,text,text,uuid,uuid,integer,text,text)','append_operation_client_message_acl_internal(text,text,uuid,uuid,text,text,text,text[])','acl_operation_allowed(text,text,uuid,boolean)'])ok(!(await db.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') allowed",[fn])).rows[0].allowed);
 ok(!(await db.query("SELECT has_function_privilege('authenticated','acl_operation_visible(text,text,uuid[],boolean)','EXECUTE') allowed")).rows[0].allowed);
 await db.query("UPDATE organization_members SET status='INACTIVE' WHERE user_id=$1",[actor]);await rejected(()=>create(),'42501');
 console.log(checks+' ACL request/agenda/portal SQL checks passed');
}catch(e){console.error({message:e.message,code:e.code,detail:e.detail});process.exitCode=1;}finally{await db.close();}
