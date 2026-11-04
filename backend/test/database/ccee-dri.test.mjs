import {PGlite} from '@electric-sql/pglite';
import {driPostgresAdapter} from './ccee-dri-postgres-adapter.mjs';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const real=process.env.CCEE_DRI_TEST_CONTAINER;
const db=real?driPostgresAdapter(real):new PGlite();let checks=0;
const author=randomUUID(),reviewer=randomUUID(),foreign=randomUUID(),owner=randomUUID(),owner2=randomUUID(),finance=randomUUID(),support=randomUUID();
const perm=['f5364101-4486-42c2-a90f-807937ac3011','f5364101-4486-42c2-a90f-807937ac3012','f5364101-4486-42c2-a90f-807937ac3013','fd8a932f-87c0-4f86-8389-9f30c50e95b7','6da45eb4-810c-4e40-9933-d9cda66a8841','8f105b02-4443-49de-b188-847e0284e7ed'];
const denied=async promise=>{await assert.rejects(promise);checks++;},ok=v=>{assert.ok(v);checks++;};
const query=async(sql,args=[])=>{const r=await db.query(sql,args);return r.rows[0]?.result;};
const action=(actor,act,id=null,body={},org='o1')=>query('SELECT ccee_data_action($1,$2,$3,$4,$5) result',[org,actor,act,id,JSON.stringify(body)]);
const calendar=(actor,act,id=null,body={})=>query('SELECT ccee_calendar_action($1,$2,$3,$4) result',[actor,act,id,JSON.stringify(body)]);
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE permissions(id uuid PRIMARY KEY,code text,name text,module text,resource text,action text);
 CREATE TABLE organizations(id text PRIMARY KEY,deleted_at timestamptz);INSERT INTO organizations VALUES('o1',NULL),('o2',NULL);
 CREATE TABLE customers(id text PRIMARY KEY,organization_id text,deleted_at timestamptz,status text DEFAULT 'ACTIVE');INSERT INTO customers (id,organization_id,deleted_at)VALUES('c1','o1',NULL),('c2','o2',NULL);
 CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text,status text DEFAULT 'ACTIVE');INSERT INTO consumer_units (id,organization_id,customer_id)VALUES('u1','o1','c1'),('u2','o2','c2');
 ALTER TABLE customers ADD company_name text,ADD document text,ADD contact_email text;
 UPDATE customers SET company_name=CASE id WHEN 'c1' THEN 'Cliente primeiro' ELSE 'OUTRA EMPRESA PRIVADA' END,document=CASE id WHEN 'c1' THEN '11111111000111' ELSE '22222222000122' END,contact_email='PRIVATE_CONTACT';
 ALTER TABLE consumer_units ADD name text,ADD consumer_unit_number text,ADD distributor text;
 UPDATE consumer_units SET name=CASE id WHEN 'u1' THEN 'Unidade primeira' ELSE 'OUTRA UNIDADE PRIVADA' END,consumer_unit_number='INSTALACAO',distributor='Distribuidora sintética';
 CREATE TABLE licenses(organization_id text,active boolean,status text,start_date date,end_date date,free_market_management boolean);
 INSERT INTO licenses VALUES('o1',true,'ACTIVE','2020-01-01','2099-12-31',true),('o2',true,'ACTIVE','2020-01-01','2099-12-31',true);
 CREATE TABLE roles(id uuid PRIMARY KEY,organization_id text,scope text,name text,permissions jsonb);
 CREATE TABLE organization_members(organization_id text,user_id uuid,role_id uuid,status text);
 CREATE TABLE platform_organization_sessions(organization_id text,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
 CREATE TABLE platform_team_members(user_id uuid,profile text,active boolean);
 CREATE FUNCTION platform_workflow_actor(a uuid,p text)RETURNS text LANGUAGE plpgsql AS $$DECLARE r text;BEGIN SELECT profile INTO r FROM public.platform_team_members WHERE user_id=a AND active;IF r IS NULL OR r='SUPPORT' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END IF;RETURN r;END$$;
 CREATE FUNCTION assert_license_platform_actor(a uuid)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT 1 FROM public.platform_team_members WHERE user_id=a AND active AND profile='OWNER')THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501';END IF;END$$;
 CREATE FUNCTION acl_preserve_record()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Preserved' USING ERRCODE='42501';END$$;
 CREATE TABLE documents(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,file_verified boolean,original_filename text,reference_month date,document_type text,file_hash text);CREATE TABLE document_ocr_results(document_id text,organization_id text,file_hash text,job_id uuid,raw_result jsonb,evidence jsonb);`);
 for(const[actor,org]of [[author,'o1'],[reviewer,'o1'],[foreign,'o2']]){
  const role=randomUUID();await db.query(`INSERT INTO roles VALUES($1,$2,'organization','gestor',$3)`,[role,org,JSON.stringify(perm)]);await db.query(`INSERT INTO organization_members VALUES($1,$2,$3,'ACTIVE')`,[org,actor,role]);
 }
 for(const[actor,profile]of [[owner,'OWNER'],[owner2,'OWNER'],[finance,'FINANCE'],[support,'SUPPORT']])await db.query('INSERT INTO platform_team_members VALUES($1,$2,true)',[actor,profile]);

 for(const migration of ['20260925_f1_34_monthly_inputs.sql','20260925_f1_48_billed_demand.sql','20261003_f3_1_operations.sql','20261008_ccee_private_intake.sql','20261113_ccee_private_readings.sql','20261114_ccee_binding_review.sql','20261115_ccee_invoice_reconciliation.sql','20261202_ccee_dri_private_readings.sql'])await db.exec(readFileSync(new URL('../../src/database/migrations/'+migration,import.meta.url),'utf8'));
 const dri=(actor,act,id,body={},org='o1')=>query('SELECT ccee_dri_action($1,$2,$3,$4,$5) result',[org,actor,act,id,JSON.stringify(body)]);
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261213_ccee_dri_open_report_period.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261243_ccee_dri_diagnostics.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261256_ccee_dri_disclosures_no_reports.sql',import.meta.url),'utf8'));
 // Existing deployments may have equivalent bodies without indentation.
 await db.exec(`DO $format$ DECLARE d text;BEGIN SELECT pg_get_functiondef('public.ccee_finish_dri_reading(uuid,uuid,jsonb,text)'::regprocedure) INTO d;EXECUTE regexp_replace(d,E'\\n[ ]+',E'\\n','g');END$format$;`);
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261257_ccee_dri_header_diagnostic.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261258_ccee_vca469_participant_column.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261261_ccee_vca470_persistence.sql',import.meta.url),'utf8'));
 const draft=await action(author,'binding',null,{requestId:randomUUID(),customerId:'c1',unitId:'u1',profileCode:'222',principalProfileCode:null,measurementPoint:'P',meterCode:null,representationKind:'PARTIAL',serviceScope:['DRI_READ'],validFrom:'2021-01-01',validTo:'2099-12-31',measurementBasis:'UNKNOWN',evidenceReference:'Evidência sintética revisada',reason:'Teste isolado',driAgentCode:'111',driTaxId:'11111111000111'});
 await denied(action(author,'approve_binding',draft.id,{requestId:randomUUID(),revision:draft.revision,reason:'Não pode aprovar a própria preparação'}));
 const b=await action(reviewer,'approve_binding',draft.id,{requestId:randomUUID(),revision:draft.revision,reason:'Representação DRI conferida'});ok(b.dri_agent_code==='111');ok(b.service_scope.includes('DRI_READ'));
 await denied(dri(foreign,'list',b.id,{month:'2026-09'}));await denied(dri(author,'list',b.id,{month:'2026-09'},'o2'));
 const request={requestId:randomUUID(),authorizationId:b.id,month:'2026-09',kind:'DRI_EVENTS'};
 const first=await dri(author,'enqueue',b.id,request);ok(first.job.kind==='DRI_EVENTS');ok((await dri(author,'enqueue',b.id,request)).job.id===first.job.id);
 await denied(dri(author,'enqueue',b.id,{...request,kind:'DRI_REPORTS'}));
 ok((await query('SELECT ccee_claim_reading(true) result'))===null); // old worker never claims DRI
 const claim=await query('SELECT ccee_claim_dri_reading() result');ok(claim.id===first.job.id);ok(claim.binding.dri_agent_code==='111');
 const finish=async(j,rows)=>query('SELECT ccee_finish_dri_reading($1,$2,$3,NULL) result',[j.id,j.lease_id,JSON.stringify({complete:true,requests:1,bytes:100,durationMs:1,hashes:['a'.repeat(64)],transactions:[],data:{kind:j.kind,month:'2026-09',participantCode:'111',participantTaxId:'11111111000111',eventCode:j.request_payload.eventCode??null,eventKey:j.request_payload.eventKey??null,reportId:j.request_payload.reportId??null,frameId:j.request_payload.frameId??null,sourceHash:'a'.repeat(64),rows}})]);
 await finish(claim,[{code:'202609001000',name:'Evento sintético',month:'2026-09'}]);
 const catalog=await dri(author,'job',first.job.id);ok(catalog.job.state==='SUCCEEDED');ok((await db.query('SELECT count(*) n FROM ccee_dri_catalog_versions')).rows[0].n===1);
 await denied(dri(author,'enqueue',b.id,{...request,requestId:randomUUID(),kind:'DRI_REPORTS',parentJobId:first.job.id,eventCode:'999'}));
 const reports=await dri(author,'enqueue',b.id,{...request,requestId:randomUUID(),kind:'DRI_REPORTS',parentJobId:first.job.id,eventCode:'202609001000'});
 const rclaim=await query('SELECT ccee_claim_dri_reading() result');await finish(rclaim,[['8','2021-01-01','2099-12-31'],['9','2021-01-01',null],['10','2021-01-01','2026-08-31'],['11','2026-10-01',null],['12','2021-01-01',undefined],['119','2021-01-01',null]].map(([id,start,end])=>({id,name:'Relatório',period:{start,end},frames:(id==='119'?['469','470']:['31']).map(id=>({id,parameters:['CODIGO_AGENTE','CODIGO_EVENTO_CONTABIL']}))})));
 const results=await dri(author,'enqueue',b.id,{...request,requestId:randomUUID(),kind:'DRI_RESULTS',parentJobId:reports.job.id,eventCode:'202609001000',reportId:'8',frameId:'31'});
 await denied(dri(author,'enqueue',b.id,{...request,requestId:randomUUID(),kind:'DRI_RESULTS',parentJobId:reports.job.id,eventCode:'202609001000',reportId:'8',frameId:'99'}));
 const sclaim=await query('SELECT ccee_claim_dri_reading() result');ok(sclaim.dri_parameters.includes('CODIGO_AGENTE'));
 await denied(finish(sclaim,[{columns:['CNPJ DO AGENTE','TOTAL'],cells:['22222222000122','99'],reportId:'8',frameId:'31'}]));
 await denied(finish(sclaim,[{columns:['CNPJ AGENTE','TOTAL'],cells:['11111111000111','99'],reportId:'8',frameId:'31'}]));
 await finish(sclaim,[{columns:['CNPJ DO AGENTE','TOTAL'],cells:['11111111000111','-99.00'],reportId:'8',frameId:'31',financialState:'UNMAPPED_REVIEW_REQUIRED'}]);
 const open=await dri(author,'enqueue',b.id,{...request,requestId:randomUUID(),kind:'DRI_RESULTS',parentJobId:reports.job.id,eventCode:'202609001000',reportId:'9',frameId:'31'});ok(open.job.kind==='DRI_RESULTS');
 for(const reportId of ['10','11','12'])await denied(dri(author,'enqueue',b.id,{...request,requestId:randomUUID(),kind:'DRI_RESULTS',parentJobId:reports.job.id,eventCode:'202609001000',reportId,frameId:'31'}));
 // Finish the open-period fixture before the independent concurrency lab.
 const openClaim=await query('SELECT ccee_claim_dri_reading() result');ok(openClaim.id===open.job.id);
 await query("SELECT ccee_finish_dri_reading($1,$2,NULL,'TEST_STOP') result",[openClaim.id,openClaim.lease_id]);
 ok((await db.query('SELECT count(*) n FROM ccee_dri_result_snapshots')).rows[0].n===1);
 await denied(db.exec("UPDATE ccee_dri_result_snapshots SET financial_state='OTHER'"));
 for(const table of ['ccee_dri_catalog_versions','ccee_dri_result_snapshots']){
  ok((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass",[table])).rows[0].relrowsecurity);
  ok(!(await db.query("SELECT has_table_privilege('authenticated',$1,'SELECT') allowed",[table])).rows[0].allowed);
  ok(!(await db.query("SELECT has_table_privilege('service_role',$1,'SELECT') allowed",[table])).rows[0].allowed);
 }
 // Bounded append-only diagnostics reuse the existing lease and tenant checks.
 const dj=await dri(author,'enqueue',b.id,{...request,requestId:randomUUID()});const dc=await query('SELECT ccee_claim_dri_reading() result');ok(dc.id===dj.job.id);
 const diagnostic={version:1,stage:'EVENT_IDENTITY',eventCode:'202609001000',sourceHashes:['a'.repeat(64),'b'.repeat(64)],changedPaths:['dataDivulgacao'],truncated:false};
 const metric={requests:1,bytes:250,durationMs:1,httpStatus:200,hashes:['a'.repeat(64)],transactions:[],diagnostic};
 const stop=(value,error='DRI_EVENT_IDENTITY_CONFLICT',lease=dc.lease_id)=>query('SELECT ccee_finish_dri_reading($1,$2,$3,$4) result',[dc.id,lease,JSON.stringify(value),error]);
 for(const bad of [{...diagnostic,rawXml:'PRIVATE_PASSWORD'},{...diagnostic,changedPaths:['password']},{...diagnostic,changedPaths:Array(17).fill('field')},{...diagnostic,sourceHashes:['not-a-hash','b'.repeat(64)]}])await denied(stop({...metric,diagnostic:bad}));
 await denied(stop(metric,'OTHER_ERROR'));await denied(stop(metric,'DRI_EVENT_IDENTITY_CONFLICT',randomUUID()));
 await stop(metric);const readDiag=(actor,id=dc.id,latest=false,org='o1')=>query('SELECT ccee_dri_diagnostic_read($1,$2,$3,$4) result',[org,actor,id,latest]);
 const rd=await readDiag(author);ok(rd.job.state==='FAILED');ok(rd.provenance.httpStatus===200);ok(rd.diagnostic.changedPaths[0]==='dataDivulgacao');ok(rd.diagnostic.sourceHashes.length===2);ok((await readDiag(author,b.id,true)).job.id===dc.id);
 await denied(readDiag(foreign));await denied(readDiag(author,dc.id,false,'o2'));ok((await readDiag(foreign,dc.id,false,'o2')).job===null);
 ok((await db.query('SELECT result FROM ccee_integration_jobs WHERE id=$1',[dc.id])).rows[0].result===null);ok((await db.query('SELECT count(*) n FROM ccee_dri_result_snapshots')).rows[0].n===1);
 ok(!(await db.query("SELECT has_function_privilege('authenticated','ccee_dri_diagnostic_read(text,text,uuid,boolean)','EXECUTE') allowed")).rows[0].allowed);
 ok(!(await db.query("SELECT has_function_privilege('service_role','ccee_finish_dri_reading_before_diagnostic(uuid,uuid,jsonb,text)','EXECUTE') allowed")).rows[0].allowed);
 // Distinct names under one code require an explicit disclosure selection, server-side.
 const ej=await dri(author,'enqueue',b.id,{...request,requestId:randomUUID()});const ec=await query('SELECT ccee_claim_dri_reading() result');ok(ec.id===ej.job.id);
 const variants=['c'.repeat(64),'d'.repeat(64)];await finish(ec,variants.map((eventKey,i)=>({code:'202609040036',name:i?'2026_08 - MS+01 PRÉVIA DE MEDIÇÃO':'2026_09 - MS+01 PRÉVIA DE MEDIÇÃO',month:'2026-09',eventKey})));
 const reportSelection={...request,requestId:randomUUID(),kind:'DRI_REPORTS',parentJobId:ej.job.id,eventCode:'202609040036'};
 await denied(dri(author,'enqueue',b.id,reportSelection));await denied(dri(author,'enqueue',b.id,{...reportSelection,eventKey:'f'.repeat(64)}));await denied(dri(foreign,'enqueue',b.id,{...reportSelection,eventKey:variants[0]}));
 const exact=await dri(author,'enqueue',b.id,{...reportSelection,eventKey:variants[0]});ok(exact.job.request_payload.eventKey===variants[0]);ok((await dri(author,'enqueue',b.id,{...reportSelection,eventKey:variants[0]})).job.id===exact.job.id);
 await denied(dri(author,'enqueue',b.id,{...reportSelection,eventKey:variants[1]}));
 const exactClaim=await query('SELECT ccee_claim_dri_reading() result');ok(exactClaim.id===exact.job.id);
 const emptyCatalog={complete:true,requests:1,bytes:627,durationMs:1,hashes:['e'.repeat(64)],transactions:[],data:{kind:'DRI_REPORTS',month:'2026-09',participantCode:'111',participantTaxId:'11111111000111',eventCode:'202609040036',eventKey:variants[0],reportId:null,frameId:null,sourceHash:'e'.repeat(64),rows:[],availability:'NO_REPORTS',providerHttpStatus:500,providerFaultCode:'Server.3001'}};
 const completeExact=value=>query('SELECT ccee_finish_dri_reading($1,$2,$3,NULL) result',[exactClaim.id,exactClaim.lease_id,JSON.stringify(value)]);
 await denied(completeExact({...emptyCatalog,data:{...emptyCatalog.data,eventKey:variants[1]}}));await denied(completeExact({...emptyCatalog,data:{...emptyCatalog.data,providerHttpStatus:200}}));await completeExact(emptyCatalog);
 const noReports=await readDiag(author,exactClaim.id);ok(noReports.job.availability==='NO_REPORTS');ok(noReports.job.providerHttpStatus===500);ok(noReports.job.providerFaultCode==='Server.3001');ok((await db.query('SELECT count(*) n FROM ccee_dri_result_snapshots')).rows[0].n===1);
 await denied(dri(author,'enqueue',b.id,{...request,requestId:randomUUID(),kind:'DRI_RESULTS',parentJobId:exact.job.id,eventCode:'202609040036',eventKey:variants[0],reportId:'8',frameId:'31'}));
 // Header diagnostics cannot store cells, change scope, bypass leases, or become results.
 const hj=await dri(author,'enqueue',b.id,{...request,requestId:randomUUID(),kind:'DRI_RESULTS',parentJobId:reports.job.id,eventCode:'202609001000',reportId:'8',frameId:'31'});
 const hc=await query('SELECT ccee_claim_dri_reading() result');ok(hc.id===hj.job.id);
 const hd={version:1,stage:'RESULT_HEADERS',eventCode:'202609001000',reportId:'8',frameId:'31',sourceHashes:['a'.repeat(64)],headers:['CODIGO DO AGENTE','VALOR (R$)'],truncated:false};
 const hm={requests:1,bytes:500,durationMs:1,httpStatus:200,hashes:['a'.repeat(64)],transactions:[],diagnostic:hd};
 const headerStop=(value,error='DRI_PARTICIPANT_PROOF_REQUIRED',lease=hc.lease_id)=>query('SELECT ccee_finish_dri_reading($1,$2,$3,$4) result',[hc.id,lease,JSON.stringify(value),error]);
 for(const bad of [{...hd,cells:['PRIVATE']},{...hd,headers:['password']},{...hd,headers:['person@example.com']},{...hd,headers:Array(25).fill('X')},{...hd,headers:['11264299999999']},{...hd,reportId:'99'},{...hd,sourceHashes:['b'.repeat(64)]}])await denied(headerStop({...hm,diagnostic:bad}));
 await denied(headerStop(hm,'OTHER'));await denied(headerStop(hm,'DRI_PARTICIPANT_PROOF_REQUIRED',randomUUID()));
 await headerStop(hm);const hr=await readDiag(author,hc.id);ok(hr.job.state==='FAILED');ok(hr.diagnostic.headers[0]==='CODIGO DO AGENTE');await denied(readDiag(foreign,hc.id));ok((await db.query('SELECT count(*) n FROM ccee_dri_result_snapshots')).rows[0].n===1);
 const vj=await dri(author,'enqueue',b.id,{...request,requestId:randomUUID(),kind:'DRI_RESULTS',parentJobId:reports.job.id,eventCode:'202609001000',reportId:'119',frameId:'469'});const vc=await query('SELECT ccee_claim_dri_reading() result');ok(vc.id===vj.job.id);
 const vr=(columns=['CNPJ AGENTE','VOTOS'],cells=['11111111000111','12'])=>[{columns,cells,reportId:'119',frameId:'469',financialState:'UNMAPPED_REVIEW_REQUIRED'}];
 for(const cells of [['22222222000122','12'],['x11111111000111','12']])await denied(finish(vc,vr(undefined,cells)));
 await denied(finish(vc,vr(['CNPJ AGENTE','CNPJ DO AGENTE'],['11111111000111','11111111000111'])));await denied(finish(vc,vr(['CNPJ AGENTE','CNPJ AGENTE'],['11111111000111','11111111000111'])));await finish(vc,vr());await denied(dri(foreign,'job',vj.job.id));ok((await db.query('SELECT count(*) n FROM ccee_dri_result_snapshots')).rows[0].n===2);
 const v470=await dri(author,'enqueue',b.id,{...request,requestId:randomUUID(),kind:'DRI_RESULTS',parentJobId:reports.job.id,eventCode:'202609001000',reportId:'119',frameId:'470'}),claim470=await query('SELECT ccee_claim_dri_reading() result');ok(claim470.id===v470.job.id);
 const rows470=(columns=['CNPJ AGENTE','CONTRIBUICAO MENSAL (R$)'],cells=['11111111000111','681.27000000'])=>[{columns,cells,reportId:'119',frameId:'470',financialState:'UNMAPPED_REVIEW_REQUIRED'}];
 await denied(finish(claim470,rows470(undefined,['22222222000122','681.27'])));await denied(finish(claim470,rows470(['CNPJ AGENTE','CNPJ DO AGENTE'],['11111111000111','11111111000111'])));
 await finish(claim470,rows470());const stored470=await dri(author,'job',v470.job.id);ok(stored470.job.state==='SUCCEEDED');ok(stored470.job.result.data.rows[0].cells[1]==='681.27000000');await denied(dri(foreign,'job',v470.job.id));
 // Migration is idempotent and preserves the existing private grants.
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261258_ccee_vca469_participant_column.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261261_ccee_vca470_persistence.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261257_ccee_dri_header_diagnostic.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../../src/database/migrations/20261256_ccee_dri_disclosures_no_reports.sql',import.meta.url),'utf8'));
 ok(!(await db.query("SELECT has_function_privilege('authenticated','ccee_dri_action(text,text,text,uuid,jsonb)','EXECUTE') allowed")).rows[0].allowed);
 if(real){
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  // Force two independently connected enqueue requests to wait for the same organization cap lock.
  const holder=db.exec("BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('o1',194));SELECT pg_sleep(4);COMMIT;");
  for(let i=0;i<100;i++){if((await db.query("SELECT count(*) n FROM pg_locks WHERE locktype='advisory' AND granted")).rows[0].n>0)break;if(i===99)throw Error('Lock holder unavailable');await delay(10);}
  const pending=[1,2].map(()=>dri(author,'enqueue',b.id,{...request,requestId:randomUUID()}));
  let waiting=0;for(let i=0;i<100;i++){waiting=(await db.query("SELECT count(*) n FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].n;if(waiting>=2)break;await delay(10);}ok(waiting>=2);await holder;
  const created=await Promise.all(pending);ok(created[0].job.id===created[1].job.id);
  const claimed=await Promise.all([query('SELECT ccee_claim_dri_reading() result'),query('SELECT ccee_claim_dri_reading() result')]);ok(claimed.filter(Boolean).length===1);
 }
 await action(author,'binding',null,{requestId:randomUUID(),customerId:'c1',unitId:'u1',profileCode:'222',principalProfileCode:null,measurementPoint:'P',representationKind:'PARTIAL',serviceScope:['AGENDA'],validFrom:'2021-01-01',validTo:'2099-12-31',measurementBasis:'UNKNOWN',evidenceReference:'Nova revisão substitui DRI',reason:'Alteração de escopo'});
 await denied(dri(author,'job',results.job.id));
 console.log('PASS CCEE DRI '+(real?'PostgreSQL concurrency':'PGlite')+': '+checks+' assertions; isolated scope, independent review, catalogs, queue, snapshots, revocation and RLS');
}finally{await db.close();}
