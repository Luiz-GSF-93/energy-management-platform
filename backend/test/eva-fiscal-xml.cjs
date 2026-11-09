const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();let checks=0;const ok=v=>{assert(v);checks++},deny=async f=>{await assert.rejects(f);checks++};try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE organizations(id text PRIMARY KEY);INSERT INTO organizations VALUES('org'),('other');
CREATE TABLE customers(id text PRIMARY KEY,organization_id text,document text,company_name text,status text,deleted_at timestamptz);
INSERT INTO customers VALUES('client','org','12345678000190','Client','ACTIVE',NULL),('foreign','other','98765432000100','Other','ACTIVE',NULL);
CREATE TABLE consumer_units(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_number text,address text,status text);
INSERT INTO consumer_units VALUES('${id(1)}','org','client','1234567','Rua Exemplo 123','ACTIVE');
CREATE TABLE roles(id text PRIMARY KEY,organization_id text,scope text,name text,permissions jsonb);
INSERT INTO roles VALUES('manager','org','organization','gestor','["8f105b02-4443-49de-b188-847e0284e7ed","8f3ff5eb-157a-468a-91af-6f89d92e23a7","92e1b670-ab10-483a-b825-c6e16799496d","60f9690a-145b-4dba-b23f-9f945baca296","beb6ec90-8ba8-40ce-a156-aeef6cc75cce"]'),('external','org','organization','consulta','[]');
CREATE TABLE organization_members(organization_id text,user_id text,role_id text,status text,affiliation_type text,exclusive_customer_id text);
INSERT INTO organization_members VALUES('org','${id(71)}','manager','ACTIVE','internal',NULL),('org','${id(70)}','external','ACTIVE','external','client');
CREATE TABLE licenses(id text PRIMARY KEY,organization_id text,active boolean,status text,start_date date,end_date date,document_management boolean,documents_unlimited boolean,documents_limit int,plan_id text);
INSERT INTO licenses VALUES('license','org',true,'active','2020-01-01','2099-01-01',true,false,10,'plan');
CREATE TABLE portal_service_routing(id uuid,organization_id text,kind text,owner_user_id text,revision int,body jsonb);
INSERT INTO portal_service_routing VALUES('${id(90)}','org','ROUTING','organization',1,'{"enabled":true,"automationEnabled":true,"automationActor":"${id(71)}"}');
CREATE TABLE documents(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text,document_type text,reference_month date,original_filename text,mime_type text,file_hash text,file_size_bytes int,file_path text,storage_bucket text,file_verified boolean,file_verified_at timestamptz,uploaded_by_auth_user_id uuid,license_check_passed boolean,processing_status text,ocr_status text,description text);
CREATE TABLE document_ocr_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text,document_id text,file_hash text,requested_by text,state text,operation_url text,UNIQUE(organization_id,document_id));
CREATE TABLE document_ocr_results(job_id uuid PRIMARY KEY,organization_id text,document_id text,file_hash text,raw_result jsonb,evidence jsonb);
CREATE TABLE eva_assisted_closing_versions(id uuid PRIMARY KEY,organization_id text,customer_id text,month text,report jsonb);
CREATE TABLE eva_assisted_closing_events(closing_id uuid,state text,sequence int DEFAULT 1);
CREATE FUNCTION preserve_operation_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$BEGIN RAISE EXCEPTION 'Immutable';END$$;
CREATE FUNCTION organization_resource_usage(text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('documents',(SELECT count(*) FROM public.documents WHERE organization_id=$1),'users',1,'units',1)$$;
CREATE FUNCTION portal_workspace_actor(o text,a text,r text,p boolean,m text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$DECLARE x organization_members;BEGIN SELECT * INTO x FROM organization_members WHERE organization_id=o AND user_id=a AND role_id=r AND status='ACTIVE' FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Denied';END IF;RETURN jsonb_build_object('external',x.affiliation_type='external','customerId',x.exclusive_customer_id);END$$;
CREATE FUNCTION assert_invoice_month_ocr(text,text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$BEGIN RETURN;END$$;
CREATE FUNCTION ocr_identity_unit_lineage(o text,c text,u text,n text) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('codes',jsonb_build_array(n),'editIds','[]'::jsonb)$$;
CREATE FUNCTION quota_check() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$DECLARE n int;BEGIN n:=(organization_resource_usage(NEW.organization_id)->>'documents')::int;IF n>=(SELECT documents_limit FROM licenses WHERE organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'quota';END IF;RETURN NEW;END$$;
CREATE TRIGGER quota_check BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION quota_check();
`);
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261222_eva_automatic_intake.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261223_eva_intake_pending_queue.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261224_eva_intake_status.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261225_eva_intake_unit_aliases.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261226_eva_archived_intake_tracking.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261227_eva_intake_alias_evidence.sql','utf8'));

await db.exec(`
CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text,public boolean,allowed_mime_types text[]);INSERT INTO storage.buckets VALUES('energy-documents-private',false,ARRAY['application/pdf']);
ALTER TABLE documents ADD COLUMN updated_at timestamptz;
ALTER TABLE document_ocr_results ADD COLUMN provider text;ALTER TABLE document_ocr_results ADD COLUMN extraction_version text;
ALTER TABLE eva_assisted_closing_events ADD COLUMN organization_id text;
ALTER TABLE eva_assisted_closing_versions ADD COLUMN payload_hash text;
CREATE TABLE eva_closing_publication_events(organization_id text,publication_id uuid,sequence int);
CREATE TABLE eva_intake_identity_reviews(intake_id uuid,organization_id text,source_hash text,kind text);
CREATE FUNCTION portal_intake_work_context_scoped(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT public.eva_intake_work_context($1,$2)$$;
CREATE FUNCTION portal_intake_scoped_rpc(text,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF $1='eva_intake_reference_signature' THEN RETURN to_jsonb(public.eva_intake_reference_signature(($2->>'p_id')::uuid,($2->>'p_token')::uuid));END IF;RAISE EXCEPTION 'denied';END$$;
CREATE TABLE contract_price_history(id text,contract_id text);
CREATE TABLE monthly_energy_settlements(id text,organization_id text,customer_id text,consumer_unit_id text,month date,version_number int,financial_hash text,status text,validation_status text,approved_at timestamptz,published_at timestamptz);
`);
for(const table of ['energy_contracts','calculation_parameters','calculation_monthly_inputs','calculation_monthly_costs','supplier_billing_rules','supplier_spot_reconciliations','calculation_cost_absences','management_contracts','management_fee_allocations','commercial_fee_adjustments','unit_demand_periods','unit_demand_approvals','tariff_library_versions'])await db.exec(`CREATE TABLE ${table}(id text PRIMARY KEY,organization_id text,customer_id text,consumer_unit_id text)`);
for(const migration of ['20261286_eva_intake_recovery_performance.sql','20261287_eva_background_explanations.sql','20261288_eva_fiscal_xml.sql'])await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/'+migration,'utf8'));
const actor=id(71),unit=id(1),receipt=id(10),hash='a'.repeat(64);
const scalar=async(sql,args=[])=> (await db.query(sql,args)).rows[0].v;
const action=(a,b)=>scalar('SELECT eva_intake_action($1,$2,$3,false,$4,$5,$6) v',['org',actor,'manager',a,receipt,JSON.stringify(b)]);
await action('reserve',{requestId:id(100),customerId:'client',hash,filename:'source.xml',mime:'application/xml',size:500,consent:true,hints:{unitId:unit,month:'2026-07'}});
await action('stored',{hash});
const job=await scalar("SELECT claim_eva_automatic_intake(ARRAY['org']) v");
const rpc=(name,...rest)=>scalar(`SELECT ${name}($1,$2${rest.length?',$3':''}) v`,[job.id,job.token,...rest]);
const raw={xml:{version:'fiscal-xml-1',sourceHash:hash},contentUnit:'XML_FIELDS',content:'Synthetic XML fields',pages:[{pageNumber:1}],documents:[]};
await rpc('eva_intake_xml_source',JSON.stringify(raw));await rpc('eva_intake_xml_source',JSON.stringify(raw));
await deny(()=>scalar('SELECT eva_intake_xml_source($1,$2,$3) v',[receipt,id(99),JSON.stringify(raw)]));
await deny(()=>rpc('eva_intake_xml_source',JSON.stringify({...raw,xml:{...raw.xml,sourceHash:'b'.repeat(64)}})));
const trans=(a,b={})=>scalar('SELECT transition_eva_automatic_intake($1,$2,$3,$4) v',[job.id,job.token,a,JSON.stringify(b)]);
await trans('recognized',{proof:{version:'automatic-intake-context-1',state:'MATCH',fileHash:hash,customerId:'client',unitId:unit,month:'2026-07',documentType:'INVOICE_DISTRIBUTOR'}});
await trans('linked',{path:'org/'+unit+'/eva-intake-'+receipt+'.xml'});
await db.query("UPDATE eva_automatic_intakes SET next_attempt_at=now() WHERE id=$1",[receipt]);
let current=await scalar("SELECT claim_eva_automatic_intake(ARRAY['org']) v");job.token=current.token;
ok((await db.query('SELECT * FROM document_ocr_jobs')).rows.length===0);
const assessment={version:'intake-assessment-v1',source:{organizationId:'org',documentId:receipt,fileHash:hash,customerId:'client',unitId:unit,referenceMonth:'2026-07'},intake:{decision:'REVIEW_REQUIRED'}};
await rpc('eva_intake_xml_complete',JSON.stringify(assessment));await rpc('eva_intake_xml_complete',JSON.stringify(assessment));
ok((await db.query("SELECT * FROM document_ocr_jobs WHERE state='SUCCEEDED' AND source_kind='XML' AND operation_url IS NULL")).rows.length===1);
ok((await db.query("SELECT * FROM document_ocr_results WHERE provider='DETERMINISTIC_XML'")).rows.length===1);
await deny(()=>rpc('eva_intake_xml_complete',JSON.stringify({...assessment,source:{...assessment.source,organizationId:'other'}})));
// Reproduce PostgREST's transaction choice from function volatility. Actor
// authorization retains its FOR SHARE lock; a STABLE entry point fails here.
await db.exec('BEGIN READ ONLY');
let readonlyCode;try{await rpc('eva_intake_source_fingerprint')}catch(e){readonlyCode=e.code}finally{await db.exec('ROLLBACK')}
ok(readonlyCode==='25006');
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261291_eva_source_rpc_transaction_mode.sql','utf8'));
for(const name of ['eva_intake_source_fingerprint','eva_intake_alias_catalog']){
 const mode=await scalar("SELECT provolatile v FROM pg_proc WHERE oid=($1||'(uuid,uuid)')::regprocedure",[name]);ok(mode==='v');
 await db.exec(mode==='v'?'BEGIN READ WRITE':'BEGIN READ ONLY');
 try{const result=await rpc(name);ok(name==='eva_intake_source_fingerprint'?/^[a-f0-9]{64}$/.test(result):result[unit].includes('1234567'));}finally{await db.exec('ROLLBACK')}
}
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261291_eva_source_rpc_transaction_mode.sql','utf8'));
const fingerprint=await rpc('eva_intake_source_fingerprint');ok(/^[a-f0-9]{64}$/.test(fingerprint));
await db.exec("INSERT INTO calculation_monthly_costs VALUES('new','org','client','"+unit+"')");ok(await rpc('eva_intake_source_fingerprint')!==fingerprint);
ok((await rpc('eva_intake_alias_catalog'))[unit].includes('1234567'));
await db.exec("UPDATE organization_members SET status='INACTIVE' WHERE user_id='"+actor+"'");await deny(()=>rpc('eva_intake_source_fingerprint'));await deny(()=>rpc('eva_intake_xml_complete',JSON.stringify(assessment)));

await db.exec("UPDATE organization_members SET status='ACTIVE' WHERE user_id='"+actor+"'");
const closing=id(50);
await db.query("INSERT INTO eva_assisted_closing_versions(id,organization_id,customer_id,month,report) VALUES($1,'org','client','2026-07',$2)",[closing,JSON.stringify({units:[{id:unit,documentId:receipt,sourceHash:hash}]})]);
await db.query("UPDATE eva_automatic_intakes SET state='AWAITING_SOURCES',closing_id=$2 WHERE id=$1",[receipt,closing]);
await db.query("SELECT eva_intake_event($1,'prepared')",[receipt]);await db.query("SELECT eva_intake_event($1,'prepared')",[receipt]);
ok((await db.query('SELECT * FROM eva_intake_explanations')).rows.length===1);
const explain=(a,id=null,lease=null)=>scalar('SELECT eva_intake_explanation_task($1,$2,$3,ARRAY[\'org\']) v',[a,id,lease]);
const task=await explain('claim');ok(task.context.organizationId==='org');ok(await explain('claim')===null);
await deny(()=>explain('assert',task.id,id(99)));
await db.exec("UPDATE portal_service_routing SET body=body||'{\"automationEnabled\":false}'::jsonb");await deny(()=>explain('assert',task.id,task.leaseId));
await db.exec("UPDATE portal_service_routing SET body=body||'{\"automationEnabled\":true}'::jsonb");
await explain('finish',task.id,task.leaseId);ok(await explain('claim')===null);
ok((await db.query("SELECT * FROM eva_assisted_closing_events WHERE state='APPROVED'")).rows.length===0);
for(const role of ['anon','authenticated'])for(const name of ['eva_intake_xml_source(uuid,uuid,jsonb)','eva_intake_xml_complete(uuid,uuid,jsonb)','eva_intake_source_fingerprint(uuid,uuid)'])ok(!await scalar('SELECT has_function_privilege($1,$2,\'EXECUTE\') v',[role,name]));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261289_eva_non_retryable_conflicts.sql','utf8'));
// Emulate an HTTP runner: only a real 40001 would trigger another transaction.
let retries=0,errorCode;
for(let attempt=0;attempt<5;attempt++)try{retries++;await action('reserve',{requestId:id(100),customerId:'client',hash,filename:'source.xml',mime:'application/xml',size:500,consent:true,hints:{unitId:unit,month:'2026-08'}});break;}catch(e){errorCode=e.code;if(e.code!=='40001')break;}
ok(errorCode==='PT409');ok(retries===1);ok((await db.query('SELECT count(*) n FROM eva_automatic_intakes')).rows[0].n===1);
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261289_eva_non_retryable_conflicts.sql','utf8'));
// Global discovery and operational projection use the same licensed tenant gates.
await db.exec("ALTER TABLE consumer_units ADD COLUMN name text;ALTER TABLE eva_intake_identity_reviews ADD COLUMN created_at timestamptz DEFAULT now();");
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261292_eva_operations_global_rollout.sql','utf8'));
const dashboard=(o='org',a=actor,r='manager',group='ALL',offset=0)=>scalar('SELECT eva_intake_operational_dashboard($1,$2,$3,false,$4,$5) v',[o,a,r,group,offset]);
let operational=await dashboard();ok(operational.total===1);ok(operational.rows[0].group==='SOURCES');ok(operational.summary.sources===1);
ok(!('raw_result' in operational.rows[0]));ok(!('fileHash' in operational.rows[0]));
await deny(()=>dashboard('other'));await deny(()=>dashboard('org',id(70),'external'));await deny(()=>dashboard('org',actor,'manager','INVALID'));await deny(()=>dashboard('org',actor,'manager','ALL',1));
await db.exec("UPDATE eva_automatic_intakes SET next_attempt_at=now(),lease_until=NULL,lease_token=NULL WHERE id='"+receipt+"'");
ok((await scalar("SELECT eva_intake_worker_organizations('INTAKE') v")).includes('org'));
await db.exec("UPDATE licenses SET document_management=false WHERE organization_id='org'");await deny(()=>dashboard());ok(!(await scalar("SELECT eva_intake_worker_organizations('INTAKE') v")).includes('org'));
await db.exec("UPDATE licenses SET document_management=true WHERE organization_id='org'");
await db.exec("UPDATE portal_service_routing SET body=body||'{\"automationEnabled\":false}'::jsonb WHERE organization_id='org'");ok(!(await scalar("SELECT eva_intake_worker_organizations('INTAKE') v")).includes('org'));ok(!(await dashboard()).automationConfigured);
await db.exec("UPDATE portal_service_routing SET body=body||'{\"automationEnabled\":true}'::jsonb WHERE organization_id='org'");
// A tenant inserted after the migration inherits the processor without a code/env edit.
await db.exec("INSERT INTO organizations VALUES('future');INSERT INTO licenses SELECT 'future-license','future',active,status,start_date,end_date,document_management,documents_unlimited,documents_limit,plan_id FROM licenses WHERE organization_id='org';INSERT INTO portal_service_routing SELECT '"+id(88)+"','future',kind,owner_user_id,revision,body FROM portal_service_routing WHERE organization_id='org';");
await db.exec("INSERT INTO eva_automatic_intakes(id,organization_id,actor_id,role_id,platform,external,request_id,file_hash,filename,mime,size_bytes,consent,stored,state,next_attempt_at) VALUES('"+id(86)+"','future','"+actor+"','manager',false,false,'"+id(85)+"','"+'b'.repeat(64)+"','future.pdf','application/pdf',100,true,true,'OCR_QUEUED',now()-interval '1 hour')");
await db.exec("INSERT INTO roles SELECT 'future-manager','future',scope,name,permissions FROM roles WHERE id='manager';INSERT INTO organization_members VALUES('future','"+actor+"','future-manager','ACTIVE','internal',NULL);UPDATE eva_automatic_intakes SET role_id='future-manager' WHERE organization_id='future';");
const discovered=await scalar("SELECT eva_intake_worker_organizations('INTAKE') v");ok(discovered[0]==='future');ok(discovered.includes('org'));
const futureClaim=await scalar("SELECT claim_eva_automatic_intake(ARRAY['future']) v");ok(futureClaim.context.intake.organization_id==='future');
operational=await dashboard();ok(operational.total===1);ok(!JSON.stringify(operational).includes('future.pdf'));
await db.query("UPDATE eva_automatic_intakes SET state='UNKNOWN' WHERE id=$1",[receipt]);ok((await dashboard()).summary.technical===1);ok((await dashboard('org',actor,'manager','HUMAN')).rows.length===0);
await db.query("UPDATE eva_automatic_intakes SET state='REVIEW_REQUIRED' WHERE id=$1",[receipt]);ok((await dashboard()).summary.human===1);
for(const role of ['anon','authenticated'])for(const name of ['eva_intake_worker_organizations(text)','eva_intake_operational_dashboard(text,text,text,boolean,text,integer)'])ok(!await scalar('SELECT has_function_privilege($1,$2,\'EXECUTE\') v',[role,name]));
await deny(()=>scalar("SELECT eva_intake_worker_organizations('INVALID') v"));
// A receipt error cannot mask an exact approved publication. Use the real proof function.
await db.exec(`ALTER TABLE eva_assisted_closing_versions ADD COLUMN version int DEFAULT 1;
ALTER TABLE eva_assisted_closing_events ADD COLUMN id uuid DEFAULT gen_random_uuid();
CREATE TABLE eva_closing_publications(id uuid,organization_id text,customer_id text,closing_id uuid,source_hash text,approval_event_id uuid,created_at timestamptz DEFAULT now());
ALTER TABLE eva_closing_publication_events ADD COLUMN state text;`);
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261239_eva_intake_completion_projection.sql','utf8'));
await db.exec(fs.readFileSync(__dirname+'/../src/database/migrations/20261293_eva_operations_publication_proof.sql','utf8'));
const approval=id(83),publication=id(82),publishedHash='c'.repeat(64);
await db.query("UPDATE eva_automatic_intakes SET state='UNKNOWN',lease_token=NULL,lease_until=NULL WHERE id=$1",[receipt]);
await db.query('UPDATE eva_assisted_closing_versions SET payload_hash=$2 WHERE id=$1',[closing,publishedHash]);
await db.query("INSERT INTO eva_assisted_closing_events(closing_id,state,sequence,organization_id,id) VALUES($1,'APPROVED',99,'org',$2)",[closing,approval]);
await db.query("INSERT INTO eva_closing_publications(id,organization_id,customer_id,closing_id,source_hash,approval_event_id) VALUES($1,'org','client',$2,$3,$4)",[publication,closing,publishedHash,approval]);
await db.query("INSERT INTO eva_closing_publication_events VALUES('org',$1,1,'PUBLISHED')",[publication]);
let confirmed=await dashboard();ok(confirmed.summary.technical===0);ok(confirmed.rows[0].state==='PUBLISHED');ok(confirmed.rows[0].group==='DONE');
ok((await db.query('SELECT state FROM eva_automatic_intakes WHERE id=$1',[receipt])).rows[0].state==='UNKNOWN');
await db.query("INSERT INTO eva_closing_publication_events VALUES('org',$1,2,'WITHDRAWN')",[publication]);ok((await dashboard()).summary.technical===1);
await db.query("UPDATE eva_closing_publication_events SET state='PUBLISHED' WHERE sequence=2");
await db.query('UPDATE documents SET file_hash=$2 WHERE id=$1',[receipt,'d'.repeat(64)]);ok((await dashboard()).summary.technical===1);
await db.query('UPDATE documents SET file_hash=$2 WHERE id=$1',[receipt,hash]);ok((await dashboard()).summary.technical===0);
console.log('XML intake and fingerprint SQL:',checks,'checks passed');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
